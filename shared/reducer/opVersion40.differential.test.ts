import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { RoomState } from "../model.ts";
import type { Op } from "../protocol.ts";
import { groupOf, viewsDigest, type Who } from "./opVersion40.testing.ts";

/**
 * Ops stored at op version 40 or lower replay as the build before own-key
 * reads (5948c7e0) applied them, junk results included (records.ts
 * readsOwnKeys). The fixture is three random rooms and ops of every kind in
 * them, as fu48h2's check of ids that name Object.prototype's members drove
 * them, with each name in each slot of each op (opVersion40.testing.ts
 * variants). After each variant come the ops stored after it that read what
 * it wrote: its undo, that undo's redo, and deletes of what it made under
 * new ids, each also from a snapshot taken between. That build recorded a
 * digest of every refusal, throw, state, log, touched key and undo, and of
 * every viewer's projection of the room after each op.
 *
 * Projections are live code, never replayed, and read by own key. Where
 * that build could not project a room (`threw`) today's may, or must throw
 * the same. Where an op had set a record's prototype by writing
 * "__proto__" (`reparented`), that build's projections read entities
 * through it that today's do not, and that no snapshot holds. A change that
 * breaks this must keep version 40 ops on the rules they were applied
 * under rather than record the file again.
 */
type Group = { op: Op; who: Who; n: number; effects: string; views: string; reparented?: number[]; threw?: [number, number][] };
type Fixture = { build: string; messages: string[]; rooms: { state: RoomState; ops: Group[] }[] };

const fixture = JSON.parse(readFileSync(new URL("./opVersion40.fixture.json", import.meta.url), "utf8")) as Fixture;

describe("version 40 ops that name Object.prototype's members replay as the build before own-key reads applied them", () => {
  test("the fixture drives every name in every slot of a few hundred ops", () => {
    assert.equal(fixture.build, "5948c7e0");
    const ops = fixture.rooms.flatMap((r) => r.ops);
    assert.ok(ops.length > 500, `${ops.length} ops`);
    assert.ok(new Set(ops.map((g) => g.op.t)).size > 100, "ops of most kinds");
    assert.ok(ops.reduce((sum, g) => sum + g.n, 0) > 6_000, "thousands of variants");
  });

  for (const [r, room] of fixture.rooms.entries()) {
    test(`room ${r}: every variant, its undo, redo and deletes, refuses or leaves the room and the projections that build left`, () => {
      for (const [i, group] of room.ops.entries()) {
        const where = `room ${r} op ${i} (${group.op.t} by ${group.who})`;
        const now = groupOf(room.state, group.op, group.who);
        assert.equal(now.n, group.n, `${where}: the variants that parse`);
        assert.equal(now.effects, group.effects, `${where} replays otherwise:\n${now.lines.join("\n")}`);
        const open = new Set([...(group.reparented ?? []), ...(group.threw ?? []).map(([at]) => at)]);
        assert.equal(viewsDigest(now.views, open), group.views, `${where} projects otherwise:\n${now.lines.join("\n")}`);
        for (const at of group.reparented ?? []) assert.ok(!now.views[at]!.startsWith("threw"), `${where}: projection ${at} throws`);
        for (const [at, message] of group.threw ?? []) {
          const view = now.views[at]!;
          assert.ok(!view.startsWith("threw") || view === fixture.messages[message], `${where}: projection ${at} throws ${view}`);
        }
      }
    });
  }
});
