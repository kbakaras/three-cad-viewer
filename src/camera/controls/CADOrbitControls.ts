/**
 * CADOrbitControls - Extended OrbitControls for CAD applications
 *
 * Adds:
 * - Public rotateLeft/rotateUp methods for programmatic rotation
 * - Quaternion-based saveState/reset
 * - Modifier key rotation restrictions (ctrl: vertical only, meta: horizontal only)
 *
 * Internal OrbitControls methods/properties used (see three-augmentation.d.ts):
 * - _onMouseDown: Replaced to customize modifier key behavior (shift=pan, ctrl/meta=rotate with axis lock)
 * - _handleMouseDownRotate: Called to initialize rotation state
 * - _handleMouseDownDolly: Called to initialize dolly/zoom state
 * - _handleMouseDownPan: Called to initialize pan state
 * - _sphericalDelta: Modified in _rotateLeft/_rotateUp overrides to implement axis locking
 * - state: Set to track current interaction mode (ROTATE/DOLLY/PAN/NONE)
 */

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MOUSE, Quaternion, Vector2, Vector3, Camera } from "three";
import {
  KeyMapper,
  isOrthographicCamera,
  isPerspectiveCamera,
} from "../../utils/utils.js";

// State constants matching OrbitControls internal state
const STATE = {
  NONE: -1,
  ROTATE: 0,
  DOLLY: 1,
  PAN: 2,
  TARGET_DOLLY: 3,
};

const _cadOrbitTargetDollyDirection = new Vector3();

class CADOrbitControls extends OrbitControls {
  quaternion0: Quaternion;
  private _horizontalRotate: boolean;
  private _verticalRotate: boolean;
  private _onCADPointerDown?: (event: PointerEvent) => void;
  private _onCADPointerMove?: (event: PointerEvent) => void;
  private _onCADPointerUp?: () => void;
  private _targetDollyActive: boolean;
  private _targetDollyStartY: number;

  // Expose internal properties for type safety
  declare state: number;
  declare _sphericalDelta: { theta: number; phi: number };
  declare zoom0: number;
  declare target0: Vector3;
  declare position0: Vector3;
  declare _dollyStart: Vector2;
  declare _dollyEnd: Vector2;
  declare _dollyDelta: Vector2;
  declare _onMouseDown: (event: MouseEvent) => void;
  declare _handleMouseDownRotate: (event: MouseEvent) => void;
  declare _handleMouseDownDolly: (event: MouseEvent) => void;
  declare _handleMouseDownPan: (event: MouseEvent) => void;

  /**
   * Constructs CAD-enhanced orbit controls.
   *
   * @param object - The camera to control.
   * @param domElement - The HTML element for event listeners.
   */
  constructor(object: Camera, domElement: HTMLElement | null = null) {
    super(object, domElement!);

    /**
     * Saved quaternion for reset (in addition to position/target/zoom).
     */
    this.quaternion0 = this.object.quaternion.clone();

    // Rotation axis restriction flags (set via modifier keys)
    this._horizontalRotate = true; // meta key restricts to horizontal only
    this._verticalRotate = true; // ctrl key restricts to vertical only
    this._targetDollyActive = false;
    this._targetDollyStartY = 0;

    // Add pointer event listeners for modifier key detection
    if (domElement) {
      this._onCADPointerDown = this._handleCADPointerDown.bind(this);
      this._onCADPointerMove = this._handleCADPointerMove.bind(this);
      this._onCADPointerUp = this._handleCADPointerUp.bind(this);
      domElement.addEventListener("pointerdown", this._onCADPointerDown);
      domElement.addEventListener("pointermove", this._onCADPointerMove);
      domElement.addEventListener("pointerup", this._onCADPointerUp);
      domElement.addEventListener("pointercancel", this._onCADPointerUp);
    }

    // Override the parent's _onMouseDown which was bound in parent constructor
    this._onMouseDown = this._handleMouseDown.bind(this);
  }

  /**
   * Handle pointer down to check modifier keys for rotation restriction.
   */
  private _handleCADPointerDown(event: PointerEvent): void {
    if (this._isPlainMiddleButton(event)) {
      this._targetDollyActive = true;
      this._targetDollyStartY = event.clientY;
      event.preventDefault();
    }

    // Check modifier keys for rotation restriction
    // ctrl: restrict to vertical rotation only (horizontalRotate = false)
    // meta: restrict to horizontal rotation only (verticalRotate = false)
    this._horizontalRotate = !KeyMapper.get(event, "ctrl");
    this._verticalRotate = !KeyMapper.get(event, "meta");
  }

  private _isPlainMiddleButton(event: MouseEvent | PointerEvent): boolean {
    return (
      event.button === 1 &&
      !KeyMapper.get(event, "ctrl") &&
      !KeyMapper.get(event, "meta") &&
      !KeyMapper.get(event, "shift")
    );
  }

  /**
   * Move camera and target together along the current view ray.
   */
  private _dollyTargetByPixels(deltaY: number): void {
    if (deltaY === 0) return;

    const height = Math.max(1, this.domElement?.clientHeight ?? 1);
    const distance = this.object.position.distanceTo(this.target);
    const distanceDelta = (deltaY / height) * distance * this.zoomSpeed * 2;

    _cadOrbitTargetDollyDirection
      .subVectors(this.target, this.object.position)
      .normalize()
      .multiplyScalar(distanceDelta);

    this.target.add(_cadOrbitTargetDollyDirection);
    this.object.position.add(_cadOrbitTargetDollyDirection);
  }

  /**
   * Handle target dolly independently from Three.js internal mouse handlers.
   */
  private _handleCADPointerMove(event: PointerEvent): void {
    if (!this._targetDollyActive || !this.enableZoom) return;

    const deltaY = event.clientY - this._targetDollyStartY;
    if (deltaY === 0) return;

    this._dollyTargetByPixels(deltaY);
    this._targetDollyStartY = event.clientY;
    event.preventDefault();
    this.dispatchEvent({ type: "change" });
  }

  /**
   * Handle pointer up to reset rotation restrictions.
   */
  private _handleCADPointerUp(): void {
    this._targetDollyActive = false;
    this._horizontalRotate = true;
    this._verticalRotate = true;
    this.state = STATE.NONE;
  }

  /**
   * Override dispose to clean up our event listeners.
   */
  dispose(): void {
    if (
      this.domElement &&
      this._onCADPointerDown &&
      this._onCADPointerMove &&
      this._onCADPointerUp
    ) {
      const el = this.domElement as HTMLElement;
      el.removeEventListener("pointerdown", this._onCADPointerDown);
      el.removeEventListener("pointermove", this._onCADPointerMove);
      el.removeEventListener("pointerup", this._onCADPointerUp);
      el.removeEventListener("pointercancel", this._onCADPointerUp);
    }
    super.dispose();
  }

  /**
   * Custom mouse down handler for rotation restriction via modifier keys.
   *
   * Original OrbitControls: ctrl/meta/shift + left mouse = pan
   * CADOrbitControls: ctrl = vertical rotate only, meta = horizontal rotate only,
   *                   shift = pan (via KeyMapper)
   */
  private _handleMouseDown(event: MouseEvent): void {
    let mouseAction: number;

    switch (event.button) {
      case 0:
        mouseAction = this.mouseButtons.LEFT!;
        break;
      case 1:
        mouseAction = this.mouseButtons.MIDDLE!;
        break;
      case 2:
        mouseAction = this.mouseButtons.RIGHT!;
        break;
      default:
        mouseAction = -1;
    }

    switch (mouseAction) {
      case MOUSE.DOLLY:
        if (this.enableZoom === false) return;
        this._targetDollyActive = this._isPlainMiddleButton(event);
        if (this._targetDollyActive) {
          this._targetDollyStartY = event.clientY;
          this.state = STATE.TARGET_DOLLY;
          event.preventDefault();
          this.dispatchEvent({ type: "start" });
          return;
        }
        this._handleMouseDownDolly(event);
        this.state = STATE.DOLLY;
        break;

      case MOUSE.ROTATE:
        // Check if shift key (via KeyMapper) is pressed for pan
        if (KeyMapper.get(event, "shift")) {
          if (this.enablePan === false) return;
          this._handleMouseDownPan(event);
          this.state = STATE.PAN;
        } else {
          // ctrl and meta are handled for rotation restriction in _handleCADPointerDown
          if (this.enableRotate === false) return;
          this._handleMouseDownRotate(event);
          this.state = STATE.ROTATE;
        }
        break;

      case MOUSE.PAN:
        // For right mouse button, check if any modifier for rotate
        if (
          KeyMapper.get(event, "ctrl") ||
          KeyMapper.get(event, "meta") ||
          KeyMapper.get(event, "shift")
        ) {
          if (this.enableRotate === false) return;
          this._handleMouseDownRotate(event);
          this.state = STATE.ROTATE;
        } else {
          if (this.enablePan === false) return;
          this._handleMouseDownPan(event);
          this.state = STATE.PAN;
        }
        break;

      default:
        this.state = STATE.NONE;
    }
  }

  /**
   * Override dolly mouse move to support moving the target instead of zooming.
   */
  _handleMouseMoveDolly(event: MouseEvent): void {
    if (this._targetDollyActive) {
      this._dollyEnd.set(event.clientX, event.clientY);
      this._dollyDelta.subVectors(this._dollyEnd, this._dollyStart);
      this._dollyTargetByPixels(this._dollyDelta.y);
      this._dollyStart.copy(this._dollyEnd);
      this.dispatchEvent({ type: "change" });
      return;
    }

    super._handleMouseMoveDolly(event);
  }

  /**
   * Override _rotateLeft to respect horizontal rotation restriction.
   */
  _rotateLeft(angle: number): void {
    if (this._horizontalRotate) {
      this._sphericalDelta.theta -= angle;
    }
  }

  /**
   * Override _rotateUp to respect vertical rotation restriction.
   */
  _rotateUp(angle: number): void {
    if (this._verticalRotate) {
      this._sphericalDelta.phi -= angle;
    }
  }

  /**
   * Save the current state including quaternion.
   */
  saveState(): void {
    super.saveState();
    this.quaternion0.copy(this.object.quaternion);
  }

  /**
   * Reset to saved state including quaternion.
   */
  reset(): void {
    this.target.copy(this.target0);
    this.object.position.copy(this.position0);
    this.object.quaternion.copy(this.quaternion0);

    if (isPerspectiveCamera(this.object) || isOrthographicCamera(this.object)) {
      this.object.zoom = this.zoom0;
      this.object.updateProjectionMatrix();
    }
    this.dispatchEvent({ type: "change" });

    this.update();

    this.state = -1; // STATE.NONE
  }

  /**
   * Rotate camera left (around the up axis).
   * Programmatic rotation bypasses modifier key restrictions.
   */
  rotateLeft(angle: number): void {
    // Bypass restriction for programmatic rotation
    this._sphericalDelta.theta -= angle;
  }

  /**
   * Rotate camera up (around the right axis).
   * Programmatic rotation bypasses modifier key restrictions.
   */
  rotateUp(angle: number): void {
    // Bypass restriction for programmatic rotation
    this._sphericalDelta.phi -= angle;
  }
}

export { CADOrbitControls };
