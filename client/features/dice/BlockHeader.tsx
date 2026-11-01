import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref, type RefObject, type SyntheticEvent } from "react";
import { labelText } from "#shared/logText.ts";
import type { DiceRoll } from "#shared/model.ts";
import { Loading } from "../../components/Loading.tsx";
import { VISUALLY_HIDDEN } from "../../lib/a11y.ts";
import { nearInScrollBox } from "../../lib/reveal.ts";
import { theme } from "../../lib/theme.ts";
import { effectiveZoom } from "../device/layout.ts";
import { usePanelShown } from "../panels.ts";
import { HeaderAnchor, type AnchorScroller } from "./headerAnchor.ts";
import { ResultRest, ResultTotal, shownVerdict, useCommittedRoll } from "./Roller.tsx";
import { effectiveRollMode, type RollModeOverride } from "./rollMode.ts";
import type { DieKind } from "./throw/layout.ts";
import type { ThrowHost } from "./throw/store.ts";
import { Tray } from "./throw/Tray.tsx";
import { useThrowSurface, useThrowView, type ThrowSurfaceProps } from "./throw/useThrows.ts";
import type { BlockPick, BlockSent } from "./useAbilityMenu.tsx";
import { useReceipt, useReceiptVoice } from "./useReceipt.ts";
import { useInitiativeChanged } from "./useRollOption.ts";

/*
 * The roll header on a token's panel and a character's page
 * (docs/design/design-v1-token-roll-header.md): the Dice panel's sticky
 * result line at the top of the panel's scroller, with the panel's own
 * dice tray under it. The host wraps the panel's content, is keyed by the
 * panel's creature, and keeps the newest roll from its stat block until it
 * unmounts (D-261101-081).
 */

/**
 * What a stat block's ability grid last did: a roll it sent, or a tap whose
 * roll did not go, with why (docs/design/design-v1-stat-block-rolls.md 8).
 */
export type BlockOutcome = { kind: "sent"; sent: BlockSent } | { kind: "unsent"; words: string };

const ROLLING = "Rolling…";

/** The scrolling pane's top padding, which its body publishes (components/Sheet.tsx paneBodyPadding). 0 outside a pane. */
const PAD_TOP = "var(--pane-pad-top, 0px)";

/** The only dice a stat block rolls: a d20, and a d4 for Bless or Guidance, which the warm-up draws first. */
const BLOCK_KINDS = (): DieKind[] => ["d20", "d4"];

/**
 * The words a roll from a choice adds to the header line (D-261031-134),
 * from the returned roll and never from the item picked: a Restrained tap
 * and a picked Disadvantage come back alike, so `override` only decides
 * whether the line names a mode at all. A tap names none, and neither does
 * "Normal" ever.
 */
export function modeWords(override: RollModeOverride | undefined, roll: Pick<DiceRoll, "mode" | "cancelled"> | undefined, secret: boolean): string {
  if (override === "secret") return secret ? "secret" : "";
  if (override !== "adv" && override !== "dis") return "";
  if (roll?.mode === "adv") return "with Advantage";
  if (roll?.mode === "dis") return "with Disadvantage";
  return roll?.cancelled ? "Advantage and Disadvantage cancelled" : "";
}

/** What a rolling grid reaches its panel's host through. */
export type BlockHeaderApi = {
  /** The panel's throw host while a grid in it rolls, else null. */
  throwHost: ThrowHost | null;
  /** A grid that rolls is in the panel. The returned function is its going. */
  rolls(): () => void;
  /** Before a pick sends. */
  hold(): void;
  sent(sent: BlockSent, pick: BlockPick<HTMLElement>): void;
  unsent(words: string, pick: BlockPick<HTMLElement>): void;
  /** At the end of a pick's handler. */
  picked(): void;
};

const BlockHeaderContext = createContext<BlockHeaderApi | null>(null);

/** The panel's header host around a grid, or null where the grid stands in none. */
export function useBlockHeader(): BlockHeaderApi | null {
  return useContext(BlockHeaderContext);
}

type Bound = { host: ThrowHost; props: ThrowSurfaceProps; rebase(): void };

/**
 * The host of a stat block's panel. It is a rolling surface of the throw's
 * store only while a grid in it rolls, so a panel nobody may roll from
 * never warms the dice (D-261101-091): the binding mounts with the first
 * rolling grid and goes with the last. The binding's capture listeners are
 * forwarded from the host's own box, so its content never remounts as
 * grids come and go.
 */
export function BlockHeaderHost(props: { children: ReactNode }) {
  const [outcome, setOutcome] = useState<BlockOutcome | null>(null);
  const [grids, setGrids] = useState(0);
  const [bound, setBound] = useState<Bound | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const boundRef = useRef(bound);
  boundRef.current = bound;
  // Whether the pick being handled drew an outcome, whose layout effect then releases.
  const drew = useRef(false);
  const settled = useRef<BlockOutcome | null>(null);
  const [anchor] = useState(
    () =>
      new HeaderAnchor<HTMLElement>({
        top: (box) => box.getBoundingClientRect().top,
        scroller: (box) => box.closest<HTMLElement>("[data-pane-body]") as (HTMLElement & AnchorScroller) | null,
        zoom: (scroller) => effectiveZoom(scroller as unknown as HTMLElement),
        lineHeight: () => line.current?.offsetHeight ?? null,
        spacer: (px) => {
          if (spacer.current) spacer.current.style.height = `${px}px`;
        },
        reveal: (box) => nearInScrollBox(box),
        baseline: () => boundRef.current?.rebase(),
        release: () => boundRef.current?.host.release(),
      }),
  );

  // The header's layout effect (1.2, "The order in the commit"): after the commit that drew a pick's outcome, the tray in it already attached, it settles and releases. Every other render only keeps the scroll padding the line's height.
  useLayoutEffect(() => {
    if (outcome === settled.current) return anchor.pad();
    settled.current = outcome;
    if (outcome) anchor.settle();
  });
  useLayoutEffect(() => () => anchor.unmount(), [anchor]);

  const throwHost = bound?.host ?? null;
  // Stable, so a grid's registration never goes and comes back as the binding changes.
  const [rolls] = useState(() => () => {
    setGrids((n) => n + 1);
    return () => setGrids((n) => n - 1);
  });
  const api = useMemo<BlockHeaderApi>(
    () => ({
      throwHost,
      rolls,
      hold: () => {
        drew.current = false;
        boundRef.current?.host.hold();
      },
      sent: (sent, pick) => {
        drew.current = true;
        anchor.picked(pick);
        setOutcome({ kind: "sent", sent });
      },
      unsent: (words, pick) => {
        drew.current = true;
        anchor.picked(pick);
        setOutcome({ kind: "unsent", words });
      },
      picked: () => {
        // A pick that sends nothing and draws nothing, an ask or "Initiative score", releases here (1.2).
        if (!drew.current) boundRef.current?.host.release();
        drew.current = false;
      },
    }),
    [throwHost, rolls, anchor],
  );
  const [forward] = useState(() => {
    const to = (name: Exclude<keyof ThrowSurfaceProps, "ref">) => (e: SyntheticEvent) => (boundRef.current?.props[name] as ((e: SyntheticEvent) => void) | undefined)?.(e);
    return { onPointerDownCapture: to("onPointerDownCapture"), onPointerUpCapture: to("onPointerUpCapture"), onPointerCancelCapture: to("onPointerCancelCapture"), onClickCapture: to("onClickCapture"), onKeyDownCapture: to("onKeyDownCapture") };
  });
  return (
    <div ref={root} data-block-header-host="" {...forward}>
      {grids > 0 ? <ThrowBinding root={root} onBound={setBound} /> : null}
      <BlockHeaderContext.Provider value={api}>
        {outcome ? <BlockHeader outcome={outcome} host={throwHost} lineRef={line} /> : null}
        {props.children}
      </BlockHeaderContext.Provider>
      {/* Room at the content's foot for the scroll that keeps the boxes still where the content is too short (1.2 step 4). Its height is set from the layout effect, never by React, and stays while the header does. */}
      <div ref={spacer} aria-hidden="true" data-block-header-spacer="" />
    </div>
  );
}

/**
 * The host's part in the throw's store, while a grid in it rolls. Its root
 * is the host's own box: set in a layout effect, before the surface's
 * passive effects read it for the pane's size and the roll menus' origins.
 */
function ThrowBinding(props: { root: RefObject<HTMLDivElement | null>; onBound(bound: Bound | null): void }) {
  const surface = useThrowSurface("block", BLOCK_KINDS);
  const { root, onBound } = props;
  useLayoutEffect(() => {
    surface.props.ref.current = root.current;
    onBound({ host: surface.host, props: surface.props, rebase: surface.rebase });
    return () => onBound(null);
  }, [surface.host, surface.props, surface.rebase, root, onBound]);
  return null;
}

/** Plain words in the line: two lines at most of small type, then "…". The words stay whole for the alert, the live region and the pointer's title (3.2). */
function Words(props: { text: string; alert?: boolean; color: string }) {
  return (
    <span
      {...(props.alert ? { role: "alert" } : {})}
      title={props.text}
      style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden", minWidth: 0, fontSize: theme.font.small, lineHeight: theme.leading.tight, color: props.color, overflowWrap: "anywhere" }}
    >
      {props.text}
    </span>
  );
}

/** The line's row: exactly a touch target tall in every state, so no later state grows it and moves the content (3.2). */
const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: theme.space(2),
  height: theme.touch,
  boxSizing: "border-box",
  minWidth: 0,
  overflow: "hidden",
  // Its one row never sets a width above it, so a long label ellipsizes rather than widening the panel (LP27-A-BLOCK-1).
  contain: "inline-size",
  fontSize: theme.font.body14,
  lineHeight: theme.leading.tight,
};

/**
 * The newest roll from the panel's stat block, at the top of its scroller.
 * It follows the tag through the receipts like the Dice panel's sticky
 * line and shows the same roll the same way, without Again or a tap
 * through (D-261101-082, D-261101-084). While the dice fly it keeps what it
 * showed at the answer. As the sender it claims the roll's voice, so it
 * alone says the result and the refusal while it is mounted and shown
 * (D-261031-133).
 */
export function BlockHeader(props: { outcome: BlockOutcome; host: ThrowHost | null; lineRef?: Ref<HTMLDivElement> }) {
  const { outcome } = props;
  const sentTag = outcome.kind === "sent" ? outcome.sent.tag : null;
  // A hidden sheet or pane keeps this mounted. It then neither watches the roll nor holds its voice, so the toast or a shown Dice panel can say it.
  const shown = usePanelShown();
  const tag = shown ? sentTag : null;
  const receipt = useReceipt(tag);
  const speaks = useReceiptVoice(tag, true);
  const thrown = useThrowView();
  const holding = tag !== null && thrown.held === tag;
  const { first, head, data, level, said } = useCommittedRoll(receipt, outcome.kind === "sent" ? outcome.sent.label : undefined);
  const changed = useInitiativeChanged(tag);
  const muted = theme.color.textMuted;
  let body: ReactNode;
  if (outcome.kind === "unsent") body = <Words alert text={outcome.words} color={theme.color.dangerText} />;
  else if (!receipt || receipt.state === "sending" || receipt.state === "checking") body = <Loading text={ROLLING} live={false} />;
  // The dice are in the air: the line stays as it was, "Rolling…" only where the wait was long enough to say it, so at once.
  else if (receipt.state === "committed" && holding) body = <Loading text={ROLLING} active={thrown.rolling} delay={0} live={false} />;
  else if (receipt.state === "refused") body = <Words alert={speaks} text={receipt.text || receipt.message} color={theme.color.dangerText} />;
  else if (receipt.state === "unknown") body = <Words text="This may have happened. Check the log." color={muted} />;
  else if (!first || !head) body = <Words text="Rolled. Its result is no longer in the log." color={muted} />;
  else {
    const label = head.label !== undefined ? labelText(head.label) : outcome.sent.label;
    const mode = modeWords(outcome.sent.override, first, data?.type === "dice" && data.to === "dm");
    const rest = <ResultRest sum={head.sums} label={label} level={level} dice={head.dice} more={head.more} verdict={shownVerdict(first, data)} mode={mode || undefined} />;
    body = (
      <div aria-description={effectiveRollMode(first, data?.type === "dice" && data.to === "dm") || undefined} style={{ display: "flex", alignItems: "center", gap: theme.space(2), minWidth: 0, flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}>
        <ResultTotal total={head.total} />
        {changed ? (
          // Initiative written too late: a second small row under the label and chips, inside the same 44 px (D-261101-092).
          <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            {rest}
            <span data-block-header-note="" style={{ fontSize: theme.font.small, lineHeight: theme.leading.tight, color: muted, overflow: "hidden", textOverflow: "ellipsis" }}>
              {changed}
            </span>
          </span>
        ) : (
          rest
        )}
      </div>
    );
  }
  return (
    <div
      ref={props.lineRef}
      data-block-header=""
      style={{
        position: "sticky",
        top: `calc(-1 * ${PAD_TOP})`,
        zIndex: theme.z.stickyHeader,
        // As the Dice panel's line: only the top takes the pane's padding back, given half above the row and half below it, so the row sits in the middle of the painted box, resting or stuck.
        margin: `calc(-1 * ${PAD_TOP}) 0 0`,
        padding: `calc(${PAD_TOP} / 2) 0`,
        background: theme.color.surface,
        borderBottom: `${theme.line.border}px solid ${theme.color.border}`,
        // Over the pane's side padding too, so the portrait's ring never shows beside it (D-261101-093).
        boxShadow: theme.shadow.paneSides(theme.color.surface),
        minWidth: 0,
      }}
    >
      <div data-block-header-row="" style={ROW}>{body}</div>
      <span role="status" aria-live="polite" style={VISUALLY_HIDDEN}>
        {speaks ? said : ""}
      </span>
      {props.host ? <Tray host={props.host} /> : null}
    </div>
  );
}
