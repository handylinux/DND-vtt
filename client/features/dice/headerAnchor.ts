/**
 * How a stat block's panel puts its roll header line in at the top of its
 * scroller without moving anything under a finger
 * (docs/design/design-v1-token-roll-header.md 1.2). The pick records the
 * box and its top on screen. Once React has drawn the line, the host moves
 * the scroller by however far the box went, so the box stands where it
 * stood. Free of React and the DOM's types, so the order of its steps is
 * tested with fakes.
 */

import type { BlockPick } from "./useAbilityMenu.tsx";

/** The parts of the pane's scroller this reads and moves. */
export type AnchorScroller = {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly style: { overflowAnchor: string; scrollPaddingTop: string };
};

/**
 * Where the scroller goes so a box that moved `moved` screen px down stands
 * still: today's `scrollTop` plus that over the zoom. Where the content is
 * too short to scroll that far, the foot spacer grows by the shortfall
 * first, rounded up to a whole px, since `scrollHeight` is rounded. A box
 * that did not move, as in a sheet that grew upward for the line, moves
 * nothing.
 */
export function anchorScroll(m: { moved: number; zoom: number; scrollTop: number; scrollHeight: number; clientHeight: number; spacer: number }): { scrollTop: number; spacer: number } {
  const zoom = m.zoom > 0 ? m.zoom : 1;
  const by = m.moved / zoom;
  if (Math.abs(by) < 0.01) return { scrollTop: m.scrollTop, spacer: m.spacer };
  const scrollTop = Math.max(0, m.scrollTop + by);
  const short = scrollTop - (m.scrollHeight - m.clientHeight);
  return { scrollTop, spacer: short > 0 ? m.spacer + Math.ceil(short) : m.spacer };
}

/** What the host's settling reads and moves. */
export type HeaderAnchorEnv<Box> = {
  /** The box's top on screen now, in screen px. */
  top(box: Box): number;
  /** The pane's scroller around the box, its `[data-pane-body]`. */
  scroller(box: Box): AnchorScroller | null;
  /** The scroller's interface zoom. */
  zoom(scroller: AnchorScroller): number;
  /** The line's stuck height in the scroller's px, its `offsetHeight`, or null while it is not drawn. */
  lineHeight(): number | null;
  /** Sets the foot spacer's height in the scroller's px. */
  spacer(px: number): void;
  /** Scrolls the least that brings the box clear of the scroller's scroll padding (lib/reveal.ts nearInScrollBox). */
  reveal(box: Box): void;
  /** Records the pane's size now as the throw's resize baseline. */
  baseline(): void;
  /** Lets the throw's store decide this host's held rolls, against the box's final place. */
  release(): void;
};

/**
 * One host's line going in and staying (1.2, "The order in the commit").
 * `picked` runs in the pick's click, before React draws: it turns the
 * scroller's own scroll anchoring off for the first insert, so the host is
 * the only mover in every browser. `settle` runs in the host's layout
 * effect after each commit that drew a pick's outcome: the scroll and
 * spacer (first insert), the scroll padding, the keyboard reveal, the
 * anchoring put back (first insert), the baseline (first insert) and last
 * the release, so a throw measures the box where it ends up.
 */
export class HeaderAnchor<Box> {
  readonly #env: HeaderAnchorEnv<Box>;
  /** The line is in: later rolls replace its text in its fixed row and insert nothing. */
  #inserted = false;
  #pick: (BlockPick<Box> & { first: boolean }) | null = null;
  /** The scroller's inline `overflow-anchor` before the first insert turned it off. */
  #anchoring: { scroller: AnchorScroller; prior: string } | null = null;
  /** The scroller's inline `scroll-padding-top` before the line set its own. */
  #padded: { scroller: AnchorScroller; prior: string } | null = null;
  #scroller: AnchorScroller | null = null;
  #spacer = 0;

  constructor(env: HeaderAnchorEnv<Box>) {
    this.#env = env;
  }

  get inserted(): boolean {
    return this.#inserted;
  }

  picked(pick: BlockPick<Box>): void {
    const first = !this.#inserted;
    this.#pick = { ...pick, first };
    if (!first || this.#anchoring || pick.box === null) return;
    const scroller = this.#env.scroller(pick.box);
    if (!scroller) return;
    this.#anchoring = { scroller, prior: scroller.style.overflowAnchor };
    scroller.style.overflowAnchor = "none";
  }

  /** After the commit that drew a pick's outcome. */
  settle(): void {
    const pick = this.#pick;
    this.#pick = null;
    const box = pick?.box ?? null;
    if (box !== null) this.#scroller = this.#env.scroller(box) ?? this.#scroller;
    const scroller = this.#scroller;
    if (pick?.first && box !== null && scroller) {
      const next = anchorScroll({ moved: this.#env.top(box) - pick.top, zoom: this.#env.zoom(scroller), scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, spacer: this.#spacer });
      this.#setSpacer(next.spacer);
      if (next.scrollTop !== scroller.scrollTop) scroller.scrollTop = next.scrollTop;
      // `scrollHeight` never reads below the pane's height, so on content shorter than the pane the shortfall above comes out short too, and the browser stops the scroll where the content ends. With a whole pane more at the foot the content's own height reads true, and the spacer then takes exactly what the scroll needs.
      if (next.scrollTop - scroller.scrollTop > 0.5) {
        this.#setSpacer(this.#spacer + scroller.clientHeight);
        const content = scroller.scrollHeight - this.#spacer;
        this.#setSpacer(Math.max(0, Math.ceil(next.scrollTop + scroller.clientHeight - content)));
        scroller.scrollTop = next.scrollTop;
      }
    }
    if (pick) this.#inserted = true;
    this.pad();
    if (pick?.by === "key" && box !== null) this.#env.reveal(box);
    this.#restoreAnchoring();
    if (pick?.first) this.#env.baseline();
    this.#env.release();
  }

  #setSpacer(px: number): void {
    if (px === this.#spacer) return;
    this.#spacer = px;
    this.#env.spacer(px);
  }

  /** The scroller's scroll padding, the line's stuck height, so a reveal, a field keeper and the browser's own focus scrolling keep a target clear of the line (1.2 step 8). */
  pad(): void {
    const scroller = this.#scroller;
    const height = this.#inserted ? this.#env.lineHeight() : null;
    if (!scroller || height === null) return;
    if (this.#padded?.scroller !== scroller) {
      this.#restorePadding();
      this.#padded = { scroller, prior: scroller.style.scrollPaddingTop };
    }
    const value = `${height}px`;
    if (scroller.style.scrollPaddingTop !== value) scroller.style.scrollPaddingTop = value;
  }

  /** The host goes: whatever it set on the scroller goes back, an anchoring a pick turned off before its effect ran included. */
  unmount(): void {
    this.#restoreAnchoring();
    this.#restorePadding();
    this.#pick = null;
  }

  #restoreAnchoring(): void {
    const a = this.#anchoring;
    this.#anchoring = null;
    if (a) a.scroller.style.overflowAnchor = a.prior;
  }

  #restorePadding(): void {
    const p = this.#padded;
    this.#padded = null;
    if (p) p.scroller.style.scrollPaddingTop = p.prior;
  }
}
