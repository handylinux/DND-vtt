import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Actor, RoomState } from "../model.ts";
import { keepsLairTick } from "../migrate.ts";
import { canApply } from "../permissions.ts";
import { clientOpSchema, type Op } from "../protocol.ts";
import { applyOp } from "../reducer.ts";
import { DM, P1, actor, character, comparable, env, room, token } from "../testutil.ts";

/*
 * A row's In lair kept on its token (LAIR-TICK-CARRY, D-261026-19,
 * docs/design/design-v1-combat-controls.md 13.4): the switch writes the
 * token's own `Actor.inLair`, so a creature that leaves the fight joins the
 * next one in or out of its lair as the DM left it, whatever its block's
 * counts can say. Only from op version 39, so older ops replay as written.
 */

function table(): RoomState {
  const state = room({
    tokens: {
      keeper: token("keeper", { name: "Crypt Keeper", actor: { inline: actor({ monsterId: "keeper" }) } }),
      dragon: token("dragon", { name: "Adult Red Dragon", actor: { inline: actor({ srdId: "adult-red-dragon", xp: 18_000, legendary: { actionsMax: 3, actionsUsed: 1, resistMax: 3, resistUsed: 0 } }) } }),
      druid: token("druid", { kind: "pc", name: "Bree", actor: { ref: "bree" } }),
    },
    characters: { bree: character("bree", { name: "Bree" }) },
  });
  const row = (id: string, tokenId: string) => ({ id, tokenId, value: 10, tieOrder: 0, hidden: false, reactionUsed: false, inLair: false });
  state.encounter = { rev: 0, round: 1, activeEntryId: null, entries: [row("ek", "keeper"), row("ed", "dragon"), row("eb", "druid")] };
  return state;
}

const inline = (s: RoomState, id: string): Actor => (s.tokens[id]!.actor as { inline: Actor }).inline;

function run(state: RoomState, op: Op, opVersion?: number, seq = 1) {
  const r = applyOp(state, op, DM, { ...env(seq), ...(opVersion !== undefined ? { opVersion } : {}) });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r;
}

describe("lair46: a row's In lair keeps the tick on its token", () => {
  test("on and off write and clear the token's tick, beside the counts for a block that has them", () => {
    const on = run(table(), { t: "encounter.update", entryId: "ek", patch: { inLair: true } }).state;
    assert.equal(inline(on, "keeper").inLair, true, "lair actions alone: no counts, the tick alone");
    const off = run(on, { t: "encounter.update", entryId: "ek", patch: { inLair: false } }, undefined, 2).state;
    assert.equal("inLair" in inline(off, "keeper"), false);

    const lair = run(table(), { t: "encounter.update", entryId: "ed", patch: { inLair: true }, counts: { actionsMax: 4, resistMax: 4, xp: 20_000 } }).state;
    assert.deepEqual([inline(lair, "dragon").inLair, inline(lair, "dragon").legendary?.actionsMax, inline(lair, "dragon").xp], [true, 4, 20_000]);
    const out = run(lair, { t: "encounter.update", entryId: "ed", patch: { inLair: false }, counts: { actionsMax: 3, resistMax: 3, xp: 18_000 } }, undefined, 2).state;
    assert.deepEqual(["inLair" in inline(out, "dragon"), inline(out, "dragon").legendary?.actionsMax], [false, 3]);
  });

  test("a row whose creature is a character's writes nothing on the character, and a patch without In lair leaves the tick", () => {
    const before = table();
    const after = run(before, { t: "encounter.update", entryId: "eb", patch: { inLair: true } }).state;
    assert.equal(after.encounter!.entries.find((e) => e.id === "eb")!.inLair, true);
    assert.equal("inLair" in after.characters.bree!.actor, false);
    assert.equal(after.characters.bree, before.characters.bree, "the character is not written");

    const ticked = run(table(), { t: "encounter.update", entryId: "ek", patch: { inLair: true } }).state;
    const hidden = run(ticked, { t: "encounter.update", entryId: "ek", patch: { hidden: true } }, undefined, 2).state;
    assert.equal(inline(hidden, "keeper").inLair, true);
    assert.equal(hidden.tokens.keeper, ticked.tokens.keeper, "the token is not written");
  });

  test("a switch that changes nothing on the token writes nothing there, and Undo takes the tick back with the row", () => {
    const ticked = run(table(), { t: "encounter.update", entryId: "ek", patch: { inLair: true } }).state;
    const again = run(ticked, { t: "encounter.update", entryId: "ek", patch: { inLair: true } }, undefined, 2);
    assert.equal(again.state.tokens.keeper, ticked.tokens.keeper, "already ticked");
    assert.ok(!again.inverse?.some((e) => e.key === "token:keeper"), "its undo restores no token");

    const start = table();
    const r = run(start, { t: "encounter.update", entryId: "ek", patch: { inLair: true } });
    assert.ok(r.inverse?.some((e) => e.key === "token:keeper"), "its undo restores the token");
    const back = run(r.state, { t: "sys.restore", entries: r.inverse!, from: "undo" }, undefined, 2).state;
    assert.deepEqual(comparable(back), comparable(start));
  });

  test("an op stored before version 39 replays as written: the row and its counts, no tick", () => {
    assert.deepEqual([keepsLairTick(1), keepsLairTick(38), keepsLairTick(39), keepsLairTick(undefined)], [false, false, true, true]);
    const stored = run(table(), { t: "encounter.update", entryId: "ek", patch: { inLair: true } }, 38);
    assert.equal(stored.state.encounter!.entries[0]!.inLair, true);
    assert.equal("inLair" in inline(stored.state, "keeper"), false);
    assert.ok(!stored.inverse?.some((e) => e.key === "token:keeper"), "no token written, so a stored restore's guards still match");
    const now = run(table(), { t: "encounter.update", entryId: "ek", patch: { inLair: true } }, 39);
    assert.equal(inline(now.state, "keeper").inLair, true);
  });

  test("the actor schema takes the tick as true alone, no patch names it, and a player never sets it", () => {
    const create = (inLair: unknown) => ({ t: "token.create", token: { id: "t9", sceneId: "s1", kind: "monster", name: "Keeper", size: "medium", x: 1, y: 1, actor: { inline: { ...actor(), inLair } } } });
    assert.ok(clientOpSchema.safeParse(create(true)).success);
    assert.equal(clientOpSchema.safeParse(create(false)).success, false, "true or absent, as wildShape");
    assert.equal(clientOpSchema.safeParse({ t: "token.update", tokenId: "keeper", patch: { actor: { inLair: true } } }).success, false, "the switch alone writes it");
    const op = { t: "encounter.update", entryId: "ek", patch: { inLair: true } } as const;
    assert.equal(canApply(op, P1, table(), { canUseAsset: () => true }).ok, false);
  });
});
