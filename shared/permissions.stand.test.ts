import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { wall } from "./discoveryTestutil.ts";
import type { RoomState, Token } from "./model.ts";
import { WALL_IN_THE_WAY, canApply, type PermissionDeps } from "./permissions.ts";
import type { Op } from "./protocol.ts";
import { DM, P1, room, scene, token } from "./testutil.ts";

/**
 * A player's move that ends full size off a creature's own snap grid
 * (live play LP28-B-RIDE-1): the core the leg test reads can be clear of
 * a wall that passes through the box the map draws, half a square in from
 * its edge. A Large warhorse at 4.5, 5 by a corridor's mouth reached into
 * the rock beside it, and the server took it.
 */
const deps: PermissionDeps = { canUseAsset: () => true };

function decide(op: Op, state: RoomState, who = P1): string {
  const d = canApply(op, who, state, deps);
  return d.ok ? "ok" : `${d.code}: ${d.message}`;
}

/** Rock from x 6 to 14 but for a corridor along row 6, one square wide, and a short free wall at y 9.25 from x 3.75 to 4.25, with warhorses west and south of it, one squeezed in the corridor and a goblin half a square off the grid. */
function corridor(): RoomState {
  const s = room({ scenes: { s1: scene("s1", { bounds: { w: 22, h: 16 }, blockMovement: true, autoWalls: "off" }) } });
  s.buildChunks = {};
  const runs: [[number, number], [number, number]][] = [[[6, 0], [6, 6]], [[6, 7], [6, 12]], [[14, 0], [14, 6]], [[14, 7], [14, 12]], [[6, 6], [14, 6]], [[6, 7], [14, 7]], [[3.75, 9.25], [4.25, 9.25]]];
  runs.forEach(([a, b], i) => wall(s, `fu44bs${String(i).padStart(6, "0")}`, a, b));
  const horse = (id: string, x: number, y: number): Token => token(id, { size: "large", x, y, name: "Warhorse", kind: "npc", ownerIds: ["p1"] });
  s.tokens.horse = horse("horse", 2, 5);
  s.tokens.south = horse("south", 2, 13);
  s.tokens.half = horse("half", 2.5, 13);
  s.tokens.inside = { ...horse("inside", 8.5, 5.5), squeeze: true };
  s.tokens.gob = token("gob", { x: 3.5, y: 6.5, name: "Goblin", kind: "npc", ownerIds: ["p1"] });
  return s;
}

describe("a player's move that ends full size off the grid meets the walls through its box", () => {
  test("a Large move to 4.5, 5 across the corridor's west wall is refused, plain, routed and in a group", () => {
    const s = corridor();
    assert.equal(decide({ t: "token.move", tokenId: "horse", x: 4.5, y: 5 }, s), `forbidden: ${WALL_IN_THE_WAY}`);
    assert.equal(decide({ t: "token.move", tokenId: "horse", x: 4.5, y: 5, route: [[4.5, 5, 1, 0]] }, s), `forbidden: ${WALL_IN_THE_WAY}`);
    assert.equal(decide({ t: "token.moveMany", moves: [{ tokenId: "horse", x: 4.5, y: 5 }] }, s), `forbidden: ${WALL_IN_THE_WAY}`);
    assert.equal(decide({ t: "token.move", tokenId: "horse", x: 4.5, y: 5 }, s, DM), "ok", "the DM's moves meet no walls");
  });

  test("the moves the rule keeps: the whole square before it, half-square stands in the open, a squeeze into the corridor and a teleport", () => {
    const s = corridor();
    assert.equal(decide({ t: "token.move", tokenId: "horse", x: 4, y: 5 }, s), "ok");
    assert.equal(decide({ t: "token.move", tokenId: "horse", x: 2.5, y: 5 }, s), "ok");
    assert.equal(decide({ t: "token.move", tokenId: "horse", x: 3.5, y: 2.5 }, s), "ok");
    assert.equal(decide({ t: "token.move", tokenId: "horse", x: 4, y: 5.5 }, s), "ok", "half a square off, flush against the rock's face: a wall along its edge is not through it");
    assert.equal(decide({ t: "token.move", tokenId: "horse", x: 2.5, y: 5.5, route: [[2.5, 5.5, 0, 0]] }, s), "ok");
    assert.equal(decide({ t: "token.move", tokenId: "horse", x: 7.5, y: 5.5, squeeze: true }, s), "ok", "a squeeze is judged by its own checks");
    assert.equal(decide({ t: "token.move", tokenId: "horse", x: 4.5, y: 5, teleport: "wall" }, s), "ok", "a teleport walks no leg");
    assert.equal(decide({ t: "token.move", tokenId: "inside", x: 10.5, y: 5.5 }, s), "ok", "full size along the corridor, a real narrow space, as a walk cut there lands");
  });

  test("on the grid the core alone decides, as before: a box over a free wall's end stands there, and half a square off it does not", () => {
    const s = corridor();
    // Both cores pass west of the wall at x 3.75, and both boxes reach over it.
    assert.equal(decide({ t: "token.move", tokenId: "south", x: 2, y: 9 }, s), "ok");
    assert.equal(decide({ t: "token.move", tokenId: "half", x: 2.5, y: 9 }, s), `forbidden: ${WALL_IN_THE_WAY}`);
    assert.equal(decide({ t: "token.move", tokenId: "half", x: 2.5, y: 10 }, s), "ok", "a square further south, clear of it");
    // A Medium creature's walk keeps its own grid from where it stands, so the core, its middle, decides wherever that is.
    assert.equal(decide({ t: "token.move", tokenId: "gob", x: 3.5, y: 8.5 }, s), "ok", "a goblin half a square off, its box over the wall's end");
  });
});
