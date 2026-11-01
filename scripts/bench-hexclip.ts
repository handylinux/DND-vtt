/**
 * The fan-out row for a creature's outline on hexes, clipped by the walls
 * each viewer holds (docs/design/design-v1-hex-grids.md HX-D10 and HX-D22),
 * end to end through the room actor: a per-player hex rows scene in the
 * dark, with fog, six sight holders who each hold ground of their own and
 * light their own way, 50 Huge creatures and walls among them, and the
 * DM's wall edit beside them. The edit writes one chunk, so every creature
 * there goes again to the DM and to each player, each judged by that
 * viewer's own copy of the walls and marked by the shared one: seven
 * classes in all. The row is the time from the commit to the last frame,
 * held to 60 ms. Run it alone, with nothing else busy:
 *
 *   node scripts/bench-hexclip.ts
 *
 * It exits 1 when the row is over its budget.
 */
import { chunkKey, holderTileKey, tileKey, wallChunk } from "../shared/keys.ts";
import type { Member, RoomState, Token } from "../shared/model.ts";
import { encodeTile, TILE_BYTES, TILE_SUB } from "../shared/rules/fog.ts";
import { hexCenter, hexSubcells, sceneHexes, type HexGrid } from "../shared/rules/hex.ts";
import { gridOfShape } from "../shared/rules/grid.ts";
import { placedOnHex } from "../shared/rules/footprint.ts";
import { actor, room, scene, token } from "../shared/testutil.ts";
import { send, sitDown } from "./bench-server4.ts";

const SCENE = "bench";
const PLAYERS = 6;
const RUNS = 15;
const BUDGET = 60;
const g = gridOfShape("hexRows") as HexGrid;
const bounds = { w: 64, h: 48 };

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const q = (v: number) => Math.round(v * 64) / 64;

/** Sets the bits of one layer at these sub-cells, as the explore step writes them. */
function lift(state: RoomState, holder: string | null, subs: readonly (readonly [number, number])[]): void {
  const tiles = new Map<string, Uint8Array>();
  for (const [sx, sy] of subs) {
    const tx = Math.floor(sx / TILE_SUB);
    const ty = Math.floor(sy / TILE_SUB);
    const at = `${tx},${ty}`;
    let bits = tiles.get(at);
    if (!bits) tiles.set(at, (bits = new Uint8Array(TILE_BYTES)));
    const i = (sy - ty * TILE_SUB) * TILE_SUB + (sx - tx * TILE_SUB);
    bits[i >> 3] = bits[i >> 3]! | (1 << (i & 7));
  }
  for (const [at, bits] of tiles) {
    const [tx, ty] = at.split(",").map(Number) as [number, number];
    const tile = { sceneId: SCENE, tx, ty, rev: 1, bits: encodeTile(bits) };
    if (holder === null) state.exploredTiles[tileKey(SCENE, tx, ty)] = tile;
    else state.exploredBy![holderTileKey(SCENE, holder, tx, ty)] = { ...tile, memberId: holder };
  }
}

function benchRoom(): RoomState {
  const r = mulberry32(0x43b);
  const members: Record<string, Member> = { dm: { id: "dm", rev: 0, name: "DM", color: "#ff0000", kind: "dm", createdAt: "2026-10-14T00:00:00.000Z" } };
  const players = Array.from({ length: PLAYERS }, (_, i) => `p${i + 1}`);
  for (const id of players) members[id] = { id, rev: 0, name: id, color: "#00ff00", kind: "player", createdAt: "2026-10-14T00:00:00.000Z" };
  const state = room({
    members,
    scenes: { [SCENE]: scene(SCENE, { gridShape: "hexRows", bounds, autoWalls: "off", fogEnabled: true, vision: { on: true, light: "dark", perPlayer: true } }) },
  });
  state.meta = { ...state.meta, playerSceneId: SCENE };
  state.holders = { [SCENE]: { sceneId: SCENE, rev: 1, entries: players.map((memberId) => ({ memberId, on: true })) } };
  const hexes = sceneHexes(g, bounds).filter((h) => h.col >= 8 && h.col < 40 && h.row >= 8 && h.row < 36);
  const tokens: Record<string, Token> = {};
  for (let i = 0; i < 50; i++) {
    const at = hexes[Math.floor(r() * hexes.length)]!;
    const base = token(`ogre${i}`, { sceneId: SCENE, size: "huge", kind: "npc", name: `Ogre ${i + 1}`, x: 0, y: 0 });
    tokens[base.id] = { ...base, ...placedOnHex(g, base, at) };
  }
  players.forEach((id, i) => {
    const at = hexes[Math.floor(r() * hexes.length)]!;
    const base = token(`pc${i}`, { sceneId: SCENE, kind: "pc", disposition: "ally", ownerIds: [id], name: `Hero ${i + 1}`, x: 0, y: 0, light: { bright: 20, dim: 20 }, actor: { inline: actor({ senses: "darkvision 60 ft" }) } });
    tokens[base.id] = { ...base, ...placedOnHex(g, base, at) };
  });
  state.tokens = tokens;
  // The party's explored ground over half the hexes, and each holder's own over a fifth.
  lift(state, null, hexes.filter(() => r() < 0.5).flatMap((h) => hexSubcells(g, h)));
  for (const id of players) lift(state, id, hexes.filter(() => r() < 0.2).flatMap((h) => hexSubcells(g, h)));
  // Short walls among the creatures.
  for (let i = 0; i < 80; i++) {
    const c = hexCenter(g, hexes[Math.floor(r() * hexes.length)]!);
    const w = { id: `w${String(i).padStart(11, "0")}`, a: [q(c.x - 0.6 + r() * 0.2), q(c.y - 0.4)] as [number, number], b: [q(c.x + 0.6), q(c.y + 0.4 - r() * 0.2)] as [number, number], f: { kind: "wall" as const } };
    const { cx, cy } = wallChunk(w);
    const key = chunkKey(SCENE, cx, cy);
    const chunk = state.buildChunks[key] ?? { sceneId: SCENE, cx, cy, rev: 0, cells: {}, edges: {} };
    state.buildChunks[key] = { ...chunk, walls: [...(chunk.walls ?? []), w] };
  }
  return state;
}

function stats(times: number[]): { median: number; max: number } {
  const sorted = [...times].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)]!, max: sorted[sorted.length - 1]! };
}

const table = await sitDown(benchRoom());
const fanouts: number[] = [];
const totals: number[] = [];
for (let run = 0; run < RUNS + 2; run++) {
  // A wall beside the creatures put and taken away again, each its own batch.
  const at = { x: q(24 + (run % 5) * 0.25), y: q(20 + (run % 3) * 0.25) };
  const put = await send(table, table.dm, { t: "build.walls", sceneId: SCENE, put: [{ id: "edit00000001", a: [at.x, at.y], b: [at.x + 1.5, at.y + 0.5], f: { kind: "wall" } }] });
  const { cx, cy } = wallChunk({ a: [at.x, at.y], b: [at.x + 1.5, at.y + 0.5] });
  const gone = await send(table, table.dm, { t: "build.walls", sceneId: SCENE, remove: [{ cx, cy, id: "edit00000001" }] });
  if (run < 2) continue;
  fanouts.push(put.fanout, gone.fanout);
  totals.push(put.total, gone.total);
}
const fanout = stats(fanouts);
const total = stats(totals);
console.log(`A wall edit beside 50 Huge creatures, per-player hex rows, 6 holders: fan-out ${fanout.median.toFixed(1)} ms median, ${fanout.max.toFixed(1)} max (budget ${BUDGET}); whole op ${total.median.toFixed(1)} ms median, ${total.max.toFixed(1)} max`);
// The actor keeps its timers, so the run ends here.
process.exit(fanout.median > BUDGET ? 1 : 0);
