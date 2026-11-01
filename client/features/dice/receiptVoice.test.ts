import "../../components/testing/register.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LogEntry } from "#shared/model.ts";
import { createStore } from "zustand/vanilla";
import { receiptsSlot, ReceiptTracker } from "./useReceipt.ts";

/*
 * One announcer per roll (docs/design-v1-stat-block-rolls.md 8,
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
