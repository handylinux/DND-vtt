import { useEffect, useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type DOMAttributes, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { scrolledAway, usePopover } from "../../components/Popover.tsx";
import { theme } from "../../lib/theme.ts";
import { RollModeMenu } from "./RollModeMenu.tsx";
import { attachConsumedTouch, RollPress, type RollPressClock } from "./rollPress.ts";
import { hasRollModeMenu, rollModeHint, rollModeItems, rollModeTitle, type RollModeCapability, type RollModeOverride } from "./rollMode.ts";

/** The one control a roll button's binding holds. */
const BUTTON = "button";

export type UseRollModeMenuOptions = {
  /** Include every input that can change the roll or its route. Stable primitives work best. */
  source: string;
  name: string;
  /** The menu's visible title where the source's own words say too little, such as Again's "Again: 1d20+5". By default those words, or `name` (rollModeTitle). */
  title?: string;
  capability: RollModeCapability;
  /** Only cases where the base tap did nothing, such as native disabled or busy. Ordinary taps call onTap when not disabled and the press allows them. */
  disabled?: boolean;
  dm: boolean;
  onTap(): void;
  onRoll(override: RollModeOverride): void;
  /** Guards menu opening and picking only. Ordinary taps still reach their existing handler and error feedback. */
  valid?(): boolean;
  fallbackFocus?(): HTMLElement | null;
};
export type RollModeButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { ref(node: HTMLButtonElement | null): void; tooltipHold?: boolean };
export type RollModeMenuBinding = {
  buttonProps: RollModeButtonProps;
  menu: ReactNode;
  open: boolean;
  /** Compose existing proficiency/route descriptions, then spread the result on the button. */
  describe(existing?: string): string | undefined;
  /** Paint-only styles. Merge after the source button's styles. No geometry changes. */
  pressStyle: CSSProperties;
};

/**
 * A scroll that moves the source cancels a press on it. An open menu stays
 * while its source is in view, as browser scroll anchoring may move the
 * panel as results land, and Popover closes it once the source leaves
 * (scrolledAway).
 */
export function handleRollModeScroll(input: { target: EventTarget | null; anchor: HTMLElement | null; open: boolean; cancel(): void }): void {
  const { target, anchor } = input;
  if (!anchor || !(target === document || target instanceof Element && target.contains(anchor))) return;
  if (input.open && !scrolledAway(target, anchor)) return;
  input.cancel();
}

/**
 * One control's part in a press binding, read as each event comes, so it
 * may change between renders: whether its menu stands open, so a press on
 * it closes it, how it opens and closes, and its element while drawn.
 */
export type RollPressControl = {
  open(): boolean;
  show(by: "pointer" | "key"): void;
  close(): void;
  node(): HTMLElement | null;
  /** A menu of its own stands open, which a scroll that keeps it in view leaves alone (handleRollModeScroll). */
  menuOpen(): boolean;
};

/** A control's own handlers from its binding. A click stays the control's, gated by `click`. */
export type RollPressHandlers = Partial<Pick<DOMAttributes<HTMLElement>, "onPointerDown" | "onTouchStart" | "onTouchEnd" | "onTouchCancel" | "onLostPointerCapture" | "onContextMenu" | "onKeyDown">>;

/**
 * The press machines of one owner's controls, by key, and the window
 * listeners they share (docs/design-v1-stat-block-rolls.md 10). A machine
 * belongs to the owner, not to its control's element, so a held press
 * outlives a control that goes while the finger is down (5.1): its
 * listeners, its consumed touch and its swallowed click stay with it. Free
 * of React, so its rules are tested with fake events.
 */
export class RollPressRegistry {
  readonly #slots = new Map<string, Slot>();
  readonly #clock: RollPressClock | undefined;
  readonly #document: () => TouchTarget;

  constructor(env: { clock?: RollPressClock; document?: TouchTarget } = {}) {
    this.#clock = env.clock;
    this.#document = () => env.document ?? document;
  }

  /** How many machines it holds, for the tests' no-leftovers rule. */
  get size(): number {
    return this.#slots.size;
  }

  /** A machine by its control's key, for the tests. */
  machine(key: string): RollPress | undefined {
    return this.#slots.get(key)?.press;
  }

  #slot(key: string): Slot {
    let slot = this.#slots.get(key);
    if (slot) return slot;
    const made: Slot = { control: IDLE, detach: null, unwatchEnd: null, touchId: null, shadow: null, press: null as unknown as RollPress };
    made.press = new RollPress({
      releaseTouch: () => clearTouch(made),
      open: () => made.control.open(),
      show: (by) => made.control.show(by),
      close: () => made.control.close(),
      hint: (on) => paintHint(made, on),
      ...(this.#clock ? { clock: this.#clock } : {}),
    });
    this.#slots.set(key, made);
    slot = made;
    return slot;
  }

  /**
   * A control's own handlers. `control` is read as each event comes, and a
   * handler finds its machine by key then, so a machine dropped while idle
   * comes back fresh.
   */
  handlers(key: string, control: RollPressControl): RollPressHandlers {
    this.#slot(key).control = control;
    const slot = () => {
      const s = this.#slot(key);
      s.control = control;
      return s;
    };
    /*
     * A touch keeps the element it started on as its target, even once that
     * element leaves the page, and then its events no longer reach the
     * document. So the consumed touch listens on the control too, and so
     * does the watch for the finger's end, which a row the swap removed
     * hears nowhere else (5.1).
     */
    const consume = (s: Slot, control: EventTarget | null) => {
      if (s.detach || s.press.activeId === null) return;
      const consumed = () => s.press.consumed;
      const offPage = attachConsumedTouch(this.#document(), consumed, s.touchId);
      const offControl = control ? attachConsumedTouch(control, consumed, s.touchId) : null;
      s.detach = () => {
        offPage();
        offControl?.();
      };
    };
    const watchEnd = (s: Slot, control: EventTarget | null) => {
      s.unwatchEnd?.();
      if (!control) return;
      const ended = (event: Event) => {
        const ids = Array.from((event as TouchEvent).changedTouches ?? [], (t) => t.identifier);
        if (s.touchId !== null && !ids.includes(s.touchId)) return;
        s.touchId = null;
        if (s.press.activeId === null) clearTouch(s);
        s.unwatchEnd?.();
      };
      control.addEventListener("touchend", ended);
      control.addEventListener("touchcancel", ended);
      s.unwatchEnd = () => {
        control.removeEventListener("touchend", ended);
        control.removeEventListener("touchcancel", ended);
        s.unwatchEnd = null;
      };
    };
    return {
      onPointerDown: (e) => {
        const s = slot();
        s.press.down({ id: e.pointerId, x: e.clientX, y: e.clientY }, e.pointerType, e.isPrimary, e.button);
        if (e.pointerType === "touch" && s.press.activeId !== null) {
          clearTouch(s);
          consume(s, e.currentTarget);
          watchEnd(s, e.currentTarget);
        }
      },
      onTouchStart: (e) => {
        const s = slot();
        s.touchId = e.changedTouches[0]?.identifier ?? null;
        consume(s, e.currentTarget);
      },
      onTouchEnd: () => {
        const s = slot();
        s.touchId = null;
        clearTouch(s);
      },
      onTouchCancel: () => {
        const s = slot();
        s.touchId = null;
        s.press.cancel();
        clearTouch(s);
      },
      onLostPointerCapture: () => {
        const s = slot();
        s.press.cancel();
        clearTouch(s);
      },
      onContextMenu: (e) => {
        e.preventDefault();
        const s = slot();
        const native = e.nativeEvent as PointerEvent;
        const touch = native.pointerType === "touch" || (native.pointerType !== "mouse" && s.press.touchSequence) || (native as PointerEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents;
        const by = touch ? "touch" : !native.pointerType && e.detail === 0 ? "key" : "mouse";
        s.press.context(by);
      },
      onKeyDown: (e) => {
        if ((e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          slot().press.context("key");
        }
      },
    };
  }

  /** A control's own click: false where the press machine swallows it, or a press on it closed its open menu. */
  click(key: string, detail: number): boolean {
    return this.#slot(key).press.click(detail);
  }

  /** Ends a control's press, as a change of its roll does. */
  cancel(key: string): void {
    const s = this.#slots.get(key);
    if (!s) return;
    s.press.cancel();
    clearTouch(s);
  }

  cancelAll(): void {
    for (const s of this.#slots.values()) {
      s.press.cancel();
      clearTouch(s);
    }
  }

  /** Drops idle machines the owner no longer keeps, once a new press or a key has spent what they held. */
  prune(keep: (key: string) => boolean): void {
    for (const [key, s] of this.#slots) {
      if (keep(key) || s.press.activeId !== null) continue;
      s.press.dispose();
      clearTouch(s);
      s.unwatchEnd?.();
      this.#slots.delete(key);
    }
  }

  /**
   * The window's and document's listeners every machine shares, in the
   * capture phase, so they run before any element's handler: a click a
   * machine swallows never reaches a control or a menu's pick. `keep`
   * names the machines kept while idle. Returns the removal.
   */
  attach(win: ListenTarget, doc: ListenTarget & { readonly hidden?: boolean }, opts: { onLeave(): void; keep?(key: string): boolean }): () => void {
    const slots = () => [...this.#slots.values()];
    const prune = () => this.prune(opts.keep ?? (() => true));
    const down = (e: Event) => {
      const { pointerId } = e as PointerEvent;
      for (const s of slots()) {
        if (s.press.activeId !== null && s.press.activeId !== pointerId) {
          s.press.cancel();
          clearTouch(s);
        } else if (s.press.activeId === null) s.press.fresh();
      }
      prune();
    };
    const move = (e: Event) => {
      const p = e as PointerEvent;
      for (const s of slots()) {
        s.press.move({ id: p.pointerId, x: p.clientX, y: p.clientY });
        if (s.press.activeId === null) clearTouch(s);
      }
    };
    const end = (e: Event) => {
      const { pointerId, type } = e as PointerEvent;
      for (const s of slots()) {
        if (s.press.activeId !== pointerId) continue;
        if (type === "pointerup") s.press.up(pointerId);
        else s.press.cancel();
        clearTouch(s);
      }
    };
    const key = () => {
      for (const s of slots()) {
        s.press.key();
        clearTouch(s);
      }
      prune();
    };
    const click = (e: Event) => {
      const m = e as MouseEvent;
      let swallowed = false;
      for (const s of slots()) if (!s.press.click(m.detail, false)) swallowed = true;
      if (swallowed) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const scroll = (e: Event) => {
      for (const s of slots()) handleRollModeScroll({ target: e.target, anchor: s.control.node(), open: s.control.menuOpen(), cancel: () => { s.press.cancel(); clearTouch(s); } });
    };
    const leave = () => {
      this.cancelAll();
      opts.onLeave();
    };
    const hidden = () => {
      if (doc.hidden) leave();
    };
    const listeners: [ListenTarget, string, (e: Event) => void, boolean][] = [
      [win, "pointerdown", down, true],
      [win, "pointermove", move, true],
      [win, "pointerup", end, true],
      [win, "pointercancel", end, true],
      [win, "keydown", key, true],
      [win, "click", click, true],
      [win, "blur", leave, false],
      [doc, "scroll", scroll, true],
      [doc, "visibilitychange", hidden, false],
    ];
    for (const [target, type, listener, capture] of listeners) target.addEventListener(type, listener, capture);
    return () => {
      this.cancelAll();
      for (const [target, type, listener, capture] of listeners) target.removeEventListener(type, listener, capture);
    };
  }

  /** Ends every press and drops every machine, its timers and its touch: the owner unmounted. */
  dispose(): void {
    for (const s of this.#slots.values()) {
      s.press.dispose();
      clearTouch(s);
      s.unwatchEnd?.();
      paintHint(s, false);
    }
    this.#slots.clear();
  }
}

type ListenTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;
type TouchTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;
type Slot = { press: RollPress; control: RollPressControl; detach: (() => void) | null; unwatchEnd: (() => void) | null; touchId: number | null; shadow: { node: HTMLElement; before: string; painted: string } | null };

const IDLE: RollPressControl = { open: () => false, show: () => undefined, close: () => undefined, node: () => null, menuOpen: () => false };

function clearTouch(s: Slot): void {
  s.detach?.();
  s.detach = null;
}

/** The held press's inset ring, paint only, so no React render runs during the hold and a proficiency border stays as it was. */
function paintHint(s: Slot, on: boolean): void {
  const node = s.control.node();
  if (on && node) {
    const before = node.style.boxShadow;
    node.style.boxShadow = [before, `inset 0 0 0 2px ${theme.color.accent}`].filter(Boolean).join(", ");
    s.shadow = { node, before, painted: node.style.boxShadow };
  } else if (s.shadow) {
    const held = s.shadow;
    // A render may have changed the proficiency frame during the hold.
    if (held.node.style.boxShadow === held.painted) held.node.style.boxShadow = held.before;
    s.shadow = null;
  }
}

/** An owner's registry, its window listeners on while `enabled`. `onLeave` hears the window blur or hide, which close its menu. `keep` names the machines kept while idle. */
export function useRollPressBinding(options: { enabled: boolean; onLeave(): void; keep?(key: string): boolean }): RollPressRegistry {
  const latest = useRef(options);
  latest.current = options;
  const registry = useRef<RollPressRegistry | null>(null);
  registry.current ??= new RollPressRegistry();
  const current = registry.current;
  const { enabled } = options;
  useEffect(() => {
    if (!enabled) return;
    return current.attach(window, document, { onLeave: () => latest.current.onLeave(), keep: (key) => latest.current.keep?.(key) ?? true });
  }, [enabled, current]);
  useEffect(() => () => current.dispose(), [current]);
  return current;
}

export function useRollModeMenu(options: UseRollModeMenuOptions): RollModeMenuBinding {
  const latest = useRef(options);
  latest.current = options;
  const openedSource = useRef<string | null>(null);
  const hintId = useId();
  const sourceGroup = useRef<HTMLElement | null>(null);
  const sourceRoot = useRef<HTMLElement | null>(null);
  const hint = rollModeHint(options.capability);
  const enabled = hasRollModeMenu(options.capability) && !options.disabled;
  const handle = usePopover({ kind: "menu", onClose: () => { openedSource.current = null; }, fallbackFocus: () => {
    if (latest.current.fallbackFocus) return latest.current.fallbackFocus();
    const group = sourceGroup.current;
    const parent = group?.isConnected ? group : sourceRoot.current;
    return parent?.isConnected ? parent.querySelector<HTMLElement>("button[data-group-fold], button:not([disabled]), [tabindex='0']") : null;
  } });
  const current = useRef(handle);
  current.current = handle;
  const presses = useRollPressBinding({ enabled, onLeave: () => current.current.close("anchor") });
  const control: RollPressControl = {
    open: () => current.current.open,
    show: (by) => {
      if (!latest.current.disabled && latest.current.valid?.() !== false) {
        openedSource.current = latest.current.source;
        current.current.show({ by, from: "first" });
      }
    },
    close: () => current.current.close("anchor"),
    node: () => current.current.anchor.current,
    menuOpen: () => openedSource.current !== null,
  };
  const handlers = presses.handlers(BUTTON, control);
  const source = options.source;
  const capabilityKey = JSON.stringify(options.capability);
  // The registry is the hook's own for its life, so only the roll's identity sets this off.
  useLayoutEffect(() => {
    presses.cancel(BUTTON);
    current.current.close("anchor");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, enabled, capabilityKey]);
  // The source stays marked while its menu is open, so the roll a finger hid is still plain to see (D-261031-079).
  useLayoutEffect(() => (handle.open ? markRollModeSource(handle.anchor.current) : undefined), [handle.open, handle.anchor]);
  // In a browser with no popovers the menu is drawn where the page draws it, so the elements that hold it rise over the bars, notices and toasts there, as before FL-17 (D-261031-088).
  useLayoutEffect(() => (handle.open ? raiseRollModeHosts(handle.anchor.current, handle.box.current) : undefined), [handle.open, handle.anchor, handle.box]);
  const describe = (existing?: string) => [existing, enabled && hint ? hintId : undefined].filter(Boolean).join(" ") || undefined;
  const buttonProps: RollModeButtonProps = {
    ref: (node) => {
      if (node) {
        sourceGroup.current = node.closest<HTMLElement>("[data-panel-group], [data-dice-panel], [data-roll-row]") ?? node.parentElement;
        sourceRoot.current = node.closest<HTMLElement>("[data-dice-panel]");
      }
      handle.anchorProps.ref(node);
    },
    onClick: (e) => { if (!latest.current.disabled && presses.click(BUTTON, e.detail)) latest.current.onTap(); },
  };
  if (enabled) Object.assign(buttonProps, {
    "aria-haspopup": "menu", "aria-expanded": handle.open, "aria-controls": handle.open ? handle.contentId : undefined,
    "aria-keyshortcuts": "ContextMenu Shift+F10", "aria-describedby": describe(), tooltipHold: false,
    ...handlers,
  });
  return {
    buttonProps, describe, open: handle.open, pressStyle: enabled ? { WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" } : {},
    menu: <>{enabled && hint ? <span hidden id={hintId}>{hint}</span> : null}{enabled ? <RollModeMenu handle={handle} name={options.name} title={handle.open ? options.title ?? rollModeTitle(handle.anchor.current?.innerText ?? "", options.name) : ""} capability={options.capability} dm={options.dm} onPick={(override) => {
      const at = latest.current;
      if (openedSource.current !== at.source) return;
      if (!rollModeItems(at.capability, at.dm).some((item) => item.id === override && !item.disabled)) return;
      const identity = at.source;
      flushSync(() => current.current.close("pick"));
      if (identity === latest.current.source && !latest.current.disabled && at.valid?.() !== false) {
        current.current.anchor.current?.dispatchEvent(new CustomEvent("rvtt-roll-mode-origin", { bubbles: true }));
        at.onRoll(override);
      }
    }} /> : null}</>,
  };
}

/**
 * The open menu's mark on its source: an accent ring just outside the
 * button's border, clear of a proficiency border or a focus outline on it.
 * Like the held press's inset ring, it is paint only, and the restore puts
 * back only the value it wrote, so a render meanwhile keeps its own.
 */
export function markRollModeSource(node: HTMLElement | null): () => void {
  if (!node) return () => undefined;
  const before = node.style.boxShadow;
  node.style.boxShadow = [before, `0 0 0 2px ${theme.color.accent}`].filter(Boolean).join(", ");
  const painted = node.style.boxShadow;
  return () => {
    if (node.style.boxShadow === painted) node.style.boxShadow = before;
  };
}

/**
 * Where the menu's box is not in the top layer, a browser with no popovers
 * (showInTopLayer), raises each positioned element that holds its anchor
 * to the popover's level, leaving one already at or above it, so overlays
 * drawn higher still stand over the menu. Puts back only the inline
 * values it wrote. With popovers it does nothing.
 */
export function raiseRollModeHosts(anchor: HTMLElement | null, box: HTMLElement | null): () => void {
  if (box && typeof box.showPopover === "function") return () => undefined;
  const hosts: { node: HTMLElement; before: string; painted: string }[] = [];
  for (let node = anchor?.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.position === "static" || (style.zIndex !== "auto" && Number(style.zIndex) >= theme.z.popover)) continue;
    const before = node.style.zIndex;
    node.style.zIndex = String(theme.z.popover);
    hosts.push({ node, before, painted: node.style.zIndex });
  }
  return () => {
    for (const host of hosts) if (host.node.style.zIndex === host.painted) host.node.style.zIndex = host.before;
  };
}
