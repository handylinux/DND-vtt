import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createStore } from "zustand/vanilla";
import type { DiceRoll, LogEntry } from "#shared/model.ts";
import type { ClientOp } from "#shared/protocol.ts";
import { chance, int, pick, rng } from "#shared/testutil.ts";
import { FakeClock } from "../../../state/testing.ts";
import type { OnAnswer } from "../../../state/types.ts";
import { sendRoll, type RollSender } from "../send.ts";
import { createDicePanel, type DiceState } from "../useDicePanel.ts";
import { ReceiptTracker, type ReceiptState } from "../useReceipt.ts";
import type { DieKind } from "./layout.ts";
import type { LoadState } from "./probe.ts";
import { DISPOSE_MS, GONE_MS, LAND_MS, LATE_MS, PAINT_MS, PRESS_MS, RESIZE_SLOP_PX, ThrowStore, type PanelHost, type Stage, type StagedThrow, type StageEvents, type StageModule, type ThrowHost, type ThrowOrigin, type TrayGeometry, type TrayHost } from "./store.ts";

/**
 * The throw's store (docs/design/design-v1-roll-animation.md 3 to 7), with a fake
 * tracker, loader, stage, clock and idle queue, so every rule runs under
 * plain Node: which commits throw, the 1 s timer, the interruptions, the
 * warm-up, a lost context and the renderer's disposal.
 */

/** The stage's own loop runs this long after a throw starts, then stops. */
const LOOP_MS = 1150;

class FakeTracker {
  states = new Map<string, ReceiptState>();
  #listeners = new Set<() => void>();
  state = (tag: string): ReceiptState | null => this.states.get(tag) ?? null;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  set(tag: string, state: ReceiptState): void {
    this.states.set(tag, state);
    for (const l of [...this.#listeners]) l();
  }
  /** The results the store handed to the toasts, unseen. */
  unseenTags: string[] = [];
  unseen = (tag: string): void => {
    this.unseenTags.push(tag);
  };
}

class FakeLoader {
  module: StageModule | null = null;
  current: LoadState = "waiting";
  #listeners = new Set<() => void>();
  loaded = () => this.module;
  state = () => this.current;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  finish(module: StageModule | null): void {
    this.module = module;
    this.current = module ? "ready" : "failed";
    for (const l of [...this.#listeners]) l();
  }
}

/** Idle callbacks wait until the test runs them, or until their own deadline passes on the clock. */
class FakeIdle {
  queue: { cb: () => void; id: number }[] = [];
  #id = 0;
  idle = (cb: () => void) => {
    const id = ++this.#id;
    this.queue.push({ cb, id });
    return () => {
      this.queue = this.queue.filter((q) => q.id !== id);
    };
  };
  runAll(): void {
    const due = this.queue;
    this.queue = [];
    for (const q of due) q.cb();
  }
}

/** A warm-up the test finishes when it likes: a promise-like whose callbacks run at once when told. */
class Warmup {
  done: (() => void)[] = [];
  failed: (() => void)[] = [];
  promise = { then: (ok?: () => void, fail?: () => void) => (this.done.push(ok ?? (() => undefined)), this.failed.push(fail ?? (() => undefined))) } as unknown as Promise<void>;
  finish(ok: boolean): void {
    for (const cb of ok ? this.done : this.failed) cb();
    this.done = [];
    this.failed = [];
  }
}

class FakeStage implements Stage {
  plays: StagedThrow[] = [];
  playing: { tag: string; at: number; reduced: boolean } | null = null;
  disposed = false;
  warmups: Warmup[] = [];
  /** The set each warm-up was asked for, and its dice. */
  warmSets: string[] = [];
  warmKinds: (readonly DieKind[])[] = [];
  /** A play that throws, as a texture drawn with no 2D context does. */
  failPlay = false;
  /** How long a play's setup blocks the page: the clock moves on, and no timer fires meanwhile. */
  setupMs = 0;
  readonly clock: FakeClock;
  readonly events: StageEvents;
  /** Checked as each throw starts, so the test sees the store's state at that moment. */
  onPlay: ((t: StagedThrow) => void) | null = null;
  onDispose: (() => void) | null = null;

  constructor(clock: FakeClock, events: StageEvents) {
    this.clock = clock;
    this.events = events;
  }

  warm(kinds: readonly DieKind[], set: string): Promise<void> {
    assert.equal(this.playing, null, "never warmed over a throw on screen");
    const w = new Warmup();
    this.warmups.push(w);
    this.warmSets.push(set);
    this.warmKinds.push(kinds);
    return w.promise;
  }

  play(t: StagedThrow): void {
    assert.equal(this.disposed, false, "a disposed stage never plays");
    assert.ok(!this.looping(), "never two throws at once");
    if (this.failPlay) throw new TypeError("Cannot read properties of null (reading 'fillRect')");
    this.plays.push(t);
    this.playing = { tag: t.tag, at: this.clock.now() - t.elapsed, reduced: t.reduced };
    this.onPlay?.(t);
    this.clock.t += this.setupMs;
  }

  stop(): void {
    this.playing = null;
  }

  looping(): boolean {
    return this.playing !== null && !this.playing.reduced && this.clock.now() < this.playing.at + LOOP_MS;
  }

  dispose(): void {
    this.onDispose?.();
    this.disposed = true;
    this.playing = null;
    // forceContextLoss fires the context's own loss, which the stage reports as its own doing.
    this.events.lost(true);
  }
}

function line(tag: string, rolls: DiceRoll[]): LogEntry {
  return { id: `${tag}:0`, at: "2026-10-18T20:00:00.000Z", kind: "event", data: { type: "dice", by: "p1", to: "all", rolls, tag } };
}

const D20: DiceRoll = { formula: "1d20+5", faces: [17], total: 22, tokenId: "t1", label: "Stealth" };
const GEOMETRY = { width: 356, height: 300, zoom: 1, from: { x: 100, y: 250 } };

function harness() {
  const clock = new FakeClock();
  const tracker = new FakeTracker();
  const loader = new FakeLoader();
  const idle = new FakeIdle();
  const page = { hidden: false };
  const stages: FakeStage[] = [];
  let makeStage = true;
  let setupMs = 0;
  const module: StageModule = {
    createStage(events) {
      if (!makeStage) return null;
      const stage = new FakeStage(clock, events);
      stage.setupMs = setupMs;
      stages.push(stage);
      return stage;
    },
  };
  const store = new ThrowStore();
  store.bind({ clock, idle: idle.idle, tracker, loader, hidden: () => page.hidden });
  let shortPane = false;
  const panel: PanelHost = { kinds: (): DieKind[] => ["d20", "d6"] };
  const tray: TrayHost = { measure: () => (shortPane ? null : GEOMETRY), parent: null };
  let host: ThrowHost | null = null;
  /** The panel and its header line's tray, mounted together as the panel opens after a roll. */
  const open = () => {
    const opened = store.mount(panel);
    host = opened;
    const detach = opened.attach(tray);
    return () => {
      detach();
      opened.unmount();
    };
  };
  let tags = 0;
  const h = {
    clock,
    tracker,
    loader,
    idle,
    page,
    stages,
    store,
    open,
    panel,
    tray,
    module,
    noStage() {
      makeStage = false;
    },
    /** Every stage made from now on takes this long to set up each throw. */
    setup(ms: number) {
      setupMs = ms;
    },
    short(on: boolean) {
      shortPane = on;
    },
    stage: () => stages.at(-1) ?? null,
    /** The Dice panel's host, the last one opened. */
    host: () => host!,
    /** The chunk arrives, the panel opens and the warm-up ends: from here a panel roll throws. */
    ready(): () => void {
      loader.finish(module);
      const unmount = open();
      idle.runAll();
      h.stage()?.warmups.at(-1)?.finish(true);
      return unmount;
    },
    tap(origin: Partial<ThrowOrigin> | null = {}): string {
      const tag = `tag-${++tags}`;
      tracker.set(tag, { state: "sending" });
      if (origin) store.register(tag, { surface: "dice", element: null, tapAt: clock.now(), ...origin } as ThrowOrigin);
      return tag;
    },
    commit(tag: string, rolls: DiceRoll[] = [D20]): void {
      tracker.set(tag, { state: "committed", lines: [line(tag, rolls)] });
    },
  };
  return h;
}

describe("the throw's store", () => {
  test("a panel roll throws, holds its result for 1 s, and the dice go after they fade", () => {
    const h = harness();
    h.ready();
    const tag = h.tap();
    h.clock.advance(80);
    h.commit(tag);
    assert.equal(h.stage()?.plays.length, 1);
    assert.equal(h.store.held(tag), true);
    assert.equal(h.store.view().rolling, false, "a quick answer never says Rolling");
    h.clock.advance(LAND_MS - 1);
    assert.equal(h.store.held(tag), true);
    h.clock.advance(1);
    assert.equal(h.store.held(tag), false, "landed");
    assert.ok(h.store.view().shown, "the dice stay to fade");
    h.clock.advance(GONE_MS - LAND_MS);
    assert.equal(h.store.view().shown, null);
  });

  test("a slow setup never delays the result: the deadlines count from the answer", () => {
    const h = harness();
    h.setup(200);
    h.ready();
    const tag = h.tap();
    h.commit(tag);
    assert.equal(h.stage()?.plays[0]?.elapsed, 0, "the stage is told how long ago the answer came");
    assert.equal(h.clock.now(), 200, "the setup took 200 ms");
    h.clock.advance(LAND_MS - 200 - 1);
    assert.equal(h.store.held(tag), true);
    h.clock.advance(1);
    assert.equal(h.store.held(tag), false, "landed 1 s after the answer, setup included");
    h.clock.advance(GONE_MS - LAND_MS);
    assert.equal(h.store.view().shown, null, "gone 2.1 s after the answer");
  });

  test("a dice set changed mid-flight waits for the throw to end before it warms up", () => {
    const h = harness();
    h.ready();
    const stage = h.stage()!;
    const tag = h.tap();
    h.commit(tag);
    h.store.setInputs({ set: "ruby" });
    h.idle.runAll();
    assert.deepEqual(stage.warmSets, ["ivory"], "nothing relabels the dice in the air");
    h.clock.advance(GONE_MS);
    h.idle.runAll();
    assert.deepEqual(stage.warmSets, ["ivory", "ruby"], "the new set warms up once the dice are gone");
  });

  test("a dice set picked during the first warm-up is drawn ahead once that warm-up ends", () => {
    const h = harness();
    h.loader.finish(h.module);
    h.open();
    h.idle.runAll();
    const stage = h.stage()!;
    h.store.setInputs({ set: "ruby" });
    h.idle.runAll();
    assert.deepEqual(stage.warmSets, ["ivory"], "never two warm-ups at once");
    stage.warmups[0]!.finish(true);
    h.idle.runAll();
    assert.deepEqual(stage.warmSets, ["ivory", "ruby"]);
  });

  test("turning the dice off or Low power on lets the renderer go and stops a warm-up on its way", () => {
    const h = harness();
    h.ready();
    const stage = h.stage()!;
    h.store.setInputs({ on: false });
    assert.equal(stage.disposed, true);
    assert.equal(h.store.lostContexts, 0, "a deliberate disposal");
    h.store.setInputs({ on: true });
    h.store.setInputs({ lowPower: true });
    h.idle.runAll();
    assert.equal(h.stages.length, 1, "the warm-up queued before Low power made no renderer");
    h.store.setInputs({ lowPower: false });
    h.idle.runAll();
    assert.equal(h.stages.length, 2, "and one comes once the dice are allowed again");
  });

  test("the picker gets no stage while its context is lost, and no previews after two losses or with no stage", () => {
    const h = harness();
    h.ready();
    const stage = h.stage()!;
    assert.equal(h.store.stage, stage);
    assert.equal(h.store.previewsAllowed, true);
    stage.events.lost(false);
    assert.equal(h.store.stage, null);
    assert.equal(h.store.previewsAllowed, false);
    stage.events.restored();
    assert.equal(h.store.stage, stage);
    stage.events.lost(false);
    stage.events.restored();
    assert.equal(h.store.previewsAllowed, false, "two losses end the dice for the session");
    const none = harness();
    none.noStage();
    none.ready();
    assert.equal(none.store.previewsAllowed, false);
  });

  test("an answer 200 ms or more after its tap keeps Rolling… until the dice land", () => {
    const h = harness();
    h.ready();
    const tag = h.tap();
    h.clock.advance(250);
    h.commit(tag);
    assert.equal(h.store.view().rolling, true);
    h.clock.advance(LAND_MS);
    assert.equal(h.store.view().rolling, false);
  });

  test("no throw: the switch off, Low power, a preview, no chunk, no warm-up, a hidden page or a short pane", () => {
    const cases: [string, (h: ReturnType<typeof harness>) => void][] = [
      ["the switch off", (h) => h.store.setInputs({ on: false })],
      ["Low power", (h) => h.store.setInputs({ lowPower: true })],
      ["a preview", (h) => h.store.setInputs({ preview: true })],
      ["a hidden page", (h) => (h.page.hidden = true)],
      ["a pane too short", (h) => h.short(true)],
    ];
    for (const [why, stop] of cases) {
      const h = harness();
      h.ready();
      stop(h);
      const tag = h.tap();
      h.commit(tag);
      assert.equal(h.store.held(tag), false, why);
      assert.equal(h.stage()?.plays.length ?? 0, 0, why);
    }
    const early = harness();
    early.open();
    const before = early.tap();
    early.commit(before);
    assert.equal(early.store.held(before), false, "the chunk not here yet");
    early.loader.finish(early.module);
    const cold = early.tap();
    early.commit(cold);
    assert.equal(early.store.held(cold), false, "the warm-up not run yet");
    early.idle.runAll();
    const warming = early.tap();
    early.commit(warming);
    assert.equal(early.store.held(warming), false, "the warm-up not finished");
    early.stage()!.warmups[0]!.finish(true);
    const later = early.tap();
    early.commit(later);
    assert.equal(early.store.held(later), true, "later rolls throw");
  });

  test("no throw for several creatures, a bare line, a refusal, unknown, a lookup, a late answer or a commit before the panel mounted", () => {
    const h = harness();
    const unmount = h.ready();
    const several = h.tap();
    h.commit(several, [D20, { ...D20, tokenId: "t2" }]);
    assert.equal(h.store.held(several), false, "several creatures");
    const bare = h.tap();
    h.commit(bare, []);
    assert.equal(h.store.held(bare), false, "a bare line");
    const refused = h.tap();
    h.tracker.set(refused, { state: "refused", code: "invalid", message: "No.", text: "No." });
    h.commit(refused);
    assert.equal(h.store.held(refused), false, "a refusal, even if its lines later show");
    const unknown = h.tap();
    h.tracker.set(unknown, { state: "checking" });
    h.tracker.set(unknown, { state: "unknown" });
    assert.equal(h.store.held(unknown), false);
    const looked = h.tap();
    h.tracker.set(looked, { state: "checking" });
    h.commit(looked);
    assert.equal(h.store.held(looked), false, "settled by a lookup");
    const late = h.tap();
    h.clock.advance(LATE_MS + 1);
    h.commit(late);
    assert.equal(h.store.held(late), false, "an answer more than 3 s after its tap");
    const elsewhere = h.tap(null);
    h.commit(elsewhere);
    assert.equal(h.store.held(elsewhere), false, "a roll from outside the panel");
    unmount();
    const closed = h.tap();
    h.open();
    h.commit(closed);
    assert.equal(h.store.held(closed), false, "tapped before this mount");
    assert.equal(h.stage()!.plays.length, 0);
  });

  test("a pointer down takes the dice, and its click shows the result after the browser has chosen its target", () => {
    const h = harness();
    h.ready();
    const tag = h.tap();
    h.commit(tag);
    h.host().pointerDown();
    assert.equal(h.store.view().shown, null, "the dice go at once");
    assert.equal(h.store.held(tag), true, "the result waits for the click");
    h.host().click();
    assert.equal(h.store.held(tag), false);
    const dragged = h.tap();
    h.commit(dragged);
    h.host().pointerDown();
    h.host().pointerUp();
    h.clock.advance(299);
    assert.equal(h.store.held(dragged), true);
    h.clock.advance(1);
    assert.equal(h.store.held(dragged), false, "no click after the pointer up: a scroll");
    const keyed = h.tap();
    h.commit(keyed);
    h.host().keyDown();
    assert.equal(h.store.held(keyed), false);
    assert.equal(h.store.view().shown, null);
  });

  test("a newer roll ends the throw, and a commit with a newer tap on its way shows at once", () => {
    const h = harness();
    h.ready();
    const first = h.tap();
    h.commit(first);
    const second = h.tap();
    assert.equal(h.store.held(first), false, "the newer roll ended it");
    const third = h.tap();
    h.commit(second);
    assert.equal(h.store.held(second), false, "a newer tap would end it at once");
    h.commit(third);
    assert.equal(h.store.held(third), true);
    assert.deepEqual(
      h.stage()!.plays.map((p) => p.tag),
      [first, third],
    );
  });

  test("reduced motion draws the dice once at rest and shows the result at once", () => {
    const h = harness();
    h.ready();
    h.store.setInputs({ reducedMotion: true });
    const tag = h.tap();
    h.commit(tag);
    assert.equal(h.store.held(tag), false);
    assert.equal(h.stage()!.plays[0]?.reduced, true);
    assert.ok(h.store.view().shown);
  });

  test("a real lost context ends the throw, a second ends throws for the session, and a deliberate one never counts", () => {
    const h = harness();
    const unmount = h.ready();
    const stage = h.stage()!;
    const tag = h.tap();
    h.commit(tag);
    stage.events.lost(false);
    assert.equal(h.store.held(tag), false);
    const meanwhile = h.tap();
    h.commit(meanwhile);
    assert.equal(h.store.held(meanwhile), false, "nothing throws on a lost context");
    stage.events.restored();
    h.idle.runAll();
    stage.warmups.at(-1)!.finish(true);
    const back = h.tap();
    h.commit(back);
    assert.equal(h.store.held(back), true, "warmed up again after the restore");
    unmount();
    h.clock.advance(DISPOSE_MS);
    assert.equal(stage.disposed, true, "disposed 30 s after the panel closed");
    assert.equal(h.store.lostContexts, 1, "the disposal's own loss never counts");
    h.open();
    h.idle.runAll();
    const second = h.stage()!;
    assert.notEqual(second, stage);
    second.warmups.at(-1)!.finish(true);
    second.events.lost(false);
    second.events.restored();
    h.idle.runAll();
    second.warmups.at(-1)?.finish(true);
    const after = h.tap();
    h.commit(after);
    assert.equal(h.store.held(after), false, "two real losses: no throws for the session");
  });

  test("a hidden page throws nothing and lets the renderer go, and showing it warms up again", () => {
    const h = harness();
    h.ready();
    const stage = h.stage()!;
    h.page.hidden = true;
    h.store.visibility(true);
    assert.equal(stage.disposed, true);
    h.page.hidden = false;
    h.store.visibility(false);
    h.idle.runAll();
    h.stage()!.warmups.at(-1)!.finish(true);
    const tag = h.tap();
    h.commit(tag);
    assert.equal(h.store.held(tag), true);
  });
});

/** A tray of its own for each host, named by where its canvas hangs. */
const trayIn = (parent: string, measure: () => TrayGeometry | null = () => GEOMETRY): TrayHost => ({ parent, measure });
const BLOCK = { surface: "block", kinds: (): DieKind[] => ["d20", "d4"] } as const;
/** An element where a test needs one: the store only compares and hands them on. */
const element = (name: string) => ({ name }) as unknown as Element;

describe("the throw's hosts (docs/design/design-v1-token-roll-header.md 4.2)", () => {
  /** The dice ready, the Dice panel open with its tray, and a stat block's panel open with its own. */
  function hosts() {
    const h = harness();
    h.ready();
    const dice = h.host();
    const block = h.store.mount(BLOCK);
    const detach = block.attach(trayIn("block"));
    return { h, dice, block, detach };
  }

  test("a block roll throws in its own host's tray alone, and the shown throw names that host", () => {
    const { h, dice, block } = hosts();
    assert.notEqual(block.id, dice.id);
    const tag = h.tap(block.origin(element("DEX")));
    h.commit(tag);
    assert.equal(h.stage()!.plays.at(-1)?.parent, "block");
    assert.equal(h.store.view().shown?.host, block.id);
    assert.equal(h.store.held(tag), true);
  });

  test("a Dice panel roll with a block host mounted throws in the Dice panel, with or without its host named", () => {
    const { h, dice } = hosts();
    for (const origin of [dice.origin(), {}]) {
      const tag = h.tap(origin);
      h.commit(tag);
      assert.equal(h.stage()!.plays.at(-1)?.parent, null, "the Dice panel's tray");
      assert.equal(h.store.view().shown?.host, dice.id);
    }
  });

  test("a block roll whose host is hidden, unmounted, or mounted again since the tap never throws", () => {
    const { h, block } = hosts();
    const hidden = h.tap(block.origin());
    block.shown(false);
    h.commit(hidden);
    assert.equal(h.store.held(hidden), false, "hidden");
    block.shown(true);
    const shownAgain = h.tap(block.origin());
    block.shown(false);
    block.shown(true);
    h.commit(shownAgain);
    assert.equal(h.store.held(shownAgain), false, "hidden and shown again before the answer");
    const remounted = h.tap(block.origin());
    block.unmount();
    block.mount();
    h.commit(remounted);
    assert.equal(h.store.held(remounted), false, "mounted again");
    const gone = h.tap(block.origin());
    block.unmount();
    h.commit(gone);
    assert.equal(h.store.held(gone), false, "unmounted");
    assert.equal(h.stage()!.plays.length, 0);
    block.mount();
    const live = h.tap(block.origin());
    h.commit(live);
    assert.equal(h.store.held(live), true, "a tap under this mount throws");
  });

  test("the Dice panel closing during a block's throw leaves it, and the block's own unmount sends its held result to the toasts", () => {
    const { h, dice, block } = hosts();
    const tag = h.tap(block.origin());
    h.commit(tag);
    dice.unmount();
    assert.equal(h.store.held(tag), true, "the Dice panel's unmount leaves another host's throw");
    assert.ok(h.store.view().shown);
    assert.deepEqual(h.tracker.unseenTags, []);
    block.unmount();
    assert.equal(h.store.held(tag), false);
    assert.equal(h.store.view().shown, null);
    assert.deepEqual(h.tracker.unseenTags, [tag], "never seen, so the toast says it");
  });

  test("a host's tray detaching or its pane hiding ends only that host's throw, unseen", () => {
    for (const how of ["detach", "hide"] as const) {
      const { h, dice, block, detach } = hosts();
      const own = h.tap(dice.origin());
      h.commit(own);
      const away = how === "detach" ? detach : () => block.shown(false);
      away();
      assert.equal(h.store.held(own), true, `${how}: the Dice panel's throw goes on`);
      assert.deepEqual(h.tracker.unseenTags, [], how);
      const back = how === "detach" ? block.attach(trayIn("block")) : (block.shown(true), () => block.shown(false));
      const thrown = h.tap(block.origin());
      h.commit(thrown);
      assert.equal(h.store.view().shown?.host, block.id, how);
      back();
      assert.equal(h.store.held(thrown), false, how);
      assert.deepEqual(h.tracker.unseenTags, [thrown], `${how}: its own result was never seen`);
    }
  });

  test("a result let go just before its host goes, never painted, goes to the toasts, and another host's never does", () => {
    const { h, dice, block } = hosts();
    const tag = h.tap(block.origin());
    h.commit(tag);
    // The block's panel sees the key, and the Escape closes the Dice panel's sheet in the same event.
    block.keyDown();
    dice.unmount();
    assert.deepEqual(h.tracker.unseenTags, [], "another host's result");
    block.unmount();
    assert.deepEqual(h.tracker.unseenTags, [tag], "its own, before it painted");
  });

  test("each host's origin reads its own last press, and a block's takes its box", () => {
    const { h, dice, block } = hosts();
    const box = element("DEX box");
    const row = element("Check row");
    const roll = element("Roll");
    block.pointerDown(row);
    assert.equal(block.origin().element, row);
    assert.equal(dice.origin().element, null, "a press in the token panel is never a Dice panel origin");
    assert.equal(h.store.origin().element, null, "nor the Dice panel's by default");
    dice.keyDown(roll);
    assert.equal(h.store.origin().element, roll);
    assert.equal(h.store.origin(block.id).element, row);
    assert.equal(block.origin(box).element, box, "the box, given");
    assert.deepEqual({ surface: block.origin().surface, host: block.origin().host }, { surface: "block", host: block.id });
    h.clock.advance(PRESS_MS);
    assert.equal(block.origin().element, null, "a press long ago is no origin");
  });

  test("a stat block's host alone warms the dice, d20 and d4, and the renderer goes 30 s after the last host goes", () => {
    const h = harness();
    h.loader.finish(h.module);
    const block = h.store.mount(BLOCK);
    h.idle.runAll();
    const stage = h.stage()!;
    assert.deepEqual(stage.warmKinds, [["d20", "d4"]]);
    stage.warmups[0]!.finish(true);
    const dice = h.store.mount(h.panel);
    block.unmount();
    h.clock.advance(DISPOSE_MS);
    assert.equal(stage.disposed, false, "never while another host is mounted");
    const again = h.store.mount(BLOCK);
    dice.unmount();
    h.clock.advance(DISPOSE_MS - 1);
    again.unmount();
    h.clock.advance(DISPOSE_MS - 1);
    assert.equal(stage.disposed, false);
    h.clock.advance(1);
    assert.equal(stage.disposed, true, "30 s after the last host went");
  });

  test("reduced motion draws a block's dice once at rest, in its tray, with the result at once", () => {
    const { h, block } = hosts();
    h.store.setInputs({ reducedMotion: true });
    const tag = h.tap(block.origin());
    h.commit(tag);
    assert.equal(h.store.held(tag), false);
    assert.deepEqual({ reduced: h.stage()!.plays[0]?.reduced, parent: h.stage()!.plays[0]?.parent }, { reduced: true, parent: "block" });
    assert.equal(h.store.view().shown?.host, block.id);
  });

  test("the pane's size keeps a baseline: a report on it, or the host's own change, is no resize, and any other ends the throw", () => {
    const { h, block } = hosts();
    block.observed({ width: 341, height: 500 });
    const tag = h.tap(block.origin());
    h.commit(tag);
    block.observed({ width: 341, height: 500 + RESIZE_SLOP_PX });
    assert.equal(h.store.held(tag), true, "within the slop");
    // The header line goes in and the sheet grows: the host records it before the observer reports.
    block.baseline({ width: 341, height: 544 });
    block.observed({ width: 341, height: 544 });
    assert.equal(h.store.held(tag), true, "the host's own growth");
    block.observed({ width: 341, height: 600 });
    assert.equal(h.store.held(tag), false, "a drag or the keyboard");
    const next = h.tap(block.origin());
    h.commit(next);
    block.observed({ width: 341, height: 600 });
    assert.equal(h.store.held(next), true, "the new size is the baseline");
    block.observed({ width: 341.6, height: 600 });
    assert.equal(h.store.held(next), false, "a width change too");
    const fresh = h.store.mount(BLOCK);
    fresh.attach(trayIn("fresh"));
    const first = h.tap(fresh.origin());
    h.commit(first);
    fresh.observed({ width: 200, height: 300 });
    assert.equal(h.store.held(first), true, "the first report is the baseline");
  });

  test("the DM's secret roll reaches a player's device as a line it never tapped, and throws nothing there", () => {
    const { h } = hosts();
    h.tracker.set("dm-secret", { state: "committed", lines: [line("dm-secret", [D20])] });
    assert.equal(h.stage()!.plays.length, 0);
  });
});

/**
 * A host's tray mounting after its roll's answer (D-261101-099), with a
 * sender that answers inside the send, through the panel's actions and the
 * real receipt tracker. The dev room's server answers on a timer, but a
 * sender may answer at once, and the first roll of a panel draws its tray
 * only with the header line, after the answer.
 */
describe("a roll whose tray comes after its answer", () => {
  function setup(surface: "dice" | "block") {
    const clock = new FakeClock();
    const idle = new FakeIdle();
    const log: LogEntry[] = [];
    const tracker = new ReceiptTracker();
    tracker.env = { lookup: async () => ({ parts: [] }), log: () => log };
    let n = 0;
    const sender: RollSender = {
      // The answer comes inside the send: its line lands, then its ack.
      dispatch: (op, opts) => {
        const tag = (op as { tag: string }).tag;
        log.push(line(tag, [{ formula: "1d20+4", faces: [12], total: 16, characterId: "thorn" }]));
        opts?.onAnswer?.("taken");
        return ++n;
      },
      connected: () => true,
      receipts: tracker,
    };
    const loader = new FakeLoader();
    let stage: FakeStage | null = null;
    const store = new ThrowStore();
    store.bind({ clock, idle: idle.idle, tracker, loader, hidden: () => false });
    loader.finish({ createStage: (events) => (stage = new FakeStage(clock, events)) });
    const host = store.mount(surface === "block" ? BLOCK : { kinds: () => ["d20"] });
    idle.runAll();
    stage!.warmups[0]!.finish(true);
    const choices = createStore<DiceState>(() => ({ adv: false, dis: false, secret: null, version: 0, last: null }));
    const panel = createDicePanel({ store: choices, sender, secretStart: () => false, registerThrow: (tag, origin) => store.register(tag, origin) });
    const box = element("DEX box");
    /** A stat block's pick: its host holds before it sends, as the header line will settle the scroll. */
    const pick = () => {
      if (surface === "block") host.hold();
      return panel.roll([{ formula: "1d20+4", label: "Dexterity check", creature: { characterId: "thorn" } }], { origin: surface === "block" ? host.origin(box) : host.origin(), choices: "none" })!;
    };
    return { store, host, pick, clock, stage: () => stage!, tracker };
  }

  test("a block's first roll, committed inside the send, waits through its tray's attach and throws at the release, landing 1 s after the answer", () => {
    const h = setup("block");
    const tag = h.pick();
    assert.equal(h.tracker.state(tag)?.state, "committed", "answered inside the send");
    assert.equal(h.stage().plays.length, 0);
    h.clock.advance(16);
    h.host.attach(trayIn("block"));
    assert.equal(h.stage().plays.length, 0, "held: the attach decides nothing while the header settles");
    h.clock.advance(4);
    h.host.release();
    assert.equal(h.stage().plays.length, 1);
    assert.equal(h.stage().plays[0]!.elapsed, 20, "the stage is told how long ago the answer came");
    assert.equal(h.stage().plays[0]!.geometry.from !== undefined, true);
    assert.equal(h.store.view().shown?.startedAt, 0, "the tray's marks count from the answer");
    assert.equal(h.store.held(tag), true);
    h.clock.advance(LAND_MS - 20 - 1);
    assert.equal(h.store.held(tag), true);
    h.clock.advance(1);
    assert.equal(h.store.held(tag), false, "landed at t0 + 1,000 ms");
    h.clock.advance(GONE_MS - LAND_MS);
    assert.equal(h.store.view().shown, null, "gone at t0 + 2,100 ms");
  });

  test("a held host's later roll waits for its release too, with its tray already there", () => {
    const h = setup("block");
    h.host.attach(trayIn("block"));
    h.host.release();
    const tag = h.pick();
    assert.equal(h.stage().plays.length, 0, "held until the header's layout effect");
    h.host.release();
    assert.equal(h.stage().plays.length, 1);
    assert.equal(h.store.held(tag), true);
  });

  test("released 1 s or more after the answer, the result shows at once and nothing is thrown", () => {
    const h = setup("block");
    h.host.attach(trayIn("block"));
    const tag = h.pick();
    h.clock.advance(LAND_MS);
    h.host.release();
    assert.equal(h.stage().plays.length, 0);
    assert.equal(h.store.held(tag), false);
  });

  test("the Dice panel's first roll waits for its sticky line's tray, which decides it as it attaches", () => {
    const h = setup("dice");
    const tag = h.pick();
    assert.equal(h.stage().plays.length, 0);
    h.clock.advance(10);
    h.host.attach(trayIn("dice"));
    assert.equal(h.stage().plays.length, 1);
    assert.equal(h.stage().plays[0]!.parent, "dice");
    assert.equal(h.store.held(tag), true);
    h.clock.advance(LAND_MS - 10);
    assert.equal(h.store.held(tag), false, "landed 1 s after the answer");
  });

  test("a roll still waiting as its host hides or goes never throws", () => {
    for (const how of ["hide", "unmount"] as const) {
      const h = setup("block");
      h.host.attach(trayIn("block"));
      const tag = h.pick();
      if (how === "hide") {
        h.host.shown(false);
        h.host.shown(true);
      } else {
        h.host.unmount();
        h.host.mount();
      }
      h.host.release();
      assert.equal(h.stage().plays.length, 0, how);
      assert.equal(h.store.held(tag), false, how);
    }
  });
});

describe("a committed roll waiting for its host, with answers that come later", () => {
  test("past its tap's 3 s it is dropped at the release, even within 1 s of its answer", () => {
    for (const late of [false, true]) {
      const h = harness();
      h.ready();
      const block = h.store.mount(BLOCK);
      block.attach(trayIn("block"));
      block.hold();
      const tag = h.tap(block.origin());
      h.clock.advance(2_500);
      h.commit(tag);
      h.clock.advance(late ? 501 : 499);
      block.release();
      assert.equal(h.store.held(tag), !late, late ? "dropped" : "within its tap's 3 s and its answer's 1 s");
    }
  });

  test("a waiting roll throws only if no newer tap is on its way", () => {
    const h = harness();
    h.ready();
    const block = h.store.mount(BLOCK);
    block.attach(trayIn("block"));
    block.hold();
    const first = h.tap(block.origin());
    h.commit(first);
    const second = h.tap(h.host().origin());
    block.release();
    assert.equal(h.store.held(first), false, "the Dice panel's newer roll would end it at once");
    h.commit(second);
    assert.equal(h.store.held(second), true);
  });
});

/**
 * Every way a Dice panel control rolls, through the panel's own actions
 * (createDicePanel) and the real receipt tracker: each that carries the
 * panel's origin throws, and the tracker's Roll, which carries none, does
 * not, even with Dice open beside it.
 */
describe("every way a panel control rolls", () => {
  function setup() {
    const clock = new FakeClock();
    const idle = new FakeIdle();
    const log: LogEntry[] = [];
    const tracker = new ReceiptTracker();
    tracker.env = { lookup: async () => ({ parts: [] }), log: () => log };
    const waiting: { op: ClientOp; answer: OnAnswer | undefined }[] = [];
    const sender: RollSender = {
      dispatch: (op, opts) => (waiting.push({ op, answer: opts?.onAnswer }), waiting.length),
      connected: () => true,
      receipts: tracker,
    };
    const loader = new FakeLoader();
    let stage: FakeStage | null = null;
    const store = new ThrowStore();
    store.bind({ clock, idle: idle.idle, tracker, loader, hidden: () => false });
    loader.finish({ createStage: (events) => (stage = new FakeStage(clock, events)) });
    const host = store.mount({ kinds: () => ["d20"] });
    const detach = host.attach({ parent: null, measure: () => GEOMETRY });
    idle.runAll();
    stage!.warmups[0]!.finish(true);
    const choices = createStore<DiceState>(() => ({ adv: false, dis: false, secret: null, version: 0, last: null }));
    const panel = createDicePanel({ store: choices, sender, secretStart: () => false, registerThrow: (tag, origin) => store.register(tag, origin) });
    /** The server's answer to everything sent: each op's line in the log, then its ack. */
    const answerAll = () => {
      for (const { op, answer } of waiting.splice(0)) {
        const tag = (op as { tag: string }).tag;
        const roll: DiceRoll = { formula: "1d20+4", faces: [12], total: 16, characterId: "thorn" };
        log.push(op.t === "roll.dice" ? { id: `${log.length + 1}:0`, at: "", kind: "event", data: { type: "roll", test: { kind: "save", choices: [{ ability: "dex" }] }, characterId: "thorn", total: 16, dice: roll, tag } } : line(tag, [roll]));
        answer?.("taken");
      }
    };
    const origin = () => store.origin();
    /** The Dice panel closes: its header line's tray, then the panel, as React cleans them up. */
    const close = () => {
      detach();
      host.unmount();
    };
    return { store, host, panel, sender, answerAll, origin, stage: () => stage!, tracker, close, clock };
  }

  const ROLL = { formula: "1d20+4", label: "Stealth", creature: { characterId: "thorn" } };

  test("the formula's Roll and a roll option throw", () => {
    const h = setup();
    const tag = h.panel.roll([ROLL], { origin: h.origin() })!;
    h.answerAll();
    assert.equal(h.store.held(tag), true);
    const option = h.panel.roll([{ ...ROLL, label: "Longsword", critOn: 19 }], { origin: h.origin() })!;
    h.answerAll();
    assert.equal(h.store.held(option), true);
  });

  test("the header line's Again and Recent rolls' Again throw", () => {
    const h = setup();
    const header = h.panel.again([{ formula: "1d20+4" }], "all", h.origin())!;
    h.answerAll();
    assert.equal(h.store.held(header), true);
    const row = h.panel.again([{ formula: "2d6+3" }], "dm", h.origin())!;
    h.answerAll();
    assert.equal(h.store.held(row), true);
  });

  test("an answer to a request and a death save sent from the panel throw", () => {
    const h = setup();
    for (const op of [
      { t: "roll.dice", tag: "answer-1", rollId: "q1", target: { characterId: "thorn" } },
      { t: "actor.deathRoll", tag: "death-1", target: { characterId: "thorn" } },
    ] as const) {
      sendRoll(h.sender, op as never);
      h.panel.noted(op.tag, op.t === "roll.dice" ? "Dexterity save" : "Death save", h.origin());
      h.answerAll();
      assert.equal(h.store.held(op.tag), true, op.t);
    }
  });

  test("a stage that throws as it plays shows the result at once, goes for the session, and the tracker's other listeners still run", (t) => {
    const warn = t.mock.method(console, "warn", () => undefined);
    const h = setup();
    h.stage().failPlay = true;
    let told = 0;
    h.tracker.subscribe(() => told++);
    const tag = h.panel.roll([ROLL], { origin: h.origin() })!;
    told = 0;
    h.answerAll();
    assert.equal(h.store.held(tag), false, "the result shows");
    assert.ok(told > 0, "a listener after the store's still heard the answer");
    assert.equal(h.stage().disposed, true, "the stage is let go");
    assert.equal(h.store.lostContexts, 0);
    assert.equal(h.store.stage, null);
    const next = h.panel.roll([ROLL], { origin: h.origin() })!;
    h.answerAll();
    assert.equal(h.store.held(next), false, "no throws for the session");
    assert.equal(warn.mock.callCount(), 1, "the failure is logged once");
    assert.ok(warn.mock.calls[0]?.arguments[1] instanceof TypeError, "with the stage's own error");
  });

  test("a result still in the air as the panel closes goes to the toasts, in either cleanup order", () => {
    for (const order of ["panel first", "header line first"] as const) {
      const h = setup();
      const tag = h.panel.roll([ROLL], { origin: h.origin() })!;
      // The header line shows the tag while it is mounted, and calls it told as it goes (useReceipt).
      const unwatch = h.tracker.watch(tag);
      h.answerAll();
      assert.equal(h.store.held(tag), true);
      const lastResultGoes = () => {
        unwatch();
        h.tracker.announced(tag);
      };
      const before = h.tracker.version();
      if (order === "panel first") {
        h.close();
        lastResultGoes();
      } else {
        lastResultGoes();
        h.close();
      }
      assert.ok(h.tracker.version() > before, `${order}: the toasts are told to look again`);
      assert.deepEqual(
        h.tracker.unannounced().map((u) => u.tag),
        [tag],
        `${order}: the own roll's toast`,
      );
    }
  });

  test("a result in the air as the panel closed, shown again before its toast, is no toast", () => {
    const h = setup();
    const tag = h.panel.roll([ROLL], { origin: h.origin() })!;
    const unwatch = h.tracker.watch(tag);
    h.answerAll();
    h.close();
    unwatch();
    h.tracker.announced(tag);
    // The panel opens again at once, and its header line shows the result.
    const again = h.tracker.watch(tag);
    assert.deepEqual(h.tracker.unannounced(), []);
    again();
    h.tracker.announced(tag);
    assert.deepEqual(h.tracker.unannounced(), []);
  });

  test("a result that landed and painted before the panel closed is no toast", () => {
    for (const end of ["landing", "click", "key"] as const) {
      const h = setup();
      const tag = h.panel.roll([ROLL], { origin: h.origin() })!;
      const unwatch = h.tracker.watch(tag);
      h.answerAll();
      if (end === "landing") h.clock.advance(LAND_MS);
      else if (end === "click") h.host.click();
      else h.host.keyDown();
      assert.equal(h.store.held(tag), false);
      h.clock.advance(PAINT_MS);
      h.close();
      unwatch();
      h.tracker.announced(tag);
      assert.deepEqual(h.tracker.unannounced(), [], end);
    }
  });

  test("Escape lets the result go and closes the sheet in the same event: the result never painted, so it goes to the toasts", () => {
    for (const end of ["key", "click"] as const) {
      const h = setup();
      const tag = h.panel.roll([ROLL], { origin: h.origin() })!;
      const unwatch = h.tracker.watch(tag);
      h.answerAll();
      // The panel's capture listener sees the key first, then the room's Escape closes the sheet in the same tick.
      if (end === "key") h.host.keyDown();
      else h.host.click();
      h.close();
      unwatch();
      h.tracker.announced(tag);
      assert.deepEqual(
        h.tracker.unannounced().map((u) => u.tag),
        [tag],
        end,
      );
    }
  });

  test("the tracker's Roll, which carries no origin, never throws", () => {
    const h = setup();
    const tag = h.panel.roll([ROLL])!;
    h.answerAll();
    assert.equal(h.store.held(tag), false);
    assert.equal(h.stage().plays.length, 0);
  });
});

describe("the throw's store, randomized", () => {
  test("3,000 random sequences keep its promises", (t) => {
    // A stage that throws as it plays logs its error, which would flood the output here.
    t.mock.method(console, "warn", () => undefined);
    for (let seed = 1; seed <= 3_000; seed++) run(seed);
  });
});

/**
 * One random sequence of taps from the Dice panel, two stat blocks' panels
 * and elsewhere, answers, refusals, unknowns, chunk loads, warm-ups,
 * context losses and restores, taps and keys, hosts mounting, hiding,
 * unmounting and mounting again (a block's often as a new host, as a new
 * key makes one), trays attaching before and after an answer, holds and
 * releases, resizes, page hides and shows, setting changes and clock
 * steps, with the invariants checked after every step. The model beside
 * the store knows only what the test did, never the store's own state.
 */
function run(seed: number): void {
  const r = rng(seed);
  const h = harness();
  const { store, clock, tracker } = h;
  /** What the sequence did, for a failure's message. */
  const trace: string[] = [];
  const did = (what: string) => trace.push(`${clock.now()} ${what}`);
  const at = (what: string) => `seed ${seed}, ${what}, after: ${trace.slice(-12).join("; ")}`;

  let short = false;
  type HostModel = { name: string; surface: "dice" | "block"; handle: ThrowHost; mounted: boolean; era: number; visible: boolean; held: boolean; tray: boolean; detach: (() => void) | null; size: number | null };
  const specOf = (surface: "dice" | "block"): PanelHost => (surface === "dice" ? h.panel : { surface: "block", kinds: () => ["d20", "d4"] });
  const fresh = (x: HostModel) => {
    x.handle = store.host(specOf(x.surface));
    x.era = 0;
    x.visible = true;
    x.held = false;
    x.tray = false;
    x.detach = null;
    x.size = null;
  };
  const hosts: HostModel[] = (["dice", "block", "block"] as const).map((surface, i) => {
    const x = { name: i === 0 ? "dice" : `block-${i}`, surface } as HostModel;
    fresh(x);
    return x;
  });
  const dice = hosts[0]!;
  const blocks = hosts.slice(1);

  type Tap = { tag: string; host: HostModel | null; handle: ThrowHost | null; era: number; tapAt: number; panel: boolean; checked: boolean; state: "open" | "waiting" | "done" | "dropped"; answeredAt: number | null; rolls: DiceRoll[] };
  const taps: Tap[] = [];
  let closedAt: number | null = null;
  let stageAtClose: FakeStage | null = null;
  const inputs = { on: true, lowPower: false, reducedMotion: false, preview: false };
  let realLosses = 0;
  let contextLost = false;
  /** A stage threw as it played: no throws for the session. */
  let broken = false;
  // Some sequences take a while to set up each throw, which the deadlines count.
  h.setup(pick(r, [0, 0, 30, 200]));
  /** A warm-up finished on the current stage since anything made it cold. */
  let warm = false;
  /** The warm-ups that still count: one asked since nothing made it cold. */
  let counting = new Set<Warmup>();
  type Play = { tag: string; host: HostModel; hostId: number; at: number; reduced: boolean; interrupted: boolean };
  // Set inside the stage's callback, which TypeScript cannot follow from here.
  let play = null as Play | null;
  let plays = 0;

  const chill = () => {
    warm = false;
    counting = new Set();
  };
  const trayOf = (name: string): TrayHost => ({ parent: name, measure: () => (short ? null : GEOMETRY) });
  /** When the step began: a throw's setup moves the clock on inside the step, after the store decided. */
  let stepAt = 0;
  const live = (t: Tap) => {
    const x = t.host;
    return x !== null && x.mounted && x.visible && x.handle === t.handle && x.era === t.era && !t.checked && stepAt - t.tapAt <= LATE_MS;
  };
  const pending = (t: Tap) => t.panel && (t.state === "open" || t.state === "waiting");
  const allowed = () => inputs.on && !inputs.lowPower && !inputs.preview && h.loader.current === "ready" && !h.page.hidden && warm && !contextLost && realLosses < 2 && !broken && !short;
  const watchStage = (stage: FakeStage) => {
    if ((stage as { watched?: true }).watched) return;
    (stage as { watched?: true }).watched = true;
    stage.onPlay = (t) => {
      const tap = taps.find((x) => x.tag === t.tag);
      const host = hosts.find((x) => x.name === t.parent);
      assert.ok(tap && host && tap.host === host && tap.handle === host.handle, at(`a throw plays only in the tray of the host that sent it (${t.tag})`));
      assert.ok(host.mounted && host.visible && host.tray && !host.held, at("only a live, settled host with a tray throws"));
      assert.equal(tap.checked, false, at("never a roll a lookup settled"));
      assert.equal(tracker.states.get(t.tag)?.state, "committed", at("only a committed roll throws"));
      plays++;
      play = { tag: t.tag, host, hostId: host.handle.id, at: clock.now() - t.elapsed, reduced: t.reduced, interrupted: false };
    };
    stage.onDispose = () => {
      assert.equal(store.view().shown, null, at("never disposed while a throw runs"));
      if (stage === h.stage()) chill();
    };
  };
  const interrupted = () => {
    if (play) play.interrupted = true;
  };
  const shownNow = () => {
    assert.equal(store.view().held, null, at("the result shows at once after an interruption"));
  };
  /**
   * The store's check of its taps, as it runs after any change of a
   * receipt, a register, an attach or a release: in tap order, a committed
   * tap waits while its live host holds or has no tray, within 1 s of its
   * answer, and otherwise is decided. Returns the tap that throws, if any.
   */
  const check = (committed: Tap | null = null): string | null => {
    let throws: string | null = null;
    const now = stepAt;
    for (const [i, t] of taps.entries()) {
      if (t.state !== "waiting" && t !== committed) continue;
      const answered = t.answeredAt ?? now;
      const inTime = now - answered < LAND_MS;
      if (live(t) && (t.host!.held || !t.host!.tray) && inTime) {
        t.answeredAt = answered;
        t.state = "waiting";
        continue;
      }
      t.state = "done";
      const later = taps.slice(i + 1).some(pending);
      let ok = live(t) && t.host!.tray && !t.host!.held && inTime && allowed() && !later && t.rolls.length === 1;
      // An eligible commit on a stage that throws as it plays shows at once, and ends the dice for the session.
      if (ok && h.stage()?.failPlay) {
        ok = false;
        broken = true;
        chill();
      }
      if (ok) throws = t.tag;
    }
    return throws;
  };
  const drop = (x: HostModel) => {
    for (const t of taps) if (t.host === x && t.handle === x.handle && (t.state === "open" || t.state === "waiting")) t.state = "dropped";
  };
  /** A host's own throw ends as it goes, hides or loses its tray. Another host's goes on. */
  const endFor = (x: HostModel, act: () => void) => {
    const own = play !== null && play.host === x && play.hostId === x.handle.id;
    const held = own && store.view().held === play!.tag ? play!.tag : null;
    const before = tracker.unseenTags.length;
    if (own) interrupted();
    act();
    if (own) shownNow();
    if (held !== null) assert.equal(tracker.unseenTags.slice(before).at(-1), held, at("a host's own held result goes to the toasts as it goes"));
  };
  const mount = (x: HostModel) => {
    x.mounted = true;
    x.era++;
    x.handle.mount();
    closedAt = null;
    stageAtClose = null;
  };
  const unmount = (x: HostModel) => {
    endFor(x, () => x.handle.unmount());
    x.mounted = false;
    x.era++;
    drop(x);
    if (hosts.every((y) => !y.mounted)) {
      // A warm-up still under way stops counting when the last surface closes.
      counting = new Set();
      closedAt = clock.now();
      stageAtClose = h.stage();
    }
  };

  // Most sequences start with the dice ready and the Dice panel open, so throws happen often enough to break.
  if (chance(r, 0.75)) {
    h.loader.finish(h.module);
    mount(dice);
    dice.detach = dice.handle.attach(trayOf(dice.name));
    dice.tray = true;
    for (const x of blocks) {
      if (!chance(r, 0.6)) continue;
      mount(x);
      if (chance(r, 0.5)) {
        x.detach = x.handle.attach(trayOf(x.name));
        x.tray = true;
      }
    }
    h.idle.runAll();
    h.stage()?.warmups.at(-1)?.finish(true);
    warm = h.stage() !== null;
  }
  const steps = int(r, 20, 90);
  for (let step = 0; step < steps; step++) {
    const stage = h.stage();
    if (stage) watchStage(stage);
    stepAt = clock.now();
    const k = r();
    let expected: string | null = null;
    const playsBefore = plays;
    if (k < 0.18) {
      // A tap: in a surface (with its origin), or elsewhere, such as the tracker's Roll.
      const where = r();
      let host: HostModel | null = null;
      let origin: Partial<ThrowOrigin> | null = null;
      let handle: ThrowHost | null = null;
      if (where < 0.12) origin = null;
      else if (where < 0.5) {
        // The Dice panel's controls name no host, or its own.
        if (chance(r, 0.5)) origin = {};
        else origin = dice.handle.origin();
        host = dice.mounted ? dice : null;
        handle = dice.handle;
      } else {
        // Mostly from a panel that is open, sometimes a stale tap from one that closed.
        const open = blocks.filter((b) => b.mounted);
        const x = open.length > 0 && chance(r, 0.85) ? pick(r, open) : pick(r, blocks);
        // A pick holds its host's rolls before it sends, as the header line settles its scroll.
        if (!x.held && chance(r, 0.6)) {
          x.held = true;
          x.handle.hold();
        }
        origin = x.handle.origin(null);
        host = x.mounted ? x : null;
        handle = x.handle;
      }
      const tag = h.tap(origin);
      did(`tap ${tag} ${origin === null ? "elsewhere" : (host?.name ?? "stale")}`);
      const tap: Tap = { tag, host, handle, era: host?.era ?? -1, tapAt: clock.now(), panel: origin !== null, checked: false, state: "open", answeredAt: null, rolls: [] };
      taps.push(tap);
      if (tap.panel) {
        interrupted();
        shownNow();
        // The register's own check: a tap that waited sees this newer one on its way.
        check();
      }
    } else if (k < 0.4) {
      const open = taps.filter((t) => t.state === "open" || t.state === "dropped");
      if (open.length === 0) continue;
      // Mostly the newest, as answers come in order, sometimes an older one.
      const tap = chance(r, 0.7) ? open.at(-1)! : pick(r, open);
      const how = r();
      const dropped = tap.state === "dropped";
      if (how < 0.65) {
        tap.rolls = chance(r, 0.1) ? [D20, { ...D20, tokenId: "t9" }] : chance(r, 0.05) ? [] : [D20];
        did(`commit ${tap.tag}`);
        h.commit(tap.tag, tap.rolls);
        if (dropped || !tap.panel) {
          tap.state = "done";
          expected = check();
        } else expected = check(tap);
      } else if (how < 0.8) {
        tap.state = "done";
        did(`refuse ${tap.tag}`);
        tracker.set(tap.tag, { state: "refused", code: "invalid", message: "No.", text: "No." });
        expected = check();
      } else if (how < 0.9) {
        tap.checked = true;
        did(`check ${tap.tag}`);
        tracker.set(tap.tag, { state: "checking" });
        expected = check();
      } else {
        tap.state = "done";
        did(`unknown ${tap.tag}`);
        tracker.set(tap.tag, { state: "unknown" });
        expected = check();
      }
    } else if (k < 0.42) {
      if (h.loader.current === "waiting") {
        if (chance(r, 0.15)) h.loader.finish(null);
        else {
          if (chance(r, 0.05)) h.noStage();
          h.loader.finish(h.module);
        }
      }
    } else if (k < 0.48) {
      did("idle");
      const before = new Set(h.stages.flatMap((st) => st.warmups));
      h.idle.runAll();
      const made = h.stage();
      if (made) {
        watchStage(made);
        // A warm-up asked for now counts until something makes the stage cold.
        for (const w of made.warmups) if (!before.has(w)) counting.add(w);
      }
    } else if (k < 0.54) {
      const s = h.stage();
      const w = s?.warmups.find((x) => x.done.length > 0);
      if (w) {
        const ok = chance(r, 0.9);
        if (ok && counting.has(w)) warm = true;
        counting.delete(w);
        did(`warm-up ${ok ? "done" : "failed"}`);
        w.finish(ok);
      }
    } else if (k < 0.57) {
      const s = h.stage();
      if (s && !s.disposed) {
        if (chance(r, 0.6) && !contextLost) {
          realLosses++;
          contextLost = true;
          chill();
          interrupted();
          did("context lost");
          s.events.lost(false);
          shownNow();
        } else if (contextLost) {
          contextLost = false;
          did("context restored");
          s.events.restored();
        }
      }
    } else if (k < 0.66) {
      // Any surface's tap or key takes the dice away, whichever surface threw them.
      const x = pick(r, hosts);
      const e = pick(r, ["down", "click", "up", "cancel", "key"] as const);
      did(`${e} in ${x.name}`);
      if (e === "down") {
        x.handle.pointerDown();
        assert.equal(store.view().shown, null, at("a pointer down takes the dice"));
        interrupted();
      } else if (e === "click") {
        // A click or a cancel always ends a press, even one that began before the throw.
        interrupted();
        x.handle.click();
        shownNow();
      } else if (e === "up") x.handle.pointerUp();
      else if (e === "cancel") {
        interrupted();
        x.handle.pointerCancel();
        shownNow();
      } else {
        interrupted();
        x.handle.keyDown();
        shownNow();
      }
    } else if (k < 0.73) {
      // A surface opens again soon after it closes, as it does at a table. A stat block's panel often opens as a new host, for another creature.
      const x = pick(r, hosts);
      if (x.mounted && chance(r, 0.5)) continue;
      if (!x.mounted) {
        if (x.surface === "block" && chance(r, 0.6)) fresh(x);
        did(`mount ${x.name} #${x.handle.id}`);
        mount(x);
      } else {
        did(`unmount ${x.name}`);
        // React cleans up the tray and the host in either order.
        if (x.tray && chance(r, 0.5)) {
          endFor(x, () => x.detach!());
          x.tray = false;
          x.detach = null;
        }
        unmount(x);
      }
    } else if (k < 0.76) {
      const x = pick(r, hosts);
      if (!x.mounted) continue;
      if (x.visible) {
        did(`hide ${x.name}`);
        endFor(x, () => x.handle.shown(false));
        x.visible = false;
        x.era++;
        drop(x);
      } else {
        did(`show ${x.name}`);
        x.visible = true;
        x.handle.shown(true);
      }
    } else if (k < 0.81) {
      // A tray attaches (the header line's first roll, or the group save page closing), or detaches (the group save page opening).
      const bare = hosts.filter((y) => y.mounted && !y.tray);
      const x = bare.length > 0 && chance(r, 0.7) ? pick(r, bare) : pick(r, hosts);
      if (x.tray) {
        did(`detach ${x.name}`);
        endFor(x, () => x.detach!());
        x.tray = false;
        x.detach = null;
      } else {
        did(`attach ${x.name}`);
        x.tray = true;
        x.detach = x.handle.attach(trayOf(x.name));
        if (!x.held) expected = check();
      }
    } else if (k < 0.87) {
      // A stat block's host holds its rolls from its pick to its header line's layout effect.
      const holding = blocks.filter((b) => b.held);
      const x = holding.length > 0 && chance(r, 0.7) ? pick(r, holding) : pick(r, blocks);
      if (x.held) {
        did(`release ${x.name}`);
        x.held = false;
        x.handle.release();
        expected = check();
      } else {
        did(`hold ${x.name}`);
        x.held = true;
        x.handle.hold();
      }
    } else if (k < 0.89) {
      const x = pick(r, hosts);
      if (chance(r, 0.4)) {
        did(`resize`);
        interrupted();
        store.resized();
        shownNow();
      } else {
        // Reports at the baseline, within its slop, are no resize. A host's own change only moves the baseline.
        const size = pick(r, [500, 500.3, 544, 600]);
        if (chance(r, 0.3)) {
          did(`${x.name} baseline ${size}`);
          x.size = size;
          x.handle.baseline({ width: 300, height: size });
        } else {
          const moved = x.size !== null && Math.abs(x.size - size) > RESIZE_SLOP_PX;
          did(`${x.name} observed ${size}${moved ? " (a resize)" : ""}`);
          if (moved) interrupted();
          x.size = size;
          x.handle.observed({ width: 300, height: size });
          if (moved) shownNow();
        }
      }
    } else if (k < 0.905) {
      if (!h.page.hidden && chance(r, 0.5)) continue;
      h.page.hidden = !h.page.hidden;
      if (h.page.hidden) interrupted();
      did(h.page.hidden ? "page hidden" : "page shown");
      store.visibility(h.page.hidden);
      if (h.page.hidden) {
        chill();
        contextLost = false;
        shownNow();
      }
    } else if (k < 0.935) {
      if (chance(r, 0.15)) {
        // Another dice set: its textures are drawn ahead, and nothing stops.
        const set = pick(r, ["ivory", "ruby", "gold"]);
        did(`set ${set}`);
        store.setInputs({ set });
        continue;
      }
      const key = pick(r, ["on", "lowPower", "reducedMotion", "preview"] as const);
      // A setting that stops the dice is turned back soon, so throws keep coming.
      const stopping = key === "on" ? !inputs.on : inputs[key];
      if (!stopping && chance(r, 0.5)) continue;
      inputs[key] = !inputs[key];
      const stops = key === "on" ? !inputs.on : inputs[key];
      if (stops) interrupted();
      did(`${key} ${inputs[key]}`);
      store.setInputs({ [key]: inputs[key] });
      if (stops) shownNow();
      // Turning the dice off, Low power on or a preview lets the renderer go: the next one starts cold, on a fresh context.
      if (stops && key !== "reducedMotion") {
        chill();
        contextLost = false;
      }
    } else if (k < 0.94) {
      did(`short ${!short}`);
      short = !short;
    } else if (k < 0.945) {
      const s = h.stage();
      if (s && !s.disposed && !s.failPlay) {
        did("the stage breaks");
        s.failPlay = true;
      }
    } else {
      const ms = chance(r, 0.05) ? DISPOSE_MS : pick(r, [16, 30, 100, 250, 400, 700, 999, 1_000, 1_500, 2_500]);
      did(`wait ${ms}`);
      clock.advance(ms);
    }

    // ---------------------------------------------------------- invariants
    const view = store.view();
    const now = clock.now();
    if (expected !== null) assert.equal(play?.tag, expected, at(`a decided tap whose host is live and settled throws (${expected})`));
    assert.equal(plays - playsBefore, expected !== null ? 1 : 0, at("nothing else throws"));
    if (broken) assert.equal(view.held, null, at("a stage that threw never holds a result"));
    if (view.shown) assert.equal(view.shown.host, play?.hostId, at("the shown throw names the host that sent it, whose tray alone draws it"));
    if (view.held !== null) {
      assert.ok(play && play.tag === view.held && !play.reduced, at("only a throw holds its result"));
      assert.ok(now < play.at + LAND_MS, at("a result shows by t0 + 1,000 ms"));
    }
    if (play && !play.interrupted && !play.reduced && now < play.at + LAND_MS) assert.equal(view.held, play.tag, at("a throw holds its result until the dice land, whatever another host does"));
    if (view.shown === null) assert.ok(!h.stage()?.looping(), at("no loop after a throw ends"));
    assert.equal(store.lostContexts, realLosses, at("a deliberate disposal never counts as a lost context"));
    if (closedAt !== null && stageAtClose && now - closedAt >= DISPOSE_MS) assert.equal(stageAtClose.disposed, true, at("the renderer goes within 30 s of the last surface closing"));
  }
}
