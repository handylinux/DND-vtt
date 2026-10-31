import type { CSSProperties } from "react";
import { labelText } from "#shared/logText.ts";
import type { DiceRoll } from "#shared/model.ts";
import { Loading } from "../../components/Loading.tsx";
import { VISUALLY_HIDDEN } from "../../lib/a11y.ts";
import { theme } from "../../lib/theme.ts";
import { effectiveRollMode, type RollModeOverride } from "./rollMode.ts";
import { ResultRest, ResultTotal, shownVerdict, useCommittedRoll } from "./Roller.tsx";
import type { BlockSent } from "./useAbilityMenu.tsx";
import { useReceipt, useReceiptVoice } from "./useReceipt.ts";
import { useInitiativeChanged } from "./useRollOption.ts";

/**
 * What a stat block's ability grid last did: a roll it sent, or a tap whose
 * roll did not go, with why (docs/design-v1-stat-block-rolls.md 8).
 */
export type BlockOutcome = { kind: "sent"; sent: BlockSent } | { kind: "unsent"; words: string };

const ROLLING = "Rolling…";

/**
 * The words a roll from a choice adds to the result line (D-261031-134),
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

const LINE: CSSProperties = {
  position: "relative",
  marginTop: theme.space(2),
  minHeight: theme.touch,
  padding: `0 ${theme.space(3)}px`,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  gap: theme.space(2),
  minWidth: 0,
  borderRadius: theme.radius.md,
  background: theme.color.surfaceRaised,
  fontSize: theme.font.body14,
  lineHeight: theme.leading.tight,
};

/**
 * The newest roll from a grid, right under it. It follows the tag through
 * the receipts like the Dice panel's sticky line and shows the same roll the
 * same way, without Again or a tap through. As the sender it claims the
 * roll's voice, so it alone says the result and the refusal while it is
 * mounted (D-261031-133).
 */
export function BlockResult(props: { outcome: BlockOutcome }) {
  const { outcome } = props;
  const tag = outcome.kind === "sent" ? outcome.sent.tag : null;
  const receipt = useReceipt(tag);
  const speaks = useReceiptVoice(tag, true);
  const { first, head, data, level, said } = useCommittedRoll(receipt);
  const changed = useInitiativeChanged(tag);
  const muted = { color: theme.color.textMuted } as const;
  if (outcome.kind === "unsent") {
    return (
      <div data-block-result="" style={LINE}>
        <span role="alert" style={{ color: theme.color.dangerText }}>
          {outcome.words}
        </span>
      </div>
    );
  }
  const secret = data?.type === "dice" && data.to === "dm";
  let body;
  if (!receipt || receipt.state === "sending" || receipt.state === "checking") body = <Loading text={ROLLING} live={false} />;
  else if (receipt.state === "refused") body = <span {...(speaks ? { role: "alert" } : {})} style={{ color: theme.color.dangerText }}>{receipt.text || receipt.message}</span>;
  else if (receipt.state === "unknown") body = <span style={muted}>This may have happened. Check the log.</span>;
  else if (!first || !head) body = <span style={muted}>Rolled. Its result is no longer in the log.</span>;
  else {
    const label = head.label !== undefined ? labelText(head.label) : undefined;
    const mode = modeWords(outcome.sent.override, first, secret);
    body = (
      <div aria-description={effectiveRollMode(first, secret) || undefined} style={{ display: "flex", alignItems: "center", gap: theme.space(2), minWidth: 0, flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}>
        <ResultTotal total={head.total} />
        <ResultRest sum={head.sums} label={label} level={level} dice={head.dice} more={head.more} verdict={shownVerdict(first, data)} mode={mode || undefined} />
      </div>
    );
  }
  return (
    <div data-block-result="" style={{ ...LINE, ...(changed ? { flexDirection: "column", alignItems: "stretch", justifyContent: "center", paddingBlock: theme.space(1) } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>{body}</div>
      {changed ? <span style={{ ...muted, fontSize: theme.font.small }}>{changed}</span> : null}
      <span role="status" aria-live="polite" style={VISUALLY_HIDDEN}>
        {speaks ? said : ""}
      </span>
    </div>
  );
}
