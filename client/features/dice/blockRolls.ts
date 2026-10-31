import type { D20Test } from "#shared/dice/bonus.ts";
import type { AbilityKey, CharacterId, RoomState, SkillKey, TokenId } from "#shared/model.ts";
import type { ActorTarget } from "#shared/protocol.ts";
import type { Proficiency } from "#shared/rules/proficiency.ts";
import type { RollPreset } from "#shared/rules/rollReminders.ts";
import type { You } from "../../state/types.ts";
import type { CreatureRolls, DiceView } from "./creature.ts";
import type { RollModeCapability } from "./rollMode.ts";

/**
 * Rolling from a stat block's ability boxes (docs/design-v1-stat-block-rolls.md),
 * free of React: whose block rolls, and each ability's rows, built from the
 * Dice panel's own rules so a roll is one roll wherever it shows.
 */

/** Where a block is mounted: a token's panel, the PC token's included, or a character's page. */
export type BlockFrom = { tokenId: TokenId } | { characterId: CharacterId };

/**
 * The creature a block's boxes roll for (section 2): its target in the
 * Dice panel's form, its token on the viewer's scene where it has one, its
 * name, and whether a player plays it, which the DM's ask reads.
 */
export type BlockRoller = { creature: ActorTarget; tokenId?: TokenId; name: string; played: boolean };

/** Who rolls from a block, or null where its boxes stay text (section 2). */
export function blockRoller(_view: RoomState, _you: You, _sceneId: string | null, _from: BlockFrom): BlockRoller | null {
  return null;
}

/** The tests in the Dice panel's exact shapes, so their row keys match its cells' (section 7). */
export function saveTest(ability: AbilityKey): Extract<D20Test, { kind: "save" }> {
  return { kind: "save", ability };
}

export function checkTest(ability: AbilityKey): Extract<D20Test, { kind: "check" }> {
  return { kind: "check", ability };
}

export function skillTest(ability: AbilityKey, skill: SkillKey): Extract<D20Test, { kind: "check" }> {
  return { kind: "check", ability, skill };
}

/** A box's accessible description: what its list holds (3.2). */
export function boxDescription(ability: AbilityKey): string {
  if (ability === "con") return "Opens the check and the save";
  if (ability === "dex") return "Opens the check, the save, its skills and Initiative";
  return "Opens the check, the save and its skills";
}

/** One row of an ability's list (4.2): a roll, or in a score room the score that sets the row without dice (4.3). */
export type AbilityRow = {
  /** Unique in its list: "check", "save", a skill's key, "initiative" or "score". */
  id: string;
  kind: "check" | "save" | "skill" | "initiative" | "score";
  /** What it rolls. Null for the score, which rolls nothing. */
  test: D20Test | null;
  /** Its name at the row's start, which typeahead reads: "Check", "Save", "Stealth", "Initiative", "Initiative score", "Roll initiative". */
  words: string;
  /** The bonus it rolls, or the score it sets. */
  bonus: number;
  /** "+6", "−1", or the score's "12". */
  bonusText: string;
  /** Small muted words after its name: "Asked", "Asks", a preset's tag, Initiative's tracker tag. Empty for none. */
  tag: string;
  /** Its proficiency mark, for a save or a skill. */
  level?: Proficiency;
  /** Where its tap goes. "score" sets the tracker row. */
  route: "roll" | "answer" | "ask" | "score";
  /** Its one-roll options, or null where it has none: an ask, the score. */
  capability: RollModeCapability | null;
  /** The Dice panel's row key, so a waiting roll is busy in both places. */
  rowKey: string;
  /** Everything that names this roll and its route, for its options to go back to the list when it changes (5.4). */
  source: string;
  /** Its accessible name: "Dexterity save +2, proficient, answers the DM's request, Dis: Restrained". */
  name: string;
  /** Its options' title: "Dexterity save +2", "Stealth +6", "Roll initiative +2". */
  title: string;
  /** The roll's label, as the Dice panel's cell labels it. */
  label: string;
  /** The preset its tap sends, for the routed test. */
  preset: RollPreset;
  /** Initiative's and the score's tracker row. */
  entryId?: string;
};

export type AbilityRowsInput = {
  dice: DiceView;
  rolls: CreatureRolls;
  roller: BlockRoller;
  /** The Dice panel's Ask switch is on for this creature (its default). */
  ask: boolean;
};

/** An ability's rows in order (4.1), or none while its creature has no numbers. */
export function abilityRows(_ability: AbilityKey, _input: AbilityRowsInput): AbilityRow[] {
  return [];
}
