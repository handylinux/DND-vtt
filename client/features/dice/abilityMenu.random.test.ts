import "../../components/testing/register.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { int, rng } from "#shared/testutil.ts";

/*
 * Random sequences of presses on an ability box and its list
 * (docs/design-v1-stat-block-rolls.md 11): box and row taps and holds,
 * moves, scrolls, cancels, keys, reader clicks, picks, Escape, Back, a
 * held roll's change, the window's blur and an unmount, on a fake clock,
 * through the real control and press registry (abilityMenu.testing.ts).
 */

const { harness } = await import("./abilityMenu.testing.ts");

const EVENTS = ["tap box", "hold box", "tap row", "hold row", "move", "up", "up quietly", "cancel", "scroll", "key", "reader click", "tap choice", "back", "source change", "right-click", "wait", "blur", "unmount"] as const;
const KEYS = ["Escape", "ArrowDown", "ArrowUp", "ContextMenu", "Enter", " ", "a"] as const;
const ROWS = ["check", "save", "stealth", "ask"] as const;

test("random sequences: one view, one roll per activation, no roll from a hold's own click or a step back, a reader's click acts once, a held finger's drag is kept until it lifts, and nothing is left after an unmount", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 300; seed++) {
    const random = rng(seed);
    const h = harness();
    let held = false;
    let heldFinger: number | null = null;
    for (let step = 0; step < 60; step++) {
      const event = EVENTS[int(random, 0, EVENTS.length - 1)]!;
      if (event === "unmount" && step < 40) continue;
      seen.add(event);
      const rolls = h.log.rolls.length;
      const shows = h.log.shows.length;
      const options = h.state.open && h.state.drawn.kind === "options";
      const where = `seed ${seed} step ${step} ${event}`;
      const rowId = ROWS[int(random, 0, ROWS.length - 1)]!;
      switch (event) {
        case "tap box":
          h.tap("box", int(random, 0, 1) === 0);
          held = false;
          break;
        case "hold box":
        case "hold row": {
          if (h.pressing()) h.up(false);
          const drawn = () => h.state.drawn.kind;
          const before = drawn();
          h.hold(event === "hold box" ? "box" : `row:${rowId}`, int(random, 0, 650));
          held = h.log.shows.length > shows || (before !== "options" && drawn() === "options");
          heldFinger = held ? h.finger() : null;
          break;
        }
        case "tap row":
          h.tap(`row:${rowId}`, int(random, 0, 1) === 0);
          held = false;
          break;
        case "move": {
          const kept = h.move(int(random, 0, 20));
          if (held && h.pressing()) assert.equal(kept, true, `a held finger scrolls nothing until it lifts: ${where}`);
          if (held && h.pressing() && h.state.drawn.kind === "options") {
            seen.add("drag after a swap");
            assert.equal(h.state.drawn.fit, false, `a held finger keeps the rows' box: ${where}`);
          }
          if (h.pressing() && !held) assert.equal(kept, false, `an unheld finger scrolls: ${where}`);
          break;
        }
        case "up":
        case "up quietly": {
          const wasHeld = held && h.pressing();
          const finger = h.finger();
          h.up(event === "up");
          if (wasHeld) assert.equal(h.log.rolls.length, rolls, `the hold's own click rolls nothing, its row drawn or not: ${where}`);
          if (wasHeld && event === "up" && h.state.drawn.kind === "options") seen.add("release over a choice");
          if (finger !== null) assert.equal(h.doc.fire("touchmove", { changedTouches: [{ identifier: finger }] }).defaultPrevented, false, `never after it lifts: ${where}`);
          held = false;
          heldFinger = null;
          break;
        }
        case "cancel":
          h.cancel();
          held = false;
          break;
        case "scroll":
          h.scroll();
          if (!h.pressing()) held = false;
          break;
        case "key": {
          const key = KEYS[int(random, 0, KEYS.length - 1)]!;
          const stepsBack = key === "Escape" && options;
          h.key(key, false);
          if (stepsBack) assert.equal(h.log.rolls.length, rolls, `no roll on a step back: ${where}`);
          held = false;
          break;
        }
        case "reader click": {
          const view = h.state.drawn;
          const row = view.kind === "options" ? h.rows.find((r) => r.id === view.row) : undefined;
          const ready = options && row !== undefined && view.kind === "options" && row.source === view.source && h.state.blocked === null && !h.state.busy.has(row.rowKey);
          if (h.pressing()) h.up(false);
          held = false;
          h.click("choice:adv", 0);
          if (ready) {
            seen.add("reader pick");
            assert.equal(h.log.rolls.length, rolls + 1, `a reader's click on an enabled choice acts once: ${where}`);
            assert.equal(h.state.open, false);
          }
          break;
        }
        case "tap choice":
          h.tap("choice:adv", int(random, 0, 1) === 0);
          held = false;
          break;
        case "back": {
          h.back();
          if (options) assert.equal(h.log.rolls.length, rolls, `no roll on a step back: ${where}`);
          break;
        }
        case "source change": {
          const i = int(random, 0, h.rows.length - 1);
          h.rows[i] = { ...h.rows[i]!, source: `${h.rows[i]!.id}@${step}` };
          h.control.revalidate(h.rows, h.state.blocked);
          const view = h.state.drawn;
          if (view.kind === "options") assert.equal(h.rows.find((r) => r.id === view.row)?.source, view.source, `options never stand for a changed roll: ${where}`);
          break;
        }
        case "right-click":
          // Another pointer's press ends a held one, as on every roll button.
          h.rightClick(int(random, 0, 1) === 0 ? "box" : `row:${rowId}`);
          held = false;
          break;
        case "wait":
          h.clock.advance(int(random, 0, 700));
          if (h.log.shows.length > shows || (!options && h.state.open && (h.state.drawn as { kind: string }).kind === "options")) {
            held = true;
            heldFinger = h.finger();
          }
          break;
        case "blur":
          h.leave();
          assert.equal(h.state.open, false, `the window's blur closes the list: ${where}`);
          held = false;
          break;
        case "unmount": {
          h.unmount();
          const after = { rolls: h.log.rolls.length, shows: h.log.shows.length };
          h.tap("box");
          h.tap("row:save");
          h.click("choice:adv", 0);
          h.clock.advance(1000);
          assert.deepEqual({ rolls: h.log.rolls.length, shows: h.log.shows.length }, after, `nothing after an unmount: ${where}`);
          assert.equal(h.registry.size, 0, `no machine left: ${where}`);
          assert.equal(h.clock.timers.size, 0, `no timer left: ${where}`);
          assert.equal(h.win.count + h.doc.count, 0, `no listener left: ${where}`);
          break;
        }
      }
      if (!h.state.mounted) break;
      assert.ok(h.log.rolls.length - rolls <= 1, `at most one roll per activation: ${where}`);
      assert.ok(h.log.shows.length - shows <= 1, `at most one opening: ${where}`);
      if (!h.state.open) assert.equal(h.control.view.kind, "list", `a closed list holds no options: ${where}`);
      assert.deepEqual(h.state.drawn, h.control.view, `the drawn view is the control's: ${where}`);
      if (!h.pressing()) {
        if (h.state.open && h.state.drawn.kind === "options") assert.equal(h.state.drawn.fit, true, `with no finger down, the options have their own box: ${where}`);
        assert.equal(h.clock.timers.size, 0, `no timer without a press: ${where}`);
        assert.equal((h.doc.listeners.get("touchmove")?.size ?? 0), 0, `no consumed touch without a finger down: ${where}`);
      }
      void heldFinger;
    }
    if (h.state.mounted) {
      h.unmount();
      assert.equal(h.registry.size, 0);
      assert.equal(h.clock.timers.size, 0);
      assert.equal(h.win.count + h.doc.count, 0);
    }
  }
  for (const event of [...EVENTS, "drag after a swap", "release over a choice", "reader pick"]) assert.ok(seen.has(event), `the runs never reached: ${event}`);
});
