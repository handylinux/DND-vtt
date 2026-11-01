import { zoomAt, type Camera, type Point } from "../lib/camera.ts";

/**
 * The camera a wheel turn or a zoom key asks for, or null when nothing moves.
 * A token drag's ring height and grab offset belong to its grip-time zoom, so
 * no zoom input changes the camera while one is under way. Stage.tsx cannot be
 * imported by a unit test (its Konva setup reads `window`), so this lives apart.
 */
export function zoomWhileIdle(dragging: boolean, cam: Camera | null | undefined, anchor: Point, factor: number, minScale: number): Camera | null {
  if (dragging || !cam) return null;
  return zoomAt(cam, anchor, factor, minScale);
}
