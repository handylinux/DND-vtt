import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { wall } from "../discoveryTestutil.ts";
import { seatsApart } from "../migrate.ts";
import type { RoomState, Token } from "../model.ts";
import { canApply } from "../permissions.ts";
import { projectState, stableStringify } from "../project.ts";
import type { OpOf } from "../protocol.ts";
import { applyOp } from "../reducer.ts";
import { squeezedSeatsApart } from "../rules/attach.ts";
import { SQUARES } from "../rules/grid.ts";
import { findRouteOn } from "../rules/hexWalk.ts";
import { ownWalk } from "../rules/movement.ts";
import { groupWalkWorld } from "../rules/walkWorld.ts";
import { env, member, P1, P2, room, scene, token } from "../testutil.ts";

/**
 * What sits on a holder whose walk ends squeezed on squares takes squeezed
 * squares of its own where there are enough, nearest first (D-261101-251,
 * live play LP28-B-DOCS-2, op version 38). Four passengers on a Huge
 * elephant squeezed into a corridor two squares wide kept four squares
 * only from its four corners: from any other seats they tied onto one
 * square by the nearest-square rule alone, three of them here. Ops stored
 * before 38 replay by that rule. The corridor runs along rows 6 and 7
 * through rock from x 6 to 14.
 */

function elephant(seats: readonly [string, number, number, Partial<Token>?][]): RoomState {
  const s = room({ members: { dm1: member("dm1", "dm"), p1: member("p1"), p2: member("p2") }, scenes: { s1: scene("s1", { bounds: { w: 22, h: 14 }, blockMovement: true, autoWalls: "off" }) } });
  s.buildChunks = {};
  const runs: [[number, number], [number, number]][] = [[[6, 0], [6, 6]], [[6, 8], [6, 14]], [[14, 0], [14, 6]], [[14, 8], [14, 14]], [[6, 6], [14, 6]], [[6, 8], [14, 8]]];
  runs.forEach(([a, b], i) => wall(s, `fu45bs${String(i).padStart(6, "0")}`, a, b));
  s.tokens.ele = token("ele", { size: "huge", x: 1, y: 5, name: "Elephant", kind: "npc", ownerIds: ["p1"] });
  for (const [id, x, y, over] of seats) s.tokens[id] = token(id, { x, y, name: id, kind: "pc", ownerIds: ["p1"], attached: { to: "ele", kind: "ride" }, ...over });
  return s;
}

/** The elephant's own way in, squeezed at 9.5, 5.5 on the corridor's four squares from 10, 6 to 12, 8. */
function inside(s: RoomState): OpOf<"token.move"> {
  const { towed: _towed, ...input } = groupWalkWorld(s, ownWalk(s.tokens.ele!), { role: "player" }).input;
  const found = findRouteOn(input, { x: 9.5, y: 5.5 });
  assert.ok(found && found !== "none", "a way in");
  return { t: "token.move", tokenId: "ele", x: 9.5, y: 5.5, squeeze: true, route: found.pieces.map(([x, y, extra, swim]): [number, number, number, 0 | 1] => [x, y, extra, swim]) };
}

function moved(s: RoomState, op: OpOf<"token.move">, opVersion?: number): RoomState {
  const allowed = canApply(op, P1, s, { canUseAsset: () => true });
  assert.ok(allowed.ok, allowed.ok ? "" : allowed.message);
  const r = applyOp(s, op, P1, { ...env(5), ...(opVersion !== undefined ? { opVersion } : {}) });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.state;
}

const at = (s: RoomState, ids: readonly string[]) => ids.map((id) => `${s.tokens[id]!.x},${s.tokens[id]!.y}`);
const LP28: [string, number, number][] = [["a", 1, 5], ["b", 2, 5], ["c", 1, 6], ["d", 2, 7]];

describe("squares: what sits on a holder whose walk ends squeezed takes squares of its own (D-261101-251)", () => {
  test("four passengers off the corners take the corridor's four squares, each the nearest left to it", () => {
    const s = elephant(LP28);
    const after = moved(s, inside(s));
    assert.deepEqual(at(after, ["a", "b", "c", "d"]), ["10,6", "11,6", "10,7", "11,7"]);
    for (const id of ["a", "b", "c", "d"]) assert.equal(after.tokens[id]!.attached?.to, "ele", `${id} still rides`);
  });

  test("an op stored before version 38 ties three of them onto one square, as it did", () => {
    const s = elephant(LP28);
    const after = moved(s, inside(s), 37);
    assert.deepEqual(at(after, ["a", "b", "c", "d"]), ["10,6", "10,6", "10,6", "10,7"]);
    assert.deepEqual([seatsApart(37), seatsApart(38), seatsApart(undefined)], [false, true, true]);
  });

  test("the four corner seats keep the squares they kept before, and one passenger alone sits as before", () => {
    const corners = elephant([["a", 1, 5], ["b", 3, 5], ["c", 1, 7], ["d", 3, 7]]);
    assert.deepEqual(at(moved(corners, inside(corners)), ["a", "b", "c", "d"]), at(moved(corners, inside(corners), 37), ["a", "b", "c", "d"]));
    for (const [x, y] of [[1, 5], [2, 6], [3, 7], [2, 5]] as const) {
      const one = elephant([["a", x, y]]);
      assert.deepEqual(at(moved(one, inside(one)), ["a"]), at(moved(one, inside(one), 37), ["a"]), `alone from ${x}, ${y}`);
    }
  });

  test("with more passengers than squares, each square is taken once and the rest take their nearest", () => {
    const s = elephant([...LP28, ["e", 3, 6]]);
    const after = moved(s, inside(s));
    const squares = at(after, ["a", "b", "c", "d", "e"]);
    assert.equal(new Set(squares).size, 4, `four squares taken: ${squares}`);
    assert.ok(squares.every((sq) => ["10,6", "11,6", "10,7", "11,7"].includes(sq)), `all on the squeeze: ${squares}`);
  });

  test("a passenger players cannot see takes what is left, so those they see sit as with none, and no player is sent anything of it", () => {
    const seen: [string, number, number, Partial<Token>?][] = [["b", 2, 5], ["d", 2, 7]];
    const without = elephant(seen);
    // Nearer than either to the first square, so by the nearest rule alone it would take it.
    const withHidden = elephant([...seen, ["a", 1, 5, { visibility: "dm", ownerIds: [] }]]);
    const op = inside(without);
    const a = moved(without, op);
    const b = moved(withHidden, op);
    assert.deepEqual(at(b, ["b", "d"]), at(a, ["b", "d"]), "the seats players see");
    assert.deepEqual(at(b, ["a", "b", "d"]), ["11,6", "10,6", "10,7"], "the hidden one on the nearest square left to it");
    for (const who of [P1, P2]) assert.equal(stableStringify(projectState(b, who, { sceneId: "s1" })), stableStringify(projectState(a, who, { sceneId: "s1" })), `${who.memberId} is sent the same`);
  });

  test("the rule itself: a class taken first keeps its spots whatever the next class holds", () => {
    const walker = { size: "huge" as const, x: 1, y: 5 };
    const p = (id: string, x: number, y: number) => ({ id, size: "medium" as const, x, y });
    const first = squeezedSeatsApart(SQUARES, walker, { x: 9.5, y: 5.5 }, [[p("b", 2, 5)], []]);
    const both = squeezedSeatsApart(SQUARES, walker, { x: 9.5, y: 5.5 }, [[p("b", 2, 5)], [p("a", 1, 5)]]);
    assert.deepEqual(both.get("b"), first.get("b"));
    assert.deepEqual([both.get("b"), both.get("a")], [{ x: 10, y: 6 }, { x: 11, y: 6 }]);
  });
});
