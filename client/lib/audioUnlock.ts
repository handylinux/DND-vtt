/**
 * Unlocking Web Audio from a gesture the browser accepts.
 *
 * The HTML spec counts only some events as a user activation. For a mouse
 * that is pointerdown. For touch and pen it is pointerup and touchend, never
 * pointerdown, so an unlock that waits for pointerdown never runs on an
 * iPhone. Keyboards count on keydown, except Escape, which browsers leave
 * out. One helper holds those rules so the turn chime and the ping sound
 * cannot drift apart again.
 */

/** The few members of an AudioContext the helper uses. `interrupted` is Safari's state after a call or a lock. */
export interface UnlockableContext {
  readonly state: string;
  resume(): Promise<void>;
  addEventListener?(type: "statechange", listener: () => void): void;
  removeEventListener?(type: "statechange", listener: () => void): void;
}

/** The members of a gesture event the rules read. */
export interface GestureEvent {
  readonly type: string;
  readonly pointerType?: string;
  readonly key?: string;
}

/** Event names the helper listens for, in the order a touch tap fires them. */
export const UNLOCK_EVENTS = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;

/** Whether this event is one the browser counts as a user activation. */
export function countsAsActivation(e: GestureEvent): boolean {
  switch (e.type) {
    case "pointerdown":
      return e.pointerType === "mouse";
    case "pointerup":
      return e.pointerType !== "mouse";
    case "touchend":
    case "click":
      return true;
    case "keydown":
      return e.key !== "Escape";
    default:
      return false;
  }
}

export interface AudioUnlock {
  /**
   * The context, created on first use. It runs inside the gesture's handler,
   * because a context made or resumed later is not covered by the activation.
   */
  context: () => UnlockableContext | null;
  /** False leaves the gesture alone and keeps listening. Defaults to always. */
  wanted?: () => boolean;
  /** Where gestures arrive. Defaults to the window. */
  target?: EventTarget;
}

/**
 * Keeps trying to bring the context to `running` on each accepted gesture,
 * and stops listening once it runs. A context that later leaves `running`
 * (Safari's `interrupted`, or `suspended` after the tab was hidden), and a
 * page restored from the back-forward cache (`pageshow`), start the
 * listening again. Returns the cleanup for an effect.
 */
export function armAudioUnlock(options: AudioUnlock): () => void {
  const target = options.target ?? window;
  const wanted = options.wanted ?? (() => true);
  let armed = false;
  let watched: UnlockableContext | null = null;

  const arm = () => {
    if (armed) return;
    armed = true;
    for (const type of UNLOCK_EVENTS) target.addEventListener(type, onGesture, true);
  };
  const disarm = () => {
    if (!armed) return;
    armed = false;
    for (const type of UNLOCK_EVENTS) target.removeEventListener(type, onGesture, true);
  };
  const settle = (ctx: UnlockableContext) => (ctx.state === "running" ? disarm() : arm());
  const onStateChange = () => {
    if (watched) settle(watched);
  };

  function onGesture(e: Event) {
    if (!countsAsActivation(e as unknown as GestureEvent) || !wanted()) return;
    const ctx = options.context();
    if (!ctx) return;
    if (watched !== ctx) {
      watched?.removeEventListener?.("statechange", onStateChange);
      watched = ctx;
      ctx.addEventListener?.("statechange", onStateChange);
    }
    if (ctx.state === "running") return disarm();
    // Called synchronously, so the browser ties the resume to this gesture.
    ctx.resume().then(
      () => settle(ctx),
      () => {},
    );
  }

  const onPageShow = () => {
    if (watched?.state !== "running") arm();
  };

  arm();
  target.addEventListener("pageshow", onPageShow);
  return () => {
    disarm();
    target.removeEventListener("pageshow", onPageShow);
    watched?.removeEventListener?.("statechange", onStateChange);
    watched = null;
  };
}
