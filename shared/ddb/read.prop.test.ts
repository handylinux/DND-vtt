import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import { parseFormula } from "../dice/formula.ts";
import { holds, mutatedJson } from "../propertyTestutil.ts";
import { pcFillSchema } from "../protocol.ts";
import { checkedFill } from "../rules/pcFill.ts";
import { readDdbCharacter } from "./read.ts";

/**
 * Property tests of the D&D Beyond reader (docs/design/design-v1-pc-stats.md
 * 6.3). Its JSON is a third party's, fetched on the server for a share link
 * or pasted in the browser, so it can be anything. The reader promises it
 * never throws, and the server and the editor both refuse a fill that
 * fails the fill schema as `unreadable`. So whatever the JSON, a fill it
 * reads must pass that check, or a sheet a player linked in good faith
 * would not import at all. read.test.ts pins the cases by hand.
 */

type J = Record<string, unknown>;

const CLASS_FEATURE = 12168134;
const mod = (type: string, subType: string, value: number | null, extra: J = {}): J => ({ type, subType, fixedValue: value, value, statId: null, componentId: 0, requiresAttunement: false, ...extra });
const stats = (values: number[]) => values.map((value, i) => ({ id: i + 1, name: null, value }));
const limitedUse = (maxUses: number, resetType: number): J => ({ name: null, statModifierUsesId: null, resetType, numberUsed: 0, minNumberConsumed: 1, maxNumberConsumed: 1, maxUses, operator: 1, useProficiencyBonus: false, proficiencyBonusOperator: 1, resetDice: null });
const damage = (subType: string, diceString: string, higher: J[] = []): J => ({ type: "damage", subType, die: { diceString }, usePrimaryStat: false, atHigherLevels: { higherLevelDefinitions: higher } });

/**
 * Tamsin Reed, an invented fighter 3 and wizard 4, with a weapon of each
 * kind, spells that attack and that ask for a save, and class resources:
 * enough that most edits land on a path the reader reads.
 */
function tamsin(): J {
  return {
    id: 23456789,
    name: "Tamsin Reed",
    stats: stats([14, 15, 13, 16, 10, 8]),
    bonusStats: stats([0, 0, 0, 0, 0, 0]).map((s) => ({ ...s, value: null })),
    overrideStats: stats([0, 0, 0, 0, 0, 0]).map((s) => ({ ...s, value: null })),
    baseHitPoints: 40,
    bonusHitPoints: null,
    overrideHitPoints: null,
    race: { weightSpeeds: { normal: { walk: 30, fly: 0, burrow: 0, swim: 0, climb: 0 } } },
    classes: [
      { level: 3, definition: { name: "Fighter", spellCastingAbilityId: null }, subclassDefinition: null, classFeatures: [{ definition: { name: "Improved Critical", requiredLevel: 3, entityTypeId: CLASS_FEATURE } }] },
      { level: 4, definition: { name: "Wizard", spellCastingAbilityId: 4 }, subclassDefinition: null, classFeatures: [] },
    ],
    modifiers: {
      race: [mod("bonus", "intelligence-score", 2), mod("set-base", "darkvision", 60)],
      class: [mod("proficiency", "strength-saving-throws", null), mod("proficiency", "arcana", null), mod("expertise", "arcana", null)],
      background: [mod("proficiency", "history", null)],
      feat: [mod("bonus", "initiative", 2)],
      item: [mod("bonus", "armor-class", 1, { componentId: 901 })],
      condition: [],
    },
    inventory: [
      { equipped: true, isAttuned: false, definition: { id: 901, name: "Chain Shirt", filterType: "Armor", armorClass: 13, armorTypeId: 2 } },
      { equipped: true, definition: { id: 903, name: "Longsword", filterType: "Weapon", damage: { diceString: "1d8" }, damageType: "Slashing", attackType: 1, properties: [{ name: "Versatile", notes: "1d10" }], grantedModifiers: [{ type: "bonus", subType: "magic", fixedValue: 1, value: 1 }] } },
      { equipped: true, definition: { id: 904, name: "Light Crossbow", filterType: "Weapon", damage: { diceString: "1d8" }, damageType: "Piercing", attackType: 2, properties: [{ name: "Ammunition" }] } },
    ],
    classSpells: [
      {
        spells: [
          { prepared: true, definition: { name: "Fire Bolt", level: 0, requiresAttackRoll: true, scaleType: "characterlevel", modifiers: [damage("fire", "1d10", [{ level: 5, dice: { diceString: "2d10" } }, { level: 11, dice: { diceString: "3d10" } }])] } },
          { prepared: true, definition: { name: "Thunderwave", level: 1, requiresSavingThrow: true, saveDcAbilityId: 3, scaleType: "spellscale", modifiers: [damage("thunder", "2d8", [{ level: 1, dice: { diceString: "1d8" } }])] } },
        ],
      },
    ],
    spells: { race: [], class: [], item: [], feat: [] },
    actions: {
      race: [],
      class: [
        { name: "Second Wind", limitedUse: limitedUse(2, 1), componentTypeId: CLASS_FEATURE, componentId: 7001, dice: null },
        { name: "Action Surge", limitedUse: limitedUse(1, 1), componentTypeId: CLASS_FEATURE, componentId: 7002, dice: null },
      ],
      feat: [],
    },
  };
}

let n = 0;
const ids = () => `id${++n}`;

describe("the D&D Beyond reader, over any JSON (property)", () => {
  test("never throws, and every fill it reads passes the check the route and the editor make, its formulas all rolling", () => {
    const character = fc.oneof(fc.constant(tamsin()), fc.constant({ success: true, data: tamsin() }));
    holds(
      fc.property(fc.oneof({ weight: 1, arbitrary: fc.jsonValue({ maxDepth: 3 }) }, { weight: 6, arbitrary: mutatedJson(character) }), (raw) => {
        const fill = readDdbCharacter(raw, ids);
        if (fill === null) return;
        const parsed = pcFillSchema.safeParse(fill);
        assert.ok(parsed.success, parsed.success ? "" : `${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}`);
        assert.ok(checkedFill(fill), "the fill merges into a stat block the block's own schema takes");
        for (const roll of fill.stats.rolls) {
          for (const part of roll.dice) {
            assert.ok(parseFormula(part.formula).ok, `${roll.name}'s ${part.formula} rolls`);
            if (part.upcast !== undefined) assert.ok(parseFormula(part.upcast).ok, `${roll.name}'s upcast ${part.upcast} rolls`);
          }
        }
      }),
      5_000,
    );
  });
});
