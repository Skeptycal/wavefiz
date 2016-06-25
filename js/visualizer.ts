/// <reference path="../typings/threejs/three.d.ts"/>
/// <reference path='./potentials.ts'/>
/// <reference path='./algorithms.ts'/>
/// <reference path='./energy.ts'/>
/// <reference path='./potentialvis.ts'/>
/// <reference path='./wavefunctionvis.ts'/>
/// <reference path='./ui.ts'/>

module visualizing {

    // returns the global offset of an HTML element
    function getElementOffset(elem: HTMLElement) {
        let x = 0
        let y = 0
        let cursor = elem as any
        while (cursor != null) {
            x += cursor.offsetLeft
            y += cursor.offsetTop
            cursor = cursor.offsetParent
        }
        return { x: x, y: y }
    }
 
    export class Visualizer {
        private container_: HTMLElement
        private renderer_: THREE.Renderer
        private topScene_: THREE.Scene = new THREE.Scene()
        private topGroup_: THREE.Group = new THREE.Group()
        private camera_: THREE.Camera
        
        private potentialVis_: PotentialVisualizer
        private animator_: Redrawer
        
        private wavefunctionAvg_: WavefunctionVisualizer

        private energyVisualizer_: visualizing.EnergyVisualizer
        private energyBars_: EnergyBar[] = []
        
        private potentialSlider_ : ui.Slider

        private leftTurningPoint_: VisLine
        private rightTurningPoint_: VisLine

        public params = new Parameters()

        public state_ = new State()

        constructor(container: HTMLElement, potentialDragger: HTMLElement, energyContainer: HTMLElement, energyDraggerPrototype: HTMLElement) {
            this.container_ = container

            State.applyStateUpdate = (st:State) => this.setState(st)

            // Animator
            this.animator_ = new Redrawer(this.params, () => this.doRender())

            let renderer = new THREE.WebGLRenderer({ antialias: true })
            renderer.setClearColor(0x222222, 1)
            renderer.setSize(container.offsetWidth, container.offsetHeight)
            this.renderer_ = renderer
            this.container_.appendChild(renderer.domElement)

            const usePerspective = true
            if (usePerspective) {
                let fovDegrees = Math.atan2(this.params.height, this.params.width) * (180 / Math.PI) * 2.0
                fovDegrees = Math.ceil(fovDegrees) // energy lines disappear without this, unclear why
                this.camera_ = new THREE.PerspectiveCamera(fovDegrees, this.params.width / this.params.height, 50, 1000);
                this.topGroup_.position.x = -this.params.width / 2
                this.topGroup_.position.y = this.params.height / 2
                this.topGroup_.scale.y = -1
            } else {
                this.camera_ = new THREE.OrthographicCamera(0, this.params.width, 0, this.params.height, 0.1, 10000)
            }
            this.setCameraRotation(0)

            this.topScene_.add(this.topGroup_)
            
            // Potential slider
            let potentialSliderUpdated = (slider: ui.Slider, position: number) => {
                let value = position / this.params.width
                if (value != this.state_.potentialParameter) {
                    this.state_.modify(this.params, (st:State) => {
                        st.potentialParameter = value 
                    })
                }
            }
            this.potentialSlider_ = new ui.Slider(ui.Orientation.Horizontal, potentialDragger, 0, 0, potentialSliderUpdated)
            this.potentialSlider_.update(this.state_.potentialParameter * this.params.width)

            // Potential Visualizer
            this.potentialVis_ = new PotentialVisualizer(this.params)
            this.topGroup_.add(this.potentialVis_.group)

            // Wavefunction Visualizer
            const centerY = this.params.height / 2
            this.wavefunctionAvg_ = new WavefunctionVisualizer(this.params, 0xFF7777, this.animator_)
            this.wavefunctionAvg_.addToGroup(this.topGroup_, centerY)

            // Turning Points
            for (let j = 0; j < 2; j++) {
                let tp = new VisLine(2, {
                    color: 0x000000,
                    linewidth: 1,
                    transparent: true,
                    opacity: .5
                })
                tp.update((i: number) => vector3(this.params.width / 2, i * this.params.height, 0))
                tp.addToGroup(this.topGroup_)
                if (j === 0) {
                    this.leftTurningPoint_ = tp
                } else {
                    this.rightTurningPoint_ = tp
                }
            }

            // Energy dragger
            let positionUpdated = (slider: ui.Slider, position: number) => {
                // the user dragged the energy to a new value, expressed our "height" coordinate system
                // compute a new wavefunction
                // TODO: untangle this
                const energy = this.params.convertYFromVisualCoordinate(position)
                this.energyBars_.forEach((bar: EnergyBar) => {
                    if (bar.slider === slider) {
                        bar.setPositionAndEnergy(position, energy)
                    }
                })
                this.computeAndShowWavefunctions()
            }
            this.energyVisualizer_ = new visualizing.EnergyVisualizer(energyContainer, energyDraggerPrototype, this.params, positionUpdated)

            // Start listening to events
            this.initEvents()
        }

        private initEvents() {
            let mouseIsDown = false
            let dragSelection: Draggable = null
            const element = this.container_
            const getXY = (evt: MouseEvent) => {
                let offset = getElementOffset(element)
                return { x: evt.pageX - offset.x, y: evt.pageY - offset.y }
            }
            const getRaycaster = (evt: MouseEvent): THREE.Raycaster => {
                let {x, y} = getXY(evt)
                let x2 = (x / element.offsetWidth) * 2 - 1
                let y2 = (y / element.offsetHeight) * 2 - 1
                let mouse = new THREE.Vector2(x2, y2)
                let raycaster = new THREE.Raycaster()
                raycaster.setFromCamera(mouse, this.camera_)
                return raycaster
            }
            element.addEventListener('mousemove', (evt: MouseEvent) => {
                let {x, y} = getXY(evt)
                if (mouseIsDown) {
                    if (dragSelection) {
                        dragSelection.dragged(getRaycaster(evt))
                    }
                    this.animator_.scheduleRerender()
                }
            })
            element.addEventListener('mousedown', (evt) => {
                let {x, y} = getXY(evt)

                dragSelection = null
                const raycaster = getRaycaster(evt)
                const draggables: Draggable[] = [this.potentialVis_]
                for (let i = 0; i < draggables.length && dragSelection == null; i++) {
                    dragSelection = draggables[i].hitTestDraggable(raycaster)
                }

                if (dragSelection) {
                    dragSelection.dragStart(raycaster)
                }
                mouseIsDown = true
                this.animator_.scheduleRerender()
            })
            document.addEventListener('mouseup', () => {
                if (dragSelection) {
                    dragSelection.dragEnd()
                    dragSelection = null
                    mouseIsDown = false
                    this.animator_.scheduleRerender()
                }
            })

        }

        private setCameraRotation(rads: number) {
            // rotate about the y axis
            // rotation of 0 => z = 1 * scale
            const scale = this.params.cameraDistance
            const x = Math.sin(rads) * scale
            const z = Math.cos(rads) * scale
            this.camera_.position.set(x, 0, z)
            this.camera_.lookAt(new THREE.Vector3(0, 0, 0))
        }

        private doRender() {
            this.renderer_.render(this.topScene_, this.camera_)
        }

        private nextInterestingEnergy() {
            // Find the point in [0, 1) furthest from all other points
            // This is naturally in the midpoint between its two closest neighbors
            // This means we can only track one distance
            let usedEnergies = this.energyBars_.map((eb: EnergyBar) => eb.energy())
            
            // hack for initial energy
            if (usedEnergies.length == 0) {
                return 0.3
            }
            
            // treat us as if there's a point at each end
            usedEnergies.push(0)
            usedEnergies.push(1)
            usedEnergies.sort()
            
            let indexOfLargestInterval = -1 
            let lengthOfLargestInterval = -1
            for (let i=0; i + 1 < usedEnergies.length; i++) {
                let length = usedEnergies[i+1] - usedEnergies[i]
                assert(length >= 0, "Array not sorted?")
                if (length > lengthOfLargestInterval) {
                    lengthOfLargestInterval = length
                    indexOfLargestInterval = i
                }
            }
            let result = usedEnergies[indexOfLargestInterval] + lengthOfLargestInterval/2.0
            assert(result >= 0 && result < 1, "energy out of range?")
            return result
        }

        public addEnergySlider() {
            const energy = this.nextInterestingEnergy()
            const position = this.params.convertYToVisualCoordinate(energy)
            const slider = this.energyVisualizer_.addSlider(position, energy * this.params.energyScale)
            const bar = new EnergyBar(slider, position, energy, this.params)
            this.energyBars_.push(bar)
            bar.line.addToGroup(this.topGroup_)
            this.computeAndShowWavefunctions()
        }

        public removeEnergySlider() {
            // remove the last added one
            if (this.energyBars_.length === 0) {
                return
            }
            const bar = this.energyBars_.pop()
            bar.line.removeFromGroup(this.topGroup_)
            this.energyVisualizer_.removeSlider(bar.slider)
            this.computeAndShowWavefunctions()
        }

        private computeAndShowWavefunctions() {
            if (this.state_.potential.length === 0) {
                return
            }
            
            if (this.energyBars_.length > 0) {
                const center = algorithms.indexOfMinimum(this.state_.potential)
                
                // determine max energy
                let energies = this.energyBars_.map((bar) => bar.energy())
                let maxEnergy = Math.max(...energies)
                let maxTurningPoints = algorithms.classicalTurningPoints(this.state_.potential, maxEnergy)
                
                // update wavefunctions and collect them all
                let psis = this.energyBars_.map((bar: EnergyBar) => {
                    const psiInputs = {
                        potentialMesh: this.state_.potential,
                        energy: bar.energy(),
                        maxX: this.params.maxX
                    }
                    
                    // Here we have a choice as to our turning points, which affects how we stitch
                    // our wavefunctions together.
                    //
                    // One possibility is to resolve all of them at the outermost (highest-energy)
                    // classical turning points. This would result in a single "kink." However, in the
                    // classically forbidden region, we tend to get exponential blowup; this will be
                    // suppressed at our turning points, but the effect will be that small adjustments
                    // in energy will result in large swings towards the edges of the total wavefunction:
                    // 
                    // let resolvedWavefunction = algorithms.resolvedAveragedNumerov(psiInputs, maxTurningPoints)
                    //
                    // The other possibility is to resolve each wavefunction component at its own classical
                    // turning points, and then sum those. This will tend to produce multiple "kinks:" one per
                    // wavefunction. In practice this isn't so bad.
                    
                    let resolvedWavefunction = algorithms.classicallyResolvedAveragedNumerov(psiInputs)
                    return resolvedWavefunction  
                })
                let genPsi = new algorithms.GeneralizedWavefunction(psis)
                this.wavefunctionAvg_.setWavefunction(genPsi, center)
            }
            this.wavefunctionAvg_.setVisible(this.energyBars_.length > 0)

            {
                // document.getElementById("statusfield").textContent = ""
            }

            // update turning points based on maximum energy
            let maxEnergy = 0
            this.energyBars_.map((eb: EnergyBar) => maxEnergy = Math.max(maxEnergy, eb.energy()))
            const maxTurningPoints = algorithms.classicalTurningPoints(this.state_.potential, maxEnergy)

            const leftV = this.params.convertXToVisualCoordinate(maxTurningPoints.left)
            const rightV = this.params.convertXToVisualCoordinate(maxTurningPoints.right)
            this.leftTurningPoint_.update((i: number) => vector3(leftV, i * this.params.height, 0))
            this.rightTurningPoint_.update((i: number) => vector3(rightV, i * this.params.height, 0))

            this.animator_.scheduleRerender()
        }

        public setState(state:State) {
            this.state_ = state
            this.potentialVis_.setState(state)
            this.wavefunctionAvg_.setState(state)
            this.setCameraRotation(state.cameraRotationRadians)
            this.computeAndShowWavefunctions()
            this.animator_.scheduleRerender()
        }

        public setShowPsi(flag: boolean) {
            this.state_.showPsi = flag
            this.animator_.scheduleRerender()
        }

        public setShowPsiAbs(flag: boolean) {
            this.state_.showPsiAbs = flag
            this.animator_.scheduleRerender()
        }

        public setShowPhi(flag: boolean) {
            this.state_.showPhi = flag
            this.animator_.scheduleRerender()
        }

        public setShowPhiAbs(flag: boolean) {
            this.state_.showPhiAbs = flag
            this.animator_.scheduleRerender()
        }

        public setPaused(flag: boolean) {
            this.state_.paused = flag
            this.animator_.setPaused(flag)
            if (flag) {
                this.animator_.reset()
            }
        }

        public setRotation(rads: number) {
            this.state_.modify(this.params, (st:State) => {
                st.cameraRotationRadians = rads
            })
        }
        
        public sketchPotential() {
            this.state_.modify(this.params, (st:State) => {
                st.potential = []
                st.potentialBuilder = null
                st.sketching = true
            })
        }

        public loadPotentialFromBuilder(pbf:algorithms.PotentialBuilderFunc) {
            this.state_.modify(this.params, (st:State) => {
                st.sketching = false
                st.dragLocations = []
                st.potentialBuilder = pbf
            })
        }

        public loadSHO() {
            this.loadPotentialFromBuilder(algorithms.SimpleHarmonicOscillator)
        }

        public loadISW() {
            this.loadPotentialFromBuilder(algorithms.InfiniteSquareWell)
        }

        public loadFSW() {
            this.loadPotentialFromBuilder(algorithms.FiniteSquareWell)
        }

        public load2SW() {
            this.loadPotentialFromBuilder(algorithms.TwoSquareWells)
        }

        public loadRandomPotential() {
            this.loadPotentialFromBuilder(algorithms.RandomPotential())
        }
    }
}
