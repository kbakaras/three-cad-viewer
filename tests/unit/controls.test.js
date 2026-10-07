/**
 * Orbit camera controls and wrapper
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import * as THREE from "three";
import { Controls } from "../../src/camera/controls.js";
import { CADOrbitControls } from "../../src/camera/controls/CADOrbitControls.js";

// Helper to create a mock DOM element with pointer capture support
function createMockDomElement() {
  const element = document.createElement("div");
  element.style.width = "800px";
  element.style.height = "600px";
  element.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
  });
  // Mock pointer capture methods (not available in happy-dom)
  element.setPointerCapture = vi.fn();
  element.releasePointerCapture = vi.fn();
  document.body.appendChild(element);
  return element;
}

function cleanupElement(element) {
  if (element && element.parentNode) {
    element.parentNode.removeChild(element);
  }
}

describe("CADOrbitControls", () => {
  let camera;
  let domElement;
  let controls;

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 1000);
    camera.position.set(0, 0, 10);
    domElement = createMockDomElement();
  });

  afterEach(() => {
    if (controls) {
      controls.dispose();
      controls = null;
    }
    cleanupElement(domElement);
  });

  describe("constructor", () => {
    test("creates controls with quaternion0", () => {
      controls = new CADOrbitControls(camera, domElement);

      expect(controls.quaternion0).toBeInstanceOf(THREE.Quaternion);
    });

    test("saves initial quaternion", () => {
      camera.quaternion.set(0.1, 0.2, 0.3, 0.9).normalize();
      controls = new CADOrbitControls(camera, domElement);

      expect(controls.quaternion0.x).toBeCloseTo(camera.quaternion.x);
      expect(controls.quaternion0.y).toBeCloseTo(camera.quaternion.y);
      expect(controls.quaternion0.z).toBeCloseTo(camera.quaternion.z);
      expect(controls.quaternion0.w).toBeCloseTo(camera.quaternion.w);
    });

    test("initializes rotation restriction flags", () => {
      controls = new CADOrbitControls(camera, domElement);

      expect(controls._horizontalRotate).toBe(true);
      expect(controls._verticalRotate).toBe(true);
    });
  });

  describe("modifier key rotation restrictions", () => {
    test("ctrl key restricts to vertical rotation only", () => {
      controls = new CADOrbitControls(camera, domElement);

      // KeyMapper default: ctrl maps to shiftKey
      const event = new PointerEvent("pointerdown", {
        button: 0,
        shiftKey: true, // This is "ctrl" in KeyMapper default
      });
      domElement.dispatchEvent(event);

      expect(controls._horizontalRotate).toBe(false);
      expect(controls._verticalRotate).toBe(true);
    });

    test("meta key restricts to horizontal rotation only", () => {
      controls = new CADOrbitControls(camera, domElement);

      // KeyMapper default: meta maps to altKey
      const event = new PointerEvent("pointerdown", {
        button: 0,
        altKey: true, // This is "meta" in KeyMapper default
      });
      domElement.dispatchEvent(event);

      expect(controls._horizontalRotate).toBe(true);
      expect(controls._verticalRotate).toBe(false);
    });

    test("pointer up resets rotation restrictions", () => {
      controls = new CADOrbitControls(camera, domElement);
      controls._horizontalRotate = false;
      controls._verticalRotate = false;

      domElement.dispatchEvent(new PointerEvent("pointerup"));

      expect(controls._horizontalRotate).toBe(true);
      expect(controls._verticalRotate).toBe(true);
    });

    test("pointercancel resets restrictions", () => {
      controls = new CADOrbitControls(camera, domElement);
      controls._horizontalRotate = false;

      domElement.dispatchEvent(new PointerEvent("pointercancel"));

      expect(controls._horizontalRotate).toBe(true);
    });
  });

  describe("_rotateLeft and _rotateUp", () => {
    test("_rotateLeft respects horizontal restriction", () => {
      controls = new CADOrbitControls(camera, domElement);
      controls._horizontalRotate = false;
      const originalTheta = controls._sphericalDelta.theta;

      controls._rotateLeft(0.5);

      expect(controls._sphericalDelta.theta).toBe(originalTheta);
    });

    test("_rotateLeft works when not restricted", () => {
      controls = new CADOrbitControls(camera, domElement);
      controls._horizontalRotate = true;
      const originalTheta = controls._sphericalDelta.theta;

      controls._rotateLeft(0.5);

      expect(controls._sphericalDelta.theta).toBe(originalTheta - 0.5);
    });

    test("_rotateUp respects vertical restriction", () => {
      controls = new CADOrbitControls(camera, domElement);
      controls._verticalRotate = false;
      const originalPhi = controls._sphericalDelta.phi;

      controls._rotateUp(0.5);

      expect(controls._sphericalDelta.phi).toBe(originalPhi);
    });

    test("_rotateUp works when not restricted", () => {
      controls = new CADOrbitControls(camera, domElement);
      controls._verticalRotate = true;
      const originalPhi = controls._sphericalDelta.phi;

      controls._rotateUp(0.5);

      expect(controls._sphericalDelta.phi).toBe(originalPhi - 0.5);
    });
  });

  describe("public rotateLeft and rotateUp", () => {
    test("rotateLeft bypasses restriction", () => {
      controls = new CADOrbitControls(camera, domElement);
      controls._horizontalRotate = false;
      const originalTheta = controls._sphericalDelta.theta;

      controls.rotateLeft(0.5);

      expect(controls._sphericalDelta.theta).toBe(originalTheta - 0.5);
    });

    test("rotateUp bypasses restriction", () => {
      controls = new CADOrbitControls(camera, domElement);
      controls._verticalRotate = false;
      const originalPhi = controls._sphericalDelta.phi;

      controls.rotateUp(0.5);

      expect(controls._sphericalDelta.phi).toBe(originalPhi - 0.5);
    });
  });

  describe("saveState and reset", () => {
    test("saveState saves quaternion", () => {
      controls = new CADOrbitControls(camera, domElement);

      camera.quaternion.set(0.5, 0.5, 0.5, 0.5).normalize();
      controls.saveState();

      expect(controls.quaternion0.x).toBeCloseTo(camera.quaternion.x);
    });

    test("reset restores quaternion", () => {
      controls = new CADOrbitControls(camera, domElement);
      const originalQ = camera.quaternion.clone();
      controls.saveState();

      camera.quaternion.set(0.5, 0.5, 0.5, 0.5).normalize();
      controls.reset();

      expect(camera.quaternion.x).toBeCloseTo(originalQ.x);
      expect(camera.quaternion.y).toBeCloseTo(originalQ.y);
      expect(camera.quaternion.z).toBeCloseTo(originalQ.z);
      expect(camera.quaternion.w).toBeCloseTo(originalQ.w);
    });

    test("reset dispatches change event", () => {
      controls = new CADOrbitControls(camera, domElement);
      controls.saveState();

      const changeSpy = vi.fn();
      controls.addEventListener("change", changeSpy);

      controls.reset();

      expect(changeSpy).toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    test("removes event listeners", () => {
      controls = new CADOrbitControls(camera, domElement);
      const removeEventListenerSpy = vi.spyOn(
        domElement,
        "removeEventListener",
      );

      controls.dispose();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "pointerdown",
        controls._onCADPointerDown,
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "pointerup",
        controls._onCADPointerUp,
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "pointercancel",
        controls._onCADPointerUp,
      );
    });
  });
});

describe("Controls", () => {
  let camera;
  let element;
  let controls;

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera(75, 4 / 3, 0.1, 1000);
    camera.position.set(0, 0, 10);
    element = createMockDomElement();
    controls = new Controls(camera, new THREE.Vector3(1, 2, 3), element);
  });

  afterEach(() => {
    controls.dispose();
    cleanupElement(element);
  });

  test("uses Orbit and keeps the target", () => {
    expect(controls.controls).toBeInstanceOf(CADOrbitControls);
    expect(controls.getTarget().toArray()).toEqual([1, 2, 3]);
  });

  test("updates speeds directly", () => {
    controls.setPanSpeed(2);
    controls.setZoomSpeed(3);
    controls.setRotateSpeed(4);
    expect(controls.controls.panSpeed).toBe(2);
    expect(controls.controls.zoomSpeed).toBe(3);
    expect(controls.controls.rotateSpeed).toBe(4);
  });

  test("retains the target when switching cameras", () => {
    const next = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 1000);
    controls.setCamera(next);
    expect(controls.controls.object).toBe(next);
    expect(controls.getTarget().toArray()).toEqual([1, 2, 3]);
  });

  test("can save and restore camera state", () => {
    const saved = controls.getResetLocation();
    controls.setTarget(new THREE.Vector3(3, 4, 5));
    controls.reset();
    expect(controls.getTarget().toArray()).toEqual(saved.target0.toArray());
  });
});
