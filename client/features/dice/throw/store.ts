import type { DiceRoll } from "#shared/model.ts";
import type { Clock } from "../../../state/timing.ts";
import { rollsOf } from "../logic.ts";
import type { ReceiptState, ReceiptTracker } from "../useReceipt.ts";
import { planTray, seededRandom, tapDice, type DieKind, type TrayPlan } from "./layout.ts";
import type { LoadState } from "./probe.ts";

/**
 * The roll animation's state for one Room (docs/design/design-v1-roll-animation.md
 * 3 to 7): which taps may throw, the throw on screen, the 1 s timer that
 * shows its result, every interruption, the warm-up, a lost context and
 * the renderer's disposal. It never imports three: the stage arrives from
 * the lazy chunk through the loader, and everything it needs from the page
 * comes in as inputs, so the rules run under plain Node.
 *
 * It decides at the commit, before React renders. The room store applies
 * the `ev`, then tells the receipt tracker in the same task, and the
 * tracker calls this store's listener at once. So by the first render after
 * the commit the throw has started or the result shows: the header line and
 * Recent rolls read `held(tag)` during that render, and a total never
 * shows for one frame and then goes.
 *
 * Each rolling surface is a host (docs/design/design-v1-token-roll-header.md
 * 4.2): the Dice panel, and each stat block's panel. A tap is bound to the
 * host it came from and throws only in that host's tray. A host's tray may
 * mount after its roll's answer: the first roll of a panel draws the
 * header line, and with it the tray. So a committed roll whose host has no
 * tray yet, or holds its rolls while it settles its scroll, waits, and the
 * host's `release()` or its tray's `attach` decides it, with the 1 s still
 * counted from the answer. The dev room's local server never answers
 * inside the send (it batches ops for 20 ms and answers on a timer), but a
 * sender may, and the store's tests drive one that does.
 *
 * The result shows by its own timer, never by the animation: 1 s after the
 * answer whatever frames the device drops or the setup takes, and at once
 * on any interruption. A stage that throws is let go for the session and
 * the result shows at once: this store runs inside the tracker's listener,
 * so an error escaping it would skip the listeners after it.
 */

/** A rolling surface's id in the store, for as long as the surface lives. */
export type ThrowHostId = number;

/** The rolling surfaces: the Dice panel, and a stat block's panel (a token's panel or a character's page). */
export type ThrowSurface = "dice" | "block";

/**
 * What a rolling control hands its roll: its host, where the tap was, and
 * when. A Dice panel origin with no host is bound to the Dice panel mounted
 * as it registers, if any. A stat block's always names its host, and its
 * element is the ability box, since the row the finger left is gone once
 * the list closes.
 */
export type ThrowOrigin =
  | { surface: "dice"; host?: ThrowHostId; element: Element | null; tapAt: number }
  | { surface: "block"; host: ThrowHostId; element: Element | null; tapAt: number };

/** The dice land this long after the answer reaches the device. */
export const LAND_MS = 1000;
/** The dice and the scrim have faded by then, and go. */
export const GONE_MS = 2100;
/** An answer this late after its tap shows at once: it has waited once already. */
export const LATE_MS = 3000;
/** "Rolling…" shows during a throw when the tap was this long before its answer, as the header line's own delayed indicator would have. */
export const ROLLING_MS = 200;
/** The renderer goes this long after the last rolling surface closes. */
export const DISPOSE_MS = 30_000;
/** A pane report this close to the host's baseline, in either direction, is no resize. */
export const RESIZE_SLOP_PX = 0.5;
/** A pointer up with no click after it within this long was a scroll or a drag, and the result shows then. */
export const CLICK_WAIT_MS = 300;
/** A control pressed this recently is the one whose roll is being sent. */
export const PRESS_MS = 1000;
/** The warm-up runs in a quiet moment, and within this long after the first rolling surface opens. */
export const WARM_MAX_MS = 1500;
/** A pane shorter than this cannot hold the header line and the tray, and shows the result at once. */
export const MIN_PANE_PX = 160;
/**
 * A result shown this recently may not have painted yet. Escape in the
 * panel shows it and closes the sheet in the same event, so the header
 * line goes before the result ever reaches the screen.
 */
export const PAINT_MS = 100;

/** The tray's place on screen, all in screen px (getBoundingClientRect's, which include the panel's zoom). */
export type TrayGeometry = {
  /** The header line's width, which the tray takes. */
  width: number;
  /** The tray and the strip below it down to the control that rolled, within the pane's visible rect. */
  height: number;
  /** The panel's zoom, the interface size's: the canvas's CSS size is the screen size divided by it. */
  zoom: number;
  /** The middle of the control that rolled, from the tray's top left corner, or null to throw from the tray's lower right. */
  from: { x: number; y: number } | null;
};

/**
 * One throw as the stage draws it. `parent` is the element its canvas hangs
 * in. `elapsed` is how long ago the answer came, in ms, as the play begins:
 * the stage counts its 1 s from the answer, on its own clock.
 */
export type StagedThrow = { tag: string; plan: TrayPlan; geometry: TrayGeometry; reduced: boolean; set: string; parent: unknown; elapsed: number };

/**
 * The stage, made by the lazy chunk. `play` draws from now: frames until
 * the dice have landed and dimmed, then none, by its own loop. `stop` takes
 * the dice away at once and ends any loop. `dispose` lets the renderer go,
 * on purpose, which never counts as a lost context.
 */
export type Stage = {
  warm(kinds: readonly DieKind[], set: string): Promise<void>;
  play(t: StagedThrow): void;
  stop(): void;
  dispose(): void;
  /** Draws each set's d20 showing 20 once into its 2D canvas, for the dice set picker. False while a throw is on screen. */
  previews?(targets: readonly PreviewTarget[], px: number): Promise<boolean>;
};

/** A picker tile's canvas and the set it shows. */
export type PreviewTarget = { set: string; canvas: HTMLCanvasElement };

/** What the stage tells the store. A loss the stage caused itself says so. */
export type StageEvents = { lost(deliberate: boolean): void; restored(): void };

export type StageModule = {
  createStage(events: StageEvents): Stage | null;
  /** The picker's previews, on the stage's renderer where there is one, else on a short-lived one. */
  drawPreviews?(targets: readonly PreviewTarget[], px: number, stage: Stage | null): Promise<boolean>;
};

/** A rolling surface as it mounts: which it is, and which dice to warm up. */
export type PanelHost = {
  /** The Dice panel when left out. */
  surface?: ThrowSurface;
  /** The kinds of the dice it rolls most, such as those in Recent rolls, so the first throw of each finds its texture drawn. */
  kinds(): DieKind[];
};

/** A pane's border box on screen, in screen px. */
export type PaneSize = { width: number; height: number };

/**
 * One rolling surface's part in the store, made by `host()` and live from
 * `mount()` to `unmount()`. Its press listeners take the dice away for the
 * whole room, as any tap does, but remember the control for this host's
 * origin alone.
 */
export type ThrowHost = {
  readonly id: ThrowHostId;
  readonly surface: ThrowSurface;
  /** Live from here: a roll from it may throw, and the warm-up may run. A host mounted again starts afresh, so a tap from before never throws. */
  mount(): void;
  /** Gone: its pending taps are dropped, and a throw or held result of its own ends and goes to the toasts. Another host's throw goes on. */
  unmount(): void;
  /**
   * The pane is shown or hidden (usePanelShown). Hidden acts as an unmount
   * for the throw: its own throw ends unseen and its pending taps are
   * dropped. The surface stays mounted.
   */
  shown(visible: boolean): void;
  /** The tray under its header line mounted. Its detach ends a throw of this host's, unseen. A host not holding its rolls decides any that wait for it at once. */
  attach(tray: TrayHost): () => void;
  /** The origin of the tap being handled now: `element` where given, else the control this host's last pointer or key went to, if that was just now. */
  origin(element?: Element | null): ThrowOrigin;
  /**
   * Holds this host's committed rolls while it settles its scroll, from
   * before its pick sends until the header line's layout effect has moved
   * everything into its final place (docs/design/design-v1-token-roll-header.md 1.2).
   */
  hold(): void;
  /** Settled: every roll of this host's that waits is decided now, measured against its tray's final place. */
  release(): void;
  /** A pointer down in the surface: the dice go at once, and the result waits for its click. */
  pointerDown(target?: Element | null): void;
  pointerUp(): void;
  pointerCancel(): void;
  click(): void;
  /** A key down in the surface ends the throw at once. */
  keyDown(target?: Element | null): void;
  /** The pane's size as its observer reports it. Within RESIZE_SLOP_PX of the baseline it is ignored, else it ends the throw and becomes the baseline. The first report is the baseline. */
  observed(size: PaneSize): void;
  /** The pane's size after a change the host made itself, such as the header line going in: the new baseline, never a resize. */
  baseline(size: PaneSize): void;
};

/**
 * The tray under a host's header line, while it is mounted. The header
 * line comes with the surface's first roll, and in the Dice panel goes
 * while the group save page shows, so it comes and goes apart from its host.
 */
export type TrayHost = {
  /** The tray for a throw from `origin`, or null where the pane is too short to hold it. */
  measure(origin: ThrowOrigin): TrayGeometry | null;
  /** Where the canvas hangs. */
  parent: unknown;
};

/** What stops or allows a throw, from the device's settings and the page. */
export type ThrowInputs = {
  /** "Roll animation" in This device. */
  on: boolean;
  lowPower: boolean;
  /** prefers-reduced-motion: the dice at rest, with the result at once. */
  reducedMotion: boolean;
  /** View as a player: a preview never warms up or throws. */
  preview: boolean;
  /** The dice set, by id. */
  set: string;
};

export type ThrowEnv = {
  clock: Clock;
  idle(cb: () => void, maxMs: number): () => void;
  tracker: Pick<ReceiptTracker, "state" | "subscribe" | "unseen">;
  loader: { loaded(): StageModule | null; state(): LoadState; subscribe(listener: () => void): () => void };
  /** The page is hidden. */
  hidden(): boolean;
};

/**
 * The throw on screen, for the tray's scrim, rings and disc. Only the tray
 * of `host`, the surface that rolled, draws them. `startedAt` is the
 * answer's time, which may be before the throw began.
 */
export type ShownThrow = { id: number; tag: string; host: ThrowHostId; plan: TrayPlan; geometry: TrayGeometry; reduced: boolean; set: string; startedAt: number };

export type ThrowView = {
  /** The tag whose result waits for the dice to land. */
  held: string | null;
  /** The header line says "Rolling…" while it waits. */
  rolling: boolean;
  shown: ShownThrow | null;
};

type Host = {
  id: ThrowHostId;
  surface: ThrowSurface;
  kinds(): DieKind[];
  mounted: boolean;
  visible: boolean;
  held: boolean;
  /** Moves on every mount, hide and unmount, so a tap made before one never throws after it. */
  era: number;
  tray: TrayHost | null;
  /** The control this host's last pointer or key went to, and when: a roll from it throws from there. */
  pressedEl: Element | null;
  pressedAt: number;
  baseline: PaneSize | null;
};

/** A tap on its way. `answeredAt` is set while its committed answer waits for its host's tray or release. */
type Pending = { origin: ThrowOrigin; host: Host | null; era: number; checked: boolean; seq: number; answeredAt: number | null };

const QUIET: ThrowView = { held: null, rolling: false, shown: null };

/** One tap, one creature: rolls for several creatures show at once. */
function oneCreature(rolls: readonly DiceRoll[]): boolean {
  const who = new Set(rolls.map((r) => r.tokenId ?? (r.characterId !== undefined ? `c:${r.characterId}` : "")));
  return who.size <= 1;
}

export class ThrowStore {
  #env: ThrowEnv | null = null;
  #inputs: ThrowInputs = { on: true, lowPower: false, reducedMotion: false, preview: false, set: "ivory" };
  #view: ThrowView = QUIET;
  #listeners = new Set<() => void>();
  #pending = new Map<string, Pending>();
  #unsubscribe: (() => void)[] = [];

  /** The mounted hosts. */
  #hosts = new Set<Host>();
  #hostIds = 0;
  /** The host whose throw is on screen or whose result is held, while one is. */
  #throwHost: ThrowHostId | null = null;
  #stage: Stage | null = null;
  #stageEvents: StageEvents | null = null;
  #warm: "cold" | "warming" | "warm" = "cold";
  /** Moves whenever a warm-up under way stops counting. */
  #warmRun = 0;
  #cancelIdle: (() => void) | null = null;
  #losses = 0;
  /** A real loss not yet restored: nothing warms up on a lost context. */
  #contextLost = false;
  /** The stage could not be made: no WebGL for the session. */
  #noStage = false;
  #seq = 0;

  #throwId = 0;
  #timers: unknown[] = [];
  #disposeTimer: unknown = null;
  #clickTimer: unknown = null;
  /** A pointer took the dice away, and the result waits for its click. */
  #pressed = false;
  /** The tag whose held result was let go less than PAINT_MS ago, and may not be on screen yet, and its host. */
  #unpainted: string | null = null;
  #unpaintedHost: ThrowHostId | null = null;
  #unpaintedTimer: unknown = null;

  /** Binds the store to its Room, once. */
  bind(env: ThrowEnv): void {
    if (this.#env) return;
    this.#env = env;
    this.#unsubscribe.push(env.tracker.subscribe(() => this.#check()));
    this.#unsubscribe.push(env.loader.subscribe(() => this.#maybeWarm()));
  }

  get bound(): boolean {
    return this.#env !== null;
  }

  /** Real context losses so far: after two, no throws for the session. */
  get lostContexts(): number {
    return this.#losses;
  }

  // ------------------------------------------------------------ what React reads

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  view = (): ThrowView => this.#view;

  /** The store's clock, which a throw's `startedAt` is read on. */
  now(): number {
    return this.#env?.clock.now() ?? 0;
  }

  /** Whether this tag's result waits for the dice: the header line and Recent rolls leave it out until they land. */
  held(tag: string | null): boolean {
    return tag !== null && this.#view.held === tag;
  }

  /** The stage, once made, for the dice set picker's previews. None while its context is lost: it would copy blank pictures. */
  get stage(): Stage | null {
    return this.#contextLost ? null : this.#stage;
  }

  /** Whether the picker may draw its previews at all: never on a lost context, after two losses, or where no stage could be made. */
  get previewsAllowed(): boolean {
    return !this.#contextLost && this.#losses < 2 && !this.#noStage;
  }

  #set(view: ThrowView): void {
    if (view.held === this.#view.held && view.rolling === this.#view.rolling && view.shown === this.#view.shown) return;
    this.#view = view;
    for (const listener of [...this.#listeners]) listener();
  }

  // ------------------------------------------------------------ inputs

  setInputs(patch: Partial<ThrowInputs>): void {
    const before = this.#inputs;
    this.#inputs = { ...before, ...patch };
    const now = this.#inputs;
    // Reduced motion on ends a throw at once.
    if (now.reducedMotion && !before.reducedMotion) this.#end();
    // Turning the dice off, Low power on or a preview also lets the renderer go, and any warm-up on its way.
    if ((!now.on && before.on) || (now.lowPower && !before.lowPower) || (now.preview && !before.preview)) {
      this.#end();
      this.#dispose();
    }
    // A new set's textures are drawn ahead of its first throw. The stage stays warm meanwhile: the old set's shaders already run.
    if (now.set !== before.set && this.#warm === "warm" && this.#stage) this.#warmSet(this.#stage, now.set);
    this.#maybeWarm();
  }

  /** Draws a new set's textures in a quiet moment, never over a throw on screen, whose pooled dice the warm-up would relabel. */
  #warmSet(stage: Stage, set: string): void {
    this.#env?.idle(() => {
      if (this.#stage !== stage || this.#inputs.set !== set || !this.#allowed()) return;
      if (this.#view.shown) {
        this.#warmSet(stage, set);
        return;
      }
      this.#safely((s) => void s.warm(this.#kinds(), set).then(undefined, () => undefined));
    }, WARM_MAX_MS);
  }

  get inputs(): ThrowInputs {
    return this.#inputs;
  }

  #allowed(): boolean {
    const i = this.#inputs;
    return i.on && !i.lowPower && !i.preview && !this.#noStage && this.#losses < 2 && this.#env?.loader.state() === "ready";
  }

  // ------------------------------------------------------------ the hosts

  /**
   * A rolling surface's host, not yet mounted. Making one changes nothing,
   * so a component may make its host as it first renders, and its tray,
   * which attaches in a child's layout effect, finds it before it mounts.
   */
  host(spec: PanelHost): ThrowHost {
    const host: Host = { id: ++this.#hostIds, surface: spec.surface ?? "dice", kinds: () => spec.kinds(), mounted: false, visible: true, held: false, era: 0, tray: null, pressedEl: null, pressedAt: Number.NEGATIVE_INFINITY, baseline: null };
    return {
      id: host.id,
      surface: host.surface,
      mount: () => this.#mountHost(host),
      unmount: () => this.#unmountHost(host),
      shown: (visible) => this.#shownHost(host, visible),
      attach: (tray) => this.#attach(host, tray),
      origin: (element) => this.#originOf(host, element),
      hold: () => {
        host.held = true;
      },
      release: () => {
        host.held = false;
        this.#check();
      },
      pointerDown: (target = null) => this.#pointerDown(host, target),
      pointerUp: () => this.#pointerUp(),
      pointerCancel: () => this.#release(),
      click: () => this.#release(),
      keyDown: (target = null) => {
        this.#press(host, target);
        this.#end();
      },
      observed: (size) => {
        const before = host.baseline;
        host.baseline = size;
        if (before && (Math.abs(before.width - size.width) > RESIZE_SLOP_PX || Math.abs(before.height - size.height) > RESIZE_SLOP_PX)) this.resized();
      },
      baseline: (size) => {
        host.baseline = size;
      },
    };
  }

  /** A host made and mounted at once. */
  mount(spec: PanelHost): ThrowHost {
    const host = this.host(spec);
    host.mount();
    return host;
  }

  #mountHost(host: Host): void {
    const env = this.#env;
    if (host.mounted) return;
    host.mounted = true;
    host.era++;
    this.#hosts.add(host);
    if (this.#disposeTimer !== null && env) env.clock.clearTimeout(this.#disposeTimer);
    this.#disposeTimer = null;
    this.#maybeWarm();
  }

  /** The last host's unmount stops a warm-up and starts the renderer's 30 s. */
  #unmountHost(host: Host): void {
    const env = this.#env;
    if (!host.mounted) return;
    host.mounted = false;
    host.era++;
    this.#hosts.delete(host);
    this.#dropPending(host);
    this.#endFor(host);
    if (this.#hosts.size > 0) return;
    this.#stopWarming();
    if (this.#stage && env) this.#disposeTimer = env.clock.setTimeout(() => this.#dispose(), DISPOSE_MS);
  }

  #shownHost(host: Host, visible: boolean): void {
    if (host.visible === visible) return;
    host.visible = visible;
    if (visible) return;
    host.era++;
    this.#dropPending(host);
    this.#endFor(host);
  }

  #attach(host: Host, tray: TrayHost): () => void {
    host.tray = tray;
    if (!host.held) this.#check();
    return () => {
      if (host.tray !== tray) return;
      host.tray = null;
      this.#endFor(host);
    };
  }

  #dropPending(host: Host): void {
    for (const [tag, pending] of [...this.#pending]) if (pending.host === host) this.#pending.delete(tag);
  }

  /** The mounted Dice panel, which a Dice panel origin with no host names. */
  #diceHost(): Host | null {
    for (const host of this.#hosts) if (host.surface === "dice") return host;
    return null;
  }

  #mounted(id: ThrowHostId): Host | null {
    for (const host of this.#hosts) if (host.id === id) return host;
    return null;
  }

  /** A roll from a rolling control, with its origin. A newer roll ends the throw on screen, whichever surface it came from. */
  register(tag: string, origin: ThrowOrigin): void {
    const host = origin.host !== undefined ? this.#mounted(origin.host) : origin.surface === "dice" ? this.#diceHost() : null;
    this.#end();
    // A few taps are in flight at most. An old one that never settled is forgotten.
    if (this.#pending.size > 20) this.#pending.delete(this.#pending.keys().next().value!);
    this.#pending.set(tag, { origin, host, era: host?.era ?? -1, checked: false, seq: ++this.#seq, answeredAt: null });
    // An answer that came inside the send is this tap's commit.
    this.#check();
  }

  /**
   * The origin of the Dice panel tap being handled now: the control its
   * pointer or key went to, if that was just now, so the dice leave from
   * there. With a host's id, that host's instead.
   */
  origin(host?: ThrowHostId): ThrowOrigin {
    const of = host === undefined ? this.#diceHost() : this.#mounted(host);
    if (of) return this.#originOf(of);
    return { surface: "dice", element: null, tapAt: this.#env?.clock.now() ?? 0 };
  }

  #originOf(host: Host, element?: Element | null): ThrowOrigin {
    const now = this.#env?.clock.now() ?? 0;
    const el = element !== undefined ? element : now - host.pressedAt < PRESS_MS ? host.pressedEl : null;
    return host.surface === "block" ? { surface: "block", host: host.id, element: el, tapAt: now } : { surface: "dice", host: host.id, element: el, tapAt: now };
  }

  #press(host: Host, target: Element | null): void {
    host.pressedEl = target;
    host.pressedAt = this.#env?.clock.now() ?? 0;
  }

  /** A pointer down anywhere in a surface takes the dice away. Its click shows the result, after the browser has chosen what it lands on. */
  #pointerDown(host: Host, target: Element | null): void {
    this.#press(host, target);
    if (this.#view.held !== null) this.#pressed = true;
    if (!this.#view.shown) return;
    this.#safely((stage) => stage.stop());
    this.#set({ ...this.#view, shown: null });
  }

  /** A pointer up with no click soon after was a scroll or a drag. */
  #pointerUp(): void {
    const env = this.#env;
    if (!this.#pressed || !env) return;
    if (this.#clickTimer !== null) env.clock.clearTimeout(this.#clickTimer);
    this.#clickTimer = env.clock.setTimeout(() => this.#release(), CLICK_WAIT_MS);
  }

  /** A pane changed size: a rotation, a split moved, a sheet dragged, the keyboard. It ends the throw from any host. */
  resized(): void {
    this.#end();
  }

  visibility(hidden: boolean): void {
    if (hidden) {
      this.#end();
      this.#dispose();
    } else this.#maybeWarm();
  }

  /**
   * The Room went away. React's development double mount disposes a Room
   * and then keeps using it, so the store is left unbound, and the next
   * render binds it again.
   */
  dispose(): void {
    this.#end();
    this.#dispose();
    if (this.#unpaintedTimer !== null) this.#env?.clock.clearTimeout(this.#unpaintedTimer);
    this.#unpaintedTimer = null;
    this.#unpainted = null;
    this.#unpaintedHost = null;
    for (const stop of this.#unsubscribe) stop();
    this.#unsubscribe = [];
    this.#pending.clear();
    for (const host of this.#hosts) {
      host.mounted = false;
      host.era++;
    }
    this.#hosts.clear();
    this.#env = null;
  }

  // ------------------------------------------------------------ deciding at the commit

  #check(): void {
    const env = this.#env;
    if (!env) return;
    for (const [tag, pending] of [...this.#pending]) {
      const state = env.tracker.state(tag);
      if (!state || state.state === "sending") continue;
      // A lookup settles it after a reconnect: that answer is late already.
      if (state.state === "checking") {
        pending.checked = true;
        continue;
      }
      if (state.state === "committed" && this.#waits(pending)) {
        pending.answeredAt ??= env.clock.now();
        continue;
      }
      this.#pending.delete(tag);
      if (state.state === "committed") this.#committed(tag, pending, state);
    }
  }

  /**
   * A committed roll waits while its host is live but holds its rolls or
   * has no tray yet, as on a surface's first roll, whose tray mounts with
   * the header line after the answer. Not past its 1 s, nor past its tap's 3 s.
   */
  #waits(pending: Pending): boolean {
    const host = pending.host;
    if (!host || !host.mounted || !host.visible || pending.era !== host.era || pending.checked) return false;
    if (!host.held && host.tray) return false;
    const now = this.#env!.clock.now();
    if (now - pending.origin.tapAt > LATE_MS) return false;
    return pending.answeredAt === null || now - pending.answeredAt < LAND_MS;
  }

  #committed(tag: string, pending: Pending, state: Extract<ReceiptState, { state: "committed" }>): void {
    const env = this.#env!;
    const now = env.clock.now();
    // The deadlines count from the answer, which a roll that waited for its tray came before now.
    const answered = pending.answeredAt ?? now;
    const host = pending.host;
    const tray = host?.tray ?? null;
    if (!this.#allowed() || this.#warm !== "warm" || !this.#stage) return;
    if (!host || !tray || !host.mounted || !host.visible || host.held || pending.era !== host.era || pending.checked || env.hidden()) return;
    if (now - pending.origin.tapAt > LATE_MS || now - answered >= LAND_MS) return;
    // A newer tap is on its way, and would end this throw as soon as it began.
    if ([...this.#pending.values()].some((p) => p.seq > pending.seq)) return;
    const rolls = rollsOf(state.lines);
    if (rolls.length === 0 || !oneCreature(rolls)) return;
    const dice = tapDice(rolls);
    if (!dice) return;
    let geometry: TrayGeometry | null;
    try {
      geometry = tray.measure(pending.origin);
    } catch {
      geometry = null;
    }
    if (!geometry) return;
    const reduced = this.#inputs.reducedMotion;
    const plan = planTray(dice, geometry.width, seededRandom(tag));
    this.#clearTimers();
    this.#pressed = false;
    const shown: ShownThrow = { id: ++this.#throwId, tag, host: host.id, plan, geometry, reduced, set: this.#inputs.set, startedAt: answered };
    const played = this.#safely((stage) => {
      stage.stop();
      stage.play({ tag, plan, geometry, reduced, set: this.#inputs.set, parent: tray.parent, elapsed: env.clock.now() - answered });
    });
    if (!played) return;
    this.#throwHost = host.id;
    // A slow setup, or a wait for the tray, never delays the result.
    const spent = env.clock.now() - answered;
    // Under reduced motion the dice are drawn once, at rest, and the result shows at once.
    if (reduced) this.#set({ held: null, rolling: false, shown });
    else {
      this.#set({ held: tag, rolling: answered - pending.origin.tapAt >= ROLLING_MS, shown });
      this.#timers.push(env.clock.setTimeout(() => this.#release(), Math.max(0, LAND_MS - spent)));
    }
    this.#timers.push(env.clock.setTimeout(() => this.#gone(shown.id), Math.max(0, GONE_MS - spent)));
  }

  // ------------------------------------------------------------ ending

  /** The result shows. The dice stay to fade, unless a pointer took them. */
  #release(): void {
    const env = this.#env;
    if (this.#clickTimer !== null && env) env.clock.clearTimeout(this.#clickTimer);
    this.#clickTimer = null;
    this.#pressed = false;
    if (this.#view.held !== null) this.#letGo(this.#view.held);
    if (this.#view.held !== null || this.#view.rolling) this.#set({ ...this.#view, held: null, rolling: false });
  }

  /** The dice have faded. */
  #gone(id: number): void {
    if (this.#view.shown?.id !== id) return;
    this.#safely((stage) => stage.stop());
    this.#set({ ...this.#view, shown: null });
  }

  /** Ends the throw at once: the result shows and the dice go without fading. */
  #end(): void {
    const env = this.#env;
    this.#clearTimers();
    if (this.#clickTimer !== null && env) env.clock.clearTimeout(this.#clickTimer);
    this.#clickTimer = null;
    this.#pressed = false;
    if (this.#view.held !== null) this.#letGo(this.#view.held);
    if (this.#view.shown) this.#safely((stage) => stage.stop());
    this.#throwHost = null;
    this.#set(QUIET);
  }

  /** A held result is let go, and stays `unpainted` until it has had time to reach the screen. */
  #letGo(tag: string): void {
    const env = this.#env;
    if (!env) return;
    this.#unpainted = tag;
    this.#unpaintedHost = this.#throwHost;
    if (this.#unpaintedTimer !== null) env.clock.clearTimeout(this.#unpaintedTimer);
    this.#unpaintedTimer = env.clock.setTimeout(() => {
      this.#unpainted = null;
      this.#unpaintedHost = null;
      this.#unpaintedTimer = null;
    }, PAINT_MS);
  }

  /**
   * Ends a host's own throw as its header line goes: with the surface, for
   * the group save page, or as its pane hides. A result still held as its
   * dice fly was never seen, nor was one let go too recently to have
   * painted, such as by the Escape that closes the sheet. It goes to the
   * toasts, as a roll whose surface closed before its answer does. Another
   * host's throw goes on.
   */
  #endFor(host: Host): void {
    if (this.#throwHost === host.id && (this.#view.held !== null || this.#view.shown !== null)) this.#end();
    if (this.#unpaintedHost !== host.id) return;
    const tag = this.#unpainted;
    this.#unpainted = null;
    this.#unpaintedHost = null;
    if (tag !== null) this.#env?.tracker.unseen(tag);
  }

  #clearTimers(): void {
    const env = this.#env;
    if (env) for (const t of this.#timers) env.clock.clearTimeout(t);
    this.#timers = [];
  }

  // ------------------------------------------------------------ warm-up, loss and disposal

  /** The dice the mounted hosts roll, so the first throw of each finds its texture drawn. */
  #kinds(): DieKind[] {
    const kinds = new Set<DieKind>();
    for (const host of this.#hosts) for (const kind of host.kinds()) kinds.add(kind);
    return kinds.size > 0 ? [...kinds] : ["d20", "d6"];
  }

  #maybeWarm(): void {
    const env = this.#env;
    if (!env || this.#warm !== "cold" || this.#contextLost || this.#hosts.size === 0 || !this.#allowed() || env.hidden()) return;
    const module = env.loader.loaded();
    if (!module) return;
    const run = ++this.#warmRun;
    this.#warm = "warming";
    this.#cancelIdle = env.idle(() => {
      this.#cancelIdle = null;
      if (run !== this.#warmRun) return;
      // The settings or the page may have changed while the callback waited.
      if (this.#hosts.size === 0 || !this.#allowed() || this.#contextLost || env.hidden()) {
        this.#warm = "cold";
        return;
      }
      if (!this.#stage) {
        const events: StageEvents = { lost: (deliberate) => this.#lost(events, deliberate), restored: () => this.#restored(events) };
        this.#stageEvents = events;
        try {
          this.#stage = module.createStage(events);
        } catch {
          this.#stage = null;
        }
        if (!this.#stage) {
          this.#noStage = true;
          this.#warm = "cold";
          return;
        }
      }
      const set = this.#inputs.set;
      this.#safely((stage) =>
        stage.warm(this.#kinds(), set).then(
          () => {
            if (run !== this.#warmRun) return;
            this.#warm = "warm";
            // A set picked while this ran missed setInputs' warm-up, which waits for a warm stage.
            if (this.#inputs.set !== set && this.#stage === stage) this.#warmSet(stage, this.#inputs.set);
          },
          () => {
            if (run === this.#warmRun) this.#warm = "cold";
          },
        ),
      );
    }, WARM_MAX_MS);
  }

  #stopWarming(): void {
    this.#warmRun++;
    this.#cancelIdle?.();
    this.#cancelIdle = null;
    if (this.#warm === "warming") this.#warm = "cold";
  }

  #lost(from: StageEvents, deliberate: boolean): void {
    if (deliberate || from !== this.#stageEvents) return;
    this.#losses++;
    this.#contextLost = true;
    this.#end();
    this.#stopWarming();
    this.#warm = "cold";
  }

  #restored(from: StageEvents): void {
    if (from !== this.#stageEvents) return;
    this.#contextLost = false;
    this.#maybeWarm();
  }

  #dispose(): void {
    const env = this.#env;
    if (this.#disposeTimer !== null && env) env.clock.clearTimeout(this.#disposeTimer);
    this.#disposeTimer = null;
    this.#stopWarming();
    this.#warm = "cold";
    const stage = this.#stage;
    if (!stage) return;
    // Never while a throw runs: every caller has ended it first.
    if (this.#view.shown) this.#end();
    this.#stage = null;
    this.#stageEvents = null;
    this.#contextLost = false;
    try {
      stage.dispose();
    } catch {
      // Going anyway: nothing of it is used again.
    }
  }

  /**
   * Runs a call on the stage. One that throws, such as a texture drawn
   * where iOS Safari has no canvas memory left, lets the stage go for the
   * session, and any throw ends with its result shown. False then.
   *
   * The error goes to the console, since the page only shows the dice
   * stop, never why. It is logged once: no stage comes back after it.
   */
  #safely(call: (stage: Stage) => unknown): boolean {
    const stage = this.#stage;
    if (!stage) return false;
    try {
      call(stage);
      return true;
    } catch (error) {
      console.warn("raccoon: the dice stage failed and is off for this session", error);
      this.#noStage = true;
      this.#clearTimers();
      this.#pressed = false;
      this.#set(QUIET);
      this.#dispose();
      return false;
    }
  }
}
