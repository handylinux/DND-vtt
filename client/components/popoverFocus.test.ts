import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { KeyOpening } from "./popoverFocus.ts";

/*
 * A key opening whose content is still loading (components/Popover.tsx):
 * focus waits on the box and moves in once the content changes under it,
 * unless it went somewhere else first.
 */

type Content = "loading" | "rows" | "failed with Reload" | "failed, Reload disabled";
type Focus = "box" | "first row" | "last row" | "Reload" | "anchor" | "a choice";

function popover(content: Content) {
  const state = { content, focus: "anchor" as Focus, calls: 0 };
  const opening = new KeyOpening({
    focusInside(from) {
      state.calls++;
      if (state.content === "rows") state.focus = from === "first" ? "first row" : "last row";
      else if (state.content === "failed with Reload") state.focus = "Reload";
      else state.focus = "box";
    },
    waiting: () => state.focus === "box",
  });
  /** The content changes, and the page's mutation watch reports it. */
  const swap = (next: Content) => {
    state.content = next;
    opening.changed();
  };
  /** Focus moves, and the page's focusin reports where. */
  const move = (to: Focus) => {
    state.focus = to;
    opening.moved(to === "box");
  };
  return { state, opening, swap, move };
}

describe("a key opening (components/popoverFocus.ts)", () => {
  test("with its rows there, lands on the first, or the last after Up, and owes nothing after", () => {
    for (const from of ["first", "last"] as const) {
      const p = popover("rows");
      p.opening.focus(from);
      assert.equal(p.state.focus, from === "first" ? "first row" : "last row");
      p.move("a choice");
      p.swap("rows");
      assert.equal(p.state.focus, "a choice", "a later swap takes focus from nowhere");
      assert.equal(p.state.calls, 1);
    }
    // Focus put on the box by a press after a key opening landed: the next swap leaves it there.
    const p = popover("rows");
    p.opening.focus("first");
    p.move("box");
    p.swap("rows");
    assert.equal(p.state.focus, "box");
  });

  test("focus that fell to the page, with no focusin to say so, is not pulled back in", () => {
    const p = popover("loading");
    p.opening.focus("first");
    p.state.focus = "anchor";
    p.swap("rows");
    assert.equal(p.state.focus, "anchor");
  });

  test("while its rows load, waits on the box, and lands on the first or the last as asked once they arrive", () => {
    for (const from of ["first", "last"] as const) {
      const p = popover("loading");
      p.opening.focus(from);
      assert.equal(p.state.focus, "box");
      // The loading line's own change: still nothing to take it.
      p.swap("loading");
      assert.equal(p.state.focus, "box");
      p.swap("rows");
      assert.equal(p.state.focus, from === "first" ? "first row" : "last row");
      // Settled: the next change moves nothing.
      const calls = p.state.calls;
      p.swap("rows");
      assert.equal(p.state.calls, calls);
    }
  });

  test("a failed load puts it on Reload, and with Reload disabled it keeps waiting on the box", () => {
    const p = popover("loading");
    p.opening.focus("first");
    p.swap("failed with Reload");
    assert.equal(p.state.focus, "Reload");
    const q = popover("loading");
    q.opening.focus("first");
    q.swap("failed, Reload disabled");
    assert.equal(q.state.focus, "box");
    q.swap("failed with Reload");
    assert.equal(q.state.focus, "Reload");
  });

  test("focus moved away before the rows arrive stays where it went", () => {
    for (const to of ["anchor", "a choice"] as const) {
      const p = popover("loading");
      p.opening.focus("last");
      p.move(to);
      p.swap("rows");
      assert.equal(p.state.focus, to);
      // Back on the box after that is not the opening's: it was settled.
      p.move("box");
      p.swap("rows");
      assert.equal(p.state.focus, "box");
    }
  });

  test("a press on the box itself while loading keeps the opening owed", () => {
    const p = popover("loading");
    p.opening.focus("last");
    p.move("box");
    p.swap("rows");
    assert.equal(p.state.focus, "last row");
  });

  test("Down or Up on the anchor while its rows load is an opening of its own, and the newer direction wins", () => {
    const p = popover("loading");
    p.opening.focus("first");
    p.move("anchor");
    p.opening.focus("last");
    p.swap("rows");
    assert.equal(p.state.focus, "last row");
  });

  test("a pointer opening owes nothing: focus stays on the anchor as the rows arrive", () => {
    const p = popover("loading");
    p.swap("rows");
    assert.equal(p.state.focus, "anchor");
    assert.equal(p.state.calls, 0);
  });
});
