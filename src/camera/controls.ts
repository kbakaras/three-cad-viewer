import * as THREE from "three";

import { CADOrbitControls } from "./controls/CADOrbitControls.js";

/**
 * Orbit camera controls with state saving and camera switching.
 *
 * @internal - This is an internal class used by Viewer
 */
class Controls {
  camera: THREE.Camera;
  target: THREE.Vector3;
  target0: THREE.Vector3;
  domElement: HTMLElement;
  rotateSpeed: number;
  zoomSpeed: number;
  panSpeed: number;
  controls: CADOrbitControls;
  currentUpdateCallback: (() => void) | null;

  /**
   * Create Camera Controls.
   * @param camera - The camera object.
   * @param target - The lookAt target for the camera.
   * @param domElement - The dom element of the rendering canvas.
   * @param rotateSpeed - Speed for rotating.
   * @param zoomSpeed - Speed for zooming.
   * @param panSpeed - Speed for panning.
   */
  constructor(
    camera: THREE.Camera,
    target: THREE.Vector3,
    domElement: HTMLElement,
    rotateSpeed: number = 1.0,
    zoomSpeed: number = 1.0,
    panSpeed: number = 1.0,
  ) {
    this.camera = camera;
    this.target = target;
    this.target0 = target.clone();
    this.domElement = domElement;
    this.rotateSpeed = rotateSpeed;
    this.zoomSpeed = zoomSpeed;
    this.panSpeed = panSpeed;
    this.controls = new CADOrbitControls(this.camera, this.domElement);

    this.controls.target.copy(this.target);
    this.controls.rotateSpeed = this.rotateSpeed;
    this.controls.zoomSpeed = this.zoomSpeed;
    this.controls.panSpeed = this.panSpeed;

    this.currentUpdateCallback = null;

    // save default view for reset
    this.saveState();
    this.update();
  }

  /**
   * Remove assets and event handlers.
   */
  dispose(): void {
    this.controls.dispose();
  }

  /**
   * Save state for reset.
   */
  saveState(): void {
    this.controls.saveState();
  }

  /**
   * Add an event listener callback for the "change" event.
   * @param callback - the callback function.
   */
  addChangeListener(callback: () => void): void {
    if (this.currentUpdateCallback == null) {
      this.currentUpdateCallback = callback;
      this.controls.addEventListener("change", callback);
    }
  }

  /**
   * Remove the event listener callback for the "change" event.
   */
  removeChangeListener(): void {
    if (this.currentUpdateCallback != null) {
      this.controls.removeEventListener("change", this.currentUpdateCallback);
      this.currentUpdateCallback = null;
    }
  }

  /**
   * Update controls after camera position, zoom or quaternion changes.
   */
  update(): void {
    this.controls.update();
  }

  /**
   * Reset camera to initial (automatically saved) state of position, up, quaternion and zoom.
   */
  reset(): void {
    this.controls.reset();
  }

  /**
   * Set the camera to be controlled.
   * @param camera - a threejs Camera object.
   */
  setCamera(camera: THREE.Camera): void {
    this.controls.object = camera;
  }

  /**
   * Get the lookAt target of the camera.
   * @returns The lookAt target
   */
  getTarget(): THREE.Vector3 {
    return this.controls.target;
  }

  /**
   * Check if the user is currently interacting with the controls (rotating, panning, zooming).
   * @returns true if user is dragging/interacting, false otherwise.
   */
  isInteracting(): boolean {
    return this.controls.state !== -1;
  }

  /**
   * Get the initial zoom value of the camera.
   */
  getZoom0(): number {
    return this.controls.zoom0;
  }

  /**
   * Set the lookAt target of the camera.
   * @param target - camera target as THREE.Vector3.
   */
  setTarget(target: THREE.Vector3): void {
    this.controls.target.copy(target);
  }

  /**
   * Set the zoom speed.
   * @param val - the speed value (1.0 = default).
   */
  setZoomSpeed(val: number): void {
    this.zoomSpeed = val;
    this.controls.zoomSpeed = val;
  }

  /**
   * Set the pan speed.
   * @param val - the speed value (1.0 = default).
   */
  setPanSpeed(val: number): void {
    this.panSpeed = val;
    this.controls.panSpeed = val;
  }

  /**
   * Set the rotate speed.
   * @param val - the speed value (1.0 = default).
   */
  setRotateSpeed(val: number): void {
    this.rotateSpeed = val;
    this.controls.rotateSpeed = val;
  }

  /**
   * Get reset location value.
   * @returns target, position, quaternion, zoom as object.
   */
  getResetLocation = (): {
    target0: THREE.Vector3;
    position0: THREE.Vector3;
    quaternion0: THREE.Quaternion;
    zoom0: number;
  } => {
    return {
      target0: this.controls.target0.clone(),
      position0: this.controls.position0.clone(),
      quaternion0: this.controls.quaternion0.clone(),
      zoom0: this.controls.zoom0,
    };
  };

  /**
   * Set reset location value.
   * @param target - camera target as THREE.Vector3.
   * @param position - camera position as THREE.Vector3.
   * @param quaternion - camera rotation as THREE.Quaternion.
   * @param zoom - camera zoom value.
   */
  setResetLocation = (
    target: THREE.Vector3,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    zoom: number,
  ): void => {
    this.controls.target0.copy(target);
    this.controls.position0.copy(position);
    this.controls.quaternion0.copy(quaternion);
    this.controls.zoom0 = zoom;
  };

  /**
   * Rotate camera up.
   * @param angle - the angle to rotate.
   */
  rotateUp(angle: number): void {
    this.controls.rotateUp((-angle / 180) * Math.PI);
    this.update();
  }

  /**
   * Rotate camera left.
   * @param angle - the angle to rotate.
   */
  rotateLeft(angle: number): void {
    this.controls.rotateLeft((angle / 180) * Math.PI);
    this.update();
  }
}

export { Controls };
