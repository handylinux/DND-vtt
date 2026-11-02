import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

/*
 * .github/workflows/release-assets.yml, which signs a release's source
 * archive and SBOM and attaches them with their provenance. Its steps run
 * as GitHub runs them, with stand-ins for gh and cosign: it only ever adds
 * to a release, refuses one that holds some of the assets, and reads the
 * tag from the environment only after checking it.
 */

const read = (file: string) => readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8");
const workflow = read("release-assets.yml");

/** A job's YAML block, so a check cannot match another job. */
function jobBlock(text: string, name: string): string {
  const block = text.split(`\n  ${name}:\n`)[1];
  assert.ok(block, `no job named ${name}`);
  return block.split(/\n {2}[\w-]+:\n/)[0]!;
}

/** A step's script: the lines of its `run: |` block, as GitHub hands them to bash. */
function stepScript(step: string, text = workflow): string {
  const lines = text.split("\n");
  const name = lines.findIndex((l) => l.trim() === `- name: ${step}`);
  assert.ok(name >= 0, `no step named "${step}"`);
  const run = lines.findIndex((l, i) => i > name && l.trim() === "run: |");
  const indent = lines[run + 1]!.length - lines[run + 1]!.trimStart().length;
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== "" && line.length - line.trimStart().length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join("\n");
}

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "raccoon-release-assets-"));
  made.push(dir);
  return dir;
}

/** A step run as GitHub's default bash runs it, with `tools` as stand-in commands ahead on PATH. */
function runStep(step: string, env: Record<string, string>, tools: Record<string, string> = {}, cwd?: string, text = workflow) {
  const dir = scratch();
  for (const [name, body] of Object.entries(tools)) {
    writeFileSync(path.join(dir, name), `#!/bin/bash\n${body}`);
    chmodSync(path.join(dir, name), 0o755);
  }
  writeFileSync(path.join(dir, "output"), "");
  writeFileSync(path.join(dir, "calls"), "");
  mkdirSync(path.join(dir, "assets"));
  const run = spawnSync("bash", ["--noprofile", "--norc", "-e", "-c", stepScript(step, text)], {
    encoding: "utf8",
    cwd: cwd ?? dir,
    env: { PATH: `${dir}:${process.env.PATH ?? ""}`, GITHUB_REPOSITORY: "example/raccoon-vtt", GITHUB_OUTPUT: path.join(dir, "output"), CALLS: path.join(dir, "calls"), RUNNER_TEMP: dir, ...env },
  });
  const lines = (file: string) => readFileSync(path.join(dir, file), "utf8").split("\n").filter(Boolean);
  return { status: run.status, out: run.stdout + run.stderr, output: lines("output"), calls: lines("calls"), dir };
}

const ASSETS = ["raccoon-vtt-1.2.3.tar.gz", "raccoon-vtt-1.2.3.tar.gz.sigstore.json", "raccoon-vtt-1.2.3.cdx.json", "raccoon-vtt-1.2.3.cdx.json.sigstore.json", "raccoon-vtt-1.2.3.intoto.jsonl"];

/**
 * gh as a stand-in: `release view` prints the names in HELD, one a line, or
 * fails with VIEW_FAILS, and `release upload` succeeds. Every call is logged.
 */
const GH = `printf '%s\\n' "$*" >> "$CALLS"
case "$1 $2" in
  "release view") if [ -n "\${VIEW_FAILS:-}" ]; then echo "$VIEW_FAILS" >&2; exit 1; fi; printf '%s' "$HELD" ;;
  "release upload") ;;
  *) exit 9 ;;
esac
`;

/** The workflow commands a run printed: lines starting "::". */
const commands = (out: string) => out.split("\n").filter((l) => l.startsWith("::"));

describe("the check of the tag and its release", () => {
  const check = (tag: string, held: readonly string[] | { fails: string }) =>
    runStep("The tag and what its release holds", { TAG: tag, ...("fails" in held ? { VIEW_FAILS: held.fails, HELD: "" } : { HELD: held.join("\n") }) }, { gh: GH });

  for (const tag of ["1.2.3", "v1.2", "v1.2.3-rc.1", "v1.2.3 ", "main", "", "v1.2.3\n::warning::injected", "../v1.2.3", "v01.2.3x"]) {
    test(`refuses the tag ${JSON.stringify(tag)} before asking GitHub anything, on one escaped error line`, () => {
      const r = check(tag, []);
      assert.equal(r.status, 1, r.out);
      assert.deepEqual(r.calls, []);
      assert.deepEqual(r.output, []);
      assert.equal(commands(r.out).length, 1, r.out);
      assert.match(commands(r.out)[0]!, /^::error::The tag is '.*', not vX\.Y\.Z\.$/);
    });
  }

  test("a release with none of the assets needs them all, and names the version", () => {
    const r = check("v1.2.3", ["something-else.zip", "raccoon-vtt-1.2.3.tar.gz.bak", "raccoon-vtt-1.2.2.tar.gz"]);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.calls, ["release view v1.2.3 --repo example/raccoon-vtt --json assets --jq .assets[].name"]);
    assert.deepEqual(r.output, ["needed=true", "version=1.2.3"]);
  });

  test("a release with every asset is left as it is", () => {
    const r = check("v1.2.3", ["notes.txt", ...ASSETS]);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.output, ["needed=false"]);
  });

  for (const some of [[ASSETS[0]!], [ASSETS[1]!, ASSETS[4]!], ASSETS.slice(0, 4)]) {
    test(`a release with only ${some.join(", ")} is refused, naming them`, () => {
      const r = check("v1.2.3", some);
      assert.equal(r.status, 1, r.out);
      assert.deepEqual(r.output, []);
      assert.ok(commands(r.out)[0]!.startsWith(`::error::The GitHub Release v1.2.3 already has ${some.join(" ")}, but not every asset.`), r.out);
    });
  }

  test("a release GitHub cannot show is an error, its text escaped onto the one error line", () => {
    const r = check("v1.2.3", { fails: "release not found\n::warning::injected" });
    assert.equal(r.status, 1, r.out);
    assert.deepEqual(r.output, []);
    assert.deepEqual(commands(r.out), ["::error::Could not read the GitHub Release v1.2.3: release not found%0A::warning::injected"]);
  });
});

describe("the upload to the release", () => {
  const upload = (held: readonly string[] | { fails: string }) =>
    runStep("Upload to the GitHub Release", { TAG: "v1.2.3", VERSION: "1.2.3", ...("fails" in held ? { VIEW_FAILS: held.fails, HELD: "" } : { HELD: held.join("\n") }) }, { gh: GH });

  test("attaches all five assets to a release that has none, never replacing one", () => {
    const r = upload(["notes.txt"]);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.calls.slice(1), [`release upload v1.2.3 --repo example/raccoon-vtt ${ASSETS.join(" ")}`]);
    assert.doesNotMatch(r.calls.join("\n"), /clobber/);
  });

  test("leaves a release that another run completed meanwhile", () => {
    const r = upload(ASSETS);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.calls.filter((c) => c.startsWith("release upload")), []);
  });

  test("refuses a release that holds some of them, uploading nothing", () => {
    const r = upload([ASSETS[2]!]);
    assert.equal(r.status, 1, r.out);
    assert.deepEqual(r.calls.filter((c) => c.startsWith("release upload")), []);
    assert.match(r.out, /already has raccoon-vtt-1\.2\.3\.cdx\.json, but not every asset/);
  });

  test("uploads nothing when GitHub cannot show the release", () => {
    const r = upload({ fails: "connection refused" });
    assert.equal(r.status, 1, r.out);
    assert.deepEqual(r.calls.filter((c) => c.startsWith("release upload")), []);
  });

  test("checks and uploads the very names the check job looks for", () => {
    const names = (step: string) => /assets=\((.+)\)/.exec(stepScript(step))![1]!.replaceAll("$version", "$VERSION");
    assert.equal(names("Upload to the GitHub Release"), names("The tag and what its release holds"));
  });
});

const jq = spawnSync("jq", ["--version"]).status === 0;

describe("the tag's files", () => {
  test("the version check refuses a tag whose package.json says another version", { skip: jq ? false : "jq is not installed" }, () => {
    for (const [version, status] of [["1.2.3", 0], ["1.2.4", 1]] as const) {
      const dir = scratch();
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version }));
      assert.equal(runStep("The tag sets its version", { VERSION: "1.2.3" }, {}, dir).status, status, version);
    }
  });

  test("the source archive holds the tagged commit's files under raccoon-vtt-X.Y.Z/, and nothing untracked", () => {
    const repo = scratch();
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    mkdirSync(path.join(repo, "server"));
    writeFileSync(path.join(repo, "server/main.ts"), "app\n");
    writeFileSync(path.join(repo, "package.json"), "{}\n");
    git("add", "-A");
    git("commit", "-q", "--no-gpg-sign", "-m", "release");
    writeFileSync(path.join(repo, "untracked.txt"), "local\n");
    const r = runStep("Source archive", { VERSION: "1.2.3" }, {}, repo);
    assert.equal(r.status, 0, r.out);
    const archive = path.join(r.dir, "assets/raccoon-vtt-1.2.3.tar.gz");
    assert.deepEqual(r.output, [`sha256=${createHash("sha256").update(readFileSync(archive)).digest("hex")}`]);
    assert.deepEqual(execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n").toSorted(), ["raccoon-vtt-1.2.3/", "raccoon-vtt-1.2.3/package.json", "raccoon-vtt-1.2.3/server/", "raccoon-vtt-1.2.3/server/main.ts"]);
  });
});

describe("the provenance predicate", { skip: jq ? false : "jq is not installed" }, () => {
  const REPO = "example/raccoon-vtt";
  const TAG_COMMIT = "abcdef0123456789abcdef0123456789abcdef01";
  const MAIN_COMMIT = "2222222222222222222222222222222222222222";

  type Run = { workflowRef: string; ref: string; sha: string; event: string };

  /**
   * GitHub's own predicate for a run, ported from buildSLSAProvenancePredicate
   * (actions/toolkit, packages/attest/src/provenance.ts), with the OIDC claims
   * this run would carry. The builder is this workflow at the run's ref, as
   * image.yml calls it or as it runs by hand.
   */
  function githubPredicate(run: Run) {
    const repository = `https://github.com/${REPO}`;
    return {
      buildDefinition: {
        buildType: "https://actions.github.io/buildtypes/workflow/v1",
        externalParameters: { workflow: { ref: run.ref, repository, path: run.workflowRef.replace(`${REPO}/`, "").split("@")[0] } },
        internalParameters: { github: { event_name: run.event, repository_id: "101", repository_owner_id: "202", runner_environment: "github-hosted" } },
        resolvedDependencies: [{ uri: `git+${repository}@${run.ref}`, digest: { gitCommit: run.sha } }],
      },
      runDetails: {
        builder: { id: `${repository}/.github/workflows/release-assets.yml@${run.ref}` },
        metadata: { invocationId: `${repository}/actions/runs/303/attempts/2` },
      },
    };
  }

  function predicate(run: Run, commit: string) {
    const r = runStep("The provenance predicate", {
      VERSION: "1.2.3",
      COMMIT: commit,
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: REPO,
      GITHUB_WORKFLOW_REF: run.workflowRef,
      GITHUB_REF: run.ref,
      GITHUB_SHA: run.sha,
      GITHUB_EVENT_NAME: run.event,
      GITHUB_REPOSITORY_ID: "101",
      GITHUB_REPOSITORY_OWNER_ID: "202",
      RUNNER_ENVIRONMENT: "github-hosted",
      GITHUB_RUN_ID: "303",
      GITHUB_RUN_ATTEMPT: "2",
    });
    const file = path.join(r.dir, "provenance.json");
    return { ...r, predicate: r.status === 0 ? (JSON.parse(readFileSync(file, "utf8")) as ReturnType<typeof githubPredicate>) : undefined };
  }

  const TAG_PUSH: Run = { workflowRef: `${REPO}/.github/workflows/image.yml@refs/tags/v1.2.3`, ref: "refs/tags/v1.2.3", sha: TAG_COMMIT, event: "push" };
  const BY_HAND: Run = { workflowRef: `${REPO}/.github/workflows/release-assets.yml@refs/heads/main`, ref: "refs/heads/main", sha: MAIN_COMMIT, event: "workflow_dispatch" };

  test("a tag's own run, through image.yml, gets GitHub's predicate as it is", () => {
    const r = predicate(TAG_PUSH, TAG_COMMIT);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.predicate, githubPredicate(TAG_PUSH));
  });

  test("a run by hand from main names main as the workflow and builder, and adds the tag's own commit", () => {
    const r = predicate(BY_HAND, TAG_COMMIT);
    assert.equal(r.status, 0, r.out);
    const expected = githubPredicate(BY_HAND);
    expected.buildDefinition.resolvedDependencies.push({ uri: `git+https://github.com/${REPO}@refs/tags/v1.2.3`, digest: { gitCommit: TAG_COMMIT } });
    assert.deepEqual(r.predicate, expected);
    assert.equal(r.predicate?.runDetails.builder.id, `https://github.com/${REPO}/.github/workflows/release-assets.yml@refs/heads/main`);
  });

  test("a tag's own run whose checkout found another commit names both", () => {
    const r = predicate(TAG_PUSH, MAIN_COMMIT);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.predicate?.buildDefinition.resolvedDependencies.map((d) => d.digest.gitCommit), [TAG_COMMIT, MAIN_COMMIT]);
  });

  for (const commit of ["", "v1.2.3", "1111", `${TAG_COMMIT}\n::warning::x`, TAG_COMMIT.toUpperCase()]) {
    test(`refuses a tagged commit of ${JSON.stringify(commit)}`, () => {
      const r = predicate(BY_HAND, commit);
      assert.equal(r.status, 1, r.out);
      assert.equal(r.predicate, undefined);
    });
  }

  test("the builder named is this workflow file", () => {
    assert.ok(stepScript("The provenance predicate").includes(".github/workflows/release-assets.yml@"));
    assert.ok(existsSync(new URL("../.github/workflows/release-assets.yml", import.meta.url)));
  });

  test("the source job names the commit it checked out, and the attestation signs this predicate", () => {
    const repo = scratch();
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    writeFileSync(path.join(repo, "package.json"), "{}\n");
    git("add", "-A");
    git("commit", "-q", "--no-gpg-sign", "-m", "release");
    const r = runStep("The tagged commit", { VERSION: "1.2.3" }, {}, repo);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.output, [`commit=${git("rev-parse", "HEAD")}`]);
    const build = jobBlock(workflow, "source");
    assert.match(build, /\n {4}outputs:\n {6}commit: \$\{\{ steps\.source\.outputs\.commit \}\}\n/);
    assert.ok(build.indexOf("ref: refs/tags/${{ inputs.tag }}") < build.indexOf("- name: The tagged commit"));
    const sign = jobBlock(workflow, "sign");
    assert.match(sign, /COMMIT: \$\{\{ needs\.source\.outputs\.commit \}\}\n/);
    assert.match(sign, /\n {10}predicate-type: https:\/\/slsa\.dev\/provenance\/v1\n {10}predicate-path: \$\{\{ runner\.temp \}\}\/provenance\.json\n/);
    assert.ok(sign.indexOf("- name: The provenance predicate") < sign.indexOf("- name: Attest the build provenance"));
  });
});

describe("signing", () => {
  /** cosign as a stand-in that logs its arguments and fails its first FAILURES calls. */
  const COSIGN = `count=$(grep -c '^sign-blob' "$CALLS" || true)
printf '%s\\n' "$*" >> "$CALLS"
[ "$count" -ge "$FAILURES" ]
`;
  function sign(failures: number) {
    const dir = scratch();
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "cosign"), `#!/bin/bash\n${COSIGN}`);
    chmodSync(path.join(dir, "cosign"), 0o755);
    return runStep("Sign the archive and the SBOM", { VERSION: "1.2.3", RUNNER_TEMP: dir, FAILURES: String(failures) }, { sleep: 'printf "pause %s\\n" "$1" >> "$CALLS"' });
  }

  test("signs the archive and the SBOM, each into a .sigstore.json bundle beside it", () => {
    const r = sign(0);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.calls, [
      "sign-blob --yes --bundle raccoon-vtt-1.2.3.tar.gz.sigstore.json raccoon-vtt-1.2.3.tar.gz",
      "sign-blob --yes --bundle raccoon-vtt-1.2.3.cdx.json.sigstore.json raccoon-vtt-1.2.3.cdx.json",
    ]);
  });

  test("tries three times with pauses, then stops", () => {
    const retried = sign(2);
    assert.equal(retried.status, 0, retried.out);
    assert.deepEqual(retried.calls.slice(0, 5), [
      "sign-blob --yes --bundle raccoon-vtt-1.2.3.tar.gz.sigstore.json raccoon-vtt-1.2.3.tar.gz",
      "pause 5",
      "sign-blob --yes --bundle raccoon-vtt-1.2.3.tar.gz.sigstore.json raccoon-vtt-1.2.3.tar.gz",
      "pause 10",
      "sign-blob --yes --bundle raccoon-vtt-1.2.3.tar.gz.sigstore.json raccoon-vtt-1.2.3.tar.gz",
    ]);
    const failed = sign(9);
    assert.equal(failed.status, 1, failed.out);
    assert.equal(failed.calls.filter((c) => c.startsWith("sign-blob")).length, 3);
    assert.match(failed.out, /^::error::Could not sign raccoon-vtt-1\.2\.3\.tar\.gz after three attempts\.$/m);
  });

  test("Cosign is the same checksum-pinned download as image.yml's", () => {
    assert.equal(stepScript("Install Cosign"), stepScript("Install Cosign", read("image.yml")));
  });
});

describe("release-assets.yml's jobs", () => {
  test("each job holds only the permissions it uses, under none at the top", () => {
    assert.match(workflow, /\npermissions: \{\}\n/);
    const permissions = (job: string) => /\n {4}permissions:\n((?: {6}[\w-]+: \w+\n)+)/.exec(`\n${jobBlock(workflow, job)}`)?.[1]?.trim().split(/\n\s*/);
    assert.deepEqual(permissions("check"), ["contents: read"]);
    assert.deepEqual(permissions("source"), ["contents: read"]);
    assert.match(jobBlock(workflow, "sbom"), /\n {4}permissions: \{\}\n/);
    assert.deepEqual(permissions("sign"), ["id-token: write", "attestations: write"]);
    assert.deepEqual(permissions("upload"), ["contents: write"]);
  });

  test("only GitHub's own actions run where a token can sign or write the release", () => {
    for (const job of ["source", "sign", "upload"]) {
      for (const [, uses] of jobBlock(workflow, job).matchAll(/uses: (\S+)/g)) assert.match(uses!, /^actions\/[\w-]+@[0-9a-f]{40}$/, `${job}: ${uses}`);
    }
  });

  test("the checkout and the archive never share a job with the package manager", () => {
    const source = jobBlock(workflow, "source").replace(/^ *#.*$/gm, "");
    assert.match(source, /actions\/checkout@/);
    assert.match(source, /git archive/);
    assert.doesNotMatch(source, /pnpm|setup-node|\bnode\b/);
    const sbom = jobBlock(workflow, "sbom").replace(/^ *#.*$/gm, "");
    assert.match(sbom, /pnpm sbom/);
    assert.doesNotMatch(sbom, /actions\/checkout|git archive|\$\{\{ *(github\.token|secrets)/);
    for (const job of ["check", "source", "sbom"]) assert.doesNotMatch(jobBlock(workflow, job), /id-token|attestations|contents: write/, job);
    assert.match(jobBlock(workflow, "sign"), /needs: \[check, source, sbom\]/);
  });

  test("the SBOM job unpacks the archive that is signed, not a second checkout", () => {
    const work = scratch();
    const source = path.join(work, "source");
    mkdirSync(path.join(work, "src/raccoon-vtt-1.2.3"), { recursive: true });
    mkdirSync(source);
    writeFileSync(path.join(work, "src/raccoon-vtt-1.2.3/pnpm-lock.yaml"), "lock\n");
    execFileSync("tar", ["-czf", path.join(source, "raccoon-vtt-1.2.3.tar.gz"), "-C", path.join(work, "src"), "raccoon-vtt-1.2.3"]);
    const workspace = path.join(work, "workspace");
    mkdirSync(workspace);
    const r = runStep("Unpack the archive", { VERSION: "1.2.3", RUNNER_TEMP: work, GITHUB_WORKSPACE: workspace });
    assert.equal(r.status, 0, r.out);
    assert.equal(readFileSync(path.join(workspace, "pnpm-lock.yaml"), "utf8"), "lock\n");
    const sbom = jobBlock(workflow, "sbom");
    assert.ok(sbom.indexOf("name: release-source") < sbom.indexOf("- name: Unpack the archive"));
    assert.ok(sbom.indexOf("- name: Unpack the archive") < sbom.indexOf("pnpm/action-setup@"));
  });

  test("it is called by image.yml after the release job, and by hand with a tag", () => {
    assert.match(workflow, /\non:\n {2}workflow_call:\n {4}inputs:\n {6}tag:\n[\s\S]*\n {2}workflow_dispatch:\n {4}inputs:\n {6}tag:\n/);
    const caller = jobBlock(read("image.yml"), "release-assets");
    assert.match(caller, /^ {4}needs: release\n {4}if: github.event_name == 'push' && github.ref_type == 'tag' && needs.release.result == 'success'\n/);
    assert.match(caller, /\n {4}permissions:\n {6}contents: write\n {6}id-token: write\n {6}attestations: write\n/);
    assert.match(caller, /\n {4}uses: \.\/\.github\/workflows\/release-assets\.yml\n {4}with:\n {6}tag: \$\{\{ github\.ref_name \}\}\n?$/);
  });

  test("its asset names end as OpenSSF Scorecard counts a signature and a provenance", () => {
    const list = /assets=\((.+)\)/.exec(stepScript("The tag and what its release holds"))![1]!;
    const names = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]!.replaceAll("$version", "1.2.3"));
    assert.deepEqual(names, ASSETS);
    // releasesAreSigned takes .sigstore.json, among others, and releasesHaveProvenance .intoto.jsonl.
    assert.deepEqual(names.filter((a) => a.endsWith(".sigstore.json")).map((a) => a.replace(/\.sigstore\.json$/, "")), ["raccoon-vtt-1.2.3.tar.gz", "raccoon-vtt-1.2.3.cdx.json"]);
    assert.deepEqual(names.filter((a) => a.endsWith(".intoto.jsonl")), ["raccoon-vtt-1.2.3.intoto.jsonl"]);
  });
});

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
/** The digests the source and sign jobs pass on, of an archive holding "source" and an SBOM holding "sbom". */
const DIGESTS = { ARCHIVE_SHA256: sha256("source\n"), SBOM_SHA256: sha256("sbom\n") };

describe("each asset comes from the job that made it", () => {
  /** A job's artifact downloads, as [artifact, folder] pairs. */
  function downloads(job: string) {
    const block = jobBlock(workflow, job);
    const pairs = [...block.matchAll(/- uses: actions\/download-artifact@[0-9a-f]{40} # \S+\n {8}with:\n {10}name: (release-[\w-]+)\n {10}path: \$\{\{ runner\.temp \}\}\/from\/([\w-]+)\n/g)].map((m) => [m[1]!, m[2]!]);
    assert.equal(pairs.length, block.split("actions/download-artifact@").length - 1, `${job}: every download names one artifact and its own folder`);
    return pairs;
  }

  /** What a job's "Take each job's files" step takes, as [folder, files] pairs. */
  function takes(job: string) {
    return [...stepScript("Take each job's files", jobBlock(workflow, job)).matchAll(/^take (\w+) (.+)$/gm)].map((m) => [m[1]!, [...m[2]!.matchAll(/"([^"]+)"/g)].map((f) => f[1]!.replaceAll("$VERSION", "1.2.3"))]);
  }

  test("the sign and upload jobs download each job's artifact into its own folder, never merged", () => {
    assert.doesNotMatch(workflow, /merge-multiple|pattern:/);
    assert.deepEqual(downloads("sign"), [["release-source", "source"], ["release-sbom", "sbom"]]);
    assert.deepEqual(downloads("upload"), [["release-source", "source"], ["release-sbom", "sbom"], ["release-signatures", "signatures"]]);
  });

  test("each job takes every asset by name from the one job that makes it", () => {
    const source = ["raccoon-vtt-1.2.3.tar.gz"];
    const sbom = ["raccoon-vtt-1.2.3.cdx.json"];
    const signatures = ["raccoon-vtt-1.2.3.tar.gz.sigstore.json", "raccoon-vtt-1.2.3.cdx.json.sigstore.json", "raccoon-vtt-1.2.3.intoto.jsonl"];
    assert.deepEqual(takes("sign"), [["source", source], ["sbom", sbom]]);
    assert.deepEqual(takes("upload"), [["source", source], ["sbom", sbom], ["signatures", signatures]]);
    assert.deepEqual([...source, ...sbom, ...signatures].toSorted(), ASSETS.toSorted());
    const helpers = (job: string) => /^shopt[\s\S]*?\n(?=mkdir )/.exec(stepScript("Take each job's files", jobBlock(workflow, job)))?.[0];
    assert.match(helpers("sign") ?? "", /\ntake\(\) \{\n[\s\S]*\nsame\(\) \{\n/);
    assert.equal(helpers("upload"), helpers("sign"));
    for (const job of ["sign", "upload"]) {
      const block = jobBlock(workflow, job);
      assert.ok(block.indexOf("- name: Take each job's files") > block.lastIndexOf("actions/download-artifact@"), job);
    }
    const sign = jobBlock(workflow, "sign");
    assert.ok(sign.indexOf("- name: Take each job's files") < sign.indexOf("- name: Sign the archive and the SBOM"));
  });

  test("each job uploads only the files it makes, by name", () => {
    /** The paths a job's upload-artifact step names, one a line after `path: |` or alone after `path:`. */
    const uploaded = (job: string) => {
      const [, many, one] = /actions\/upload-artifact@[0-9a-f]{40} # \S+\n {8}with:\n {10}name: release-[\w-]+\n {10}path: (?:\|\n((?: {12}.+\n)+)|(.+)\n)/.exec(jobBlock(workflow, job))!;
      return (many ?? one)!.trim().split(/\n\s*/).map((p) => p.replace("${{ runner.temp }}/assets/", "").replace("${{ needs.check.outputs.version }}", "1.2.3"));
    };
    assert.deepEqual(uploaded("source"), ["raccoon-vtt-1.2.3.tar.gz"]);
    assert.deepEqual(uploaded("sbom"), ["raccoon-vtt-1.2.3.cdx.json"]);
    assert.deepEqual(uploaded("sign"), ["raccoon-vtt-1.2.3.tar.gz.sigstore.json", "raccoon-vtt-1.2.3.cdx.json.sigstore.json", "raccoon-vtt-1.2.3.intoto.jsonl"]);
  });

  /** A job's step run against artifact folders laid out by `lay`, each file holding its producer's name. */
  function take(job: "sign" | "upload", lay: (from: string) => void, digests: Record<string, string> = DIGESTS) {
    const temp = scratch();
    const from = path.join(temp, "from");
    for (const [producer, files] of Object.entries({ source: [ASSETS[0]!], sbom: [ASSETS[2]!], signatures: [ASSETS[1]!, ASSETS[3]!, ASSETS[4]!] })) {
      mkdirSync(path.join(from, producer), { recursive: true });
      for (const file of files) writeFileSync(path.join(from, producer, file), `${producer}\n`);
    }
    lay(from);
    const r = runStep("Take each job's files", { VERSION: "1.2.3", RUNNER_TEMP: temp, ...digests }, {}, undefined, jobBlock(workflow, job));
    const assets = path.join(temp, "assets");
    const taken = Object.fromEntries((existsSync(assets) ? readdirSync(assets) : []).map((f) => [f, readFileSync(path.join(assets, f), "utf8").trim()]));
    return { ...r, taken };
  }

  test("the sign job takes the archive from the source job and the SBOM from the sbom job", () => {
    const r = take("sign", () => {});
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.taken, { [ASSETS[0]!]: "source", [ASSETS[2]!]: "sbom" });
    assert.deepEqual(r.output, [`sbom-sha256=${DIGESTS.SBOM_SHA256}`]);
  });

  test("the upload job takes all five, each from the job that made it", () => {
    const r = take("upload", () => {});
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.taken, { [ASSETS[0]!]: "source", [ASSETS[1]!]: "signatures", [ASSETS[2]!]: "sbom", [ASSETS[3]!]: "signatures", [ASSETS[4]!]: "signatures" });
  });

  /** [what is wrong, the job that refuses it, the artifact it is wrong in, the layout, the error] */
  const refused: [string, "sign" | "upload", string, (from: string) => void, RegExp][] = [
    ["an archive placed in the sbom job's artifact", "sign", "sbom", (from) => writeFileSync(path.join(from, "sbom", ASSETS[0]!), "sbom\n"), /release-sbom artifact must hold raccoon-vtt-1\.2\.3\.cdx\.json, and nothing else/],
    ["an archive placed in the sbom job's artifact, at upload", "upload", "sbom", (from) => writeFileSync(path.join(from, "sbom", ASSETS[0]!), "sbom\n"), /release-sbom artifact must hold/],
    ["an archive placed in the sign job's artifact", "upload", "signatures", (from) => writeFileSync(path.join(from, "signatures", ASSETS[0]!), "signatures\n"), /release-signatures artifact must hold/],
    ["a hidden file beside the SBOM", "sign", "sbom", (from) => writeFileSync(path.join(from, "sbom", ".npmrc"), "x\n"), /release-sbom artifact must hold/],
    ["a folder beside the SBOM", "sign", "sbom", (from) => mkdirSync(path.join(from, "sbom", "raccoon-vtt-1.2.3")), /release-sbom artifact must hold/],
    ["an SBOM under another name", "sign", "sbom", (from) => { rmSync(path.join(from, "sbom", ASSETS[2]!)); writeFileSync(path.join(from, "sbom", "sbom.json"), "sbom\n"); }, /release-sbom artifact's raccoon-vtt-1\.2\.3\.cdx\.json is missing/],
    ["no SBOM", "sign", "sbom", (from) => rmSync(path.join(from, "sbom", ASSETS[2]!)), /release-sbom artifact must hold/],
    ["no sbom artifact at all", "sign", "sbom", (from) => rmSync(path.join(from, "sbom"), { recursive: true }), /release-sbom artifact must hold/],
    ["an SBOM that is a symlink", "sign", "sbom", (from) => { rmSync(path.join(from, "sbom", ASSETS[2]!)); symlinkSync(path.join(from, "source", ASSETS[0]!), path.join(from, "sbom", ASSETS[2]!)); }, /release-sbom artifact's raccoon-vtt-1\.2\.3\.cdx\.json is missing or not a regular file/],
    ["an SBOM that is a folder", "sign", "sbom", (from) => { rmSync(path.join(from, "sbom", ASSETS[2]!)); mkdirSync(path.join(from, "sbom", ASSETS[2]!)); }, /not a regular file/],
    ["an sbom folder that is a symlink to the source's", "sign", "sbom", (from) => { rmSync(path.join(from, "sbom"), { recursive: true }); symlinkSync(path.join(from, "source"), path.join(from, "sbom")); }, /release-sbom artifact must hold/],
    ["a missing signature", "upload", "signatures", (from) => rmSync(path.join(from, "signatures", ASSETS[4]!)), /release-signatures artifact must hold/],
  ];
  for (const [what, job, producer, lay, error] of refused) {
    test(`the ${job} job refuses ${what}, on one error line, taking nothing from that job`, () => {
      const r = take(job, lay);
      assert.equal(r.status, 1, r.out);
      assert.equal(commands(r.out).length, 1, r.out);
      assert.match(commands(r.out)[0]!, error);
      assert.equal(r.taken[ASSETS[0]!] ?? "source", "source", "the archive taken is the source job's");
      for (const [file, from] of Object.entries(r.taken)) assert.notEqual(from, producer, `${file} was taken from the refused artifact`);
    });
  }
});

describe("the archive and the SBOM are the very files their jobs made", () => {
  /** The step as in the suite above, with the digests given and the archive or SBOM's text replaced. */
  function take(job: "sign" | "upload", digests: Record<string, string>, replace: Record<string, string> = {}) {
    const temp = scratch();
    const files: Record<string, [string, string]> = { [ASSETS[0]!]: ["source", "source\n"], [ASSETS[2]!]: ["sbom", "sbom\n"], [ASSETS[1]!]: ["signatures", "s\n"], [ASSETS[3]!]: ["signatures", "s\n"], [ASSETS[4]!]: ["signatures", "s\n"] };
    for (const [file, [producer, text]] of Object.entries(files)) {
      mkdirSync(path.join(temp, "from", producer), { recursive: true });
      writeFileSync(path.join(temp, "from", producer, file), replace[file] ?? text);
    }
    return runStep("Take each job's files", { VERSION: "1.2.3", RUNNER_TEMP: temp, ...digests }, {}, undefined, jobBlock(workflow, job));
  }

  for (const job of ["sign", "upload"] as const) {
    test(`the ${job} job refuses a release-source artifact replaced after the source job made it`, () => {
      const r = take(job, DIGESTS, { [ASSETS[0]!]: "replaced\n" });
      assert.equal(r.status, 1, r.out);
      assert.deepEqual(commands(r.out), [`::error::raccoon-vtt-1.2.3.tar.gz is not the file the source job made: its sha256 is ${sha256("replaced\n")}.`]);
      assert.deepEqual(r.output, []);
    });

    test(`the ${job} job refuses when the source job gave no digest`, () => {
      const r = take(job, { ...DIGESTS, ARCHIVE_SHA256: "" });
      assert.equal(r.status, 1, r.out);
      assert.match(commands(r.out)[0]!, /^::error::raccoon-vtt-1\.2\.3\.tar\.gz is not the file the source job made/);
    });
  }

  test("the upload job refuses an SBOM other than the one the sign job signed", () => {
    const r = take("upload", DIGESTS, { [ASSETS[2]!]: "replaced\n" });
    assert.equal(r.status, 1, r.out);
    assert.deepEqual(commands(r.out), [`::error::raccoon-vtt-1.2.3.cdx.json is not the file the sign job signed: its sha256 is ${sha256("replaced\n")}.`]);
    const none = take("upload", { ...DIGESTS, SBOM_SHA256: "" });
    assert.equal(none.status, 1, none.out);
  });

  test("the digests pass from the job that made each file, as job outputs, to the jobs that check it", () => {
    const source = jobBlock(workflow, "source");
    assert.match(source, /\n {4}outputs:\n(?: {6}.+\n)* {6}archive-sha256: \$\{\{ steps\.archive\.outputs\.sha256 \}\}\n/);
    assert.match(source, /\n {6}- name: Source archive\n {8}id: archive\n/);
    const sign = jobBlock(workflow, "sign");
    assert.match(sign, /\n {4}outputs:\n {6}sbom-sha256: \$\{\{ steps\.take\.outputs\.sbom-sha256 \}\}\n/);
    assert.match(sign, /\n {6}- name: Take each job's files\n {8}id: take\n {8}env:\n {10}ARCHIVE_SHA256: \$\{\{ needs\.source\.outputs\.archive-sha256 \}\}\n/);
    const upload = jobBlock(workflow, "upload");
    assert.match(upload, /^ {4}needs: \[check, source, sign\]\n/);
    assert.match(upload, /\n {10}ARCHIVE_SHA256: \$\{\{ needs\.source\.outputs\.archive-sha256 \}\}\n {10}SBOM_SHA256: \$\{\{ needs\.sign\.outputs\.sbom-sha256 \}\}\n/);
  });
});
