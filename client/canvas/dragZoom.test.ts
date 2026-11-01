import assert from "node:assert/strict";
import { test } from "node:test";
import { wheelZoomFactor, zoomAt, type Camera } from "../lib/camera.ts";
import { zoomWhileIdle } from "./dragZoom.ts";

// Stage's wheel and zoom-key handlers both ask this before they move the
// camera. The wheel also calls preventDefault first and iso.e2e.ts zooms for
// real mid-drag, so this covers the rule itself.
const camera: Camera = { x: 100, y: 100, scale: 40 };
const anchor = { x: 200, y: 200 };

for (const [name, factor] of [["wheel", wheelZoomFactor(-100, 0, false)], ["keys", 1.2]] as const) test(`FU39-B: ${name} keeps a token drag's grip zoom, then zooms once the drag ends`, () => {
  assert.equal(zoomWhileIdle(true, camera, anchor, factor, 1), null, "nothing moves the grip's camera during a token drag");
  const after = zoomWhileIdle(false, camera, anchor, factor, 1);
  assert.deepEqual(after, zoomAt(camera, anchor, factor, 1));
  assert.ok(after!.scale > camera.scale);
});

test("FU39-B: no camera yet means nothing to zoom", () => {
  assert.equal(zoomWhileIdle(false, null, anchor, 1.2, 1), null);
  assert.equal(zoomWhileIdle(false, undefined, anchor, 1.2, 1), null);
});

test("FU39-B: the minimum scale still bounds a zoom out", () => {
  const out = zoomWhileIdle(false, { x: 0, y: 0, scale: 5 }, anchor, 0.1, 4);
  assert.equal(out!.scale, 4);
});
