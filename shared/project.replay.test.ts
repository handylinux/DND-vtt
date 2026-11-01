import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, test } from "node:test";
import { wallChunk } from "./keys.ts";
import type { FreeWall, GridShape, RoomState, Token, Viewer } from "./model.ts";
import { hash128, stableStringify } from "./project.ts";
import type { Op } from "./protocol.ts";
import { applyOp } from "./reducer.ts";
import { wallSpans } from "./rules/held.ts";
import { hexCenter, hexNeighbors, hexSubcells, sceneHexes, HEX_R, type Hex, type HexGrid } from "./rules/hex.ts";
import { occupiedHexes, storedCenter } from "./rules/footprint.ts";
import { onHex, ROWS, COLUMNS } from "./rules/hexWalls.testkit.ts";
import { clearVisionCache } from "./rules/vision.ts";
import { liftSubs, remember, wall } from "./discoveryTestutil.ts";
import { AT, DM, actor, chance, int, member, pick, randomOp, rng, room, scene, trap } from "./testutil.ts";

/**
 * Stored op tails on hex scenes, replayed (docs/design/design-v1-hex-grids.md
 * section 10, determinism): ops stored at op versions 35 and 36 must replay
 * to the very states they made when they were written. Each seed builds a
 * hex rows or hex columns scene, whole party or per player with sight
 * holders, fog alone or vision, with free walls round large creatures,
 * explored and remembered ground and a stopping trap, then applies a run
 * of ops at that version: an encounter's start, moves, dice lines, turns,
 * explores, areas and the general random ops. The hash covers the
 * whole state the run ends in: its log ids, audiences, copies and marks.
 * Write the fixture again with REPLAY_TAILS=write only for a change meant
 * to move them.
 */

const FIXTURE = new URL("./project.replay.fixture.json", import.meta.url);
const TAILS = 200;
const VERSIONS = [35, 36] as const;
const PLAYERS = ["p1", "p2", "p3"] as const;
const q = (v: number) => Math.round(v * 64) / 64;

type Tail = { state: RoomState; ops: { op: Op; who: Viewer }[] };

/** The hexes within `reach` of a hex, the hex itself included. */
function around(g: HexGrid, h: Hex, reach: number): Hex[] {
  const out = new Map<string, Hex>([[`${h.col},${h.row}`, h]]);
  let ring = [h];
  for (let i = 0; i < reach; i++) {
    const next: Hex[] = [];
    for (const at of ring) for (const n of hexNeighbors(g, at)) if (!out.has(`${n.col},${n.row}`)) out.set(`${n.col},${n.row}`, n), next.push(n);
    ring = next;
  }
  return [...out.values()];
}

function tailRoom(r: () => number): { state: RoomState; g: HexGrid; spots: Hex[]; homes: Hex[] } {
  const shape: GridShape = chance(r, 0.5) ? "hexRows" : "hexColumns";
  const g = shape === "hexRows" ? ROWS : COLUMNS;
  const perPlayer = chance(r, 0.6);
  const vision = chance(r, 0.5);
  const bounds = { w: 20, h: 16 };
  const state = room({
    members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2"), p3: member("p3") },
    scenes: {
      s1: scene("s1", { gridShape: shape, bounds, autoWalls: "off", fogEnabled: true, blockMovement: chance(r, 0.5), vision: { on: vision, light: vision ? "dark" : "bright", ...(perPlayer ? { perPlayer: true as const } : {}) } }),
      s2: scene("s2", { order: 1 }),
    },
  });
  if (perPlayer) state.holders = { s1: { sceneId: "s1", rev: 1, entries: [{ memberId: "p1", on: true }, { memberId: "p2", on: true }] } };
  const all = sceneHexes(g, bounds).filter((h) => h.col >= 2 && h.row >= 2 && h.col <= 15 && h.row <= 12);
  const spots: Hex[] = [];
  const homes: Hex[] = [];
  const big = int(r, 1, 3);
  for (let i = 0; i < big; i++) {
    const at = pick(r, all);
    spots.push(at);
    homes.push(at);
    state.tokens[`m${i}`] = onHex(g, `m${i}`, pick(r, ["large", "huge", "gargantuan", "huge"] as const), at, { name: `Ogre ${i + 1}`, kind: "monster" });
  }
  const torch = () => (vision ? { light: { bright: 5 * int(r, 1, 4), dim: 5 * int(r, 0, 3) } } : {});
  for (const p of ["p1", "p2"] as const) {
    if (!chance(r, 0.85)) continue;
    const at = pick(r, all);
    spots.push(at);
    state.tokens[`pc${p}`] = onHex(g, `pc${p}`, chance(r, 0.2) ? "large" : "medium", at, { name: `Hero ${p}`, kind: "pc", disposition: "ally", ownerIds: [p], actor: { inline: actor({ senses: chance(r, 0.4) ? "darkvision 30 ft" : "" }) }, ...torch() });
  }
  if (vision && chance(r, 0.7)) state.tokens.lamp = onHex(g, "lamp", "medium", pick(r, all), { name: "Lamp", kind: "npc", disposition: "ally", partyVision: true, ...torch() });
  if (chance(r, 0.3)) state.tokens.crate = onHex(g, "crate", pick(r, ["large", "huge"] as const), pick(r, all), { name: "Crate", kind: "object", disposition: "neutral" });

  // Ground round the creatures, in the DM's, the party's and each holder's layers.
  const ring = spots.flatMap((h) => around(g, h, 2));
  const subsOf = (hs: readonly Hex[]) => hs.flatMap((h) => hexSubcells(g, h));
  liftSubs(state, "dm", subsOf(ring.filter(() => chance(r, 0.04))));
  liftSubs(state, "party", subsOf(ring.filter(() => chance(r, 0.07))));
  if (perPlayer) for (const p of ["p1", "p2"]) liftSubs(state, { holder: p }, subsOf(ring.filter(() => chance(r, 0.1))));

  // Free walls near and through the large creatures, some across their middles.
  let n = 0;
  const wallId = () => `rt${String(n++).padStart(10, "0")}`;
  for (const id of Object.keys(state.tokens).filter((k) => k.startsWith("m"))) {
    const t = state.tokens[id]!;
    const hexes = occupiedHexes(g, t);
    for (let i = int(r, 1, 4); i > 0; i--) {
      const c = hexCenter(g, pick(r, [...hexes, ...hexes.flatMap((h) => hexNeighbors(g, h))]));
      const ends: [[number, number], [number, number]] = chance(r, 0.4)
        ? [[q(c.x - HEX_R), q(c.y + (r() - 0.5) * 0.4)], [q(c.x + HEX_R), q(c.y + (r() - 0.5) * 0.4)]]
        : [[q(c.x + (r() - 0.5) * 2 * HEX_R), q(c.y + (r() - 0.5) * 2 * HEX_R)], [q(c.x + (r() - 0.5) * 2 * HEX_R), q(c.y + (r() - 0.5) * 2 * HEX_R)]];
      wall(state, wallId(), ends[0], ends[1], chance(r, 0.15) ? { kind: "window" } : { kind: "wall" });
    }
    // A wall across its middle, with ground on one side of it revealed in some layer and the middle in none.
    if (hexes.length >= 3 && chance(r, 0.9)) {
      const c = storedCenter(t);
      const turn = r() * Math.PI;
      const [dx, dy] = [Math.cos(turn), Math.sin(turn)];
      wall(state, wallId(), [q(c.x - 1.6 * dx), q(c.y - 1.6 * dy)], [q(c.x + 1.6 * dx), q(c.y + 1.6 * dy)]);
      const side = chance(r, 0.5) ? 1 : -1;
      const beyond = hexes.filter((h) => {
        const at = hexCenter(g, h);
        return side * ((at.x - c.x) * dy - (at.y - c.y) * dx) > 0.3;
      });
      const layer = perPlayer && chance(r, 0.4) ? { holder: pick(r, ["p1", "p2"]) } : pick(r, ["dm", "party"] as const);
      liftSubs(state, layer, subsOf(beyond.filter(() => chance(r, 0.7))));
    }
  }
  // Memory on a vision scene: a wall the DM removed that a layer remembers, or one the DM added that it remembers as absent.
  if (vision && chance(r, 0.6)) {
    const c = hexCenter(g, pick(r, ring));
    const w: FreeWall = { id: wallId(), a: [q(c.x + (r() - 0.5) * 2 * HEX_R), q(c.y - 0.6)], b: [q(c.x + (r() - 0.5) * 2 * HEX_R), q(c.y + 0.6)], f: { kind: "wall" } };
    const cells = wallSpans(g, w).map((span) => span.cell);
    const home = wallChunk(w);
    const layer = !perPlayer || chance(r, 0.6) ? null : pick(r, ["p1", "p2"]);
    if (chance(r, 0.5)) remember(state, layer, home.cx, home.cy, { walls: { [w.id]: [{ wall: w, cells }] } });
    else {
      wall(state, w.id, w.a, w.b);
      remember(state, layer, home.cx, home.cy, { walls: { [w.id]: [{ wall: null, cells }] } });
    }
  }

  // A stopping trap on a hex beside a creature.
  const at = pick(r, ring);
  state.traps.t1 = trap("t1", { zone: { cells: [{ x: at.col, y: at.row, w: 1, h: 1 }] }, rig: { on: ["enter"], who: "any", floor: true, resets: "nextTurn", stops: true, foundOnSpring: true, hits: "trigger", actions: [], find: [], notice: false } });
  return { state, g, homes, spots: around(g, pick(r, spots), 4).filter((h) => all.some((o) => o.col === h.col && o.row === h.row)) };
}

/**
 * One op of a tail: a move to a nearby hex or to where a large creature
 * first stood across its wall, a roll for a creature, a turn, an explore of
 * nearby ground, an area, or the general random op.
 */
function tailOp(r: () => number, state: RoomState, g: HexGrid, spots: readonly Hex[], homes: readonly Hex[]): { op: Op; who: Viewer } {
  const tokens = Object.values(state.tokens).filter((t): t is Token => t !== undefined && t.sceneId === "s1");
  const anyToken = () => (tokens.length > 0 ? pick(r, tokens) : undefined);
  const n = int(r, 0, 99);
  const t = anyToken();
  if (t && n < 35) {
    const to = onHex(g, t.id, t.size, pick(r, chance(r, 0.5) ? homes : spots));
    const owner = t.ownerIds[0];
    const who: Viewer = owner !== undefined && chance(r, 0.5) ? { memberId: owner, role: "player" } : DM;
    if (chance(r, 0.25)) {
      const other = anyToken()!;
      const to2 = onHex(g, other.id, other.size, pick(r, spots));
      return { op: { t: "token.moveMany", moves: [{ tokenId: t.id, x: to.x, y: to.y }, ...(other.id !== t.id ? [{ tokenId: other.id, x: to2.x, y: to2.y }] : [])] }, who: DM };
    }
    return { op: { t: "token.move", tokenId: t.id, x: to.x, y: to.y }, who };
  }
  if (t && n < 60) {
    return {
      op: { t: "sys.dice", asked: { t: "dice.roll", tag: `0192f0a8-6c1e-7a4b-9c3d-${String(int(r, 0, 999999999999)).padStart(12, "0")}`, to: pick(r, ["all", "dm"] as const), rolls: [{ formula: "1d20+2", label: "Attack", creature: { tokenId: t.id } }] }, batch: "AbCdEfGhIjKlMnOp", results: [{ formula: "1d20+2", faces: [int(r, 1, 20)], total: 0 }] },
      who: DM,
    };
  }
  if (n < 72) return { op: { t: "encounter.next" }, who: DM };
  if (n < 80) {
    const subs = spots.filter(() => chance(r, 0.3)).flatMap((h) => hexSubcells(g, h));
    const layer = state.holders.s1 && chance(r, 0.5) ? pick(r, ["p1", "p2"]) : null;
    const tiles = tilesOf(subs);
    if (tiles.length === 0) return { op: { t: "encounter.next" }, who: DM };
    return { op: layer === null ? { t: "sys.explore", sceneId: "s1", tiles } : { t: "sys.explore", sceneId: "s1", tiles: [], members: [{ memberId: layer, tiles }] }, who: DM };
  }
  if (t && n < 88) {
    const c = hexCenter(g, pick(r, spots));
    return {
      op: { t: "template.create", template: { id: `area${int(r, 0, 1e9)}`, sceneId: "s1", shape: "sphere", size: 10, origin: { x: c.x, y: c.y, z: 0 }, yaw: 0, includeOrigin: true, color: "#ff0000", ownerId: "dm1", visibility: "all", ...(chance(r, 0.6) ? { attachedTo: t.id } : {}) } },
      who: DM,
    };
  }
  const who: Viewer = chance(r, 0.7) ? DM : { memberId: pick(r, PLAYERS), role: "player" };
  return { op: randomOp(r, state, who), who };
}

/** Tiles setting exactly these sub-cells, in the explore op's shape. */
function tilesOf(subs: readonly (readonly [number, number])[]): { tx: number; ty: number; bits: string }[] {
  const probe = room({ scenes: { s1: scene("s1", { bounds: { w: 20, h: 16 } }) } });
  liftSubs(probe, "dm", subs);
  return Object.values(probe.fogTiles).map((tile) => ({ tx: tile.tx, ty: tile.ty, bits: tile.bits }));
}

function tail(seed: number): Tail {
  const r = rng(0x7a11 + seed);
  const { state, g, spots, homes } = tailRoom(r);
  const ops: Tail["ops"] = [];
  // The ops are drawn from the room as each leaves it at op version 36, so both versions replay one stored tail.
  let at = state;
  if (chance(r, 0.8)) {
    const ids = Object.keys(state.tokens).slice(0, 4);
    ops.push({ op: { t: "encounter.start", entries: ids.map((id, i) => ({ id: `e${i}`, tokenId: id, value: 20 - i, hidden: chance(r, 0.2) })) }, who: DM });
    const out = applyOp(at, ops[0]!.op, DM, { seq: 11, at: AT, opVersion: 36 });
    if (out.ok) at = out.state;
  }
  for (let i = int(r, 4, 9); i > 0; i--) {
    const next = tailOp(r, at, g, spots, homes);
    ops.push(next);
    const out = applyOp(at, next.op, next.who, { seq: 10 + ops.length, at: AT, opVersion: 36 });
    if (out.ok) at = out.state;
  }
  return { state, ops };
}

function replay(t: Tail, opVersion: number): string {
  let state = t.state;
  for (const [i, { op, who }] of t.ops.entries()) {
    const out = applyOp(state, op, who, { seq: 11 + i, at: AT, opVersion });
    if (out.ok) state = out.state;
  }
  return hash128(stableStringify(state));
}

function record(): Record<string, string[]> {
  clearVisionCache();
  const tails = Array.from({ length: TAILS }, (_, seed) => tail(seed));
  return Object.fromEntries(VERSIONS.map((v) => [String(v), tails.map((t) => replay(t, v))]));
}

describe("stored op tails on hex scenes replay to the states they made", () => {
  test("op versions 35 and 36, whole party and per player, with walls, memory, traps, areas, turns and rolls", () => {
    const now = record();
    if (process.env.REPLAY_TAILS === "write") writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`);
    const pinned = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, string[]>;
    for (const v of VERSIONS) {
      const differ = now[String(v)]!.flatMap((h, i) => (h !== pinned[String(v)]![i] ? [i] : []));
      assert.deepEqual(differ, [], `op version ${v}: these tails replay to other states`);
    }
  });

  test("the same tails as live ops end otherwise in many, so the pinned states test what the rules of op version 37 change", () => {
    const tails = Array.from({ length: TAILS }, (_, seed) => tail(seed));
    const moved = tails.filter((t) => replay(t, 36) !== replay(t, 37)).length;
    assert.ok(moved >= 20, `${moved} of ${TAILS} tails end otherwise`);
  });
});
