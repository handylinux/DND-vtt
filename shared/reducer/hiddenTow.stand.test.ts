import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { wall } from "../discoveryTestutil.ts";
import { hiddenTowStands } from "../migrate.ts";
import type { RoomState } from "../model.ts";
import { canApply } from "../permissions.ts";
import { projectState, stableStringify } from "../project.ts";
import type { Op } from "../protocol.ts";
import { applyOp } from "../reducer.ts";
import { offGridWallThrough, ownWalk, walkEnd } from "../rules/movement.ts";
import { trapLandings } from "../rules/traps.ts";
import { DM, env, member, P1, P2, room, scene, token, trap } from "../testutil.ts";

/**
 * A creature some player cannot see, dragged along on a player's move
 * where walls stop moves, stands where the move leaves it only where no
 * wall passes through its box off its grid (D-261101-274, op version 38),
 * as the server's permission rule judges one every player sees
 * (permissions.ts draggedWalls). It steps back along its last piece to the
 * last spot it may stand on. It walks in the private pass, so nothing of it
 * may reach a player: every player's copy after the move, its log and its
 * undo mark are the same at 37 and 38, and the same as with no creature
 * there at all.
 */

/** Pat's fighter at 16, 13 drags a Large brute half a square off the grid, below it, toward a wall at x 21 from y 14 to 16. */
function hall(hidden: boolean, brute = true): RoomState {
  const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds: { w: 30, h: 20 }, blockMovement: true, autoWalls: "off" }) } });
  s.buildChunks = {};
  wall(s, "fu45bh000000", [21, 14], [21, 16]);
  s.tokens.pc = token("pc", { x: 16, y: 13, name: "Pc", kind: "pc", ownerIds: ["p1"] });
  if (brute) s.tokens.brute = token("brute", { size: "large", x: 16.5, y: 14, name: "Brute", kind: "npc", ownerIds: [], attached: { to: "pc", kind: "drag" }, ...(hidden ? { visibility: "dm" as const } : {}) });
  return s;
}

const east: Op = { t: "token.move", tokenId: "pc", x: 20, y: 13 };

function after(s: RoomState, op: Op, opVersion: number | undefined, who = P1) {
  const r = applyOp(s, op, who, { ...env(5), ...(opVersion !== undefined ? { opVersion } : {}) });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r;
}

describe("a hidden creature in tow stands where no wall passes through its box (D-261101-274)", () => {
  test("its leg stops it with the wall through its box, so from op version 38 it steps back to the last spot it may stand on", () => {
    const s = hall(true);
    assert.ok(canApply(east, P1, s, { canUseAsset: () => true }).ok, "the server takes the fighter's move, which reads nothing of the brute");
    const old = after(s, east, 37).state.tokens.brute!;
    assert.deepEqual([old.x, old.y], [19.5, 14], "at 37 its leg's last clear spot");
    assert.ok(offGridWallThrough(s, walkEnd(s, ownWalk({ ...old, x: 16.5 }), old)), "across the wall there");
    const now = after(s, east, undefined).state.tokens.brute!;
    assert.deepEqual([now.x, now.y, now.attached?.to], [18.5, 14, "pc"], "a square back, clear of the wall, still in tow");
    assert.equal(offGridWallThrough(s, walkEnd(s, ownWalk({ ...now, x: 16.5 }), now)), false);
    assert.deepEqual([hiddenTowStands(37), hiddenTowStands(38), hiddenTowStands(undefined)], [false, true, true]);
  });

  test("one players see is judged by the permission rule instead: the move that would leave it across the wall is refused", () => {
    const s = hall(false);
    assert.deepEqual(canApply(east, P1, s, { canUseAsset: () => true }), { ok: false, code: "forbidden", message: "A wall is in the way." });
  });

  test("the DM's move meets no walls, so it is not judged", () => {
    const s = hall(true);
    const dm: Op = { ...east, x: 20 };
    assert.deepEqual([after(s, dm, 37, DM).state.tokens.brute!.x, after(s, dm, undefined, DM).state.tokens.brute!.x], [20.5, 20.5]);
  });

  test("no player is sent anything of it: each copy, the log and the undo mark are the same at 37 and 38, and as with no brute", () => {
    const s = hall(true);
    const none = hall(true, false);
    const at37 = after(s, east, 37);
    const at38 = after(s, east, undefined);
    const alone = after(none, east, undefined);
    for (const who of [P1, P2]) {
      const copy = (r: typeof at37) => stableStringify(projectState(r.state, who, { sceneId: "s1" }));
      assert.equal(copy(at38), copy(at37), `${who.memberId}: 38 against 37`);
      assert.equal(copy(at38), copy(alone), `${who.memberId}: against no brute`);
    }
    assert.deepEqual([at38.trapped, at38.log.length], [at37.trapped, at37.log.length]);
    assert.deepEqual([at38.state.tokens.pc!.x, at38.state.tokens.pc!.y], [alone.state.tokens.pc!.x, alone.state.tokens.pc!.y], "the fighter lands where it lands alone");
  });

  test("a group move's walk is judged alike", () => {
    const s = hall(true);
    const many: Op = { t: "token.moveMany", moves: [{ tokenId: "pc", x: 20, y: 13 }] };
    assert.deepEqual([after(s, many, 37).state.tokens.brute!.x, after(s, many, undefined).state.tokens.brute!.x], [19.5, 18.5]);
  });

  test("a get-off is not judged (D-261101-277): the device that sends it does not predict the stand yet", () => {
    const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds: { w: 30, h: 20 }, blockMovement: true, autoWalls: "off" }) } });
    s.buildChunks = {};
    wall(s, "fu45bh000001", [18, 9], [18, 11]);
    s.tokens.horse = token("horse", { size: "large", x: 14, y: 12, name: "Warhorse", kind: "npc", ownerIds: ["p1"] });
    s.tokens.pc = token("pc", { x: 14, y: 12, name: "Pc", kind: "pc", ownerIds: ["p1"], attached: { to: "horse", kind: "ride" } });
    s.tokens.brute = token("brute", { size: "large", x: 14.5, y: 10, name: "Brute", kind: "npc", ownerIds: [], visibility: "dm", attached: { to: "pc", kind: "drag" } });
    const off: Op = { t: "token.detach", tokenId: "pc", x: 16, y: 11 };
    const brute = after(s, off, undefined).state.tokens.brute!;
    assert.deepEqual([brute.x, brute.y], [16.5, 9], "where the get-off's walk leaves it");
    assert.ok(offGridWallThrough(s, walkEnd(s, ownWalk({ ...brute, x: 14.5, y: 10 }), brute)), "across the wall, as at op version 37");
  });

  test("on a group move a trap cuts elsewhere, one every player sees that a hidden creature drags still takes the stand test, as its group no stop judged (review FU45BR-OPUS-12)", () => {
    const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds: { w: 30, h: 20 }, blockMovement: true, autoWalls: "off" }) } });
    s.buildChunks = {};
    wall(s, "fu45bh000002", [21, 14], [21, 16]);
    // Pat's fighter drags a hidden rat, which drags the brute every player sees, half a square off the grid toward the wall.
    s.tokens.pc = token("pc", { x: 16, y: 13, name: "Pc", kind: "pc", ownerIds: ["p1"] });
    s.tokens.rat = token("rat", { x: 15.5, y: 14, name: "Rat", kind: "npc", ownerIds: [], visibility: "dm", attached: { to: "pc", kind: "drag" } });
    s.tokens.brute = token("brute", { size: "large", x: 16.5, y: 14, name: "Brute", kind: "npc", ownerIds: [], attached: { to: "rat", kind: "drag" } });
    // Pat's second fighter walks into a trap that stops it, far from them.
    s.tokens.pc2 = token("pc2", { x: 2, y: 2, name: "Pc2", kind: "pc", ownerIds: ["p1"] });
    s.traps.t1 = trap("t1", { zone: { cells: [{ x: 5, y: 2, w: 1, h: 1 }] } });
    const many: Op = { t: "token.moveMany", moves: [{ tokenId: "pc", x: 20, y: 13 }, { tokenId: "pc2", x: 8, y: 2 }] };
    assert.ok(canApply(many, P1, s, { canUseAsset: () => true }).ok);
    const r = after(s, many, undefined);
    assert.ok(r.state.tokens.pc2!.x < 8, "the trap stops the second fighter");
    const brute = r.state.tokens.brute!;
    assert.deepEqual([brute.x, brute.y], [18.5, 14], "a step back, as with no trap");
    assert.equal(offGridWallThrough(r.state, walkEnd(r.state, ownWalk({ ...brute, x: 16.5 }), brute)), false, "clear of the wall");
  });

  test("where a trap stops its group, one every player sees that a hidden creature drags lands where the stop judged it stands, not by its holder's cut and its place (review FU45B-ASTRA-10)", () => {
    const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds: { w: 30, h: 20 }, blockMovement: true, autoWalls: "off" }) } });
    s.buildChunks = {};
    wall(s, "fu45bh000003", [21, 14], [21, 16]);
    // Pat's fighter drags a hidden rat, which drags the brute every player sees, half a square off the grid toward the wall.
    s.tokens.pc = token("pc", { x: 16, y: 13, name: "Pc", kind: "pc", ownerIds: ["p1"] });
    s.tokens.rat = token("rat", { x: 15.5, y: 14, name: "Rat", kind: "npc", ownerIds: [], visibility: "dm", attached: { to: "pc", kind: "drag" } });
    s.tokens.brute = token("brute", { size: "large", x: 16.5, y: 14, name: "Brute", kind: "npc", ownerIds: [], attached: { to: "rat", kind: "drag" } });
    s.tokens.pc2 = token("pc2", { x: 2, y: 2, name: "Pc2", kind: "pc", ownerIds: ["p1"] });
    // A trap on the fighter's way that stops it on its square.
    s.traps.t2 = trap("t2", { zone: { cells: [{ x: 19, y: 13, w: 1, h: 1 }] } });
    const ops: Op[] = [
      { t: "token.move", tokenId: "pc", x: 21, y: 13 },
      { t: "token.moveMany", moves: [{ tokenId: "pc", x: 21, y: 13 }, { tokenId: "pc2", x: 8, y: 2 }] },
    ];
    for (const op of ops) {
      assert.ok(canApply(op, P1, s, { canUseAsset: () => true }).ok, op.t);
      const r = after(s, op, undefined);
      assert.deepEqual([r.state.tokens.pc!.x, r.state.tokens.pc!.y], [19, 13], `${op.t}: the trap stops the fighter`);
      const brute = r.state.tokens.brute!;
      assert.deepEqual([brute.x, brute.y], [17.5, 14], `${op.t}: where the trap step had it at the stop`);
      assert.equal(offGridWallThrough(r.state, walkEnd(r.state, ownWalk({ ...brute, x: 16.5 }), brute)), false, `${op.t}: clear of the wall`);
    }
  });

  test("where a trap stops its group, one every player sees carried by a creature they cannot see lands where the stop judged it, still carried, and what it drags stays in reach (review FU45B-ASTRA-11)", () => {
    const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds: { w: 30, h: 20 }, blockMovement: true, autoWalls: "off" }) } });
    s.buildChunks = {};
    wall(s, "fu45bh000005", [21, 14], [21, 16]);
    // Pat's fighter drags a hidden imp, which carries an owl every player sees, which drags a rat every player sees.
    s.tokens.pc = token("pc", { x: 16, y: 13, name: "Pc", kind: "pc", ownerIds: ["p1"] });
    s.tokens.imp = token("imp", { x: 16, y: 14, name: "Imp", kind: "npc", ownerIds: [], visibility: "dm", attached: { to: "pc", kind: "drag" } });
    s.tokens.owl = token("owl", { size: "tiny", x: 16, y: 14, name: "Owl", kind: "npc", ownerIds: [], attached: { to: "imp", kind: "carry" } });
    s.tokens.rat = token("rat", { x: 15, y: 14, name: "Rat", kind: "npc", ownerIds: [], attached: { to: "owl", kind: "drag" } });
    s.tokens.pc2 = token("pc2", { x: 2, y: 2, name: "Pc2", kind: "pc", ownerIds: ["p1"] });
    s.traps.t4 = trap("t4", { zone: { cells: [{ x: 19, y: 13, w: 1, h: 1 }] } });
    const ops: Op[] = [
      { t: "token.move", tokenId: "pc", x: 22, y: 13 },
      { t: "token.moveMany", moves: [{ tokenId: "pc", x: 22, y: 13 }, { tokenId: "pc2", x: 4, y: 2 }] },
    ];
    for (const op of ops) {
      assert.ok(canApply(op, P1, s, { canUseAsset: () => true }).ok, op.t);
      const r = after(s, op, undefined);
      const at = (id: string) => [r.state.tokens[id]!.x, r.state.tokens[id]!.y, r.state.tokens[id]!.attached?.to ?? null];
      assert.deepEqual(at("pc"), [19, 13, null], `${op.t}: the trap stops the fighter`);
      // The imp walks on at the owl's step, so the owl is still on it where the stop judged the owl, and the rat in its reach.
      assert.deepEqual(at("imp"), [18, 14, "pc"], op.t);
      assert.deepEqual(at("owl"), [18, 14, "imp"], op.t);
      assert.deepEqual(at("rat"), [17, 14, "owl"], op.t);
      for (const [id, pose] of trapLandings(op, s, P1, {})) assert.deepEqual([r.state.tokens[id]!.x, r.state.tokens[id]!.y, r.state.tokens[id]!.elevation], [pose.x, pose.y, pose.elevation], `${op.t}: ${id} where the trap step left it`);
    }
  });

  test("a cut lands one every player sees on a hidden holder where the stop judged it, whatever unseen walls stop the holder: Pat's copies match with and without them (review FU45B-ASTRA-12)", () => {
    // A fogged corridor whose ground no player sees. Pat's Large horse drags a hidden imp carrying an owl, both horse and owl seen
    // through the fog, and squeezes toward the corridor's mouth over a net.
    const make = (walled: boolean) => {
      const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds: { w: 22, h: 12 }, blockMovement: true, autoWalls: "off", fogEnabled: true }) } });
      s.buildChunks = {};
      const runs: [[number, number], [number, number]][] = [[[6, 0], [6, 6]], [[6, 7], [6, 12]], [[14, 0], [14, 6]], [[14, 7], [14, 12]], [[6, 6], [14, 6]], [[6, 7], [14, 7]]];
      runs.forEach(([a, b], i) => wall(s, `fu45bc${String(i).padStart(6, "0")}`, a, b));
      // Two short walls beside the imp, on ground no player sees, which the walk itself never meets.
      if (walled) {
        wall(s, "fu45bc000010", [2.375, 7.25], [2.375, 7.5]);
        wall(s, "fu45bc000011", [2.5, 6.875], [2.5, 7.125]);
      }
      s.tokens.horse = token("horse", { size: "large", x: 2, y: 5, name: "Horse", kind: "pc", ownerIds: ["p1"], fogExempt: true });
      s.tokens.imp = token("imp", { x: 2, y: 7, name: "Imp", kind: "npc", ownerIds: [], visibility: "dm", attached: { to: "horse", kind: "drag" } });
      s.tokens.owl = token("owl", { size: "tiny", x: 2, y: 7, name: "Owl", kind: "npc", ownerIds: [], fogExempt: true, attached: { to: "imp", kind: "carry" } });
      s.traps.t5 = trap("t5", { zone: { cells: [{ x: 1, y: 6, w: 1, h: 2 }] } });
      return s;
    };
    const open = make(false);
    const closed = make(true);
    const op: Op = { t: "token.move", tokenId: "horse", x: 7.5, y: 5.5, squeeze: true, route: [[1, 5, 1, 0], [5, 5.5, 1, 0], [7.5, 5.5, 1, 0]] };
    const copy = (s: RoomState, who = P2) => stableStringify(projectState(s, who, { sceneId: "s1" }));
    assert.equal(copy(closed), copy(open), "the players' copies start the same");
    for (const s of [open, closed]) assert.ok(canApply(op, P1, s, { canUseAsset: () => true }).ok);
    const a = after(open, op, undefined);
    const b = after(closed, op, undefined);
    for (const r of [a, b]) assert.deepEqual([r.state.tokens.owl!.x, r.state.tokens.owl!.y], [1.5, 5.5], "where the stop judged it");
    for (const who of [P1, P2]) assert.equal(copy(b.state, who), copy(a.state, who), who.memberId);
    assert.equal(b.trapped, a.trapped);
  });

  test("on ground every player sees, a trap's stop stands a Large walker half a square off its grid only clear of the walls, as the move's own stand test does (review FU45B-ASTRA-10)", () => {
    const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds: { w: 30, h: 20 }, blockMovement: true, autoWalls: "off" }) } });
    s.buildChunks = {};
    wall(s, "fu45bh000004", [21, 14], [21, 16]);
    // Pat's Large ogre walks east up to the wall's end and turns north, a snare on the square its box first reaches past the wall.
    s.tokens.ogre = token("ogre", { size: "large", x: 16.5, y: 14, name: "Ogre", kind: "pc", ownerIds: ["p1"] });
    s.traps.t3 = trap("t3", { zone: { cells: [{ x: 21, y: 14, w: 1, h: 1 }] }, rig: { on: ["enter"], who: "any", floor: false, resets: "never", stops: true, foundOnSpring: true, hits: "trigger", actions: [], find: [], notice: false } });
    const op: Op = { t: "token.move", tokenId: "ogre", x: 19.5, y: 10, route: [[19.5, 14, 0, 0], [19.5, 10, 0, 0]] };
    assert.ok(canApply(op, P1, s, { canUseAsset: () => true }).ok);
    const landed = (opVersion: number | undefined) => {
      const r = applyOp(structuredClone(s), op, P1, { ...env(4), ...(opVersion !== undefined ? { opVersion } : {}) });
      assert.ok(r.ok);
      const ogre = r.state.tokens.ogre!;
      return [ogre.x, ogre.y, offGridWallThrough(r.state, walkEnd(r.state, ownWalk({ ...ogre, x: 16.5, y: 14 }), ogre))];
    };
    assert.deepEqual(landed(37), [19.5, 14, true], "at 37 the stop left it across the wall");
    assert.deepEqual(landed(undefined), [19.5, 12, false], "from 38 on at the first spot past it that stands clear");
  });
});
