import "../../components/testing/register.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { theme } from "../../lib/theme.ts";

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { UvttLightChoice } = await import("./UvttLightChoice.tsx");
const { Options } = await import("../uvtt/ImportDialog.tsx");

describe("the names of the import's choices", () => {
  test("the light choice's name renders with it", () => {
    const html = renderToStaticMarkup(createElement(UvttLightChoice, { value: "bright", proposal: null, disabled: false, onChange: () => {} }));
    const name = /<span[^>]*style="([^"]*)"[^>]*>Light, for party vision<\/span>/.exec(html);
    assert.ok(name, "the name span renders");
    assert.match(name[1] ?? "", new RegExp(`font-size:${theme.font.input}px`));
    assert.match(name[1] ?? "", new RegExp(`font-weight:${theme.weight.strong}`));
  });

  test("the dialog's portal label takes the same style, not the dialog's 14 px", () => {
    const read = { info: { hasObjects: false, lightPortals: 2 }, plan: null, problem: null, preview: "" };
    const html = renderToStaticMarkup(
      createElement(Options, {
        read: read as never,
        objects: true,
        onObjects: () => {},
        portals: "window",
        onPortals: () => {},
        setting: undefined,
        seen: "reveal",
        like: undefined,
        onSeen: () => {},
        light: "bright",
        onLight: () => {},
        why: null,
        disabled: false,
      }),
    );
    const label = /<span[^>]*style="([^"]*)"[^>]*>Portals that don&#x27;t block light import as<\/span>/.exec(html);
    assert.ok(label, "the portal label renders");
    assert.match(label[1] ?? "", new RegExp(`font-size:${theme.font.input}px`));
    assert.match(label[1] ?? "", new RegExp(`font-weight:${theme.weight.strong}`));
  });
});
