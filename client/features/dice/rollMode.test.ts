import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptsRollMode, BATCH_HELP, effectiveRollMode, FIXED_VISIBILITY, hasRollModeMenu, NORMAL_HELP, offersNormal, overrideRollSources, REPEAT_HELP, resolveRollMode, rollModeHint, rollModeItems, rollModeTitle, rollModeTo } from "./rollMode.ts";

test("manual modes replace only manual sources, preserving cancellation and all presets", () => {
  assert.deepEqual(resolveRollMode([], [{ kind: "dis", from: "pressed" }], "adv"), { mode: "adv" });
  assert.deepEqual(resolveRollMode([{ kind: "dis", from: "restrained" }], [], "adv"), { cancelled: true });
  assert.deepEqual(resolveRollMode([{ kind: "adv", from: "haste" }, { kind: "dis", from: "restrained" }], [], "adv"), { cancelled: true });
  assert.deepEqual(resolveRollMode([{ kind: "dis", from: "poisoned" }], [{ kind: "adv", from: "pressed" }], "normal"), { mode: "dis" });
  assert.deepEqual(overrideRollSources([{ kind: "adv", from: "typed" }, { kind: "dis", from: "restrained" }], [], "normal"), [{ kind: "dis", from: "restrained" }]);
  assert.deepEqual(resolveRollMode([], [{ kind: "adv", from: "pressed" }], "secret"), { mode: "adv" });
});
test("Normal keeps default secrecy, other modes read ordinary visibility", () => {
  assert.equal(rollModeTo("all", "dm", "normal"), "dm");
  assert.equal(rollModeTo("dm", "all", "normal"), "all");
  assert.equal(rollModeTo("dm", "all", "adv"), "dm");
  assert.equal(rollModeTo("all", "all", "secret"), "dm");
});
test("Roll normally is offered only where a tap would roll otherwise: a repeat, or a manual press or typed word the tap would apply (D-261031-078)", () => {
  assert.equal(offersNormal({ d20: true, visibility: "selectable" }), false, "a plain tap already rolls normally");
  assert.equal(offersNormal({ d20: true, visibility: "selectable", manual: { mode: true } }), true, "Adv or Dis pressed or typed");
  assert.equal(offersNormal({ d20: true, visibility: "selectable", manual: { secret: true } }), true, "Secret pressed away from its start");
  assert.equal(offersNormal({ d20: true, visibility: "creature", manual: { secret: true } }), false, "the route fixes the visibility, so a Secret press changes nothing");
  assert.equal(offersNormal({ d20: false, damage: true, visibility: "selectable", manual: { mode: true } }), false, "damage takes no Adv or Dis");
  assert.equal(offersNormal({ d20: true, visibility: "repeat", repeat: true }), true, "Again repeats its recorded mode");
  assert.deepEqual(rollModeItems({ d20: true, visibility: "request" }, false).map((i) => i.id), ["adv", "dis", "secret"]);
  assert.deepEqual(rollModeItems({ d20: true, visibility: "request", manual: { mode: true } }, false).map((i) => i.id), ["adv", "dis", "secret", "normal"]);
  assert.equal(rollModeHint({ d20: true, visibility: "selectable" }), "Hold, right-click or Shift+F10 for Advantage, Disadvantage or Secret.");
  assert.equal(rollModeHint({ d20: true, visibility: "selectable", manual: { mode: true } }), "Hold, right-click or Shift+F10 for Advantage, Disadvantage, Secret or Normal.");
  assert.equal(rollModeHint({ d20: false, visibility: "selectable" }), "Hold, right-click or Shift+F10 for Secret.");
  assert.equal(rollModeHint({ d20: true, visibility: "creature" }), "Hold, right-click or Shift+F10 for Advantage or Disadvantage.");
});
test("the menu's title is the source's own words, or the roll's name where they are only a verb and a modifier (D-261031-079)", () => {
  assert.equal(rollModeTitle("Perception\n+4", "Perception check"), "Perception +4");
  assert.equal(rollModeTitle("  Spell attack   +6 ", "Spell attack"), "Spell attack +6");
  for (const bare of ["Roll", "Roll +6", "Roll −1", "Again", "", "  "]) assert.equal(rollModeTitle(bare, "Death Save"), "Death Save", JSON.stringify(bare));
});
test("a note for every choice ends each choice's own description, since the menu shows titles alone (D-261031-080)", () => {
  assert.deepEqual(rollModeItems({ d20: true, visibility: "selectable", manual: { mode: true } }, false).map((i) => i.description), [undefined, undefined, "Roll secretly: you and the DM see the result.", NORMAL_HELP]);
  assert.deepEqual(rollModeItems({ d20: true, visibility: "repeat", repeat: true }, false).map((i) => i.description), [
    REPEAT_HELP,
    REPEAT_HELP,
    `${FIXED_VISIBILITY.repeat} ${REPEAT_HELP}`,
    `Roll normally: ignores the recorded mode and keeps the formula and visibility. ${REPEAT_HELP}`,
  ]);
  assert.deepEqual(rollModeItems({ d20: false, visibility: "selectable", batch: true, manual: { secret: true } }, true).map((i) => i.description), [`Roll secretly: hide the dice from players. ${BATCH_HELP}`, `${NORMAL_HELP} ${BATCH_HELP}`]);
});
test("capabilities exclude meaningless fixed rolls and damage modes", () => {
  for (const f of ["1d20+5", "1d20+1d4-2"]) assert.ok(acceptsRollMode(f));
  for (const f of ["2d20", "2d20kh1", "1d6", "broken"]) assert.equal(acceptsRollMode(f), false);
  assert.equal(hasRollModeMenu({ d20: false, visibility: "creature" }), false);
  assert.equal(rollModeHint({ d20: false, visibility: "creature" }), undefined);
  assert.deepEqual(rollModeItems({ d20: true, damage: true, visibility: "selectable", manual: { mode: true, secret: true } }, false).map((i) => i.id), ["secret", "normal"]);
  const items = rollModeItems({ d20: true, visibility: "request" }, false);
  assert.deepEqual(items.map((i) => i.id), ["adv", "dis", "secret"]);
  assert.equal(items[2]?.disabled, true);
  assert.equal(items[2]?.description, "Roll secretly: request answers keep the request's visibility.");
  assert.equal(rollModeItems({ d20: false, visibility: "selectable" }, false)[0]?.description, "Roll secretly: you and the DM see the result.");
  assert.equal(rollModeHint({ d20: true, visibility: "creature", manual: { mode: true } }), "Hold, right-click or Shift+F10 for Advantage, Disadvantage or Normal.");
});
test("returned fields describe the effective result", () => {
  assert.equal(effectiveRollMode({ formula: "1d20", cancelled: true }, true), "Normal: Advantage and Disadvantage cancelled, Secret");
  assert.equal(effectiveRollMode({ formula: "2d20kh1", mode: "adv" }), "Advantage");
  assert.equal(effectiveRollMode({ formula: "1d20" }), "Normal");
  assert.equal(effectiveRollMode({ formula: "1d6" }, true), "Secret");
});

test("where a tap is secret already, the menu and its shortcut words leave Secret out, and every other capability keeps FL-17's items (D-261031-131)", () => {
  const ids = (capability: Parameters<typeof rollModeItems>[0]) => rollModeItems(capability, true).map((i) => i.id);
  assert.deepEqual(ids({ d20: true, visibility: "selectable", secretByDefault: true }), ["adv", "dis"], "a DM's free roll for a monster: Advantage and Disadvantage only");
  assert.equal(rollModeHint({ d20: true, visibility: "selectable", secretByDefault: true }), "Hold, right-click or Shift+F10 for Advantage or Disadvantage.");
  assert.equal(hasRollModeMenu({ d20: false, visibility: "selectable", secretByDefault: true }), false, "a roll with no d20 has nothing left to offer");
  assert.deepEqual(ids({ d20: false, visibility: "selectable", secretByDefault: true }), []);
  assert.equal(rollModeHint({ d20: false, visibility: "selectable", secretByDefault: true }), undefined);
  // An answer keeps the request's visibility, so its disabled Secret still says why (D-261031-169).
  const answer = rollModeItems({ d20: true, visibility: "request", secretByDefault: true }, true);
  assert.deepEqual(answer.map((i) => [i.id, i.disabled === true]), [["adv", false], ["dis", false], ["secret", true]]);
  assert.equal(answer[2]?.description, FIXED_VISIBILITY.request);
  for (const visibility of ["selectable", "request", "creature", "repeat"] as const) for (const d20 of [false, true]) for (const manual of [{}, { mode: true }, { secret: true }]) {
    const capability = { d20, visibility, manual };
    assert.deepEqual(rollModeItems({ ...capability, secretByDefault: false }, true), rollModeItems(capability, true), `false is the same as absent: ${JSON.stringify(capability)}`);
    assert.equal(rollModeHint({ ...capability, secretByDefault: false }), rollModeHint(capability));
  }
});
