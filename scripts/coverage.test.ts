import assert from "node:assert/strict";
import { test } from "node:test";
import { formatReport, mergeLcov, sumByArea } from "./coverage.ts";

const record = (file: string, hits: Record<number, number>) =>
  `SF:/repo/${file}\n${Object.entries(hits).map(([n, h]) => `DA:${n},${h}`).join("\n")}\nend_of_record\n`;

test("a line counts as covered when any test file hit it", () => {
  const unit = record("shared/a.ts", { 1: 1, 2: 0, 3: 0 });
  const int = record("shared/a.ts", { 1: 0, 2: 4, 3: 0 });
  const totals = sumByArea(mergeLcov([unit, int], "/repo")).get("shared")!;
  assert.deepEqual(totals, { found: 3, hit: 2 });
});

test("records for one file in one report are merged, not added", () => {
  const twice = record("client/a.ts", { 1: 1, 2: 0 }) + record("client/a.ts", { 1: 0, 2: 0 });
  assert.deepEqual(sumByArea(mergeLcov([twice], "/repo")).get("client"), { found: 2, hit: 1 });
});

test("scripts are reported but left out of the shipped figure", () => {
  const lcov = record("server/a.ts", { 1: 1, 2: 1 }) + record("scripts/b.ts", { 1: 0, 2: 0 }) + record("e2e/c.ts", { 1: 0 });
  const report = formatReport(sumByArea(mergeLcov([lcov], "/repo")));
  assert.match(report, /scripts\s+0\.0%\s+\(0\/2 lines\)/);
  assert.match(report, /Shipped code \(server, shared, client\): 100\.0%\s+\(2\/2 lines\)/);
});
