import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { character, room, token } from "#shared/testutil.ts";
import { createStore } from "zustand/vanilla";
import type { ClientOp, OpOf } from "#shared/protocol.ts";
import { INITIAL_LOCAL } from "../../state/types.ts";
import { createDicePanel, panelKeyIn, secretNow, secretStartIn, type DiceState } from "./useDicePanel.ts";
import { ReceiptTracker } from "./useReceipt.ts";

/**
 * Where the Dice panel's Secret starts (docs/design/design-v1-dice.md 8.2 and 17):
 * pressed only for a DM's roll for a monster. With no creature in the roll,
 * the panel's own, the DM's selection, decides, so the chip shows what its
 * next roll does.
 */
describe("the panel's Secret start", () => {
  const view = room({
    characters: { thorn: character("thorn", { ownerIds: ["p1"] }) },
    tokens: { goblin: token("goblin"), thorn: token("thorn", { kind: "pc", actor: { ref: "thorn" } }) },
  });
  const dm = (selectedIds: string[]) => ({ view, you: { memberId: "dm1", role: "dm" as const }, local: { ...INITIAL_LOCAL, selectedIds } });

  test("a DM's free formula with nothing selected starts in the open", () => {
    assert.equal(secretStartIn(dm([]), []), false);
  });

  test("a DM's panel opened for a goblin starts pressed, and for Thorn in the open", () => {
    assert.equal(secretStartIn(dm(["goblin"]), []), true);
    assert.equal(secretStartIn(dm(["thorn"]), []), false);
    assert.equal(secretStartIn(dm(["thorn", "goblin"]), []), true);
  });

  test("a roll's own creatures win over the selection", () => {
    assert.equal(secretStartIn(dm(["thorn"]), [{ tokenId: "goblin" }]), true);
    assert.equal(secretStartIn(dm(["goblin"]), [{ characterId: "thorn" }]), false);
  });

  test("a player's panel never starts pressed", () => {
    assert.equal(secretStartIn({ ...dm(["goblin"]), you: { memberId: "p1", role: "player" } }, [{ tokenId: "goblin" }]), false);
  });
});

describe("Secret follows the DM's selection (LP7-DICE-8)", () => {
  function panelFor(selection: { now: string }) {
    const sent: ClientOp[] = [];
    const store = createStore<DiceState>(() => ({ adv: false, dis: false, secret: null, version: 0, last: null }));
    const sender = { dispatch: (op: ClientOp) => sent.push(op), connected: () => true, receipts: new ReceiptTracker() };
    // A monster is selected unless Thorn is.
    const panel = createDicePanel({ store, sender, secretStart: () => selection.now !== "thorn", panelKey: () => selection.now });
    return { sent, store, panel };
  }

  test("a goblin's Secret pressed off goes back to its start when another monster is selected, so that monster's roll starts secret", () => {
    const selection = { now: "goblin" };
    const { sent, store, panel } = panelFor(selection);
    panel.press("secret");
    assert.equal(secretNow(store.getState(), "goblin", true), false, "off for the goblin");
    selection.now = "sniper";
    assert.equal(secretNow(store.getState(), "sniper", true), true, "the sniper reads Secret's start");
    panel.roll([{ formula: "1d20+2" }]);
    assert.equal((sent[0] as OpOf<"dice.roll">).to, "dm");
  });

  test("a press stands for the creatures it was made for, and Thorn's start is in the open", () => {
    const selection = { now: "thorn" };
    const { sent, store, panel } = panelFor(selection);
    panel.press("secret");
    assert.equal(secretNow(store.getState(), "thorn", false), true);
    panel.roll([{ formula: "1d20+5" }]);
    assert.equal((sent[0] as OpOf<"dice.roll">).to, "dm", "pressed for Thorn, rolled for Thorn");
    assert.equal(secretNow(store.getState(), "thorn", false), false, "the roll took it");
  });

  test("the key is the DM's selection in any order, and a player's panel has none, so a player's press stands", () => {
    const dm = { you: { memberId: "dm1", role: "dm" as const }, local: { ...INITIAL_LOCAL, selectedIds: ["b", "a"] } };
    assert.equal(panelKeyIn(dm), panelKeyIn({ ...dm, local: { ...INITIAL_LOCAL, selectedIds: ["a", "b"] } }));
    assert.equal(panelKeyIn({ ...dm, you: { memberId: "p1", role: "player" } }), "");
  });
});

describe("a roll menu reads Secret against its roll's own creatures (FL17-ASTRA-01)", () => {
  const view = room({ tokens: { goblin: token("goblin") } });
  const state = { view, you: { memberId: "dm1", role: "dm" as const }, local: { ...INITIAL_LOCAL, selectedIds: [] as string[] } };

  test("a DM who pressed Secret on and off with nothing selected: a goblin's Normal differs from its tap, the free formula's does not", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { RoomProvider } = await import("../../state/view.ts");
    const { RoomScope, RoomScopeProvider } = await import("../../state/scope.ts");
    const { diceChoicesSlot, useRollPresses } = await import("./useDicePanel.ts");
    const scope = new RoomScope();
    const choices = scope.get(diceChoicesSlot);
    // Pressed on, then off, for the panel's own key: off for whatever rolls next.
    choices.setState({ secret: false, secretFor: panelKeyIn(state) });
    choices.getInitialState = choices.getState;
    const store = createStore(() => ({ ...state, roomId: "r1", connection: "open", sceneId: "s1" }));
    const seen: Record<string, { mode: boolean; secret: boolean }> = {};
    function Probe() {
      seen.goblin = useRollPresses([{ tokenId: "goblin" }]);
      seen.formula = useRollPresses();
      return null;
    }
    renderToStaticMarkup(createElement(RoomProvider, {
      store: store as never, actions: { dispatch: () => 1 } as never, ui: {} as never, assets: { url: () => "" } as never,
      children: createElement(RoomScopeProvider, { scope, children: createElement(Probe) }),
    }));
    assert.deepEqual(seen.goblin, { mode: false, secret: true }, "the goblin's Secret starts pressed, and the panel's is off");
    assert.deepEqual(seen.formula, { mode: false, secret: false });

    // As the panel rolls them, a tap and Roll normally go to different readers for the goblin.
    const sent: ClientOp[] = [];
    const panel = createDicePanel({ store: choices, sender: { dispatch: (op: ClientOp) => sent.push(op), connected: () => true, receipts: new ReceiptTracker() }, secretStart: (creatures) => secretStartIn(state, creatures), panelKey: () => panelKeyIn(state) });
    panel.roll([{ formula: "1d20+2", creature: { tokenId: "goblin" } }], { override: "normal" });
    panel.roll([{ formula: "1d20+2", creature: { tokenId: "goblin" } }]);
    assert.deepEqual(sent.map((op) => (op as OpOf<"dice.roll">).to), ["dm", "all"]);
  });
});
