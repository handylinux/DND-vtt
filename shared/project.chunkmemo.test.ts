import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { chunkKey } from "./keys.ts";
import { autoAt, fogRoom, lift, wall } from "./discoveryTestutil.ts";
import type { PlayerChunk, RoomState } from "./model.ts";
import { playerChunkBatch, stableStringify } from "./project.ts";
import type { Op } from "./protocol.ts";
import { applyOp } from "./reducer.ts";
import { DM, deepClone, env } from "./testutil.ts";

/**
 * What a player's chunk keeps across build edits (the per-player cost
 * pass, MD2-PERF-REST): a position reads its own chunk and memories and
 * the chunks west and north of it whole, and of the rest of its
 * neighborhood the free walls alone, so an edit beside it that leaves the
 * walls keeps its answer. A miss whose walls and ground read the same as
 * its last answer takes that answer's pieces. Each case also checks the
 * answer against a room that shares no object with it.
 */

function apply(state: RoomState, op: Op, seq: number): RoomState {
  const result = applyOp(state, op, DM, env(seq));
  assert.ok(result.ok, `${op.t} was refused`);
  return result.state;
}

function one(state: RoomState, cx: number, cy: number, view: string | null = null): PlayerChunk | null {
  return playerChunkBatch(state, "s1", [{ cx, cy }], view).get(chunkKey("s1", cx, cy)) ?? null;
}

function cold(state: RoomState, cx: number, cy: number, view: string | null = null): string {
  return stableStringify(one(deepClone(state), cx, cy, view));
}

function revealed(): RoomState {
  const state = fogRoom({ bounds: { w: 48, h: 48 } });
  lift(state, "dm", { x: 0, y: 0, w: 48, h: 48 });
  return state;
}

describe("a player's chunk across build edits beside it", () => {
  test("a floor edit south-east, south or east of a position keeps its answer, the very object", () => {
    let state = revealed();
    wall(state, "abcdefghijkl", [17, 3.5], [21, 3.5]);
    const before = one(state, 0, 0);
    assert.ok(before);
    // Chunks 1,1 and 0,1 and 1,0: none is the position's own or west or north of it, and the edits leave their free walls.
    for (const [k, cell] of ["20,20", "5,20", "20,5"].entries()) {
      state = apply(state, { t: "build.paint", sceneId: "s1", terrain: "stone", cells: [cell] }, 10 + k);
      assert.equal(one(state, 0, 0), before, `after a paint at ${cell}`);
    }
  });

  test("a floor edit west or north of a position reaches its automatic walls", () => {
    const start = revealed();
    one(start, 0, 1);
    one(start, 1, 0);
    // Cell 5,15 lies in chunk 0,0, north of position 0,1: the edge 5,16,n between it and the bare cell 5,16 walls itself.
    const north = apply(start, { t: "build.paint", sceneId: "s1", terrain: "stone", cells: ["5,15"] }, 10);
    const below = one(north, 0, 1);
    assert.equal(stableStringify(below), cold(north, 0, 1));
    assert.ok(autoAt(below ?? undefined, "5,16,n"), "the paint north of the position walls its north edge");
    // Cell 15,5 lies in chunk 0,0, west of position 1,0.
    const west = apply(start, { t: "build.paint", sceneId: "s1", terrain: "stone", cells: ["15,5"] }, 11);
    const beside = one(west, 1, 0);
    assert.equal(stableStringify(beside), cold(west, 1, 0));
    assert.ok(autoAt(beside ?? undefined, "16,5,w"), "the paint west of the position walls its west edge");
  });

  test("a floor edit in a position with free walls takes the pieces of its last answer", () => {
    let state = revealed();
    wall(state, "abcdefghijkl", [3, 5.5], [9, 5.5]);
    const before = one(state, 0, 0);
    assert.ok(before?.walls?.length);
    state = apply(state, { t: "build.paint", sceneId: "s1", terrain: "wood", cells: ["2,2"] }, 10);
    const after = one(state, 0, 0);
    assert.ok(after && after !== before, "the paint changes the position's answer");
    assert.equal(stableStringify(after), cold(state, 0, 0));
    assert.equal(after.walls?.length, before.walls.length);
    for (const [i, piece] of after.walls!.entries()) assert.equal(piece, before.walls[i], `piece ${i} is the last answer's`);
  });

  test("ground that changes under a free wall cuts its pieces again", () => {
    const state = revealed();
    wall(state, "abcdefghijkl", [3, 5.5], [9, 5.5]);
    const before = one(state, 0, 0);
    // Cell 6,5 hidden again: the wall is cut there, and nothing else the position reads changed but its ground.
    const hidden = { ...state, fogTiles: { ...state.fogTiles } };
    lift(hidden, "dm", { x: 6, y: 5, w: 1, h: 1 }, "s1", false);
    const after = one(hidden, 0, 0);
    assert.equal(stableStringify(after), cold(hidden, 0, 0));
    assert.notEqual(stableStringify(after?.walls), stableStringify(before?.walls), "the hidden cell cuts the wall");
  });
});
