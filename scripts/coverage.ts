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

// Test infrastructure is found by name first, so a helper added later is left out without
// anyone remembering to list it: any file ending in Testing, Testutil or Testkit (any case,
// with or without a dot before it), and anything under a testing/ folder.
const TEST_SUPPORT_NAME = /(testing|testutil|testkit)\.tsx?$/i;
export const TEST_SUPPORT_DIRS: readonly string[] = [
  "client/components/testing/",
  // The dev-only room, behind import.meta.env.DEV, so the production bundle drops it.
  "client/dev/",
];
// What the name rule cannot see. A stale entry fails scripts/coverage.test.ts.
export const TEST_SUPPORT_FILES: readonly string[] = [
  "server/assets/testApp.ts",
  "server/assets/testImages.ts",
  "shared/rules/testWorld.ts",
  // Imports node:assert, and only tests load it.
  "shared/differential.ts",
  // Behind import.meta.env.DEV, like client/dev/.
  "client/features/vision/devFixture.ts",
];

const TEST_FILE = /\.(test|itest|e2e)\.tsx?$/;
// Declarations only: Node never loads one and it holds no lines that run.
const DECLARATION_FILE = /\.d\.ts$/;
const SOURCE_FILE = /\.tsx?$/;

export function isTestSupport(file: string): boolean {
  return (
    TEST_FILE.test(file) ||
    DECLARATION_FILE.test(file) ||
    TEST_SUPPORT_NAME.test(file) ||
    TEST_SUPPORT_FILES.includes(file) ||
    TEST_SUPPORT_DIRS.some((dir) => file.startsWith(dir))
  );
}

// The files that count: source in an area, minus tests and test infrastructure.
function isCounted(file: string): boolean {
  return AREAS.includes(file.split("/")[0] ?? "") && SOURCE_FILE.test(file) && !isTestSupport(file);
}

// Node's coverage report only lists files a test loaded, so a shipped file nothing imports
// would add nothing to the total and hide a gap. The tracked source list is the source of truth.
export function listShipped(tracked: string[]): string[] {
  return tracked.filter((file) => SHIPPED.includes(file.split("/")[0] ?? "") && isCounted(file));
}

// Node's lcov counts every physical line of a loaded file, blank and comment lines included.
// An unloaded file is counted the same way, so loaded and unloaded files are measured alike.
export function addUnloaded(
  files: Map<string, Map<string, boolean>>,
  shipped: string[],
  read: (file: string) => string,
): void {
  for (const file of shipped) {
    if (files.has(file)) continue;
    const text = read(file);
    const count = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    const lines = new Map<string, boolean>();
    for (let no = 1; no <= count; no++) lines.set(`${file}:${no}`, false);
    files.set(file, lines);
  }
}

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
    if (!isCounted(file)) continue;
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

export type Deps = {
  runSuite: (lcovFile: string, concurrency: string[], globs: string[]) => number;
  listTracked: () => string[];
  readText: (file: string) => string;
  cwd: string;
  log: (text: string) => void;
};

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
    ...concurrency,
    "--test-reporter=dot",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    `--test-reporter-destination=${lcovFile}`,
    ...globs,
  ];
  return spawnSync(process.execPath, args, { stdio: "inherit", env: process.env }).status ?? 1;
}

function listTracked(): string[] {
  const run = spawnSync("git", ["ls-files", "--", ...SHIPPED], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ls-files failed: ${run.stderr}`);
  return run.stdout.split("\n").filter((file) => file !== "");
}

const defaults: Deps = {
  runSuite,
  listTracked,
  readText: (file) => readFileSync(file, "utf8"),
  cwd: process.cwd(),
  log: console.log,
};

// Returns the exit status instead of calling process.exit, which would skip the finally and
// leave the temporary directory behind.
export function main(deps: Deps = defaults): number {
  const dir = mkdtempSync(join(tmpdir(), "raccoon-coverage-"));
  try {
    const unit = join(dir, "unit.lcov");
    const int = join(dir, "int.lcov");
    const unitStatus = deps.runSuite(unit, [], ["shared/**/*.test.ts", "server/**/*.test.ts", "client/**/*.test.ts", "scripts/**/*.test.ts"]);
    // The integration tests share one database, so they run one file at a time.
    const intStatus = deps.runSuite(int, ["--test-concurrency=1"], ["server/**/*.itest.ts"]);
    const merged = mergeLcov([readFileSync(unit, "utf8"), readFileSync(int, "utf8")], deps.cwd);
    addUnloaded(merged, listShipped(deps.listTracked()), deps.readText);
    deps.log(formatReport(sumByArea(merged)));
    return unitStatus || intStatus;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  if (!process.env.DATABASE_URL) {
    console.error("Set DATABASE_URL to a Postgres database the integration tests may use.");
    process.exitCode = 2;
  } else {
    process.exitCode = main();
  }
}
