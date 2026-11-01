import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { lift, liftAllBut, wall } from "../discoveryTestutil.ts";
import { migrateOp, OP_VERSION, opMigrations, runMigrations, seatsFullBetweenEnds, stopsStandFullSize } from "../migrate.ts";
import type { RoomState, Token, Trap, Viewer } from "../model.ts";
import { canApply } from "../permissions.ts";
import { projectState, stableStringify } from "../project.ts";
import { opSchema, type Op, type OpOf } from "../protocol.ts";
import { applyOp } from "../reducer.ts";
import { HEX_R, hexCenter, hexKey, type Hex } from "../rules/hex.ts";
import { COLUMNS, onHex, ROWS } from "../rules/hexWalls.testkit.ts";
import { hexStandPlace } from "../rules/movement.ts";
import { sceneWalls } from "../rules/walls.ts";
import { chance, character, DM, entry, env, int, member, P1, P2, pick, rng, room, scene, template, token, trap } from "../testutil.ts";

/**
 * Nothing players see of a walk between its ends reads a squeeze from the
 * walls (D-261101-180, D-261101-181, op version 36). Whether a narrow
 * space pinches a walker there is the walls' to say, walls under the fog
 * among them. So on squares what sits on a holder keeps its own seat
 * between the walk's ends, where the walk's trace has the holder full size
 * (route.ts walkSqueezes), and on both grids a trap stops a walker between
 * its walk's ends only where it stands full size (route.ts routeStands).
 * Two rooms whose players start with the same copy, one with walls under
 * the fog, give every player the same copy after the same walk. Ops stored
 * before version 36 replay as they did.
 */

const LIVE = [36, undefined] as const;

const versioned = (opVersion: number | undefined) => ({ ...env(5), ...(opVersion !== undefined ? { opVersion } : {}) });

/** Every player's copy of the scene, as one string a player at a time. */
function copies(s: RoomState, viewers: readonly Viewer[]): string[] {
  return viewers.map((v) => stableStringify(projectState(s, v, { sceneId: "s1" })));
}

function played(s: RoomState, op: Op, who: Viewer, opVersion: number | undefined): RoomState {
  const parsed = opSchema.parse(op);
  if (who.role === "player") {
    const allowed = canApply(parsed, who, s, { canUseAsset: () => true });
    assert.ok(allowed.ok, allowed.ok ? "" : allowed.message);
  }
  const r = applyOp(s, parsed, who, versioned(opVersion));
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.state;
}

/** Pat (p1) owns a Large warhorse at 3,9, its turn on, on a 30 by 20 scene whose walls stop moves, fog on and only row 10 revealed. */
function hall(): RoomState {
  const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1") }, scenes: { s1: scene("s1", { bounds: { w: 30, h: 20 }, blockMovement: true, autoWalls: "off", fogEnabled: true }) } });
  s.buildChunks = {};
  s.tokens.horse = token("horse", { size: "large", x: 3, y: 9, name: "Warhorse", kind: "npc", disposition: "ally", ownerIds: ["p1"] });
  s.encounter = { rev: 0, round: 1, activeEntryId: "e-horse", entries: [entry("e-horse", { tokenId: "horse", value: 15 })] };
  lift(s, "dm", { x: 0, y: 10, w: 30, h: 1 });
  return s;
}

/** The second room: walls under the fog either side of row 10 from x 9 to 15, a narrow space for the warhorse along y 9.5. */
function walled(open: RoomState): RoomState {
  const s = structuredClone(open);
  wall(s, "fu43pw000001", [9, 9.75], [15, 9.75]);
  wall(s, "fu43pw000002", [9, 11.25], [15, 11.25]);
  return s;
}

/** Along the hall's row, half a square off the grid through the narrow space, and out. */
const THROUGH: OpOf<"token.move"> = { t: "token.move", tokenId: "horse", x: 18, y: 9, route: [[7.5, 9.5, 0, 0], [15.5, 9.5, 0, 0], [18, 9, 0, 0]] };

describe("op version 36: a walk between its ends reads no squeeze from the walls", () => {
  test("the op step is the identity, and ops stored at the current version take the new rules", () => {
    assert.ok(OP_VERSION >= 36);
    assert.ok(opMigrations.some((s) => s.from === 35 && s.to === 36));
    const ops: unknown[] = [THROUGH, { t: "token.move", tokenId: "horse", x: 11.5, y: 9.5, squeeze: true }, { t: "log.chat", text: "hi" }];
    for (const op of ops) assert.equal(runMigrations(op, 35, 36, opMigrations), op);
    for (const op of ops) assert.equal(migrateOp(op, 35), op);
    assert.throws(() => runMigrations({ t: "log.chat", text: "hi" }, 36, 35, opMigrations), /down/);
    for (const gate of [seatsFullBetweenEnds, stopsStandFullSize]) {
      assert.equal(gate(35), false);
      assert.equal(gate(1), false);
      assert.equal(gate(36), true);
      assert.equal(gate(OP_VERSION), true, "an op stored now replays as it was taken");
      assert.equal(gate(undefined), true);
    }
  });
});

describe("a rider on a squeezing mount, between the walk's ends (D-261101-180)", () => {
  /** Medium Brom, Pat's, rides the warhorse at `seat`, and a cloud that sets off on entering sits on the revealed row. */
  function riding(seat: [number, number]): RoomState {
    const s = hall();
    s.characters.brom = character("brom", { name: "Brom", ownerIds: ["p1"] });
    s.tokens.brom = token("brom", { size: "medium", x: seat[0], y: seat[1], name: "Brom", kind: "pc", actor: { ref: "brom" }, ownerIds: ["p1"], disposition: "ally", attached: { to: "horse", kind: "ride" } });
    s.templates.cloud = template("cloud", { size: 5, origin: { x: 12.5, y: 10.5, z: 0 }, spell: "Stinking Cloud", ownerId: "dm1", triggers: ["enter"] });
    return s;
  }

  for (const seat of [[3, 9], [4, 9], [3, 10], [4, 10]] as [number, number][]) {
    test(`from the seat at ${seat}: walls under the fog decide nothing Pat reads, and an op stored at 35 replays as it was`, () => {
      const open = riding(seat);
      const closed = walled(open);
      assert.deepEqual(copies(closed, [P1]), copies(open, [P1]), "Pat's copies start the same");
      for (const opVersion of LIVE) assert.deepEqual(copies(played(closed, THROUGH, P1, opVersion), [P1]), copies(played(open, THROUGH, P1, opVersion), [P1]), `op ${opVersion ?? "live"}`);
      // Stored before version 36 the rider's seat moved where the narrow space pinched the mount, and the walls decided his line.
      const lines = (s: RoomState) => projectState(s, P1, { sceneId: "s1" }).log.flatMap((e) => (e.data?.type === "area" ? [`${e.data.tokenId} ${e.data.trigger}`] : []));
      assert.deepEqual(lines(played(closed, THROUGH, P1, 35)), ["brom enter"], "op 35 replays the walled room as it was");
      // From an upper seat Brom's own seat crosses the cloud on the revealed row in the open room too, so only the lower seats told.
      assert.deepEqual(lines(played(open, THROUGH, P1, 35)), seat[1] === 9 ? ["brom enter"] : [], "op 35 replays the open room as it was");
    });
  }
});

describe("a trap's stop between the walk's ends (D-261101-181)", () => {
  /** A net that stops what enters it, on the floor or not, on the revealed row where the narrow space starts. */
  function netted(): RoomState {
    const s = hall();
    s.traps = { net: trap("net", { zone: { cells: [{ x: 9, y: 10, w: 2, h: 1 }] }, rig: { on: ["enter"], who: "any", floor: false, resets: "never", stops: true, foundOnSpring: true, hits: "trigger", actions: [], find: [], notice: false } }) };
    return s;
  }
  const route: OpOf<"token.move"> = { t: "token.move", tokenId: "horse", x: 18, y: 9, route: [[7.5, 9.5, 0, 0], [11.5, 9.5, 0, 0], [15.5, 9.5, 0, 0], [18, 9, 0, 0]] };
  const where = (s: RoomState) => [s.tokens.horse!.x, s.tokens.horse!.y, s.tokens.horse!.squeeze === true];

  test("the warhorse stops where it first stands full size in both rooms, and Pat's copies match, by Pat's move and the DM's", () => {
    const open = netted();
    const closed = walled(open);
    assert.deepEqual(copies(closed, [P1]), copies(open, [P1]));
    for (const who of [P1, DM]) {
      for (const opVersion of LIVE) {
        const a = played(open, route, who, opVersion);
        const b = played(closed, route, who, opVersion);
        assert.deepEqual(where(b), [17, 9, false], `${who.role} at op ${opVersion ?? "live"}`);
        assert.deepEqual(where(a), [17, 9, false]);
        assert.deepEqual(copies(b, [P1]), copies(a, [P1]));
      }
    }
  });

  test("an op stored at 35 replays as it was: squeezed at the narrow space's mouth in the walled room, on at 17,9 in the open one", () => {
    const open = netted();
    assert.deepEqual(where(played(walled(open), route, P1, 35)), [7.5, 9.5, true]);
    assert.deepEqual(where(played(open, route, P1, 35)), [17, 9, false]);
  });
});

/**
 * The same stop on hexes, rows and columns: a Large ogre, Pat's, walks a
 * line of hexes squeezed, on a squeezed size's anchors as its route has
 * it, and in the second room walls under the fog in the hexes either side
 * make that line a narrow space (HX-D17), a net in it. The walls lie
 * inside those hexes, clear of the line's own, which stay revealed.
 */
for (const [name, g] of [["hex rows", ROWS], ["hex columns", COLUMNS]] as const) {
  const at = (along: number, across: number): Hex => (g.orient === "rows" ? { col: along, row: across } : { col: across, row: along });
  const shape = g.orient === "rows" ? "hexRows" : "hexColumns";
  const bounds = g.orient === "rows" ? { w: 22, h: 16 } : { w: 16, h: 22 };

  function line(): RoomState {
    const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1") }, scenes: { s1: scene("s1", { gridShape: shape, bounds, blockMovement: true, autoWalls: "off", fogEnabled: true }) } });
    s.buildChunks = {};
    s.tokens.ogre = onHex(g, "ogre", "large", at(2, 6), { name: "Ogre", kind: "npc", ownerIds: ["p1"] });
    const hidden: string[] = [];
    for (let k = 0; k < 26; k++) for (const across of [5, 7]) hidden.push(hexKey(at(k, across)));
    liftAllBut(s, "dm", hidden);
    const net = at(8, 6);
    s.traps = { net: trap("net", { grid: shape, zone: { cells: [{ x: net.col, y: net.row, w: 1, h: 1 }] }, rig: { on: ["enter"], who: "any", floor: false, resets: "never", stops: true, foundOnSpring: true, hits: "trigger", actions: [], find: [], notice: false } }) };
    return s;
  }

  /** Walls parallel to the line, 1.1 hex radii either side of its centers, inside the hidden hexes, ends on the 1/64 lattice. */
  function narrowed(open: RoomState): RoomState {
    const s = structuredClone(open);
    const a = hexCenter(g, at(6, 6));
    const b = hexCenter(g, at(13, 6));
    const off = 1.1 * HEX_R;
    const q = (v: number) => Math.round(v * 64) / 64;
    let id = 0;
    for (const side of [-1, 1]) {
      for (let t = 0; t < 1 - 1e-9; t += 0.5) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const e = { x: a.x + (b.x - a.x) * (t + 0.5), y: a.y + (b.y - a.y) * (t + 0.5) };
        const shift = g.orient === "rows" ? { x: 0, y: side * off } : { x: side * off, y: 0 };
        wall(s, `fu43ph${String(id++).padStart(6, "0")}`, [q(p.x + shift.x), q(p.y + shift.y)], [q(e.x + shift.x), q(e.y + shift.y)]);
      }
    }
    assert.equal(sceneWalls(s.scenes.s1!, s.buildChunks).stored.xy.length / 4, id, "every wall stored");
    return s;
  }

  test(`${name}: the ogre stops where it first stands full size in both rooms, and an op stored at 35 replays as it was`, () => {
    const open = line();
    const closed = narrowed(open);
    const ogre = open.tokens.ogre!;
    const squeezed = (k: number) => hexStandPlace(g, ogre, { size: "medium", ref: at(k, 6), squeezed: true });
    const full = hexStandPlace(g, ogre, { size: "large", ref: at(17, 6), squeezed: false });
    const op: OpOf<"token.move"> = { t: "token.move", tokenId: "ogre", ...full, route: [squeezed(5), squeezed(14), full].map((p) => [p.x, p.y, 0, 0]) };
    assert.deepEqual(copies(closed, [P1]), copies(open, [P1]), "Pat's copies start the same");
    const where = (s: RoomState) => [s.tokens.ogre!.x, s.tokens.ogre!.y, s.tokens.ogre!.squeeze === true];
    for (const who of [P1, DM]) {
      for (const opVersion of LIVE) {
        const a = played(open, op, who, opVersion);
        const b = played(closed, op, who, opVersion);
        assert.equal(a.traps.net?.state, "sprung");
        assert.deepEqual(where(b), where(a), `${who.role} at op ${opVersion ?? "live"}`);
        assert.deepEqual(copies(b, [P1]), copies(a, [P1]));
      }
    }
    // Stored before version 36 the walled room stopped it squeezed in the line, where the narrow space let it stand.
    const old = played(closed, op, P1, 35);
    assert.equal(old.tokens.ogre!.squeeze, true);
    assert.deepEqual(where(played(open, op, P1, 35)), [full.x, full.y, false]);
  });
}

/**
 * Random paired rooms on squares. A Large or Huge mount, Pat's, walks
 * along a lane half a square off its grid, with riders on random seats,
 * areas and traps along the walk, by Pat or the DM. The second room adds
 * walls under the fog either side of the lane, inside the mount's full
 * footprint and clear of its core, so they pinch it and never stop it: the
 * touch rule's channel stays out (docs/design/design-v1-map-discovery.md
 * 12). Sometimes only one side is walled, the walls stop short of a
 * corner, and walls lie under the fog far from the walk. Built in lane
 * coordinates, `u` along the lane and `v` across it, then turned a
 * quarter on half the cases.
 */
type Pair = { open: RoomState; closed: RoomState; op: OpOf<"token.move">; who: Viewer; walls: number };

function randomPair(r: () => number, n: number): Pair {
  const turned = chance(r, 0.5);
  const xy = (u: number, v: number): [number, number] => (turned ? [v, u] : [u, v]);
  const along = 40;
  const across = 24;
  const bounds = turned ? { w: across, h: along } : { w: along, h: across };
  const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds, blockMovement: true, autoWalls: "off", fogEnabled: true }) } });
  s.buildChunks = {};
  const size = pick(r, ["large", "huge"] as const);
  const F = size === "large" ? 2 : 3;
  const u0 = int(r, 1, 4);
  const v0 = int(r, 6, 12);
  const [hx, hy] = xy(u0, v0);
  s.tokens.horse = token("horse", { size, x: hx, y: hy, name: "Mount", kind: "npc", disposition: "ally", ownerIds: ["p1"] });
  // The lane's corners: in at `a`, on through up to two more, out at `b`, then off the lane onto the grid.
  const a = u0 + int(r, 2, 4) + pick(r, [0, 0.5]);
  const corners = [a];
  for (let k = int(r, 1, 3); k > 0; k--) corners.push(corners[corners.length - 1]! + int(r, 1, 4) + pick(r, [0, 0.5]));
  const b = corners[corners.length - 1]!;
  const out = Math.ceil(b) + int(r, 2, 3);
  const vOut = v0 + pick(r, [0, 1]);
  const lane = v0 + 0.5;
  const route: [number, number, number, 0 | 1][] = [...corners.map((u): [number, number, number, 0 | 1] => [...xy(u, lane), pick(r, [0, 1]), 0]), [...xy(out, vOut), 0, 0]];
  const op: OpOf<"token.move"> = { t: "token.move", tokenId: "horse", x: xy(out, vOut)[0], y: xy(out, vOut)[1], route };
  // Riders on random seats: on the snap grid inside the mount's box, half squares for the Tiny.
  const riders = int(r, 0, 3);
  for (let i = 0; i < riders; i++) {
    const rider = pick(r, ["medium", "small", "tiny"] as const);
    const step = rider === "tiny" ? 0.5 : 1;
    const side = rider === "tiny" ? 0.5 : 1;
    const su = u0 + step * int(r, 0, (F - side) / step);
    const sv = v0 + step * int(r, 0, (F - side) / step);
    const [x, y] = xy(su, sv);
    s.tokens[`rider${i}`] = token(`rider${i}`, { size: rider, x, y, name: `Rider ${i}`, kind: "npc", disposition: "ally", ownerIds: pick(r, [["p1"], ["p2"], []]), attached: { to: "horse", kind: pick(r, ["ride", "perch", "carry"] as const) } });
  }
  if (chance(r, 0.6)) {
    const entries = [entry("e-horse", { tokenId: "horse", value: 15 }), ...Object.keys(s.tokens).filter((id) => id !== "horse").map((id, i) => entry(`e-${id}`, { tokenId: id, value: 10 - i }))];
    s.encounter = { rev: 0, round: 1, activeEntryId: pick(r, entries).id, entries };
  }
  // Areas and traps along the walk, on revealed ground or not.
  for (let i = int(r, 0, 3); i > 0; i--) {
    const [ox, oy] = xy(int(r, u0, out + 2) + pick(r, [0, 0.5]), int(r, v0 - 2, v0 + F + 2) + pick(r, [0, 0.5]));
    s.templates[`area${i}`] = template(`area${i}`, { size: pick(r, [5, 10, 15]), origin: { x: ox, y: oy, z: 0 }, ownerId: pick(r, ["dm1", "p1"]), triggers: pick(r, [["enter"], ["enter", "turnStart"]] as const).slice(), visibility: pick(r, ["all", "all", "dm"] as const) });
  }
  for (let i = int(r, 0, 2); i > 0; i--) {
    const [cx, cy] = xy(int(r, Math.floor(a), Math.ceil(b) + 1), int(r, v0 - 1, v0 + F));
    const w = int(r, 1, 2);
    const h = int(r, 1, 2);
    const cells = [{ x: cx, y: cy, w: turned ? h : w, h: turned ? w : h }];
    const rig: Trap["rig"] = { on: pick(r, [["enter"], ["enter", "leave"]] as const).slice(), who: pick(r, ["any", "party", "others"] as const), floor: chance(r, 0.5), resets: "never", stops: chance(r, 0.6), foundOnSpring: true, hits: "trigger", actions: [], find: [], notice: false };
    s.traps = { ...s.traps, [`trap${i}`]: trap(`trap${i}`, { zone: { cells }, found: chance(r, 0.3), rig }) };
  }
  // The fog: the lane's middle rows revealed all along, random patches elsewhere, and every square a wall may cross under the fog.
  lift(s, "dm", turned ? { x: v0 + 1, y: 0, w: F - 1, h: along } : { x: 0, y: v0 + 1, w: along, h: F - 1 });
  for (let i = int(r, 0, 4); i > 0; i--) {
    const [px, py] = xy(int(r, 0, along - 4), int(r, 0, across - 4));
    lift(s, "dm", { x: px, y: py, w: int(r, 1, 4), h: int(r, 1, 4) });
  }
  const hide = (u: number, v: number, w: number, h: number) => {
    const [x, y] = xy(u, v);
    lift(s, "dm", turned ? { x, y, w: h, h: w } : { x, y, w, h }, "s1", false);
  };
  hide(0, v0, along, 1);
  hide(0, v0 + F, along, 1);
  hide(0, 0, along, 2);
  const closed = structuredClone(s);
  // The walls: inside the full footprint either side of the lane, d from its middle, clear of the core, never on a cell side, and
  // their ends on the 1/64 lattice, as a stored wall's are (an end off it is dropped as bad data).
  const middle = lane + F / 2;
  const d = (F - 1) / 2 + pick(r, [0.125, 0.25, 0.375]);
  const start = a + F - 0.5 + pick(r, [0, 0.25, 1.25]);
  const end = b + 0.5 - pick(r, [0, 0.25, 1.25]);
  const sides = pick(r, [[-1, 1], [-1, 1], [-1, 1], [-1], [1]]);
  let id = 0;
  const put = (u1: number, v1: number, u2: number, v2: number) => wall(closed, `fu43q${String(n).padStart(4, "0")}${String(id++).padStart(3, "0")}`, xy(u1, v1), xy(u2, v2));
  for (const side of sides) {
    // Each wall at most 8 squares long, as the protocol takes one.
    for (let u = start; u < end - 1e-9; u += 4) put(u, middle + side * d, Math.min(end, u + 4), middle + side * d);
  }
  // Far walls under the fog, away from every footprint on the walk.
  for (let i = int(r, 0, 2); i > 0; i--) {
    const u = int(r, 2, along - 6) + 0.5;
    put(u, 0.5, u + int(r, 1, 4), 0.5 + pick(r, [0, 1]));
  }
  return { open: s, closed, op, who: pick(r, [P1, DM]), walls: id };
}

describe("random paired rooms: walls under the fog decide nothing any player reads of a walk (D-261101-180, D-261101-181)", () => {
  test("every player's copy and log match across the two rooms at op 36 and live, and op 35 shows the rule was needed", () => {
    const viewers = [P1, P2];
    let runs = 0;
    let differedAt35 = 0;
    for (let n = 0; n < 300; n++) {
      const r = rng(0xf43 + n);
      const { open, closed, op, who, walls } = randomPair(r, n);
      assert.equal(sceneWalls(closed.scenes.s1!, closed.buildChunks).stored.xy.length / 4, walls, `case ${n}: every wall stored, none dropped as bad data`);
      assert.deepEqual(copies(closed, viewers), copies(open, viewers), `case ${n}: the players' copies start the same`);
      const take = (s: RoomState, opVersion: number | undefined): RoomState | null => {
        const parsed = opSchema.parse(op);
        if (who.role === "player" && !canApply(parsed, who, s, { canUseAsset: () => true }).ok) return null;
        const res = applyOp(s, parsed, who, versioned(opVersion));
        return res.ok ? res.state : null;
      };
      for (const opVersion of LIVE) {
        const a = take(open, opVersion);
        const b = take(closed, opVersion);
        assert.equal(b === null, a === null, `case ${n} at op ${opVersion ?? "live"}: taken in both rooms or neither`);
        if (a && b) assert.deepEqual(copies(b, viewers), copies(a, viewers), `case ${n} at op ${opVersion ?? "live"}: ${JSON.stringify(op)}`);
      }
      const a = take(open, 35);
      const b = take(closed, 35);
      if (a && b) {
        runs++;
        if (stableStringify(copies(a, viewers)) !== stableStringify(copies(b, viewers))) differedAt35++;
      }
    }
    // The walk is taken in nearly every case, and enough cases tell the rooms apart under the old rules to show the generator reaches them.
    assert.ok(runs >= 250, `${runs} cases taken`);
    assert.ok(differedAt35 >= 20, `${differedAt35} cases told the rooms apart at op 35`);
  });
});
