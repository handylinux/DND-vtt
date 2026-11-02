import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/*
 * Every image build in .github/workflows/image.yml makes the same image from
 * the same commit (build_repeatable): it passes the commit's time as
 * SOURCE_DATE_EPOCH, and each export rewrites file times to it. One build
 * without either would also break the publish job's check that the image
 * pushed is the one smoke-tested, since the two would differ in their dates.
 */

const WORKFLOW = readFileSync(new URL("../.github/workflows/image.yml", import.meta.url), "utf8");

/** Each job's YAML block, by name. */
function jobs(): Map<string, string> {
  const body = WORKFLOW.split("\njobs:\n")[1] ?? "";
  return new Map([...body.matchAll(/^ {2}([\w-]+):\n((?: {4}.*\n|\n)*)/gm)].map((m) => [m[1]!, m[2]!]));
}

/** Every `docker buildx build` command in a block, with its continued lines joined. */
function builds(block: string): string[] {
  return [...block.replace(/\\\n\s*/g, "").matchAll(/^\s*docker buildx build .*$/gm)].map((m) => m[0].trim());
}

describe("the image workflow's builds", () => {
  test("the check job hands every job the commit's time", () => {
    const check = jobs().get("check") ?? "";
    assert.match(check, /\n {6}epoch: \$\{\{ steps\.version\.outputs\.epoch \}\}\n/);
    assert.match(check, /\n {10}epoch=\$\(git log -1 --format=%ct HEAD\)\n/);
    assert.match(check, /\n {12}echo "epoch=\$epoch"\n/);
  });

  test("each one is dated at the commit, and each export rewrites file times to it", () => {
    let count = 0;
    for (const [name, block] of jobs()) {
      const found = builds(block);
      if (found.length === 0) continue;
      assert.match(block, /\n {6,10}SOURCE_DATE_EPOCH: \$\{\{ needs\.check\.outputs\.epoch \}\}\n/, `${name} sets SOURCE_DATE_EPOCH`);
      for (const build of found) {
        count++;
        assert.ok(build.includes('--build-arg "SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH"'), `${name}: ${build}`);
        assert.doesNotMatch(build, /\s(?:--load|--push|-o)\s/, `${name} exports with --output, where rewrite-timestamp can be set: ${build}`);
        const output = /--output "?([^"\s]+)/.exec(build)?.[1];
        if (output) assert.match(output, /(?:^|,)rewrite-timestamp=true(?:,|$)/, `${name}: ${build}`);
      }
    }
    // build-arm64, smoke, and the publish job's load, cache and push.
    assert.equal(count, 5);
  });
});
