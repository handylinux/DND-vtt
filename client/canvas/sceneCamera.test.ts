import assert from "node:assert/strict";
import { test } from "node:test";
import { room, scene } from "#shared/testutil.ts";
import { cameraForView, NO_INSETS, viewToScreen, type Camera } from "../lib/camera.ts";
import { isometric, TOP_DOWN, toView, type View } from "../lib/view.ts";
import { boardPickFor, DrawnHeightsMemo } from "./boardPick.ts";
import { holdViewStill, openSceneCamera } from "./sceneCamera.ts";

// Run the scene and view effects in their real commit order (the scene's
// first, as Stage declares them). Camera math and ground picking stay real,
// so a double conversion moves the measured target.
function commit(before: View, shown: View, changedScene: boolean, saved = true) {
  const size = { width: 920, height: 800 };
  const target = { x: 12, y: 9, zoom: 40 };
  const current = scene("cavern", { bounds: { w: 24, h: 20 }, ...(saved ? { defaultView: target } : {}) });
  const state = room({ scenes: { cavern: current } });
  const camRef = { current: cameraForView(size, toView(before, target), target.zoom) as Camera | null };
  const viewSeen = { current: before };
  const cameras: Camera[] = [];
  const fitted = { cam: cameraForView(size, toView(shown, target), target.zoom) };
  // A fit still standing from before a same-scene turn: the turn moves the camera off it.
  const fittedRef = { current: (changedScene ? null : fitted) as typeof fitted | null };
  const pendingCam = { current: null as Camera | null };
  const setCam = (c: Camera) => cameras.push(c);
  const shownRef = { current: shown };
  openSceneCamera({
    size, scene: current, shown: shownRef, viewSeen, cameraScene: { current: changedScene ? "previous" : current.id }, pendingCam, fitted: fittedRef, cam: camRef,
    groundUnder: () => 0,
    fit: () => { assert.equal(saved, false); return fitted; },
    setCam,
  });
  const heights = new DrawnHeightsMemo();
  holdViewStill({
    shown, viewSeen, pendingCam, cam: camRef, size: { current: size }, fitted: fittedRef, insets: NO_INSETS,
    pick: (view, camera, s) => boardPickFor({ room: state, scene: current, role: "dm", fog: false, view, camera, lowPower: false, canvasHeight: s.height }, heights),
    selected: () => undefined,
    stands: () => true,
    setCam,
  });
  return { cam: camRef.current!, cameras, size, target, fittedRef };
}

test("FU40-B ISOA-5: a new scene's saved camera is not converted again from the previous scene's turn", () => {
  for (const before of [isometric(3), TOP_DOWN, isometric(0), isometric(1), isometric(2)]) {
    const shown = isometric(0);
    const { cam, cameras, size, target } = commit(before, shown, true);
    const center = viewToScreen(cam, toView(shown, target));
    assert.deepEqual(center, { x: size.width / 2, y: size.height / 2 }, `from ${JSON.stringify(before)}: saved center moved to ${JSON.stringify(center)}`);
    assert.equal(cameras.length, 1, "only the scene's saved camera is applied");
  }
});

test("FU40-B ISOA-5: a new scene's fit also stays in that scene's view", () => {
  const shown = isometric(0);
  const { cam, cameras, size, target } = commit(isometric(3), shown, true, false);
  assert.deepEqual(cam, cameraForView(size, toView(shown, target), target.zoom));
  assert.equal(cameras.length, 1, "the fitted camera is not converted a second time");
});

test("FU40-B ISOA-5: turning inside the same scene still holds its center and zoom", () => {
  const shown = isometric(0);
  const { cam, cameras, size, target, fittedRef } = commit(isometric(3), shown, false);
  const center = viewToScreen(cam, toView(shown, target));
  assert.ok(Math.abs(center.x - size.width / 2) < 1e-9 && Math.abs(center.y - size.height / 2) < 1e-9);
  assert.equal(cam.scale, 40);
  assert.equal(cameras.length, 1, "the same-scene turn applies its camera");
  assert.equal(fittedRef.current, null, "the turned camera is no longer the fit");
});
