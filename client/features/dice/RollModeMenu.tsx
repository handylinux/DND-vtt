import { useLayoutEffect } from "react";
import { Menu } from "../../components/Menu.tsx";
import { Popover, type PopoverHandle } from "../../components/Popover.tsx";
import { theme } from "../../lib/theme.ts";
import { uiScale } from "../device/settings.ts";
import { rollModeItems, type RollModeCapability, type RollModeOverride } from "./rollMode.ts";

const TITLE = { fontSize: theme.font.small, fontWeight: theme.weight.bold, lineHeight: theme.leading.tight, color: theme.color.textMuted } as const;

/**
 * `title` names the roll at the menu's top, in the words its source shows
 * (D-261031-079), since on a phone the finger covers the button it held.
 */
export type RollModeMenuProps = { handle: PopoverHandle; name: string; title: string; capability: RollModeCapability; dm: boolean; onPick(override: RollModeOverride): void };
export function RollModeMenu({ handle, name, title, capability, dm, onPick }: RollModeMenuProps) {
  useLayoutEffect(() => {
    if (!handle.open) return;
    const box = handle.box.current;
    // The popover's padding and scrollbar own touches as well as its rows.
    box?.setAttribute("data-roll-mode-menu", "");
    return () => box?.removeAttribute("data-roll-mode-menu");
  }, [handle.open, handle.box]);
  const items = rollModeItems(capability, dm);
  if (items.length === 0) return null;
  // Its title and its choices, each choice explained in its accessible description (rollModeItems). It opens below a roll near the screen's top where it fits there and not above.
  return (
    <Popover handle={handle} side="above" flip bound={() => ({ left: 0, top: 0, right: window.innerWidth / uiScale(), bottom: window.innerHeight / uiScale() })}>
      <div data-roll-mode-menu="" onContextMenu={(e) => e.preventDefault()}>
        {/* The menu's label names it for a screen reader. In the button's own case, so it reads as what was pressed, and smaller, bolder and muted beside the rows, so it reads as their title. Sized by the rows under it, so a long name wraps, and past two lines ends in an ellipsis. In from the box as a row's words are. */}
        <div data-roll-mode-title="" aria-hidden style={{ ...TITLE, contain: "inline-size", overflowWrap: "anywhere", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden", padding: `0 ${theme.space(3)}px`, marginBottom: theme.space(1) }}>
          {title}
        </div>
        <Menu label={`Roll options for ${name}`} sections={[{ key: "roll", items }]} skipDisabledOnOpen onPick={(id) => onPick(id as RollModeOverride)} />
      </div>
    </Popover>
  );
}
