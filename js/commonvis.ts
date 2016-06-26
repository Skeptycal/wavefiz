/// <reference path="../typings/threejs/three.d.ts"/>
/// <reference path="./algorithms.ts"/>
/// <reference path="./potentials.ts"/>

module visualizing {

    // helpers
    export import Vector3 = THREE.Vector3
    export import Complex = algorithms.Complex
    
    export function vector3(x:number, y:number, z:number): THREE.Vector3 {
        return new THREE.Vector3(x, y, z)
    }

    export interface Draggable {
        dragStart(raycaster: THREE.Raycaster): void
        dragEnd(): void
        dragged(raycaster: THREE.Raycaster): void
        hitTestDraggable(raycaster: THREE.Raycaster): Draggable // or null
    }

    export class Visualizable {
        valueAt: (index: number, time: number) => Complex = undefined
    }

    /* A class to help with animations. Adds callbacks (which trigger requestAnimationFrame) */
    export interface AnimatorClient {
        prepareForRender()
    }

    export class Redrawer {
        private clients_: AnimatorClient[] = []
        private rerender_: () => void
        private elapsed_: number
        private lastNow_: number
        private paused_ = true
        private rerenderScheduled_ = false

        constructor(public params: Parameters, rerender: () => void) {
            this.rerender_ = rerender
            this.elapsed_ = 0
            this.lastNow_ = Redrawer.now()
        }

        private static now(): number {
            return (performance || Date).now()
        }

        scheduleRerender() {
            if (! this.rerenderScheduled_) {
                this.rerenderScheduled_ = true
                window.requestAnimationFrame(() => this.fireClientsAndRerender())
            }
        }

        addClient(client: AnimatorClient) {
            this.clients_.push(client)
            this.scheduleRerender()
        }

        setPaused(flag: boolean) {
            this.paused_ = flag
            if (! flag) {
                this.lastNow_ = Redrawer.now()
                this.scheduleRerender()
            }
        }

        reset() {
            this.elapsed_ = 0
        }

        paused(): boolean {
            return this.paused_
        }

        lastTime(): number {
            return this.elapsed_
        }

        private fireClientsAndRerender() {
            this.rerenderScheduled_ = false
            let localClients = this.clients_.slice()
            if (! this.paused_) {
                const now = Redrawer.now()
                const dt = (now - this.lastNow_) / 1000.
                this.elapsed_ += dt * this.params.timescale
                this.lastNow_ = now
            }
            localClients.forEach((client: AnimatorClient) => client.prepareForRender())
            this.rerender_()
            if (! this.paused_) {
                this.scheduleRerender()
            }
        }
    }

    function useNativeLines() {
        return true
    }
    
    // Base class for drawing lines
    export abstract class VisLine {
        constructor(protected length:number) {}

        public abstract update(cb: (index) => THREE.Vector3);
        public abstract setVisible(flag:boolean);
        public abstract setRenderOrder(val:number);
        public abstract addToGroup(group:THREE.Group);
        public abstract removeFromGroup(group:THREE.Group);

        // Creation entry point, that chooses the best subclass
        public static create(length: number, material: THREE.LineBasicMaterialParameters): VisLine {
            if (useNativeLines()) {
                return new VisLineNative(length, material)
            } else {
                return new VisLineShader(length, material)
            }
        }
    }

    // Use native lines
    class VisLineNative extends VisLine {
        private geometry: THREE.Geometry = new THREE.Geometry()
        private line: THREE.Line
        constructor(length: number, material: THREE.LineBasicMaterialParameters) {
            super(length)
            const zero = new THREE.Vector3(0, 0, 0)
            for (let i = 0; i < length; i++) {
                this.geometry.vertices.push(zero)
            };
            (this.geometry as any).dynamic = true
            this.line = new THREE.Line(this.geometry, new THREE.LineBasicMaterial(material))
        }

        public update(cb: (index) => THREE.Vector3) {
            for (let i = 0; i < this.length; i++) {
                this.geometry.vertices[i] = cb(i)
            }
            this.geometry.verticesNeedUpdate = true
        }
        
        public addToGroup(group:THREE.Group) {
            group.add(this.line)
        }

        public removeFromGroup(group:THREE.Group) {
            group.remove(this.line)
        }
        
        public setVisible(flag:boolean) {
            this.line.visible = flag
        }
        
        public setRenderOrder(val:number) {
            this.line.renderOrder = val
        }

    }
        
    let Shaders = {
        fragmentCode:
        `
            uniform vec3 color;
            varying float projectedDepth;

            void main() {
                vec3 mungedColor = color;
                //mungedColor += 10.0 * smoothstep(-50.0, 500., gl_FragCoord.z);
                
                //mungedColor *= (1.0 + smoothstep(-80.0, 80.0, zdepth)) / 2.0;
                
                float cameraDistance = 400.0;
                float psiScale = 250.0;
                float totalScale = psiScale * .5;
                float depthScale = smoothstep(-totalScale, totalScale, cameraDistance - projectedDepth);
                
                mungedColor *= (1.0 + depthScale) / 2.0;
                gl_FragColor = vec4(mungedColor, 1.0);
            }
        `,
        
        vertexCode:
        `
            attribute float direction;
            uniform float thickness;
            attribute vec3 next;
            attribute vec3 prev;
            varying float projectedDepth;
            
            void main() {
                float aspect = 800.0 / 600.0;
                vec2 aspectVec = vec2(aspect, 1.0);
                mat4 projViewModel = projectionMatrix * modelViewMatrix;
                vec4 previousProjected = projViewModel * vec4(prev, 1.0);
                vec4 currentProjected = projViewModel * vec4(position, 1.0);
                vec4 nextProjected = projViewModel * vec4(next, 1.0);
                
                projectedDepth = currentProjected.w;                

                //get 2D screen space with W divide and aspect correction
                vec2 currentScreen = currentProjected.xy / currentProjected.w * aspectVec;
                vec2 previousScreen = previousProjected.xy / previousProjected.w * aspectVec;
                vec2 nextScreen = nextProjected.xy / nextProjected.w * aspectVec;
                
                float len = thickness;
                
                // Use the average of the normals
                // This helps us handle 90 degree turns correctly
                vec2 dir1 = normalize(nextScreen - currentScreen);
                vec2 dir2 = normalize(currentScreen - previousScreen);
                vec2 dir = normalize(dir1 + dir2); 
                vec2 normal = vec2(-dir.y, dir.x);
                normal *= len/2.0;
                normal.x /= aspect;
                
                vec4 offset = vec4(normal * direction, 0.0, 1.0);
                gl_Position = currentProjected + offset;
            }
        `
    }
    
    // does not handle copying within self
    function copyToFrom(dst:Float32Array, src:Float32Array, dstStart:number, srcStart:number, amount:number = Number.MAX_VALUE) {
        const effectiveAmount = Math.min(amount, dst.length - dstStart, src.length - srcStart)
        for (let i=0; i < effectiveAmount; i++) {
            dst[i + dstStart] = src[i + srcStart]
        } 
    }
    
    // Use shaders
    export class VisLineShader extends VisLine {
        public geometry = new THREE.BufferGeometry()
        public mesh: THREE.Mesh
        constructor(length: number, material: THREE.LineBasicMaterialParameters) {
            super(length)
            // Length is the length of the path
            // Use two vertices for each element of our path
            // (and each vertex has 3 coordinates)
            const vertexCount = 2 * length
            let positions = new Float32Array(vertexCount*3)
            this.geometry.addAttribute('position', new THREE.BufferAttribute(positions, 3))
            
            let thickness = Math.max(2, material["linewidth"] || 0)
            let depthWrite = material.hasOwnProperty("depthWrite") ? material["depthWrite"] : true
            
            // set face indexes
            // we draw two faces (triangles) between every two elements of the path
            // each face has 3 vertices, since it's a triangle
            const faceCount = 2 * (length - 1) 
            let faces = new Uint32Array(3 * faceCount)
            let faceVertIdx = 0
            for (let i=0; i+1 < length; i++) {
                let startVertex = i * 2
                faces[faceVertIdx++] = startVertex + 0
                faces[faceVertIdx++] = startVertex + 1
                faces[faceVertIdx++] = startVertex + 2
                faces[faceVertIdx++] = startVertex + 2
                faces[faceVertIdx++] = startVertex + 1
                faces[faceVertIdx++] = startVertex + 3
            }
            this.geometry.setIndex(new THREE.BufferAttribute(faces, 1));
            
            // compute the "direction" attribute, alternating 1 and -1 for each vertex
            let directions = new Float32Array(vertexCount)
            for (let i=0; i < length; i++) {
                directions[i*2] = 1.0
                directions[i*2+1] = -1.0
            }
            this.geometry.addAttribute('direction', new THREE.BufferAttribute(directions, 1));
            
            // compute "next" and "previous" locations
            // next is shifted left, and previous shifted right
            let nexts = new Float32Array(vertexCount*3)
            let prevs = new Float32Array(vertexCount*3)
            this.geometry.addAttribute('next', new THREE.BufferAttribute(nexts, 3))
            this.geometry.addAttribute('prev', new THREE.BufferAttribute(prevs, 3))
            
            ;(this.geometry as any).dynamic = true
            let sm = new THREE.ShaderMaterial({
                side:THREE.DoubleSide,
                uniforms: {
                    color: { type: 'c', value: new THREE.Color( material.color as number ) },
                    thickness: { type: 'f', value: thickness}
                },
                vertexShader: Shaders.vertexCode,
                fragmentShader: Shaders.fragmentCode,
                depthWrite: depthWrite
            })
            this.mesh = new THREE.Mesh(this.geometry, sm)
        }
        
        public update(cb: (index) => THREE.Vector3) {
            let attrs = (this.geometry as any).attributes
            let positions = attrs.position.array
            let path : THREE.Vector3[] = []
            for (let i = 0; i < this.length; i++) {
                path.push(cb(i))
            }
            let positionIdx = 0
            for (let i = 0; i < this.length; i++) {
                let pt = path[i]
                positions[positionIdx++] = pt.x
                positions[positionIdx++] = pt.y
                positions[positionIdx++] = pt.z
                positions[positionIdx++] = pt.x
                positions[positionIdx++] = pt.y
                positions[positionIdx++] = pt.z
            }
            
            let nexts = attrs.next.array
            copyToFrom(nexts, positions, 0, 6) // shifted left
            copyToFrom(nexts, positions, nexts.length - 6, positions.length - 6) // duplicate 6 at end

            let prevs = attrs.prev.array
            copyToFrom(prevs, positions, 6, 0) // shifted right
            copyToFrom(prevs, positions, 0, 0, 6) // duplicate 6 at beginning
            
            attrs.position.needsUpdate = true
            attrs.next.needsUpdate = true
            attrs.prev.needsUpdate = true    
        }
        
        public addToGroup(group:THREE.Group) {
            group.add(this.mesh)
        }

        public removeFromGroup(group:THREE.Group) {
            group.remove(this.mesh)
        }
        
        public setVisible(flag:boolean) {
            this.mesh.visible = flag
        }
        
        public setRenderOrder(val:number) {
            this.mesh.renderOrder = val
        }
    }

    export class Parameters {
        public xScale = 1
        public width: number = 800 // in "pixels"
        public height: number = 600 // in "pixels"
        public cameraDistance = 400 // how far back the camera is
        public maxX: number = 25 // maximum X value
        public timescale: number = 4.0 // multiplier for time
        public energyScale: number = 5 // coefficient for energy in the visualizer, only affects label
        public meshDivision: number = 800 // how many points are in our mesh
        public psiScale: number = 250 // how much scale we visually apply to the wavefunction
        public absScale: number = 1.5 // how much additional scale we visually apply to the psiAbs and phiAbs

        public centerForMeshIndex(idx: number): number {
            assert(idx >= 0 && idx < this.meshDivision, "idx out of range")
            let meshWidth = this.width / this.meshDivision
            return idx * meshWidth + meshWidth / 2.0
        }

        public convertYToVisualCoordinate(y: number) {
            // 0 is at top
            return this.height * (1.0 - y);
        }

        public convertYFromVisualCoordinate(y: number) {
            return 1.0 - y / this.height
        }

        public convertXToVisualCoordinate(x: number) {
            return (x / this.meshDivision) * this.width
        }        
    }
    
    // Builds a potential based on a function
    // let f be a function that accepts an x position, and optionally the x fraction (in the range [0, 1))
    // returns the new potential
    export function buildPotential(params:Parameters, potentialParam:number, f:algorithms.PotentialBuilderFunc): number[] {
        let potentialMesh: number[] = []
        for (let i = 0; i < params.meshDivision; i++) {
            const x = i / params.meshDivision
            potentialMesh.push(f(potentialParam, x))
        }
        return potentialMesh
    }

    export class State {

        public static applyStateUpdate: (st:State) => void = function(st) {}

        public cameraRotationRadians: number = 0

        public potentialBuilder: algorithms.PotentialBuilderFunc = null
        public potential: number[] = []
        public potentialParameter: number = .15 // single draggable parameter in our potential, in the range [0, 1)

        public sketching: boolean = false
        public sketchLocations: Vector3[] = []

        public showPsi = true // show position psi(x)
        public showPsiAbs = false // show position probability |psi(x)|^2
        public showPhi = false; // show momentum phi(x)
        public showPhiAbs = false // show momentum probability |phi(x)|^2

        public paused = false

        // The energies array is sparse
        // Keys are energy bar identifiers, values are numbers
        public energies: { [key:string]:number; } = {}

        // Returns a dense array of the energy values, discarding the identifiers
        public energyValues(): number[] {
            return Object.keys(this.energies).map((k) => this.energies[k])
        }

        // Identifier support
        // TODO: describe this
        private static LastUsedIdentifier = 0
        public static newIdentifier() {
            return ++State.LastUsedIdentifier
        }


        public copy(): State {
            let clone = new State()
            for (let key in this) {
                if (this.hasOwnProperty(key)) {
                    clone[key] = this[key]
                }
            }
            return clone
        }

        public modify(params:Parameters, handler:(st:State) => void) {
            let cp = this.copy()
            handler(cp)
            cp.rebuildPotentialIfNeeded(params, this)
            State.applyStateUpdate(cp)
        }

        private rebuildPotentialIfNeeded(params:Parameters, oldState:State) {
            if (! this.potentialBuilder) {
                this.potential = []
            } else if (this.potentialParameter !== oldState.potentialParameter || 
                    this.potentialBuilder !== oldState.potentialBuilder) {
                this.potential = buildPotential(params, this.potentialParameter, this.potentialBuilder)
            }
        }
    }

    export function assert(condition, message) {
        if (!condition) {
            throw message || "Assertion failed"
        }
    }
    
    function timeThing(iters:number, funct: (() => void)) {
        const start = new Date().getTime()
        for (let iter=0; iter < iters; iter++) {
            funct()
        }
        const end = new Date().getTime()
        const duration = (end - start) / iters
        return duration
    } 
    
    function benchmarkImpl(forProfiling: boolean):string {
        const params = new Parameters()
        
        // SHO-type potential
        const baseEnergy = 0.25
        const xScaleFactor = 1.0 / 4.0
        const potential = buildPotential(params, .15, (x: number) => {
            // x is a value in [0, this.potential_.width)
            // we have a value of 1 at x = width/2
            const offsetX = params.width / 2
            const scaledX = (x - offsetX)
            return baseEnergy + xScaleFactor * (scaledX * scaledX / 2.0)
        })
        
        const center = algorithms.indexOfMinimum(potential)
        const energy = 2.5
        const input = {
            potentialMesh: potential,
            energy: energy,
            maxX:params.maxX
        }
        
        let psi = algorithms.classicallyResolvedAveragedNumerov(input)
        const maxIter = forProfiling ? 1024 : 32
        let duration1 = timeThing(maxIter, () => {
            let phi = psi.fourierTransformOptimized(center, .5)
        })
        
        let text = duration1.toFixed(2) + " ms"
        if (!forProfiling) {
            let duration2 = timeThing(maxIter, () => {
                let phi = psi.fourierTransform(center, .5)
            })
            text += "/ " + duration2.toFixed(2) + " ms"
        }

        return text 
    }
    
    export function benchmark(): string {
        return benchmarkImpl(false)
    }
    
    export function runForProfiling(): string {
        return benchmarkImpl(true)
    }
}
