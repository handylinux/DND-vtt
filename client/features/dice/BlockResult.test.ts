import "../../components/testing/register.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createStore } from "zustand/vanilla";
import type { DiceRoll, LogEntry, RoomState, Viewer } from "#shared/model.ts";
import { projectState } from "#shared/project.ts";
import { DM, room } from "#shared/testutil.ts";
import { optionSlot } from "./optionState.ts";
import { ReceiptTracker, receiptsSlot } from "./useReceipt.ts";

/*
 * A stat block's result line (docs/design-v1-stat-block-rolls.md 8): the
 * roll it sent shown under the grid, its mode words only for a roll from a
 * choice and worded from the returned roll, and one announcer per roll.
 */

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { RoomProvider } = await import("../../state/view.ts");
const { RoomScope, RoomScopeProvider } = await import("../../state/scope.ts");
const { BlockResult, modeWords } = await import("./BlockResult.tsx");

const die = (extra: Partial<DiceRoll> = {}): DiceRoll => ({ formula: "1d20+5", faces: [10], total: 15, label: "Dexterity save", ...extra });

function line(tag: string, roll: DiceRoll, to: "all" | "dm" = "all"): LogEntry {
  return { id: `1:${tag}`, at: "", kind: "event", data: { type: "dice", tag, by: "dm1", to, rolls: [roll] } } as LogEntry;
}

/** A scope whose tracker holds `lines` as the log, with every tag in `answers` already answered. */
function scopeWith(lines: LogEntry[]) {
  const scope = new RoomScope();
  const tracker = scope.get(receiptsSlot) as ReceiptTracker;
  tracker.env = { lookup: () => Promise.resolve({ parts: [] }), log: () => lines };
  return { scope, tracker };
}

function render(scope: InstanceType<typeof RoomScope>, outcome: Parameters<typeof BlockResult>[0]["outcome"], viewer: Viewer = DM): string {
  const view = projectState(room(), viewer, { sceneId: "s1" }) as unknown as RoomState;
  const store = createStore(() => ({ view, roomId: "r1", connection: "open", you: viewer, sceneId: "s1", local: { selectedIds: [], multi: false } }));
  return renderToStaticMarkup(
    createElement(RoomProvider, {
      store: store as never,
      actions: { dispatch: () => 1 } as never,
      ui: {} as never,
      assets: { url: () => "" } as never,
      children: createElement(RoomScopeProvider, { scope, children: createElement(BlockResult, { outcome }) as never }),
    }),
  );
}

const sent = (tag: string, override?: "adv" | "dis" | "secret" | "normal") => ({ kind: "sent" as const, sent: { tag, ...(override ? { override } : {}) } });

describe("the mode words (D-261031-134)", () => {
  test("a tap names no mode, whatever the returned roll holds", () => {
    assert.equal(modeWords(undefined, die({ mode: "dis" }), false), "");
    assert.equal(modeWords(undefined, die({ cancelled: true }), true), "");
  });

  test("a picked Advantage or Disadvantage is worded from the returned roll", () => {
    assert.equal(modeWords("adv", die({ mode: "adv" }), false), "with Advantage");
    assert.equal(modeWords("dis", die({ mode: "dis" }), false), "with Disadvantage");
  });

  test("a pick a condition cancelled says so, and one that left no mode says nothing", () => {
    assert.equal(modeWords("adv", die({ cancelled: true }), false), "Advantage and Disadvantage cancelled");
    assert.equal(modeWords("dis", die(), false), "");
  });

  test("a pick whose roll came back with the other mode says the roll's, never the pick's", () => {
    assert.equal(modeWords("adv", die({ mode: "dis" }), false), "with Disadvantage");
  });

  test("Roll secretly says secret only when the roll went to the DM", () => {
    assert.equal(modeWords("secret", die(), true), "secret");
    assert.equal(modeWords("secret", die(), false), "");
  });

  test("a plain Normal pick adds no word, and Normal is never written", () => {
    assert.equal(modeWords("normal", die(), false), "");
  });
});

describe("the line", () => {
  test("a tap that did not go shows its words as an alert", () => {
    const { scope } = scopeWith([]);
    const markup = render(scope, { kind: "unsent", words: "Rolling needs a connection." });
    assert.match(markup, /data-block-result=""/);
    assert.match(markup, /<span role="alert"[^>]*>Rolling needs a connection\.<\/span>/);
  });

  test("a waiting roll holds the line with no result in it yet", () => {
    const { scope, tracker } = scopeWith([]);
    tracker.sending("W", 0);
    const markup = render(scope, sent("W"));
    assert.match(markup, /data-block-result=""/);
    assert.doesNotMatch(markup, /Rolled/);
  });

  test("a tap's result shows the total and its label, no mode words, and is said once with the total", () => {
    const { scope, tracker } = scopeWith([line("T", die({ mode: "dis" }))]);
    tracker.sending("T", 0);
    tracker.answer("T", 0, "taken");
    const markup = render(scope, sent("T"));
    assert.match(markup, />15</);
    assert.match(markup, /Dexterity save/);
    assert.doesNotMatch(markup, /data-result-mode/);
    assert.match(markup, /aria-live="polite"[^>]*>Rolled 15: Dexterity save, Disadvantage\.<\/span>/);
  });

  test("a picked Advantage adds its words as the line's last part, hidden from a reader, and the description keeps the mode", () => {
    const { scope, tracker } = scopeWith([line("A", die({ mode: "adv" }))]);
    tracker.sending("A", 0);
    tracker.answer("A", 0, "taken");
    const markup = render(scope, sent("A", "adv"));
    assert.match(markup, /<span aria-hidden="true" data-result-mode=""[^>]*>with Advantage<\/span>/);
    assert.match(markup, /aria-description="Advantage"/);
    assert.ok(markup.indexOf("Dexterity save") < markup.indexOf("data-result-mode"), "after the label");
  });

  test("Roll secretly names secret from the returned envelope, and a roll that stayed open names nothing", () => {
    const secret = scopeWith([line("S", die(), "dm")]);
    secret.tracker.answer("S", 0, "taken");
    assert.match(render(secret.scope, sent("S", "secret")), />secret<\/span>/);
    const open = scopeWith([line("O", die(), "all")]);
    open.tracker.answer("O", 0, "taken");
    assert.doesNotMatch(render(open.scope, sent("O", "secret")), /data-result-mode/);
  });

  test("a cancelled pick reads as cancelled, never as the pick", () => {
    const { scope, tracker } = scopeWith([line("C", die({ cancelled: true }))]);
    tracker.answer("C", 0, "taken");
    const markup = render(scope, sent("C", "adv"));
    assert.match(markup, /Advantage and Disadvantage cancelled<\/span>/);
    assert.doesNotMatch(markup, /with Advantage/);
  });

  test("a refusal shows the server's words as an alert, and the line has no Again and no button to open Recent rolls", () => {
    const { scope, tracker } = scopeWith([]);
    tracker.answer("R", 0, "refused", { code: "forbidden", message: "You roll only for your own creatures.", text: "You roll only for your own creatures." });
    const markup = render(scope, sent("R"));
    assert.match(markup, /<span role="alert"[^>]*>You roll only for your own creatures\.<\/span>/);
    assert.doesNotMatch(markup, /Again|<button/);
  });

  test("unknown and no-longer-in-the-log read as the Dice panel's line words them", async () => {
    const unknown = scopeWith([]);
    unknown.tracker.sending("U", 0);
    await unknown.tracker.lookup("U");
    assert.match(render(unknown.scope, sent("U")), /This may have happened\. Check the log\./);
    const gone = scopeWith([]);
    gone.tracker.answer("G", 0, "taken");
    assert.match(render(gone.scope, sent("G")), /Rolled\. Its result is no longer in the log\./);
  });

  test("Initiative written too late adds a second muted line", () => {
    const { scope, tracker } = scopeWith([line("I", die())]);
    tracker.answer("I", 0, "taken");
    const options = scope.get(optionSlot);
    options.setState({ acted: { "I:changed": true } });
    // A server render reads the initial state, as Roller.test.ts does for the panel's store.
    options.getInitialState = options.getState;
    assert.match(render(scope, sent("I")), /Not set: the row changed meanwhile\./);
  });
});

describe("one announcer per roll (D-261031-133)", () => {
  // Real only once lane A's tracker holds claims. On its stubs a claim changes nothing, so the cases wait for it.
  const real = (() => {
    const t = new ReceiptTracker();
    t.claimVoice("x");
    return !t.maySpeak("x", false);
  })();

  test("the line claims its tag and says the result", { skip: !real }, () => {
    const { scope, tracker } = scopeWith([line("V", die())]);
    tracker.answer("V", 0, "taken");
    assert.match(render(scope, sent("V")), /aria-live="polite"[^>]*>Rolled 15/);
  });

  test("the line speaks as the sender while a claim is held elsewhere, and shows a roll the toast or another surface already said silent", { skip: !real }, () => {
    const { scope, tracker } = scopeWith([line("D", die())]);
    tracker.answer("D", 0, "taken");
    tracker.claimVoice("D");
    assert.match(render(scope, sent("D")), /aria-live="polite"[^>]*>Rolled 15/);
    tracker.spoken("D");
    const html = render(scope, sent("D"));
    assert.match(html, />15</, "the result still shows");
    assert.doesNotMatch(html, /aria-live="polite"[^>]*>Rolled/, "and its live region says nothing");
  });
});
