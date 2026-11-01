import "../../components/testing/register.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { theme } from "../../lib/theme.ts";

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { WorkTile } = await import("./StarterBrowser.tsx");
const { loadStarterPacks } = await import("./catalog.ts");

const work = (await loadStarterPacks())[0]!.works[0]!;

function draw(selected: boolean, disabled: boolean): { tile: string; caption: string } {
  const markup = renderToStaticMarkup(createElement(WorkTile, { work, selected, disabled, onSelect() {} }));
  return { tile: /<button[^>]*>/.exec(markup)?.[0] ?? "", caption: /<span aria-hidden="true" style="([^"]*)">/.exec(markup)?.[1] ?? "" };
}

// A stopped tile keeps its place with a dim ring and caption, never a live accent (LOCKED-LOOK).
test("a stopped work tile dims its ring and caption, and a live one keeps the accent", () => {
  const live = draw(true, false);
  assert.ok(live.tile.includes(`border:2px solid ${theme.color.accent}`));
  assert.ok(live.caption.includes(`color:${theme.color.accent}`));
  const stopped = draw(true, true);
  assert.match(stopped.tile, /disabled=""/);
  assert.ok(stopped.tile.includes(`border:2px solid ${theme.color.textDisabled}`));
  assert.ok(stopped.caption.includes(`color:${theme.color.textDisabled}`));
  assert.ok(draw(false, true).caption.includes(`color:${theme.color.textDisabled}`), "an unchosen tile dims its caption too");
});
