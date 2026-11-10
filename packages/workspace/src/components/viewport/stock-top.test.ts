import { OrthographicCamera, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { millimetresPerPixel } from "./stock-top";

describe("millimetresPerPixel (#544)", () => {
  it("is the top view's zoom, wherever the point", () => {
    const camera = new OrthographicCamera();
    camera.zoom = 4;
    expect(millimetresPerPixel(camera, [100, 50], 600)).toBe(0.25);
  });

  it("grows with the distance from a perspective camera", () => {
    // A 90° field of view 500 mm above the point spans 1000 mm over 500 pixels.
    const camera = new PerspectiveCamera(90);
    const at = (z: number) => {
      camera.position.set(0, 0, z);
      camera.updateMatrixWorld();
    };
    at(500);
    expect(millimetresPerPixel(camera, [0, 0], 500)).toBeCloseTo(2);
    // Off-centre, at the same depth along the view: the same size on screen.
    expect(millimetresPerPixel(camera, [400, 300], 500)).toBeCloseTo(2);
    at(1000);
    expect(millimetresPerPixel(camera, [0, 0], 500)).toBeCloseTo(4);
    camera.zoom = 2;
    expect(millimetresPerPixel(camera, [0, 0], 500)).toBeCloseTo(2);
  });
});
