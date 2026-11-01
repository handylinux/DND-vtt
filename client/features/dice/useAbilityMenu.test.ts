import "../../components/testing/register.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

/*
 * An ability box's presses and its list's two views
 * (docs/design-v1-stat-block-rolls.md 3.3 and 5), driven through the real
 * control and press registry with the browser's event order
 * (abilityMenu.testing.ts).
 */

const { abilityContent, BOX, sendAbilityRow } = await import("./useAbilityMenu.tsx");
const { KEY_CONTEXT_MS } = await import("./useRollModeMenu.tsx");
const { harness, row } = await import("./abilityMenu.testing.ts");

describe("presses on the box (3.3)", () => {
  test("a tap, a click, Enter, Space, a hold, a right-click and the context keys each open the list, and a press on the open box closes it", () => {
    for (const how of ["tap", "click", "enter", "space", "hold", "right", "contextmenu", "shiftf10", "down", "up"] as const) {
      const h = harness();
      h.state.focus = "box";
      if (how === "tap") h.tap("box");
      if (how === "click") h.tap("box", false);
      if (how === "enter") h.key("Enter");
      if (how === "space") h.key(" ");
      if (how === "hold") {
        h.hold("box");
        assert.equal(h.state.open, true, "open at 500 ms, while the finger is still down");
        h.up();
      }
      if (how === "right") h.rightClick("box");
      if (how === "contextmenu") h.key("ContextMenu");
      if (how === "shiftf10") h.key("F10", true);
      if (how === "down") h.key("ArrowDown");
      if (how === "up") h.key("ArrowUp");
      assert.equal(h.state.open, true, how);
      assert.deepEqual(h.log.rolls, [], `${how} rolls nothing`);
      const key = ["enter", "space", "contextmenu", "shiftf10", "down", "up"].includes(how);
      assert.equal(h.log.shows[0], key ? "key" : "pointer", `${how} opens by its input`);
      if (key) assert.equal(h.state.focus, how === "up" ? "row:ask" : "row:check", "a key open focuses a roll, Up the last");
      if (how === "right") {
        h.rightClick("box");
        assert.equal(h.state.open, false, "right-click again closes it");
        continue;
      }
      h.tap("box");
      assert.equal(h.state.open, false, `${how}: a press on the open box closes it`);
      assert.deepEqual(h.log.rolls, []);
      h.unmount();
    }
  });

  test("a hold of 499 ms is a tap, and moving past the slop, a scroll or a second finger cancels a hold", () => {
    const h = harness();
    h.hold("box", 499);
    assert.equal(h.state.open, false);
    h.up();
    assert.equal(h.state.open, true, "its release is a tap, which opens the list");
    h.tap("box");
    for (const cancel of ["move", "scroll", "finger"] as const) {
      h.down("box");
      if (cancel === "move") h.move(20);
      if (cancel === "scroll") h.scroll();
      if (cancel === "finger") h.down("outside", true, { second: true });
      h.clock.advance(600);
      assert.equal(h.state.open, false, `${cancel} cancels the hold`);
      h.up(false);
    }
  });
});

describe("a row's tap and its options (4, 5)", () => {
  test("a row's tap rolls once and closes, focus on the box", () => {
    const h = harness();
    h.tap("box");
    h.tap("row:save");
    assert.deepEqual(h.log.rolls, [["save", undefined]]);
    assert.equal(h.state.open, false);
    assert.equal(h.state.focus, "box");
  });

  test("a hold on Save swaps the list for its options, and the release over Roll with Advantage, its row gone, rolls nothing", () => {
    const h = harness();
    h.tap("box");
    h.hold("row:save");
    assert.deepEqual(h.state.drawn, { kind: "options", row: "save", source: "save@1", fit: false });
    assert.equal(h.state.focus, "box", "a pointer swap puts focus on the box, before the row goes");
    assert.equal(h.move(30), true, "the held finger's drag scrolls nothing after the swap");
    h.up();
    assert.deepEqual(h.log.rolls, [], "the hold's own click picks nothing");
    assert.equal(h.state.open, true);
    h.down("choice:adv");
    assert.equal(h.move(30), false, "a new touch scrolls the options normally");
    h.up(false);
    h.tap("choice:adv");
    assert.deepEqual(h.log.rolls, [["save", "adv"]], "a later tap picks");
    assert.equal(h.state.open, false);
  });

  test("a reader's activation after a hold picks once", () => {
    const h = harness();
    h.tap("box");
    h.hold("row:save");
    h.up(false);
    h.click("choice:adv", 0);
    assert.deepEqual(h.log.rolls, [["save", "adv"]]);
    h.click("choice:adv", 0);
    assert.deepEqual(h.log.rolls, [["save", "adv"]], "closed, it cannot pick again");
  });

  test("right-click and the context keys on a row swap too, a key swap focusing the first choice", () => {
    for (const how of ["right", "contextmenu", "shiftf10"] as const) {
      const h = harness();
      h.tap("box");
      h.state.focus = "row:save";
      if (how === "right") h.rightClick("row:save");
      else h.key(how === "contextmenu" ? "ContextMenu" : "F10", how === "shiftf10");
      assert.equal(h.state.drawn.kind, "options", how);
      assert.equal(h.state.focus, how === "right" ? "box" : "choice:adv", how);
      assert.deepEqual(h.log.rolls, []);
    }
  });

  test("a row with no options, an ask, has no hold: its press is a tap", () => {
    const h = harness();
    h.tap("box");
    h.hold("row:ask");
    assert.equal(h.state.drawn.kind, "list");
    h.up();
    assert.deepEqual(h.log.rolls, [["ask", undefined]]);
  });

  test("Escape and Back step back to the list on the held row, and the second closes the list on the box", () => {
    for (const how of ["escape", "back"] as const) {
      const h = harness();
      h.tap("box");
      h.hold("row:save");
      h.up();
      if (how === "escape") h.key("Escape");
      else h.back();
      assert.deepEqual([h.state.open, h.state.drawn.kind, h.state.focus], [true, "list", "row:save"], how);
      if (how === "escape") h.key("Escape");
      else h.back();
      assert.deepEqual([h.state.open, h.state.focus], [false, "box"]);
      assert.deepEqual(h.log.rolls, [], "no roll on a step back");
    }
  });

  test("a change of the held roll sends its options back to the list, and a stale pick sends nothing", () => {
    const h = harness();
    h.tap("box");
    h.hold("row:save");
    h.up();
    h.rows[1] = { ...h.rows[1]!, source: "save@2", tag: "Asked" };
    h.tap("choice:adv");
    assert.deepEqual(h.log.rolls, [], "options opened for one roll never send another");
    h.control.revalidate(h.rows, null);
    assert.equal(h.state.drawn.kind, "list");
  });

  test("blocked and busy rows open nothing and send nothing, and a lost connection sends the options back", () => {
    const h = harness();
    h.tap("box");
    h.hold("row:save");
    h.up();
    h.state.blocked = "Rolling needs a connection.";
    h.control.revalidate(h.rows, h.state.blocked);
    assert.equal(h.state.drawn.kind, "list");
    h.tap("row:save");
    h.hold("row:check");
    h.up();
    assert.equal(h.state.drawn.kind, "list");
    h.state.blocked = null;
    h.state.busy.add("c:x|check");
    h.tap("box");
    h.tap("box");
    h.tap("row:check");
    h.hold("row:check");
    h.up();
    assert.equal(h.state.drawn.kind, "list");
    assert.deepEqual(h.log.rolls, []);
  });

  test("Enter on the box while its list is open closes it, as any press on it does", () => {
    const h = harness();
    h.tap("box");
    h.state.focus = "box";
    h.key("Enter");
    assert.equal(h.state.open, false);
    assert.deepEqual(h.log.rolls, []);
  });

  test("a pick checks the roll as it stands: a busy or blocked row, a disabled choice and a list pick under the options send nothing", () => {
    const answer = harness([row("save", { capability: { d20: true, visibility: "request" } }), row("check", { kind: "check" })]);
    answer.tap("box");
    answer.hold("row:save");
    answer.up();
    answer.control.pickChoice("secret");
    assert.deepEqual(answer.log.rolls, [], "an answer's Secret is disabled");
    answer.control.pickRow("check");
    assert.deepEqual(answer.log.rolls, [], "the list's rows are not drawn under the options");
    answer.state.busy.add("c:x|save");
    answer.control.pickChoice("adv");
    answer.state.busy.clear();
    answer.state.blocked = "Rolling needs a connection.";
    answer.control.pickChoice("adv");
    assert.deepEqual(answer.log.rolls, [], "nor while it waits or cannot go");
    answer.state.blocked = null;
    answer.control.pickChoice("adv");
    assert.deepEqual(answer.log.rolls, [["save", "adv"]]);
    const busy = harness();
    busy.tap("box");
    busy.state.busy.add("c:x|save");
    busy.control.pickRow("save");
    assert.deepEqual(busy.log.rolls, [], "a waiting row cannot go twice, whatever its last render said");
    assert.deepEqual([answer.log.unsent, busy.log.unsent], [["Rolling needs a connection."], []], "only the blocked pick says why");
  });

  test("a tap or a pick after the connection dropped, before the render that disables the rows, says why on the result line (section 8)", () => {
    const h = harness([row("save", { capability: { d20: true, visibility: "selectable" } }), row("check", { kind: "check" })]);
    h.tap("box");
    h.state.blocked = "Rolling needs a connection.";
    h.control.pickRow("check");
    assert.deepEqual([h.log.rolls, h.log.unsent], [[], ["Rolling needs a connection."]]);
    h.state.blocked = null;
    h.hold("row:save");
    h.up();
    h.state.blocked = "Rolling needs a connection.";
    h.control.pickChoice("adv");
    assert.deepEqual([h.log.rolls, h.log.unsent], [[], ["Rolling needs a connection.", "Rolling needs a connection."]]);
    // A choice that is not offered, or a roll that changed, says nothing: the options go back to the list, which says why.
    h.control.pickChoice("normal");
    assert.equal(h.log.unsent.length, 2);
  });

  test("after a held row's finger lifts where its row is gone, the next hold on that row keeps its own finger's drag", () => {
    const h = harness();
    h.tap("box");
    h.hold("row:save");
    h.up();
    h.back();
    assert.equal(h.state.drawn.kind, "list", "back on the list, with no press or key since the lift");
    h.hold("row:save");
    assert.equal(h.state.drawn.kind, "options");
    assert.equal(h.move(30), true);
    h.up();
  });

  test("handlers drawn before the registry was cleared, as by a development remount, still press", () => {
    const h = harness();
    const box = h.registry.handlers(BOX, h.control.boxControl);
    h.registry.dispose();
    box.onContextMenu?.({ preventDefault() {}, nativeEvent: { pointerType: "mouse" }, detail: 1 } as never);
    assert.equal(h.state.open, true);
  });

  test("the window's blur closes the list and ends a hold", () => {
    const h = harness();
    h.tap("box");
    h.down("row:save");
    h.leave();
    h.clock.advance(600);
    assert.equal(h.state.open, false);
    assert.equal(h.state.drawn.kind, "list");
  });

  test("once the list closed, the next press drops the rows' idle machines, and an unmount leaves no machine, timer or listener", () => {
    const h = harness();
    const listeners = h.win.count + h.doc.count;
    h.tap("box");
    h.hold("row:save");
    h.up();
    assert.equal(h.registry.size, 2, "the held row's machine outlives its row, until a press or a key spends what it held");
    h.down("outside", false);
    h.up(false);
    assert.equal(h.registry.size, 1, "only the box's machine stays while idle");
    h.down("box");
    h.unmount();
    assert.equal(h.registry.size, 0);
    assert.equal(h.clock.timers.size, 0);
    assert.equal(h.win.count + h.doc.count, 0, `every listener of the ${listeners} went`);
  });
});

describe("sending a row (section 7)", () => {
  const roller = { creature: { characterId: "thorn" }, tokenId: "t1", name: "Thorn", played: true };
  const dice = { you: { memberId: "dm1", role: "dm" as const }, view: { tokens: {}, characters: {} }, srd: { monsters: null, rolls: null } } as never;
  function deps(result: string | "asked" | null, words?: string) {
    const seen = { inputs: [] as Record<string, unknown>[], sent: [] as unknown[], unsent: [] as string[], watched: [] as string[], scores: [] as unknown[] };
    const d = {
      option: {
        d20: (input: Record<string, unknown>) => {
          seen.inputs.push(input);
          if (words) (input.onFail as (w: string) => void)(words);
          return result;
        },
        setInitiative: (...args: unknown[]) => void seen.scores.push(args),
      } as never,
      watch: (tag: string, entry: string) => void seen.watched.push(`${tag}:${entry}`),
      dice,
      dm: true,
      roller,
      ask: true,
      onSent: (s: unknown) => void seen.sent.push(s),
      onUnsent: (w: string) => void seen.unsent.push(w),
    };
    return { d, seen };
  }

  test("a roll goes with no panel choices and no dice tray, and its tag and pick reach the grid", () => {
    const { d, seen } = deps("tag1");
    sendAbilityRow(d, row("save"), "adv");
    assert.equal(seen.inputs[0]?.choices, "none");
    assert.equal(seen.inputs[0]?.override, "adv");
    assert.equal(seen.inputs[0]?.row, "c:x|save");
    assert.equal(seen.inputs[0]?.tokenId, "t1");
    assert.equal(seen.inputs[0]?.played, true);
    assert.deepEqual(seen.sent, [{ tag: "tag1", override: "adv" }]);
    sendAbilityRow(d, row("save"));
    assert.deepEqual(seen.sent[1], { tag: "tag1" }, "a tap names no override");
  });

  test("a roll that did not go gives its words to the grid, and an ask or any other null leaves the line", () => {
    const failed = deps(null, "Rolling needs a connection.");
    sendAbilityRow(failed.d, row("save"));
    assert.deepEqual([failed.seen.sent, failed.seen.unsent], [[], ["Rolling needs a connection."]]);
    const asked = deps("asked");
    sendAbilityRow(asked.d, row("save"));
    assert.deepEqual([asked.seen.sent, asked.seen.unsent], [[], []]);
    const gone = deps(null);
    sendAbilityRow(gone.d, row("save"));
    assert.deepEqual([gone.seen.sent, gone.seen.unsent], [[], []]);
  });

  test("Initiative never asks and writes its fight row once it lands, and the score sets the row with no roll", () => {
    const { d, seen } = deps("tag2");
    sendAbilityRow(d, row("initiative", { kind: "initiative", test: { kind: "initiative" }, entryId: "e1" }));
    assert.deepEqual([seen.inputs[0]?.played, seen.inputs[0]?.ask], [false, false]);
    assert.deepEqual(seen.watched, ["tag2:e1"]);
    sendAbilityRow(d, row("score", { kind: "score", test: null, route: "score", bonus: 12, entryId: "e1", capability: null }));
    assert.deepEqual(seen.scores, [["e1", 12, true]]);
    assert.equal(seen.inputs.length, 1, "the score sends no roll");
    assert.equal(seen.sent.length, 1, "and leaves the result line as it stood");
  });
});

describe("the list as it draws (4.2 and 4.6)", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { AbilityMenu } = await import("./AbilityMenu.tsx");
  const { Popover } = await import("../../components/Popover.tsx");
  const { RoomProvider } = await import("../../state/view.ts");
  const { createStore } = await import("zustand/vanilla");
  const handle = { open: true, kind: "menu", contentId: "m", anchor: { current: null }, box: { current: null }, focusInside: { current: null }, how: { by: "pointer", from: "first" }, close() {} } as never;
  const draw = (props: Partial<Parameters<typeof AbilityMenu>[0]>) => {
    const store = createStore(() => ({ roomId: "r", pending: [], connection: "open" }));
    return renderToStaticMarkup(createElement(RoomProvider, { store: store as never, actions: {} as never, ui: {} as never, children: createElement(Popover, { handle, side: "above", bound: { left: 0, top: 0, right: 400, bottom: 800 }, children: createElement(AbilityMenu, { ability: "dex", rows: [], blocked: null, loading: false, failed: false, busy: new Set<string>(), events: () => ({}), onPick() {}, ...props }) }) }));
  };
  const rows = [
    row("check", { kind: "check", name: "Dexterity check +4", words: "Check", bonusText: "+4" }),
    row("save", { name: "Dexterity save +7, proficient, answers the DM's request", words: "Save", bonusText: "+7", tag: "Asked Dis", level: "prof", capability: { d20: true, visibility: "request" } }),
    row("stealth", { kind: "skill", name: "Stealth +10, expertise", words: "Stealth", bonusText: "+10", level: "expert" }),
    row("ask", { name: "Dexterity save +7, asks Thorn", route: "ask", capability: null, words: "Ask" }),
  ];

  test("its title, its name, each row's words, tag, bonus and mark, and the shortcut words only on a roll with options", () => {
    const html = draw({ rows });
    assert.match(html, /data-roll-mode-title="" aria-hidden="true"[^>]*>Dexterity<\/div>/);
    assert.match(html, /role="menu"[^>]*aria-label="Dexterity rolls"/);
    assert.match(html, /aria-label="Dexterity save \+7, proficient, answers the DM&#x27;s request"/);
    assert.match(html, /data-ability-row="save" data-proficiency-mark="prof" data-proficiency-form="box"/);
    assert.match(html, /data-ability-row="stealth" data-proficiency-mark="expert"/);
    assert.match(html, /<span>Save<\/span><span[^>]*>Asked Dis<\/span>/);
    assert.match(html, />\+7<\/span>/);
    assert.equal((html.match(/aria-keyshortcuts="ContextMenu Shift\+F10"/g) ?? []).length, 3, "the ask has no options");
    assert.match(html, /Hold, right-click or Shift\+F10 for Advantage or Disadvantage\./, "an answer's options have no free Secret");
    assert.match(html, /Hold, right-click or Shift\+F10 for Advantage, Disadvantage or Secret\./);
    assert.doesNotMatch(html, /data-ability-blocked|Hold a roll/, "no foot line, no blocked line");
  });

  test("a row's name, tag and bonus stand on the row's middle, not on the name's baseline, so the tag's smaller type sits centered too", () => {
    const html = draw({ rows });
    const group = /<span style="([^"]*)"><span>Save<\/span><span[^>]*>Asked Dis<\/span>/.exec(html)?.[1] ?? "";
    assert.match(group, /align-items:center/, group);
    assert.doesNotMatch(html, /align-items:baseline/);
  });

  test("blocked: every row disabled and still drawn, one line under the title says why, and each row's description says it too, with no shortcut", () => {
    const html = draw({ rows, blocked: "Rolls are not sent from a preview." });
    assert.match(html, /data-roll-mode-title[^>]*>Dexterity<\/div><div data-ability-blocked=""[^>]*>Rolls are not sent from a preview\.<\/div>/);
    assert.equal((html.match(/aria-disabled="true"/g) ?? []).length, 4);
    assert.equal((html.match(/<span id="[^"]+" hidden="">Rolls are not sent from a preview\.<\/span>/g) ?? []).length, 4);
    assert.doesNotMatch(html, /aria-keyshortcuts|Hold, right-click/);
  });

  test("a busy row waits with its mark after the bonus, disabled", () => {
    const html = draw({ rows, busy: new Set(["c:x|stealth"]) });
    assert.match(html, /aria-disabled="true" aria-busy="true"[^>]*aria-label="Stealth \+10, expertise"/);
    assert.match(html, />\+10…<\/span>/);
  });

  test("while the numbers load, the shared loading line stands in the rows' place, and a failed load says so", () => {
    assert.doesNotMatch(draw({ loading: true }), /role="menu"/);
    assert.match(draw({ failed: true }), /The rolls did not load\. Reload to try again\./);
  });
});

describe("the box's own attributes, as a grid spreads them", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { RoomProvider } = await import("../../state/view.ts");
  const { RoomScope, RoomScopeProvider } = await import("../../state/scope.ts");
  const { createStore } = await import("zustand/vanilla");
  const { room } = await import("#shared/testutil.ts");
  const { useAbilityMenu } = await import("./useAbilityMenu.tsx");

  test("a menu button with its description and context keys, no name of its own, the list closed and its numbers not loaded", () => {
    const store = createStore(() => ({ view: room(), you: { memberId: "p1", role: "player" }, connection: "open", roomId: "r", sceneId: "s1", local: { selectedIds: [], multi: false }, pending: [] }));
    function Probe() {
      const binding = useAbilityMenu({ ability: "dex", roller: { creature: { characterId: "thorn" }, name: "Thorn", played: false }, onSent() {}, onUnsent() {} });
      return createElement("div", {}, createElement("button", { type: "button", "aria-label": "Dexterity 18, +4, save +7, proficient", ...binding.buttonProps, style: binding.pressStyle }, "DEX"), binding.menu);
    }
    const html = renderToStaticMarkup(createElement(RoomProvider, { store: store as never, actions: {} as never, ui: {} as never, children: createElement(RoomScopeProvider, { scope: new RoomScope(), children: createElement(Probe) }) }));
    assert.match(html, /aria-haspopup="menu" aria-expanded="false" aria-describedby="([^"]+)" aria-keyshortcuts="ContextMenu Shift\+F10"/);
    const id = /aria-describedby="([^"]+)"/.exec(html)![1]!;
    assert.match(html, new RegExp(`<span hidden="" id="${id}">Opens the check, the save, its skills and Initiative</span>`));
    assert.match(html, /aria-label="Dexterity 18, \+4, save \+7, proficient"/, "the grid names it with its printed words");
    assert.match(html, /-webkit-touch-callout:none;-webkit-user-select:none;user-select:none/);
    assert.doesNotMatch(html, /role="menu"|aria-controls/, "closed");
  });
});

test("the popover is placed again for the rows after the loading line, and for a roll's options once they have their own box, never for options a held finger still holds", () => {
  const rows = { loading: false, failed: false };
  const held = { kind: "options" as const, row: "save", source: "s", fit: false };
  const keys = [abilityContent({ loading: true, failed: false }, { kind: "list" }), abilityContent(rows, { kind: "list" }), abilityContent(rows, { ...held, fit: true }), abilityContent(rows, { ...held, row: "check", fit: true }), abilityContent({ loading: false, failed: true }, { kind: "list" })];
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(abilityContent(rows, held), abilityContent(rows, { kind: "list" }), "held: the rows' box as it stands");
});

describe("the options' own box (D-261031-212)", () => {
  test("options a held finger opened keep the rows' box until it lifts, then fit, and its lift makes no mouse events where the row was", () => {
    const h = harness();
    h.tap("box");
    h.hold("row:save");
    assert.deepEqual(h.state.drawn, { kind: "options", row: "save", source: "save@1", fit: false });
    h.move(30);
    assert.equal((h.state.drawn as { fit?: boolean }).fit, false, "still held");
    h.up();
    assert.equal((h.state.drawn as { fit?: boolean }).fit, true, "lifted: a box of their own");
    assert.equal(h.liftPrevented, true, "the lift's touchend is used, so no click lands on the page behind");
    assert.deepEqual(h.log.rolls, []);
    h.tap("choice:adv");
    assert.deepEqual(h.log.rolls, [["save", "adv"]]);
  });

  test("options opened with no finger down fit at once: right-click and the context keys", () => {
    for (const how of ["right", "contextmenu"] as const) {
      const h = harness();
      h.tap("box");
      h.state.focus = "row:save";
      if (how === "right") h.rightClick("row:save");
      else h.key("ContextMenu");
      assert.equal((h.state.drawn as { fit?: boolean }).fit, true, how);
    }
  });

  test("a context key's own contextmenu, which Chromium on Windows sends after the keyup to what holds focus by then, swaps nothing: the list stays on its first row", () => {
    for (const key of ["ContextMenu", "F10"] as const) {
      for (const order of ["after the keyup", "before the keyup"] as const) {
        const at = `${key}, ${order}`;
        const h = harness();
        h.state.focus = "box";
        h.key(key, key === "F10");
        assert.deepEqual([h.state.open, h.state.focus], [true, "row:check"], at);
        if (order === "before the keyup") h.keyContextMenu();
        // Used while the wait lasts, so where Blink makes the contextmenu as the keyup's default action it makes none.
        assert.equal(h.keyUp(key), order === "after the keyup", at);
        if (order === "after the keyup") h.keyContextMenu();
        h.clock.advance(KEY_CONTEXT_MS);
        assert.deepEqual([h.state.open, h.state.drawn, h.state.focus], [true, { kind: "list" }, "row:check"], at);
        // A reader's own contextmenu later, with no key down first, still opens the row's options.
        h.keyContextMenu();
        assert.deepEqual(h.state.drawn, { kind: "options", row: "check", source: "check@1", fit: true }, at);
        assert.deepEqual(h.log.rolls, [], at);
      }
    }
  });

  test("Mac's and Linux's order, a used keydown and no contextmenu, changes nothing: the next context key on the row swaps at once, and other keyups are left alone", () => {
    const h = harness();
    h.state.focus = "box";
    h.key("ContextMenu");
    assert.equal(h.keyUp("a"), false, "another key's keyup is not used");
    assert.equal(h.keyUp("ContextMenu"), true);
    h.clock.advance(KEY_CONTEXT_MS);
    assert.equal(h.keyUp("ContextMenu"), false, "the wait is over");
    h.key("ContextMenu");
    assert.deepEqual(h.state.drawn, { kind: "options", row: "check", source: "check@1", fit: true });
  });

  test("the wait for a context key's contextmenu ends at the next press, the next key, or the window's blur, so a reader's contextmenu after them acts", () => {
    for (const end of ["press", "key", "blur"] as const) {
      const h = harness();
      h.state.focus = "box";
      h.key("ContextMenu");
      if (end === "press") {
        h.down("outside", false);
        h.up();
        h.tap("box");
        h.state.focus = "row:check";
      } else if (end === "key") h.key("ArrowDown");
      else {
        // The blur closes the list. A reader's contextmenu on the box opens it again.
        h.leave();
        h.state.focus = "box";
        h.keyContextMenu();
        assert.equal(h.state.open, true, end);
        continue;
      }
      h.keyContextMenu();
      assert.equal(h.state.drawn.kind, "options", end);
    }
  });

  test("a held press a key cancelled still fits once its finger lifts", () => {
    const h = harness();
    h.tap("box");
    h.hold("row:save");
    h.key("a");
    assert.equal((h.state.drawn as { fit?: boolean }).fit, false, "the finger is still down");
    h.up(false);
    assert.equal((h.state.drawn as { fit?: boolean }).fit, true);
  });

  test("an ordinary tap's lift on a row still in the page is left to the browser, so its click picks", () => {
    const h = harness();
    h.tap("box");
    h.tap("row:check");
    assert.equal(h.liftPrevented, false);
    assert.deepEqual(h.log.rolls, [["check", undefined]]);
  });
});
