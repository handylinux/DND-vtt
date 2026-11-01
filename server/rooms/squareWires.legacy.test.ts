import assert from "node:assert/strict";
import { test } from "node:test";
import { OP_VERSION } from "#shared/migrate.ts";
import type { RoomState, Trap } from "#shared/model.ts";
import type { Op } from "#shared/protocol.ts";
import { AT, DM, P1, room, token, trap } from "#shared/testutil.ts";
import { undoScope } from "#shared/undoScope.ts";
import { loadRoom, type Pool } from "./persistence.ts";
import { UndoTable } from "./undoTesting.ts";

/**
 * A trip wire on a square scene whose ends an import let onto the 1/64
 * lattice, between hex phase H2 and the import's halves check
 * (FU38-ASTRA-PARSER-NOTE). No stored step moves its ends: a snapshot is
 * migrated before its stored ops replay, so moving them would change what
 * those ops did (review FU43-DATA-01, FU43-SOL-01).
 */

/** A wire with its ends where such an import left them, 40/64 of a cell below the row Thorn walks along. */
const legacy = (id = "w1"): Trap => ({ ...trap(id, { name: "Tripwire", zone: { wire: { a: [3, 5 + 40 / 64], b: [3, 9] } } }), rig: { ...trap(id).rig!, on: [], hits: "trigger", pit: undefined } });

function oldRoom(): RoomState {
  return room({
    tokens: { thorn: token("thorn", { name: "Thorn", kind: "pc", disposition: "ally", ownerIds: ["p1"], x: 0, y: 5 }) },
    traps: { w1: legacy() },
  });
}

/** The ops the table played, as room_ops holds them, behind a snapshot of `state` at `version`. */
function stored(state: RoomState, version: number, table: UndoTable): Pool {
  const ops = table.played.map((p) => ({ seq: String(p.seq), at: new Date(AT), actor_member_id: p.who.memberId, actor_role: p.who.role, op: p.op, op_version: OP_VERSION }));
  const query = async (sql: string) => {
    if (sql.includes("room_snapshots")) return { rows: [{ seq: "0", state: structuredClone(state), schema_version: version, imported_seq: null }] };
    if (sql.includes("room_ops")) return { rows: ops };
    return { rows: [] };
  };
  return { query, connect: async () => { throw new Error("read-only fixture"); } } as unknown as Pool;
}

function played(table: UndoTable, op: Op, who = DM): void {
  assert.equal(table.play(who, op), "ok", op.t);
}

test("a stored room's ops replay against its square wire's 1/64 ends as they applied: a walk past it, a set-off undone, a deletion undone (FU43-DATA-01)", async () => {
  const initial = oldRoom();
  const table = new UndoTable(structuredClone(initial));
  // Thorn's walk passes over the wire's end, 40/64 of a cell clear of it, so the trap stays armed.
  played(table, { t: "token.move", tokenId: "thorn", x: 6, y: 5 }, P1);
  assert.deepEqual([table.t("thorn").x, table.t("thorn").y, table.state.traps.w1!.state], [6, 5, "armed"]);
  // The DM sets it off and takes it back: the restore's guard names the trap as it was stored.
  const spring: Op = { t: "trap.spring", trapId: "w1", tokenIds: ["thorn"] };
  played(table, spring);
  assert.equal(table.state.traps.w1!.state, "sprung");
  assert.equal(table.undo(DM, undoScope(spring, table.state) === "setup" ? "setup" : "play"), "ok");
  assert.equal(table.state.traps.w1!.state, "armed");
  // Deleted and brought back by Undo, the trap has its ends as they were.
  const remove: Op = { t: "trap.delete", trapId: "w1" };
  const before = table.state;
  played(table, remove);
  assert.equal(table.undo(DM, undoScope(remove, before) === "play" ? "play" : "setup"), "ok");
  assert.deepEqual(table.state.traps.w1!.zone, initial.traps.w1!.zone);

  const failures: string[] = [];
  // Snapshot 31, the version such a room was saved at.
  const loaded = await loadRoom(stored(initial, 31, table), "WIRE", (_seq, reason) => failures.push(reason));
  assert.deepEqual(failures, []);
  assert.ok(loaded && !loaded.replayFailed);
  assert.equal(loaded.replayed, table.played.length);
  assert.deepEqual(loaded.state, table.state, "replay ends where the live room did");
});
