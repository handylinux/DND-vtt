import { useContext, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { AbilityKey } from "#shared/model.ts";
import { focusInView, Popover, usePopover, type CloseReason, type OpenHow } from "../../components/Popover.tsx";
import { useRoomStore, useRoomView } from "../../state/view.ts";
import { PreviewContext } from "../dm/previewContext.ts";
import { AbilityMenu } from "./AbilityMenu.tsx";
import { abilityRows, boxDescription, type AbilityRow, type BlockRoller } from "./blockRolls.ts";
import { creatureRolls, type DiceView } from "./creature.ts";
import { creatureKey } from "./options.ts";
import { rowTag, useOption } from "./optionState.ts";
import { presetFor } from "./presets.ts";
import { RollModeMenuBody, rollModeBound } from "./RollModeMenu.tsx";
import { hasRollModeMenu, rollModeItems, type RollModeOverride } from "./rollMode.ts";
import { NEEDS_CONNECTION } from "./send.ts";
import { useDiceView } from "./useDiceView.ts";
import { useReceipts } from "./useReceipt.ts";
import { IN_PREVIEW, useRollOption, useWatchInitiative } from "./useRollOption.ts";
import { markRollModeSource, raiseRollModeHosts, RollPressRegistry, useRollPressBinding, type RollPressControl } from "./useRollModeMenu.tsx";

/**
 * A roll the block sent (docs/design-v1-stat-block-rolls.md 8): its tag,
 * the choice picked from its options, undefined for a tap, which the
 * result line reads only to decide whether mode words qualify, and the
 * row's label. An answer's roll comes back with no label of its own, so the
 * line names it from the row (LP27-A-BLOCK-3), as the Dice panel's newest
 * line names an answer from its option.
 */
export type BlockSent = { tag: string; override?: RollModeOverride; label: string };

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
 * What the popover shows: the ability's list, or one roll's options in its
 * place (5.1). `fit` options have their own box. Options a held finger
 * opened keep the list's box until that finger lifts, so the finger stays
 * inside it and its lift presses nothing (D-261031-212).
 */
export type AbilityView = { kind: "list" } | { kind: "options"; row: string; source: string; fit: boolean };

const LIST: AbilityView = { kind: "list" };
export const BOX = "box";
export const rowPress = (id: string) => `row:${id}`;

/** What the box's list reads and does, each read as it is needed, so the control is free of React and its rules are tested with fakes. */
export type AbilityMenuEnv = {
  /** The list or its options stand open. */
  isOpen(): boolean;
  show(how: OpenHow): void;
  close(reason: CloseReason): void;
  box(): HTMLElement | null;
  /** A row's element while it is drawn. */
  row(id: string): HTMLElement | null;
  /** Focus into the open menu, as a key open puts it. */
  focusInside(from: "first" | "last"): void;
  focusRow(id: string): void;
  /** Focus stands inside the open popover. */
  focusedInside(): boolean;
  /** Draws the view, at once unless `later`, so focus moves among the nodes it draws. After a render, the next render draws it. */
  draw(view: AbilityView, later?: boolean): void;
  /** The rows as the room stands now. */
  rows(): readonly AbilityRow[];
  blocked(): string | null;
  busy(row: AbilityRow): boolean;
  dm(): boolean;
  /** Sends a row's roll: a tap's with no override, a pick's with one. */
  roll(row: AbilityRow, override?: RollModeOverride): void;
  /** Why a tap or a pick sent nothing, for the result line (D-261031-167). */
  unsent(words: string): void;
};

/**
 * The box's presses and its list's two views (sections 3.3 and 5): every
 * press on the box opens or closes the list, a tap on a row rolls it, and a
 * hold, a right-click or a context key on a row swaps the list for that
 * roll's options in the same popover. The press machines live in the
 * control's registry, keyed by row, so a held press outlives the row the
 * swap removes (D-261031-138).
 */
export class AbilityMenuControl {
  readonly presses: RollPressRegistry;
  readonly #env: AbilityMenuEnv;
  view: AbilityView = LIST;

  constructor(env: AbilityMenuEnv, presses: RollPressRegistry) {
    this.#env = env;
    this.presses = presses;
  }

  readonly boxControl: RollPressControl = {
    open: () => this.#env.isOpen(),
    show: (by) => this.openList(by, "first"),
    close: () => this.#env.close("anchor"),
    node: () => this.#env.box(),
    menuOpen: () => this.#env.isOpen(),
  };

  /** A row holds no menu of its own: its press opens its options in the list's place. */
  rowControl(id: string): RollPressControl {
    return {
      open: () => false,
      show: (by) => this.swap(id, by),
      close: () => undefined,
      node: () => this.#env.row(id),
      menuOpen: () => false,
      lifted: () => this.lifted(id),
    };
  }

  /** The finger that held a row lifted: its options take a box of their own now. */
  lifted(id: string): void {
    const view = this.view;
    if (view.kind !== "options" || view.row !== id || view.fit) return;
    this.view = { ...view, fit: true };
    this.#env.draw(this.view, true);
  }

  /** The machines kept while idle: the box's, and the rows drawn now. */
  keeps(key: string): boolean {
    return key === BOX || (key.startsWith("row:") && this.#env.row(key.slice(4)) !== null);
  }

  openList(by: "pointer" | "key", from: "first" | "last"): void {
    if (this.#env.isOpen()) return;
    this.view = LIST;
    this.#env.draw(LIST);
    this.#env.show({ by, from });
  }

  /** The box's own click, after its press machine's gate: a pointer's, or a key's or a reader's with `detail` 0. */
  boxClick(detail: number): void {
    if (this.presses.click(BOX, detail)) this.openList(detail === 0 ? "key" : "pointer", "first");
  }

  /** Down and Up open the list on its first or last roll, or move focus into it, as on any menu button. */
  boxKey(e: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "defaultPrevented" | "preventDefault">): void {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const from = e.key === "ArrowUp" ? "last" : "first";
    if (this.#env.isOpen()) this.#env.focusInside(from);
    else this.openList("key", from);
  }

  #ready(row: AbilityRow | undefined): row is AbilityRow {
    return row !== undefined && this.#env.blocked() === null && !this.#env.busy(row);
  }

  /** A row's options in the list's place (5.1). Focus moves before the held row goes: to the box after a pointer, to the first choice after a key (D-261031-163). */
  swap(id: string, by: "pointer" | "key"): void {
    const row = this.#env.rows().find((r) => r.id === id);
    if (!this.#env.isOpen() || !this.#ready(row) || !row.capability || !hasRollModeMenu(row.capability)) return;
    this.#env.box()?.focus({ preventScroll: true });
    // A finger still on the row that is going: right-click and the keys open with none down.
    const held = this.presses.machine(rowPress(id))?.activeId != null;
    this.view = { kind: "options", row: id, source: row.source, fit: !held };
    this.#env.draw(this.view);
    if (by === "key") this.#env.focusInside("first");
  }

  /** A row's tap, Menu's pick in the list. Menu closes the list after it, focus on the box. */
  pickRow(id: string): void {
    if (this.view.kind !== "list") return;
    const row = this.#env.rows().find((r) => r.id === id);
    if (this.#ready(row)) this.#env.roll(row);
    else this.#unsent(row);
  }

  /** A choice in a row's options: checked against the roll as it stands, then closed, then sent (FL-17's onPick). */
  pickChoice(override: RollModeOverride): void {
    const view = this.view;
    if (view.kind !== "options") return;
    const row = this.#env.rows().find((r) => r.id === view.row);
    if (row === undefined || row.source !== view.source || !row.capability) return;
    if (!rollModeItems(row.capability, this.#env.dm()).some((item) => item.id === override && !item.disabled)) return;
    if (!this.#ready(row)) return this.#unsent(row);
    this.#env.close("pick");
    this.#env.roll(row, override);
  }

  /**
   * A row its render still offered, though it may not roll now: the
   * connection dropped before the render that disables it. The result line
   * says why, as section 8 has it. A busy row says nothing, since its roll
   * is on its way.
   */
  #unsent(row: AbilityRow | undefined): void {
    const why = this.#env.blocked();
    if (row !== undefined && why !== null) this.#env.unsent(why);
  }

  /** Escape or Back in a roll's options goes back to the list on its row. In the list, they close it (5.3). */
  stepBack(_reason: "escape" | "back"): boolean {
    const view = this.view;
    if (view.kind !== "options") return false;
    this.view = LIST;
    this.#env.draw(LIST);
    this.#env.focusRow(view.row);
    return true;
  }

  /** After each render: options whose roll changed, or that may not roll now, go back to the list, which shows why (5.4). */
  revalidate(rows: readonly AbilityRow[], blocked: string | null): void {
    const view = this.view;
    if (view.kind !== "options") return;
    const row = rows.find((r) => r.id === view.row);
    if (row && row.source === view.source && blocked === null) return;
    // A choice that held focus is going, so its row takes it, as a step back gives it.
    const inside = this.#env.focusedInside();
    this.view = LIST;
    this.#env.draw(LIST, true);
    if (inside && this.#env.isOpen()) this.#env.focusRow(view.row);
  }

  /** The popover closed, by whatever means. */
  closed(): void {
    this.view = LIST;
  }
}

/**
 * An ability box's list of rolls (sections 3 to 5): the box's presses, the
 * popover with its two views, the list and one roll's options, and the roll.
 */
export function useAbilityMenu(options: UseAbilityMenuOptions): AbilityMenuBinding {
  const latest = useRef(options);
  latest.current = options;
  const descriptionId = useId();
  const { ability, roller } = options;
  const room = useRoomStore();
  const preview = useContext(PreviewContext) !== null;
  const connected = useRoomView((s) => s.connection === "open");
  const blocked = preview ? IN_PREVIEW : connected ? null : NEEDS_CONNECTION;
  const [view, setView] = useState<AbilityView>(LIST);
  const control = useRef<AbilityMenuControl | null>(null);
  const handle = usePopover({ kind: "menu", onClose: () => { control.current?.closed(); setView(LIST); } });
  const current = useRef(handle);
  current.current = handle;
  const open = handle.open;
  // The numbers load only for an open list, so a block never fetches the SRD's table for a box nobody pressed.
  const targetKey = JSON.stringify(roller.creature);
  const creatures = useMemo(() => (open ? [roller.creature] : []), [open, targetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const loaded = useDiceView(creatures);
  const key = useRoomView((s) => (s.view ? creatureKey(s.view, roller.creature) : ""));
  const ask = !useOption((s) => s.askOff[key] === true);
  const rowsFor = (dice: DiceView | null): AbilityRow[] => {
    const rolls = dice ? creatureRolls(dice, roller.creature) : null;
    return dice && rolls ? abilityRows(ability, { dice, rolls, roller, ask }) : [];
  };
  const rows = open && loaded.dice ? rowsFor(loaded.dice) : [];
  // A waiting row is busy here and in the Dice panel alike, by the panel's row key (D-261031-126). Read without watching, so showing it busy is not showing its result.
  const tracker = useReceipts();
  useSyncExternalStore(tracker.subscribe, () => (open ? tracker.version() : 0), () => 0);
  const tags = useOption((s) => rows.map((r) => rowTag(s, r.rowKey) ?? "").join("\n"));
  const busy = new Set<string>();
  tags.split("\n").forEach((tag, i) => {
    const state = tag ? tracker.state(tag) : null;
    if (state?.state === "sending" || state?.state === "checking") busy.add(rows[i]!.rowKey);
  });
  const option = useRollOption();
  const watch = useWatchInitiative();
  const dm = useRoomView((s) => s.you?.role === "dm");
  // What the control reads as it acts: this render's, since it was made once, on the first.
  const send = (row: AbilityRow, override?: RollModeOverride) =>
    sendAbilityRow({ option, watch, dice: loaded.dice, dm, roller: latest.current.roller, ask, onSent: (sent) => latest.current.onSent(sent), onUnsent: (words) => latest.current.onUnsent(words) }, row, override);
  const live = useRef({ dice: loaded.dice, blocked, busy, rowsFor, dm, send });
  live.current = { dice: loaded.dice, blocked, busy, rowsFor, dm, send };

  const presses = useRollPressBinding({ enabled: true, onLeave: () => current.current.close("anchor"), keep: (k) => control.current?.keeps(k) ?? true });
  control.current ??= new AbilityMenuControl(
    {
      isOpen: () => current.current.open,
      show: (how) => current.current.show(how),
      close: (reason) => flushSync(() => current.current.close(reason)),
      box: () => current.current.anchor.current,
      row: (id) => rowNode(current.current.box.current, id),
      focusInside: (from) => current.current.focusInside.current?.(from),
      focusRow: (id) => {
        const run = () => {
          const node = rowNode(current.current.box.current, id);
          if (node) focusInView(node);
        };
        // A view drawn after a render stands once that render's own update is done.
        if (rowNode(current.current.box.current, id)) run();
        else queueMicrotask(run);
      },
      focusedInside: () => {
        const box = current.current.box.current;
        return box !== null && document.activeElement instanceof Node && box.contains(document.activeElement);
      },
      draw: (next, later) => (later ? setView(next) : flushSync(() => setView(next))),
      rows: () => {
        // The room as it stands at the press, with the SRD's chunks this render loaded.
        const now = room.getState();
        const dice = live.current.dice;
        return dice && now.view && now.you ? live.current.rowsFor({ ...dice, you: now.you, view: now.view }) : [];
      },
      blocked: () => (live.current.blocked !== null ? live.current.blocked : room.getState().connection === "open" ? null : NEEDS_CONNECTION),
      busy: (row) => live.current.busy.has(row.rowKey),
      dm: () => live.current.dm,
      roll: (row, override) => live.current.send(row, override),
      unsent: (words) => latest.current.onUnsent(words),
    },
    presses,
  );
  const ctl = control.current;

  useLayoutEffect(() => ctl.revalidate(rows, blocked));
  // A box that stops rolling, or another creature's, closes its list (4.6).
  useLayoutEffect(() => () => current.current.close("state"), [targetKey, ability]);
  // The box stays marked while its list is open, in both views (D-261031-079).
  useLayoutEffect(() => (open ? markRollModeSource(handle.anchor.current) : undefined), [open, handle.anchor]);
  useLayoutEffect(() => (open ? raiseRollModeHosts(handle.anchor.current, handle.box.current) : undefined), [open, handle.anchor, handle.box]);
  useLayoutEffect(() => {
    if (!open) return;
    const box = handle.box.current;
    // The popover's padding and scrollbar own touches as its rows do (sheetSwipe's owned boundary).
    box?.setAttribute("data-roll-mode-menu", "");
    return () => box?.removeAttribute("data-roll-mode-menu");
  }, [open, handle.box]);

  const { onKeyDown: pressKey, ...boxHandlers } = presses.handlers(BOX, ctl.boxControl);
  const buttonProps: AbilityBoxProps = {
    ...boxHandlers,
    ref: (node) => handle.anchorProps.ref(node),
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? handle.contentId : undefined,
    "aria-describedby": descriptionId,
    "aria-keyshortcuts": "ContextMenu Shift+F10",
    onClick: (e) => ctl.boxClick(e.detail),
    onKeyDown: (e) => {
      pressKey?.(e);
      ctl.boxKey(e);
    },
  };
  const shown = view.kind === "options" ? rows.find((r) => r.id === view.row) : undefined;
  return {
    buttonProps,
    open,
    pressStyle: { WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" },
    menu: (
      <>
        <span hidden id={descriptionId}>
          {boxDescription(ability)}
        </span>
        <Popover handle={handle} side="above" flip bound={rollModeBound} stepBack={(reason) => ctl.stepBack(reason)} contentKey={abilityContent(loaded, view)}>
          {shown?.capability ? (
            <RollModeMenuBody name={shown.title} title={shown.title} capability={shown.capability} dm={dm} onPick={(override) => ctl.pickChoice(override)} />
          ) : (
            <AbilityMenu
              ability={ability}
              rows={rows}
              blocked={blocked}
              loading={loaded.loading}
              failed={loaded.failed}
              busy={busy}
              events={(id) => presses.handlers(rowPress(id), ctl.rowControl(id))}
              onPick={(id) => ctl.pickRow(id)}
            />
          )}
        </Popover>
      </>
    ),
  };
}

/** A row of the open list by its id, which is a skill's key or a word, so it needs no escaping in the selector. */
function rowNode(box: HTMLElement | null, id: string): HTMLElement | null {
  return box?.querySelector<HTMLElement>(`[data-ability-row="${id}"]`) ?? null;
}

/** What sending a row's roll needs, none of it a render's. */
export type SendDeps = {
  option: Pick<ReturnType<typeof useRollOption>, "d20" | "setInitiative">;
  watch(tag: string, entryId: string): void;
  dice: DiceView | null;
  dm: boolean;
  roller: BlockRoller;
  ask: boolean;
  onSent(sent: BlockSent): void;
  onUnsent(words: string): void;
};

/**
 * A row's roll through the Dice panel's path (section 7), taking none of
 * its choices and throwing no dice: an answer, an ask or a free roll by its
 * route, Initiative written to its row once it lands, and the score set
 * with no roll. A roll that went is the grid's newest, one that did not
 * says why, and a tap that sends no roll, an ask or the score, leaves the
 * result line as it stood (D-261031-137).
 */
export function sendAbilityRow(deps: SendDeps, row: AbilityRow, override?: RollModeOverride): void {
  if (row.route === "score") {
    if (row.entryId) deps.option.setInitiative(row.entryId, row.bonus, deps.dm);
    return;
  }
  const { dice, roller } = deps;
  if (!row.test || !dice) return;
  const rolls = creatureRolls(dice, roller.creature);
  const initiative = row.kind === "initiative";
  let failed: string | null = null;
  const sent = deps.option.d20({
    ...(override ? { override } : {}),
    creature: roller.creature,
    test: row.test,
    bonus: row.bonus,
    preset: row.preset,
    presetOf: (t) => presetFor(dice, roller.creature, t, { rolls }),
    label: row.label,
    row: row.rowKey,
    // Initiative never asks (4.4), as the Dice panel's cell sends it.
    played: initiative ? false : roller.played,
    ask: initiative ? false : deps.ask,
    ...(roller.tokenId ? { tokenId: roller.tokenId } : {}),
    choices: "none",
    onFail: (words) => {
      failed = words;
    },
  });
  if (sent === "asked") return;
  if (sent !== null) {
    if (initiative && row.entryId) deps.watch(sent, row.entryId);
    deps.onSent(override ? { tag: sent, override, label: row.label } : { tag: sent, label: row.label });
  } else if (failed !== null) deps.onUnsent(failed);
}

/**
 * What the ability's popover shows, as its `contentKey`: its rows, its
 * loading line or its failure, or a roll's options once they have their
 * own box, so each is drawn in a box placed for it (4.6, 5.1). Options a
 * held finger opened keep the rows' box until it lifts: a box placed again
 * under it would leave the finger outside (D-261031-212).
 */
export function abilityContent(loaded: { loading: boolean; failed: boolean }, view: AbilityView): string {
  if (view.kind === "options" && view.fit) return `options:${view.row}`;
  return loaded.failed ? "failed" : loaded.loading ? "loading" : "rows";
}
