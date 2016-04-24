function assert(condition, message) {
    if (!condition) {
        throw message || "Assertion failed"
    }
}

function normalize(vals:number[], dx:number) {
    // norm is sum of dx * vals**2
    let norm = 0
    for (let i=0; i < vals.length; i++) {
        norm += vals[i] * vals[i]
    }
    norm *= dx
    norm = Math.sqrt(norm)
    if (norm == 0) norm = 1 // gross
    const normRecip = 1.0 / norm
    for (let i=0; i < vals.length; i++) {
        vals[i] *= normRecip
    }
}

function normalizeSign(vals:number[]) {
    // make it negative on the left
    // negative is upwards in our visualizer
    let wantsSignFlip = false
    const eps = 1.0E-16
    for (let i=0; i < vals.length; i++) {
        if (Math.abs(vals[i]) > eps) {
            wantsSignFlip = vals[i] > 0
            break
        }
    }
    if (wantsSignFlip) {
        for (let i=0; i < vals.length; i++) {
            vals[i] = -vals[i]
        }
    }
}

interface IntegratorInput {
    potentialMesh: number[]
    energy: number
    xMax:number
}

// represents a complex number with fields re and im
class Complex {
    constructor(public re:number, public im:number) {}
    
    add(rhs:Complex) {
        this.re += rhs.re
        this.im += rhs.im
    }
}

// Computes the time-dependent part of the Schrodinger equation at an energy eigenvalue
function computeTimeDependence(energy:number, time:number): Complex {
    // e^(-iEt) -> cos(-eT) + i * sin(-Et)
    const nEt = - energy * time
    return new Complex(Math.cos(nEt), Math.sin(nEt))
}


class ResolvedWavefunction {
    constructor(public values:number[],
                public energy:number,
                public dx:number,
                public leftTurningPoint:number,
                public rightTurningPoint:number,
                public leftDerivativeDiscontinuity:number,
                public rightDerivativeDiscontinuity:number) {}
    
    discontinuity():number {
        return Math.abs(this.leftDerivativeDiscontinuity * this.rightDerivativeDiscontinuity)
    }
    
    valueAt(x:number, time:number) {
     // e^(-iEt) -> cos(-eT) + i * sin(-Et)
        const nEt = - this.energy * time
        const y = this.values[x]
        return new Complex(y * Math.cos(nEt), y * Math.sin(nEt))
    }
    
    asGeneralized() : GeneralizedWavefunction {
        return new GeneralizedWavefunction([this])
    }
}

// Represents a generalized solution to the Schrodinger equation as a sum of time-independent solutions
// Assumes equal weights
class GeneralizedWavefunction {
    public length:number
    constructor(public components:ResolvedWavefunction[]) {
        assert(components.length > 0, "Empty components in GeneralizedWavefunction")
        this.length = components[0].values.length 
        this.components.forEach((psi:ResolvedWavefunction) => {
            assert(psi.values.length == this.length, "Not all lengths the same")
        })
    }
    
    valueAt(x:number, time:number) {
        let result = new Complex(0, 0)
        this.components.forEach((psi:ResolvedWavefunction) => {
            result.add(psi.valueAt(x, time))
        })
        result.re /= this.components.length
        result.im /= this.components.length
        return result
    }
    
    valuesAtTime0() : number[] {
        let result = zeros(this.length)
        for (let i=0; i < this.length; i++) {
            result[i] = this.valueAt(i, 0).re
        }
        return result
    }
}

// Given two ResolvedWavefunction, computes an average weighted by the discontinuities in their derivatives
function averageResolvedWavefunctions(first:ResolvedWavefunction, second:ResolvedWavefunction) : ResolvedWavefunction {
    assert(first.values.length == second.values.length, "Wavefunctions have different lengths")
    const bad1 = first.leftDerivativeDiscontinuity
    const bad2 = second.leftDerivativeDiscontinuity
    const eps = .01
    let values : number[]
    if (Math.abs(bad1) < eps) {
        values = first.values.slice()
    } else if (Math.abs(bad2) < eps) {
        values = second.values.slice()
    } else {
        // we want bad1 + k * bad2 = 0
        // so k = -bad1 / bad2
        const k = -bad1 / bad2
        const length = first.values.length
        values = zeros(length)
        for (let i=0; i < length; i++) {
            values[i] = first.values[i] + k * second.values[i]
        }
        normalize(values, first.dx)
    }
    normalizeSign(values)
    return new ResolvedWavefunction(values, first.energy, first.dx, first.leftTurningPoint, first.rightTurningPoint, 0, 0)
}

interface TurningPoints {
    left:number,
    right: number
}

class Wavefunction {
    valuesFromCenter: number[] = []
    valuesFromEdge: number[] = []
    // F function used in Numerov
    F:  (x:number) => number = null
    
    constructor(public potential: number[], public energy:number, public xMax:number) {
        this.potential = this.potential.slice()
    }
    
    length() : number {
        assert(this.valuesFromCenter.length == this.valuesFromEdge.length, "Wavefunction does not have a consistent length")
        return this.valuesFromCenter.length
    }
    
    // suggest some turning points, based on the classical assumption that energy <= potential 
    classicalTurningPoints() : TurningPoints {
        const length = this.length()
        let left, right
        for (left = 0; left < length/2; left++) {
            if (this.energy > this.potential[left]) {
                break
            }
        }
        for (right = length-1; right > (length+1)/2; right--) {
            if (this.energy > this.potential[right]) {
                break
            }
        }
        return {left: left, right: right}
    }
    
    // computes the discontinuity in the two derivatives at the given location
    // we don't actually care if it's right or left
    private derivativeDiscontinuity(psi:number[], x:number, dx:number, onRight:boolean):number {
        return (psi[x+1] + psi[x-1] - (14. - 12 * this.F(x)) * psi[x]) / dx
    }
    
    // scale the valuesFromEdge to match the valuesFromCenter at the given turning points,
    // then normalize the whole thing
    resolveAtTurningPoints(tp:TurningPoints) : ResolvedWavefunction {
        const left = Math.round(tp.left), right = Math.round(tp.right)
        const length = this.length()
        assert(left <= right, "left is not <= right")
        assert(left >= 0 && left < length && right >= 0 && right < length, "left or right out of bounds")
        const leftScale = this.valuesFromCenter[left] / this.valuesFromEdge[left]
        const rightScale = this.valuesFromCenter[right] / this.valuesFromEdge[right]
        
        // build our wavefunction piecewise: edge, center, edge
        let psi = zeros(length)
        let i = 0
        for (; i < left; i++) {
            psi[i] = leftScale * this.valuesFromEdge[i]
        }
        for (; i < right; i++) {
            psi[i] = this.valuesFromCenter[i]
        }
        for (; i < length; i++) {
            psi[i] = rightScale * this.valuesFromEdge[i]
        }
        
        // normalize
        const dx = this.xMax / length
        normalize(psi, dx)
        
        // compute discontinuities
        const leftDiscont = this.derivativeDiscontinuity(psi, left, dx, false)
        const rightDiscont = this.derivativeDiscontinuity(psi, right, dx, true) 

        return new ResolvedWavefunction(psi, this.energy, dx, left, right, leftDiscont, rightDiscont)
    }
    
    resolveAtClassicalTurningPoints() : ResolvedWavefunction {
        return this.resolveAtTurningPoints(this.classicalTurningPoints())
    }
}


// calculates the wavefunction from a potential
interface Integrator {
    computeWavefunction(input:IntegratorInput) : Wavefunction
}

function NumerovIntegrator(even:boolean) : Integrator {
    return {
        computeWavefunction: (input) => numerov(input, even)
    }
}

function zeros(amt:number) : number[] {
    var result = []
    for (let i=0; i < amt; i++) result.push(0)
    return result
}

function numerov(input:IntegratorInput, even:boolean) : Wavefunction {
    // we start at the center of the potential mesh
    // and integrate left and right
    // we require that the potential mesh have an ODD number of values,
    // and assume that the wavefunction takes on the same value in the two adjacent to the center
    const potential = input.potentialMesh 
    const length = potential.length 
    assert(length % 2 == 1, "PotentialMesh does not have odd count")
    assert(length >= 3, "PotentialMesh is too small")
    const c = (length + 1)/2 // center
    
    // Fill wavefunction with all 0s
    let wavefunction = new Wavefunction(potential.slice(), input.energy, input.xMax)
    wavefunction.valuesFromCenter = zeros(length)
    wavefunction.valuesFromEdge = zeros(length)
     
    const energy = input.energy
    const dx = input.xMax / length
    const ddx12 = dx * dx / 12.0
    
    // F function used by Numerov
    const F = (x:number) => 1.0 - ddx12 * 2. * (potential[x] - energy)
    wavefunction.F = F
    
    // Numerov integrator formula
    // given that we have set psi[index], compute and set psi[index+1] if rightwards,
    // or psi[index-1] if leftwards
    const GoingLeft = false, GoingRight = true
    const step = (psi:number[], index:number, rightwards:boolean) => {
        const targetX = rightwards ? index+1 : index-1 // point we're setting
        const prev1X = index // previous x
        const prev2X = rightwards ? index-1 : index+1 // previous previous x
        psi[targetX] = (((12. - F(prev1X) * 10.) * psi[prev1X] - F(prev2X) * psi[prev2X])) / F(targetX)
    }
    
    // integrate outwards
    // In the reference code, f is the potential, y is psi
    let psi = wavefunction.valuesFromCenter
    if (even) {
        psi[c] = 1
        psi[c+1] = 0.5 * (12. - F(c) * 10.) * psi[c] / F(c+1)
    } else {
        psi[c] = 0
        psi[c+1] = dx
    }
    
    // rightwards integration
    for (let i = c+1; i+1 < length; i++) {
        //y[i + 1] = ((12. - f[i] * 10.) * y[i] - f[i - 1] * y[i - 1]) / f[i + 1];
        step(psi, i, GoingRight)
    }
    // leftwards integration
    // note we "start at" c+1
    for (let i = c; i > 0; i--) {
        step(psi, i, GoingLeft)
    }
    
    // integrate inwards
    // we assume psi is 0 outside the mesh
    psi = wavefunction.valuesFromEdge
    psi[0] = even ? dx : -dx;
    psi[1] = (12. - 10.*F(0)) * psi[0] / F(1);
    for (let i=1; i < c; i++) {
        step(psi, i, GoingRight)
    }
    
    psi[length-1] = dx;
    psi[length-2] = (12. - 10.*F(length-1)) * psi[length-1] / F(length-2);
    for (let i=length-2; i > c; i--) {
        step(psi, i, GoingLeft)
    }
    
    return wavefunction
}

function formatFloat(x:number) : string {
    return x.toFixed(2)
}

function algorithmTest() {
    let lines : string[] = []
    const xMax = 20
    const width = 1025 
    let potential = zeros(width)
    for (let i=0; i < width; i++) {
        let x = i / width * xMax - (xMax / 2)
        let V = x*x/2
        potential[i] = V
    }

    let input = {
        potentialMesh: potential,
        energy: 2.5,
        xMax:xMax
    }
    let psi = numerov(input, true).resolveAtClassicalTurningPoints()
    
    lines.push("left discontinuity: " + psi.leftDerivativeDiscontinuity.toFixed(4))
    lines.push("right discontinuity: " + psi.rightDerivativeDiscontinuity.toFixed(4))

    lines.push("x\tpsi\tV")    
    for (let i=0; i < width; i++) {
        let x = i / width * xMax - (xMax / 2)
        lines.push(formatFloat(x) + "\t" + formatFloat(psi.values[i]) + "\t" + formatFloat(potential[i]))
    }
    
    
    return lines.join("\n")
}