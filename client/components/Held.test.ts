import "./testing/register.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { theme } from "../lib/theme.ts";

const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { Held, HeldScope } = await import("./Held.tsx");
const { Button } = await import("./Button.tsx");
const { IconButton } = await import("./IconButton.tsx");
const { Field, Input, Select, TextArea } = await import("./Field.tsx");
const { Segmented } = await import("./Segmented.tsx");
const { Switch } = await import("./Switch.tsx");
const { Checkbox } = await import("./Checkbox.tsx");

/*
 * LOCKED-LOOK: a held group's fieldset stops its native controls, and each
 * shared control must also draw the disabled look, as it would for its own
 * `disabled`. Each is drawn inside `Held held` with nothing of its own.
 */
const nothing = () => {};
const controls = {
  Button: () => h(Button, { onClick: nothing }, "Roll"),
  IconButton: () => h(IconButton, { icon: "close", label: "Close", onClick: nothing }),
  Input: () => h(Input, { "aria-label": "DC", value: "14", onChange: nothing }),
  Select: () => h(Select, { "aria-label": "It lasts", value: "a", onChange: nothing }, h("option", { value: "a" }, "Until removed")),
  TextArea: () => h(TextArea, { "aria-label": "Note", value: "x", onChange: nothing }),
  Field: () => h(Field, { label: "Room name", value: "Keep", onChange: nothing }),
  Segmented: () => h(Segmented<"half" | "none">, { label: "On a pass", value: "none", options: [{ value: "half", label: "Half" }, { value: "none", label: "None" }], onChange: nothing }),
  Switch: () => h(Switch, { label: "Against a spell", checked: true, onChange: nothing }),
  Checkbox: () => h(Checkbox, { label: "Players see the DC", checked: true, onChange: nothing }),
};
const held = (on: boolean, child: ReturnType<typeof h>) => h(Held, { held: on, children: child });
const dim = new RegExp(`color:${theme.color.textDisabled}`, "i");
const bright = new RegExp(`color:${theme.color.text}[;"]`, "i");

describe("a held group gives every shared control the disabled look (LOCKED-LOOK)", () => {
  for (const [name, draw] of Object.entries(controls)) {
    test(name, () => {
      const free = renderToStaticMarkup(draw());
      const inHeld = renderToStaticMarkup(held(true, draw()));
      assert.doesNotMatch(free, dim, "free, it never draws dim");
      assert.match(inHeld, /^<fieldset disabled=""/);
      assert.match(inHeld, dim, "held, it draws textDisabled");
      // Its own native control is off as well, so a portal or a nested fieldset never leaves look and behavior apart.
      assert.match(inHeld.replace(/^<fieldset disabled=""[^>]*>/, ""), /\sdisabled=""/);
    });
  }

  test("an inner group that is not held stays held inside a held one", () => {
    const markup = renderToStaticMarkup(held(true, held(false, controls.Button())));
    assert.match(markup, dim);
  });

  test("a group that is not held changes nothing", () => {
    const markup = renderToStaticMarkup(held(false, controls.Button()));
    assert.doesNotMatch(markup, dim);
    assert.match(markup, bright);
  });

  test("HeldScope ends it, as Dialog's portal does", () => {
    const markup = renderToStaticMarkup(held(true, h(HeldScope, { children: controls.Button() })));
    assert.doesNotMatch(markup, dim);
  });
});
