import { EDGE, inToastLayer, nextToastPlaces, restFloor, toastTop, type ColumnFacts, type ToastPlace, type ToastPlaces } from "../canvas/barDock.ts";

/** Places portal hosts in display order without remounting their toast contents. */
export function putToastHosts(stack: HTMLElement, hosts: readonly HTMLElement[]): void {
  const focused = stack.ownerDocument.activeElement as HTMLElement | null;
  let movedFocus = false;
  let at: ChildNode | null = stack.firstChild;
  for (const host of hosts) {
    if (host !== at) {
      movedFocus ||= focused !== null && host.contains(focused);
      stack.insertBefore(host, at);
    }
    at = host.nextSibling;
  }
  // insertBefore detaches even a live portal host, which blurs its action.
  if (movedFocus && focused && stack.ownerDocument.activeElement !== focused) focused.focus({ preventScroll: true });
}

/** The bottom of map toasts that can keep a new toast from moving under its card. */
export function keptMapFoot(boxes: readonly { id: number; bottom: number }[], awaitCard: ReadonlySet<number>, zoom: number): number | null {
  const kept = boxes.filter((b) => !awaitCard.has(b.id));
  return kept.length ? Math.max(...kept.map((b) => b.bottom)) / zoom : null;
}

/** Visible map toasts block a summary row, but only toasts staying there reserve space above a card. */
export function mapToastBox(boxes: readonly { id: number; top: number; bottom: number }[], awaitCard: ReadonlySet<number>, zoom: number, clip: { top: number; bottom: number }): { top: number; bottom: number; keptBottom: number | null } | null {
  const visible = boxes.map((b) => ({ id: b.id, top: Math.max(b.top, clip.top), bottom: Math.min(b.bottom, clip.bottom) })).filter((b) => b.bottom > b.top);
  if (visible.length === 0) return null;
  return { top: Math.min(...visible.map((b) => b.top)) / zoom, bottom: Math.max(...visible.map((b) => b.bottom)) / zoom, keptBottom: keptMapFoot(visible, awaitCard, zoom) };
}

type Box = { top: number; bottom: number };
type MapToastBox = NonNullable<ReturnType<typeof mapToastBox>>;

/** The key a toast's portal keeps in every form, so React never remounts its buttons when the layout changes form. */
export function toastPortalKey(id: number): string {
  return `toast-${id}`;
}

/** The host a toast's portal draws into, made once per toast and kept, so a focused action survives a move between stacks. */
export function toastHostOf(hosts: Map<number, HTMLElement>, id: number, create: () => HTMLElement): HTMLElement {
  let host = hosts.get(id);
  if (!host) {
    host = create();
    hosts.set(id, host);
  }
  return host;
}

/** Which toasts each stack draws, and which are drawn at all: over a band too short for a stack the newest shows as the one row instead. */
export function toastLists<T extends { id: number }>(a: { overBars: boolean; showing: readonly T[]; places: ReadonlyMap<number, ToastPlace>; inSlot: boolean; rowToast: T | undefined }) {
  const overMap = a.overBars ? [] : a.showing.filter((t) => a.places.get(t.id) === "map");
  const inSheet = a.inSlot ? a.showing.filter((t) => a.places.get(t.id) === "sheet") : [];
  const low = a.overBars ? [] : a.showing.filter((t) => inToastLayer(a.places.get(t.id)));
  const mapToasts = [...overMap, ...low];
  const drawn = [...mapToasts, ...(a.rowToast ? [a.rowToast] : [])];
  return { overMap, inSheet, low, mapToasts, drawn };
}

/**
 * The toasts still in the sheet when its slot has closed that were drawn
 * there, which are dismissed with it. A toast that waited undrawn behind the
 * slot's one row was never seen, so it is kept and placed as a new toast
 * (`unseenOutOfSheet`, D-261101-390).
 */
export function sheetToastsToDismiss(inSlot: boolean, places: ReadonlyMap<number, ToastPlace>, shown: ReadonlySet<number>): number[] {
  if (inSlot) return [];
  return [...places].flatMap(([id, place]) => (place === "sheet" && shown.has(id) ? [id] : []));
}

/** The places with the sheet's place taken off every toast not drawn yet, once the slot is gone: they are placed as new toasts, over the map. */
function unseenOutOfSheet(was: ToastPlaces, shown: ReadonlySet<number>): ToastPlaces {
  if (![...was.places].some(([id, place]) => place === "sheet" && !shown.has(id))) return was;
  return { ...was, places: new Map([...was.places].filter(([id, place]) => place !== "sheet" || shown.has(id))) };
}

/** The lower of two floors, where either may be unset: what is left above both is the toasts' room. */
export function lowerFloor(a: number | null, b: number | null): number | null {
  return a === null ? b : b === null ? a : Math.min(a, b);
}

/**
 * Settles the hosts after a render. The hosts of toasts that went come out
 * first, so the ones after them are already in order and stay put: moving a
 * host that holds focus would blur it (review FU22B-ASTRA-01).
 */
export function settleToastHosts<T extends { id: number }>(hosts: Map<number, HTMLElement>, drawn: readonly T[], stacks: readonly (readonly [HTMLElement | null, readonly T[]])[]): void {
  const kept = new Set(drawn.map((t) => t.id));
  for (const [id, host] of hosts) {
    if (kept.has(id)) continue;
    host.remove();
    hosts.delete(id);
  }
  for (const [stack, list] of stacks) {
    if (!stack) continue;
    putToastHosts(
      stack,
      list.flatMap((t) => {
        const host = hosts.get(t.id);
        return host ? [host] : [];
      }),
    );
  }
}

/** What the lasting notices tell the bar dock. Spanning the map they push the alerts column down, and beside its lane they leave it be, but the bar and the tool's options keep clear either way. */
export function noticesDock(besideLane: boolean, bottom: number | null): { notices: number | null; lasting: number | null; noticesSpanning: boolean } {
  return { notices: besideLane ? null : bottom, lasting: bottom, noticesSpanning: !besideLane };
}

/**
 * The toasts' places for this render. A toast can age out of the card wait
 * on the render that brings the first card, so the places wait for that card
 * to clear it before committing a new toast below the card.
 */
export function placeRoomToasts(a: {
  was: ToastPlaces;
  ids: readonly number[];
  recent: ReadonlySet<number>;
  spanning: boolean;
  restFloor: number | null;
  /** The resting floor of the render before, and the foot of the layer's stack as last drawn. */
  floorWas: number | null;
  layerFoot: number | null;
  measured: { boxes: readonly { id: number; top: number; bottom: number }[]; clip: Box } | null;
  zoom: number;
  pane: number | null;
  paneStands: boolean;
  low: number | null;
  columnTop: number | null;
  layer: boolean;
  slot: boolean;
  turned: boolean;
  mapFoot: number | null;
  overBar: { ids: ReadonlySet<number>; at: number | null; opening: number | null } | undefined;
  turnStarted: boolean;
  /** The toasts that have been drawn (`shownAt`), so a toast that only waited in the very short sheet's slot is not lost with it. */
  shown: ReadonlySet<number>;
}): ToastPlaces {
  const was = a.slot ? a.was : unseenOutOfSheet(a.was, a.shown);
  // As resting begins, and each time the strip's top rises, a stack in the layer whose foot as last drawn is lower than the room's new foot takes its place anew (barDock.ts nextToastPlaces `anew`, 3.5).
  const rose = a.restFloor !== null && (a.floorWas === null || a.restFloor < a.floorWas - 0.5);
  const anew = rose && a.layerFoot !== null && a.layerFoot > a.restFloor! ? new Set(a.ids) : undefined;
  const mapBefore = a.spanning && a.measured ? mapToastBox(a.measured.boxes.filter((b) => a.ids.includes(b.id)), new Set([...was.awaitCard].filter((id) => a.recent.has(id))), a.zoom, a.measured.clip) : null;
  const cardSettled = mapBefore?.keptBottom == null || (a.columnTop !== null && a.columnTop + 0.5 >= mapBefore.keptBottom + EDGE);
  return nextToastPlaces(was, {
    ids: a.ids,
    pane: a.pane,
    paneStands: a.paneStands,
    low: cardSettled ? a.low : null,
    cardMeasured: cardSettled && a.columnTop !== null,
    layer: a.layer,
    slot: a.slot,
    turned: a.turned,
    mapFoot: a.mapFoot,
    recent: a.recent,
    overBar: a.overBar,
    anew,
    turnStarted: a.turnStarted,
  });
}

/**
 * Reads the boxes of the toasts over the map after their hosts are placed.
 * `changed` says whether the clearance the column reads differs from `wasMap`.
 * Do not reserve the waiting toast's temporary map position: it moves below
 * the measured card, and feeding it back into that card would move both again.
 */
export function measureMapToasts(a: {
  notices: { getBoundingClientRect(): Box } | null;
  overMap: readonly { id: number }[];
  boxOf(id: number): Box | undefined;
  awaitCard: ReadonlySet<number>;
  zoom: number;
  spanning: boolean;
  wasMap: MapToastBox | null;
}) {
  const boxes = a.overMap.flatMap((t) => {
    const box = a.boxOf(t.id);
    return box ? [{ id: t.id, top: box.top, bottom: box.bottom }] : [];
  });
  const mapFoot = keptMapFoot(boxes, a.awaitCard, a.zoom);
  const measured = a.notices ? { boxes, clip: a.notices.getBoundingClientRect() } : null;
  const mapBox = a.spanning && measured ? mapToastBox(boxes, a.awaitCard, a.zoom, measured.clip) : null;
  const was = a.wasMap;
  const changed = mapBox === null ? was !== null : was === null || was.top !== mapBox.top || was.bottom !== mapBox.bottom || was.keptBottom !== mapBox.keptBottom;
  return { boxes, mapFoot, measured, mapBox, changed };
}

/**
 * The foot of the room a phone's open sheet leaves the toasts, in the
 * chrome's own px, or null where the sheet sets none (UNDOB-FIN-2). Over a
 * bottom sheet it is a resting strip's rule (barDock.ts restFloor), 60 px
 * above the sheet's top. The sheet's foot stands on the toolbar, or on the
 * on-screen keyboard where that reaches higher (`keyboard`, the px of the
 * layout's foot it hides, as sheetCap.ts sheetFoot). Beside a sideways sheet
 * there is no room, so the newest shows as the one row over the top bar.
 * A full sheet holds its own toasts (modalSlot.tsx), and a wide screen has
 * no sheet. Until the toolbar and the sheet are measured it sets nothing.
 */
export function sheetToastFloor(a: { mode: "none" | "bottom" | "side" | "full"; height: number; toolbar: number | null; sheetHeight: number; keyboard: number | null }): number | null {
  if (a.mode === "side") return 0;
  if (a.mode !== "bottom" || a.toolbar === null || a.sheetHeight <= 0) return null;
  return restFloor(a.height - Math.max(a.toolbar, a.keyboard ?? 0) - a.sheetHeight);
}

/**
 * Where a toast that shows now starts below the alert cards (barDock.ts toastTop), kept clear of an open sheet: it starts there only where a
 * whole toast fits above the sheet's floor too, else it stays at the top of the notices, above the cards. The token bar's options keep their own top (D-261101-310).
 */
export function toastStartTop(a: { spanning: boolean; column: ColumnFacts | null; cards: boolean; optionsTop: number; sheetFloor: number | null }): number | null {
  return toastTop({ spanning: a.spanning, column: a.column, cards: a.cards, optionsTop: Math.min(a.optionsTop, a.sheetFloor ?? Infinity) });
}
