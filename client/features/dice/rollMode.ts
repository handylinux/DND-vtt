import { advantageFields, applyMode, parseFormula, type AdvantageSource } from "#shared/dice/formula.ts";

/** An invocation value. Never store this in panel choices or card chips. */
export type RollModeOverride = "adv" | "dis" | "secret" | "normal";
export type RollVisibility = "selectable" | "request" | "creature" | "repeat";
/**
 * `secretByDefault`: an ordinary tap here is secret already, as a DM's free
 * roll for a creature no player plays (startsSecret), and nothing presses
 * Secret away from that, so Roll secretly would send just what the tap
 * sends and is left out (D-261031-131).
 */
export type RollModeCapability = { d20: boolean; visibility: RollVisibility; damage?: boolean; batch?: boolean; repeat?: boolean; manual?: RollPresses; secretByDefault?: boolean };
/** The manual choices an ordinary tap here would apply, which Roll normally drops: an Adv or Dis pressed or typed (`mode`), and a Secret pressed away from where it starts (`secret`). */
export type RollPresses = { mode?: boolean; secret?: boolean };
export const NORMAL_HELP = "Roll normally: ignores Adv, Dis and Secret pressed for this roll. Conditions and usual visibility still apply.";
export const REPEAT_HELP = "All repeat choices: use the recorded formula. Current effects are not rebuilt.";
export const BATCH_HELP = "All choices: apply to server rolls only. Players choose their own modes.";
export const FIXED_VISIBILITY = {
  request: "Roll secretly: request answers keep the request's visibility.",
  creature: "Roll secretly: this roll's visibility is set by the creature.",
  repeat: "Roll secretly: this repeat keeps its recorded visibility.",
} as const;

export function acceptsRollMode(formula: string): boolean {
  const parsed = parseFormula(formula);
  return parsed.ok && applyMode(parsed.formula, "adv").ok;
}

export function hasRollModeMenu(capability: RollModeCapability): boolean {
  return (capability.d20 && !capability.damage) || capability.visibility === "selectable";
}

/**
 * Whether the menu offers Roll normally: only where it rolls otherwise than
 * an ordinary tap (D-261031-078). A repeat's tap repeats its recorded mode,
 * and elsewhere the tap would apply a manual choice that Normal drops.
 * Where the tap already rolls normally, the choice would only duplicate it.
 */
export function offersNormal(capability: RollModeCapability): boolean {
  const { manual } = capability;
  return capability.repeat === true || (capability.d20 && !capability.damage && manual?.mode === true) || (capability.visibility === "selectable" && manual?.secret === true);
}

/** Manual sources are separate so presets with several opposing sources resolve only once. */
export function rollModeSources(preset: readonly AdvantageSource[], manual: readonly AdvantageSource[], override?: RollModeOverride): AdvantageSource[] {
  return [...preset, ...(override === "normal" ? [] : override === "adv" || override === "dis" ? [{ kind: override, from: "roll-menu" }] : manual)];
}

/** A formula's words and the panel's presses are manual. All other sources are creature presets. */
export function overrideRollSources(sources: readonly AdvantageSource[], manual: readonly AdvantageSource[], override?: RollModeOverride): AdvantageSource[] {
  const preset = sources.filter((s) => s.from !== "typed" && s.from !== "pressed");
  const words = sources.filter((s) => s.from === "typed" || s.from === "pressed");
  return rollModeSources(preset, [...words, ...manual], override);
}

export function rollModeTo(ordinary: "all" | "dm", baseline: "all" | "dm", override?: RollModeOverride): "all" | "dm" {
  return override === "normal" ? baseline : override === "secret" ? "dm" : ordinary;
}

export type RollModeItem = { id: RollModeOverride; title: string; kind: "action"; disabled?: boolean; description?: string };
/**
 * The menu shows only the choices' titles (D-261031-080). Each description
 * is the choice's accessible description, and a note that holds for every
 * choice, a repeat's or a batch's, ends each one, so a screen reader hears
 * it whichever choice it lands on.
 */
export function rollModeItems(capability: RollModeCapability, dm: boolean): RollModeItem[] {
  if (!hasRollModeMenu(capability)) return [];
  const every = [capability.repeat ? REPEAT_HELP : "", capability.batch ? BATCH_HELP : ""];
  const describe = (own?: string) => [own ?? "", ...every].filter(Boolean).join(" ") || undefined;
  const items: RollModeItem[] = [];
  if (capability.d20 && !capability.damage) items.push({ id: "adv", title: "Roll with Advantage", kind: "action", description: describe() }, { id: "dis", title: "Roll with Disadvantage", kind: "action", description: describe() });
  items.push({ id: "secret", title: "Roll secretly", kind: "action", disabled: capability.visibility !== "selectable", description: describe(capability.visibility === "selectable" ? dm ? "Roll secretly: hide the dice from players." : "Roll secretly: you and the DM see the result." : FIXED_VISIBILITY[capability.visibility]) });
  if (offersNormal(capability)) items.push({ id: "normal", title: "Roll normally", kind: "action", description: describe(capability.repeat ? "Roll normally: ignores the recorded mode and keeps the formula and visibility." : NORMAL_HELP) });
  return items;
}

export function rollModeHint(capability: RollModeCapability): string | undefined {
  if (!hasRollModeMenu(capability)) return undefined;
  const choices = [...(capability.d20 && !capability.damage ? ["Advantage", "Disadvantage"] : []), ...(capability.visibility === "selectable" ? ["Secret"] : []), ...(offersNormal(capability) ? ["Normal"] : [])];
  const last = choices.pop();
  return `Hold, right-click or Shift+F10 for ${choices.length > 0 ? `${choices.join(", ")} or ${last}` : last}.`;
}

/**
 * What the menu's title calls its roll (D-261031-079): the source's own
 * visible words, such as "Perception +4", or its name where those are only
 * a verb and a modifier, "Roll", "Roll +6" or "Again", or nothing.
 */
export function rollModeTitle(visible: string, name: string): string {
  const words = visible.replace(/\s+/g, " ").trim();
  return /^(?:(?:Roll|Again)(?: [+−-]\d+)?)?$/i.test(words) ? name : words;
}

/** Effective words come from returned dice, never the picked item. */
export function effectiveRollMode(roll: { formula: string; mode?: "adv" | "dis"; cancelled?: boolean }, secret = false): string {
  const mode = roll.mode === "adv" ? "Advantage" : roll.mode === "dis" ? "Disadvantage" : roll.cancelled ? "Normal: Advantage and Disadvantage cancelled" : acceptsRollMode(roll.formula) ? "Normal" : "";
  return [mode, secret ? "Secret" : ""].filter(Boolean).join(", ");
}

export const resolveRollMode = (preset: readonly AdvantageSource[], manual: readonly AdvantageSource[], override?: RollModeOverride) => advantageFields(rollModeSources(preset, manual, override));
