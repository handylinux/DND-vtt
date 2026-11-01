import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { heights, wall } from "../discoveryTestutil.ts";
import type { RoomState, Token } from "../model.ts";
import { canApply } from "../permissions.ts";
import type { Op, OpOf } from "../protocol.ts";
import { applyOp } from "../reducer.ts";
import { movementRules } from "../ruleHooks.ts";
import { offGridWallThrough, ownWalk, walkEnd } from "../rules/movement.ts";
import { linkHolds } from "../rules/attach.ts";
import { SQUARES } from "../rules/grid.ts";
import { planWalks, walkedIn } from "../rules/moveLeg.ts";
import { planTrapMove, trapLandings, trapWalks } from "../rules/traps.ts";
import { chance, env, int, member, P1, pick, rng, room, scene, token, trap } from "../testutil.ts";

/**
 * Random walks in single file aimed at one class of case (review
 * FU45B-ASTRA-06 to 08): a creature in the file whose walk ends where it
 * started, as on a loop, or that has not moved yet where a trap cuts the
 * walk, is walked like any other. Loops out of a corridor one square wide
 * and back in, followers placed on the holder's first corner so their
 * first piece has no length, carried chains (an imp carrying an owl that
 * drags a rat), creatures players cannot see, raised ground, stopping
 * traps and floor traps. For every move the server takes: every walk of a
 * creature every player sees in the file passes the leg test, on the cut
 * walk too, dispatch puts every token where the trap step's walks had it,
 * every walk of the group is in the lead's trap group, every link the
 * public pass walks holds, and every token every player sees stands where
 * the move's own stand test lets it stand (review FU45B-ASTRA-10). A
 * second loop does the same for group moves of two groups, a trap
 * stopping one, both or neither, a Large creature every player sees
 * dragged by a creature they may not see toward a wall it could stand
 * across half a square off its grid (review FU45BR-OPUS-12).
 */

/** A corridor one square wide along row 6, from x 6 to 14, its mouth to the west. */
function corridor(): RoomState {
  const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds: { w: 22, h: 12 }, blockMovement: true, autoWalls: "off" }) } });
  s.buildChunks = {};
  const runs: [[number, number], [number, number]][] = [[[6, 0], [6, 6]], [[6, 7], [6, 12]], [[14, 0], [14, 6]], [[14, 7], [14, 12]], [[6, 6], [14, 6]], [[6, 7], [14, 7]]];
  runs.forEach(([a, b], i) => wall(s, `fu45bl${String(i).padStart(6, "0")}`, a, b));
  return s;
}

type Case = { state: RoomState; op: OpOf<"token.move"> };

function caseOf(seed: number): Case | null {
  const r = rng(seed * 7727 + 11);
  const s = corridor();
  // Squeezed in the corridor, or west of it in the open.
  const inside = chance(r, 0.6);
  const hx = inside ? pick(r, [7.5, 8.5, 9.5, 10.5]) : int(r, 1, 3);
  const hy = inside ? 5.5 : int(r, 3, 6);
  s.tokens.horse = token("horse", { size: "large", x: hx, y: hy, name: "Warhorse", kind: "npc", ownerIds: ["p1"], ...(inside ? { squeeze: true as const } : {}) });
  // The walk: out of the corridor's mouth from inside it, to a corner or two west of it, then into it, ending squeezed, often back
  // where it started.
  const corners: [number, number][] = inside ? [[5, 5.5]] : [];
  for (let k = int(r, 1, 2); k > 0; k--) corners.push([int(r, 0, 8) / 2, int(r, 6, 16) / 2]);
  const end: [number, number] = inside && chance(r, 0.7) ? [hx, hy] : [pick(r, [7.5, 8.5, 9.5, 10.5, 11.5]), 5.5];
  const route: [number, number, number, 0 | 1][] = [...corners, [Math.min(end[0], 5), 5.5] as [number, number], end].map(([x, y]) => [x, y, 1, 0]);
  const first = route[0]!;
  // Followers: in the corridor behind a horse squeezed in it, where a loop back leaves them where they started; else some on the
  // walk's first corner, so their first piece in the file has no length, and the rest beside the horse.
  let behind = Math.floor(hx) + 1;
  const near = (big: boolean): [number, number] => {
    if (inside) return big ? [(behind -= 2) + 0.5, 5.5] : [(behind -= 1), 6];
    if (chance(r, 0.3)) return [first[0] + (big ? 0 : 0.5), first[1] + (big ? 0 : 0.5)];
    const side = pick(r, [[-1, 0], [2, 0], [0, -1], [0, 2], [-1, 1]] as const);
    return [Math.floor(hx) + side[0], Math.floor(hy) + side[1]];
  };
  const hidden = (): Partial<Token> => (chance(r, 0.25) ? { visibility: "dm" } : {});
  const lifted = (): Partial<Token> => (chance(r, 0.2) ? { elevation: 5 } : {});
  const [ix, iy] = near(false);
  s.tokens.imp = token("imp", { x: ix, y: iy, name: "imp", kind: "npc", attached: { to: "horse", kind: "drag" }, ...hidden(), ...lifted() });
  if (chance(r, 0.6)) {
    s.tokens.owl = token("owl", { size: "tiny", x: ix, y: iy, elevation: s.tokens.imp.elevation, name: "owl", kind: "npc", attached: { to: "imp", kind: "carry" }, ...hidden() });
    if (chance(r, 0.7)) {
      const [rx, ry] = inside ? near(false) : [ix - 1, iy];
      s.tokens.rat = token("rat", { x: rx, y: ry, name: "rat", kind: "npc", attached: { to: "owl", kind: "drag" }, ...hidden() });
    }
  }
  if (chance(r, 0.4)) {
    const big = chance(r, 0.3);
    const [ox, oy] = near(big);
    // Dragged by the horse, or by the last in line, which keeps it in reach of its own holder in the corridor.
    const by = inside ? (s.tokens.rat ? "rat" : "imp") : chance(r, 0.5) ? "imp" : "horse";
    s.tokens.ogre = token("ogre", { size: big ? "large" : "medium", x: ox, y: oy, name: "ogre", kind: "npc", attached: { to: by, kind: "drag" }, ...hidden(), ...lifted() });
  }
  // Traps on the way: one that stops a walk, and some on the floor, at cells the walk passes.
  const cells = [...route.map(([x, y]) => [Math.floor(x), Math.floor(y)]), [Math.floor(hx), Math.floor(hy)]];
  for (let k = int(r, 1, 3); k > 0; k--) {
    const [cx, cy] = pick(r, cells)!;
    const dx = int(r, -1, 1);
    const stops = k === 1 && chance(r, 0.7);
    s.traps[`t${k}`] = trap(`t${k}`, { zone: { cells: [{ x: cx! + dx, y: cy! + int(r, 0, 1), w: 1, h: stops ? 2 : 1 }] }, rig: { on: ["enter"], who: pick(r, ["any", "others"] as const), floor: true, resets: "never", stops, foundOnSpring: true, hits: "trigger", actions: [], find: [], notice: false } });
  }
  if (chance(r, 0.3)) heights(s, { x: int(r, 0, 4), y: int(r, 3, 8), w: int(r, 1, 3), h: 1 }, pick(r, [2, 5]));
  const holds = Object.values(s.tokens).every((t) => !t!.attached || linkHolds(SQUARES, s.meta.settings, t!.attached.kind, t!, s.tokens[t!.attached.to]!));
  if (!holds) return null;
  return { state: s, op: { t: "token.move", tokenId: "horse", x: end[0], y: end[1], squeeze: true, route } };
}

/**
 * Whether each token every player sees lands where the move's own stand test lets it stand full size (movement.ts
 * offGridWallThrough, migrate.ts stopsStandClear): its box off its grid crosses no wall, but in a real narrow space.
 */
function standsClear(before: RoomState, after: RoomState, at: string): void {
  for (const t of Object.values(after.tokens)) {
    if (!t || t.visibility === "dm" || t.squeeze === true) continue;
    const from = before.tokens[t.id]!;
    assert.equal(offGridWallThrough(after, walkEnd(after, ownWalk({ ...t, x: from.x, y: from.y, elevation: from.elevation }), t)), false, `${at}: ${t.id} stands at ${t.x}, ${t.y} with a wall through its box`);
  }
}

describe("squares: random loops and cuts in single file (review FU45B-ASTRA-06 to 08)", () => {
  test("every creature in the file is walked alike, moved or not: walls, the trap step's poses, its groups and links", () => {
    let taken = 0;
    let loops = 0;
    let cuts = 0;
    let still = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      const made = caseOf(seed);
      if (!made) continue;
      const { state: s, op } = made;
      if (!canApply(op, P1, s, { canUseAsset: () => true }).ok) continue;
      taken++;
      const at = `seed ${seed}: ${JSON.stringify(op)}`;
      const horse = s.tokens.horse!;
      if (op.x === horse.x && op.y === horse.y) loops++;
      const walks = planWalks(op, s, P1, {});
      const walked = walkedIn(walks);
      if (walks.some((m) => m.carriedBy !== undefined && walked(m) && m.from.x === m.to.x && m.from.y === m.to.y && m.from.elevation === m.to.elevation)) still++;
      // The walk dispatch moves, cut where a trap stops it: each walk every player sees in it passes the leg test.
      const cut = planTrapMove(op, s, P1, {}).op;
      if (cut !== op) cuts++;
      const cutWalks = planWalks(cut, s, P1, {});
      const cutWalked = walkedIn(cutWalks);
      for (const m of cutWalks) {
        if (m.carriedBy === undefined || m.pass !== "public" || !cutWalked(m) || s.tokens[m.tokenId]?.attached?.kind !== "drag") continue;
        for (let i = 1; i < m.route.length; i++) assert.equal(movementRules.legBlocker(s, m.trace[i - 1]!, { ...m.route[i]!, squeeze: false }), null, `${at}: ${m.tokenId} leg ${i}`);
      }
      // Every walk of the group is in the horse's trap group, whether it moved or not.
      for (const w of trapWalks(op, s, P1, {})) assert.equal(w.group, "horse", `${at}: ${w.tokenId}'s trap group`);
      // Dispatch puts each token where the trap step's walks left it.
      const r = applyOp(s, op, P1, env(5));
      assert.ok(r.ok, at);
      for (const [id, pose] of trapLandings(op, s, P1, {})) {
        const t: Token = r.state.tokens[id]!;
        assert.deepEqual([t.x, t.y, t.elevation], [pose.x, pose.y, pose.elevation], `${at}: ${id} where the trap step left it`);
      }
      standsClear(s, r.state, at);
      // Every link the public pass walks holds: one under a holder players cannot see may let go, unread (D-261101-397).
      for (const m of walks) {
        const link = s.tokens[m.tokenId]!.attached;
        if (!link || m.pass !== "public") continue;
        assert.equal(r.state.tokens[m.tokenId]!.attached?.to, link.to, `${at}: ${m.tokenId} still held`);
      }
    }
    // Enough of the class that the rules above meet it: moves taken, loops back to the start, trap cuts, and creatures walked that
    // end where they started.
    assert.ok(taken >= 900, `moves taken: ${taken}`);
    assert.ok(loops >= 500, `loops: ${loops}`);
    assert.ok(cuts >= 430, `trap cuts: ${cuts}`);
    assert.ok(still >= 470, `walked, ending where they started: ${still}`);
  });

  test("a group move a trap cuts lands each group's walks as the trap step judged them, a group it never stopped as any move, and none across a wall (review FU45BR-OPUS-12, FU45B-ASTRA-10)", () => {
    let taken = 0;
    let cuts = 0;
    let oneStopped = 0;
    let ownJudged = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const r = rng(seed * 6007 + 5);
      const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds: { w: 30, h: 20 }, blockMovement: true, autoWalls: "off" }) } });
      s.buildChunks = {};
      // A wall ahead of the first fighter's walk, which a Large creature it takes along half a square off the grid can stand across.
      const wx = int(r, 20, 22);
      wall(s, "fu45bm000000", [wx, int(r, 13, 14)], [wx, 16]);
      s.tokens.pc = token("pc", { x: 16, y: 13, name: "Pc", kind: "pc", ownerIds: ["p1"] });
      const viaRat = chance(r, 0.7);
      if (viaRat) s.tokens.rat = token("rat", { x: 15.5, y: 14, name: "Rat", kind: "npc", ownerIds: [], ...(chance(r, 0.7) ? { visibility: "dm" as const } : {}), attached: { to: "pc", kind: "drag" } });
      s.tokens.brute = token("brute", { size: "large", x: pick(r, [16, 16.5]), y: 14, name: "Brute", kind: "npc", ownerIds: [], ...(chance(r, 0.2) ? { visibility: "dm" as const } : {}), attached: { to: viaRat ? "rat" : "pc", kind: "drag" } });
      // The second fighter walks elsewhere, into a trap that stops it on most seeds, with a goblin it drags on some.
      s.tokens.pc2 = token("pc2", { x: 2, y: 2, name: "Pc2", kind: "pc", ownerIds: ["p1"] });
      if (chance(r, 0.5)) s.tokens.gob = token("gob", { x: 1, y: 2, name: "Gob", kind: "npc", attached: { to: "pc2", kind: "drag" } });
      if (chance(r, 0.8)) s.traps.t1 = trap("t1", { zone: { cells: [{ x: int(r, 3, 7), y: 2, w: 1, h: 1 }] } });
      if (chance(r, 0.7)) s.traps.t2 = trap("t2", { zone: { cells: [{ x: int(r, 17, 21), y: int(r, 13, 15), w: 1, h: 1 }] }, rig: { on: ["enter"], who: "any", floor: true, resets: "never", stops: chance(r, 0.7), foundOnSpring: true, hits: "trigger", actions: [], find: [], notice: false } });
      const holds = Object.values(s.tokens).every((t) => !t!.attached || linkHolds(SQUARES, s.meta.settings, t!.attached.kind, t!, s.tokens[t!.attached.to]!));
      if (!holds) continue;
      const moves = [{ tokenId: "pc", x: int(r, 18, 21), y: 13 }, { tokenId: "pc2", x: 8, y: 2 }];
      const op: Op = { t: "token.moveMany", moves: chance(r, 0.5) ? moves : [moves[1]!, moves[0]!] };
      if (!canApply(op, P1, s, { canUseAsset: () => true }).ok) continue;
      taken++;
      const at = `seed ${seed}: ${JSON.stringify(op)}`;
      const cutOp = planTrapMove(op, s, P1, {}).op;
      if (cutOp !== op) cuts++;
      // The groups the trap stopped: those whose named token's move the cut changed.
      const stopped = new Set(op.t === "token.moveMany" && cutOp.t === "token.moveMany" ? op.moves.filter((m, k) => m.x !== cutOp.moves[k]!.x || m.y !== cutOp.moves[k]!.y).map((m) => m.tokenId) : []);
      const groupOf = new Map(trapWalks(op, s, P1, {}).map((w) => [w.tokenId, w.group]));
      for (const [id, group] of groupOf) assert.equal(group, id === "pc2" || id === "gob" ? "pc2" : "pc", `${at}: ${id}'s trap group`);
      const passOf = new Map(planWalks(op, s, P1, {}).map((m) => [m.tokenId, m.pass]));
      if (stopped.size === 1) oneStopped++;
      // One every player sees under a holder they cannot see walks a route of its own, which the stop judges where it leaves it.
      if (stopped.has("pc") && s.tokens.brute!.visibility !== "dm" && passOf.get("brute") === "private") ownJudged++;
      const done = applyOp(s, op, P1, env(5));
      assert.ok(done.ok, at);
      for (const [id, pose] of trapLandings(op, s, P1, {})) {
        const t: Token = done.state.tokens[id]!;
        assert.deepEqual([t.x, t.y, t.elevation], [pose.x, pose.y, pose.elevation], `${at}: ${id} where the trap step left it`);
      }
      standsClear(s, done.state, at);
    }
    // Enough of the class: group moves taken, cut by a trap, with one group stopped and the other not, and a stopped walker every
    // player sees on a walk of its own under a holder they cannot see.
    assert.ok(taken >= 600, `group moves taken: ${taken}`);
    assert.ok(cuts >= 500, `cut by a trap: ${cuts}`);
    assert.ok(oneStopped >= 420, `one group stopped, the other not: ${oneStopped}`);
    assert.ok(ownJudged >= 45, `one every player sees under a hidden holder, stopped: ${ownJudged}`);
  });
});
