import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { keys, wallChunk } from "../keys.ts";
import type { RoomState, Token, WallFeature } from "../model.ts";
import { projectEntityForOp, projectStateForOp, type ProjectedToken } from "../project.ts";
import type { Op } from "../protocol.ts";
import { applyOp } from "../reducer.ts";
import { occupiedHexes, placedOnHex, storedCenter } from "../rules/footprint.ts";
import { hexKey, hexSubcells, type HexGrid } from "../rules/hex.ts";
import { onHex, ROWS } from "../rules/hexWalls.testkit.ts";
import { clipFootprint, sightClipOf } from "../rules/vision.ts";
import { sceneWalls } from "../rules/walls.ts";
import { liftSubs, wall } from "../discoveryTestutil.ts";
import { AT, P1, actor, member, room, scene, trap } from "../testutil.ts";

/**
 * A trap step's undo mark for an op stored before op version 37
 * (FU43P2-SEENALL-OLD): the projection the reducer compares
 * (reducer.ts playerSeesChange) is the one the op was applied under, and
 * that one carried no `seenAll` mark. A silent trap that only changes who
 * every player sees therefore marks no step below 37, as it marked none
 * when the op was written, and still marks one from 37, where devices read
 * the mark.
 */

const q = (v: number) => Math.round(v * 64) / 64;
const CLOSED: WallFeature = { kind: "door", state: "closed", secret: false, discovered: false };

/** A Huge ogre on a per-player hex fog scene, p1 seeing for themselves, a closed door through its middle, the hexes the door cuts off from its middle lifted for p1 and one of them for the shared map, and hex 10, 7 lifted for p1. */
function doorRoom(g: HexGrid): RoomState {
  const state = room({
    members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2"), p3: member("p3") },
    scenes: { s1: scene("s1", { gridShape: "hexRows", bounds: { w: 20, h: 16 }, autoWalls: "off", fogEnabled: true, vision: { on: false, light: "bright", perPlayer: true } }) },
  });
  state.holders = { s1: { sceneId: "s1", rev: 1, entries: [{ memberId: "p1", on: true }] } };
  const at = { col: 9, row: 7 };
  const ogre: Token = onHex(g, "ogre", "huge", at, { name: "Ogre", kind: "npc", hpVisibility: "label", actor: { inline: actor({ hp: { cur: 40, max: 40, temp: 0 } }) } });
  const c = storedCenter(ogre);
  wall(state, "midwall00001", [q(c.x - 0.25), q(c.y)], [q(c.x + 0.25), q(c.y)], CLOSED);
  const kept = new Set(clipFootprint(g, ogre, sightClipOf(sceneWalls(state.scenes.s1!, state.buildChunks))).kept.map((sub) => sub.join(",")));
  const cut = occupiedHexes(g, ogre).filter((h) => hexKey(h) !== hexKey(at) && hexSubcells(g, h).every((sub) => !kept.has(sub.join(","))));
  assert.ok(cut.length > 0, "the closed door cuts some of its hexes off");
  liftSubs(state, { holder: "p1" }, [...cut.flatMap((h) => hexSubcells(g, h)), ...hexSubcells(g, { col: 10, row: 7 })]);
  liftSubs(state, "dm", hexSubcells(g, cut[0]!));
  state.tokens.ogre = ogre;
  state.tokens.pc = onHex(g, "pc", "medium", { col: 3, row: 2 }, { name: "Thorn", kind: "pc", ownerIds: ["p1"] });
  const { cx, cy } = wallChunk({ a: [q(c.x - 0.25), q(c.y)], b: [q(c.x + 0.25), q(c.y)] });
  state.traps.t1 = trap("t1", { zone: { cells: [{ x: 2, y: 2, w: 1, h: 1 }] }, rig: { on: ["enter"], who: "any", floor: true, resets: "never", stops: false, foundOnSpring: false, hits: "trigger", actions: [{ door: { cx, cy, id: "midwall00001" }, state: "open" }], find: [], notice: false } });
  return state;
}

describe("a silent trap that changes only who every player sees, on a per-player hex scene", () => {
  const g = ROWS;
  const state = doorRoom(g);
  const to = placedOnHex(g, state.tokens.pc!, { col: 2, row: 2 });
  const move: Op = { t: "token.move", tokenId: "pc", x: to.x, y: to.y };

  test("the trap opens the door, which the shared copy of the walls does not hold, so from op version 37 nothing p1 is sent moves", () => {
    const r = applyOp(state, move, P1, { seq: 5, at: AT, opVersion: 37 });
    assert.ok(r.ok);
    const door = Object.values(r.state.buildChunks).flatMap((c) => c.walls ?? []).find((w) => w.id === "midwall00001");
    assert.deepEqual(door?.f, { ...CLOSED, state: "open" }, "the trap went off");
    assert.equal(r.trapped, undefined);
  });

  test("below op version 37 the reducer's projection carries no mark, so the step is no trapped one, as it was when it was written", () => {
    for (const opVersion of [34, 35, 36]) {
      const r = applyOp(state, move, P1, { seq: 5, at: AT, opVersion });
      assert.ok(r.ok, `op version ${opVersion}`);
      assert.equal(r.trapped, undefined, `op version ${opVersion}`);
      const projected = projectStateForOp(r.state, P1, { sceneId: null }, { opVersion });
      assert.ok(Object.values(projected.tokens).every((t) => t.seenAll === undefined), `op version ${opVersion}: no token carries the mark`);
    }
  });

  test("a token's own projection for an op takes the mark from op version 37 only, as a correction's copies compare it (undoCorrection.ts)", () => {
    // With the door open the build's walls no longer cut the ogre off, which is what an op below 37 reads.
    const opened = applyOp(state, move, P1, { seq: 5, at: AT, opVersion: 36 });
    assert.ok(opened.ok);
    for (const opVersion of [36, 37]) {
      const ogre = projectEntityForOp(keys.token("ogre"), opened.state, P1, { sceneId: null }, { opVersion }) as ProjectedToken | null;
      assert.ok(ogre, `op version ${opVersion}: p1 holds the ogre`);
      assert.equal(ogre.seenAll, opVersion >= 37 ? true : undefined, `op version ${opVersion}`);
    }
  });
});
