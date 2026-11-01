import type { AbilityKey } from "#shared/model.ts";
import { ABILITY_NAMES } from "#shared/rules/skills.ts";
import { Loading } from "../../components/Loading.tsx";
import { Menu, type MenuItem, type MenuItemEvents } from "../../components/Menu.tsx";
import { markedBy, proficiencyBox } from "../../components/ProficiencyMark.tsx";
import { theme } from "../../lib/theme.ts";
import { SrdLoadFailed } from "../monsters/SrdLoadFailed.tsx";
import type { AbilityRow } from "./blockRolls.ts";
import { RollModeTitle } from "./RollModeMenu.tsx";
import { hasRollModeMenu, rollModeHint } from "./rollMode.ts";

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

export function AbilityMenu(props: AbilityMenuProps) {
  const name = ABILITY_NAMES[props.ability];
  const items = props.rows.map((row) => rowItem(row, props));
  return (
    // The box's padding and scrollbar own touches as its rows do, so a drag in it never moves the sheet (sheetSwipe's owned boundary). No browser menu on a row: a hold there is the roll's own.
    <div data-roll-mode-menu="" data-ability-menu={props.ability} onContextMenu={(e) => e.preventDefault()} style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}>
      <RollModeTitle>{name}</RollModeTitle>
      {/* A state, not help: it goes when the block may roll again (D-261031-121). */}
      {props.blocked ? (
        <div data-ability-blocked="" style={{ padding: `0 ${theme.space(3)}px`, marginBottom: theme.space(1), fontSize: theme.font.small, lineHeight: theme.leading.tight, color: theme.color.textMuted }}>
          {props.blocked}
        </div>
      ) : null}
      {props.failed ? (
        <SrdLoadFailed what="The rolls" inline />
      ) : props.loading ? (
        <Loading text="Loading the rolls…" />
      ) : (
        // A key opening lands on the first roll that may go, or with none, the first, so its reason is heard.
        <Menu label={`${name} rolls`} sections={[{ key: "rows", items }]} skipDisabledOnOpen={items.some((item) => !item.disabled)} onPick={props.onPick} />
      )}
    </div>
  );
}

function rowItem(row: AbilityRow, props: AbilityMenuProps): MenuItem {
  const busy = props.busy.has(row.rowKey);
  const options = row.capability !== null && hasRollModeMenu(row.capability);
  // While nothing may roll, a row's description is why, so a reader on it hears what the line under the title says, and no shortcut it would not take.
  const hint = options ? rollModeHint(row.capability!) : undefined;
  return {
    id: row.id,
    title: row.words,
    kind: "action",
    disabled: props.blocked !== null || busy,
    busy,
    label: row.name,
    ...(props.blocked !== null ? { description: props.blocked } : hint ? { description: hint, keys: { aria: "ContextMenu Shift+F10" } } : {}),
    content: <RowWords row={row} busy={busy} />,
    // A save's or a skill's level on the row's own border, as the Dice panel's cells draw it (D-261031-106).
    style: proficiencyBox(row.level, theme.color.surface),
    data: { "data-ability-row": row.id, ...(markedBy(row.level, "box") as Record<`data-${string}`, string>) },
    ...(options ? { events: props.events(row.id) } : {}),
  };
}

/** "Stealth  Dis   +6": the name, its tag after it, wrapping under it where the row is short, and the bonus at the end, never wrapped. */
function RowWords(props: { row: AbilityRow; busy: boolean }) {
  const { row } = props;
  return (
    <span aria-hidden style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", gap: theme.space(2) }}>
      {/* Centered, not on the name's baseline: the tag's smaller type would then sit off the row's middle. */}
      <span style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: theme.space(1), rowGap: 0 }}>
        <span>{row.words}</span>
        {row.tag ? <span style={{ fontSize: theme.font.tiny, fontWeight: theme.weight.strong, color: theme.color.textMuted }}>{row.tag}</span> : null}
      </span>
      <span style={{ flex: "none", fontVariantNumeric: "tabular-nums" }}>
        {row.bonusText}
        {props.busy ? "…" : null}
      </span>
    </span>
  );
}
