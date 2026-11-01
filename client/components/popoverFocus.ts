/**
 * A key opening moves focus into the popover (popoverRules.ts openFocus):
 * a menu's first or last item, or the first control. Content that is still
 * loading, such as an ability's rolls before the SRD's table arrives, has
 * nothing to take it, so focus waits on the popover's own box, where arrows
 * and Enter reach no menu. The opening is then owed: once the content
 * changes while focus still waits on the box, it completes, first or last
 * as it was asked. Focus moved anywhere else settles it, so a later swap
 * never takes focus from where the person or the consumer put it.
 */
export type KeyOpeningEnv = {
  /** Focus into the content as a key opening does, or onto the box when nothing inside takes it. */
  focusInside(from: "first" | "last"): void;
  /** Focus is on the box itself. */
  waiting(): boolean;
};

export class KeyOpening {
  readonly #env: KeyOpeningEnv;
  #owed: "first" | "last" | null = null;

  constructor(env: KeyOpeningEnv) {
    this.#env = env;
  }

  /** A key opening, or Down or Up on the anchor while open. */
  focus(from: "first" | "last"): void {
    this.#env.focusInside(from);
    this.#owed = this.#env.waiting() ? from : null;
  }

  /** The content changed: an opening still owed completes. */
  changed(): void {
    if (this.#owed !== null && this.#env.waiting()) this.focus(this.#owed);
  }

  /** Focus arrived somewhere. Only the box itself keeps the opening owed. */
  moved(toBox: boolean): void {
    if (!toBox) this.#owed = null;
  }
}
