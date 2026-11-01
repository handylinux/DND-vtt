import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { lift, wall } from "./discoveryTestutil.ts";
import type { RoomState, Token } from "./model.ts";
import { SOMETHING_BLOCKS, WALL_IN_THE_WAY, canApply, touchLanding, type PermissionDeps } from "./permissions.ts";
import type { Op, OpOf } from "./protocol.ts";
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

/** A dragged Large brute half a square off the grid behind a PC east of the rock, a wall at x 19 from y 14 to 16, and a warhorse left squeezed at 19.5, 0.5 by a wall at x 21 that no longer pinches it. */
function besides(): RoomState {
  const s = corridor();
  wall(s, "fu44fx000001", [19, 14], [19, 16]);
  wall(s, "fu44fx000002", [21, 0], [21, 2]);
  s.tokens.pc = token("pc", { x: 16, y: 13, name: "Pc", kind: "pc", ownerIds: ["p1"] });
  s.tokens.brute = token("brute", { size: "large", x: 16.5, y: 14, name: "Brute", kind: "npc", attached: { to: "pc", kind: "drag" } });
  s.tokens.stale = { ...token("stale", { size: "large", x: 19.5, y: 0.5, name: "Warhorse", kind: "npc", ownerIds: ["p1"] }), squeeze: true };
  return s;
}

describe("the stand test beside the mover (review FU44-OPUS-1 and FU44-OPUS-6)", () => {
  test("a creature the mover drags that would stand off the grid with a wall through its box refuses the move, which its core alone would pass", () => {
    const s = besides();
    // The brute ends at 17.5, 14, its box over the wall at x 19 and its core clear of it.
    assert.equal(decide({ t: "token.move", tokenId: "pc", x: 17, y: 13 }, s), `forbidden: ${WALL_IN_THE_WAY}`);
    assert.equal(decide({ t: "token.moveMany", moves: [{ tokenId: "pc", x: 17, y: 13 }] }, s), `forbidden: ${WALL_IN_THE_WAY}`);
    assert.equal(decide({ t: "token.move", tokenId: "pc", x: 16, y: 12 }, s), "ok", "north, clear of it");
  });

  test("standing up in place from a squeeze where no narrow space holds it is judged by its box", () => {
    const s = besides();
    assert.equal(decide({ t: "token.move", tokenId: "stale", x: 19.5, y: 0.5 }, s), `forbidden: ${WALL_IN_THE_WAY}`);
    assert.equal(decide({ t: "token.move", tokenId: "stale", x: 19, y: 0 }, s), "ok", "half a square west and north, on the grid");
  });
});

/** Sol's room (review FU44-SOL-01): fog on, a Large warhorse at 0.5, 9.5, a short wall through its box at x 2.5 and 3.5 but not its core, and a wall at x 10. */
function shortWall(lit: boolean): RoomState {
  const s = room({ scenes: { s1: scene("s1", { bounds: { w: 22, h: 16 }, blockMovement: true, autoWalls: "off", fogEnabled: true }) } });
  s.buildChunks = {};
  wall(s, "fu44fl000001", [3.75, 9.75], [4.25, 9.75]);
  wall(s, "fu44fl000002", [10, 6], [10, 14]);
  s.tokens.horse = token("horse", { size: "large", x: 0.5, y: 9.5, name: "Warhorse", kind: "npc", ownerIds: ["p1"] });
  if (lit) lift(s, "dm", { x: 0, y: 0, w: 22, h: 16 });
  return s;
}

function fogCorridor(lit: boolean): RoomState {
  const s = corridor();
  s.scenes.s1 = { ...s.scenes.s1!, fogEnabled: true };
  if (lit) lift(s, "dm", { x: 0, y: 0, w: 22, h: 16 });
  return s;
}

const where = (op: Op | undefined) => (op?.t === "token.move" ? [op.x, op.y, op.route] : op?.t === "token.moveMany" ? [op.moves[0]!.x, op.moves[0]!.y] : null);

describe("the touch rule lands a walk the stand test stops where the whole check takes it (review FU44-SOL-01, FU44-OPUS-3 and FU44-OPUS-4)", () => {
  test("past a short wall that refuses two spots along the way, the walk lands at the last spot it takes, plain, routed and in a group", () => {
    for (const lit of [false, true]) {
      const s = shortWall(lit);
      const plain: OpOf<"token.move"> = { t: "token.move", tokenId: "horse", x: 12, y: 10 };
      for (const [op, at] of [
        [plain, [7.5, 9.5, undefined]],
        [{ ...plain, route: [[12, 9.5, 0, 0]] }, [8, 9.5, [[8, 9.5, 0, 0]]]],
        [{ t: "token.moveMany", moves: [{ tokenId: "horse", x: 12, y: 10 }] }, [7.5, 9.5]],
      ] as [Op, unknown[]][]) {
        const landed = touchLanding(op, P1, s, deps);
        assert.deepEqual(where(landed?.op), at, `lit ${lit}: ${JSON.stringify(op)}`);
        assert.equal(decide(landed!.op, s), "ok");
      }
    }
  });

  test("into the corridor's mouth: dark ground names nothing and lit ground the wall, and either way the walk lands at 4, 5 with those words", () => {
    for (const lit of [false, true]) {
      const s = fogCorridor(lit);
      const words = lit ? WALL_IN_THE_WAY : SOMETHING_BLOCKS;
      for (const [op, at] of [
        [{ t: "token.move", tokenId: "horse", x: 4.5, y: 5 }, [4, 5, undefined]],
        [{ t: "token.move", tokenId: "horse", x: 4.5, y: 5, route: [[4.5, 5, 1, 0]] }, [4, 5, [[4, 5, 1, 0]]]],
        [{ t: "token.moveMany", moves: [{ tokenId: "horse", x: 4.5, y: 5 }] }, [4, 5]],
      ] as [Op, unknown[]][]) {
        assert.equal(decide(op, s), `forbidden: ${words}`, `lit ${lit}`);
        const landed = touchLanding(op, P1, s, deps);
        assert.deepEqual([where(landed?.op), landed?.words], [at, words], `lit ${lit}: ${JSON.stringify(op)}`);
      }
    }
  });
});
