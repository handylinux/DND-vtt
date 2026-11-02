import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runSettings } from "./propertyTestutil.ts";

describe("the property tests' run settings (docs/development.md)", () => {
  test("no settings run the fixed seed and each property's own count", () => {
    assert.deepEqual(runSettings({}), { seed: 20_261_101, runs: undefined });
    assert.deepEqual(runSettings({ FC_SEED: "", FC_RUNS: "" }), { seed: 20_261_101, runs: undefined });
  });

  test("FC_SEED takes any whole number, and FC_RUNS a count of at least one", () => {
    assert.deepEqual(runSettings({ FC_SEED: "7", FC_RUNS: "20000" }), { seed: 7, runs: 20_000 });
    assert.deepEqual(runSettings({ FC_SEED: "0" }), { seed: 0, runs: undefined });
    assert.deepEqual(runSettings({ FC_SEED: "-3", FC_RUNS: "1" }), { seed: -3, runs: 1 });
  });

  test("a value that would run no cases or other cases than asked is refused, never run quietly", () => {
    for (const runs of ["0", "-1", "1.5", "ten", "9007199254740993"]) assert.throws(() => runSettings({ FC_RUNS: runs }), /FC_RUNS must be a whole number of at least 1/, runs);
    for (const seed of ["1.5", "seven", "9007199254740993"]) assert.throws(() => runSettings({ FC_SEED: seed }), /FC_SEED must be a whole number/, seed);
  });
});
