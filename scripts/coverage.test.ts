import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test, type TestContext } from "node:test";
import { TEST_SUPPORT_DIRS, TEST_SUPPORT_FILES, addUnloaded, formatReport, isTestSupport, listShipped, main, mergeLcov, sumByArea } from "./coverage.ts";

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

test("a shipped file no test loaded counts every line at zero, as Node counts a loaded one", () => {
  const files = mergeLcov([record("server/a.ts", { 1: 1, 2: 1 })], "/repo");
  const sources: Record<string, string> = { "server/b.ts": "// note\n\nexport const b = 1;\n", "client/c.tsx": "x" };
  addUnloaded(files, ["server/a.ts", "server/b.ts", "client/c.tsx"], (file) => sources[file] ?? assert.fail(file));
  const byArea = sumByArea(files);
  assert.deepEqual(byArea.get("server"), { found: 5, hit: 2 });
  assert.deepEqual(byArea.get("client"), { found: 1, hit: 0 });
});

test("an empty unloaded file adds no lines", () => {
  const files = new Map<string, Map<string, boolean>>();
  addUnloaded(files, ["shared/e.ts"], () => "");
  assert.deepEqual(sumByArea(files).get("shared"), { found: 0, hit: 0 });
});

test("test helpers and tests are excluded, loaded or not", () => {
  const lcov = record("shared/testutil.ts", { 1: 1, 2: 1 }) + record("client/components/testing/register.ts", { 1: 1 }) + record("server/a.test.ts", { 1: 1 }) + record("server/real.ts", { 1: 0 });
  const files = mergeLcov([lcov], "/repo");
  addUnloaded(files, listShipped(["shared/testutil.ts", "client/dev/DevRoom.tsx", "server/rooms/testing.ts", "client/types.d.ts", "server/x.itest.ts", "shared/real.ts"]), () => "a\nb\n");
  assert.deepEqual(sumByArea(files).get("shared"), { found: 2, hit: 0 });
  assert.deepEqual(sumByArea(files).get("server"), { found: 1, hit: 0 });
  assert.deepEqual(sumByArea(files).get("client"), { found: 0, hit: 0 });
});

test("only source in the shipped areas is listed", () => {
  const listed = listShipped(["server/a.ts", "client/b.tsx", "shared/c.json", "client/globals.css", "scripts/d.ts", "e2e/e.ts"]);
  assert.deepEqual(listed, ["server/a.ts", "client/b.tsx"]);
});

test("test helpers are found by name, and shipped files with similar names are not", () => {
  for (const file of ["shared/testutil.ts", "shared/perPlayerTestutil.ts", "server/rooms/undoTesting.ts", "client/features/dice/abilityMenu.testing.ts", "shared/rules/hexWalls.testkit.ts", "client/features/new/testing.ts", "client/components/testing/x.ts", "shared/differential.ts", "client/dev/DevRoom.tsx"]) {
    assert.equal(isTestSupport(file), true, file);
  }
  for (const file of ["client/canvas/relief/isoTest.ts", "server/rooms/actor.ts", "shared/rules/testing-ground.ts", "client/pages/Room.tsx"]) {
    assert.equal(isTestSupport(file), false, file);
  }
});

test("every hand-listed test helper still exists", () => {
  const tracked = new Set(spawnSync("git", ["ls-files"], { encoding: "utf8" }).stdout.split("\n"));
  for (const file of TEST_SUPPORT_FILES) assert.ok(tracked.has(file), `${file} is listed but not tracked`);
  for (const dir of TEST_SUPPORT_DIRS) assert.ok([...tracked].some((f) => f.startsWith(dir)), `${dir} is listed but empty`);
});

// process.exit skips a finally block, and in a test it would end the run as a pass, so it throws.
const forbidExit = (t: TestContext) => t.mock.method(process, "exit", () => assert.fail("main must return its status, not call process.exit"));

test("the temporary directory is removed after a finished run", (t) => {
  forbidExit(t);
  let dir = "";
  const writeLcov = (lcovFile: string) => {
    dir = dirname(lcovFile);
    writeFileSync(lcovFile, record("shared/a.ts", { 1: 1 }));
    return 0;
  };
  const logged: string[] = [];
  const status = main({ runSuite: writeLcov, listTracked: () => ["shared/a.ts", "shared/b.ts"], readText: () => "x\n", cwd: "/repo", log: (t) => logged.push(t) });
  assert.equal(status, 0);
  assert.notEqual(dir, "");
  assert.equal(existsSync(dir), false);
  assert.match(logged.join("\n"), /Shipped code .*50\.0%\s+\(1\/2 lines\)/);
});

test("the temporary directory is removed when a suite fails too, and the status is returned", (t) => {
  forbidExit(t);
  let dir = "";
  const failing = (lcovFile: string) => {
    dir = dirname(lcovFile);
    writeFileSync(lcovFile, "");
    return 1;
  };
  const status = main({ runSuite: failing, listTracked: () => [], readText: () => "", cwd: "/repo", log: () => {} });
  assert.equal(status, 1);
  assert.equal(existsSync(dir), false);
});
