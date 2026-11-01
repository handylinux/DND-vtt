import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { chunkKey } from "./keys.ts";
import { autoAt, fogRoom, lift, stairs, wall } from "./discoveryTestutil.ts";
import type { BuildChunk, PlayerChunk, RoomState } from "./model.ts";
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
 * its last answer takes that answer's pieces, and its edges and stair
 * marks are read once whatever else the room did. Each case also checks
 * the answer against a room that shares no object with it.
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
      assert.equal(stableStringify(before), cold(state, 0, 0), `after a paint at ${cell}, against a fresh room`);
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

  test("a position's edges are read again only where its own, west or north chunk changed, whatever else the collection did", () => {
    const start = revealed();
    const painted = apply(start, { t: "build.paint", sceneId: "s1", terrain: "stone", cells: ["3,3", "4,3", "3,4"] }, 10);
    one(painted, 0, 0);
    // A build edit far off replaces the collection. The position then misses its answer by its ground alone.
    const far = apply(painted, { t: "build.paint", sceneId: "s1", terrain: "stone", cells: ["40,40"] }, 11);
    const hidden = { ...far, fogTiles: { ...far.fogTiles } };
    lift(hidden, "dm", { x: 10, y: 10, w: 1, h: 1 }, "s1", false);
    let reads = 0;
    const counted = new Proxy(hidden.buildChunks, {
      get(target, prop, receiver) {
        if (typeof prop === "string") reads++;
        return Reflect.get(target, prop, receiver);
      },
    });
    const answer = one({ ...hidden, buildChunks: counted }, 0, 0);
    assert.equal(stableStringify(answer), cold(hidden, 0, 0));
    // Each of the 512 edges reads its chunk and the cells either side when worked out again: kept, the edges read none of them.
    assert.ok(reads < 200, `${reads} reads of the chunks`);
  });

  test("a position's stair marks are read once for every fog class", () => {
    const state = fogRoom({ vision: true, perPlayer: true, bounds: { w: 48, h: 48 } });
    state.holders.s1 = { sceneId: "s1", rev: 0, entries: [{ memberId: "p1", on: true }, { memberId: "p2", on: true }] };
    lift(state, "dm", { x: 0, y: 0, w: 48, h: 48 });
    lift(state, { holder: "p1" }, { x: 0, y: 0, w: 8, h: 8 });
    lift(state, { holder: "p2" }, { x: 8, y: 8, w: 8, h: 8 });
    stairs(state, [[4, 4], [5, 4]], "e");
    const key = chunkKey("s1", 0, 0);
    let reads = 0;
    const chunk = new Proxy(state.buildChunks[key]!, {
      get(target, prop, receiver) {
        if (prop === "up") reads++;
        return Reflect.get(target, prop, receiver);
      },
    }) as BuildChunk;
    const counted = { ...state, buildChunks: { ...state.buildChunks, [key]: chunk } };
    const p1 = one(counted, 0, 0, "p1");
    reads = 0;
    const p2 = one(counted, 0, 0, "p2");
    assert.equal(reads, 0, "the second class reads the marks the first did");
    assert.equal(stableStringify(p1), cold(state, 0, 0, "p1"));
    assert.equal(stableStringify(p2), cold(state, 0, 0, "p2"));
  });
});
