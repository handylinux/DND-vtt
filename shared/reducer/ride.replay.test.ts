import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { RoomState, Token, Viewer } from "../model.ts";
import { hash128, stableStringify } from "../project.ts";
import type { Op } from "../protocol.ts";
import { applyOp } from "../reducer.ts";
import { wall } from "../discoveryTestutil.ts";
import { AT, DM, P1, chance, int, member, pick, rng, room, scene, token, trap } from "../testutil.ts";

/**
 * Stored op tails on square scenes where a mount squeezes into a corridor
 * with riders on it and creatures in tow, replayed (design 16.2): ops
 * stored at op version 37 must replay to the very states they made when
 * they were written, whatever op version 38 changed about what a squeezing
 * holder drags, where its riders sit and where a hidden creature it drags
 * stands. Each seed builds a hall with a corridor one or two squares wide
 * through rock, a Large or Huge mount with riders and dragged creatures,
 * some hidden from players and some half a square off the grid, now and
 * then fog and a stopping trap, then applies a run of the mount's moves,
 * squeezed into the corridor and out again, by its player and the DM. The
 * hash covers the whole state the run ends in. Write the fixture again
 * with REPLAY_TAILS=write only for a change meant to move them.
 */

const FIXTURE = new URL("./ride.replay.fixture.json", import.meta.url);
const TAILS = 200;
const VERSIONS = [37] as const;

type Tail = { state: RoomState; ops: { op: Op; who: Viewer }[] };

/** Rock from x 8 to 16 but for a corridor `wide` squares wide from row `top`, walled round in runs of at most 8 squares. */
function corridorRoom(r: () => number, wide: 1 | 2, top: number): RoomState {
  const state = room({
    members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") },
    scenes: { s1: scene("s1", { bounds: { w: 26, h: 18 }, blockMovement: chance(r, 0.85), autoWalls: "off", fogEnabled: chance(r, 0.3) }) },
  });
  state.buildChunks = {};
  const bottom = top + wide;
  const runs: [[number, number], [number, number]][] = [
    [[8, 0], [8, top]],
    [[8, bottom], [8, 18]],
    [[16, 0], [16, top]],
    [[16, bottom], [16, 18]],
    [[8, top], [16, top]],
    [[8, bottom], [16, bottom]],
  ];
  runs.forEach(([a, b], i) => {
    // Split a run past 8 squares into two, as the protocol takes a wall.
    const len = Math.abs(b[1] - a[1]) + Math.abs(b[0] - a[0]);
    if (len <= 8) wall(state, `ride${String(i).padStart(8, "0")}`, a, b);
    else {
      const m: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      wall(state, `ride${String(i).padStart(7, "0")}a`, a, m);
      wall(state, `ride${String(i).padStart(7, "0")}b`, m, b);
    }
  });
  return state;
}

function tail(seed: number): Tail {
  const r = rng(seed * 7919 + 13);
  const wide = pick(r, [1, 1, 2] as const);
  const top = int(r, 5, 9);
  const state = corridorRoom(r, wide, top);
  const size = wide === 1 ? "large" : pick(r, ["large", "huge", "huge"] as const);
  const side = size === "large" ? 2 : 3;
  const mx = int(r, 2, 4) + (chance(r, 0.2) ? 0.5 : 0);
  const my = top - (side === 2 ? int(r, 0, 1) : 1) + (chance(r, 0.2) ? 0.5 : 0);
  const mount: Token = token("mount", { size, x: mx, y: my, name: "Warhorse", kind: "npc", ownerIds: ["p1"] });
  state.tokens.mount = mount;
  // Riders on whole squares of the mount's footprint, some hidden from players.
  const riders = size === "huge" ? int(r, 0, 4) : int(r, 0, 1);
  const seats: [number, number][] = [];
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) seats.push([x, y]);
  for (let i = 0; i < riders; i++) {
    const [sx, sy] = seats.splice(int(r, 0, seats.length - 1), 1)[0]!;
    state.tokens[`rider${i}`] = token(`rider${i}`, {
      x: Math.floor(mx) + sx,
      y: Math.floor(my) + sy,
      name: `Rider ${i + 1}`,
      kind: i === 0 ? "pc" : "npc",
      ownerIds: i === 0 ? ["p1"] : [],
      attached: { to: "mount", kind: "ride", ...(i === 0 ? { steer: true } : {}) },
      ...(chance(r, 0.2) ? { visibility: "dm" as const } : {}),
    });
  }
  // Creatures in tow beside the mount, west or below it, some Large and half a square off, some hidden.
  const towed = int(r, 0, 3);
  for (let i = 0; i < towed; i++) {
    const big = chance(r, 0.3);
    const spot = pick(r, [
      [mx - (big ? 2 : 1), my + int(r, 0, side - 1)],
      [mx + int(r, 0, side - 1), my + side],
      [mx - (big ? 2 : 1) + 0.5, my + 0.5],
      [mx - 1, my - 1],
    ] as const);
    state.tokens[`tow${i}`] = token(`tow${i}`, {
      size: big ? "large" : "medium",
      x: spot[0],
      y: spot[1],
      name: `Goblin ${i + 1}`,
      kind: "npc",
      attached: { to: "mount", kind: "drag" },
      ...(chance(r, 0.35) ? { visibility: "dm" as const } : {}),
    });
  }
  // A creature a rider drags beside the mount.
  if (riders > 0 && chance(r, 0.3)) state.tokens.led = token("led", { x: mx - 1, y: my + side - 1, name: "Prisoner", kind: "npc", attached: { to: "rider0", kind: "drag" } });
  if (chance(r, 0.3)) {
    const tx = int(r, 5, 7);
    state.traps.t1 = trap("t1", { zone: { cells: [{ x: tx, y: top, w: 1, h: wide }] }, rig: { on: ["enter"], who: "any", floor: true, resets: "nextTurn", stops: true, foundOnSpring: false, hits: "trigger", actions: [], find: [], notice: false } });
  }
  const ops: { op: Op; who: Viewer }[] = [];
  // Squeezed spots in the corridor (a squeezed footprint on whole squares), and full stands in the halls either side.
  const squeezedAt = (x: number) => (size === "large" ? { x: x + 0.5, y: top - 0.5 } : { x: x + 0.5, y: top - 0.5 });
  for (let i = int(r, 2, 5); i > 0; i--) {
    const who = chance(r, 0.7) ? P1 : DM;
    const kind = r();
    let op: Op;
    if (kind < 0.55) {
      const at = squeezedAt(int(r, 8, 13));
      const route: [number, number, number, 0 | 1][] | undefined = chance(r, 0.6) ? [[at.x - int(r, 2, 4), at.y, 0, 0], [at.x, at.y, 1, 0]] : undefined;
      op = { t: "token.move", tokenId: "mount", x: at.x, y: at.y, squeeze: true, ...(route ? { route } : {}) };
    } else if (kind < 0.8) {
      op = { t: "token.move", tokenId: "mount", x: pick(r, [17, 18, 19]), y: top - (side === 2 ? int(r, 0, 1) : 1) };
    } else {
      op = { t: "token.move", tokenId: "mount", x: int(r, 2, 5) + (chance(r, 0.3) ? 0.5 : 0), y: my + pick(r, [0, 0.5, 1]) };
    }
    ops.push({ op, who });
  }
  return { state, ops };
}

function replay(t: Tail, opVersion: number | undefined): string {
  let state = t.state;
  for (const [i, { op, who }] of t.ops.entries()) {
    const out = applyOp(state, op, who, { seq: 11 + i, at: AT, ...(opVersion !== undefined ? { opVersion } : {}) });
    if (out.ok) state = out.state;
  }
  return hash128(stableStringify(state));
}

describe("stored op tails of a mount squeezing into a corridor replay to the states they made", () => {
  test("op version 37, with riders, creatures in tow, hidden ones, fog and traps", () => {
    const tails = Array.from({ length: TAILS }, (_, seed) => tail(seed));
    const now = Object.fromEntries(VERSIONS.map((v) => [String(v), tails.map((t) => replay(t, v))]));
    if (process.env.REPLAY_TAILS === "write") writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`);
    const pinned = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, string[]>;
    for (const v of VERSIONS) {
      const differ = now[String(v)]!.flatMap((h, i) => (h !== pinned[String(v)]![i] ? [i] : []));
      assert.deepEqual(differ, [], `op version ${v}: these tails replay to other states`);
    }
  });

  test("the same tails as live ops end otherwise in many, so the pinned states test what the rules of op version 38 change", () => {
    const tails = Array.from({ length: TAILS }, (_, seed) => tail(seed));
    const moved = tails.filter((t) => replay(t, 37) !== replay(t, undefined)).length;
    assert.ok(moved >= 100, `${moved} of ${TAILS} tails end otherwise`);
  });
});
