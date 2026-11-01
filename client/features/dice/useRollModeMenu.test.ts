import "../../components/testing/register.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { RoomScope, RoomScopeProvider } = await import("../../state/scope.ts");
const { KEY_CONTEXT_MS, RollPressRegistry, useRollModeMenu } = await import("./useRollModeMenu.tsx");
const { Clock, Target } = await import("./abilityMenu.testing.ts");
const { RollModeMenu } = await import("./RollModeMenu.tsx");
const { theme } = await import("../../lib/theme.ts");
import type { PopoverHandle } from "../../components/Popover.tsx";
import type { UseRollModeMenuOptions } from "./useRollModeMenu.tsx";

function render(capability: UseRollModeMenuOptions["capability"], disabled = false) {
  function Probe() {
    const binding = useRollModeMenu({ source: "c:one|save:dex", name: "Dexterity save, proficient", capability, disabled, dm: false, onTap() {}, onRoll() {} });
    const { tooltipHold: _hold, ...props } = binding.buttonProps;
    return createElement("div", {}, createElement("button", { type: "button", ...props, "aria-describedby": binding.describe("proficiency-help"), "aria-label": "Dexterity save, proficient", style: { minHeight: 44, ...binding.pressStyle } }, "DEX +5"), binding.menu);
  }
  return renderToStaticMarkup(createElement(RoomScopeProvider, { scope: new RoomScope(), children: createElement(Probe) }));
}
test("eligible source retains its name, description, role and dimensions without a wrapper", () => {
  const html = render({ d20: true, visibility: "request" });
  assert.match(html, /^<div><button type="button"/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.match(html, /aria-label="Dexterity save, proficient"/);
  assert.match(html, /aria-describedby="proficiency-help [^"]+"/);
  assert.match(html, /aria-keyshortcuts="ContextMenu Shift\+F10"/);
  assert.match(html, /aria-haspopup="menu" aria-expanded="false"/);
  assert.match(html, /Hold, right-click or Shift\+F10 for Advantage or Disadvantage\./);
  assert.doesNotMatch(html, /min-width|padding|tooltipHold/);
  // iOS Safari reads only the prefixed property, so a long press would select the button's words without it.
  assert.match(html, /-webkit-touch-callout:none;-webkit-user-select:none;user-select:none/);
});
test("excluded and disabled sources receive no menu attributes or hint", () => {
  for (const html of [render({ d20: false, visibility: "creature" }), render({ d20: true, visibility: "selectable" }, true)]) {
    assert.doesNotMatch(html, /aria-haspopup|aria-expanded|aria-keyshortcuts|Hold, right-click|user-select/);
    assert.match(html, /aria-describedby="proficiency-help"/);
  }
});
test("menu actions render in order, titles alone, with fixed and repeat explanations as their descriptions", () => {
  const handle = { open: true, kind: "menu", contentId: "roll-menu", anchor: { current: null }, box: { current: null }, how: { by: "key", from: "first" } } as unknown as PopoverHandle;
  const html = renderToStaticMarkup(createElement(RollModeMenu, { handle, name: "Longbow", title: "Again: 1d20+5", capability: { d20: true, visibility: "repeat", repeat: true }, dm: true, onPick() {} }));
  assert.match(html, /data-roll-mode-menu=""/);
  assert.match(html, /<div data-roll-mode-title="" aria-hidden="true"[^>]*>Again: 1d20\+5<\/div><div role="menu"/, "the title stands over the rows, hidden from a screen reader, which hears the menu's label");
  const look = /<div data-roll-mode-title="" aria-hidden="true" style="([^"]*)"/.exec(html)?.[1] ?? "";
  assert.doesNotMatch(look, /text-transform|letter-spacing/, "the title keeps the button's own case");
  assert.ok(look.includes(`font-weight:${theme.weight.bold};`) && look.includes(`color:${theme.color.textMuted};`), `bolder than the rows and muted, so it reads as their title: ${look}`);
  assert.match(look, /-webkit-line-clamp:2;.*overflow:hidden/);
  assert.match(html, /role="menu"[^>]*aria-label="Roll options for Longbow"/);
  assert.equal((html.match(/role="menuitem"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /menuitemradio|aria-checked|touch-action:none/);
  assert.match(html, /Roll secretly: this repeat keeps its recorded visibility/);
  assert.match(html, /Current effects are not rebuilt/);
  assert.match(html, /aria-disabled="true"/);
});

/** Each menu item's accessible description, by the hidden text its aria-describedby names, and any words the menu shows besides its items. */
function described(html: string): { descriptions: (string | null)[]; shown: string[] } {
  const text = (raw: string) => raw.replaceAll("&#x27;", "'");
  const hidden = new Map([...html.matchAll(/<span id="([^"]+)" hidden="">([^<]*)<\/span>/g)].map((m) => [m[1]!, text(m[2]!)]));
  const descriptions = [...html.matchAll(/<[^>]*role="menuitem"[^>]*>/g)].map(([tag]) => {
    const id = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
    return id ? hidden.get(id) ?? `(no ${id})` : null;
  });
  return { descriptions, shown: [...html.matchAll(/<p[^>]*>([^<]+)<\/p>/g)].map((m) => text(m[1]!)) };
}

test("each capability's menu shows no help of its own, offers Normal only where a tap would roll otherwise, and each choice's description names it, with a fixed reason and a note for every choice (D-261031-078, D-261031-080)", () => {
  const handle = { open: true, kind: "menu", contentId: "roll-menu", anchor: { current: null }, box: { current: null }, how: { by: "key", from: "first" } } as unknown as PopoverHandle;
  for (const dm of [false, true]) for (const visibility of ["selectable", "request", "creature", "repeat"] as const) for (const d20 of [false, true]) for (const damage of [false, true]) for (const repeat of [false, true]) for (const batch of [false, true]) for (const manual of [{}, { mode: true }, { secret: true }]) {
    const capability = { d20, damage, visibility, repeat, batch, manual };
    const html = renderToStaticMarkup(createElement(RollModeMenu, { handle, name: "Test", title: "Test", capability, dm, onPick() {} }));
    const { descriptions, shown } = described(html);
    if ((!d20 || damage) && visibility !== "selectable") {
      assert.equal(html, "", "ineligible controls have no menu");
      continue;
    }
    assert.deepEqual(shown, [], `no visible help: ${JSON.stringify(capability)}`);
    const secret = visibility === "selectable" ? dm ? "hide the dice from players." : "you and the DM see the result." : {
      request: "request answers keep the request's visibility.", creature: "this roll's visibility is set by the creature.", repeat: "this repeat keeps its recorded visibility.",
    }[visibility];
    const every = [
      ...(repeat ? ["All repeat choices: use the recorded formula. Current effects are not rebuilt."] : []),
      ...(batch ? ["All choices: apply to server rolls only. Players choose their own modes."] : []),
    ];
    const own = (words?: string) => [words, ...every].filter(Boolean).join(" ") || null;
    const normal = repeat || (d20 && !damage && "mode" in manual) || (visibility === "selectable" && "secret" in manual);
    assert.deepEqual(descriptions, [
      ...(d20 && !damage ? [own(), own()] : []),
      own(`Roll secretly: ${secret}`),
      ...(normal ? [own(repeat ? "Roll normally: ignores the recorded mode and keeps the formula and visibility." : "Roll normally: ignores Adv, Dis and Secret pressed for this roll. Conditions and usual visibility still apply.")] : []),
    ], JSON.stringify(capability));
    assert.doesNotMatch(html, /manual modes/i);
    assert.equal(/aria-disabled="true"/.test(html), visibility !== "selectable");
  }
});

test("a pick closes and focuses before dispatch, names the source origin and revalidates the live route", () => {
  const previous = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node };
  const events: string[] = [];
  class FakeNode {}
  Object.assign(globalThis, { window: new EventTarget(), document: { activeElement: null, body: null }, Node: FakeNode });
  try {
    let valid = true;
    let binding: ReturnType<typeof useRollModeMenu> | undefined;
    function Probe() {
      binding = useRollModeMenu({ source: "one", name: "Dexterity save", capability: { d20: true, visibility: "request" }, dm: true, valid: () => valid, onTap: () => events.push("tap"), onRoll: (override) => events.push(`roll:${override}`) });
      return null;
    }
    renderToStaticMarkup(createElement(RoomScopeProvider, { scope: new RoomScope(), children: createElement(Probe) }));
    assert.ok(binding);
    const node = { style: { boxShadow: "" }, closest: () => null, parentElement: null, isConnected: true, getClientRects: () => [1], focus: () => events.push("focus"), dispatchEvent: (event: Event) => { events.push(event.type); return true; } };
    binding.buttonProps.ref(node as unknown as HTMLButtonElement);
    const menu = (binding.menu as { props: { children: unknown[] } }).props.children[1] as { props: { onPick(override: string): void } };
    const keyEvent = { key: "F10", shiftKey: true, preventDefault() {} } as never;
    binding.buttonProps.onKeyDown?.(keyEvent);
    menu.props.onPick("secret"); assert.deepEqual(events, [], "disabled choices never dispatch or close");
    menu.props.onPick("adv"); assert.deepEqual(events, ["focus", "rvtt-roll-mode-origin", "roll:adv"]);
    menu.props.onPick("adv"); assert.deepEqual(events, ["focus", "rvtt-roll-mode-origin", "roll:adv"], "a closed invocation cannot run twice");
    events.length = 0;
    binding.buttonProps.onKeyDown?.(keyEvent); valid = false;
    menu.props.onPick("dis"); assert.deepEqual(events, ["focus"], "an invalid live target closes without rolling");
  } finally { Object.assign(globalThis, previous); }
});

test("ordinary taps ignore menu validity but retain disabled and press guards", () => {
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: new EventTarget(), document: { activeElement: null, body: null } });
  try { for (const d20 of [true, false]) for (const disabled of [false, true]) {
    let taps = 0, checks = 0;
    let binding: ReturnType<typeof useRollModeMenu> | undefined;
    function Probe() {
      binding = useRollModeMenu({ source: "one", name: "Again", capability: { d20, visibility: "repeat" }, disabled, dm: false, valid: () => { checks++; return false; }, onTap: () => { taps++; }, onRoll() {} });
      return null;
    }
    renderToStaticMarkup(createElement(RoomScopeProvider, { scope: new RoomScope(), children: createElement(Probe) }));
    binding!.buttonProps.onClick?.({ detail: 1 } as never);
    binding!.buttonProps.onClick?.({ detail: 0 } as never);
    assert.equal(taps, disabled ? 0 : 2, "an ordinary pointer or reader tap still reaches its handler");
    assert.equal(checks, 0, "validity belongs to menu opening and picking only");
    binding!.buttonProps.onKeyDown?.({ key: "ContextMenu", preventDefault() {} } as never);
    assert.equal(checks, d20 && !disabled ? 1 : 0, "opening still rechecks validity");
  } } finally { Object.assign(globalThis, previous); }
});

test("an explicit mouse context event stays a pointer opening even for Ctrl+click", () => {
  const previous = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node };
  class FakeNode {}
  Object.assign(globalThis, { window: new EventTarget(), document: { activeElement: null, body: null }, Node: FakeNode });
  try {
    for (const pointerType of ["mouse", "", undefined, "pen"]) {
      let focuses = 0;
      let binding: ReturnType<typeof useRollModeMenu> | undefined;
      function Probe() {
        binding = useRollModeMenu({ source: "one", name: "Again", capability: { d20: true, visibility: "repeat" }, dm: false, onTap() {}, onRoll() {} });
        return null;
      }
      renderToStaticMarkup(createElement(RoomScopeProvider, { scope: new RoomScope(), children: createElement(Probe) }));
      binding!.buttonProps.ref({ closest: () => null, parentElement: null, focus: () => { focuses++; } } as unknown as HTMLButtonElement);
      binding!.buttonProps.onContextMenu?.({ nativeEvent: { pointerType }, detail: 0, button: 0, ctrlKey: true, preventDefault() {} } as never);
      assert.equal(focuses, pointerType ? 1 : 0, `${pointerType || "legacy keyboard"} opens by its actual input type`);
    }
  } finally { Object.assign(globalThis, previous); }
});

test("containing scrolls keep an open menu while its source remains visible, and close it through Popover once the source leaves (scrolledAway)", async () => {
  const { handleRollModeScroll } = await import("./useRollModeMenu.tsx");
  const { scrolledAway } = await import("../../components/Popover.tsx");
  const previous = { document: globalThis.document, window: globalThis.window, Element: globalThis.Element };
  class ScrollElement {
    rect = { left: 10, right: 110, top: 20, bottom: 120 };
    child: ScrollElement | null = null;
    contains(node: unknown) { return node === this || node === this.child; }
    getBoundingClientRect() { return this.rect; }
  }
  const source = new ScrollElement();
  source.rect = { left: 30, right: 74, top: 40, bottom: 84 };
  const scroller = new ScrollElement(); scroller.child = source;
  Object.assign(globalThis, { document: {}, window: { innerWidth: 300, innerHeight: 200 }, Element: ScrollElement });
  try {
    let cancelled = 0, closed = 0;
    // As the page runs them: the open menu's Popover closes it once its source scrolled away, and the roll's own listener cancels a press.
    const scroll = (target: unknown, open = true) => {
      if (open && scrolledAway(target as EventTarget, source as unknown as Element)) closed++;
      handleRollModeScroll({ target: target as EventTarget, anchor: source as unknown as HTMLElement, open, cancel: () => { cancelled++; } });
    };
    scroll(scroller);
    assert.deepEqual([cancelled, closed], [0, 0], "a browser adjustment must not dismiss a visible source or release its consumed finger");
    source.rect.top = 15; source.rect.bottom = 59;
    scroll(scroller);
    assert.deepEqual([cancelled, closed], [0, 0], "a partly visible source keeps its menu");
    source.rect.top = -24; source.rect.bottom = 20;
    scroll(scroller);
    assert.deepEqual([cancelled, closed], [1, 1], "no overlap at the container edge closes the menu");
    source.rect = { left: 30, right: 74, top: 40, bottom: 84 };
    scroll(scroller, false);
    assert.deepEqual([cancelled, closed], [2, 1], "any containing scroll still cancels a pending hold");
    scroll(new ScrollElement(), false);
    assert.deepEqual([cancelled, closed], [2, 1], "menu scrolling and unrelated scrolling do not dismiss the source");
    scroll(new ScrollElement());
    assert.deepEqual([cancelled, closed], [2, 1], "a scroll of an element that does not hold the source leaves the menu");
    scroll(document);
    assert.deepEqual([cancelled, closed], [2, 1], "a visible source survives a document scroll too");
    source.rect.top = 200; source.rect.bottom = 244;
    scroll(document);
    assert.deepEqual([cancelled, closed], [3, 2], "a source below the viewport closes the menu");
    scroller.rect = { left: 10, right: 110, top: 180, bottom: 280 };
    scroll(scroller);
    assert.deepEqual([cancelled, closed], [4, 3], "a nested scroller cannot keep an offscreen source alive");
    scroller.rect = { left: 10, right: 110, top: 20, bottom: 120 };
    for (const rect of [
      { left: 110, right: 154, top: 40, bottom: 84 },
      { left: -34, right: 10, top: 40, bottom: 84 },
      { left: 30, right: 74, top: 120, bottom: 164 },
      { left: 30, right: 30, top: 40, bottom: 84 },
    ]) {
      source.rect = rect;
      const before = closed; scroll(scroller);
      assert.equal(closed, before + 1, "a source past any container edge or with no area closes");
    }
    source.rect = { left: 30, right: 74, top: 119.5, bottom: 163.5 };
    const before = closed; scroll(scroller);
    assert.equal(closed, before, "fractional overlap at an interface scale still counts as visible");
  } finally { Object.assign(globalThis, previous); }
});

test("without popovers the menu's holders rise as before, keeping higher overlays and putting back only what they wrote, and with popovers nothing rises (D-261031-088)", async () => {
  const { raiseRollModeHosts } = await import("./useRollModeMenu.tsx");
  const previous = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
  type Host = { parentElement: Host | null; style: { zIndex: string }; computed: { position: string; zIndex: string } };
  const body = { parentElement: null, style: { zIndex: "" }, computed: { position: "relative", zIndex: "auto" } };
  const hosts: Host[] = [];
  for (const zIndex of ["auto", "-1", "0", "20", "21", "22", "25"]) hosts.push({ parentElement: hosts.at(-1) ?? body, style: { zIndex: zIndex === "auto" ? "" : zIndex }, computed: { position: "relative", zIndex } });
  const plain = { parentElement: hosts.at(-1)!, style: { zIndex: "" }, computed: { position: "static", zIndex: "auto" } };
  Object.assign(globalThis, { document: { body }, getComputedStyle: (node: Host) => node.computed });
  try {
    const anchor = { parentElement: plain } as unknown as HTMLElement;
    raiseRollModeHosts(anchor, { showPopover() {} } as unknown as HTMLElement)();
    assert.deepEqual(hosts.map((host) => host.style.zIndex), ["", "-1", "0", "20", "21", "22", "25"], "in the top layer nothing rises");
    const restore = raiseRollModeHosts(anchor, {} as HTMLElement);
    assert.deepEqual(hosts.map((host) => host.style.zIndex), ["21", "21", "21", "21", "21", "22", "25"]);
    assert.equal(plain.style.zIndex, ""); assert.equal(body.style.zIndex, "");
    hosts[1]!.style.zIndex = "30";
    restore();
    assert.deepEqual(hosts.map((host) => host.style.zIndex), ["", "30", "0", "20", "21", "22", "25"]);
  } finally { Object.assign(globalThis, previous); }
});

test("the open menu's ring goes on its source outside its border and comes off as it closes, putting back only what it wrote (D-261031-079)", async () => {
  const { markRollModeSource } = await import("./useRollModeMenu.tsx");
  const { theme } = await import("../../lib/theme.ts");
  const ring = `0 0 0 2px ${theme.color.accent}`;
  const button = { style: { boxShadow: "" } };
  let clear = markRollModeSource(button as unknown as HTMLElement);
  assert.equal(button.style.boxShadow, ring);
  clear();
  assert.equal(button.style.boxShadow, "", "closed: the ring is gone");
  const framed = { style: { boxShadow: "inset 0 -2px 0 gold" } };
  clear = markRollModeSource(framed as unknown as HTMLElement);
  assert.equal(framed.style.boxShadow, `inset 0 -2px 0 gold, ${ring}`, "beside a proficiency frame's own shadow");
  clear();
  assert.equal(framed.style.boxShadow, "inset 0 -2px 0 gold");
  clear = markRollModeSource(framed as unknown as HTMLElement);
  framed.style.boxShadow = "inset 0 -2px 0 silver";
  clear();
  assert.equal(framed.style.boxShadow, "inset 0 -2px 0 silver", "a render's new value while open stays");
  markRollModeSource(null)();
});

test("a roll button's context key closes its open menu once: the contextmenu Chromium on Windows sends after the keyup does not open it again, and a reader's later one does", () => {
  const clock = new Clock();
  const win = new Target();
  const registry = new RollPressRegistry({ clock, document: new Target() });
  const detach = registry.attach(win, new Target(), { onLeave() {} });
  let open = true;
  const shows: string[] = [];
  const button = { open: () => open, show: (by: "pointer" | "key") => { open = true; shows.push(by); }, close: () => void (open = false), node: () => null, menuOpen: () => open };
  const handlers = registry.handlers("button", button);
  const key = (k: string) => {
    win.fire("keydown", { key: k });
    handlers.onKeyDown?.({ key: k, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {} } as never);
  };
  const keyMenu = () => handlers.onContextMenu?.({ preventDefault() {}, nativeEvent: { pointerType: "" }, detail: 0 } as never);
  key("ContextMenu");
  assert.equal(open, false, "the key closed the open menu");
  assert.equal(win.fire("keyup", { key: "ContextMenu" }).defaultPrevented, true);
  keyMenu();
  clock.advance(KEY_CONTEXT_MS);
  assert.equal(open, false, "and its keyup's contextmenu did not open it again");
  keyMenu();
  assert.deepEqual([open, shows], [true, ["key"]], "a reader's contextmenu, with no key before it, opens it");
  detach();
});
