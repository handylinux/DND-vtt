import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { heights, wall } from "#shared/discoveryTestutil.ts";
import type { RoomState, Token } from "#shared/model.ts";
import { canApply } from "#shared/permissions.ts";
import type { Op } from "#shared/protocol.ts";
import { applyOp } from "#shared/reducer.ts";
import { linkHolds } from "#shared/rules/attach.ts";
import { SQUARES } from "#shared/rules/grid.ts";
import { chance, env, int, member, P1, pick, rng, room, scene, token } from "#shared/testutil.ts";
import { copyFor } from "../attach/testing.ts";
import { dragOf } from "./dragTesting.ts";

/**
 * Random drags of a mount into a corridor on squares, for single file
 * (D-261101-250, D-261101-397, review FU45BR-OPUS-1 and FU45BR-OPUS-3): a
 * Large or Huge mount with riders, one to three creatures it drags, some
 * dragged by those in turn or led by a rider, over raised ground, dropped
 * in a corridor one or two squares wide. Every op the board sends is one
 * the server takes, the player's copy lands every token where the server
 * does, the preview holds the mount where it lands, and a walk that ends
 * squeezed keeps every link: one the file would leave out of its holder's
 * reach holds the drag instead. A rider's prisoner off a half-square seat
 * can let go on a full-size walk, as on main before single file, so links
 * are asserted on the squeezed walks this batch changed.
 */

function corridorRoom(wide: 1 | 2, top: number): RoomState {
  const state = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds: { w: 26, h: 18 }, blockMovement: true, autoWalls: "off" }) } });
  state.buildChunks = {};
  const bottom = top + wide;
  const runs: [[number, number], [number, number]][] = [[[8, 0], [8, top]], [[8, bottom], [8, 18]], [[16, 0], [16, top]], [[16, bottom], [16, 18]], [[8, top], [16, top]], [[8, bottom], [16, bottom]]];
  runs.forEach(([a, b], i) => wall(state, `fu45bz${String(i).padStart(6, "0")}`, a, b));
  return state;
}

/** A seed's room: the mount west of the corridor, its riders, what it drags and what those drag, on ground some of which is raised. */
function roomOf(seed: number): { state: RoomState; top: number } | null {
  const r = rng(seed * 104729 + 7);
  const wide = pick(r, [1, 1, 2] as const);
  const top = int(r, 5, 9);
  const state = corridorRoom(wide, top);
  const size = wide === 1 ? "large" : pick(r, ["large", "huge"] as const);
  const side = size === "large" ? 2 : 3;
  const mx = int(r, 1, 4) + (chance(r, 0.2) ? 0.5 : 0);
  const my = top - int(r, 0, side) + (chance(r, 0.2) ? 0.5 : 0);
  state.tokens.mount = token("mount", { size, x: mx, y: my, name: "Warhorse", kind: "npc", ownerIds: ["p1"] });
  const riders = size === "huge" ? int(r, 0, 3) : int(r, 0, 1);
  const seats: [number, number][] = [];
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) seats.push([x, y]);
  for (let i = 0; i < riders; i++) {
    const [sx, sy] = seats.splice(int(r, 0, seats.length - 1), 1)[0]!;
    state.tokens[`rider${i}`] = token(`rider${i}`, { x: Math.floor(mx) + sx, y: Math.floor(my) + sy, name: `Rider ${i}`, kind: "pc", ownerIds: ["p1"], attached: { to: "mount", kind: "ride", ...(i === 0 ? { steer: true } : {}) } });
  }
  const towed = int(r, 1, 3);
  for (let i = 0; i < towed; i++) {
    const big = chance(r, 0.2);
    const tiny = !big && chance(r, 0.15);
    const spot = pick(r, [
      [mx - (big ? 2 : 1), my + int(r, 0, side - 1)],
      [mx + int(r, 0, side - 1), my + side],
      [mx + int(r, 0, side - 1), my - (big ? 2 : 1)],
      [mx - 1, my - 1],
      [mx - 1, my + side],
    ] as const);
    // Some are dragged by the one before them, which the file lines up behind it.
    const by = i > 0 && chance(r, 0.3) ? `tow${i - 1}` : "mount";
    const extra: Partial<Token> = chance(r, 0.25) ? { elevation: 5 } : {};
    state.tokens[`tow${i}`] = token(`tow${i}`, { size: big ? "large" : tiny ? "tiny" : "medium", x: spot[0], y: spot[1], name: `Goblin ${i}`, kind: "npc", attached: { to: by, kind: "drag" }, ...extra });
  }
  if (riders > 0 && chance(r, 0.3)) state.tokens.led = token("led", { x: mx - 1, y: my + side - 1, name: "Prisoner", kind: "npc", attached: { to: "rider0", kind: "drag" } });
  // Raised ground west of the corridor, under the walks in and around them, some of it a low ledge.
  for (let k = int(r, 0, 2); k > 0; k--) heights(state, { x: int(r, 0, 7), y: int(r, top - 3, top + 3), w: int(r, 1, 4), h: int(r, 1, 2) }, pick(r, [2, 5, 10]));
  const holds = Object.values(state.tokens).every((t) => !t!.attached || linkHolds(SQUARES, state.meta.settings, t!.attached.kind, t!, state.tokens[t!.attached.to]!));
  return holds ? { state, top } : null;
}

describe("squares: random drags into a corridor with creatures in tow (D-261101-250, D-261101-397)", () => {
  test("what the board sends the server takes, lands alike on the player's copy, and a walk that ends squeezed keeps every link", () => {
    let squeezed = 0;
    let lined = 0;
    let named = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const made = roomOf(seed);
      if (!made) continue;
      const { state, top } = made;
      const r = rng(seed * 7919 + 3);
      const side = state.tokens.mount!.size === "large" ? 2 : 3;
      // The finger near the corridor's middle row, so the mount's box lands squeezed in it or holds at its mouth.
      const raw = { x: int(r, 9, 14) + r() * 0.9, y: top - (side - 1) / 2 - 0.5 + (r() - 0.5) * 0.8 };
      const copy = copyFor(state, P1);
      const drag = dragOf(copy, "player", "mount", raw);
      if (drag.plan.stop?.follower !== undefined) named++;
      if (!drag.op) continue;
      const op = drag.op as Op;
      const at = `seed ${seed}: ${JSON.stringify(op)}`;
      const allowed = canApply(op, P1, state, { canUseAsset: () => true });
      assert.ok(allowed.ok, `${at}: ${allowed.ok ? "" : allowed.message}`);
      const server = applyOp(state, op, P1, env(10));
      const device = applyOp(copy, op, P1, env(10));
      if (!server.ok || !device.ok) assert.fail(at);
      for (const id of Object.keys(copy.tokens)) {
        const a: Token = server.state.tokens[id]!;
        const b: Token = device.state.tokens[id]!;
        assert.deepEqual([b.x, b.y, b.elevation, b.attached?.to], [a.x, a.y, a.elevation, a.attached?.to], `${at}: ${id} on the player's copy`);
      }
      const landed = server.state.tokens.mount!;
      assert.deepEqual([drag.preview.to.x, drag.preview.to.y], [landed.x, landed.y], `${at}: the preview holds where it lands`);
      if (op.t !== "token.move" || op.squeeze !== true) continue;
      squeezed++;
      const inFile = Object.values(state.tokens).filter((t) => t!.attached?.kind === "drag").length;
      if (inFile >= 2) lined++;
      for (const t of Object.values(state.tokens)) if (t!.attached) assert.equal(server.state.tokens[t!.id]!.attached?.to, t!.attached.to, `${at}: ${t!.id} still held`);
    }
    // Enough of each kind that the rules above meet them: walks that end squeezed, with two or more in the file, and drags held for one.
    assert.ok(squeezed >= 85, `walks that end squeezed: ${squeezed}`);
    assert.ok(lined >= 22, `with two or more in the file: ${lined}`);
    assert.ok(named >= 105, `held, naming the one that cannot follow: ${named}`);
  });
});

