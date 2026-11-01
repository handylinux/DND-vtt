import "../../components/testing/register.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LogEntry } from "#shared/model.ts";
import { createStore } from "zustand/vanilla";
import { receiptsSlot, ReceiptTracker, SurfaceVoice } from "./useReceipt.ts";

/*
 * One announcer per roll (docs/design/design-v1-stat-block-rolls.md 8,
 * D-261031-133 and D-261031-166): of the surfaces that show a tag, the one
 * that sent it says it while mounted, any other only where nobody claims
 * it and nobody said it yet, and the toast is one of those voices.
 */

const line = (tag: string): LogEntry => ({ id: `0001-${tag}`, kind: "event", data: { type: "dice", tag, rolls: [] } }) as unknown as LogEntry;

function tracker(log: LogEntry[] = []) {
  const t = new ReceiptTracker();
  t.env = { lookup: async () => ({ parts: [] }), log: () => log };
  return t;
}

/** A surface as the hook runs it: it says a settled tag once it may, marks it said, and keeps saying it. */
function surface(t: ReceiptTracker, tag: string, claim: boolean) {
  const stop = t.watch(tag);
  const release = claim ? t.claimVoice(tag) : () => undefined;
  let said = false;
  return {
    /** Renders once with the tag's state: whether its live region holds the result. */
    render(): boolean {
      const state = t.state(tag);
      const settled = state !== null && state.state !== "sending" && state.state !== "checking";
      const speaks = said || t.maySpeak(tag, claim);
      if (speaks && settled && !said) {
        said = true;
        t.spoken(tag);
      }
      return speaks && settled;
    },
    unmount() {
      release();
      stop();
      const state = t.state(tag);
      if (state && state.state !== "sending" && state.state !== "checking") t.announced(tag);
    },
  };
}

describe("one announcer per roll tag", () => {
  for (const outcome of ["committed", "refused"] as const) {
    test(`the sender alone says a ${outcome} result while another surface shows it silent`, () => {
      const log: LogEntry[] = [];
      const t = tracker(log);
      t.sending("a", 0);
      const block = surface(t, "a", true);
      const panel = surface(t, "a", false);
      assert.deepEqual([block.render(), panel.render()], [false, false], "nothing to say while it waits");
      if (outcome === "committed") log.push(line("a"));
      t.answer("a", 0, outcome === "committed" ? "taken" : "refused", outcome === "refused" ? { code: "invalid", message: "No.", text: "No." } as never : undefined);
      // In either render order, since the claim decides.
      assert.equal(panel.render(), false, "the Dice panel's line stays silent");
      assert.equal(block.render(), true, "the block says it");
      assert.equal(panel.render(), false);
      assert.equal(block.render(), true, "and keeps saying it on later renders");
      block.unmount(); panel.unmount();
      assert.deepEqual(t.unannounced(), [], "shown where it was sent, so no toast");
    });
  }

  test("a claim released before the result lands lets a surface that shows it say it once, and never one mounted later", () => {
    const log: LogEntry[] = [];
    const t = tracker(log);
    t.sending("a", 0);
    const block = surface(t, "a", true);
    const panel = surface(t, "a", false);
    block.unmount();
    log.push(line("a"));
    t.answer("a", 0, "taken");
    assert.equal(panel.render(), true, "the Dice panel's line says it, since the block folded first");
    assert.equal(panel.render(), true);
    const later = surface(t, "a", false);
    assert.equal(later.render(), false, "a surface mounted after it was said shows it and says nothing");
    panel.unmount(); later.unmount();
    assert.deepEqual(t.unannounced(), []);
  });

  test("claims count, so a remount's second claim keeps the voice after the first lets go", () => {
    const t = tracker([line("a")]);
    t.sending("a", 0);
    const first = t.claimVoice("a");
    const second = t.claimVoice("a");
    first();
    first();
    t.answer("a", 0, "taken");
    assert.equal(t.maySpeak("a", false), false, "still claimed, so others stay silent");
    second();
    assert.equal(t.maySpeak("a", false), true, "nobody claims it and nobody said it");
    t.spoken("a");
    assert.equal(t.maySpeak("a", false), false);
    assert.equal(t.maySpeak("a", true), false, "said, so not even a claimant may start: a surface that said it keeps its own words");
  });

  test("a sender's block shown again after the toast told its result shows it silent: the toast said it, so its claim does not say it twice", () => {
    for (const outcome of ["committed", "refused"] as const) {
      const log: LogEntry[] = [];
      const t = tracker(log);
      t.sending("a", 0);
      // Hidden while it waits: the block's line holds no tag and no claim.
      if (outcome === "committed") log.push(line("a"));
      t.answer("a", 0, outcome === "committed" ? "taken" : "refused", outcome === "refused" ? { code: "invalid", message: "No.", text: "No." } as never : undefined);
      assert.deepEqual(t.unannounced().map((u) => u.tag), ["a"], `${outcome}: the toast says it`);
      // Shown again: the line watches and claims the tag once more.
      const block = surface(t, "a", true);
      assert.equal(block.render(), false, `${outcome}: the block shows it and says nothing`);
      assert.equal(block.render(), false, `${outcome}: on later renders too`);
      block.unmount();
      assert.deepEqual(t.unannounced(), [], `${outcome}: and no second toast`);
    }
  });

  test("a sender's surface that said its result keeps saying it, and the same claim mounted again after it said shows it silent", () => {
    const t = tracker([line("a")]);
    t.sending("a", 0);
    const block = surface(t, "a", true);
    t.answer("a", 0, "taken");
    assert.equal(block.render(), true);
    assert.equal(block.render(), true, "its words stay in its live region");
    block.unmount();
    const again = surface(t, "a", true);
    assert.equal(again.render(), false, "a remount says nothing it said before");
    again.unmount();
  });

  test("a release lets the surfaces that show the tag look again", () => {
    const t = tracker();
    t.sending("a", 0);
    const release = t.claimVoice("a");
    let heard = 0;
    t.subscribe(() => heard++);
    release();
    assert.ok(heard > 0);
  });

  for (const outcome of ["committed", "refused"] as const) {
    test(`with every surface closed before a ${outcome} roll settles, the toast says it once and a Dice panel opened after says nothing (D-261031-166)`, () => {
      const log: LogEntry[] = [];
      const t = tracker(log);
      t.sending("a", 0);
      const block = surface(t, "a", true);
      block.unmount();
      if (outcome === "committed") log.push(line("a"));
      t.answer("a", 0, outcome === "committed" ? "taken" : "refused", outcome === "refused" ? { code: "invalid", message: "No.", text: "No." } as never : undefined);
      assert.deepEqual(t.unannounced().map((u) => [u.tag, u.state.state]), [["a", outcome]], "one toast");
      assert.deepEqual(t.unannounced(), [], "never twice");
      const panel = surface(t, "a", false);
      assert.equal(panel.render(), false, "the toast said it, so the panel's line shows it silent");
      panel.unmount();
      assert.deepEqual(t.unannounced(), []);
    });
  }

  test("the toast never hands out a tag a surface already said, even one the surface never marked announced", () => {
    const t = tracker([line("a")]);
    t.sending("a", 0);
    const stop = t.watch("a");
    t.answer("a", 0, "taken");
    t.spoken("a");
    stop();
    assert.deepEqual(t.unannounced(), []);
  });

  test("a result the roll animation held back as its panel closed was never said, so it still toasts", () => {
    const t = tracker([line("a")]);
    t.sending("a", 0);
    const panel = surface(t, "a", false);
    t.answer("a", 0, "taken");
    panel.render();
    t.unseen("a");
    panel.unmount();
    assert.deepEqual(t.unannounced().map((u) => u.tag), ["a"]);
  });

  test("a result its host sent to the toasts, rendered let go by a line that outlives the host, is no toast when that line goes (FL21-OPUS-01)", () => {
    const t = tracker([line("a")]);
    t.sending("a", 0);
    const header = surface(t, "a", true);
    const dice = surface(t, "a", false);
    t.answer("a", 0, "taken");
    assert.deepEqual([header.render(), dice.render()], [true, false], "the sender says it as it lands");
    // The block folds within the result's paint time: its host goes and hands the tag to the toasts while the header line stays.
    t.unseen("a");
    t.rendered("a", false);
    assert.equal(t.maySpeak("a", false), false, "said before, so the Dice panel's line still never says it");
    header.unmount();
    assert.equal(dice.render(), false, "nor once the sender goes");
    dice.unmount();
    assert.deepEqual(t.unannounced(), [], "no late toast");
  });

  test("only a render that shows the result takes the toast back: one still held or still sending never does", () => {
    for (const how of ["held", "sending"] as const) {
      const log: LogEntry[] = [];
      const t = tracker(log);
      t.sending("a", 0);
      const panel = surface(t, "a", false);
      if (how === "held") {
        log.push(line("a"));
        t.answer("a", 0, "taken");
      }
      t.unseen("a");
      t.rendered("a", how === "held");
      if (how === "sending") {
        log.push(line("a"));
        t.answer("a", 0, "taken");
      }
      panel.unmount();
      assert.deepEqual(t.unannounced().map((u) => u.tag), ["a"], how);
    }
  });
});

describe("one mounted line across its showings (SurfaceVoice)", () => {
  /** A result line as useReceiptVoice runs it: each frame renders `tag` (null while hidden) and commits, claiming while it shows the tag as the sender. */
  function line(t: ReceiptTracker, claim: boolean) {
    const voice = new SurfaceVoice();
    let release: (() => void) | null = null;
    return (tag: string | null): boolean => {
      if (release && tag === null) {
        release();
        release = null;
      }
      if (claim && tag !== null && !release) release = t.claimVoice(tag);
      const state = tag === null ? null : t.state(tag);
      const settled = state !== null && state.state !== "sending" && state.state !== "checking";
      const speaks = voice.speaks(t, tag, claim);
      voice.committed(t, { tag, speaks, settled });
      return speaks && settled;
    };
  }

  for (const claim of [true, false]) {
    for (const outcome of ["committed", "refused"] as const) {
      const who = claim ? "the block's line, the sender" : "the Dice panel's line";
      test(`${who}, hidden and shown again after it said a ${outcome} result, shows it silent: no live words, no alert (SBR-SOL-004)`, () => {
        const log: LogEntry[] = [];
        const t = new ReceiptTracker();
        t.env = { lookup: async () => ({ parts: [] }), log: () => log };
        t.sending("a", 0);
        const frame = line(t, claim);
        assert.equal(frame("a"), false, "nothing to say while it waits");
        if (outcome === "committed") log.push({ id: "0001-a", kind: "event", data: { type: "dice", tag: "a", rolls: [] } } as unknown as LogEntry);
        t.answer("a", 0, outcome === "committed" ? "taken" : "refused", outcome === "refused" ? ({ code: "invalid", message: "No.", text: "No." } as never) : undefined);
        assert.deepEqual([frame("a"), frame("a")], [true, true], "said, and its words stay");
        assert.equal(frame(null), false, "hidden");
        assert.deepEqual([frame("a"), frame("a")], [false, false], "shown again: silent");
      });
    }
  }

  test("a line that showed another tag and then its first again does not say the first twice", () => {
    const log: LogEntry[] = [{ id: "0001-a", kind: "event", data: { type: "dice", tag: "a", rolls: [] } } as unknown as LogEntry];
    const t = new ReceiptTracker();
    t.env = { lookup: async () => ({ parts: [] }), log: () => log };
    t.sending("a", 0);
    t.sending("b", 0);
    t.answer("a", 0, "taken");
    const frame = line(t, true);
    assert.equal(frame("a"), true);
    assert.equal(frame("b"), false, "b still waits");
    assert.equal(frame("a"), false);
  });
});

describe("useReceiptVoice, as a surface's render reads it", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { RoomProvider } = await import("../../state/view.ts");
  const { RoomScope, RoomScopeProvider } = await import("../../state/scope.ts");
  const { useReceiptVoice } = await import("./useReceipt.ts");

  function speaks(scope: InstanceType<typeof RoomScope>, tag: string | null, claim: boolean): boolean {
    const store = createStore(() => ({ view: null, roomId: "r1", connection: "open" }));
    let out: boolean | null = null;
    function Probe() {
      out = useReceiptVoice(tag, claim);
      return null;
    }
    renderToStaticMarkup(createElement(RoomProvider, { store: store as never, actions: {} as never, ui: {} as never, children: createElement(RoomScopeProvider, { scope, children: createElement(Probe) }) }));
    assert.ok(out !== null);
    return out;
  }

  test("the sender says its tag, another surface only where nobody claims it and nobody said it, and no tag says nothing", () => {
    const scope = new RoomScope();
    const t = scope.get(receiptsSlot);
    t.env = { lookup: async () => ({ parts: [] }), log: () => [] };
    t.sending("a", 0);
    t.answer("a", 0, "taken");
    assert.equal(speaks(scope, null, true), false);
    assert.equal(speaks(scope, "a", false), true, "unclaimed and unsaid");
    const release = t.claimVoice("a");
    assert.equal(speaks(scope, "a", false), false, "another surface claims it");
    assert.equal(speaks(scope, "a", true), true);
    release();
    t.spoken("a");
    assert.equal(speaks(scope, "a", false), false, "said already");
    assert.equal(speaks(scope, "a", true), false, "said already, so its sender shown again says nothing either");
  });
});

describe("useReceipt in a hidden pane (HIDDEN-WATCHERS)", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { RoomProvider } = await import("../../state/view.ts");
  const { RoomScope, RoomScopeProvider } = await import("../../state/scope.ts");
  const { useReceipt } = await import("./useReceipt.ts");
  const { PanelHere } = await import("../panels.ts");

  /** What a surface reads for tag "a": in a panel shown or hidden, or outside the panels with `shown` undefined. */
  function read(shown: boolean | undefined): string | null {
    const scope = new RoomScope();
    const t = scope.get(receiptsSlot);
    t.env = { lookup: async () => ({ parts: [] }), log: () => [] };
    t.sending("a", 0);
    t.answer("a", 0, "taken");
    const store = createStore(() => ({ view: null, roomId: "r1", connection: "open" }));
    let out: string | null | undefined;
    function Probe() {
      out = useReceipt("a")?.state ?? null;
      return null;
    }
    const probe = createElement(Probe);
    const children = shown === undefined ? probe : createElement(PanelHere, { id: "dice", shown, children: probe });
    renderToStaticMarkup(createElement(RoomProvider, { store: store as never, actions: {} as never, ui: {} as never, children: createElement(RoomScopeProvider, { scope, children: children as never }) }));
    assert.ok(out !== undefined);
    return out;
  }

  test("every surface in a hidden sheet or pane reads no receipt, so it watches none and the toast says the roll: a group save's rows and Watchers, its damage, Shared attacks, a cast's damage, Auto Initiative's card and the Dice field", () => {
    assert.equal(read(true), "committed");
    assert.equal(read(false), null);
    assert.equal(read(undefined), "committed", "outside the panels a surface is always shown");
  });
});
