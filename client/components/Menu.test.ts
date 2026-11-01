import "./testing/register.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ReactElement } from "react";
import type { MenuItem } from "./Menu.tsx";
import type { PopoverHandle } from "./Popover.tsx";

/*
 * Menu items with their own content, look, marks, names and presses
 * (docs/design/design-v1-stat-block-rolls.md 4.7 and 10), as an ability's list
 * draws its rows. An item without them draws as before.
 */

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { Menu } = await import("./Menu.tsx");
const { Popover } = await import("./Popover.tsx");

type Props = Parameters<typeof Menu>[0];
type Node = { props: Record<string, unknown> & { children?: unknown } };

function handle(closes: string[]): PopoverHandle {
  return { open: true, kind: "menu", contentId: "m", anchor: { current: null }, box: { current: null }, focusInside: { current: null }, how: { by: "key", from: "first" }, close: (reason: string) => closes.push(reason) } as unknown as PopoverHandle;
}

/** Renders the menu in an open popover, and keeps the element tree Menu returned, whose handlers a test calls as React would. */
function draw(props: Props, closes: string[] = []): { html: string; root: Node; items: Node[] } {
  let tree: ReactElement | null = null;
  function Probe() {
    tree = Menu(props) as ReactElement;
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Popover, { handle: handle(closes), side: "above", bound: { left: 0, top: 0, right: 400, bottom: 800 }, children: createElement(Probe) }));
  assert.ok(tree);
  const items: Node[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const n = node as Node;
    if (typeof n.props.role === "string" && n.props.role.startsWith("menuitem")) items.push(n);
    walk(n.props.children);
  };
  walk((tree as Node).props.children);
  return { html, root: tree as Node, items };
}

const plain: MenuItem[] = [
  { id: "a", title: "Alpha", kind: "action" },
  { id: "b", title: "Beta", kind: "action", description: "Its words." },
];

describe("a menu item with its own parts", () => {
  test("content draws in place of the title, with the item's style over its look, its marks, name and busy state", () => {
    const { html } = draw({
      label: "Dexterity rolls",
      sections: [{ key: "rows", items: [{ id: "save", title: "Save", kind: "action", content: createElement("span", { "data-row-words": "" }, "Save +2"), style: { borderColor: "red" }, data: { "data-proficiency": "prof" }, label: "Dexterity save +2, proficient", busy: true }] }],
      onPick() {},
    });
    assert.match(html, /<span data-row-words="">Save \+2<\/span>/);
    assert.doesNotMatch(html, />Save</, "the title itself is not drawn");
    assert.match(html, /role="menuitem"[^>]*aria-label="Dexterity save \+2, proficient"/);
    assert.match(html, /data-proficiency="prof"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /style="[^"]*border-color:red/);
  });

  test("items without them draw as before", () => {
    const { html } = draw({ label: "More", sections: [{ key: "s", items: plain }], onPick() {} });
    assert.doesNotMatch(html, /aria-label="(?!More)|aria-busy|data-proficiency/);
    assert.match(html, /<span style="[^"]*">Alpha<\/span>/);
    assert.match(html, /<span id="[^"]+" hidden="">Its words\.<\/span>/);
  });

  test("an item's events go on it, and its click stays Menu's one pick, even where events carry an onClick", () => {
    const picks: string[] = [];
    const closes: string[] = [];
    const pressed: string[] = [];
    const events = { onPointerDown: () => pressed.push("down"), onContextMenu: () => pressed.push("context"), onClick: () => pressed.push("own click") };
    const { items } = draw({ label: "Rolls", sections: [{ key: "s", items: [{ id: "x", title: "Check", kind: "action", events: events as never }] }], onPick: (id) => picks.push(id) }, closes);
    const item = items[0]!;
    (item.props.onPointerDown as () => void)();
    (item.props.onContextMenu as () => void)();
    (item.props.onClick as (e: unknown) => void)({ detail: 1 });
    assert.deepEqual(pressed, ["down", "context"], "the binding's own onClick never lands on the item");
    assert.deepEqual(picks, ["x"]);
    assert.deepEqual(closes, ["pick"]);
  });

  test("a disabled or busy item picks nothing", () => {
    const picks: string[] = [];
    const { items } = draw({ label: "Rolls", sections: [{ key: "s", items: [{ id: "x", title: "Check", kind: "action", disabled: true }, { id: "y", title: "Save", kind: "action", busy: true }] }], onPick: (id) => picks.push(id) });
    for (const item of items) (item.props.onClick as (e: unknown) => void)({ detail: 1 });
    assert.deepEqual(picks, []);
  });

  test("typeahead reads the title, not the content drawn, and a key the item used never reaches Menu's own handling", () => {
    const previous = { document: globalThis.document };
    const focused: string[] = [];
    const nodes = new Map<string, { focus(): void; closest(): null }>();
    const doc = { activeElement: null as unknown };
    Object.assign(globalThis, { document: doc });
    try {
      const picks: string[] = [];
      const items: MenuItem[] = [
        { id: "check", title: "Check", kind: "action", content: "Zzz +2" },
        { id: "stealth", title: "Stealth", kind: "action", content: "Aaa +6" },
      ];
      const drawn = draw({ label: "Rolls", sections: [{ key: "s", items }], onPick: (id) => picks.push(id) });
      for (const [i, item] of drawn.items.entries()) {
        const id = items[i]!.id;
        const node = { focus: () => focused.push(id), closest: () => null };
        nodes.set(id, node);
        (item.props.ref as (n: unknown) => void)(node);
      }
      doc.activeElement = nodes.get("check");
      const key = (over: Record<string, unknown>) => ({ key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, timeStamp: 1, preventDefault() {}, ...over });
      (drawn.root.props.onKeyDown as (e: unknown) => void)(key({ key: "s", code: "KeyS" }));
      assert.deepEqual(focused, ["stealth"], "S finds Stealth by its title");
      (drawn.root.props.onKeyDown as (e: unknown) => void)(key({ key: "Enter", defaultPrevented: true }));
      assert.deepEqual(picks, [], "a key the row marked used, as its ContextMenu, is left alone");
      (drawn.root.props.onKeyDown as (e: unknown) => void)(key({ key: "Enter" }));
      assert.deepEqual(picks, ["check"]);
    } finally {
      Object.assign(globalThis, previous);
    }
  });
});

describe("the pick's input kind (D-261101-098)", () => {
  test("a click with detail 1 is a pointer's pick, and one with detail 0, a reader's activation, is a key's", () => {
    const picks: string[] = [];
    const { items } = draw({ label: "Rolls", sections: [{ key: "s", items: [{ id: "x", title: "Check", kind: "action" }] }], onPick: (id, by) => picks.push(`${id}:${by}`) });
    (items[0]!.props.onClick as (e: unknown) => void)({ detail: 1 });
    (items[0]!.props.onClick as (e: unknown) => void)({ detail: 0 });
    (items[0]!.props.onClick as (e: unknown) => void)({ detail: 2 });
    assert.deepEqual(picks, ["x:pointer", "x:key", "x:pointer"]);
  });

  test("Enter and Space pick as a key", () => {
    const previous = { document: globalThis.document };
    const doc = { activeElement: null as unknown };
    Object.assign(globalThis, { document: doc });
    try {
      const picks: string[] = [];
      const drawn = draw({ label: "Rolls", sections: [{ key: "s", items: [{ id: "check", title: "Check", kind: "action" }] }], onPick: (id, by) => picks.push(`${id}:${by}`) });
      const node = { focus() {}, closest: () => null };
      (drawn.items[0]!.props.ref as (n: unknown) => void)(node);
      doc.activeElement = node;
      const key = (k: string) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, timeStamp: 1, preventDefault() {} });
      (drawn.root.props.onKeyDown as (e: unknown) => void)(key("Enter"));
      (drawn.root.props.onKeyDown as (e: unknown) => void)(key(" "));
      assert.deepEqual(picks, ["check:key", "check:key"]);
    } finally {
      Object.assign(globalThis, previous);
    }
  });
});
