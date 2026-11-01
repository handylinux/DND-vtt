# Look pass 1: locked controls, small roll menus, toasts over sheets, the long formula slip

Status: draft 2.2, after design review round 3 (LOOK1D-SONNET-11 and 12 adopted). Round 2: LOOK1-SOL-03 and LOOK1D-SONNET-10 adopted. Round 1: LOOK1-SOL-01 and 02, LOOK1D-SONNET-1 to 9, all adopted.

Changes from draft 1:
- `HeldScope` only at Dialog among `components/`. A Popover and a Sheet render in place, so their controls stay inside the fieldset, natively off, and keep the held look (D-261101-301 rewritten, D-261101-312).
- The very short sheet's toast row shows whole and stays whole: expansion and Escape now count the slot's toast (LOOK1-SOL-02). Checked in the browser.
- `sheetToastFloor` is a pure function in toastPlacement.ts, tested, and only the toast code reads it. `optionsTop`, `foot` and the strip's `restFloor` keep their own floor (D-261101-310).
- The offline Damage Roll stays held, with its reason in the test (D-261101-311, which takes in D-261101-309).
- A menu that slides over its button ignores a press that starts within 350 ms of its opening (D-261101-313).
- L1A lands a shared render helper (`components/testing/drawn.ts`) and `disabledLookLines`. Chip.test.ts moves to the helper.
- The formula split is a loop, not a lookbehind, and a leading minus stays with its term.
- Draft 2.1: Menu reads `useHeld`. Its rows are `<div role="menuitem">`, which a disabled fieldset does not turn off, so a held Menu draws its rows held, sets `aria-disabled`, and its pointer and key picks do nothing (LOOK1-SOL-03, D-261101-314). Other portals are checked one by one (LOOK1D-SONNET-10).
- Labels stay bright (D-261101-303 kept).

Base: main at `2a524b61`. Decisions D-261101-300 to 314. The house look is docs/design/design-v1-design-pass.md and the tokens in client/lib/theme.ts (`textDisabled`, `border`, looks.ts `buttonLook`, `choiceLook`, `CHOSEN_DISABLED`). The app has one theme (dark), so every shot is in it.

Shots: `screenshots/look-pass-1/` (before and after per surface), the rest kept with the check runs. Taken in the dev room on a prototype build, at 320x568 and 390x844 at 130% and at 1440x900, plus 844x390 and 480x320 at 130% for the toasts.

## Summary

1. **LOCKED-LOOK.** One shared path: `Held`, a fieldset that also tells every shared control inside it that it is off. Controls take the disabled look they already have for their own `disabled`. Every `<fieldset disabled>` becomes `Held`, and the hand-rolled controls that never had a disabled look get one.
2. **DPF1-SMALL-MENU.** Already gone: FL-17 dropped the help block (D-261031-080). What is left is item 3's scroll, and item 3's fix closes it.
3. **FL17-AGAIN-320.** A roll menu that fits on neither side of its button, but fits the screen, slides back over its button until it is whole. Its title names what was pressed.
4. **UNDOB-FIN-2.** A phone's open sheet bounds the toasts the way a resting token strip does. With under 44 px left above the sheet, and always beside a sideways sheet, the newest toast shows as the one row over the top bar's row, and the older ones wait. In the very short sheet the toasts' place holds that one row.
5. **FL4-SONNET-2.** The slip wraps and nothing runs sideways, but a long formula breaks inside a term ("+1d" over "6"). It now breaks only after a + or −.

## 1. LOCKED-LOOK (D-261101-300 to 303)

**Seen.** A locked group save page (offline, at all three sizes): Against a spell, the Damage field and Roll, Half and None, the Frightened chip, Add a condition, It lasts, Whose turn, Rounds, Save that ends it and its DC were all natively disabled by the page's `<fieldset disabled={frozen}>` (GroupSave.tsx:735), yet drew `text` (#f1efe9) and chosen ones the accent. After: all draw `textDisabled` (#7c7a84), the chosen Half and Frightened take the dim outline of `CHOSEN_DISABLED`. Measured in the browser by computed color on every `:disabled` control in the Outcome group.

**Choice.** `client/components/Held.tsx`:
- `Held({ held, style })` renders `<fieldset disabled={held}>` with no box (border 0, margin 0, padding 0, min-width 0) and a context that is true while it or any outer `Held` holds.
- `useHeld(own?)` is `context || own === true`. Each shared control replaces its own `disabled` with `useHeld(props.disabled)` and passes the result to its native `disabled` too, so look and behavior never part.
- `HeldScope` resets the context at a real portal's edge. Only Dialog portals (`createPortal`, Dialog.tsx:207), so only Dialog wraps its children in it: a dialog opened from a held page leaves the fieldset's DOM and its controls act. Nine other `createPortal` sites live in pages/ and features/ (modalSlot, PlayerRolls, InitiativeStrip, PlayerPreview twice, SideTabs, Room, ToastParts). React context crosses a portal, so L1A checks each: any that can render under a held subtree and holds controls also wraps in `HeldScope`. A unit test per wrapped site, and the e2e opens only a Dialog (LOOK1D-SONNET-10).
- A Popover renders in place (`popover="manual"` in the top layer, Popover.tsx:535) and a Sheet in place too, so their controls stay descendants of the fieldset and are natively off. They keep the held look, which tells the truth (D-261101-312). Native `:disabled` reaches only native controls. Menu's rows are divs, so Menu reads `useHeld()` itself: each row's look and `aria-disabled` take `held || it.disabled`, and `pick` returns early while held, for pointer, Enter, Space and typeahead picks alike. A held row also drops its `it.events`: AbilityMenu.tsx:74 gives each ability row a press binding (long press, ContextMenu, Shift+F10) that rolls without `pick`, and its owner's `disabled` does not know Held (LOOK1D-SONNET-11). Arrow keys still move through held rows, since `aria-disabled` menu items stay focusable and a screen reader names them off (LOOK1D-SONNET-12). Menu stays open, so the menu reads as off rather than vanishing under the pointer (D-261101-314). Checked in Chrome: a top-layer popover inside a disabled fieldset keeps its buttons `:disabled`. Real cases: the roll menus inside the group save page (GroupSave.tsx:1275, GroupOptions.tsx:177) while the page goes held.
- `Held` sits in `components/` with the others.

**Rejected.**
- Telling each control by hand, as PinPane.tsx does. That is the bug class: the next control added to a page forgets it.
- A global `fieldset:disabled` rule in globals.css with `!important`. It cannot draw the chosen option's dim outline, the Switch's track, a Chip's count or a Checkbox's help line, and it fights every inline style.
- Opacity on the fieldset. The tokens forbid fades (theme.ts `textDisabled`, looks.ts).

**Labels.** A FieldRow's label ("It lasts") keeps `text`: the row names what the page holds, and the control under it shows that it is off. A Switch's or Checkbox's own name and help dim, as today, since they are the control's own words (D-261101-303). Looked at again in after shot 1: the row labels read as headings over dim controls, which is right.

**Surfaces it changes.** From a full audit of `disabled=`, `aria-disabled`, `readOnly` and every fieldset:
- Shared controls that learn `Held`: Button (so SmallButton, BarButton, OptButton and both ConfirmButtons), IconButton, Field's Input, Select, TextArea and Field, Segmented, Switch, Checkbox, Chip, RadioCards, Swatches, Panel's Section fold button (no disabled look today), tokens/ui TextField and DraftNumber (so NumberField and Stepper), EffectPicker's tiles, measure/controls.tsx ChoiceRows and `chipLook`, scenes/controls.tsx Select, NumberInput, ColorInput and Slider.
- Fieldset sites that become `Held`: GroupSave.tsx (setup: What they roll, Ability, Skill, DC, the two switches, What players see and its two checks, Fill from, each row's How it rolls and Bonus, Change it, and the whole Outcome group), RequestSheet.tsx (Recent, the second choice and Remove, DC, Note for the players, What players see), ResourceSheet.tsx (Add from, Name, Spend an amount, Amount, Comes back on, Class, its level, the rows, the modifier, Remove), JournalEditor.tsx (Title, Folder, Who can read it, the player, Secret, Move up and down, Delete block, the block's text, Add text, Add a secret), PcStatsEditor.tsx and MonsterEditor.tsx (every field under `held`), PinPane.tsx and CompanionBlocks.tsx (drop their per-control flags), DiceSetPicker.tsx (keeps its own tile look, inside `Held`).
- Hand-rolled controls with no disabled look today, given `textDisabled` and the `border` outline: IconsTab IconTile, ImagePicker SearchTile, LibraryGrid's Use this image, NewScene MapStrip, StarterBrowser WorkTile (dim ring and caption), PartyBar's Show it on the map row and the pill's name (`textMuted` to `textDisabled`), CropEditor's Zoom label.
- FromControl's Marked portrait fades to 0.35 opacity. It keeps its grayscale at full opacity, with the dim outline (D-261101-302).
- Not changed (D-261101-302): HpSection's death-save pips show a state and are read only, so they keep their colors and take `aria-readonly`, not `disabled`. XCardButton's Send is a busy button and takes `busy`, which keeps its color. DisplayRoom's Leave keeps its red.

## 2. DPF1-SMALL-MENU (D-261101-304)

At the tip the one-roll menu has no help block: FL-17 moved each choice's help into its accessible description and gave the menu a one-line title (D-261031-079, 080). The shot at 320x568 at 130% with Advantage pressed (four choices) still scrolled ("Scroll for more" after three), from too little room on either side of the formula's Roll. That is item 3's case, and item 3's fix makes it whole.

**Rejected** (each moot now): the help below the list, a shorter help, opening below when above is short (FL-17's flip already does this).

## 3. FL17-AGAIN-320 (D-261101-305)

**Seen.** At 320x568 at 130% the sticky line's Again sits mid-screen. Its four choices with the title need 220 chrome px. Neither side has that, so the box opened below at 189 px and scrolled. Same for the formula's Roll.

**Choice.** `popoverPlace` (components/popoverPlace.ts): where `flip` is on, the box did not rise, the content is taller than the room on the side chosen, and the bound holds it whole, the box keeps that side and slides back over its anchor until whole: `top = bound.top + margin` above, `bound.bottom − margin − height` below. It covers part of the button, and its title ("Again: 1d20+5") says what was pressed. `popoverPlace` returns `covers: true` for such a box. Only roll menus pass `flip` (RollModeMenu.tsx, useAbilityMenu.tsx). A box taller than the bound scrolls as before. After: the menu stands 270 to 557.6 of 568 (10.4 = 8 chrome px from the foot), whole, no "Scroll for more". 390x844 and 1440x900 are unchanged (they fit).

**A second press** (D-261101-313). A long press's own release is already swallowed (rollPress.ts `blockedClick`). A fast second tap aimed at the button would now land on a row and roll. So while a menu `covers` its anchor, Menu ignores a pointer press that starts within 350 ms of its opening (a double tap's span): it neither picks nor closes. A key, and any press after that, acts as today. Test: a unit test of the guard with a fake clock, and the e2e step lk1-again: at 320x568 at 130%, hold Again until its menu opens, tap Again's center within 100 ms, and see the menu still open and no new roll in the log. Then, after 400 ms, tap Roll with Advantage and see one roll.

**Rejected.**
- Dropping the title when space is short. The owner asked for the menu to show what was tapped (D-261031-079).
- Shorter rows. Rows keep 44 px touch targets.
- Scrolling the sheet so the button has room. Again sits in a sticky line, and the page would move under a held finger.
- A bottom action sheet for this one case. It is a second look for the same menu.
- Ignoring a press only on the button's own box. The row over it could then never be tapped.

## 4. UNDOB-FIN-2 (D-261101-306, 307)

**Seen.** Three toasts after a remote Undo, with the Dice sheet open:
- 320x568 at 130%: they stand 151 to 376 px, over the sheet's header (Back, Close), the formula field and Roll.
- 390x844 at 130%: the same, 151 to 343.
- 844x390 at 130%: they span the screen at 88 to 281 and cover the sideways sheet's Close, Roll and the dice.
- 480x320 at 130% (the very short sheet): they sit in its notices place and push the body down to one field's height.
- 1440x900: over the map, clear of the side panel. Unchanged.

**Choice.** One rule from docs/design/design-v1-bar-compact.md 3.5, which the token strip already follows:
- A phone's open bottom sheet counts as a resting strip: the toasts' room ends at `restFloor(sheet top)`, 60 px above the sheet (8 px over the map band's last 44 px). Where at least 44 px remain they stack there as today.
- With under 44 px, the newest toast shows as **one row over the top bar's row**: 44 px, one line, cut with an ellipsis, its action whole at the right. A tap shows it whole with its time held. Close or Escape shrinks it. The older ones wait undrawn, and their time starts when they draw (3.5's `shownAt` rule).
- Beside a sideways sheet (844x390) the room is none, so the row always.
- The very short sheet's toasts place holds the same row, never a stack. Its body loses 44 px, not three toasts' worth.
- A swiped-up full sheet already uses the very short sheet's places, so it takes that row too.
- The side panel on a wide screen is no sheet: nothing changes there.
- `sheetToastFloor({ mode, height, toolbar, sheetHeight })` in pages/toastPlacement.ts: bottom gives `restFloor(height − toolbar − sheetHeight)`, side gives 0, full and none give null, and an unmeasured toolbar or sheet gives null. Room passes it to `Toasts` as its own `sheetFloor` prop. Inside, the toasts' room is the lower of the strip's floor and the sheet's (`overBars`, and the foot a stack is fitted to). The token bar's `optionsTop`, the alerts' `foot` and the strip's `restFloor` for re-placing stacks are not touched (D-261101-310).
- The row shown whole, in the very short sheet as over the bars: `expanded` is the whole toast over the bars or the slot's whole toast, and both the shrink-when-gone effect and the Escape listener read it. Checked at 480x320 at 130%: a tap shows it whole with Close, it stays whole past its 5 s, Close shrinks it to the row, and so does Escape, with the sheet left open.

After: at 320x568, 390x844 and 844x390 the row stands at 5 to 62 px (4 to 48 chrome px) over the top bar, and the sheet's header and controls are clear. At 480x320 one row, then the body. The row's words measure 0.75 px off its center.

**Rejected.**
- Toasts in the sheet's own notices place, pushing the body. Controls move under the finger for a few seconds.
- Toasts at the screen's foot. They cover the toolbar and Panels, far from the eye.
- Smaller toasts. Three still cover the header on a short phone.
- Leaving it, with tests tapping toasts away (D-261031-053). Players meet it at the table.

## 5. FL4-SONNET-2 (D-261101-308)

**Seen** (an earlier follow-up's shot and the dev room at 320x568 at 130%, a twenty-term formula): nothing runs sideways and the fire part keeps its column, but `overflow-wrap: anywhere` breaks inside terms ("+1d" over "6", "+1" over "d6").

**Choice.** DamageSummary.tsx renders a formula part with a `<wbr>` after each +, - or − that follows a term (`formulaTerms`, a loop, since a lookbehind needs Safari 16.4), so a leading minus stays with its term. It keeps `anywhere` for a single term longer than the line. After: whole terms per line, "Cold damage" on its own line. The accessible text is unchanged.

**Rejected.** Closing it as looks right. Keeping terms unbroken with a sideways scroll.

## UI checklist

- **Loading.** No new waits. A held page that waits on a check keeps its own "Checking this save's outcome…" line.
- **Keys and focus.** A held control is natively disabled, as today, so Tab skips it. Chip `unavailable`, Checkbox `aria-disabled` and NumberField `unavailable` keep their focusable forms. The slid menu keeps FL-17's focus rules (first enabled choice). The toast row: Tab reaches its words and action, Escape shrinks a whole toast, as 3.5.
- **Screen readers.** The fieldset already says disabled. The toast voice is unchanged: one hidden status says each toast once as it is pushed, so a waiting toast is still heard.
- **Large interface sizes.** Checked at 130% on every phone size above. The row is 44 chrome px at any size.
- **Words shown.** No new words. The row shows the toast's own words.

| Case | Expected | Test |
|---|---|---|
| Group save page offline | every Outcome and setup control draws `textDisabled`, chosen ones the dim outline | Held.test.ts, sweep `disabledLookLines` on the lifecycle roots |
| Held inside Held, inner false | still held | Held.test.ts |
| Popover opened from a held page | its native controls are `:disabled`, Menu rows are `aria-disabled`, all draw `textDisabled`, and a click or Enter on a row neither picks nor closes | e2e lk1-held-menu (a roll menu open on the group save page as it goes offline), DOM state, computed color, no roll and the menu still open; Menu.test.ts held pick guard, and a held row with `events` ignores a contextmenu and a long press |
| Dialog opened from a held page | its controls act and look enabled | Held.test.ts (HeldScope) |
| Second tap on Again within 350 ms of its slid menu | nothing picked, menu open, no roll | Menu guard unit test, e2e lk1-again |
| 844x390, a sheet open, toasts arrive | the token bar's options, the alerts column and the strip do not move | e2e lk1-toasts measures their boxes before and after |
| Slot toast tapped | whole, timer held, Close and Escape shrink it | e2e lk1-toasts at 480x320 |
| Leading minus | stays with its term | DamageSummary.test.ts |
| Again mid-screen, 320x568 at 130% | menu whole, no scroll, inside the screen | popover.test.ts, sweep dpf1-menu-again |
| Menu taller than the screen | the roomier side, scrolls | popover.test.ts |
| Non-flip popover with no room | scrolls, never covers its anchor | popover.test.ts |
| Three toasts, bottom sheet, short phone | one row over the top bar, none over the sheet | toastPlacement.test.ts, sweep lk1-toasts |
| Tall phone, half sheet, room left | toasts stack above the sheet as today | toastPlacement.test.ts |
| Sideways sheet | the row | toastPlacement.test.ts, sweep 844x390 |
| Very short sheet | one row in its place, older wait undrawn | e2e lk1-toasts at 480x320 |
| Waiting toast's time | starts when it draws | existing toastsLeft tests |
| Twenty-term formula | breaks only after a sign | DamageSummary test, sweep fl4-long-formula |

## Build plan

Lanes by disjoint files, each at most 8 files.
1. **Held core** (lane L1A), in two commits. First the test helper components/testing/drawn.ts (renders a component inside a probe so hooks run, and returns its element tree) with Chip.test.ts and any other test that calls a component as a plain function moved to it. Then components/Held.tsx (new), Held.test.ts (new), Button.tsx, IconButton.tsx, Field.tsx, Segmented.tsx, Switch.tsx, Checkbox.tsx, e2e/helpers/alignment.ts (`disabledLookLines`) and its call in e2e/alignmentRoom.ts `sweep.measure`. Over 8 files: the e2e pair may go in a commit of its own (L1A2).
2. **Held, the rest of components** (L1B): Chip.tsx, RadioCards.tsx, Swatches.tsx, Panel.tsx (Section fold), Dialog.tsx (HeldScope), components/Menu.tsx (the 350 ms guard, D-261101-313, and `useHeld` with the held pick guard, D-261101-314), features/tokens/ui.tsx.
3. **Fieldset sites** (L1C): GroupSave.tsx, RequestSheet.tsx, ResourceSheet.tsx, JournalEditor.tsx, PinPane.tsx, CompanionBlocks.tsx, EffectsSection.tsx, DiceSetPicker.tsx.
4. **Editors and hand-rolled controls** (L1D): PcStatsEditor.tsx, MonsterEditor.tsx, measure/controls.tsx, scenes/controls.tsx, IconsTab.tsx, ImagePicker.tsx, LibraryGrid.tsx, NewScene.tsx.
5. **The rest** (L1E): StarterBrowser.tsx, FromControl.tsx, PartyBar.tsx, CropEditor.tsx, HpSection.tsx, XCardButton.tsx, GroupSave.test.ts (the offline Roll test, D-261101-311), e2e/groupsave.e2e.ts (lk1-held-menu).
6. **Menus and the slip** (L2): popoverPlace.ts (`covers`), popover.test.ts, DamageSummary.tsx and its test, e2e/rollmodes.e2e.ts (lk1-again).
7. **Toasts** (L3): pages/Room.tsx, pages/toastPlacement.ts (`sheetToastFloor`), toastPlacement.test.ts, e2e/alignment-followups.e2e.ts (lk1-toasts).

L1A goes first. L1B to L1E stack on it and run side by side. L2 and L3 are independent, but L2's lk1-again needs L1B's Menu guard, so it stacks on L1B.

**Tests.**
- Held.test.ts renders each shared control inside `Held held` and checks its native `disabled` and `textDisabled` color, nesting, and `HeldScope`. In a prototype build: 13 tests pass, and with `useHeld` dropped from Switch its test fails.
- `disabledLookLines(root)` in e2e/helpers/alignment.ts: every visible `:disabled` or `[aria-disabled=true]` control under a measured root draws `textDisabled` for its words (or holds no words), never opacity under 1. Exempt only by a `data-disabled-look="busy"` or `"readonly"` mark (D-261101-302). `sweep.measure` runs it on every root, so the class is checked app-wide wherever the sweep reaches. Mutation: drop Held from GroupSave and the lifecycle roots fail.
- popover.test.ts: the slide above and below with `covers`, the bound-taller case, non-flip. In a prototype build.
- toastPlacement.test.ts: `sheetToastFloor` for bottom, side, full and none, an unmeasured toolbar and a sheet of height 0. In a prototype build.
- DamageSummary.test.ts: break chances only after a sign that follows a term, a leading minus, spaced signs, the minus sign, and 19 `<wbr>` in a twenty-term formula. In a prototype build.
- GroupSave.test.ts:350, renamed "offline, the damage Roll is held with the page, and its menu picks stay guarded". It checks the Roll's `disabled` and `textDisabled`, and its comment says why: the browser's fieldset always held it, and FEATURES.md says a roll while offline waits with "Rolling needs a connection." No doc promises an offline tap (FEATURES.md, docs/dm-guide.md grepped). With the page's `Held` set to false the test fails.
- A prototype build passed typecheck and all unit tests (11962 pass, 0 fail).

**E2E.** New steps, prefixed lk1-:
- lk1-toasts (alignment-followups): three toasts pushed with the Dice sheet open, at 320x568, 390x844, 844x390 and 480x320 at 130%. No toast box meets the sheet's header or body. At 844x390 with a token selected, the token bar's options, the alerts column and any resting strip keep their boxes as the toasts come. At 480x320 the slot holds one row, a tap shows it whole, it outlasts its 5 s, and Close and Escape each shrink it.
- lk1-held-menu (groupsave): a row's roll menu open on the group save page, then the connection drops. Its rows are `aria-disabled` and draw `textDisabled`. A click, an Enter and a Shift+F10 on a row send no roll and leave the menu open.
- lk1-again (rollmodes): the second press guard above.
Run alignment, alignment-wide, alignment-followups, groupsave, savespell, rollmodes, dice, bardock, barrest and reach.

**Alignment sweep.** 1440x900, 390x844 and 320x568 at 100% and 130%, plus 844x390 and 480x320 at 130% for the toasts. Roots that already cover the changed screens: the group save lifecycle roots (undo B), dpf1-menu-again and dpf1-menu-recent, fl4-long-formula. New: lk1-toasts.

**Docs.** FEATURES.md: the toast row while a phone's sheet is open, and roll menus that cover their button on a small screen. The DM guide's toast lines if they name where toasts sit.

## Decided

- D-261101-300: one `Held` path (fieldset plus context) that every shared control reads. Rejected: per-control flags, a global CSS rule, opacity.
- D-261101-301 (rewritten in draft 2): `HeldScope` at Dialog, plus any other portal that can sit under a held subtree and holds controls. Rejected: at Popover and Sheet, which render in place, where it drew natively dead controls as live.
- D-261101-302: death-save pips stay colored and read only, X-card Send is busy, Leave stays red, FromControl drops opacity for grayscale and the dim outline. Rejected: dimming state displays.
- D-261101-303: FieldRow labels keep `text`. Rejected: dimming every row label.
- D-261101-304: DPF1-SMALL-MENU closed by FL-17, the remaining scroll fixed by 305. Rejected: help below, shorter help, open below.
- D-261101-305: a flip menu with no room on either side slides over its button until whole. Rejected: drop the title, shorter rows, scroll the sheet, an action sheet.
- D-261101-306: a phone's sheet bounds toasts as a resting strip, the one row over the top bar where under 44 px is left or beside a sideways sheet, one row in the very short sheet. Rejected: in the sheet's notices, at the foot, smaller, leave it.
- D-261101-307: the sheet's floor uses the strip's 60 px rule. Rejected: 8 px above the sheet, which leaves no map band.
- D-261101-308: formulas break only after a sign. Rejected: as is, a sideways scroll.
- D-261101-309: taken into D-261101-311.
- D-261101-310: only the toasts read the sheet's floor. Rejected: folding it into `toastFloor`, which set `optionsTop` and `foot` to 0 beside a sideways sheet.
- D-261101-311: the offline Damage Roll stays held, as the browser already held it, with the reason in the test. Rejected: moving it out of `Held` so an offline tap acts.
- D-261101-312: a popover opened from held controls dims, since its buttons are natively dead. Rejected: portaling the popover so its controls act.
- D-261101-314: a held Menu stays open with its rows off, drops their press bindings, and arrows still move through them. Rejected: closing the menu when its page goes held (the menu would vanish under a moving pointer), leaving the rows live and trusting the roll guard (the look would lie), skipping held rows on arrows (every row is held, so focus would have nowhere to go).
- D-261101-313: a menu that covers its button ignores a press starting within 350 ms of its opening. Rejected: no guard (a fast second tap rolls), a guard on the button's box only.

## As built

Held core (L1A):
- `Held`, `useHeld` and `HeldScope` landed in components/Held.tsx as 1 describes. `Held` also passes `aria-busy` to its fieldset, for the sites whose fieldset says it is saving (JournalEditor.tsx, PinPane.tsx).
- Button, IconButton, Field's Input, Select, TextArea and Field, Segmented, Switch and Checkbox read `useHeld(props.disabled)` and pass it to their native `disabled`. Checkbox's own `aria-disabled` form (a tick that cannot be taken away now) yields to a held group: inside one the box is natively off, with no `aria-disabled` of its own.
- Held.test.ts covers those nine controls, nesting, a group that is not held, and `HeldScope` (12 tests). Chip and RadioCards join it with their own change. Mutations: with `useHeld` dropped from Switch its test fails, and with the context read dropped from `useHeld` every held test and the nesting test fail. Dropping the outer read in `Held` fails the nesting test, and an empty `HeldScope` fails its test.
- components/testing/drawn.ts landed with Chip.test.ts moved to it. No other unit test calls one of these controls as a plain function outside a render: Button.test.ts and Menu.test.ts already draw theirs inside a probe, and the tests that call page components as functions get these controls back as elements, never running them.
- The portal check: of the nine `createPortal` sites outside Dialog, none renders under a held group. modalSlot's notices, the roll card, the initiative strip, the player preview, the side tabs' tip, Room's and the toasts' portals all render in the room's own frame, and PinPane's dock row sits outside its fieldset. So `HeldScope` stays at Dialog alone.
- `disabledLookLines` and its call in `sweep.measure` (e2e/helpers/alignment.ts, e2e/alignmentRoom.ts) move to L1A2, after every fieldset site is `Held`, since the sweep would fail on the sites not yet moved.

The rest of components (L1B):
- Chip, RadioCards (both its fieldset and its radio group forms), Swatches, the Section fold, and tokens/ui's TextField and NumberField (so Stepper too) read `useHeld(props.disabled)` and pass it to their native `disabled`. A held Section fold is natively off and draws `textDisabled` in place of its muted or danger tone. Held.test.ts covers each of them.
- Dialog wraps its portal in `HeldScope`. Dialog.test.ts draws a Dialog inside a held group, with a stand-in document, and finds its controls bright and live.
- Menu reads `useHeld()` as 1 says: a held row draws off with `aria-disabled`, its pointer, reader and key picks do nothing, it drops `it.events`, and the arrows and typeahead still move focus through it.
- The second press guard (3) reads `covers` from the placement Popover last made, which Popover now keeps in its context (`placed`). That is one file past the plan. Menu reads `covers` only where the placement carries it, so it builds before popoverPlace returns it, and its tests stub the placement. The guard holds a press from its pointer down to its click: the click picks nothing and the row's press binding never starts. A key, and a reader's activation (a click with detail 0), pick at once. The window starts at the menu's first render.
