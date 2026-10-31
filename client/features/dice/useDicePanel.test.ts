import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "zustand/vanilla";
import type { ClientOp } from "#shared/protocol.ts";
import { createDicePanel, type DiceState } from "./useDicePanel.ts";
import type { RollSender } from "./send.ts";
import { ReceiptTracker } from "./useReceipt.ts";

function setup() {
  const store = createStore<DiceState>(() => ({ adv: true, dis: false, secret: false, version: 7, last: null }));
  const sent: ClientOp[] = []; const callbacks: (() => void)[] = []; const origins: unknown[] = [];
  const receipts = new ReceiptTracker();
  const sender: RollSender = { connected: () => true, receipts, dispatch(op, opts) { sent.push(op); callbacks.push(() => opts?.onAnswer?.("refused", undefined)); return sent.length; } };
  const panel = createDicePanel({ store, sender, secretStart: () => true, registerThrow: (tag, origin) => origins.push({ tag, origin }) });
  return { store, sent, callbacks, origins, panel, receipts };
}
test("menu overrides preserve choices and versions through sends, refusal, receipts and batches", () => {
  const { store, sent, callbacks, origins, panel, receipts } = setup();
  const origin = { surface: "dice" as const, element: null, tapAt: 25 };
  let parts = 0;
  const tag = panel.roll(Array.from({ length: 120 }, () => ({ formula: "1d20+1d4", sources: [{ kind: "dis" as const, from: "restrained" }] })), { override: "adv", origin, parts: (n) => { parts = n; } });
  assert.ok(tag); assert.ok(parts > 1); assert.equal(sent.length, parts);
  for (const op of sent) { assert.equal(op.t, "dice.roll"); if (op.t === "dice.roll") { assert.equal(op.tag, tag); assert.equal(op.to, "all"); for (const roll of op.rolls) { assert.equal(roll.mode, undefined); assert.equal(roll.cancelled, true); } } }
  assert.deepEqual(origins, [{ tag, origin }]);
  assert.equal(receipts.state(tag)?.state, "sending");
  assert.ok(store.getState().last && "rolls" in store.getState().last!);
  for (const refuse of callbacks) refuse();
  assert.deepEqual({ ...store.getState(), last: null }, { adv: true, dis: false, secret: false, version: 7, last: null });
});
test("Normal retains default monster secrecy, removes typed/manual modes, and never rebuilds damage modes", () => {
  const { store, sent, panel } = setup();
  panel.roll([{ formula: "1d20+4", sources: [{ kind: "adv", from: "typed" }, { kind: "dis", from: "poisoned" }] }], { override: "normal" });
  assert.equal(sent[0]?.t === "dice.roll" && sent[0].to, "dm");
  assert.deepEqual(sent[0]?.t === "dice.roll" && sent[0].rolls[0], { formula: "1d20+4", mode: "dis" });
  panel.roll([{ formula: "1d20+2", modeEligible: false }], { override: "secret" });
  assert.deepEqual(sent[1]?.t === "dice.roll" && sent[1].rolls[0], { formula: "1d20+2" });
  assert.equal(store.getState().version, 7);
  panel.roll([{ formula: "1d20" }]); assert.equal(store.getState().adv, false, "ordinary rolls still consume choices");
});

test("Secret retains invalid formula-word modes instead of silently dropping them", () => {
  const { panel, sent, store } = setup();
  assert.equal(panel.roll([{ formula: "1d6", sources: [{ kind: "adv", from: "typed" }] }], { override: "secret" }), null);
  assert.equal(sent.length, 0);
  assert.equal(store.getState().version, 7);
  assert.ok(panel.roll([{ formula: "1d6", sources: [{ kind: "adv", from: "typed" }] }], { override: "normal" }));
});

/** A panel whose roll for the goblin starts secret, as a DM's for a monster, and for anyone else in the open. */
function blockSetup(connected = true) {
  const store = createStore<DiceState>(() => ({ adv: true, dis: false, secret: true, secretFor: "", version: 21, last: { tag: "older", rolls: [{ formula: "1d20" }], to: "all" } }));
  const sent: ClientOp[] = []; const refusals: (() => void)[] = []; const origins: unknown[] = [];
  const receipts = new ReceiptTracker();
  const sender: RollSender = { connected: () => connected, receipts, dispatch(op, opts) { sent.push(op); refusals.push(() => opts?.onAnswer?.("refused", undefined)); return sent.length; } };
  const panel = createDicePanel({ store, sender, secretStart: (creatures) => creatures.some((c) => "tokenId" in c && c.tokenId === "goblin"), registerThrow: (tag, origin) => origins.push({ tag, origin }) });
  return { store, sent, refusals, origins, panel };
}

test("a roll with no choices takes, reads and changes none of the panel's Adv, Dis and Secret, goes under its own start, and becomes the newest line (D-261031-113)", () => {
  const { store, sent, refusals, origins, panel } = blockSetup();
  const before = { ...store.getState(), last: null };
  const failed: string[] = [];
  const pc = panel.roll([{ formula: "1d20+3", label: "Dexterity save", creature: { characterId: "bree" }, sources: [{ kind: "dis", from: "restrained" }] }], { choices: "none", onFail: (w) => failed.push(w) });
  assert.ok(pc);
  const op = sent[0];
  assert.ok(op?.t === "dice.roll");
  assert.equal(op.to, "all", "Secret pressed in the panel never makes a player's block roll secret");
  assert.equal(op.rolls[0]?.mode, "dis", "only the creature's own preset, never the Adv pressed beside it");
  assert.equal(op.rolls[0]?.cancelled, undefined);
  assert.deepEqual({ ...store.getState(), last: null }, before, "the store and its version stand as they were");
  assert.deepEqual(store.getState().last, { tag: pc, rolls: [{ formula: "1d20+3", label: "Dexterity save", creature: { characterId: "bree" }, mode: "dis" }], to: "all" }, "it is the panel's newest roll, with its Again");
  const monster = panel.roll([{ formula: "1d20+1", creature: { tokenId: "goblin" } }], { choices: "none" });
  assert.ok(monster);
  assert.equal(sent[1]?.t === "dice.roll" && sent[1].to, "dm", "a DM's monster roll starts secret, whatever Secret reads in the panel");
  store.setState({ secret: false, secretFor: "goblin", version: 22 });
  panel.roll([{ formula: "1d20+1", creature: { tokenId: "goblin" } }], { choices: "none" });
  assert.equal(sent[2]?.t === "dice.roll" && sent[2].to, "dm", "nor does a Secret pressed off for that monster make it public");
  assert.equal(store.getState().version, 22);
  for (const refuse of refusals) refuse();
  assert.equal(store.getState().version, 22, "a refusal gives nothing back, since nothing was taken");
  assert.equal(store.getState().adv, true);
  assert.deepEqual(failed, [], "a roll that went is no failure, refused or not");
  assert.deepEqual(origins, [], "no throw without an origin");
});

test("a roll with no choices still takes an Advantage, Disadvantage or Secret picked from its own options", () => {
  const { store, sent, panel } = blockSetup();
  store.setState({ adv: false, dis: true });
  panel.roll([{ formula: "1d20+3", creature: { characterId: "bree" } }], { choices: "none", override: "adv" });
  assert.equal(sent[0]?.t === "dice.roll" && sent[0].rolls[0]?.mode, "adv", "the pick, not the Dis pressed in the panel");
  panel.roll([{ formula: "1d20+3", creature: { characterId: "bree" } }], { choices: "none", override: "dis" });
  assert.equal(sent[1]?.t === "dice.roll" && sent[1].rolls[0]?.mode, "dis");
  panel.roll([{ formula: "1d20+3", creature: { characterId: "bree" } }], { choices: "none", override: "secret" });
  assert.equal(sent[2]?.t === "dice.roll" && sent[2].to, "dm");
  assert.equal(sent[2]?.t === "dice.roll" && sent[2].rolls[0]?.mode, undefined, "Secret adds no Dis pressed beside it");
  assert.equal(store.getState().dis, true);
  assert.equal(store.getState().version, 21);
});

test("a roll with no choices that does not go leaves the newest line as it was and tells its caller why, once (D-261031-164)", () => {
  const offline = blockSetup(false);
  const failed: string[] = [];
  assert.equal(offline.panel.roll([{ formula: "1d20+3", creature: { characterId: "bree" } }], { choices: "none", onFail: (w) => failed.push(w) }), null);
  assert.deepEqual(failed, ["Rolling needs a connection."]);
  assert.equal(offline.store.getState().last && "tag" in offline.store.getState().last! ? (offline.store.getState().last as { tag: string }).tag : null, "older", "the panel's newest roll stays");
  assert.equal(offline.store.getState().version, 21);
  const words = blockSetup();
  const said: string[] = [];
  assert.equal(words.panel.roll([{ formula: "2d6", sources: [{ kind: "adv", from: "typed" }] }], { choices: "none", onFail: (w) => said.push(w) }), null);
  assert.deepEqual(said, ["Adv or Dis needs one d20."], "a split the formula refuses says so through the caller too");
  assert.equal((words.store.getState().last as { tag?: string }).tag, "older");
  assert.equal(words.sent.length, 0);
  // An ordinary panel roll keeps today's error line, and its caller may hear it as well.
  const plain = blockSetup(false);
  const heard: string[] = [];
  assert.equal(plain.panel.roll([{ formula: "1d20" }], { onFail: (w) => heard.push(w) }), null);
  assert.deepEqual(heard, ["Rolling needs a connection."]);
  assert.ok(plain.store.getState().last && "error" in plain.store.getState().last!, "the panel's own roll still says why on its line");
  assert.equal(plain.store.getState().adv, true, "and gives its choices back");
});
