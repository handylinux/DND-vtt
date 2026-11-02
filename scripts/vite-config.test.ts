import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { build, type PluginOption, type Rolldown } from "vite";
import config, { stableAssetMaps } from "../vite.config.ts";

/*
 * Source maps that come out the same from every build (vite.config.ts
 * stableAssetMaps). Which order the bundler numbers a module's assets in
 * depends on which read from disk finishes first, so comparing two builds
 * would pass by luck. What is checked instead is that no placeholder, the
 * thing that carries the order, reaches a map, on a small build of a module
 * that imports many assets at once, as the DM guide does.
 */

const ASSETS = 24;

/** The fixture built with these plugins: each written map's sources, their text and the bundled code. */
async function buildFixture(plugins: PluginOption[]) {
  const root = mkdtempSync(path.join(tmpdir(), "raccoon-vite-maps-"));
  try {
    mkdirSync(path.join(root, "img"));
    for (let i = 0; i < ASSETS; i++) writeFileSync(path.join(root, "img", `shot-${i}.webp`), `image ${i}`);
    writeFileSync(path.join(root, "main.js"), 'const urls = import.meta.glob("./img/*.webp", { eager: true, query: "?url", import: "default" });\nconsole.log(urls);\n');
    const output = (await build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins,
      build: { write: false, sourcemap: true, assetsInlineLimit: 0, rollupOptions: { input: path.join(root, "main.js") } },
    })) as Rolldown.RolldownOutput;
    const map = output.output.find((f): f is Rolldown.OutputAsset => f.type === "asset" && f.fileName.endsWith(".js.map"));
    const chunk = output.output.find((f): f is Rolldown.OutputChunk => f.type === "chunk");
    assert.ok(map && chunk, "the build wrote a chunk and its map");
    const parsed = JSON.parse(String(map.source)) as { sources: string[]; sourcesContent: string[] };
    return { text: String(map.source), sources: parsed.sources, contents: parsed.sourcesContent, code: chunk.code };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("the build's source maps", () => {
  test("carry each imported asset's URL, never the bundler's numbered placeholder", async () => {
    const { text, sources, contents, code } = await buildFixture([stableAssetMaps()]);
    assert.doesNotMatch(text, /ROLLDOWN_FILE_URL/);
    const assets = sources.flatMap((s, i) => (s.endsWith(".webp?url") ? [contents[i]!] : []));
    assert.equal(assets.length, ASSETS);
    for (const content of assets) {
      const url = /^export default "(\/assets\/shot-\d+-[\w-]+\.webp)"$/.exec(content)?.[1];
      assert.ok(url && code.includes(url), `${content} names a URL the bundled code holds`);
    }
  });

  test("without the plugin, the placeholders reach the map", async () => {
    const { contents } = await buildFixture([]);
    assert.equal(contents.filter((c) => /^export default import\.meta\.ROLLDOWN_FILE_URL_[\w$]{22}$/.test(c)).length, ASSETS);
  });

  test("the app's build uses the plugin", () => {
    const names: string[] = [];
    const visit = (p: unknown): void => {
      if (Array.isArray(p)) p.forEach(visit);
      else if (p && typeof p === "object" && "name" in p && typeof p.name === "string") names.push(p.name);
    };
    visit(config.plugins);
    assert.ok(names.includes("raccoon:stable-asset-maps"), names.join(", "));
  });
});
