import "../../components/testing/register.ts";
import type { AbilityRow } from "./blockRolls.ts";
import type { AbilityMenuEnv, AbilityView } from "./useAbilityMenu.tsx";
import type { RollModeOverride } from "./rollMode.ts";

/*
 * A box with its list as the page runs it, for the ability menu's tests
 * (docs/design-v1-stat-block-rolls.md 3.3 and 5): the real control and
 * press registry, with fake window, document and clock, and gestures that
 * fire the browser's events in its order: the window's capture listeners
 * first, then the element's handlers, then its click.
 */

const { AbilityMenuControl, BOX, rowPress } = await import("./useAbilityMenu.tsx");
const { RollPressRegistry } = await import("./useRollModeMenu.tsx");
const { backStep } = await import("../../components/Popover.tsx");

/** A window or document: its listeners by type, counted, and events fired at all of them. */
export class Target {
  readonly listeners = new Map<string, Set<(e: Event) => void>>();
  hidden = false;
  addEventListener(type: string, fn: (e: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, fn: (e: Event) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  get count(): number {
    return [...this.listeners.values()].reduce((n, set) => n + set.size, 0);
  }
  fire(type: string, props: Record<string, unknown> = {}): Event {
    const e = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(props)) Object.defineProperty(e, key, { value });
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
    return e;
  }
}

export class Clock {
  now = 0;
  #seq = 0;
  readonly timers = new Map<number, { at: number; run(): void }>();
  set = (run: () => void, ms: number) => {
    const id = ++this.#seq;
    this.timers.set(id, { at: this.now + ms, run });
    return id;
  };
  clear = (id: unknown) => {
    this.timers.delete(id as number);
  };
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      this.now = next[1].at;
      this.timers.delete(next[0]);
      next[1].run();
    }
    this.now = end;
  }
}

const capability = { d20: true, visibility: "selectable" as const };
export function row(id: string, over: Partial<AbilityRow> = {}): AbilityRow {
  return { id, kind: "save", test: { kind: "save", ability: "dex" }, words: id, bonus: 2, bonusText: "+2", tag: "", route: "roll", capability, rowKey: `c:x|${id}`, source: `${id}@1`, name: id, title: `Dexterity ${id} +2`, label: id, preset: { sources: [], extra: [], notes: [] }, ...over };
}

type Point = "box" | `row:${string}` | `choice:${RollModeOverride}` | "outside";

/**
 * One box with its list, as the page runs it. The popover's open state,
 * its drawn view and where focus is are modeled, and each gesture fires
 * the events a browser fires, in its order.
 */
export function harness(rows: AbilityRow[] = [row("check", { kind: "check" }), row("save"), row("stealth", { kind: "skill" }), row("ask", { route: "ask", capability: null })]) {
  const win = new Target();
  const doc = new Target();
  const clock = new Clock();
  const log = { rolls: [] as [string, RollModeOverride | undefined][], shows: [] as string[], closes: [] as string[] };
  const state = { open: false, drawn: { kind: "list" } as AbilityView, focus: "page", blocked: null as string | null, busy: new Set<string>(), mounted: true };
  /** The page's elements, each an event target, so a touch's events go to the element it started on, as a browser sends them. */
  const nodes = new Map<string, Target & { style: { boxShadow: string }; focus(): void; getBoundingClientRect(): unknown }>();
  const node = (name: string) => {
    let n = nodes.get(name);
    if (!n) {
      // A press's ring is painted on the element's own style, which starts empty.
      const style = {} as { boxShadow: string };
      style.boxShadow = "";
      n = Object.assign(new Target(), { style, focus: () => void (state.focus = name), getBoundingClientRect: () => ({ left: 10, top: 10, right: 54, bottom: 54 }) });
      nodes.set(name, n);
    }
    return n;
  };
  const el = (name: string) => node(name) as unknown as HTMLElement;
  const registry = new RollPressRegistry({ clock, document: doc });
  const drawnRow = (id: string) => state.open && state.drawn.kind === "list" && rows.some((r) => r.id === id);
  const env: AbilityMenuEnv = {
    isOpen: () => state.open,
    show: (how) => {
      state.open = true;
      log.shows.push(how.by);
      state.focus = how.by === "key" ? (state.drawn.kind === "options" ? "choice:adv" : `row:${how.from === "last" ? rows.at(-1)!.id : rows[0]!.id}`) : "box";
    },
    close: (reason) => {
      if (!state.open) return;
      state.open = false;
      log.closes.push(reason);
      control.closed();
      state.drawn = { kind: "list" };
      if (reason !== "press" && reason !== "tab") state.focus = "box";
    },
    box: () => el("box"),
    row: (id) => (drawnRow(id) ? el(`row:${id}`) : null),
    focusInside: (from) => void (state.focus = state.drawn.kind === "options" ? "choice:adv" : `row:${from === "last" ? rows.at(-1)!.id : rows[0]!.id}`),
    focusRow: (id) => void (state.focus = `row:${id}`),
    focusedInside: () => state.open && (state.focus.startsWith("row:") || state.focus.startsWith("choice:")),
    draw: (view) => void (state.drawn = view),
    rows: () => rows,
    blocked: () => state.blocked,
    busy: (r) => state.busy.has(r.rowKey),
    dm: () => false,
    roll: (r, override) => void log.rolls.push([r.id, override]),
  };
  const control = new AbilityMenuControl(env, registry);
  const detach = registry.attach(win, doc, { onLeave: () => env.close("anchor"), keep: (key) => control.keeps(key) });
  const handlers = (at: Point) => {
    if (at === "box") return registry.handlers(BOX, control.boxControl);
    if (at.startsWith("row:")) {
      const id = at.slice(4);
      const r = rows.find((x) => x.id === id);
      return drawnRow(id) && r?.capability ? registry.handlers(rowPress(id), control.rowControl(id)) : {};
    }
    return {};
  };
  /** What a press at a place lands on now: a row the swap removed leaves its place to the choice drawn there. */
  const at = (point: Point): Point => {
    if (point.startsWith("row:") && !drawnRow(point.slice(4))) return state.open && state.drawn.kind === "options" ? "choice:adv" : "outside";
    if (point.startsWith("choice:") && !(state.open && state.drawn.kind === "options")) return "outside";
    return point;
  };
  let pointer = 0;
  let pressed: { id: number; point: Point; touch: boolean; started: Point } | null = null;
  /** Whether an element is in the page now, so its events reach the document and React runs its handlers. */
  const attached = (point: Point) => point === "box" || at(point) === point;
  /** A touch event on the element the touch started on, and on the document while that element is in the page or for a touch on no control. */
  const touchEvent = (type: string, started: Point, id: number): boolean => {
    const props = { changedTouches: [{ identifier: id }] };
    let prevented = false;
    if (started === "outside" || attached(started)) prevented = doc.fire(type, props).defaultPrevented;
    if (started !== "outside") prevented = node(started).fire(type, props).defaultPrevented || prevented;
    return prevented;
  };

  const reactEvent = (props: Record<string, unknown>) => ({ preventDefault() {}, defaultPrevented: false, ...props }) as never;
  /** The element's own click, as its handler or Menu's pick takes it. */
  const elementClick = (point: Point, detail: number) => {
    if (point === "box") control.boxClick(detail);
    else if (point.startsWith("row:")) {
      const r = rows.find((x) => x.id === point.slice(4))!;
      if (state.blocked !== null || state.busy.has(r.rowKey)) return;
      control.pickRow(r.id);
      env.close("pick");
    } else if (point.startsWith("choice:")) {
      control.pickChoice(point.slice(7) as RollModeOverride);
      env.close("pick");
    }
  };
  const api = {
    /** A pointer is down. */
    pressing: () => pressed !== null,
    /** The finger down now, if any. */
    finger: () => pressed?.id ?? null,
    control,
    registry,
    clock,
    log,
    state,
    win,
    doc,
    /** A pointer goes down: a touch's finger or a mouse's left button. */
    down(point: Point, touch = true, opts: { second?: boolean } = {}) {
      if (!state.mounted) return;
      // One finger at a time, unless a second is asked for: the one down lifts first, with no click.
      if (pressed && !opts.second) api.up(false);
      const id = ++pointer;
      const e = { pointerId: id, clientX: 0, clientY: 0, pointerType: touch ? "touch" : "mouse", isPrimary: !opts.second, button: 0 };
      win.fire("pointerdown", e);
      const target = at(point);
      if (target.startsWith("row:") || target === "box") state.focus = target === "box" ? state.focus : target;
      const currentTarget = target === "outside" ? null : node(target);
      handlers(target).onPointerDown?.(reactEvent({ ...e, currentTarget }));
      if (touch) {
        touchEvent("touchstart", target, id);
        handlers(target).onTouchStart?.(reactEvent({ changedTouches: [{ identifier: id }], currentTarget }));
      }
      // A press outside the open list and its box closes it, as the popover's room rule does.
      if (target === "outside" && state.open) env.close("press");
      pressed = { id, point: target, touch, started: target };
    },
    /** The finger drags: whether the browser was kept from scrolling. */
    move(dx: number): boolean {
      if (!pressed) return false;
      win.fire("pointermove", { pointerId: pressed.id, clientX: dx, clientY: 0 });
      if (!pressed.touch) return false;
      return touchEvent("touchmove", pressed.started, pressed.id);
    },
    /** The pointer lifts, and its click lands where it lifted, if the browser sends one. */
    up(click = true) {
      if (!pressed) return;
      const { id, point, touch, started } = pressed;
      pressed = null;
      win.fire("pointerup", { pointerId: id });
      if (touch) {
        if (attached(started)) handlers(started).onTouchEnd?.(reactEvent({}));
        touchEvent("touchend", started, id);
      }
      if (click) api.click(point, 1);
    },
    cancel() {
      if (!pressed || !state.mounted) return;
      win.fire("pointercancel", { pointerId: pressed.id });
      pressed = null;
    },
    /** A click at a place: `detail` 1 from a pointer, 0 from a key or a screen reader's activation. */
    click(point: Point, detail: number) {
      if (!state.mounted) return;
      const target = at(point);
      const e = win.fire("click", { detail });
      if (!e.defaultPrevented) elementClick(target, detail);
    },
    tap(point: Point, touch = true) {
      api.down(point, touch);
      api.up();
    },
    hold(point: Point, ms = 500) {
      api.down(point);
      clock.advance(ms);
    },
    /** A right-click: its button-2 press, then the context menu event, and no click. */
    rightClick(point: Point) {
      if (!state.mounted) return;
      win.fire("pointerdown", { pointerId: ++pointer, pointerType: "mouse", button: 2 });
      win.fire("pointerup", { pointerId: pointer });
      handlers(at(point)).onContextMenu?.(reactEvent({ nativeEvent: { pointerType: "mouse" }, detail: 1 }));
    },
    /** A key on what holds focus: the window's listeners, the element's, then Menu's or the popover's. */
    key(key: string, shiftKey = false) {
      if (!state.mounted) return;
      win.fire("keydown", { key });
      const e = { key, shiftKey, ctrlKey: false, altKey: false, metaKey: false, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; } };
      if (key === "Escape") {
        if (state.open && backStep("escape", (reason) => control.stepBack(reason)) === "close") env.close("escape");
        return;
      }
      const focus = state.focus as Point;
      if (focus === "box") {
        handlers("box").onKeyDown?.(e as never);
        control.boxKey(e);
        if (!e.defaultPrevented && (key === "Enter" || key === " ")) api.click("box", 0);
      } else if (focus.startsWith("row:") || focus.startsWith("choice:")) {
        handlers(focus).onKeyDown?.(e as never);
        if (!e.defaultPrevented && (key === "Enter" || key === " ")) elementClick(at(focus), 0);
      }
    },
    back() {
      if (state.mounted && state.open && backStep("back", (reason) => control.stepBack(reason)) === "close") env.close("back");
    },
    /** The page scrolls, the box still in view: a press on it ends, an open list stays (handleRollModeScroll). */
    scroll() {
      const previous = { document: globalThis.document, window: globalThis.window, Element: globalThis.Element };
      Object.assign(globalThis, { document: doc, window: { innerWidth: 400, innerHeight: 800 }, Element: class {} });
      try {
        doc.fire("scroll", { target: doc });
      } finally {
        Object.assign(globalThis, previous);
      }
    },
    leave() {
      win.fire("blur");
    },
    unmount() {
      // The page's elements go with it, so no handler of theirs runs after this.
      pressed = null;
      env.close("gone");
      detach();
      registry.dispose();
      state.mounted = false;
    },
    rows,
  };
  return api;
}
