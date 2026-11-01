# raccoon-vtt v1: the roll header and dice on the token screen

Status: decided after design review rounds 1 to 4 (findings FL21-SOL-01 to 08, F1 to F13, N1 and N3, answered where section 11 lists), and built. Decisions D-261101-080 to D-261101-099, listed in section 10, and the build's own in "As built". The prototype's pictures named below (such as `a-phone-375-landed.png`) were taken outside the repository.

The project owner asked on 2026-11-01: "We should do the same animation and header on the token screen when someone is tolling as the roll screen rather than just appearing a number inline. Do a design review (including how long the header exists) before implementing this but I assume it should just largely look the same". "Tolling" is rolling, the roll screen is the Dice panel, and the token screen is a token's panel and a character's page, where a stat block's six ability boxes roll (docs/design/design-v1-stat-block-rolls.md).

## Summary

- **The Dice panel's header line, at the top of the token screen.** A roll from an ability box puts the Dice panel's sticky result line at the top of the panel's scroller: the total, the roll's name, the dice chips, the verdict and the mode words, in the Dice panel's look. Its tray hangs under it as in the Dice panel.
- **Nothing moves under a finger.** The line goes in at the top of the scroller, and the host moves the scroller by the same amount in the same frame, with the browser's own scroll anchoring off for that one insert, so every box stays where it was on screen to within 1 px. Where the content is too short to scroll that far, a spacer at its foot makes room first. The line's row is a fixed height, so no later state grows it.
- **The same throw.** The dice leave the box that was tapped, fly up into the tray and land 1 s after the answer, by the roll animation design's timer and rules. Only the surface that rolled throws, and only its tray draws the scrim and rings.
- **The header lasts until the panel closes or shows another creature**, the dice design's rule for a surface's own result. Each new roll replaces it in place.
- **No Again, no tap through.** The block keeps D-261031-116: a reroll stays in the Dice panel, where the roll also becomes the newest roll with its Again.
- **The inline result line under the grid goes away.** Its states and words move into the header.

## What changes from the stat block rolls design

1. **D-261031-115 is reversed**: the block throws dice, in a tray of the token screen's own, never the Dice panel's.
2. **D-261031-116 changes place and life**: the result shows at the top of the panel in the Dice panel's look, not under the grid, and it lasts until the panel closes or shows another creature, not until the block folds. Folding the stat block now leaves it. No Again stays.
3. **Section 7's "the dice tray: block rolls throw no 3D dice" is dropped.** `useAbilityMenu` passes a throw origin with every roll it sends.
4. **Section 8's result line (`BlockResult`) is replaced** by the header line (`BlockHeader`). Its states, mode words, voice claim and LP27-A-BLOCK-3 label fallback carry over. Its words now clip at two lines (3.2).
5. **The roll waits for the dice.** Today a block roll's total shows at the answer. Now, where the dice throw, it shows at the landing on the roller's result lines (the header and the Dice panel's newest line) and in Recent rolls. The tracker's Initiative row and other devices still show it at the answer. The live region still says it at the answer.
6. **FEATURES.md's "throw no dice"** for block rolls (two places) becomes the throw.

Everything else in the stat block rolls design holds: which boxes roll and for whom (section 2), the box, the list and its order, the options and their Secret rule, the DM's secret monster rolls, Ask, requests answered from the block, Initiative's write, the Dice panel's row keys, `choices: "none"`, `onFail`, and `BlockSent` with its label.

## 1. Where the header line and tray sit

### 1.1 The options

| | A. The Dice panel's line at the scroller's top (chosen) | B. In the panel's title row | C. A band laid over the scroller's top |
|---|---|---|---|
| Look | Exactly the Dice panel's line and tray, under the sheet's title row (`a-phone-375-landed.png`) | The result in place of the title "Thorn", between Back and Close (`b-title-row-phone-375-landed.png`) | A's look, but it never joins the content |
| Moves | Nothing: the scroll matches the line's height | Nothing: the row keeps its height | Nothing |
| Covers | The top 49 to 63 px of the view while the content is scrolled. Scrolled to the top it sits above the content and covers nothing (`a-phone-375-scrolled-to-top.png`) | Nothing but the title, which the creature heading repeats | The top of the content always: the name and portrait can never be read while it shows |
| Desktop | The same in the side panel and in each of two panels (`a-desktop-1440-landed.png`) | The side panel's Token tab has no title row. The prototype found none to fill, so B needs a new row there, which is A | The same as A |
| Width | The column's: 341 px at 375, 276 at 320 and 130% | Between Back and Close: 261 px at 375, about 150 at 320 and 130% | The column's |

A is what the owner asked for: the same line in the same place, under the title row and over the content. B gives the line a narrower slot on phones and has no slot on a computer. C hides the creature's name for as long as the header lasts.

### 1.2 How A goes in without moving anything

The rule is about the box: after the header appears, every box stands where it stood, to within 1 px. The prototype measured the DEX box's top before the pick and after the landing: 490.27 and 490.27 at 375 x 667, 539.75 and 539.75 at 1440 x 900, 289.47 and 289.05 at 320 x 568 at 130%. It ran in Chrome with native scroll anchoring on, so those numbers may be Chrome's anchoring as much as the host's scroll. The build turns anchoring off for the insert (step 0) and its tests measure the host's own scroll.

0. **The host is the only mover, for the insert alone** (F2, N1). Chrome anchors scroll on its own, Safari only from Safari 27, and iOS 26 and earlier never, so anchoring left on during the insert would make Chrome pass a rule other browsers break. But every token panel and character page has a host, and anchoring keeps the view still for live changes nobody rolled from (a condition chip wrapping, the Reaction group appearing, Uses changing). So the host turns it off only around the first insert: `onSent` or `onUnsent`, in the pick's click before React commits, sets the scroller's (the content's `[data-pane-body]`) inline `overflow-anchor` to `none`, keeping the prior inline value. The header's layout effect restores that value right after it sets `scrollTop` (step 3 or 4). Later rolls insert nothing and leave anchoring alone. An unmount before the effect runs restores it too.
1. **The pick records the anchor.** `onSent` or `onUnsent` runs in the pick's click, before React draws, and hands the host the box element and its top in screen px.
2. **The header mounts first in the host**, the panel's top, in the commit that draws the pick's result.
3. **In the header's layout effect** (before paint), the host reads the box's top again. The difference is in screen px. The scroller is the box's `[data-pane-body]`, and its zoom is `effectiveZoom(scroller)`. The wanted `scrollTop` is today's plus the difference over the zoom.
4. **Too short to scroll that far**: the host's foot spacer, an empty block after the content, takes the shortfall as its height, then the scroll is set. It stays while the header does, so content never jumps back.
5. **A bottom sheet that grows** with its content (not yet at its cap) grows upward by the line's height and the content stays put: the difference is 0 and nothing scrolls (`Sheet.tsx`, the bottom box's `height: auto` under its `maxHeight`). One that reaches its cap partway scrolls by the rest. The rule covers both, since it measures the box and not the sheet.
6. **The resize baseline** (FL21-SOL-02): the same layout effect then records the pane's size as the host's resize baseline (4.3), so the growth it just caused never reads as a resize.

**The order in the commit** (FL21-SOL-05). React runs a child's layout effect before its parent's, so the tray (`Tray.tsx`, which attaches in its own layout effect) attaches before the header's effect moves the scroller. If the store measured the tray then, a throw already committed would start from the box's place before compensation and the keyboard reveal. So the host holds its own pending taps while it settles: `pickRow` and `pickChoice` call `host.hold()` before they send, so even a sender that commits inside the send cannot play yet. The order is then: the tag registers (and may commit), `onSent` records the anchor, React commits and the tray attaches, then the header's layout effect sets the scroll (steps 3 and 4), sets the scroll padding (step 8), runs the keyboard reveal (below), restores anchoring (step 0), records the baseline (step 6), and last calls `host.release()`, which runs the store's check for that host's pending taps against the box's final place. The padding comes before the reveal (FL21-SOL-08), since `nearInScrollBox` clears the scroller's `scroll-padding-top` and would otherwise clear nothing on the panel's first roll. Anchoring, the baseline and the first scroll are first-insert steps. The padding, the reveal and `release()` run in the header's layout effect after every commit that changes the outcome, so a second roll, held by `hold()` like the first, is released too (N3). A pick that sends nothing and draws nothing releases at the end of its handler. Deadlines still count from the answer (4.2).
7. **Only the first roll inserts.** Later rolls replace the line's text in a row of fixed height (3.2).

A box standing in the scroller's top band when the line goes in ends up partly under it (`a-phone-320-130pct-landed.png`: the top row of boxes is half under the line). It stays there for a pointer pick: moving it would push the tapped box, which the owner's rule forbids. For a **keyboard pick** (Enter or Space on a row or a choice, or a reader's activation with `detail` 0), no finger is down and focus returns to the box, so the host then calls `nearInScrollBox` (`lib/reveal.ts`, D-261101-045) on the box, which scrolls the least amount that clears the scroller's scroll padding (step 8). How the pick's input kind reaches the host is in 1.4.

8. **Scroll padding under the line** (F1). `nearInScrollBox`, `keepInView` (`lib/keyboardInset.ts`) and the browser's own focus scrolling all keep a target clear of the scroller's `scroll-padding-top`, and no pane sets one today. So while the line is mounted the host sets the scroller's `scrollPaddingTop` to the line's stuck height (its `offsetHeight`, which already holds the pane's top padding it takes back), in a layout effect after every render, as `PlayerRolls.tsx` does for its sticky header, and restores the prior inline value on unmount. Tab to a control under the line then brings it clear, and the keyboard reveal above has something to clear.

**Accepted: swipe to close changes after the first roll** (F12). On a sheet at its cap scrolled to its top, the matching scroll leaves `scrollTop` at the line's height, so the next downward swipe on the content scrolls up to the line instead of closing (`sheetSwipe.ts`, `atTop` needs `scrollTop` under 1). The grab area and the header still close it in one swipe, and a second swipe on the content does too.

### 1.3 Every mount

The header belongs to the panel, not the grid. A new `BlockHeaderHost` wraps the panel's content and is keyed by the panel's creature:

| Mount | Host | Key |
|---|---|---|
| A token's panel: a PC token, a monster or NPC, a companion, a shape's block under "Rolls now", an SRD-linked token (`TokenDetails`, `panels/TokenPanel.tsx`) | Around `TokenDetails`' content | The token id (`TokenDetails` is keyed by it already) |
| A character's page in the Characters panel (`CharacterPage`, `features/tokens/CharacterCard.tsx`) | Around the page's content | The character id (the page is not keyed today, `CharactersPanel.tsx`, so a switch between pages must not carry a header over) |

Phone sheets, the desktop side panel, a split pane of Two panels and a side sheet on a landscape phone all hold these panels in a `[data-pane-body]` scroller, and the line sticks to it as the Dice panel's does (`top` and margins from `--pane-pad-top`). The token window (the docked action bar) holds no ability grid, so it gets nothing. The Monsters panel and companion block lists stay text and get nothing.

The line spans the pane's side padding too, with `theme.shadow.paneSides(surface)` (D-261030-527): in the prototype, the portrait's ring stands 3 px past the column and showed beside a line drawn at the column's width. The tray's scrim does the same (4.5).

### 1.4 The pick's input kind

`Menu`'s `onPick` gains a second argument, `by: "pointer" | "key"` (D-261101-098). Its keyboard path (the reducer's `pick` action on Enter or Space) passes `"key"`. Its `onClick` passes `"key"` for a click with `detail` 0 (a reader's activation or a synthesized click, no finger down) and `"pointer"` otherwise. `RollModeMenuBody` passes it through to its own `onPick`. `useAbilityMenu`'s `pickRow(id, by)` and `pickChoice(override, by)` hand it on with the anchor in `onSent` and `onUnsent`. Every other `Menu` caller ignores the new argument.

## 2. How long the header exists

| | L1. Until the panel closes or shows another creature (chosen) | L2. 8 s after the landing, then it folds away | L3. Until the next tap elsewhere in the panel |
|---|---|---|---|
| Reading the result | As long as the panel shows this creature | 8 s, then gone, though a player may look at the map first | Gone at the next tap, often a scroll |
| Scrolling | It sticks while the content scrolls, and scrolled to the top it sits above the content | It folds while the reader may be scrolled to the top, which moves everything under it up by its height | Each touch to scroll removes it |
| A second roll | Replaces the line in place. Nothing moves | Inserted again each time, with its scroll each time | Inserted again each time |
| A request answered from the block | The answer's Pass or Fail stays beside the roll's name until the next roll | The verdict goes with the line | The verdict goes with the next tap |
| Screen readers | Said once at the answer. The line stays in reading order at the panel's top | Said once, then the text leaves without notice | Said once, then the text leaves without notice |

L1 is the pick. It is the dice design's rule for a surface's own result, which shows "until a newer roll from it replaces it or the surface closes" (docs/design/design-v1-dice.md 8.7, rule 2), and the inline line kept it too. It needs no timer and makes no second move, since the line only goes with the panel's content. The Dice panel's own sticky line lives longer, since its newest roll is room state (`diceChoicesSlot`, `useLastRoll`) and survives the panel closing. "Closes" here means the host unmounts: Close, a swipe back, another panel in its place, another token or page. Hide keeps a sheet mounted (`usePanelShown`), so the line is still there when it shows again. A roll from another surface never touches it.

Rejected also: L4, pinned until dismissed with a Close on the line, which adds a control the Dice panel's line does not have and a move when it is pressed. L5, each creature's last block roll kept in room state and shown whenever its panel opens again, which would put a stale roll at the top of every panel opened later and a header insertion with nothing tapped.

## 3. What the header holds

### 3.1 Content

- **The Dice panel's body, minus Again.** `ResultTotal`, then `ResultRest` with the sum, label (FL-12 frame), dice chips, verdict and mode words, dropping parts in the Dice panel's order where short. The panel's `surface` with its bottom border.
- **No Again** (D-261031-116 kept). The block's rolls are checks, saves, skills and Initiative. A reroll of a save is rare, a reroll of Initiative would write the tracker row again, and the Dice panel's newest line already offers Again for this very roll.
- **No tap through.** The line is not a button. The Dice panel's opens Recent rolls in that panel, which here would switch a phone's sheet away from the creature on a stray tap.
- **States**, the inline line's, unchanged in words: "Rolling…" by the shared delayed indicator while the roll waits for its answer, the refusal's words (an alert while it holds the voice), `onFail`'s words such as "Rolling needs a connection." as an alert, "This may have happened. Check the log.", "Rolled. Its result is no longer in the log."
- **While the dice fly** (F6): the line keeps what it showed at the answer. "Rolling…" shows only where the tap came 200 ms or more before the answer (`ROLLING_MS`, the store's `rolling`). After a quicker answer the first roll's line is an empty band until the dice land, and a later roll's line keeps the previous result's place blank the same way, as the Dice panel's does.
- **Initiative written too late**: "Not set: the row changed meanwhile." takes a second small row after the total, under the label and chips, inside the same row (the 24 px row of the label and chips, then one row of 13 px small type, which together fit the 44 px).
- **The inline line goes entirely.** `BlockResult.tsx` is removed, `modeWords` moves to the header's file, and `RollingGrid` hands its outcome to the host.

### 3.2 A fixed row (F3)

The line's row is exactly `theme.touch` (44 layout px) tall, `height`, not `minHeight`, in every state. The result's parts drop as `ResultRest` drops them. Plain words (a refusal, `onFail`'s, unknown, the gone line) wrap to at most two lines in `small` type and clip with an ellipsis (`-webkit-line-clamp: 2`). The words stay whole in the DOM, so the alert and the live region say all of them, and the line's `title` holds them for a pointer. At 320 x 568 at 130% the line's text box is about 212 layout px: "This may have happened. Check the log." and "Rolled. Its result is no longer in the log." take two lines, and a long server refusal can need three, so it ends in "…".

## 4. The throw

### 4.1 Which rolls throw

A tap or pick in an ability's list that sends a roll for one creature: the free roll, an answer to a request (`noted`), Initiative. The origin is `{ surface: "block", host, element: box, tapAt }`, built by `useAbilityMenu` from its anchor, the box, since the row the finger left is gone once the list closes. So the dice leave the box (`a-phone-375-mid.png`). `useRollOption().d20` takes the origin as an input and passes it to `panel.roll` and `panel.noted`.

An ask (the DM's roll for a played creature with Ask on) and "Initiative score" send no roll, so nothing throws and the header stands as it was (D-261031-137). A preview, a refusal, `unknown`, an answer more than 3 s after its tap and every case the roll animation design lists show at once.

### 4.2 The store's hosts

`ThrowStore` holds one panel and one tray today. It gains hosts: the Dice panel is one, each `BlockHeaderHost` holding a rolling grid in a shown pane is another. `mount(host)` returns a handle with the host's id, its `attach(tray)`, its own press listeners and its unmount.

- **A tap is bound to its host.** A pending tap keeps its host id and that host's mount count. `#committed` measures only that host's tray.
- **The host's tray may come after the answer** (FL21-SOL-01, D-261101-099). The first block roll mounts the header, and so the tray, in the render after `onSent`, which runs after `d20` has registered the tag. A receipt committed by then would today be consumed by `#check` with no tray and never retried (`register` runs `#check` at once, `#check` deletes the pending entry before `#committed`, which returns with no tray, and `attach` never checks again). The same gap exists in the Dice panel, whose sticky line and tray only mount once it has a last roll. This is the case of a sender that answers inside the send, which the store already supports (`register` checks at once for it) and its tests drive with a synchronous fake sender (FL21-SOL-07). The dev room's local socket does not answer that way: it batches ops for 20 ms and emits each answer after a 30 ms `setTimeout` (`client/dev/localServer.ts`), and `store.ts`'s comment that says otherwise is corrected by lane A. So a committed tag whose host is mounted but held, or has no tray yet, stays pending, marked with its answer time t0. The host's `release()` (1.2, the order in the commit) runs `#check` for its host, and the Dice panel, which has no compensation, releases in its sticky line's layout effect, after its tray's. The throw then plays with the stage told the time since t0, and the result shows at t0 + 1,000 ms and the dice go at t0 + 2,100 ms, as for any late setup (roll animation design 3.4). Past t0 + 1,000 ms the result shows at once and nothing is thrown. Past the tap + `LATE_MS` (3 s) the pending tap is dropped, as today. The release runs in a layout effect, and the store's change re-renders before paint, so the total never paints and then goes.
- **Only the surface that rolled throws** (FL21-SOL-04). `ShownThrow` carries the host id. `Tray` takes its host's id and draws its scrim, rings and "+N" disc only for a throw of that host, and the stage's canvas hangs in that host's tray alone. With Dice open beside the token panel, a block roll leaves the Dice panel's tray empty, and a Dice panel roll leaves the token panel's.
- **Origins per host** (F8). Each host remembers its own last pressed control and time, and `origin(host)` reads only that host's. A press in the token panel never becomes a Dice panel roll's origin.
- **One throw at a time, room wide.** A newer roll from any surface ends the throw on screen. A tap or key in any host ends it, and so does `resized()` from any host.
- **A host's unmount ends only its own** (F8). Closing the Dice panel during a block's throw leaves it flying. An unmount ends the throw only when the throw, or a held result, is that host's, and then sends an unseen result to the toast (`#endUnseen`). A pending tap of that host is dropped.
- **Held on the roller's lines** (F11). `held(tag)` is the store's, so the header, the Dice panel's newest line and Recent rolls show the roll at the landing. The tracker's Initiative row and every other device show it at the answer, as today.
- **Warm-up** runs when the first host mounts (the Dice panel, or a host whose grid rolls), in an `idle` callback, never in a preview. A block host's kinds are d20 and d4, the only dice a block rolls (a d4 for Bless or Guidance).
- **Disposal** 30 s after the last host unmounts, not after the Dice panel alone.

### 4.3 Interruptions on the token screen

The host listens as `useThrowPanel` does (capture phase, never stopping the event), and the result shows at once on:

| Event | Result | The tap's own job |
|---|---|---|
| A tap anywhere in the panel, the open list included (React's capture reaches through Popover) | Dice go at pointer down, result at the click | A box opens its list, a field focuses |
| A key in the panel | At once | Its own |
| A scroll by touch | Dice go at pointer down, result at pointer up plus 300 ms | The scroll |
| A sheet drag, a rotation, the keyboard, a split moved (the pane's size moves off its baseline) | At once | |
| A wheel or keyboard scroll | No change, as in the Dice panel: the tray hangs under the sticky line and stays in view | |
| Switching tokens or pages, a swipe back, Close, another panel in its place (the host unmounts) | The result was never seen, so it goes to the own roll's toast | |
| Hide, or the pane hidden behind another tab (`usePanelShown` false) | As an unmount for the throw: it ends and the unseen result toasts. The header stays mounted, and its receipt watch stops (FU42-B) | |
| The page hidden, reduced motion or Low power turned on, a lost context, a newer roll | As in the Dice panel | |

**The resize baseline** (FL21-SOL-02). The Dice panel's observer treats every report after its first as a resize (`DicePanel.tsx`). The host's observer instead keeps a baseline, the pane's border-box size: the size at mount, then the size the header's layout effect records after the line goes in (1.2 step 6). A report equal to the baseline, within 0.5 px, is ignored. Any other report calls `resized()` and becomes the new baseline. So the sheet growing for the line never ends the first throw, while a later drag, rotation or keyboard still does. The Dice panel host adopts the same baseline rule, with no behavior change there.

Taps pass through the canvas and the scrim (`pointer-events: none`), so the box under the tray still opens.

### 4.4 Fallbacks and the bundle (FL21-SOL-03)

- **Reduced motion**: the total shows at once, and the dice are drawn once, already landed, with a still ring for a natural 20, then fade with the scrim. A canvas is made, as `ra-2` checks in the Dice panel (`store.ts` sets `held: null` and plays the reduced throw).
- **Low power, the switch off, no WebGL, a chunk or warm-up not ready, a pane under 160 px for the line and tray**: the total at once, no canvas, no scrim.
- **The header shows in every case**: it is the result's place, not part of the animation.
- **The bundle**: no change to when three.js loads. The lazy stage chunk loads in the background once the room is ready, as today (`throw/hooks.ts`). `Tray.tsx`, `store.ts` and `useThrows.ts` already ride in the Token and Characters panels' chunks through `AbilityGrid` and `Roller.tsx`. `scripts/three-chunk.ts` adds the Token panel's and Characters panel's chunks to the chunks that must never hold three's renderer.

### 4.5 The tray's look (F5)

As the Dice panel's (`Tray.tsx`): under the line's bottom border, a scrim of the panel's `surface` at 0.92 opacity, 112 screen px tall, square at the top and rounded at the foot, fading in over 170 ms and out with the dice by 2.1 s after the answer, then gone. It takes no taps. Rings around a deciding d20 and the "+N" disc sit on it. On the token screen the scrim also takes `theme.shadow.paneSides(surface)`, as the line does, so the portrait's ring never shows undimmed beside it in the side padding. The Dice panel's scrim gains the same shadow, which there changes nothing visible.

## 5. Screen readers and the live region

- **Said once, at the answer**, with its verdict and mode, by the header's polite region, as the inline line does today (`useCommittedRoll`'s words), before the dice land.
- **One voice per roll** (D-261031-133): the header claims its tag's voice while mounted and shown. The Dice panel's line beside it stays silent, and a refusal alerts once with its full words (3.2). A host unmounted before the answer lets the Dice panel's line or the toast say it, as now.
- **In reading order** the line is the panel's first content, a plain group of text (`data-block-header`), not a landmark or a button. Its body carries the mode in `aria-description` (`effectiveRollMode`). While held it reads as it looked at the answer, for at most 1 s, and the region has already said the result.
- **Focus** returns to the box after a pick (FL-17's `onPick`). A keyboard pick brings the box clear of the line, and Tab keeps any control clear of it through the scroll padding (1.2 step 8).

## 6. UI checklist

- **Loading**: "Rolling…" through the shared `Loading` with its 200 ms delay. During a throw, "Rolling…" only where the tap was 200 ms or more before the answer, else an empty band (3.1). Nothing new loads in view.
- **Keys and focus**: no new control and no new key. Escape, Enter and the list's keys are unchanged. Any key in the panel ends a throw and still does its job. Focus is never left under the line (1.2).
- **Screen readers**: section 5.
- **Large interface sizes**: the line's row is 44 layout px at every size, its words clip at two lines (3.2), and the tray's band is 112 screen px as in the Dice panel (`a-phone-320-130pct-mid.png`).
- **Words shown**: the inline line's words, unchanged. The shortcut sheet's `diceThrowEnd` row says "in the Dice panel or a stat block's panel while your dice are in the air".

## 7. Cases

| Case | Expected | Test |
|---|---|---|
| Pat taps DEX, Check, on Thorn's page at 390 x 844 | The line appears at the pane's top, the DEX box stays within 1 px with anchoring off, dice from the box, the total at 1 s | trh-1 |
| A phone sheet below its cap | It grows upward, `scrollTop` unchanged, the box stays, and the whole throw plays | trh-1b |
| The same at 320 x 568 at 130% and 1440 x 900 | The same, the line and tray inside the pane, no sideways scroll | trh-2 |
| Content shorter than the pane on a computer | The foot spacer makes room, the box stays | trh-2, `headerAnchor.test.ts` |
| The first roll's receipt committed before its tray attaches | It still throws, landing at t0 + 1 s. Past that, the total at once with no throw | `store.test.ts` |
| That roll with the header's scroll and a keyboard reveal | The throw measures the box at its final place, after both | `headerAnchor.test.ts`, `store.test.ts` |
| A second roll | Replaced in place, no scroll, no move, and it throws (released by the header's effect) | trh-5, `store.test.ts` |
| Dice panel beside the Token panel, a block roll | Canvas, scrim and rings in the token panel only. The Dice panel's line shows it at the landing and says nothing | trh-3, sbr-16 |
| A Dice panel roll with the token panel beside | Throws in the Dice panel only. The token header is unchanged | trh-3 |
| The Dice panel closed during a block throw | The block's throw goes on | trh-3, `store.test.ts` |
| A tap on a box mid-throw | Result at once, the list opens | trh-4 |
| Another token selected mid-throw | One own-roll toast, the new token's panel has no line | trh-4 |
| Hide the sheet mid-throw, then show it | One toast. The line shows the roll again on return, silent | trh-4 |
| Fold the stat block after a roll | The line stays | trh-5, sbr-12 |
| Close and reopen the panel, or switch from Thorn's page to Vex's | No line | trh-5 |
| Reduced motion | The total at once, the landed dice drawn once on a canvas | trh-6, ra-2 |
| Low power, the switch off, no WebGL | The total at once, no canvas | trh-6 |
| A keyboard pick with the box in the top band | Focus on the box, the box wholly under the line | trh-7 |
| Tab to a control under the line | It comes clear of the line | trh-7 |
| A pointer pick with the box in the top band | The box stays, partly under the line | trh-7 |
| "This may have happened. Check the log." at 320 x 568 at 130% | Two lines, the row still 44 px, nothing moves | trh-8 |
| A refusal three lines long | Two lines and "…", the alert says it whole | `BlockHeader.test.ts` |
| An answer to a request | The line names the save, Pass or Fail | sbr-6 |
| Initiative written late | "Not set: the row changed meanwhile." in the line's second small row, 44 px kept | `BlockHeader.test.ts` |
| An ask, "Initiative score" | No throw, the line as it stood | sbr-7, sbr-8 |
| The DM's secret monster roll | The DM's device throws, Pat's gets nothing | `store.test.ts`, as ra-6 |

## 8. Tests

**Unit** (each new case fails with its fix removed, and each new rule is mutation-checked):

- `throw/store.test.ts`, hosts:
  - A block origin throws in its own host's tray and in no other, and the shown throw names that host. A Dice panel roll with a block host mounted throws in the Dice panel.
  - With a synchronous fake sender, a first roll whose receipt is committed inside the send, its host held and with no tray, does not play at `attach` and throws at `release()`, landing at t0 + 1,000 ms. Released after t0 + 1,000 ms it shows at once, after the tap + 3 s it is dropped. A held host's later roll waits for `release()` too.
  - A block roll whose host is hidden, unmounted or remounted since the tap never throws.
  - The Dice panel's unmount during a block throw leaves it. A host unmount mid-throw of its own sends the tag to `unseen`.
  - `origin(host)` reads that host's press only.
  - Warm-up when only a block host mounts. Disposal 30 s after the last host goes, never while another is mounted.
  - The randomized test gains block hosts (mounts, hides, unmounts, remounts, tray attaches before and after the answer) and rolls from both surfaces. New invariants: a throw only plays in the tray of the host that sent it, decorations are drawn for that host only, a host's unmount never ends another host's throw, and a committed tag whose host attaches its tray within 1 s of the answer throws.
- `headerAnchor.test.ts` (new, pure `anchorScroll` and the resize baseline): a scroller with room (scroll by the difference over the zoom), one too short (the foot spacer's height, then the scroll), a sheet that grew (difference 0, nothing), zoom 1.3 with fractions (within 1 px). The baseline: the post-insert size is ignored, any other size is a resize. The effect's order on a first insert: anchoring set to `none` before the commit, then the scroll, the padding, the reveal, anchoring restored to its prior inline value, the baseline, and `release()` last, so a throw's measure reads the box after the scroll and the reveal. The reveal reads the padding just set (a box in the top band is cleared on the first roll). On a second roll the effect sets the padding, reveals on a key pick and releases, and the held roll throws. A later roll leaves `overflowAnchor` alone. An unmount before the effect restores it. The scroller's `scrollPaddingTop` set while the line is mounted and restored on unmount.
- `BlockHeader.test.ts` (new, the `html()` pattern): each state's words, "Rolling…" held only with `rolling`, the two-row Initiative note in one 44 px row, `height` not `minHeight`, the two-line clamp with whole words in the DOM, mode words from the returned roll, no Again, no button, the voice claim, `aria-description`.
- `Menu.test.ts`: `onPick`'s `by` is "key" for Enter and Space and for a `detail` 0 click, "pointer" for a click with `detail` 1. `useAbilityMenu.test.ts`: the origin is the box with `surface: "block"`, for a tap and for a pick, and a keyboard pick asks the host to reveal while a pointer pick does not.
- `useRollOption.test.ts`: `d20` passes `origin` to `roll` and to `noted`.
- `three-chunk.test.ts` and the CI check: the Token and Characters panels' chunks hold no renderer.
- `BlockResult.test.ts`: its cases move to `BlockHeader.test.ts`.

**e2e**, new steps in `dice.e2e.ts`, labeled `trh-`, since it launches WebGL under SwiftShader. A step that finds no WebGL fails where `CI` is set.

1. `trh-1` Pat, 390 x 844, Thorn's page: DEX, Check. The line mounts at the pane's top and the DEX box's top moves at most 1 px. Right after the answer the canvas is there and the line has no total. Within 1,100 ms the total shows and `data-landed` names the chip's face. After the landing the scroller's computed `overflow-anchor` is `auto` again and the box is still within 1 px of where it was.
2. `trh-1b` A phone sheet below its cap (the DM's goblin at 390 x 844 with its groups folded): the step first proves the sheet is shorter than its cap and fails otherwise. After the roll the sheet is taller by the line, `scrollTop` is unchanged, the box moved at most 1 px, and the throw plays to the landing (the canvas stays until the total shows).
3. `trh-2` The same at 320 x 568 at 130% and 1440 x 900 (a monster's token panel for the DM, its groups folded so the content is short): the box within 1 px, `containmentLines` on the line and the tray, no sideways scroll. `measureAlignment` on the line at the three sizes.
4. `trh-3` Two panels on a computer, Dice beside Token: a block roll makes a canvas, a scrim and any ring in the token panel only, and the Dice panel's tray holds none. A Dice panel roll does the reverse. Closing the Dice panel mid-throw leaves the block's throw to land.
5. `trh-4` Mid-throw: a tap on another box shows the result and opens its list. Another token selected: one toast. Hide then show: one toast, the line kept.
6. `trh-5` A second roll moves nothing (the scroller's `scrollTop` and the box unchanged). Fold the stat block: the line stays. Close and reopen: no line. Thorn's page, a roll, then Vex's page: no line (D-261101-095).
7. `trh-6` Reduced motion: the total at once, a canvas with the landed dice and no frame after the first, as `ra-2`. Then Low power, the switch off, and `getContext` stubbed null: the total at once, no canvas, no console message.
8. `trh-7` The box scrolled to the pane's top: a pointer pick leaves it in place. On another panel's first roll, a keyboard pick leaves focus on the box and its top under the line's bottom. Tab from the box to the next control under the line: that control comes wholly below the line.
9. `trh-8` At 320 x 568 at 130%, an unknown receipt (FL21-SOL-06). A swallowed op alone would not do it: on reconnect the store keeps every op above the snapshot's watermark pending and sends it again, and marks unknown only the ops the watermark covers (`applySnapshot`, `client/state/store.ts`). So a Playwright WebSocket route swallows the roll's op so the server never sees it, closes the socket, and on the reconnect rewrites the server's snapshot so its `watermark` covers that op's `n` while its log holds no line of the tag. The store then tells the tracker the op is unknown with the snapshot as its cause, the tracker finds no line, turns it `checking` and asks the receipt lookup, an HTTP GET to the room's `receipts/<tag>` route (`api.getReceipts`, `client/lib/api.ts`). A `page.route` on that GET answers 503, and a failed lookup leaves the part unknown (`useReceipt.ts`). The step asserts the GET was made, then that the header reads "This may have happened. Check the log.", then checks two lines, the row 44 px, the boxes unmoved.

**Existing steps that change**:

- `blockrolls.e2e.ts` reads `[data-block-header]` where it read `[data-block-result]` (sbr-1, sbr-6, sbr-8, sbr-12, sbr-13, sbr-16, sbr-18) and in its toast locators (around lines 1051, 1063 and 1504). sbr-12 folds the block, which no longer removes the line, so its toast case closes the panel instead.
- **Reduced-motion suites** (F13): under reduced motion the dice now rest on screen with the scrim for 2.1 s, which reading checks would see. So `blockrolls.e2e.ts`' two contexts and `alignmentRoom.ts`' `blockRollTests` (run by `proficiency.e2e.ts`) also store `rvtt.rollAnimation` as "off", and the result shows at once with no canvas. The blockrolls header comment says so. The `trh-` steps keep the throw.
- `alignmentRoom.ts` `blockRollTests` swap the result line's roots for the header's, on the PC sheet, the character page, a monster, a companion and Wild Shape, with FL-20's containment and Sleight of Hand rolls. `e2e/helpers/alignment.ts` names `data-block-header` where it names `data-block-result` (around line 2064).
- `pcstats`, `tokenpanel`, `characters` and `companions` where they read the line. `ra-1` to `ra-8` pass unchanged after the store's hosts.

**Sizes**: the alignment and containment checks at 320 x 568 at 130%, 390 x 844 at 130% and 1440 x 900, inside the usual sweep (six sizes, the tablet, the landscape pair).

## 9. Build plan

Lanes in isolated workspaces on the merged tip, after the docs move. No lane touches `shared/` or `server/`, so `test:int` is not needed.

| Lane | Owns |
|---|---|
| A: the store and the roll path | `client/features/dice/throw/store.ts` (hosts, hold and release, the pending tap kept for its tray, the comment on answers inside the send, per-host origins and unmounts, the resize baseline, its `ThrowOrigin` and `DISPOSE_MS` comments), `useThrows.ts` and `throw/hooks.ts` (their header comments), `Tray.tsx` (the host filter, the scrim's `paneSides`), their tests and the randomized test, `useRollOption.ts` and its test, `DicePanel.tsx` (the Dice panel as a host, the baseline), `scripts/three-chunk.ts` and its test. Its first commit freezes the host API and `d20`'s `origin` with stubs |
| B: the header and the mounts | new `client/features/dice/BlockHeader.tsx` (host, line, foot spacer, scroll padding, anchoring off for the insert, hold and release), new pure `headerAnchor.ts`, `useAbilityMenu.tsx` (the origin, `by`, the keyboard reveal), `client/components/Menu.tsx` and `RollModeMenu.tsx` (`by`), `client/features/monsters/AbilityGrid.tsx`, removal of `BlockResult.tsx` and its test, `Roller.tsx` (its comments naming `BlockResult.tsx`, near lines 113 and 364), `client/panels/TokenPanel.tsx`, `client/features/tokens/CharacterCard.tsx`, and their tests |
| C: e2e, sheet and docs | `e2e/dice.e2e.ts`, `e2e/blockrolls.e2e.ts`, `e2e/alignmentRoom.ts`, `e2e/helpers/alignment.ts`, the touched e2e files of section 8, `client/state/shortcuts.ts` and its test, `FEATURES.md`, `docs/dm-guide.md`, this note at docs/design/design-v1-token-roll-header.md with its As built, the superseded lines in docs/design/design-v1-stat-block-rolls.md and docs/design/design-v1-roll-animation.md, and the two README pictures |

Commits: 1. `feat(dice): the throw's store takes a host per rolling surface` (A). 2. `feat(dice): a stat block roll throws its dice from the box` (A, B). 3. `feat(ui): the roll header line on a token's panel and a character's page` (B). 4. `test(e2e): the token screen's roll header and throw` (C). 5. `feat(ui): the throw shortcut names the stat block's panel` (C, with FEATURES.md's shortcut table). 6. `docs: the roll header on the token screen in features, guide and designs` (C). 7. `docs: readme pictures with the roll header` (C).

**Checks**: typecheck, unit and build in parallel on every lane. Lane A runs `dice`, `rolls`, `rollmodes`, `groupsave`, `dicefolds` and `reach`. Lane B runs `blockrolls`, `pcstats`, `tokenpanel`, `characters`, `companions`, `proficiency` and `rollmodes` (Menu's `by`). Lane C runs on the integrated tip `dice`, `blockrolls`, every file above, `alignment`, `alignment-wide`, `alignment-icons`, `shortcuts` and `reach`. Owner shots per surface (PC page, PC token, monster, companion, Wild Shape, mid-throw and landed, phone and computer) go to the owner's screenshot folder, check shots to the coordinator's.

**Docs** (lane C):

- FEATURES.md's Dice bullet (a block roll "throws no dice") and Characters and monsters bullet ("The result shows under the boxes…") change to the header and the throw. The DM guide's "Rolling from a stat block" passage: "the result shows at the top of the panel, where the dice land".
- docs/design/design-v1-stat-block-rolls.md: section 1's "no dice tray in the block", 7's "The dice tray", 8's "Where", and decisions 15 and 16 get a pointer to this note.
- docs/design/design-v1-roll-animation.md (F9): 3.1 and the store's test list ("a surface other than the Dice panel") name the block's surface. Section 6's "loads with the Dice panel" and the warm-up "when the Dice panel opens" name the first rolling host. 7's disposal "30 s after the Dice panel closes" becomes after the last host goes. A one-line pointer to this note.
- README.md's `readme-stat-block.webp` and `readme-phone.webp` show today's inline result line under the boxes. After the build lane C retakes both in the same local room with the same starter art and the same rolls, landed, at the same sizes, and keeps their credits and alt text true ("a Perception check just rolled" stays).

## 10. Decisions, for the project owner to overrule

1. **D-261101-080: the header is the Dice panel's sticky line at the top of the panel's scroller, put in with a matching scroll.** Rejected: the title row (B), narrower on phones and absent on a computer. Rejected: a band laid over the content (C), which hides the creature's name while it lasts. Rejected: keeping the line under the grid, which the owner asked to replace.
2. **D-261101-081: the header lasts until the panel closes or shows another creature (L1)**, the dice design's rule for a surface's own result. Rejected: 8 s then fold (L2), short for reading and a move as it folds. Rejected: until the next tap (L3), gone at the first scroll. Rejected: pinned with a Close (L4), a control the Dice panel's line lacks. Rejected: each creature's last block roll kept in room state and shown whenever its panel opens (L5), a stale roll at the top of panels opened later.
3. **D-261101-082: no Again in the header** (D-261031-116 kept). Rejected: Again as in the Dice panel, a reroll of saves and Initiative that the Dice panel's newest line already offers.
4. **D-261101-083: the inline result line goes entirely.** Rejected: both lines, the same result twice in one panel.
5. **D-261101-084: the line is not a button.** Rejected: a tap opening the Dice panel's Recent rolls, which switches a phone's sheet away on a stray tap.
6. **D-261101-085: the dice leave the ability box.** Rejected: the tapped row, gone when the list closes. Rejected: the tray's corner, the store's fallback, which reads as dice from nowhere.
7. **D-261101-086: a pointer pick never moves the box, a keyboard pick brings it clear of the line.** Rejected: always clearing the box, which pushes the tapped box. Rejected: never clearing it, which can leave keyboard focus under the line.
8. **D-261101-087: a foot spacer makes the scroll possible on short content, and stays with the header.** Rejected: letting short content move, a move under the finger on a computer's side panel. Rejected: dropping the spacer later, a jump at the foot.
9. **D-261101-088: one throw at a time room wide, its result held on the roller's lines and Recent rolls.** Rejected: the Dice panel's line showing the total while the token panel's dice fly, two moments for one result on one screen.
10. **D-261101-089: the store's hosts, the canvas and decorations in the sending host's tray only, per-host origins and unmounts.** Rejected: every mounted tray throwing or decorating, two sets of dice or rings for one roll. Rejected: a second store, which would let two throws run.
11. **D-261101-090: Hide ends a throw as an unmount, and the line stays for the return.** Rejected: throwing in a hidden pane, which nobody sees.
12. **D-261101-091: the warm-up runs when the first rolling host mounts, d20 and d4.** Rejected: warming at room ready, a cost for every member who never rolls.
13. **D-261101-092: Initiative's "Not set" note is a second small row inside the line's 44 px.** Rejected: a taller line, which moves the content. Rejected: a toast, away from the roll it is about.
14. **D-261101-093: the line and the tray's scrim cover the pane's side padding with `paneSides`.** Rejected: the column's width alone, which left the portrait's ring showing beside them in the prototype.
15. **D-261101-094: the new e2e steps go in `dice.e2e.ts` as `trh-`.** Rejected: `blockrolls.e2e.ts`, whose contexts turn the dice off. Rejected: a new file, a new port offset for nine steps.
16. **D-261101-095: the host is keyed by the panel's creature.** Rejected: one host for the Characters panel, which would carry Thorn's roll onto Vex's page.
17. **D-261101-096: a wheel or keyboard scroll does not end a throw**, as in the Dice panel. Rejected: ending it on any scroll, which the Dice panel does not do and which lets a stray wheel nudge cut a 1 s throw short.
18. **D-261101-097: the header shows whatever the animation settings.** Rejected: the header only with dice, which would leave Low power with no result in view.

From round 1:

19. **D-261101-098: the pick's input kind comes from `Menu`'s `onPick(id, by)`, and a click with `detail` 0 counts as a key.** No finger is down for a reader's activation, and focus returns to the box, so it is revealed as a key pick is. Rejected: reading `document.activeElement` or the last event in `useAbilityMenu`, which Menu's `flushSync` pick does not hand on. Rejected: a pick with `detail` 0 counted as a pointer, which leaves a reader's focus under the line.
20. **D-261101-099: a committed tag waits for its host's tray, and the 1 s still counts from the answer.** Evaluated when its host releases (its tray attached and its scroll settled, 1.2), within 1 s of the answer it throws for the rest of the second. Later it shows at once, and past the tap + 3 s the tap is dropped. Rejected: restarting the 1 s at the release, which shows the result later than the dice design allows. Rejected: showing the first roll at once always, which makes every first roll on a panel differ from the rest.

Adopted from the reviewers, with no new guess: the resize baseline (FL21-SOL-02), reduced motion drawing the landed dice (FL21-SOL-03), scroll padding under the line (F1), anchoring off for the first insert only (F2, N1), the order in the commit (FL21-SOL-05), the unknown receipt through the lookup's GET (FL21-SOL-06), the fixed row with two-line words (F3), the Roll animation switch off in the reduced-motion suites (F13), and the accepted swipe change (F12).

## 11. Round 1 findings and where they are answered

| Finding | Section |
|---|---|
| FL21-SOL-01 first-roll tray readiness | 4.2, 8 (store test), D-261101-099 |
| FL21-SOL-02 header growth is not a resize | 1.2 step 6, 4.3, 8 (`headerAnchor.test.ts`, trh-1b) |
| FL21-SOL-03 reduced motion | 4.4, 7, 8 (trh-6) |
| FL21-SOL-04 decorations in the sending host only | 4.2, 8 (store test, trh-3) |
| F1 scroll padding | 1.2 step 8, 5, 8 (trh-7) |
| F2 native anchoring off | 1.2 step 0, 8 (trh-1) |
| N1 anchoring off for the insert only | 1.2 step 0, 8 (trh-1, `headerAnchor.test.ts`) |
| FL21-SOL-05 the order in the commit | 1.2 (the order in the commit), 4.2, 7, 8 |
| FL21-SOL-06 unknown through the lookup's GET | 8 (trh-8, a snapshot whose watermark covers the op) |
| FL21-SOL-08 the padding before the reveal | 1.2 (the order in the commit), 8 (`headerAnchor.test.ts`, trh-7) |
| N3 release after every outcome | 1.2 (the order in the commit), 7, 8 |
| FL21-SOL-07 the sender that answers inside the send | 4.2, 8 (store test) |
| Wording: the Initiative note's rows | 3.1 |
| F3 fixed row, two-line words | 3.2, 7, 8 (trh-8) |
| F4 L1's reason, L5 | 2, D-261101-081 |
| F5 the scrim | 4.5, D-261101-093 |
| F6 "Rolling…" | 3.1, 6 |
| F7 input kind | 1.4, D-261101-098 |
| F8 several hosts | 4.2, 4.3 |
| F9 stale docs and comments | 9 (lanes A, B and C) |
| F10 test gaps | 8 (trh-1b, trh-5) |
| F11 "held" scope | What changes 5, 4.2 |
| F12 swipe to close | 1.2 (accepted) |
| F13 reduced-motion suites | 8 (existing steps) |

## Assumptions

- The prototype ran in the dev room (`/dev/room?as=player&pcstats=1&rolls=1`) with the store's single panel and tray standing in for hosts, the Dice panel closed. It proves the place and the throw from the box. Its "nothing moved" numbers ran with Chrome's anchoring on (1.2). The hosts, the Dice panel beside and the first-roll tray race are designed on paper and held by the store's tests.
- Fractional `scrollTop` at 130% left 0.42 px of drift in Chrome. Safari rounds `scrollTop` to whole layout px, which at 130% is up to 0.65 screen px: still inside 1 px.

## As built

Where the build went its own way from the design above, by part.

**The store (lane A).**

- The design's `mount(host)` returning a handle is split in two: `store.host(spec)` makes a `ThrowHost` at render and its `mount()` runs in a layout effect, so a child tray can reach the host before it mounts. `store.mount(spec)` does both (D-261101-102). `useThrowSurface(surface, kinds)` in `useThrows.ts` does it for a component and hands back `{ host, props, rebase }`.
- The Dice panel never holds. A waiting roll there is decided when its tray attaches, not by a `release()` in its sticky line (D-261101-101). Any host that is not held decides its waiting rolls at every attach.
- The resize baseline lives in the store's host (`observed`, `baseline`) and the hook's `rebase()`, not in `headerAnchor.ts`.
- A Dice panel tap committed while the group save page hides its tray waits up to 1 s for the tray, by the same rule.
- Hiding the Dice panel's pane ends its own throw too (D-261101-103). A Dice panel origin with no host binds to the mounted Dice panel (D-261101-105). The warm-up takes the kinds of every mounted host, and a host's dropped taps stand in for a mount count (D-261101-106).

**The header and the mounts (lane B).**

- The settle runs in `BlockHeaderHost`'s layout effect, the parent of the line and the content, so it runs after the tray's attach and every child's effect, as 1.2 orders. Only a change of outcome settles and releases. Every other render only keeps the scroll padding.
- `hold()` and the release of a pick that drew nothing are the host's (`hold`, `picked`), called by `pickRow` and `pickChoice` around the send. A stale choice the control drops before sending holds nothing.
- The panel joins the throw's store only while a grid in it rolls: a `ThrowBinding` child mounts with the first rolling grid and calls `useThrowSurface("block", …)` (D-261101-110). Folding the stat block unbinds it, so a throw in the air ends unseen and the line stays (D-261101-111). A rolling grid outside any host rolls with no line and no throw (D-261101-112).
- The spacer's shortfall is a whole px, rounded up (D-261101-113). A click with any `detail` other than 0 is a pointer's pick (D-261101-114).
- `CharacterPage` keys the host inside itself, since `CharactersPanel.tsx` was not in the lane. The rolling grid lost the wrapper that only spaced the old line under it.

**The tests, the sheet and the docs (lane C).**

- The foot spacer first read the shortfall from `scrollHeight`, which never reads below the pane's height, so on content shorter than the pane by more than the line it came out short and the box moved by the rest. The host now gives the spacer a whole pane more for one layout, reads the content's own height, and sets the spacer to exactly what the scroll needs. `headerAnchor.test.ts`'s fake scroller reads `scrollHeight` as a browser does.
- `trh-1b` runs on a 390 x 2000 phone with a room monster whose block holds only its six abilities: every stat block, a goblin's folded panel included, outgrows a 390 x 844 sheet's cap, so no sheet there is below it (D-261101-120).
- `trh-2` measures the box, the containment and the alignment at 320 x 568 at 130% and at 1440 x 900, and proves the foot spacer on a 2560 x 1440 screen, where the folded panel is shorter than its pane. At 1440 x 900 it is not (D-261101-121).
- `trh-3` takes the Dice panel away mid-throw by putting Initiative in its pane, since closing the pane would grow the token pane, a resize that ends the throw by 4.3 (D-261101-122).
- `sbr-12` closes the panel before the roll lands for its toast and checks that a fold keeps the line. `sbr-16`'s folded roll now has the header say it once and the Dice panel's line say nothing. The alignment sweep's result check finds the header from the grid's host and checks it at the host's width inside the pane, where it checked a line under the grid.
- `blockrolls.e2e.ts` stores the Roll animation switch off with an init script, and `alignmentRoom.ts`'s `openAt` takes stored settings for the block roll sweep.
- `sbr-8` starts Thorn's Initiative row at 40, a value no roll reaches.
