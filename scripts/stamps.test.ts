import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, test } from "node:test";
import { checkThree, threeFile } from "./stamps.ts";

describe("the stamp renderer's three.js guard", () => {
  test("takes the expected version from package.json, not a literal", async () => {
    const root = await mkdtemp(join(tmpdir(), "stamps-three-"));
    try {
      const dir = join(root, "node_modules", "three");
      await mkdir(dir, { recursive: true });
      await writeFile(join(root, "package.json"), JSON.stringify({ devDependencies: { three: "0.186.1" } }));
      await writeFile(join(dir, "package.json"), JSON.stringify({ version: "0.186.1" }));
      await checkThree(dir, root);
      await writeFile(join(dir, "package.json"), JSON.stringify({ version: "0.160.0" }));
      await assert.rejects(checkThree(dir, root), /expected three 0\.186\.1, found 0\.160\.0/);
      await writeFile(join(root, "package.json"), JSON.stringify({ devDependencies: {} }));
      await assert.rejects(checkThree(dir, root), /does not pin three/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("serves the module build, its core build and the loaders, and nothing else", () => {
    const dir = join(sep, "x", "three");
    assert.equal(threeFile("build/three.module.js", dir), join(dir, "build", "three.module.js"));
    assert.equal(threeFile("build/three.core.js", dir), join(dir, "build", "three.core.js"));
    assert.equal(threeFile("examples/jsm/loaders/GLTFLoader.js", dir), join(dir, "examples", "jsm", "loaders", "GLTFLoader.js"));
    assert.equal(threeFile("build/three.cjs", dir), null);
    assert.equal(threeFile("build/three.webgpu.js", dir), null);
    assert.equal(threeFile("examples/jsm/../../../etc/passwd.js", dir), null);
  });
});
