/// <reference path='./visualizer.ts'/>

module ui {

    function setBlockIFrameEvents(flag:boolean) {
        if (flag) {
            document.body.classList.add("noselect")
        } else {
            document.body.classList.remove("noselect")
        }

        let elems = document.getElementsByTagName('iframe')
        for (let i=0; i < elems.length; i++) {
            if (flag) {
                elems[i].classList.add('no-pointer-events')
            } else {
                elems[i].classList.remove('no-pointer-events')
            }
        }
    }
    
    export function setupRotatorKnob(rotator:HTMLElement, onRotate:(rad:number) => void) {
        let dragging = false
        let rotation = 0
        
        const moveHandler = (evt:MouseEvent|TouchEvent) => {
          if (dragging) {
              let touchOrMouseEvent : any
              if ((evt as any).targetTouches) {
                  touchOrMouseEvent = (evt as any).targetTouches[0]
              } else {
                  touchOrMouseEvent = evt
              }
              const bounds = rotator.getBoundingClientRect()
              const x = touchOrMouseEvent.pageX - bounds.left - bounds.width/2
              const y = touchOrMouseEvent.pageY - bounds.top - bounds.height/2
              
              // x is positive east, negative west
              // y is positive north, negative south
              // a rotation of 0 is pointing up
              // determine rotation about the center
              if (x !== 0 && y !== 0) {
                  rotation = Math.atan2(y, x)
                  // Allow snap-to for the four 90 degree rotations
                  const eps = .1
                  for (let i=-2; i <= 2; i++) {
                      const snapTo = i * Math.PI/2
                      if (Math.abs(rotation - snapTo) < eps) {
                          rotation = snapTo
                          break
                      } 
                  }
                  
                  // a rotation of 0 should be up
                  rotation += Math.PI / 2
                  
                  rotator.style["transform"] = "rotate(" + rotation + "rad)"
                  if (onRotate) {
                      onRotate(rotation)
                  }
              }
              evt.stopPropagation()
              evt.preventDefault()
          }
        }
        
        let startRotateHandler = () => {
            if (! dragging) {
                dragging = true
                document.body.classList.add("noselect")
                document.addEventListener('mousemove', moveHandler)
                document.addEventListener('touchmove', moveHandler)
                setBlockIFrameEvents(true)
            }    
        }
        
        let stopRotateHandler = () => {
            if (dragging) {
                dragging = false
                document.removeEventListener('mousemove', moveHandler)
                document.removeEventListener('touchmove', moveHandler)
                setBlockIFrameEvents(false)
            }
        }
        
        rotator.addEventListener('mousedown', startRotateHandler)
        rotator.addEventListener('touchstart', startRotateHandler)
         
        document.addEventListener("mouseup", stopRotateHandler)
        rotator.addEventListener("touchend", stopRotateHandler)
        rotator.addEventListener("touchcancel", stopRotateHandler)
    }
    
    export enum Orientation {
        Horizontal,
        Vertical
    }

    /* Attach event targets to the element with this class */
    const SLIDER_TOUCH_EVENT_TARGET_CLASS = "touch_event_target"
    const SLIDER_CLICK_EVENT_TARGET_CLASS = "click_event_target"
    
    export class Slider {
        private unconstrainedPosition: number = -1
        private position: number = 0

        // Target for HTML event handlers
        private target_: HTMLElement
        
        static draggedSlider:Slider = null
        static lastPosition:number = -1
        static globalInitDone = false

        public draggedToPositionHandler: (position:number) => void = () => {} 
        
        constructor(public orientation:Orientation, public element:HTMLElement) {
            this.beginWatching()
            
            if (! Slider.globalInitDone) {
                Slider.globalInitDone = true
                document.addEventListener('mousemove', (evt:MouseEvent) => {
                    if (Slider.draggedSlider) Slider.draggedSlider.tryDrag(evt)
                })
                document.addEventListener('mouseup', () => {
                    if (Slider.draggedSlider) Slider.draggedSlider.stopDragging()
                })
            }
        }
        
        public remove() {
            this.endWatching()
            let parent = this.element.parentNode
            if (parent) parent.removeChild(this.element)
        }
        
        public setPosition(position:number) {
            this.position = position
            if (this.isHorizontal()) {
                this.element.style.left = position + "px"
            } else {
                this.element.style.top = position + "px"
            }
        }
        
        public setValue(value:number) {
            const valueStr = value.toFixed(2)
            const labelFieldNodeList = this.element.getElementsByClassName("value_text")
            for (let i=0; i < labelFieldNodeList.length; i++) {
                labelFieldNodeList[i].textContent = valueStr 
            }
        }

        public setVisible(flag:boolean) {
            this.element.style.visibility = flag ? "visible" : "hidden"
        }

        private eventTargets() : {touch:HTMLElement, click:HTMLElement} {
            const getChild = (cn:string) => this.element.getElementsByClassName(cn)[0]
            return {
                touch: getChild(SLIDER_TOUCH_EVENT_TARGET_CLASS) as HTMLElement,
                click: getChild(SLIDER_CLICK_EVENT_TARGET_CLASS) as HTMLElement
            }
        }

        private beginWatching() {
            let {touch, click} = this.eventTargets()
            click.onmousedown = (evt:MouseEvent) => this.startDragging(evt)
            Array(touch, click).forEach((target:HTMLElement) => {
                target.ontouchstart = (evt:TouchEvent) => this.startDragging(evt)
                target.ontouchmove = (evt:TouchEvent) => this.tryDrag(evt)
                target.ontouchend = () => this.stopDragging()
                target.ontouchcancel = () => this.stopDragging()
            })
        }

        private endWatching() {
            let {touch, click} = this.eventTargets()
            Array(touch, click).forEach((target:HTMLElement) => {
                target.onmousedown = null
                target.ontouchstart = null
                target.ontouchmove = null
                target.ontouchend = null
                target.ontouchcancel = null
            })
        }
        
        private startDragging(evt:MouseEvent|TouchEvent) {
            Slider.draggedSlider = this
            Slider.lastPosition = this.getEventPosition(evt)
            this.unconstrainedPosition = this.position
            evt.preventDefault() // keeps the cursor from becoming an IBeam
        }
        
        private stopDragging() {
            Slider.draggedSlider = null
        }
        
        private tryDrag(evt:MouseEvent|TouchEvent) {
            if (this !== Slider.draggedSlider) {
                return
            }
            evt.preventDefault() // prevents scrolling on mobile?
            const position = this.getEventPosition(evt)
            let positionChange = position - Slider.lastPosition
            
            // adjust for the scaling we do when the window size is reduced
            const scale = this.element.offsetHeight / this.element.getBoundingClientRect().height 
            positionChange *= scale

            Slider.lastPosition = position
            this.unconstrainedPosition += positionChange
            const maxPosition = this.isHorizontal() ? this.container().offsetWidth : this.container().offsetHeight
            const constrainedPosition = Math.min(Math.max(this.unconstrainedPosition, 0), maxPosition)
            this.draggedToPositionHandler(constrainedPosition)
        }
        
        private container(): HTMLElement {
            return this.element.parentElement || this.element
        }
        
        private isHorizontal(): Boolean {
            return this.orientation == Orientation.Horizontal
        }
        
        private getEventPosition(evt:MouseEvent|TouchEvent): number {
            const offsetPos = this.isHorizontal() ? this.container().offsetLeft : this.container().offsetTop
            const pageKey = this.isHorizontal() ? "pageX" : "pageY"
            if ((evt as TouchEvent).targetTouches) {
                // Touch event
                return (evt as TouchEvent).targetTouches[0][pageKey] - offsetPos
            } else {
                // Mouse event
                return (evt as MouseEvent)[pageKey] - offsetPos
            }
        }
    }

    export interface Draggable {
        dragStart(raycaster: THREE.Raycaster): void
        dragEnd(): void
        dragged(raycaster: THREE.Raycaster): void
        hitTestDraggable(raycaster: THREE.Raycaster): Draggable // or null
    }

    // Helper function
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

    // Entry point for initializing dragging
    export function initDragging(container:HTMLElement, camera:THREE.Camera, draggables:[Draggable]) {
        let dragSelection: Draggable = null
        let mouseIsDown = false
        const getXY = (evt: MouseEvent) => {
            let offset = getElementOffset(container)
            return { x: evt.pageX - offset.x, y: evt.pageY - offset.y }
        }
        const getRaycaster = (evt: MouseEvent): THREE.Raycaster => {
            let {x, y} = getXY(evt)
            let x2 = (x / container.offsetWidth) * 2 - 1
            let y2 = (y / container.offsetHeight) * 2 - 1
            let mouse = new THREE.Vector2(x2, y2)
            let raycaster = new THREE.Raycaster()
            raycaster.setFromCamera(mouse, camera)
            return raycaster
        }
        container.addEventListener('mousemove', (evt: MouseEvent) => {
            if (mouseIsDown) {
                if (dragSelection) {
                    dragSelection.dragged(getRaycaster(evt))
                }
            }
        })
        container.addEventListener('mousedown', (evt) => {
            dragSelection = null
            const raycaster = getRaycaster(evt)
            for (let i = 0; i < draggables.length && dragSelection === null; i++) {
                dragSelection = draggables[i].hitTestDraggable(raycaster)
            }

            if (dragSelection) {
                dragSelection.dragStart(raycaster)
            }
            mouseIsDown = true
        })
        document.addEventListener('mouseup', () => {
            if (dragSelection) {
                dragSelection.dragEnd()
                dragSelection = null
                mouseIsDown = false
            }
        })
    }

    function isLandscape() {
        return window.orientation === 0 || window.orientation === 180
    }

    let sSmallestClientHeightInLandscape:number = null
    function getEffectiveWindowHeight(): number {
        let height = window.innerHeight
        // In landscape, avoid address bar autohiding trickiness
        let isLandscape = window.orientation === 90 || window.orientation === -90
        console.log("isLandscape: " + isLandscape)
        if (isLandscape) {
            if (sSmallestClientHeightInLandscape === null || sSmallestClientHeightInLandscape > height) {
                sSmallestClientHeightInLandscape = height
            }
            height = Math.min(height, sSmallestClientHeightInLandscape)
        }
        return height
    }

    let sContainerInitialWidth:number = null, sContainerInitialHeight:number = null
    export function resizeToFitWindowHeight() {
        let scaleTarget = document.getElementById("ui-scale-target")
        let container = document.getElementById("ui-container")
        if (sContainerInitialWidth === null) {
            sContainerInitialWidth = scaleTarget.offsetWidth
            sContainerInitialHeight = scaleTarget.offsetHeight
        }

        // If our window is big enough to accomodate our max height, remove the transform
        let minHeight = 400, maxHeight = sContainerInitialHeight
        let windowHeight = getEffectiveWindowHeight()
        if (windowHeight >= maxHeight) {
            scaleTarget.style.transform = null
            container.style.marginRight = null
            return
        }

        let height = windowHeight
        height = Math.max(height, minHeight)
        height = Math.min(height, maxHeight)

        let aspectRatio = sContainerInitialWidth / sContainerInitialHeight

        let ratio = height / maxHeight
        let dy = (height - maxHeight)/2, dx = aspectRatio * dy
        let transform = 'translate(' + dx + 'px,' + dy + 'px)'
        transform += ' scale(' + ratio + ',' + ratio + ')'
        scaleTarget.style.transform = transform

        // Adjust the marginRight of the container so that the tutorial
        // can fill the space on the right. This lets us fit both in
        // with the iPhone in landscape mode.
        // Note this makes the margin negative
        container.style.marginRight = (2 * dx) + 'px'
    }
}    
