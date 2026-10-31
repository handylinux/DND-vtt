import type { AbilityKey } from "#shared/model.ts";
import type { AbilityRow } from "./blockRolls.ts";
import type { MenuItemEvents } from "../../components/Menu.tsx";

/**
 * An ability's list (docs/design-v1-stat-block-rolls.md 4): its title, then
 * its rows, the blocked line under the title where rolls cannot go, or the
 * shared loading line while its numbers load. Render inside its Popover.
 */
export type AbilityMenuProps = {
  ability: AbilityKey;
  rows: readonly AbilityRow[];
  /** Why no row may roll now: no connection, a preview. */
  blocked: string | null;
  /** The SRD rolls table loads, or failed to. */
  loading: boolean;
  failed: boolean;
  /** Row keys whose roll waits. */
  busy: ReadonlySet<string>;
  /** Each row's press binding, by row id. */
  events(id: string): MenuItemEvents;
  onPick(id: string): void;
};

export function AbilityMenu(_props: AbilityMenuProps) {
  return null;
}
