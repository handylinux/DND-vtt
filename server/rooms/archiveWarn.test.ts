import assert from "node:assert/strict";
import { test } from "node:test";
import { warnArchiveSkipped, type Logger } from "./actor.ts";

/** A logger that keeps each warning's fields. */
function recorder(): { log: Logger; warned: { roomId: string; refused: number }[] } {
  const warned: { roomId: string; refused: number }[] = [];
  const log = { warn: (fields: { roomId: string; refused: number }) => warned.push(fields), info() {}, error() {}, debug() {} } as unknown as Logger;
  return { log, warned };
}

test("a room's refused archive writes since its last warning are still told when another room's warning forgets it (LOGA-OPUS-7)", () => {
  const { log, warned } = recorder();
  // Clock values far from any other test's, so the module's map holds only these rooms by the end.
  const t0 = 9_000_000_000_000;
  warnArchiveSkipped(log, "loga7-a", t0);
  warnArchiveSkipped(log, "loga7-a", t0 + 10_000);
  warnArchiveSkipped(log, "loga7-a", t0 + 20_000);
  assert.deepEqual(warned, [{ roomId: "loga7-a", refused: 1 }], "within the minute the room's refusals are only counted");
  // A quiet minute later another room warns, and the first is forgotten: its two counted refusals are told then.
  warnArchiveSkipped(log, "loga7-b", t0 + 90_000);
  assert.deepEqual(warned.slice(1), [{ roomId: "loga7-b", refused: 1 }, { roomId: "loga7-a", refused: 2 }]);
  // Forgotten with nothing pending, a room's next refusal starts a new count.
  warnArchiveSkipped(log, "loga7-a", t0 + 100_000);
  assert.deepEqual(warned.at(-1), { roomId: "loga7-a", refused: 1 });
  warnArchiveSkipped(log, "loga7-c", t0 + 200_000);
  assert.equal(warned.length, 5, "a room forgotten with no refusal pending says nothing more");
});
