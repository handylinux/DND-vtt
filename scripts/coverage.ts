// Statement (line) coverage of the unit and integration suites, from Node's built-in coverage.
// Needs DATABASE_URL (the integration tests use Postgres). e2e is not measured.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Shipped code is what runs in the image or the browser. scripts/ is build tooling and is
// reported on its own so it cannot hide a gap in the shipped figure.
export const SHIPPED = ["server", "shared", "client"];
export const AREAS = [...SHIPPED, "scripts"];

export type Totals = { found: number; hit: number };

// Node's lcov reporter writes one record per test file, not one per source file. A line counts
// as covered when any record hit it, so the records are merged by file and line first.
export function mergeLcov(lcovs: string[], cwd: string): Map<string, Map<string, boolean>> {
  const files = new Map<string, Map<string, boolean>>();
  for (const lcov of lcovs) {
    let lines: Map<string, boolean> | null = null;
    let file = "";
    for (const row of lcov.split("\n")) {
      if (row.startsWith("SF:")) {
        file = row.slice(3).replace(`${cwd}/`, "");
        lines = files.get(file) ?? new Map();
        files.set(file, lines);
      } else if (lines !== null && row.startsWith("DA:")) {
        const [no, hits] = row.slice(3).split(",");
        const key = `${file}:${no}`;
        lines.set(key, (lines.get(key) ?? false) || Number(hits) > 0);
      }
    }
  }
  return files;
}

export function sumByArea(files: Map<string, Map<string, boolean>>): Map<string, Totals> {
  const byArea = new Map<string, Totals>(AREAS.map((a) => [a, { found: 0, hit: 0 }]));
  for (const [file, lines] of files) {
    const total = byArea.get(file.split("/")[0] ?? "");
    if (total === undefined) continue;
    for (const covered of lines.values()) {
      total.found += 1;
      if (covered) total.hit += 1;
    }
  }
  return byArea;
}

const pct = (t: Totals) => (t.found === 0 ? "n/a" : `${((100 * t.hit) / t.found).toFixed(1)}%`);

export function formatReport(byArea: Map<string, Totals>): string {
  const rows = AREAS.map((a) => {
    const t = byArea.get(a)!;
    return `  ${a.padEnd(8)} ${pct(t).padStart(6)}  (${t.hit}/${t.found} lines)`;
  });
  const shipped: Totals = { found: 0, hit: 0 };
  for (const a of SHIPPED) {
    shipped.found += byArea.get(a)!.found;
    shipped.hit += byArea.get(a)!.hit;
  }
  return [
    "Line coverage, unit plus integration tests:",
    ...rows,
    `Shipped code (${SHIPPED.join(", ")}): ${pct(shipped)}  (${shipped.hit}/${shipped.found} lines)`,
  ].join("\n");
}

function runSuite(lcovFile: string, concurrency: string[], globs: string[]): number {
  const args = [
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-include=server/**",
    "--test-coverage-include=shared/**",
    "--test-coverage-include=client/**",
    "--test-coverage-include=scripts/**",
    "--test-coverage-exclude=**/*.test.ts",
    "--test-coverage-exclude=**/*.itest.ts",
    "--test-coverage-exclude=**/testing.ts",
    ...concurrency,
    "--test-reporter=dot",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    `--test-reporter-destination=${lcovFile}`,
    ...globs,
  ];
  return spawnSync(process.execPath, args, { stdio: "inherit", env: process.env }).status ?? 1;
}

function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Set DATABASE_URL to a Postgres database the integration tests may use.");
    process.exit(2);
  }
  const dir = mkdtempSync(join(tmpdir(), "raccoon-coverage-"));
  try {
    const unit = join(dir, "unit.lcov");
    const int = join(dir, "int.lcov");
    const unitStatus = runSuite(unit, [], ["shared/**/*.test.ts", "server/**/*.test.ts", "client/**/*.test.ts", "scripts/**/*.test.ts"]);
    // The integration tests share one database, so they run one file at a time.
    const intStatus = runSuite(int, ["--test-concurrency=1"], ["server/**/*.itest.ts"]);
    const merged = mergeLcov([readFileSync(unit, "utf8"), readFileSync(int, "utf8")], process.cwd());
    console.log(formatReport(sumByArea(merged)));
    process.exit(unitStatus || intStatus);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) main();
