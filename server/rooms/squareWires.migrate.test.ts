import assert from "node:assert/strict";
import { test } from "node:test";
import { SNAPSHOT_VERSION, migrateSnapshot, squareWiresOnHalves } from "#shared/migrate.ts";
import type { RoomState, Trap } from "#shared/model.ts";
import { applyOp } from "#shared/reducer.ts";
import { DM, env, room, scene, trap } from "#shared/testutil.ts";
import { loadRoom, type Pool } from "./persistence.ts";
import { parseRoomState } from "./stateSchema.ts";

/**
 * Snapshot step 31 to 32 (FU38-ASTRA-PARSER-NOTE): a trip wire on a square
 * scene imported with ends on the 1/64 lattice, between hex phase H2 and the
 * import's halves check, moves its ends to half cells, so the room's export
 * imports again and the DM can edit the trap.
 */

const wire = (a: [number, number], b: [number, number], sceneId = "s1"): Trap => ({ ...trap("w1", { sceneId, zone: { wire: { a, b } } }), rig: { ...trap("x").rig!, on: [], hits: "trigger", pit: undefined } });

/** A room as such an import left it: one square scene's wire off the halves, and a hex scene's wire on the 1/64 lattice. */
function oldRoom(): RoomState {
  return room({
    scenes: { s1: scene("s1"), s2: scene("s2", { order: 1, gridShape: "hexRows" }) },
    traps: { w1: wire([2 + 17 / 64, 3], [6 + 33 / 64, 3 + 1 / 64]), w2: { ...wire([1 + 5 / 64, 1], [4, 1 + 7 / 64], "s2"), id: "w2", grid: "hexRows" } },
  });
}

test("a stored room with a square wire off the halves loads with its ends on half cells, and its export imports (FU38-ASTRA-PARSER-NOTE)", async () => {
  const stored = oldRoom();
  assert.equal(parseRoomState(stored).ok, false, "the old data's export fails import");
  const query = async (sql: string) => ({ rows: sql.includes("room_snapshots") ? [{ seq: "5", state: stored, schema_version: 31 }] : [] });
  const db = { query, connect: async () => { throw new Error("read-only fixture"); } } as unknown as Pool;
  const failures: string[] = [];
  const loaded = await loadRoom(db, "WIRE", (_seq, reason) => failures.push(reason));
  assert.deepEqual(failures, []);
  assert.ok(loaded && !loaded.replayFailed);
  assert.deepEqual(loaded.state.traps.w1!.zone, { wire: { a: [2.5, 3], b: [6.5, 3] } }, "each end on its nearest half cell");
  assert.deepEqual(loaded.state.traps.w2, stored.traps.w2, "a hex scene's wire keeps the 1/64 lattice");
  const parsed = parseRoomState(loaded.state);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
  // The trap is the DM's to edit again: the reducer took no edit of a wire off the halves.
  const renamed = applyOp(loaded.state, { t: "trap.update", trapId: "w1", patch: { name: "Tripwire" } }, DM, env(6));
  assert.ok(renamed.ok, renamed.ok ? "" : renamed.message);
  // An export file made before the step imports through it too.
  const file = parseRoomState(migrateSnapshot(stored, 31));
  assert.ok(file.ok && SNAPSHOT_VERSION >= 32);
});

test("the step keeps each wire inside its scene and within its length, and leaves wires on half cells as they were", () => {
  const at = (traps: Record<string, Trap>, w = 30, h = 20) => (squareWiresOnHalves(room({ scenes: { s1: scene("s1", { bounds: { w, h } }) }, traps })) as RoomState).traps;
  // Both ends round to one point at the nearest halves, so the step takes the next nearest that keeps the wire 0.5 long.
  const short = at({ w1: wire([0.26, 0.26], [0.614, 0.614]) }).w1!.zone as { wire: { a: [number, number]; b: [number, number] } };
  const length = Math.hypot(short.wire.b[0] - short.wire.a[0], short.wire.b[1] - short.wire.a[1]);
  assert.ok(length >= 0.5 && [...short.wire.a, ...short.wire.b].every((v) => Number.isInteger(v * 2)), JSON.stringify(short));
  // A wire 20 cells long rounds out to over 20 at the nearest halves, so it rounds in.
  const long = at({ w1: wire([0.25 + 1 / 64, 1], [20.25 + 1 / 64, 1]) }).w1!.zone as { wire: { a: [number, number]; b: [number, number] } };
  assert.ok(Math.hypot(long.wire.b[0] - long.wire.a[0], long.wire.b[1] - long.wire.a[1]) <= 20, JSON.stringify(long));
  // An end on the scene's far edge stays on it.
  const edge = at({ w1: wire([29 + 63 / 64, 5], [30, 10]) }, 30, 20).w1!.zone as { wire: { a: [number, number]; b: [number, number] } };
  assert.deepEqual(edge.wire, { a: [30, 5], b: [30, 10] });
  const halves = room({ traps: { w1: wire([2.5, 3], [6, 3]) } });
  assert.equal(squareWiresOnHalves(halves), halves, "a room with nothing to move is the same object");
  assert.equal(squareWiresOnHalves(null), null);
});
