import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { discoveryOp, discoveryState, remember } from "./discoveryTestutil.ts";
import { CHUNK_CELLS, type PlayerChunk, type RememberedWall, type RoomState, type Viewer } from "./model.ts";
import { exploreFor, playersOf, withCellVision } from "./perPlayerTestutil.ts";
import { chunkPositions, playerChunkBatch, stableStringify } from "./project.ts";
import { opSchema } from "./protocol.ts";
import { applyOp } from "./reducer.ts";
import { fogClassOf } from "./rules/held.ts";
import { DM, chance, deepClone, env, int, pick, rng } from "./testutil.ts";

/**
 * The fan-out's batch of players' chunks against a room that shares no
 * object with it, so nothing it projects comes from a kept answer: random
 * rooms under random ops by the DM and players, each with its explore
 * step, and now and then a layer's memory of free walls written beside
 * them. After every batch each fog class asks a random set of positions,
 * and each answer must be the bytes the copy gives. The answers kept by
 * a position's own chunk and the free walls alone of the rest of its
 * neighborhood (memoKey), and the pieces a miss takes from its last
 * answer when its walls and ground read the same (recallPieces), are the
 * kept answers this checks.
 */

type Counts = { asked: number; reused: number; kept: number };

function remembered(r: () => number, state: RoomState): RoomState {
  const scene = state.scenes.s1;
  if (!scene) return state;
  const out = { ...state };
  const cx = int(r, 0, Math.max(0, Math.ceil(scene.bounds.w / CHUNK_CELLS) - 1));
  const cy = int(r, 0, Math.max(0, Math.ceil(scene.bounds.h / CHUNK_CELLS) - 1));
  const holders = playersOf(state).map((v) => v.memberId);
  const layer = holders.length > 0 && chance(r, 0.5) ? pick(r, holders) : null;
  const x = cx * CHUNK_CELLS + int(r, 1, CHUNK_CELLS - 3);
  const y = cy * CHUNK_CELLS + int(r, 1, CHUNK_CELLS - 2);
  const version: RememberedWall = { wall: { id: "remembered00", a: [x, y + 0.5], b: [x + 2, y + 0.5], f: { kind: "wall" } }, cells: [`${x},${y}`, `${x + 1},${y}`] };
  remember(out, layer, cx, cy, { walls: { remembered00: [version] } });
  return out;
}

function check(state: RoomState, r: () => number, last: Map<string, PlayerChunk | null>, counts: Counts, where: string): void {
  let copy: RoomState | undefined;
  for (const scene of Object.values(state.scenes)) {
    if (!scene.fogEnabled) continue;
    const views: (string | null)[] = [null, ...playersOf(state).map((v: Viewer) => fogClassOf(state, scene.id, v.memberId))];
    for (const view of new Set(views)) {
      const positions = chunkPositions(scene).filter(() => chance(r, 0.7));
      const warm = playerChunkBatch(state, scene.id, positions, view);
      const cold = playerChunkBatch((copy ??= deepClone(state)), scene.id, positions, view);
      for (const [key, chunk] of warm) {
        counts.asked++;
        assert.equal(stableStringify(chunk), stableStringify(cold.get(key) ?? null), `${where}: ${view ?? "shared"} at ${key} gets a kept answer a fresh room does not give`);
        const slot = `${view}|${key}`;
        const before = last.get(slot);
        if (chunk !== null && before !== undefined && before !== null) {
          if (chunk === before) counts.kept++;
          else if (chunk.walls?.some((w) => before.walls?.includes(w))) counts.reused++;
        }
        last.set(slot, chunk);
      }
    }
  }
}

function run(seed: number, steps: number, counts: Counts): void {
  const r = rng(seed * 7919);
  let state = discoveryState(r);
  const last = new Map<string, PlayerChunk | null>();
  check(state, r, last, counts, `seed ${seed} start`);
  for (let i = 0; i < steps; i++) {
    const players = playersOf(state);
    const who: Viewer = i % 4 === 3 && players.length > 0 ? pick(r, players) : DM;
    const where = `seed ${seed} op ${i}`;
    if (chance(r, 0.15)) state = remembered(r, state);
    else {
      const parsed = opSchema.safeParse(discoveryOp(r, state, who));
      if (!parsed.success) continue;
      const result = applyOp(state, parsed.data, who, env(100 + 2 * i));
      if (!result.ok) continue;
      state = result.state;
      const explore = exploreFor(state);
      if (explore) {
        const explored = applyOp(state, opSchema.parse(explore), DM, env(101 + 2 * i));
        assert.ok(explored.ok, `${where}: the explore step was refused`);
        state = explored.state;
      }
    }
    check(state, r, last, counts, where);
  }
}

describe("players' chunks in a fan-out's batch", () => {
  test("every class's answers, kept or taking their last pieces, are a fresh room's bytes", () => {
    withCellVision(() => {
      const counts: Counts = { asked: 0, reused: 0, kept: 0 };
      for (let seed = 1; seed <= 30; seed++) run(seed, 30, counts);
      // The batch has to have kept answers and taken pieces again often enough for the bytes above to say something.
      assert.ok(counts.asked > 5_000 && counts.kept > 500 && counts.reused > 50, JSON.stringify(counts));
    });
  });
});
