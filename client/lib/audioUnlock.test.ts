import assert from "node:assert/strict";
import { test } from "node:test";
import { armAudioUnlock, countsAsActivation, UNLOCK_EVENTS, type UnlockableContext } from "./audioUnlock.ts";

/** A window that says which event types still have a listener. */
class FakeWindow extends EventTarget {
  readonly live = new Set<string>();
  override addEventListener(type: string, fn: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    this.live.add(type);
    super.addEventListener(type, fn, options);
  }
  override removeEventListener(type: string, fn: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    this.live.delete(type);
    super.removeEventListener(type, fn, options);
  }
  gesture(type: string, extra: { pointerType?: string; key?: string } = {}): void {
    this.dispatchEvent(Object.assign(new Event(type), extra));
  }
  armedForGestures(): boolean {
    return UNLOCK_EVENTS.some((t) => this.live.has(t));
  }
}

/** A context that stays in `state` until `settle` says otherwise, as a browser's does until an activation counts. */
class FakeContext extends EventTarget implements UnlockableContext {
  state = "suspended";
  resumes = 0;
  /** What the next resume() leaves the state as. Null leaves it alone, as a resume the browser does not honor does. */
  becomes: string | null = "running";
  resume(): Promise<void> {
    this.resumes++;
    if (this.becomes) this.move(this.becomes);
    return Promise.resolve();
  }
  move(state: string): void {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

function rig(options: { wanted?: () => boolean } = {}) {
  const win = new FakeWindow();
  const ctx = new FakeContext();
  const made = { count: 0 };
  const stop = armAudioUnlock({
    target: win,
    context: () => {
      made.count++;
      return ctx;
    },
    ...options,
  });
  return { win, ctx, made, stop };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("the rules: a mouse counts at pointerdown, touch and pen at pointerup, a key unless it is Escape", () => {
  assert.equal(countsAsActivation({ type: "pointerdown", pointerType: "mouse" }), true);
  assert.equal(countsAsActivation({ type: "pointerdown", pointerType: "touch" }), false);
  assert.equal(countsAsActivation({ type: "pointerdown", pointerType: "pen" }), false);
  assert.equal(countsAsActivation({ type: "pointerup", pointerType: "mouse" }), false);
  assert.equal(countsAsActivation({ type: "pointerup", pointerType: "touch" }), true);
  assert.equal(countsAsActivation({ type: "pointerup", pointerType: "pen" }), true);
  assert.equal(countsAsActivation({ type: "touchend" }), true);
  assert.equal(countsAsActivation({ type: "click" }), true);
  assert.equal(countsAsActivation({ type: "keydown", key: "a" }), true);
  assert.equal(countsAsActivation({ type: "keydown", key: "Enter" }), true);
  assert.equal(countsAsActivation({ type: "keydown", key: "Escape" }), false);
  assert.equal(countsAsActivation({ type: "pointermove", pointerType: "mouse" }), false);
});

test("a touch tap unlocks at pointerup, not at pointerdown", () => {
  const { win, ctx, made } = rig();
  win.gesture("pointerdown", { pointerType: "touch" });
  assert.equal(made.count, 0, "pointerdown for touch is no gesture, so no context is made");
  assert.equal(ctx.resumes, 0);
  win.gesture("pointerup", { pointerType: "touch" });
  assert.equal(ctx.state, "running");
});

test("a mouse press unlocks at pointerdown", () => {
  const { win, ctx } = rig();
  win.gesture("pointerdown", { pointerType: "mouse" });
  assert.equal(ctx.state, "running");
});

test("touchend, click and a key each unlock, and Escape does not", () => {
  for (const [type, extra] of [["touchend", {}], ["click", {}], ["keydown", { key: " " }]] as const) {
    const { win, ctx } = rig();
    win.gesture(type, extra);
    assert.equal(ctx.state, "running", type);
  }
  const { win, ctx, made } = rig();
  win.gesture("keydown", { key: "Escape" });
  assert.equal(made.count, 0);
  assert.equal(ctx.resumes, 0);
});

test("the context is made and resumed inside the handler, before dispatch returns", () => {
  const { win, ctx, made } = rig();
  win.gesture("click");
  assert.equal(made.count, 1);
  assert.equal(ctx.resumes, 1, "resume ran synchronously, still inside the activation");
});

test("it keeps listening until the context runs, then lets go", async () => {
  const { win, ctx } = rig();
  ctx.becomes = null;
  win.gesture("pointerup", { pointerType: "touch" });
  await tick();
  assert.equal(win.armedForGestures(), true, "a resume the browser did not honor leaves the listeners on");
  win.gesture("touchend");
  assert.equal(ctx.resumes, 2, "the next gesture tries again");
  ctx.becomes = "running";
  win.gesture("click");
  await tick();
  assert.equal(ctx.state, "running");
  assert.equal(win.armedForGestures(), false);
  win.gesture("click");
  assert.equal(ctx.resumes, 3, "nothing listens once it runs");
});

test("it listens again when the context is suspended or interrupted later", async () => {
  for (const lost of ["suspended", "interrupted"]) {
    const { win, ctx } = rig();
    win.gesture("click");
    await tick();
    assert.equal(win.armedForGestures(), false);
    ctx.move(lost);
    assert.equal(win.armedForGestures(), true, lost);
    ctx.becomes = "running";
    win.gesture("touchend");
    assert.equal(ctx.state, "running");
    assert.equal(win.armedForGestures(), false);
  }
});

test("a page shown again from the cache listens again when the context is not running", async () => {
  const { win, ctx } = rig();
  win.gesture("click");
  await tick();
  assert.equal(win.armedForGestures(), false);
  win.gesture("pageshow");
  assert.equal(win.armedForGestures(), false, "a running context needs nothing");
  ctx.state = "interrupted";
  win.gesture("pageshow");
  assert.equal(win.armedForGestures(), true);
});

test("while unwanted it makes no context and keeps listening", () => {
  let on = false;
  const { win, ctx, made } = rig({ wanted: () => on });
  win.gesture("click");
  assert.equal(made.count, 0);
  assert.equal(win.armedForGestures(), true);
  on = true;
  win.gesture("click");
  assert.equal(ctx.state, "running");
});

test("the cleanup removes every listener, the context's too", async () => {
  const { win, ctx, stop } = rig();
  win.gesture("click");
  await tick();
  stop();
  assert.equal(win.live.size, 0);
  ctx.move("suspended");
  assert.equal(win.armedForGestures(), false, "a statechange after cleanup arms nothing");
});
