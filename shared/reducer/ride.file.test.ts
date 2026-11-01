import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { wall } from "../discoveryTestutil.ts";
import { followsInSingleFile } from "../migrate.ts";
import type { RoomState, Token, Viewer } from "../model.ts";
import { canApply } from "../permissions.ts";
import { projectState, stableStringify } from "../project.ts";
import type { OpOf } from "../protocol.ts";
import { applyOp } from "../reducer.ts";
import { findRouteOn } from "../rules/hexWalk.ts";
import { planMove } from "../rules/moveLeg.ts";
import { offGridWallThrough, ownWalk, walkEnd } from "../rules/movement.ts";
import { groupWalkWorld } from "../rules/walkWorld.ts";
import { env, member, P1, P2, room, scene, token, trap } from "../testutil.ts";

/**
 * What a holder drags follows it in single file where its move ends
 * squeezed on squares (D-261101-250, live play LP28-B-RIDE-1, op version
 * 38): along the holder's own line, its middle on the holder's at each
 * corner, and last just behind the holder's squeezed footprint. A goblin a
 * warhorse drags goes with it into a corridor one square wide, where by
 * its place beside the horse it met the rock. Ops stored before 38 replay
 * by its place. The corridor runs along row 6 through rock from x 6 to 14.
 */

function corridor(): RoomState {
  const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds: { w: 22, h: 12 }, blockMovement: true, autoWalls: "off" }) } });
  s.buildChunks = {};
  const runs: [[number, number], [number, number]][] = [[[6, 0], [6, 6]], [[6, 7], [6, 12]], [[14, 0], [14, 6]], [[14, 7], [14, 12]], [[6, 6], [14, 6]], [[6, 7], [14, 7]]];
  runs.forEach(([a, b], i) => wall(s, `fu45bf${String(i).padStart(6, "0")}`, a, b));
  s.tokens.horse = token("horse", { size: "large", x: 2, y: 5, name: "Warhorse", kind: "npc", ownerIds: ["p1"] });
  return s;
}

function towing(s: RoomState, id: string, over: Partial<Token>): RoomState {
  return { ...s, tokens: { ...s.tokens, [id]: token(id, { name: id, kind: "npc", attached: { to: "horse", kind: "drag" }, ...over }) } };
}

/** The horse's own way to `to`, squeezed there, as the device's search finds it with nothing in tow. */
function into(s: RoomState, to = { x: 9.5, y: 5.5 }): OpOf<"token.move"> {
  const { towed: _towed, ...input } = groupWalkWorld(s, ownWalk(s.tokens.horse!), { role: "player" }).input;
  const found = findRouteOn(input, to);
  assert.ok(found && found !== "none", "a way in for the horse alone");
  return { t: "token.move", tokenId: "horse", ...to, squeeze: true, route: found.pieces.map(([x, y, extra, swim]): [number, number, number, 0 | 1] => [x, y, extra, swim]) };
}

const walkOf = (s: RoomState, op: OpOf<"token.move">, id: string, opVersion?: number, who: Viewer = P1) =>
  planMove(op, s, who, opVersion === undefined ? {} : { opVersion }).find((m) => m.tokenId === id)?.route.map((p) => [p.x, p.y]);

function served(s: RoomState, op: OpOf<"token.move">, who: Viewer = P1, opVersion?: number): RoomState {
  const allowed = canApply(op, who, s, { canUseAsset: () => true });
  assert.ok(allowed.ok, allowed.ok ? "" : allowed.message);
  const r = applyOp(s, op, who, { ...env(5), ...(opVersion !== undefined ? { opVersion } : {}) });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.state;
}

describe("squares: what a holder drags follows it in single file where its move ends squeezed (D-261101-250)", () => {
  test("a goblin dragged into a corridor one square wide walks the horse's line and ends right behind it, and the server takes it", () => {
    const s = towing(corridor(), "gob", { x: 1, y: 6 });
    const op = into(s);
    assert.deepEqual(op.route, [[2.5, 5.5, 1, 0], [4, 5.5, 1, 0], [9.5, 5.5, 2, 0]]);
    assert.deepEqual(walkOf(s, op, "gob"), [[1, 6], [3, 6], [4.5, 6], [9, 6]], "on the horse's middle at each corner, behind its squeezed square at the end");
    const after = served(s, op);
    assert.deepEqual([after.tokens.horse!.x, after.tokens.horse!.y, after.tokens.horse!.squeeze], [9.5, 5.5, true]);
    assert.deepEqual([after.tokens.gob!.x, after.tokens.gob!.y, after.tokens.gob!.attached?.to], [9, 6, "horse"], "still in tow");
  });

  test("an op stored before version 38 takes it by its place, so the server's check of that walk refused it and it replays as it was", () => {
    const s = towing(corridor(), "gob", { x: 1, y: 6 });
    const op = into(s);
    assert.deepEqual(walkOf(s, op, "gob", 37), [[1, 6], [1.5, 6.5], [3, 6.5], [8.5, 6.5]]);
    const r = applyOp(s, op, P1, { ...env(5), opVersion: 37 });
    assert.ok(r.ok);
    assert.deepEqual([r.state.tokens.gob!.x, r.state.tokens.gob!.y], [8.5, 6.5]);
    assert.equal(followsInSingleFile(37), false);
    assert.equal(followsInSingleFile(38), true);
    assert.equal(followsInSingleFile(undefined), true);
  });

  test("a walk that ends full size takes them by their places, as before", () => {
    const s = towing(corridor(), "gob", { x: 1, y: 6 });
    const op: OpOf<"token.move"> = { t: "token.move", tokenId: "horse", x: 4, y: 5 };
    assert.deepEqual(walkOf(s, op, "gob"), walkOf(s, op, "gob", 37));
    assert.deepEqual(walkOf(s, op, "gob"), [[1, 6], [3, 6]]);
  });

  test("two goblins line up behind it, the one nearer the horse first", () => {
    // The goblin at the horse's corner, the imp below it, whose middle is the nearer to the horse's where the walk starts.
    let s = towing(corridor(), "gob", { x: 1, y: 7 });
    s = towing(s, "imp", { x: 3, y: 7 });
    const after = served(s, into(s));
    assert.deepEqual([after.tokens.imp!.x, after.tokens.imp!.y], [9, 6]);
    assert.deepEqual([after.tokens.gob!.x, after.tokens.gob!.y], [8, 6]);
  });

  test("one players cannot see lines up behind those they see, so the visible one's place reads nothing of it, and it reaches no player", () => {
    // The goblin at the horse's corner, the hidden imp below it, nearer the horse: by nearness alone the imp would go first.
    const seen = towing(corridor(), "gob", { x: 1, y: 7 });
    const both = towing(seen, "imp", { x: 3, y: 7, visibility: "dm" });
    const op = into(seen);
    const alone = served(seen, op);
    const after = served(both, op);
    assert.deepEqual([after.tokens.gob!.x, after.tokens.gob!.y], [alone.tokens.gob!.x, alone.tokens.gob!.y], "the goblin right behind the horse, as with no imp");
    assert.deepEqual([after.tokens.imp!.x, after.tokens.imp!.y], [8, 6], "the hidden imp behind the goblin");
    for (const who of [P1, P2]) assert.equal(stableStringify(projectState(after, who, { sceneId: "s1" })), stableStringify(projectState(alone, who, { sceneId: "s1" })), `${who.memberId} is sent the same`);
  });

  test("a Large creature in tow lines up along the corridor's middle, squeezed sides apart, where its stand is a real narrow space's, and the server takes it", () => {
    const s = towing(corridor(), "ogre", { size: "large", x: 0, y: 5 });
    const op = into(s);
    const after = served(s, op);
    const ogre = after.tokens.ogre!;
    assert.deepEqual([ogre.x, ogre.y], [8.5, 5.5]);
    assert.equal(offGridWallThrough(after, walkEnd(after, ownWalk({ ...ogre, x: 7, y: 5.5 }), ogre)), false, "off its grid, but in a narrow space it could squeeze through");
  });

  test("a goblin that cannot walk onto the horse's line refuses the player's move with the walls' words", () => {
    const s = towing(corridor(), "gob", { x: 1, y: 4 });
    // A stub across its way down onto the horse's line, clear of the horse's core.
    wall(s, "fu45bf000009", [2.25, 5.625], [2.625, 5.25]);
    const op = into(s);
    const refused = canApply(op, P1, s, { canUseAsset: () => true });
    assert.deepEqual(refused, { ok: false, code: "forbidden", message: "A wall is in the way." });
    assert.ok(canApply(op, { memberId: "dm1", role: "dm" }, s, { canUseAsset: () => true }).ok, "the DM's move meets no walls");
  });

  test("a trap that stops the walk at the corridor's mouth stops what it drags with it, by the rule the stopped walk's own end gives", () => {
    const s = towing(corridor(), "gob", { x: 1, y: 6 });
    s.traps.t1 = trap("t1", { zone: { cells: [{ x: 4, y: 5, w: 1, h: 2 }] }, rig: { on: ["enter"], who: "any", floor: true, resets: "never", stops: true, foundOnSpring: true, hits: "trigger", actions: [], find: [], notice: false } });
    const op = into(s);
    const after = served(s, op);
    // The stop stands it squeezed at the mouth, so the goblin is right behind it there, as on a walk that ends there.
    assert.deepEqual([after.tokens.horse!.x, after.tokens.horse!.y, after.tokens.horse!.squeeze], [4.5, 5.5, true]);
    assert.deepEqual([after.tokens.gob!.x, after.tokens.gob!.y], [4, 6]);
    assert.equal(after.traps.t1!.state, "sprung");
  });
});
