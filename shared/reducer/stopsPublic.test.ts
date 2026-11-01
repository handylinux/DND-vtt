import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { heights, lift, liftAllBut, remember, stairs, wall } from "../discoveryTestutil.ts";
import { clipsByHeldWalls, migrateOp, OP_VERSION, opMigrations, runMigrations, stopsOnPublicGround } from "../migrate.ts";
import type { RoomState, Token, TrapRig, Viewer } from "../model.ts";
import { canApply } from "../permissions.ts";
import { projectState, stableStringify } from "../project.ts";
import { opSchema, type Op } from "../protocol.ts";
import { applyOp } from "../reducer.ts";
import { convexHull } from "../rules/aoe.ts";
import { occupiedHexes } from "../rules/footprint.ts";
import { convexLive, pendingGround } from "../rules/held.ts";
import { HEX_R, hexAt, hexCenter, hexInScene, hexKey, hexNeighbors, type Hex, type HexGrid } from "../rules/hex.ts";
import { COLUMNS, onHex, ROWS } from "../rules/hexWalls.testkit.ts";
import { hexDirection, hexEndStand, hexLegOf, hexStandAt, hexStandHexes, hexStartStand, hexWallsOf } from "../rules/movement.ts";
import type { PublicGround } from "../rules/route.ts";
import { planTrapMove, rowHullLive, setStopGroundForTests, stopGround, trapWalks, type TrapRoom } from "../rules/traps.ts";
import { sceneWalls } from "../rules/walls.ts";
import { chance, DM, env, int, member, P1, P2, pick, rng, room, scene, token, trap } from "../testutil.ts";

/**
 * From op version 37 a stopping trap stops a walker between its walk's
 * ends by the walls only where every cell or hex its stand test reads lies
 * on the ground every player sees, and elsewhere stands only where the
 * walk itself went (route.ts PublicGround, traps.ts stopGround, migrate.ts
 * stopsOnPublicGround). Two rooms whose players start with the same copy,
 * the second with short walls on dark ground, give every player the same
 * copy after the same walk. Ops stored before version 37 replay as they
 * did.
 */

const versioned = (opVersion: number | undefined) => ({ ...env(4), ...(opVersion !== undefined ? { opVersion } : {}) });
const deps = { canUseAsset: () => true };
const q = (v: number) => Math.round(v * 64) / 64;

/** Every player's copy of the scene, as one string. */
function copies(s: RoomState, viewers: readonly Viewer[] = [P1, P2]): string {
  return viewers.map((v) => stableStringify(projectState(s, v, { sceneId: "s1" }))).join("\n");
}

/** The room after an op as it would be stored at `opVersion`, every player's copy and the walker. */
function after(s: RoomState, op: Op, who: Viewer, opVersion: number | undefined, id: string, viewers: readonly Viewer[] = [P1, P2]): string {
  const r = applyOp(structuredClone(s), opSchema.parse(op), who, versioned(opVersion));
  return r.ok ? `${copies(r.state, viewers)}\n${JSON.stringify(r.state.tokens[id])}` : `refused ${r.message}`;
}

function at(s: RoomState, op: Op, who: Viewer, opVersion: number | undefined, id: string): [number, number] {
  const r = applyOp(structuredClone(s), opSchema.parse(op), who, versioned(opVersion));
  assert.ok(r.ok, r.ok ? "" : r.message);
  return [r.state.tokens[id]!.x, r.state.tokens[id]!.y];
}

const snare = (over: Partial<TrapRig> = {}): TrapRig => ({ on: ["enter"], who: "any", floor: false, resets: "never", stops: true, foundOnSpring: true, hits: "trigger", actions: [], find: [], notice: false, ...over });

function squares(fog = true, bounds = { w: 20, h: 20 }): RoomState {
  const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds, blockMovement: true, autoWalls: "off", fogEnabled: fog }) } });
  s.buildChunks = {};
  return s;
}

function hexes(g: HexGrid, bounds = { w: 16, h: 16 }): RoomState {
  const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { gridShape: g.orient === "rows" ? "hexRows" : "hexColumns", bounds, blockMovement: true, autoWalls: "off", fogEnabled: true }) } });
  s.buildChunks = {};
  return s;
}

/** A short wall inside hex `h`, across the segment from its middle toward its neighbor `toward`, a third of the way. */
function stubToward(s: RoomState, g: HexGrid, id: string, h: Hex, toward: Hex): void {
  const c = hexCenter(g, h);
  const n = hexCenter(g, toward);
  const m = { x: c.x + (n.x - c.x) / 3, y: c.y + (n.y - c.y) / 3 };
  const d = { x: -(n.y - c.y), y: n.x - c.x };
  const len = Math.hypot(d.x, d.y);
  wall(s, id, [q(m.x + (d.x / len) * 0.15), q(m.y + (d.y / len) * 0.15)], [q(m.x - (d.x / len) * 0.15), q(m.y - (d.y / len) * 0.15)]);
}

const hexOf = (g: HexGrid, s: RoomState, id: string) => hexKey(hexAt(g, { x: s.tokens[id]!.x + 0.5, y: s.tokens[id]!.y + 0.5 }));

describe("op version 37: a stop between a walk's ends reads the ground every player sees", () => {
  test("the op step is the identity, and ops stored at the current version take the new rules", () => {
    assert.ok(OP_VERSION >= 37);
    assert.ok(opMigrations.some((s) => s.from === 36 && s.to === 37));
    const ops: unknown[] = [{ t: "token.move", tokenId: "gob", x: 6, y: 6, route: [[2, 4, 0, 0], [6, 6, 0, 0]] }, { t: "log.chat", text: "hi" }];
    for (const op of ops) assert.equal(runMigrations(op, 36, 37, opMigrations), op);
    for (const op of ops) assert.equal(migrateOp(op, 36), op);
    assert.throws(() => runMigrations({ t: "log.chat", text: "hi" }, 37, 36, opMigrations), /down/);
    for (const gate of [stopsOnPublicGround, clipsByHeldWalls]) {
      assert.equal(gate(36), false);
      assert.equal(gate(1), false);
      assert.equal(gate(37), true);
      assert.equal(gate(OP_VERSION), true, "an op stored now replays as it was taken");
      assert.equal(gate(undefined), true);
    }
  });
});

describe("stops on squares, the same in both rooms", () => {
  /** The snare on 3,5, dark, everything else revealed, and in the second room a short wall inside that cell. */
  function snapped(walker: Token): { open: RoomState; walled: RoomState } {
    const open = squares();
    open.tokens[walker.id] = walker;
    open.traps = { snare: trap("snare", { zone: { cells: [{ x: 3, y: 5, w: 1, h: 1 }] }, rig: snare() }) };
    lift(open, "dm", { x: 0, y: 0, w: 20, h: 5 });
    lift(open, "dm", { x: 0, y: 6, w: 20, h: 14 });
    lift(open, "dm", { x: 0, y: 5, w: 3, h: 1 });
    lift(open, "dm", { x: 4, y: 5, w: 16, h: 1 });
    const walled = structuredClone(open);
    wall(walled, "fu43p2w00001", [3.25, 5.25], [3.75, 5.25]);
    assert.equal(copies(walled), copies(open), "the players' copies start the same");
    return { open, walled };
  }

  test("a Medium goblin on a snapped spot off that ground stops at 4,5, a spot on its piece's line", () => {
    const { open, walled } = snapped(token("gob", { name: "Gob", x: 0, y: 4, ownerIds: ["p1"], kind: "pc", disposition: "ally" }));
    const op: Op = { t: "token.move", tokenId: "gob", x: 6, y: 6, route: [[2, 4, 0, 0], [6, 6, 1, 0]] };
    for (const who of [P1, DM]) {
      assert.deepEqual(at(open, op, who, undefined, "gob"), [4, 5]);
      assert.equal(after(walled, op, who, undefined, "gob"), after(open, op, who, undefined, "gob"), who.role);
    }
    assert.notEqual(after(walled, op, P1, 36, "gob"), after(open, op, P1, 36, "gob"), "at op 36 the wall decided the stop");
  });

  test("a Large ogre's spot exactly on its line is no stand off that ground: it walks on to 8,4", () => {
    const { open, walled } = snapped(token("ogre", { name: "Ogre", size: "large", x: 0, y: 4, ownerIds: ["p1"], kind: "pc", disposition: "ally" }));
    const op: Op = { t: "token.move", tokenId: "ogre", x: 8, y: 4 };
    for (const who of [P1, DM]) {
      assert.deepEqual(at(walled, op, who, undefined, "ogre"), [8, 4]);
      assert.equal(after(walled, op, who, undefined, "ogre"), after(open, op, who, undefined, "ogre"), who.role);
    }
    assert.notEqual(after(walled, op, P1, 36, "ogre"), after(open, op, P1, 36, "ogre"), "at op 36 the wall decided the stop");
  });

  test("a goblin whose taut line passes a sealed closet walks on to 8,1, fog off and fogged (review FU43P-OPUS-8)", () => {
    for (const fog of [false, true]) {
      for (const x of [4, 5]) {
        const s = squares(fog);
        s.tokens.gob = token("gob", { name: "Gob", x: 0, y: 0, ownerIds: ["p1"], kind: "pc", disposition: "ally" });
        if (fog) {
          lift(s, "dm", { x: 0, y: 0, w: 20, h: 1 });
          lift(s, "dm", { x: 7, y: 0, w: 13, h: 20 });
        }
        for (const [i, [a, b]] of ([[[1, 1.25], [6.25, 1.25]], [[1, 1.25], [1, 3]], [[6.25, 1.25], [6.25, 3]], [[1, 3], [6.25, 3]]] as [number, number][][]).entries()) wall(s, `fu43p2c0000${i}`, a!, b!);
        s.traps = { snare: trap("snare", { zone: { cells: [{ x, y: 1, w: 1, h: 1 }] }, rig: snare() }) };
        const op: Op = { t: "token.move", tokenId: "gob", x: 8, y: 1, route: [[8, 1, 0, 0]] };
        const r = applyOp(structuredClone(s), op, P1, versioned(undefined));
        assert.ok(r.ok);
        assert.deepEqual([r.state.tokens.gob!.x, r.state.tokens.gob!.y, r.state.traps.snare!.state], [8, 1, "sprung"], `fog ${fog}, the snare on ${x},1`);
      }
    }
  });

  test("a torch-bearer's stub in the dark beside its line moves no stop: both rooms stop at 9,7", () => {
    const open = squares(true, { w: 30, h: 20 });
    open.scenes.s1 = { ...open.scenes.s1!, vision: { on: true, light: "dark" } };
    open.tokens.gob = token("gob", { name: "Gob", x: 0, y: 4, ownerIds: ["p1"], kind: "pc", disposition: "ally", light: { bright: 20, dim: 0 } });
    open.traps = { snare: trap("snare", { zone: { cells: [{ x: 7, y: 6, w: 1, h: 1 }] }, rig: snare() }) };
    const walled = structuredClone(open);
    wall(walled, "visstub00001", [6.5, 6.09375], [6.5, 6.3125]);
    assert.equal(copies(walled), copies(open));
    const op: Op = { t: "token.move", tokenId: "gob", x: 12, y: 8 };
    // Its light reaches the stub once it stops, so the stops are compared as planned.
    const stop = (s: RoomState, opVersion?: number) => stableStringify(planTrapMove(op, s as TrapRoom, P1, opVersion === undefined ? {} : { opVersion }).op);
    assert.deepEqual(at(open, op, P1, undefined, "gob"), [9, 7]);
    assert.equal(stop(walled), stop(open));
    assert.notEqual(stop(walled, 36), stop(open, 36), "at op 36 the wall decided the stop");
  });

  test("on remembered ground where the DM moved a wall, the stop is the same with and without the edit", () => {
    // A vision scene in the dark where Pat's goblin sees nothing: live ground is the DM's reveals, and the snare's cell is explored only.
    const open = squares(true);
    open.scenes.s1 = { ...open.scenes.s1!, vision: { on: true, light: "dark" } };
    open.tokens.gob = token("gob", { name: "Gob", x: 0, y: 4, ownerIds: ["p1"], kind: "pc", disposition: "ally" });
    open.traps = { snare: trap("snare", { zone: { cells: [{ x: 3, y: 5, w: 1, h: 1 }] }, rig: snare() }) };
    lift(open, "dm", { x: 0, y: 0, w: 20, h: 5 });
    lift(open, "dm", { x: 0, y: 6, w: 20, h: 14 });
    lift(open, "dm", { x: 0, y: 5, w: 3, h: 1 });
    lift(open, "dm", { x: 4, y: 5, w: 16, h: 1 });
    lift(open, "party", { x: 3, y: 5, w: 1, h: 1 });
    const seen = wall(open, "fu43p2m00001", [3.05, 5.9], [3.2, 5.9]);
    const edited = structuredClone(open);
    // The DM moved it across the goblin's cut leg, and the party remembers where it was.
    const moved = wall(edited, seen.id, [3.25, 5.25], [3.75, 5.25]);
    remember(edited, null, 0, 0, { walls: { [seen.id]: [{ wall: seen, cells: ["3,5"] }] } });
    assert.notDeepEqual(moved.a, seen.a);
    assert.equal(copies(edited), copies(open), "the players' copies start the same");
    const op: Op = { t: "token.move", tokenId: "gob", x: 6, y: 6, route: [[2, 4, 0, 0], [6, 6, 1, 0]] };
    assert.equal(after(edited, op, DM, undefined, "gob"), after(open, op, DM, undefined, "gob"));
    assert.notEqual(after(edited, op, DM, 36, "gob"), after(open, op, DM, 36, "gob"), "at op 36 the edit decided the stop");
  });

  test("on a scene where Pat sees for himself, the stop reads the ground every player sees, not his", () => {
    // Pat holds his own sight and his goblin carries a light. Ground he alone sees is not on every player's.
    const open = squares(true);
    open.scenes.s1 = { ...open.scenes.s1!, vision: { on: true, light: "dark", perPlayer: true } };
    open.holders = { s1: { sceneId: "s1", rev: 1, entries: [{ memberId: "p1", on: true }] } };
    open.tokens.gob = token("gob", { name: "Gob", x: 0, y: 4, ownerIds: ["p1"], kind: "pc", disposition: "ally", light: { bright: 20, dim: 0 } });
    open.traps = { snare: trap("snare", { zone: { cells: [{ x: 3, y: 5, w: 1, h: 1 }] }, rig: snare() }) };
    lift(open, "dm", { x: 0, y: 0, w: 20, h: 5 });
    lift(open, "dm", { x: 0, y: 6, w: 20, h: 14 });
    lift(open, "dm", { x: 0, y: 5, w: 3, h: 1 });
    lift(open, "dm", { x: 4, y: 5, w: 16, h: 1 });
    const walled = structuredClone(open);
    wall(walled, "fu43p2w00001", [3.25, 5.25], [3.75, 5.25]);
    assert.equal(copies(walled, [P2]), copies(open, [P2]), "Sam's copies start the same");
    assert.ok(pendingGround(open, "s1", "p1")!.live(3, 5) && !pendingGround(open, "s1", null)!.live(3, 5), "only Pat sees the snare's cell");
    const op: Op = { t: "token.move", tokenId: "gob", x: 6, y: 6, route: [[2, 4, 0, 0], [6, 6, 1, 0]] };
    for (const who of [P1, DM]) assert.equal(after(walled, op, who, undefined, "gob", [P2]), after(open, op, who, undefined, "gob", [P2]), who.role);
    assert.notEqual(after(walled, op, DM, 36, "gob", [P2]), after(open, op, DM, 36, "gob", [P2]), "at op 36 the wall decided the stop");
  });

  test("the straight walk's own route in the dark: a corner off the whole leg's line is no stand", () => {
    // Pat's goblin walks the straight leg from 0,0 to 6,3 by its own lattice steps, which may pass only as that one whole leg
    // (route.ts routeStop), so its corner 3,2, half a square off the leg's line, is not a spot the walk proves.
    const s = squares(true);
    s.tokens.gob = token("gob", { name: "Gob", x: 0, y: 0, ownerIds: ["p1"], kind: "pc", disposition: "ally" });
    s.traps = { snare: trap("snare", { zone: { cells: [{ x: 3, y: 2, w: 1, h: 1 }] }, rig: snare() }) };
    lift(s, "dm", { x: 0, y: 0, w: 20, h: 20 });
    lift(s, "dm", { x: 2, y: 1, w: 3, h: 3 }, "s1", false);
    const op: Op = { t: "token.move", tokenId: "gob", x: 6, y: 3, route: [[3, 2, 0, 0], [6, 3, 0, 0]] };
    const parsed = opSchema.parse(op);
    const plan = planTrapMove(parsed, s as TrapRoom, P1, {});
    assert.deepEqual(plan.springings.map((x) => x.trap.id), ["snare"]);
    assert.equal(plan.op, parsed, "no stand past the snare before the walk's end");
    // The same corner on a route that is not the straight walk's own is one.
    const bent: Op = { t: "token.move", tokenId: "gob", x: 6, y: 2, route: [[3, 2, 0, 0], [6, 2, 0, 0]] };
    const cut = planTrapMove(opSchema.parse(bent), s as TrapRoom, P1, {}).op;
    assert.deepEqual(cut.t === "token.move" ? [cut.x, cut.y] : null, [3, 2]);
  });

  test("a Large walk that starts squeezed in a fogged corridor never stops full size inside it", () => {
    // A corridor one square wide along row 5 from x 3 to 11, dark but its mouth, a snare in it, the ogre squeezed at its mouth.
    const open = squares(true, { w: 30, h: 20 });
    open.tokens.ogre = token("ogre", { name: "Ogre", size: "large", x: 2.5, y: 4.5, squeeze: true, ownerIds: ["p1"], kind: "pc", disposition: "ally" });
    open.traps = { snare: trap("snare", { zone: { cells: [{ x: 6, y: 5, w: 1, h: 1 }] }, rig: snare() }) };
    lift(open, "dm", { x: 0, y: 0, w: 30, h: 20 });
    lift(open, "dm", { x: 4, y: 3, w: 8, h: 5 }, "s1", false);
    const walled = structuredClone(open);
    wall(walled, "fu43p2k00001", [4, 5], [11, 5]);
    wall(walled, "fu43p2k00002", [4, 6], [11, 6]);
    assert.equal(copies(walled), copies(open));
    const op: Op = { t: "token.move", tokenId: "ogre", x: 15, y: 5 };
    for (const s of [open, walled]) {
      const r = applyOp(structuredClone(s), opSchema.parse(op), P1, versioned(undefined));
      assert.ok(r.ok);
      const ogre = r.state.tokens.ogre!;
      assert.ok(ogre.squeeze === true || ogre.x >= 11, `it stands full size only past the corridor, at ${ogre.x},${ogre.y}`);
    }
    assert.equal(after(walled, op, P1, undefined, "ogre"), after(open, op, P1, undefined, "ogre"));
  });

  test("Large (2,4) to (18,6), every cell revealed but 11,4: a later snapped spot of the piece stops it at 16,6, by the row hull test and by convexLive", () => {
    const s = squares(true, { w: 24, h: 12 });
    s.tokens.ogre = token("ogre", { name: "Ogre", size: "large", x: 2, y: 4, ownerIds: ["p1"], kind: "pc", disposition: "ally" });
    lift(s, "dm", { x: 0, y: 0, w: 24, h: 12 });
    lift(s, "dm", { x: 11, y: 4, w: 1, h: 1 }, "s1", false);
    const op: Op = { t: "token.move", tokenId: "ogre", x: 18, y: 6 };
    for (const tx of [10, 11, 12, 13]) {
      const r = { ...s, traps: { snare: trap("snare", { zone: { cells: [{ x: tx, y: 6, w: 1, h: 1 }] }, rig: snare() }) } };
      assert.deepEqual(at(r, op, P1, undefined, "ogre"), [16, 6], `the snare on ${tx},6`);
      setStopGroundForTests(plainGround);
      try {
        assert.deepEqual(at(r, op, P1, undefined, "ogre"), [16, 6], `the snare on ${tx},6, convexLive`);
      } finally {
        setStopGroundForTests(null);
      }
    }
  });
});

for (const [name, g] of [
  ["hex rows", ROWS],
  ["hex columns", COLUMNS],
] as const) {
  describe(`${name}: stops, the same in both rooms`, () => {
    test("a cut leg off its piece's line stops at its piece's own hex", () => {
      const [from, to, snareHex, aside, expected] = g.orient === "rows" ? [{ col: 3, row: 8 }, { col: 4, row: 12 }, { col: 3, row: 11 }, { col: 3, row: 10 }, "4,12"] : [{ col: 3, row: 8 }, { col: 4, row: 5 }, { col: 4, row: 7 }, { col: 4, row: 8 }, "4,6"];
      const open = hexes(g);
      open.tokens.gob = onHex(g, "gob", "medium", from, { name: "Gob", kind: "pc", ownerIds: ["p1"], disposition: "ally" });
      liftAllBut(open, "dm", [hexKey(aside)]);
      open.traps = { snare: trap("snare", { grid: open.scenes.s1!.gridShape, zone: { cells: [{ x: snareHex.col, y: snareHex.row, w: 1, h: 1 }] }, rig: snare() }) };
      const walled = structuredClone(open);
      stubToward(walled, g, "fu43pc000001", aside, snareHex);
      assert.equal(copies(walled), copies(open));
      const dest = onHex(g, "x", "medium", to);
      const op: Op = { t: "token.move", tokenId: "gob", x: dest.x, y: dest.y };
      for (const who of [P1, DM]) {
        const r = applyOp(structuredClone(walled), op, who, versioned(undefined));
        assert.ok(r.ok);
        assert.equal(hexOf(g, r.state, "gob"), expected);
        assert.equal(after(walled, op, who, undefined, "gob"), after(open, op, who, undefined, "gob"), who.role);
      }
      assert.notEqual(after(walled, op, P1, 36, "gob"), after(open, op, P1, 36, "gob"), "at op 36 the wall decided the stop");
    });

    test("a DM's walk through dark hexes 3,4 and 3,5 stops on the snare at 3,10 in both rooms", () => {
      const from = { col: 3, row: 2 };
      const line = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((row) => ({ col: 3, row }));
      const open = hexes(g);
      open.tokens.orc = onHex(g, "orc", "medium", from, { name: "Orc", kind: "npc", disposition: "hostile" });
      liftAllBut(open, "dm", ["3,4", "3,5"]);
      open.traps = { snare: trap("snare", { grid: open.scenes.s1!.gridShape, zone: { cells: [{ x: 3, y: 10, w: 1, h: 1 }] }, rig: snare() }) };
      const walled = structuredClone(open);
      stubToward(walled, g, "rvw000000001", { col: 3, row: 4 }, { col: 3, row: 5 });
      assert.equal(copies(walled), copies(open));
      const dest = onHex(g, "x", "medium", line[line.length - 1]!);
      const op: Op = { t: "token.move", tokenId: "orc", x: dest.x, y: dest.y };
      for (const s of [open, walled]) {
        const r = applyOp(structuredClone(s), op, DM, versioned(undefined));
        assert.ok(r.ok);
        assert.equal(hexOf(g, r.state, "orc"), "3,10");
      }
      assert.equal(after(walled, op, DM, undefined, "orc"), after(open, op, DM, undefined, "orc"));
      const old = applyOp(structuredClone(walled), op, DM, versioned(36));
      assert.ok(old.ok);
      assert.equal(hexOf(g, old.state, "orc"), "3,13", "at op 36 the wall decided the stop");
    });

    test("a height in a far dark hex changes no stop: both rooms stop at 3,11", () => {
      if (g.orient !== "rows") return;
      const open = hexes(g, { w: 20, h: 20 });
      open.tokens.gob = onHex(g, "gob", "medium", { col: 3, row: 8 }, { name: "Gob", kind: "pc", ownerIds: ["p1"], disposition: "ally" });
      liftAllBut(open, "dm", ["2,10", "17,17"]);
      open.traps = { snare: trap("snare", { grid: "hexRows", zone: { cells: [{ x: 3, y: 11, w: 1, h: 1 }] }, rig: snare() }) };
      const raised = structuredClone(open);
      heights(raised, { x: 17, y: 17, w: 1, h: 1 }, 5);
      assert.equal(copies(raised), copies(open));
      const dest = onHex(g, "x", "medium", { col: 4, row: 12 });
      const op: Op = { t: "token.move", tokenId: "gob", x: dest.x, y: dest.y };
      for (const s of [open, raised]) {
        const r = applyOp(structuredClone(s), op, P1, versioned(undefined));
        assert.ok(r.ok);
        assert.equal(hexOf(g, r.state, "gob"), "3,11");
      }
      assert.equal(after(raised, op, P1, undefined, "gob"), after(open, op, P1, undefined, "gob"));
    });

    test("a stand holding a stair hex is on that ground only where the stair's neighbors are, and a stand beside one dark hex with no stair is", () => {
      const s = hexes(g, { w: 20, h: 16 });
      const P: Hex = { col: 8, row: 7 };
      heights(s, { x: P.col, y: P.row, w: 1, h: 1 }, -5);
      stairs(s, [[P.col, P.row]], "0");
      const dark = hexNeighbors(g, P)[3]!;
      liftAllBut(s, "dm", [hexKey(dark)]);
      const t = hexWallsOf(s, { sceneId: "s1", size: "medium", x: 0, y: 0, elevation: 0 })!;
      assert.equal(sceneWalls(s.scenes.s1!, s.buildChunks).stairAt(P.col, P.row), "0");
      const ground = stopGround(s, "s1");
      assert.equal(ground.stands(t, [{ size: "medium", refs: [P] }]), false, "the stair's dark neighbor is read beside it");
      const plain = hexNeighbors(g, dark).find((h) => !hexStandHexes(g, { size: "medium", ref: h }).some((x) => hexKey(x) === hexKey(dark)) && hexKey(h) !== hexKey(P))!;
      assert.equal(ground.stands(t, [{ size: "medium", refs: [plain] }]), true, "a hex beside the dark one with no stair reads no neighbor");
      // A Large stand holding P and another hex is decided as a whole, and kept apart from P's Medium stand.
      const large = { size: "large" as const, refs: [hexNeighbors(g, P)[0]!] };
      assert.ok(hexStandHexes(g, { size: "large", ref: large.refs[0]! }).some((x) => hexKey(x) === hexKey(P)) || hexStandHexes(g, { size: "large", ref: large.refs[0]! }).every((x) => hexKey(x) !== hexKey(dark)));
      assert.equal(ground.stands(t, [large]), plainGround(s, "s1").stands(t, [large]));
    });
  });
}

/**
 * Random rooms, squares and hexes, in pairs: a
 * walker near stopping traps, Pat's walk taken only where his own check
 * takes it in both rooms, the DM's as sent. The second room adds short
 * walls inside dark cells or hexes, aimed at the cut legs and the stands.
 */
type Pair = { open: RoomState; closed: RoomState; op: Op; who: Viewer; walls: number };

function rigOf(r: () => number, pit: boolean): TrapRig {
  return snare({ floor: chance(r, 0.3), ...(pit ? { pit: { floor: -10 } } : {}) });
}

function squarePair(r: () => number, n: number, fog = true): Pair {
  const bounds = { w: 26, h: 22 };
  const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds, blockMovement: true, autoWalls: "off", fogEnabled: fog }) } });
  s.buildChunks = {};
  const size = pick(r, ["tiny", "small", "medium", "medium", "large", "large", "huge"] as const);
  const side = size === "large" ? 2 : size === "huge" ? 3 : size === "tiny" ? 0.5 : 1;
  const L = size === "medium" || size === "small" ? 1 : 0.5;
  const x0 = int(r, 1, 4);
  const y0 = int(r, 6, 12);
  const party = chance(r, 0.6);
  s.tokens.w = token("w", { size, x: x0, y: y0, name: "W", kind: party ? "pc" : "npc", disposition: party ? "ally" : "hostile", ownerIds: ["p1"] });
  const route: [number, number, number, 0 | 1][] = [];
  let [x, y] = [x0, y0];
  const pieces = chance(r, 0.5) ? 1 : int(r, 2, 3);
  const line: { x: number; y: number }[] = [{ x: x0 + side / 2, y: y0 + side / 2 }];
  for (let k = 0; k < pieces; k++) {
    const dx = int(r, 2, 12) * L * (chance(r, 0.85) ? 1 : -1);
    const dy = int(r, -6, 6) * L;
    [x, y] = [Math.min(bounds.w - side - 1, Math.max(1, x + dx)), Math.min(bounds.h - side - 1, Math.max(1, y + dy))];
    route.push([x, y, 0, 0]);
    line.push({ x: x + side / 2, y: y + side / 2 });
  }
  const op: Op = pieces === 1 && chance(r, 0.6) ? { t: "token.move", tokenId: "w", x, y } : { t: "token.move", tokenId: "w", x, y, route };
  const near: [number, number][] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    for (let t = 0; t <= 40; t++) near.push([Math.floor(a.x + ((b.x - a.x) * t) / 40), Math.floor(a.y + ((b.y - a.y) * t) / 40)]);
  }
  const around = (): [number, number] => {
    const [cx, cy] = pick(r, near);
    const d = Math.ceil(side / 2) + 1;
    return [cx + int(r, -d, d), cy + int(r, -d, d)];
  };
  for (let i = int(r, 1, 3); i > 0; i--) {
    const kind = pick(r, ["snare", "snare", "pit", "wire"] as const);
    const [cx, cy] = around();
    const zone = kind === "wire" ? { wire: { a: [cx, cy] as [number, number], b: [cx + pick(r, [0, 1, 2]), cy + pick(r, [1, 2])] as [number, number] } } : { cells: [{ x: cx, y: cy, w: kind === "pit" ? pick(r, [1, 2, 3]) : 1, h: kind === "pit" ? pick(r, [1, 2, 3]) : 1 }] };
    s.traps = { ...s.traps, [`t${i}`]: trap(`t${i}`, { zone, rig: rigOf(r, kind === "pit") }) };
  }
  lift(s, "dm", { x: 0, y: 0, w: bounds.w, h: bounds.h });
  const hidden: [number, number][] = [];
  // Aimed: a snare under a spot of the walk, and a stub inside a dark cell across the leg from its piece's start to the spot, or inside its core.
  const aims: { cell: [number, number]; a: [number, number]; b: [number, number] }[] = [];
  let walk: { x: number; y: number; progress: readonly [number, number, number] }[] = [];
  try {
    walk = trapWalks(opSchema.parse(op), s as TrapRoom, DM, {})[0]?.spots ?? [];
  } catch {
    walk = [];
  }
  const starts = [{ x: x0, y: y0 }, ...route.map(([px, py]) => ({ x: px, y: py }))];
  for (let i = int(r, 0, 3); i > 0 && walk.length > 2; i--) {
    const sp = walk[int(r, 1, walk.length - 2)]!;
    const from = starts[sp.progress[0]]!;
    const cell = { x: Math.floor(sp.x) + int(r, 0, Math.max(0, Math.ceil(side) - 1)), y: Math.floor(sp.y) + int(r, 0, Math.max(0, Math.ceil(side) - 1)) };
    s.traps = { ...s.traps, [`aim${i}`]: trap(`aim${i}`, { zone: { cells: [{ ...cell, w: 1, h: 1 }] }, rig: rigOf(r, chance(r, 0.3)) }) };
    const c0 = { x: from.x + side / 2, y: from.y + side / 2 };
    const c1 = { x: sp.x + side / 2, y: sp.y + side / 2 };
    const t = chance(r, 0.5) ? 0.5 + 0.5 * r() : 1;
    const m = { x: c0.x + (c1.x - c0.x) * t + (r() - 0.5) * Math.max(0, side - 1), y: c0.y + (c1.y - c0.y) * t + (r() - 0.5) * Math.max(0, side - 1) };
    const len = Math.hypot(c1.x - c0.x, c1.y - c0.y) || 1;
    const d = { x: -(c1.y - c0.y) / len, y: (c1.x - c0.x) / len };
    const reach = 0.05 + 0.25 * r();
    const a: [number, number] = [q(m.x + d.x * reach), q(m.y + d.y * reach)];
    const b: [number, number] = [q(m.x - d.x * reach), q(m.y - d.y * reach)];
    const own: [number, number] = [Math.floor(m.x), Math.floor(m.y)];
    const inside = ([px, py]: [number, number]) => px > own[0] && px < own[0] + 1 && py > own[1] && py < own[1] + 1;
    if (inside(a) && inside(b)) {
      aims.push({ cell: own, a, b });
      hidden.push(own);
    }
  }
  for (let i = int(r, 1, 6); i > 0; i--) hidden.push(around());
  if (chance(r, 0.3)) {
    const [cx, cy] = around();
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) hidden.push([cx + a, cy + b]);
  }
  const dark = hidden.filter(([hx, hy]) => hx >= 0 && hy >= 0 && hx < bounds.w && hy < bounds.h && !(hx >= Math.floor(x0) && hx < Math.ceil(x0 + side) && hy >= Math.floor(y0) && hy < Math.ceil(y0 + side)));
  for (const [hx, hy] of dark) lift(s, "dm", { x: hx, y: hy, w: 1, h: 1 }, "s1", false);
  const closed = structuredClone(s);
  let walls = 0;
  const darkKeys = new Set(dark.map(([a, b]) => `${a},${b}`));
  for (const aim of aims) if (darkKeys.has(`${aim.cell[0]},${aim.cell[1]}`)) wall(closed, `p2s${String(n).padStart(5, "0")}${walls++}`, aim.a, aim.b);
  for (let i = int(r, 0, 3); i > 0 && dark.length > 0; i--) {
    const [cx, cy] = pick(r, dark);
    const end = (): [number, number] => [cx + int(r, 1, 15) / 16, cy + int(r, 1, 15) / 16];
    const a = end();
    const b = end();
    if (a[0] === b[0] && a[1] === b[1]) continue;
    wall(closed, `p2s${String(n).padStart(5, "0")}${walls++}`, a, b);
  }
  return { open: s, closed, op, who: chance(r, 0.5) ? P1 : DM, walls };
}

function hexPair(r: () => number, n: number, withStairs = false): Pair {
  const [shape, g] = chance(r, 0.5) ? (["hexRows", ROWS] as const) : (["hexColumns", COLUMNS] as const);
  const bounds = { w: 22, h: 20 };
  const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { gridShape: shape, bounds, blockMovement: true, autoWalls: "off", fogEnabled: true }) } });
  s.buildChunks = {};
  const size = pick(r, ["medium", "medium", "large", "large", "huge", "gargantuan"] as const);
  const party = chance(r, 0.6);
  const start = { col: int(r, 3, 6), row: int(r, 4, 14) };
  s.tokens.w = onHex(g, "w", size, start, { name: "W", kind: party ? "pc" : "npc", disposition: party ? "ally" : "hostile", ownerIds: ["p1"] });
  const route: [number, number, number, 0 | 1][] = [];
  let here = start;
  const path: Hex[] = [start];
  const pieces = chance(r, 0.5) ? 1 : int(r, 2, 3);
  for (let k = 0; k < pieces; k++) {
    here = { col: Math.max(3, Math.min(18, here.col + int(r, 2, 9) * (chance(r, 0.85) ? 1 : -1))), row: Math.max(3, Math.min(16, here.row + int(r, -5, 5))) };
    const p = onHex(g, "x", size, here);
    route.push([p.x, p.y, 0, 0]);
    path.push(here);
  }
  const end = onHex(g, "x", size, here);
  const op: Op = pieces === 1 && chance(r, 0.6) ? { t: "token.move", tokenId: "w", x: end.x, y: end.y } : { t: "token.move", tokenId: "w", x: end.x, y: end.y, route };
  const nearHexes: Hex[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = hexCenter(g, path[i - 1]!);
    const b = hexCenter(g, path[i]!);
    for (let t = 0; t <= 30; t++) nearHexes.push(hexAt(g, { x: a.x + ((b.x - a.x) * t) / 30, y: a.y + ((b.y - a.y) * t) / 30 }));
  }
  const around = (): Hex => {
    let h = pick(r, nearHexes);
    for (let j = int(r, 0, size === "gargantuan" ? 3 : 2); j > 0; j--) h = pick(r, hexNeighbors(g, h));
    return h;
  };
  for (let i = int(r, 1, 3); i > 0; i--) {
    const h = around();
    s.traps = { ...s.traps, [`t${i}`]: trap(`t${i}`, { grid: shape, zone: { cells: [{ x: h.col, y: h.row, w: 1, h: 1 }] }, rig: rigOf(r, false) }) };
  }
  if (withStairs) {
    // Stairs and heights near the walk, so a stand holding a stair reads its neighbors.
    for (let i = int(r, 1, 4); i > 0; i--) {
      const h = around();
      if (!hexInScene(g, bounds, h)) continue;
      heights(s, { x: h.col, y: h.row, w: 1, h: 1 }, pick(r, [-5, 5]));
      if (chance(r, 0.8)) stairs(s, [[h.col, h.row]], pick(r, ["a", "0", "1", "2", "3", "4", "5"]));
    }
  }
  const startHexes = new Set([hexKey(start), ...hexNeighbors(g, start).map(hexKey)]);
  const hidden = new Set<string>();
  let walk: { x: number; y: number }[] = [];
  try {
    walk = trapWalks(opSchema.parse(op), s as TrapRoom, DM, {})[0]?.spots ?? [];
  } catch {
    walk = [];
  }
  const aims: { a: [number, number]; b: [number, number] }[] = [];
  // Aimed at the cut leg: a hex the leg from the walk's start to a spot of its first piece steps through that the piece's own line does not.
  {
    const w0 = s.tokens.w!;
    const from = hexStartStand(g, w0);
    const first = route[0] ?? [end.x, end.y];
    const leg = hexLegOf(g, from, hexEndStand(g, w0, { x: first[0], y: first[1] }));
    for (let k = 1; k < leg.line.length - 1; k++) {
      const cut = hexLegOf(g, from, hexStandAt(g, w0, onHex(g, "y", size, leg.line[k]!), false));
      const own = new Set(leg.line.slice(0, k + 1).flatMap((h) => hexStandHexes(g, { size: leg.walk, ref: h })).map(hexKey));
      const aside = cut.line.flatMap((h) => hexStandHexes(g, { size: cut.walk, ref: h })).filter((h) => !own.has(hexKey(h)));
      if (aside.length === 0 || !chance(r, 0.7)) continue;
      const h = pick(r, aside);
      const key = hexKey(h);
      if (startHexes.has(key) || !hexInScene(g, bounds, h)) continue;
      const prev = new Set(leg.line.slice(0, k).flatMap((x) => hexStandHexes(g, { size: leg.walk, ref: x })).map(hexKey));
      const fresh = hexStandHexes(g, { size: leg.walk, ref: leg.line[k]! }).filter((x) => !prev.has(hexKey(x)));
      if (fresh.length === 0) continue;
      const th = pick(r, fresh);
      s.traps = { ...s.traps, [`cut${k}`]: trap(`cut${k}`, { grid: shape, zone: { cells: [{ x: th.col, y: th.row, w: 1, h: 1 }] }, rig: rigOf(r, false) }) };
      const c = hexCenter(g, h);
      const ci = cut.line.findIndex((x) => hexStandHexes(g, { size: cut.walk, ref: x }).some((y) => hexKey(y) === key));
      // The step the cut leg takes from that stand: from each of its hexes to the neighbor the same way (movement.ts hexStepWall).
      const next = ci >= 0 && ci + 1 < cut.line.length ? hexNeighbors(g, h)[hexDirection(g, cut.line[ci]!, cut.line[ci + 1]!)] : undefined;
      if (next && hexKey(next) !== key) {
        const o = hexCenter(g, next);
        const m = { x: c.x + (o.x - c.x) * 0.3, y: c.y + (o.y - c.y) * 0.3 };
        const d = { x: -(o.y - c.y), y: o.x - c.x };
        const len = Math.hypot(d.x, d.y);
        const a: [number, number] = [q(m.x + (d.x / len) * 0.12), q(m.y + (d.y / len) * 0.12)];
        const b: [number, number] = [q(m.x - (d.x / len) * 0.12), q(m.y - (d.y / len) * 0.12)];
        if (hexKey(hexAt(g, { x: a[0], y: a[1] })) === key && hexKey(hexAt(g, { x: b[0], y: b[1] })) === key) {
          aims.push({ a, b });
          hidden.add(key);
        }
      }
      break;
    }
  }
  for (let i = int(r, 0, 3); i > 0 && walk.length > 2; i--) {
    const sp = walk[int(r, 1, walk.length - 2)]!;
    const hs = occupiedHexes(g, { ...s.tokens.w!, x: sp.x, y: sp.y });
    const th = pick(r, hs);
    s.traps = { ...s.traps, [`aim${i}`]: trap(`aim${i}`, { grid: shape, zone: { cells: [{ x: th.col, y: th.row, w: 1, h: 1 }] }, rig: rigOf(r, false) }) };
    // A hex of the stand there or beside it, and a short wall inside it across the line to a neighbor.
    let h = pick(r, hs);
    if (chance(r, 0.5)) h = pick(r, hexNeighbors(g, h));
    const c = hexCenter(g, h);
    const nb = hexCenter(g, pick(r, hexNeighbors(g, h)));
    const f = 0.1 + 0.35 * r();
    const m = { x: c.x + (nb.x - c.x) * f, y: c.y + (nb.y - c.y) * f };
    const d = { x: -(nb.y - c.y), y: nb.x - c.x };
    const len = Math.hypot(d.x, d.y);
    const reach = 0.05 + 0.15 * r();
    const a: [number, number] = [q(m.x + (d.x / len) * reach), q(m.y + (d.y / len) * reach)];
    const b: [number, number] = [q(m.x - (d.x / len) * reach), q(m.y - (d.y / len) * reach)];
    const key = hexKey(h);
    if (hexKey(hexAt(g, { x: a[0], y: a[1] })) === key && hexKey(hexAt(g, { x: b[0], y: b[1] })) === key && !startHexes.has(key) && hexInScene(g, bounds, h)) {
      aims.push({ a, b });
      hidden.add(key);
    }
  }
  for (let i = int(r, 1, 6); i > 0; i--) {
    const h = around();
    if (hexInScene(g, bounds, h) && !startHexes.has(hexKey(h))) hidden.add(hexKey(h));
  }
  liftAllBut(s, "dm", [...hidden]);
  const closed = structuredClone(s);
  let walls = 0;
  for (const aim of aims) wall(closed, `p2h${String(n).padStart(5, "0")}${walls++}`, aim.a, aim.b);
  const list = [...hidden];
  for (let i = int(r, 0, 3); i > 0 && list.length > 0; i--) {
    const key = pick(r, list);
    const [col, row] = key.split(",").map(Number) as [number, number];
    const c = hexCenter(g, { col, row });
    const pt = (): [number, number] => [q(c.x + (r() - 0.5) * 1.1 * HEX_R), q(c.y + (r() - 0.5) * 1.1 * HEX_R)];
    const a = pt();
    const b = pt();
    if (hexKey(hexAt(g, { x: a[0], y: a[1] })) !== key || hexKey(hexAt(g, { x: b[0], y: b[1] })) !== key || (a[0] === b[0] && a[1] === b[1])) continue;
    wall(closed, `p2h${String(n).padStart(5, "0")}${walls++}`, a, b);
  }
  return { open: s, closed, op, who: chance(r, 0.5) ? P1 : DM, walls };
}

/** Draft 2's reach, for holding the build's against: convexLive itself, and on hexes the reach's hexes as one set of string keys and then the neighbors of its stair hexes. */
function plainGround(before: RoomState, sceneId: string): PublicGround {
  const ground = pendingGround(before, sceneId, null);
  if (!ground) return { hull: () => false, stands: () => false };
  if (!ground.fogged) return { hull: () => true, stands: () => true };
  const live = (g: HexGrid, h: Hex) => !hexInScene(g, ground.bounds, h) || ground.keyLive(hexKey(h));
  return {
    hull: (points) => convexLive(ground, points),
    stands: (t, groups) => {
      const keys = new Map<string, Hex>();
      for (const { size, refs } of groups) for (const ref of refs) for (const h of hexStandHexes(t.g, { size, ref })) keys.set(hexKey(h), h);
      for (const h of keys.values()) if (!live(t.g, h)) return false;
      for (const h of keys.values()) {
        const facing = t.walls.stairAt(h.col, h.row);
        if (facing === undefined || facing === null) continue;
        for (const n of hexNeighbors(t.g, h)) if (!live(t.g, n)) return false;
      }
      return true;
    },
  };
}

type Tally = { taken: number; apart36: number; apart: number; checked: number; illegal: string[] };

function pairs(make: (r: () => number, n: number) => Pair, seed: number, count: number): Tally {
  const out: Tally = { taken: 0, apart36: 0, apart: 0, checked: 0, illegal: [] };
  for (let n = 0; n < count; n++) {
    const { open, closed, op, who, walls } = make(rng(seed + n), n);
    if (walls === 0) continue;
    assert.equal(sceneWalls(closed.scenes.s1!, closed.buildChunks).stored.xy.length / 4, walls, `seed ${n}: every wall stored`);
    assert.equal(copies(closed), copies(open), `seed ${n}: the players' copies start the same`);
    const parsed = opSchema.safeParse(op);
    if (!parsed.success) continue;
    // Pat's walk reaches the trap step only as his check takes it. A DM's is taken as sent, and its stops are checked only where Pat's check takes the walk.
    const legal = [canApply(parsed.data, P1, open, deps).ok, canApply(parsed.data, P1, closed, deps).ok];
    if (who.role === "player" && !(legal[0] && legal[1])) continue;
    out.taken++;
    if (after(open, parsed.data, who, 36, "w") !== after(closed, parsed.data, who, 36, "w")) out.apart36++;
    if (after(open, parsed.data, who, undefined, "w") !== after(closed, parsed.data, who, undefined, "w")) out.apart++;
    for (const [i, s] of [open, closed].entries()) {
      const plan = planTrapMove(parsed.data, s as TrapRoom, who, {});
      if (plan.op === parsed.data || !legal[i]) continue;
      out.checked++;
      if (!canApply(plan.op, P1, s, deps).ok) out.illegal.push(`seed ${n} ${JSON.stringify(plan.op)}`);
    }
  }
  return out;
}

describe("random rooms in pairs: every player's copy after a walk is the same at op 37, and every cut is one Pat's own check takes", () => {
  test("squares", () => {
    const t = pairs(squarePair, 0x9a1, 600);
    assert.deepEqual(t.illegal, []);
    assert.equal(t.apart, 0, `of ${t.taken}`);
    assert.ok(t.apart36 >= 150, `at op 36 the walls decided ${t.apart36} of ${t.taken}`);
    assert.ok(t.checked >= 150, `${t.checked} cuts checked`);
  });

  test("hexes", () => {
    const t = pairs(hexPair, 0x7b3, 700);
    assert.deepEqual(t.illegal, []);
    assert.equal(t.apart, 0, `of ${t.taken}`);
    assert.ok(t.apart36 >= 150, `at op 36 the walls decided ${t.apart36} of ${t.taken}`);
    assert.ok(t.checked >= 300, `${t.checked} cuts checked`);
  });
});

describe("with the fog off or every cell revealed, the stops are op 35's", () => {
  for (const [label, make] of [
    ["squares", (r: () => number, n: number) => squarePair(r, n)],
    ["hexes", (r: () => number, n: number) => hexPair(r, n, true)],
  ] as const) {
    test(label, () => {
      let stops = 0;
      for (let n = 0; n < 300; n++) {
        const { closed, op, who } = make(rng(0x35 + n), n);
        const parsed = opSchema.safeParse(op);
        if (!parsed.success) continue;
        const off = { ...closed, scenes: { s1: { ...closed.scenes.s1!, fogEnabled: false } } };
        const all = structuredClone(closed);
        lift(all, "dm", { x: 0, y: 0, w: all.scenes.s1!.bounds.w, h: all.scenes.s1!.bounds.h });
        for (const s of [off, all]) {
          const old = planTrapMove(parsed.data, s as TrapRoom, who, { opVersion: 35 });
          const now = planTrapMove(parsed.data, s as TrapRoom, who, {});
          assert.equal(stableStringify(now.op), stableStringify(old.op), `seed ${n}`);
          assert.equal(stableStringify(now.springings.map((x) => [x.trap.id, x.how, x.by])), stableStringify(old.springings.map((x) => [x.trap.id, x.how, x.by])), `seed ${n}`);
          if (now.op !== parsed.data) stops++;
        }
      }
      assert.ok(stops >= 100, `${stops} stops`);
    });
  }
});

describe("the build's shortcuts decide as the plain tests do", () => {
  test("the row hull test answers as convexLive on 4,000 random hulls", () => {
    let differ = 0;
    for (let i = 0; i < 4000; i++) {
      const r = rng(500 + i);
      const s = room({ members: { dm1: member("dm1", "dm") }, scenes: { s1: scene("s1", { bounds: { w: 20, h: 14 }, fogEnabled: true }) } });
      lift(s, "dm", { x: 0, y: 0, w: 20, h: 14 });
      for (let k = 0; k < 4; k++) lift(s, "dm", { x: Math.floor(r() * 20), y: Math.floor(r() * 14), w: 1, h: 1 }, "s1", false);
      const ground = pendingGround(s, "s1", null)!;
      const point = () => ({ x: Math.round((r() * 22 - 1) * 4) / 4, y: Math.round((r() * 16 - 1) * 4) / 4 });
      const hx = r() * 1.5;
      const hy = r() * 1.5;
      const a = point();
      const b = point();
      const corners = [a, b].flatMap((c) => [{ x: c.x - hx, y: c.y - hy }, { x: c.x + hx, y: c.y - hy }, { x: c.x + hx, y: c.y + hy }, { x: c.x - hx, y: c.y + hy }]);
      const hull = convexHull(r() < 0.1 ? [a] : r() < 0.2 ? [a, b] : corners);
      if (rowHullLive((x, y) => ground.live(x, y), 20, 14, hull) !== convexLive(ground, hull)) differ++;
    }
    assert.equal(differ, 0);
  });

  test("hex stands kept for the op by numeric keys plan as draft 2's string sets, on random rooms with stairs", () => {
    let plans = 0;
    for (let n = 0; n < 400; n++) {
      const { open, closed, op, who } = hexPair(rng(0xe9 + n), n, true);
      const parsed = opSchema.safeParse(op);
      if (!parsed.success) continue;
      for (const s of [open, closed]) {
        const fast = planTrapMove(parsed.data, structuredClone(s) as TrapRoom, who, {});
        setStopGroundForTests(plainGround);
        try {
          const plain = planTrapMove(parsed.data, structuredClone(s) as TrapRoom, who, {});
          assert.equal(stableStringify(fast.op), stableStringify(plain.op), `seed ${n}`);
          assert.equal(stableStringify(fast.springings.map((x) => [x.trap.id, x.how, x.by])), stableStringify(plain.springings.map((x) => [x.trap.id, x.how, x.by])), `seed ${n}`);
        } finally {
          setStopGroundForTests(null);
        }
        plans++;
      }
    }
    assert.ok(plans >= 600, `${plans} plans`);
  });

  test("random square plans by the row hull test equal convexLive's", () => {
    for (let n = 0; n < 300; n++) {
      const { open, closed, op, who } = squarePair(rng(0x51 + n), n);
      const parsed = opSchema.safeParse(op);
      if (!parsed.success) continue;
      for (const s of [open, closed]) {
        const fast = planTrapMove(parsed.data, structuredClone(s) as TrapRoom, who, {});
        setStopGroundForTests(plainGround);
        try {
          assert.equal(stableStringify(planTrapMove(parsed.data, structuredClone(s) as TrapRoom, who, {}).op), stableStringify(fast.op), `seed ${n}`);
        } finally {
          setStopGroundForTests(null);
        }
      }
    }
  });
});

