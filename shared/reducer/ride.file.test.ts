import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { wall } from "../discoveryTestutil.ts";
import { followsInSingleFile } from "../migrate.ts";
import type { RoomState, Token, Viewer } from "../model.ts";
import { canApply } from "../permissions.ts";
import { projectState, stableStringify } from "../project.ts";
import type { OpOf } from "../protocol.ts";
import { applyOp } from "../reducer.ts";
import { footprintSize } from "../rules/footprint.ts";
import { findRouteOn } from "../rules/hexWalk.ts";
import { planMove } from "../rules/moveLeg.ts";
import { offGridWallThrough, ownWalk, walkEnd } from "../rules/movement.ts";
import { fileRoutes } from "../rules/route.ts";
import { compareProgress, trapWalks } from "../rules/traps.ts";
import { groupWalkWorld } from "../rules/walkWorld.ts";
import { env, member, P1, P2, room, scene, token, trap } from "../testutil.ts";

/**
 * What a holder drags follows it in single file where its move ends
 * squeezed on squares (D-261101-250, live play LP28-B-RIDE-1, op version
 * 38): along the holder's own line, its middle on the holder's at each
 * corner, and last just behind the holder's squeezed footprint. A goblin a
 * warhorse drags goes with it into a corridor one square wide, where by
 * its place beside the horse it met the rock. Ops stored before 38 replay
 * by its place. The corridor runs along row 6 through rock from x 6 to 14.
 */

function corridor(): RoomState {
  const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds: { w: 22, h: 12 }, blockMovement: true, autoWalls: "off" }) } });
  s.buildChunks = {};
  const runs: [[number, number], [number, number]][] = [[[6, 0], [6, 6]], [[6, 7], [6, 12]], [[14, 0], [14, 6]], [[14, 7], [14, 12]], [[6, 6], [14, 6]], [[6, 7], [14, 7]]];
  runs.forEach(([a, b], i) => wall(s, `fu45bf${String(i).padStart(6, "0")}`, a, b));
  s.tokens.horse = token("horse", { size: "large", x: 2, y: 5, name: "Warhorse", kind: "npc", ownerIds: ["p1"] });
  return s;
}

function towing(s: RoomState, id: string, over: Partial<Token>): RoomState {
  return { ...s, tokens: { ...s.tokens, [id]: token(id, { name: id, kind: "npc", attached: { to: "horse", kind: "drag" }, ...over }) } };
}

/** The horse's own way to `to`, squeezed there, as the device's search finds it with nothing in tow. */
function into(s: RoomState, to = { x: 9.5, y: 5.5 }): OpOf<"token.move"> {
  const { towed: _towed, ...input } = groupWalkWorld(s, ownWalk(s.tokens.horse!), { role: "player" }).input;
  const found = findRouteOn(input, to);
  assert.ok(found && found !== "none", "a way in for the horse alone");
  return { t: "token.move", tokenId: "horse", ...to, squeeze: true, route: found.pieces.map(([x, y, extra, swim]): [number, number, number, 0 | 1] => [x, y, extra, swim]) };
}

const walkOf = (s: RoomState, op: OpOf<"token.move">, id: string, opVersion?: number, who: Viewer = P1) =>
  planMove(op, s, who, opVersion === undefined ? {} : { opVersion }).find((m) => m.tokenId === id)?.route.map((p) => [p.x, p.y]);

function served(s: RoomState, op: OpOf<"token.move">, who: Viewer = P1, opVersion?: number): RoomState {
  const allowed = canApply(op, who, s, { canUseAsset: () => true });
  assert.ok(allowed.ok, allowed.ok ? "" : allowed.message);
  const r = applyOp(s, op, who, { ...env(5), ...(opVersion !== undefined ? { opVersion } : {}) });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.state;
}

describe("squares: what a holder drags follows it in single file where its move ends squeezed (D-261101-250)", () => {
  test("a goblin dragged into a corridor one square wide walks the horse's line and ends right behind it, and the server takes it", () => {
    const s = towing(corridor(), "gob", { x: 1, y: 6 });
    const op = into(s);
    assert.deepEqual(op.route, [[2.5, 5.5, 1, 0], [4, 5.5, 1, 0], [9.5, 5.5, 2, 0]]);
    assert.deepEqual(walkOf(s, op, "gob"), [[1, 6], [3, 6], [4.5, 6], [9, 6]], "on the horse's middle at each corner, behind its squeezed square at the end");
    const after = served(s, op);
    assert.deepEqual([after.tokens.horse!.x, after.tokens.horse!.y, after.tokens.horse!.squeeze], [9.5, 5.5, true]);
    assert.deepEqual([after.tokens.gob!.x, after.tokens.gob!.y, after.tokens.gob!.attached?.to], [9, 6, "horse"], "still in tow");
  });

  test("an op stored before version 38 takes it by its place, so the server's check of that walk refused it and it replays as it was", () => {
    const s = towing(corridor(), "gob", { x: 1, y: 6 });
    const op = into(s);
    assert.deepEqual(walkOf(s, op, "gob", 37), [[1, 6], [1.5, 6.5], [3, 6.5], [8.5, 6.5]]);
    const r = applyOp(s, op, P1, { ...env(5), opVersion: 37 });
    assert.ok(r.ok);
    assert.deepEqual([r.state.tokens.gob!.x, r.state.tokens.gob!.y], [8.5, 6.5]);
    assert.equal(followsInSingleFile(37), false);
    assert.equal(followsInSingleFile(38), true);
    assert.equal(followsInSingleFile(undefined), true);
  });

  test("a walk that ends full size takes them by their places, as before", () => {
    const s = towing(corridor(), "gob", { x: 1, y: 6 });
    const op: OpOf<"token.move"> = { t: "token.move", tokenId: "horse", x: 4, y: 5 };
    assert.deepEqual(walkOf(s, op, "gob"), walkOf(s, op, "gob", 37));
    assert.deepEqual(walkOf(s, op, "gob"), [[1, 6], [3, 6]]);
  });

  test("two goblins the horse drags: the one nearer goes first, and the other, 10 ft from the horse there, cannot follow (D-261101-397)", () => {
    // The goblin at the horse's corner, the imp below it, whose middle is the nearer to the horse's where the walk starts.
    let s = towing(corridor(), "gob", { x: 1, y: 7 });
    s = towing(s, "imp", { x: 3, y: 7 });
    const op = into(s);
    assert.deepEqual([walkOf(s, op, "imp")?.at(-1), walkOf(s, op, "gob")?.at(-1)], [[9, 6], [8, 6]], "the imp right behind the horse, the goblin behind it");
    // So the drag holds at the corridor's mouth, as the device holds it, and never lets the goblin go unsaid.
    assert.deepEqual(canApply(op, P1, s, { canUseAsset: () => true }), { ok: false, code: "forbidden", message: "gob can't follow through there." });
  });

  test("a goblin the imp drags lines up behind the imp, in reach of its own holder, so both go and both hold on", () => {
    let s = towing(corridor(), "imp", { x: 3, y: 7 });
    s = { ...s, tokens: { ...s.tokens, gob: token("gob", { x: 1, y: 7, name: "gob", kind: "npc", attached: { to: "imp", kind: "drag" } }) } };
    const after = served(s, into(s));
    assert.deepEqual([after.tokens.imp!.x, after.tokens.imp!.y, after.tokens.imp!.attached?.to], [9, 6, "horse"]);
    assert.deepEqual([after.tokens.gob!.x, after.tokens.gob!.y, after.tokens.gob!.attached?.to], [8, 6, "imp"]);
  });

  test("one players cannot see lines up behind those they see, so the visible one's place reads nothing of it, and it reaches no player", () => {
    // The goblin at the horse's corner, the hidden imp below it, nearer the horse: by nearness alone the imp would go first.
    const seen = towing(corridor(), "gob", { x: 1, y: 7 });
    const both = towing(seen, "imp", { x: 3, y: 7, visibility: "dm" });
    const op = into(seen);
    const alone = served(seen, op);
    const after = served(both, op);
    assert.deepEqual([after.tokens.gob!.x, after.tokens.gob!.y, after.tokens.gob!.attached?.to], [alone.tokens.gob!.x, alone.tokens.gob!.y, "horse"], "the goblin right behind the horse, as with no imp");
    // 10 ft from the horse there, it lets go, as a hidden creature in tow does where it cannot follow, and no refusal reads it.
    assert.deepEqual([after.tokens.imp!.x, after.tokens.imp!.y, after.tokens.imp!.attached], [8, 6, undefined], "the hidden imp behind the goblin, let go");
    for (const who of [P1, P2]) assert.equal(stableStringify(projectState(after, who, { sceneId: "s1" })), stableStringify(projectState(alone, who, { sceneId: "s1" })), `${who.memberId} is sent the same`);
  });

  test("a Large creature in tow lines up along the corridor's middle, squeezed sides apart, where its stand is a real narrow space's, and the server takes it", () => {
    const s = towing(corridor(), "ogre", { size: "large", x: 0, y: 5 });
    const op = into(s);
    const after = served(s, op);
    const ogre = after.tokens.ogre!;
    assert.deepEqual([ogre.x, ogre.y, ogre.attached?.to], [8.5, 5.5, "horse"]);
    assert.equal(offGridWallThrough(after, walkEnd(after, ownWalk({ ...ogre, x: 7, y: 5.5 }), ogre)), false, "off its grid, but in a narrow space it could squeeze through");
  });

  test("a goblin that cannot walk onto the horse's line refuses the player's move with the walls' words", () => {
    const s = towing(corridor(), "gob", { x: 1, y: 4 });
    // A stub across its way down onto the horse's line, clear of the horse's core.
    wall(s, "fu45bf000009", [2.25, 5.625], [2.625, 5.25]);
    const op = into(s);
    const refused = canApply(op, P1, s, { canUseAsset: () => true });
    assert.deepEqual(refused, { ok: false, code: "forbidden", message: "A wall is in the way." });
    assert.ok(canApply(op, { memberId: "dm1", role: "dm" }, s, { canUseAsset: () => true }).ok, "the DM's move meets no walls");
  });

  test("a trap that stops the walk at the corridor's mouth stops what it drags where its walk in the file had it at the stop", () => {
    const s = towing(corridor(), "gob", { x: 1, y: 6 });
    s.traps.t1 = trap("t1", { zone: { cells: [{ x: 4, y: 5, w: 1, h: 2 }] }, rig: { on: ["enter"], who: "any", floor: true, resets: "never", stops: true, foundOnSpring: true, hits: "trigger", actions: [], find: [], notice: false } });
    const op = into(s);
    const after = served(s, op);
    // The stop stands it squeezed at the mouth. The file walks the horse's own line, so at that moment the goblin is on the square
    // the horse squeezes onto, where the trap step read it (review FU45B-ASTRA-01).
    assert.deepEqual([after.tokens.horse!.x, after.tokens.horse!.y, after.tokens.horse!.squeeze], [4.5, 5.5, true]);
    assert.deepEqual([after.tokens.gob!.x, after.tokens.gob!.y, after.tokens.gob!.attached?.to], [5, 6, "horse"]);
    assert.equal(after.traps.t1!.state, "sprung");
  });

  test("a trap that stops the walk where the horse stands full size stops a creature in the file where its own walk had it then, never by its place (review FU45B-ASTRA-01)", () => {
    const s = towing(corridor(), "ogre", { size: "large", x: 0, y: 7 });
    // A stub its place beside the horse would meet, which its walk in single file never does.
    wall(s, "fu45bf000010", [2.25, 7.75], [2.25, 8]);
    s.traps.t1 = trap("t1", { zone: { cells: [{ x: 4, y: 5, w: 1, h: 2 }] }, rig: { on: ["enter"], who: "any", floor: true, resets: "never", stops: true, foundOnSpring: true, hits: "trigger", actions: [], find: [], notice: false } });
    const op: OpOf<"token.move"> = { t: "token.move", tokenId: "horse", x: 9.5, y: 5.5, squeeze: true, route: [[3, 5, 1, 0], [3.5, 5.5, 1, 0], [4, 5.5, 1, 0], [9.5, 5.5, 2, 0]] };
    const after = served(s, op);
    const horse = after.tokens.horse!;
    assert.deepEqual([horse.x, horse.y, horse.squeeze], [3, 5, undefined], "stopped full size on the trap");
    // Where the trap step's walk of it stood at the horse's stop: its latest spot at or before it.
    const walks = trapWalks(op, s, P1, {});
    const stop = walks.find((w) => w.tokenId === "horse")!.spots.find((p) => p.x === 3 && p.y === 5)!.progress;
    const seen = walks.find((w) => w.tokenId === "ogre")!.spots.filter((p) => compareProgress(p.progress, stop) <= 0).at(-1)!;
    const ogre = after.tokens.ogre!;
    assert.deepEqual([ogre.x, ogre.y, ogre.attached?.to], [seen.x, seen.y, "horse"], "where its walk had it at the stop, still in tow");
    const box = { x0: ogre.x, x1: ogre.x + 2, y0: ogre.y, y1: ogre.y + 2 };
    assert.ok(!(box.x0 < 2.25 && 2.25 < box.x1 && box.y0 < 8 && box.y1 > 7.75), `no wall through its box at ${ogre.x}, ${ogre.y}`);
  });

  test("a hidden creature in the file changes nothing players see of a trap's cut: the visible one stops where it stops with none", () => {
    const setup = (hidden: boolean) => {
      let s = towing(corridor(), "ogre", { size: "large", x: 0, y: 7 });
      // Nearer the horse than the ogre, so by nearness alone it would go first.
      if (hidden) s = towing(s, "imp", { x: 1, y: 4, visibility: "dm" });
      s.traps.t1 = trap("t1", { zone: { cells: [{ x: 4, y: 5, w: 1, h: 2 }] }, rig: { on: ["enter"], who: "any", floor: true, resets: "never", stops: true, foundOnSpring: true, hits: "trigger", actions: [], find: [], notice: false } });
      return s;
    };
    const op: OpOf<"token.move"> = { t: "token.move", tokenId: "horse", x: 9.5, y: 5.5, squeeze: true, route: [[3, 5, 1, 0], [3.5, 5.5, 1, 0], [4, 5.5, 1, 0], [9.5, 5.5, 2, 0]] };
    const alone = served(setup(false), op);
    const both = served(setup(true), op);
    assert.deepEqual([both.tokens.ogre!.x, both.tokens.ogre!.y], [alone.tokens.ogre!.x, alone.tokens.ogre!.y]);
    for (const who of [P1, P2]) assert.equal(stableStringify(projectState(both, who, { sceneId: "s1" })), stableStringify(projectState(alone, who, { sceneId: "s1" })), `${who.memberId} is sent the same`);
  });

  test("a hidden creature in the file that a wall stops takes the one it drags no further than itself along the walk (review FU45B-ASTRA-03)", () => {
    let s = towing(corridor(), "imp", { x: 1, y: 4, visibility: "dm" });
    s = { ...s, tokens: { ...s.tokens, rat: token("rat", { x: 0, y: 4, name: "rat", kind: "npc", visibility: "dm", attached: { to: "imp", kind: "drag" } }) } };
    // Across the imp's way down onto the horse's line.
    wall(s, "fu45bf000011", [2.25, 4.75], [2.25, 5]);
    const op: OpOf<"token.move"> = { t: "token.move", tokenId: "horse", x: 9.5, y: 5.5, squeeze: true, route: [[4, 5.5, 1, 0], [9.5, 5.5, 2, 0]] };
    const after = served(s, op);
    const imp = after.tokens.imp!;
    const rat = after.tokens.rat!;
    // Left behind by the horse, so out of its reach, as any hidden creature in tow a wall stops.
    assert.deepEqual([imp.x, imp.y, imp.attached], [2, 5, undefined], "the imp stops at the wall");
    assert.equal(rat.attached?.to, "imp", `the rat still in the imp's tow, at ${rat.x}, ${rat.y}`);
    assert.ok(rat.x <= imp.x, `no further along than the imp: ${rat.x}, ${rat.y}`);
  });

  test("the file spaces them alike whichever way the walk goes, a step that falls halfway taken toward the holder (review FU45BR-OPUS-7)", () => {
    // A Tiny creature first in line leaves the Medium one behind it halfway between two of its steps.
    for (const [size, gaps] of [["large", [-0.75, -1]], ["huge", [-1.25, -1.5]]] as const) {
      const behind = (dir: 1 | -1) => {
        // Its squeezed box on whole squares where the walk ends, as a squeeze must stand.
        const lead = { size, x: 19.5 - dir * 6, y: 19.5 };
        const members = [{ id: "tiny", size: "tiny" as const, x: lead.x - dir * 4, y: 19.5 }, { id: "gob", size: "medium" as const, x: lead.x - dir * 8, y: 19.5 }];
        const file = fileRoutes(lead, [{ x: lead.x, y: lead.y }, { x: 19.5, y: 19.5 }], [members]);
        const middle = 19.5 + footprintSize(lead).w / 2;
        // How far behind the holder's middle each one's middle ends, along the walk.
        return members.map((m) => (file.get(m.id)!.at(-1)!.x + footprintSize(m).w / 2 - middle) * dir);
      };
      assert.deepEqual(behind(1), gaps, `${size} east`);
      assert.deepEqual(behind(-1), gaps, `${size} west`);
    }
  });

  test("a goblin the file would leave where it stands, out of the horse's reach, is judged as one that moves (review FU45B-ASTRA-04)", () => {
    const base = corridor();
    let s: RoomState = { ...base, tokens: { ...base.tokens, horse: { ...base.tokens.horse!, x: 8.5, y: 5.5, squeeze: true } } };
    s = towing(s, "imp", { x: 9, y: 6 });
    s = towing(s, "gob", { x: 8, y: 6 });
    const op: OpOf<"token.move"> = { t: "token.move", tokenId: "horse", x: 9.5, y: 5.5, squeeze: true, route: [[9.5, 5.5, 1, 0]] };
    // Each ends where it starts, so the move writes neither, and the goblin, 10 ft from the horse there, would let go.
    assert.deepEqual([walkOf(s, op, "imp"), walkOf(s, op, "gob")], [undefined, undefined], "the plan moves neither");
    assert.deepEqual(canApply(op, P1, s, { canUseAsset: () => true }), { ok: false, code: "forbidden", message: "gob can't follow through there." });
  });

  test("a stop carries down through a creature it carries: a hidden rat its owl drags stops no further along than the stopped imp (review FU45B-ASTRA-05)", () => {
    let s = towing(corridor(), "imp", { x: 1, y: 4, visibility: "dm" });
    s = { ...s, tokens: { ...s.tokens, owl: token("owl", { size: "tiny", x: 1, y: 4, name: "owl", kind: "npc", visibility: "dm", attached: { to: "imp", kind: "carry" } }), rat: token("rat", { x: 0, y: 4, name: "rat", kind: "npc", visibility: "dm", attached: { to: "owl", kind: "drag" } }) } };
    wall(s, "fu45bf000012", [2.25, 4.75], [2.25, 5]);
    const op: OpOf<"token.move"> = { t: "token.move", tokenId: "horse", x: 9.5, y: 5.5, squeeze: true, route: [[4, 5.5, 1, 0], [9.5, 5.5, 2, 0]] };
    const after = served(s, op);
    const [imp, owl, rat] = [after.tokens.imp!, after.tokens.owl!, after.tokens.rat!];
    assert.deepEqual([imp.x, imp.y, owl.x, owl.y, owl.attached?.to], [2, 5, 2, 5, "imp"], "the imp stops at the wall, the owl in its arms");
    assert.equal(rat.attached?.to, "owl", `the rat still in the owl's tow, at ${rat.x}, ${rat.y}`);
    assert.ok(rat.x <= imp.x, `no further along than the imp: ${rat.x}, ${rat.y}`);
  });
});
