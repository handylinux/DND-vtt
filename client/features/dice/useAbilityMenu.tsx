import { useId, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import type { AbilityKey } from "#shared/model.ts";
import { boxDescription, type BlockRoller } from "./blockRolls.ts";
import type { RollModeOverride } from "./rollMode.ts";

/**
 * A roll the block sent (docs/design-v1-stat-block-rolls.md 8): its tag,
 * and the choice picked from its options, undefined for a tap, which the
 * result line reads only to decide whether mode words qualify.
 */
export type BlockSent = { tag: string; override?: RollModeOverride };

export type UseAbilityMenuOptions = {
  ability: AbilityKey;
  roller: BlockRoller;
  /** After each tap or pick that sent a roll. */
  onSent(sent: BlockSent): void;
  /** After each tap or pick whose roll did not go, with why: "Rolling needs a connection.". */
  onUnsent(words: string): void;
};

/** Spread on the box's own button. It carries the box's popup state and description, not its name. */
export type AbilityBoxProps = ButtonHTMLAttributes<HTMLButtonElement> & { ref(node: HTMLButtonElement | null): void };

export type AbilityMenuBinding = {
  buttonProps: AbilityBoxProps;
  /** Render right after the box: the list's popover and the box's hidden description. */
  menu: ReactNode;
  open: boolean;
  /** Paint-only styles for the box, so a hold never selects its words. Merge after its own. */
  pressStyle: CSSProperties;
};

/**
 * An ability box's list of rolls (sections 3 to 5): the box's presses, the
 * popover with its two views, the list and one roll's options, and the roll.
 */
export function useAbilityMenu(options: UseAbilityMenuOptions): AbilityMenuBinding {
  const descriptionId = useId();
  return {
    buttonProps: { ref: () => undefined, "aria-haspopup": "menu", "aria-expanded": false, "aria-describedby": descriptionId },
    menu: (
      <span hidden id={descriptionId}>
        {boxDescription(options.ability)}
      </span>
    ),
    open: false,
    pressStyle: {},
  };
}
