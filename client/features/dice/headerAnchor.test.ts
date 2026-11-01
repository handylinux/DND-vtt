import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { anchorScroll, HeaderAnchor, type HeaderAnchorEnv } from "./headerAnchor.ts";
import { ThrowStore } from "./throw/store.ts";

/*
 * The roll header going in without moving a box
 * (docs/design/design-v1-token-roll-header.md 1.2): the scroll that matches
 * the line, the foot spacer where the content is too short, and the order
 * of the host's steps around the throw's release.
 */

describe("the matching scroll", () => {
  test("a scroller with room scrolls by the box's move", () => {
    assert.deepEqual(anchorScroll({ moved: 57, zoom: 1, scrollTop: 100, scrollHeight: 2000, clientHeight: 600, spacer: 0 }), { scrollTop: 157, spacer: 0 });
  });

  test("the move is in screen px and the scroll in the scroller's, so it divides by the zoom", () => {
    const next = anchorScroll({ moved: 74.1, zoom: 1.3, scrollTop: 40.5, scrollHeight: 2000, clientHeight: 600, spacer: 0 });
    assert.ok(Math.abs(next.scrollTop - (40.5 + 57)) < 0.01, `${next.scrollTop}`);
  });

  test("content too short to scroll that far grows the foot spacer by the whole px shortfall first", () => {
    // 700 of content in a 600 pane scrolls 100 at most: a move of 57 from 80 wants 137.
    assert.deepEqual(anchorScroll({ moved: 57, zoom: 1, scrollTop: 80, scrollHeight: 700, clientHeight: 600, spacer: 0 }), { scrollTop: 137, spacer: 37 });
    assert.deepEqual(anchorScroll({ moved: 57.4, zoom: 1, scrollTop: 0, scrollHeight: 600, clientHeight: 600, spacer: 10 }), { scrollTop: 57.4, spacer: 68 }, "rounded up, on top of the spacer it has");
  });

  test("a box that did not move, as in a sheet that grew upward, moves nothing", () => {
    assert.deepEqual(anchorScroll({ moved: 0, zoom: 1, scrollTop: 30, scrollHeight: 700, clientHeight: 700, spacer: 0 }), { scrollTop: 30, spacer: 0 });
    assert.deepEqual(anchorScroll({ moved: 0.004, zoom: 1.3, scrollTop: 30, scrollHeight: 700, clientHeight: 700, spacer: 0 }), { scrollTop: 30, spacer: 0 });
  });
});

/**
 * A pane with a box in it, whose line goes in at the content's top as the
 * commit draws it. `grows` is a sheet below its cap, which grows upward
 * for the line so the box stays put on screen.
 */
function pane(opts: { zoom?: number; content?: number; client?: number; scrollTop?: number; line?: number; boxAt?: number; grows?: boolean } = {}) {
  const { zoom = 1, content = 2000, client = 600, line = 57, boxAt = 300, grows = false } = opts;
  const steps: string[] = [];
  const state = { inserted: false, spacer: 0, top: opts.scrollTop ?? 0 };
  const style = { overflowAnchor: "", scrollPaddingTop: "" };
  const scroller = {
    style,
    get clientHeight() {
      return grows && state.inserted ? client + line : client;
    },
    // As a browser's: never less than the client height, so content shorter than the pane reads as exactly the pane.
    get scrollHeight() {
      return Math.max(this.clientHeight, content + (state.inserted ? line : 0) + state.spacer);
    },
    get scrollTop() {
      return state.top;
    },
    set scrollTop(v: number) {
      state.top = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight));
      steps.push(`scroll(anchor ${style.overflowAnchor || "auto"})`);
    },
  };
  /** The box's top on screen: below the line once it is in, unless the sheet grew upward for it. */
  const top = () => (boxAt + (state.inserted && !grows ? line : 0) - state.top) * zoom;
  const box = { id: "dex" };
  const env: HeaderAnchorEnv<typeof box> = {
    top: () => top(),
    scroller: () => scroller,
    zoom: () => zoom,
    lineHeight: () => (state.inserted ? line : null),
    spacer: (px) => {
      state.spacer = px;
      steps.push(`spacer ${px}`);
    },
    // As nearInScrollBox does: the least scroll that brings the box below the scroll padding.
    reveal: () => {
      const pad = parseFloat(style.scrollPaddingTop) || 0;
      const by = top() / zoom - pad;
      steps.push(`reveal(pad ${pad})`);
      if (by < 0) state.top += by;
    },
    baseline: () => steps.push("baseline"),
    release: () => steps.push(`release(anchor ${style.overflowAnchor || "auto"}, top ${top().toFixed(2)})`),
  };
  const anchor = new HeaderAnchor(env);
  return {
    anchor,
    box,
    steps,
    style,
    state,
    top,
    /** A pick that draws an outcome, then React's commit and the host's layout effect. */
    roll(by: "pointer" | "key" = "pointer") {
      anchor.picked({ box, top: top(), by });
      steps.push(`picked(anchor ${style.overflowAnchor || "auto"})`);
      state.inserted = true;
      anchor.settle();
    },
  };
}

describe("the host's order (1.2, the order in the commit)", () => {
  test("a first insert: anchoring off before the commit, then the scroll, the padding, the reveal, anchoring back, the baseline, and the release last", () => {
    const p = pane({ scrollTop: 0, boxAt: 30 });
    p.style.overflowAnchor = "auto";
    p.roll("key");
    assert.deepEqual(p.steps, ["picked(anchor none)", "scroll(anchor none)", "reveal(pad 57)", "baseline", "release(anchor auto, top 57.00)"]);
    assert.equal(p.style.overflowAnchor, "auto", "its prior inline value back");
  });

  test("the box stands where it stood, to the px, with room, at 130%, and on short content", () => {
    for (const opts of [{ scrollTop: 200 }, { zoom: 1.3, scrollTop: 40.5 }, { content: 500, client: 600, scrollTop: 0 }, { content: 300, client: 600, scrollTop: 0 }, { zoom: 1.3, content: 200, client: 600, scrollTop: 0 }]) {
      const p = pane(opts);
      const before = p.top();
      p.roll();
      assert.ok(Math.abs(p.top() - before) <= 1, `${JSON.stringify(opts)}: ${before} then ${p.top()}`);
    }
  });

  test("short content takes the spacer before the scroll, and a later roll keeps it", () => {
    // 500 of content in a 600 pane, as a monster's folded panel on a computer: with the line in it still cannot scroll 57.
    const p = pane({ content: 500, client: 600, scrollTop: 0 });
    p.roll();
    const spacers = p.steps.filter((s) => s.startsWith("spacer"));
    assert.equal(spacers.at(-1), "spacer 100", `the spacer ends at the shortfall: ${p.steps.join(", ")}`);
    assert.equal(p.steps.at(p.steps.lastIndexOf("spacer 100") + 1), "scroll(anchor none)", "and the scroll comes after it");
    assert.equal(p.state.top, 57);
    p.steps.length = 0;
    p.roll();
    assert.ok(!p.steps.some((s) => s.startsWith("spacer")), "it stays as it was");
  });

  test("a sheet that grew for the line scrolls nothing", () => {
    const p = pane({ grows: true, scrollTop: 0 });
    const before = p.top();
    p.roll();
    assert.equal(p.state.top, 0);
    assert.equal(p.top(), before);
    assert.ok(!p.steps.some((s) => s.startsWith("scroll") || s.startsWith("spacer")));
  });

  test("a pointer pick never reveals, so a box in the top band stays partly under the line (D-261101-086)", () => {
    const p = pane({ scrollTop: 0, boxAt: 30 });
    p.roll("pointer");
    assert.ok(!p.steps.some((s) => s.startsWith("reveal")));
    assert.equal(p.top(), 30, "unmoved");
  });

  test("a key pick's reveal reads the padding just set, so the first roll clears the box from under the line", () => {
    const p = pane({ scrollTop: 0, boxAt: 30 });
    p.roll("key");
    assert.ok(p.steps.includes("reveal(pad 57)"));
    assert.ok(p.top() >= 57, `the box's top ${p.top()} is under the line's foot`);
  });

  test("a second roll inserts nothing: no scroll, anchoring left alone, the padding kept, a key's reveal, and its release", () => {
    const p = pane({ scrollTop: 300, boxAt: 500 });
    p.roll();
    p.steps.length = 0;
    p.style.overflowAnchor = "auto";
    const scrolled = p.state.top;
    p.roll("key");
    assert.deepEqual(p.steps, ["picked(anchor auto)", "reveal(pad 57)", `release(anchor auto, top ${p.top().toFixed(2)})`]);
    assert.equal(p.state.top, scrolled);
    assert.equal(p.style.scrollPaddingTop, "57px");
  });

  test("an unmount before the effect puts the anchoring back, and the padding goes back to its prior inline value", () => {
    const early = pane();
    early.style.overflowAnchor = "auto";
    early.anchor.picked({ box: early.box, top: early.top(), by: "pointer" });
    assert.equal(early.style.overflowAnchor, "none");
    early.anchor.unmount();
    assert.equal(early.style.overflowAnchor, "auto");

    const p = pane();
    p.style.scrollPaddingTop = "4px";
    p.roll();
    assert.equal(p.style.scrollPaddingTop, "57px", "set while the line is mounted");
    p.anchor.unmount();
    assert.equal(p.style.scrollPaddingTop, "4px");
  });

  test("a later render keeps the padding the line's height", () => {
    const p = pane();
    p.roll();
    p.style.scrollPaddingTop = "";
    p.anchor.pad();
    assert.equal(p.style.scrollPaddingTop, "57px");
  });
});

describe("the resize baseline (4.3)", () => {
  test("the size the line's insert made is the baseline and no resize, while any other size is one", () => {
    const store = new ThrowStore();
    let resizes = 0;
    store.resized = () => void resizes++;
    const host = store.host({ surface: "block", kinds: () => ["d20"] });
    host.mount();
    host.observed({ width: 341, height: 500 });
    // The header's effect records the pane after the line went in (1.2 step 6), then the observer reports it.
    host.baseline({ width: 341, height: 557 });
    host.observed({ width: 341, height: 557.3 });
    assert.equal(resizes, 0);
    host.observed({ width: 341, height: 300 });
    assert.equal(resizes, 1, "a sheet drag, the keyboard, a rotation");
    host.unmount();
  });

  test("the host records the baseline only on the first insert, after its scroll", () => {
    const p = pane();
    p.roll();
    const scroll = p.steps.findIndex((s) => s.startsWith("scroll"));
    assert.ok(scroll >= 0 && p.steps.indexOf("baseline") > scroll);
    p.steps.length = 0;
    p.roll();
    assert.ok(!p.steps.includes("baseline"));
  });
});
