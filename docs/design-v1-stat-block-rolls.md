# raccoon-vtt v1: rolling from a stat block's ability boxes

Status: draft 2, with design review round 1's findings, 2026-10-31. Code references are from main at `19dc9e7a`. The build starts after FL-17 merges and refreshes these references against that tip, since FL-17 changes files this design reads or extends: `client/features/dice/rollMode.ts`, `RollModeMenu.tsx`, `useRollModeMenu.tsx`, `useDicePanel.ts`, `RollOptions.tsx`, `Roller.tsx` and `RecentRolls.tsx`, and `client/components/Popover.tsx`, `popoverPlace.ts` and `popoverRules.ts`. Client only: no server, protocol, projection or stored state changes. No implementation or browser measurements are claimed here.

The project owner asked on 2026-10-31: "So I'm aware the roll panel is independently useful because it allows rolling for multiple tokens at once, but it does feel a bit clunky to have to go to a separate roll panel to do so while in the stat block. Please come up with a design that allows players to do basic character based rolls from the stat block (skills, saves, initiative, etc). We don't need a whole dice selector like we have in the roll tab though. Open to ideas here so please mock a few up for me". Then: "The stat block rolls should also obviously have the long press/right click shortcut". Shown four mockups, they picked: "I like C but we should only implement the rolls in the ability boxes and not mess with the skills row (leave as text) or add weapons".

So this is the mockups' option C, "Tap an ability", limited to the six ability boxes (D-261031-100). A tap on a box opens a short list of that ability's rolls: its check, its save, its skills, and Initiative under Dexterity. A tap on a roll rolls it. Every roll in the list takes the one-roll options' hold, right-click, ContextMenu and Shift+F10 shortcut, and holding one swaps the list for that roll's options (D-261031-077). It builds on FL-17's menu: no description paragraphs (D-261031-076), "Roll normally" only where a tap would not roll normally (D-261031-078), and a title row naming the roll with an accent ring on what was pressed (D-261031-079). Decisions here are D-261031-101 to D-261031-129, the review's D-261031-130 to D-261031-132, and D-261031-133 onward from round 1, listed in section 14.

## What differs from the mockup the project owner saw

These change what the mockup showed. Each is decided in section 14 and open to overrule.

1. **No hover outline on a box.** The app draws no hover looks on its buttons, so a box shows only the mockup's small corner mark, at the mockup's 6 px from the corner, and a pointer cursor (D-261031-102).
2. **A proficient roll in the list shows FL-12's border on its row, not a bold bonus.** FL-15 dropped bold as a sign (D-261030-588), and a row in this list is a roll control, so it takes the border the Dice panel's cells take (D-261031-106).
3. **The result shows under the ability grid, not at the top of the block.** A line added above the grid would push the box just tapped down under the finger (D-261031-116).
4. **Escape in a roll's options steps back to the ability's list**, and a second Escape closes it. The mockup closed both at once (D-261031-111).
5. **A hold or right-click on a box opens its list**, as a tap does. The mockup's boxes ignored both (D-261031-104).
6. **Titles and the open box follow FL-17**: the title row's small capitals, and the accent ring outside the box, not the mockup's bold title and light border (D-261031-079).
7. **A room that uses initiative scores** lists "Initiative score" before "Roll initiative" under Dexterity for a monster in the fight. The mockup had no such room (D-261031-109).
8. **A DM's roll for a monster from its block is secret**, as an ordinary Dice panel roll for it starts, and its options are Advantage and Disadvantage only, since Roll secretly would do just what the tap does. The block reads no Dice panel toggle, so rolling one in the open stays in the Dice panel (D-261031-112, D-261031-113, D-261031-131).
9. **No hint line at the foot of the list.** The mockup's "Hold a roll for Advantage, Disadvantage or Secret." is dropped, as the roll menus carry no description text (D-261031-130). The shortcut sheet, the guide and each roll's accessible description teach the hold.
10. **The result line names a mode only where it costs no extra line.** As the mockup did, a roll from its options reads "with Advantage" or "with Disadvantage", and a secret one "secret", but these words are the first part dropped on a short line, where only the description keeps them. The mockup always showed them, and wrote a secret roll's as "you and the DM" (D-261031-132, D-261031-134).
11. **A box keeps FL-15's height**, about 56 px, not the mockup's 64 px minimum, so the grid does not grow when it rolls (D-261031-101).
12. **No pop on a new result.** The mockup's line scaled in briefly. The Dice panel's newest-roll line has no such motion, and the block's follows it (D-261031-116).

## 1. Scope

- **In**: the six boxes of the shared ability grid, where the block belongs to a creature the viewer may roll for (section 2). Each opens a list of that ability's check, save and skills, with Initiative under Dexterity. Each roll in it rolls on a tap and has the one-roll options. A result line under the grid.
- **Out**: the Skills line, the Initiative and Passive Perception line, spellcasting, weapons and every named roll, which stay text (D-261031-100). Death saves stay in HP and the Dice panel. No group rolls, no typed bonus, no Ask switch, no Again and no dice tray in the block. No new roll permissions or routes.
- **Fixed**: FL-15's look of a box (D-261030-588) and the grid's size at every width and interface scale. 44 px targets. Nothing that needs hover. Alignment within 1 px under the strict helpers.

## 2. Where the boxes roll

**The rule.** The boxes roll where the block is a creature's that the Dice panel would let this viewer roll for, and stay text everywhere else (D-261031-117). A player: a creature `playerCreatures` lists (`client/features/dice/options.ts:134`), so their own characters wherever their tokens stand, their characters' companions on the players' scene and other creatures they own there. The DM: a creature's token on the scene in view, and a character with a token on that scene. A token on the scene is rolled for as `{ tokenId }`, a character's block as `{ characterId }` with its token on the scene kept for the DM's ask, the forms the Dice panel uses (`RollOptions.tsx:199`, `useOptionsEndOnGroup`). Both resolve to one creature key (`creatureKey`, `options.ts:160`), so a row and a request match either form.

One pure function decides it, `blockRoller(view, you, sceneId, from)` in `client/features/dice/blockRolls.ts`, returning the creature, its token, its name and whether a player plays it, or null. `from` is `{ tokenId }` from a token's panel, the PC token's included, or `{ characterId }` from a character's page, and `sceneId` is the viewer's own scene (`useRoomView((s) => s.sceneId)`, as `RollOptions.tsx:194` reads it). From a PC token, the creature is `{ characterId }` and its token is that token. From a character's page, its token is the first token of that character on `sceneId`, the one `playerCreatures` picks (`options.ts:139`), or none. Any other token is the creature itself, `{ tokenId }`. `PcStatBlock` takes the `from` its mount gives it: `StatBlockSection` passes the token's, and `CharacterCard` the character's (D-261031-139). A character whose numbers this viewer does not hold (`readsCharacter`, so `creatureRolls(...).numbers` is null, `client/features/dice/creature.ts:174`) also stays text. A block whose numbers wait on the SRD rolls table still rolls, and its list shows the loading line until they come (4.6).

| Mount | Viewer | Boxes |
| --- | --- | --- |
| A PC token's panel, its sheet (`StatBlockSection.tsx:116`, `PcStatBlock.tsx:99`, `PcStatsView.tsx:34`) | The DM, the character's players | Roll, for the character |
| That panel in a shape: the creature's block under "Rolls now" (`PcStatBlock.tsx:183`) | The same | Roll, with the character's numbers in that shape (section 6) |
| The character's page (`CharacterCard.tsx:162`) | Its players | Roll, wherever its token is or with none |
| The character's page | The DM | Roll while the character has a token on the scene in view, else text |
| A monster's or NPC's panel, a room monster or SRD block (`StatBlockSection.tsx:161`, `:257`) | The DM | Roll, for the token |
| A companion's panel, its character's block or an SRD block (`:189`, `:257`) | The DM, the companion's players | Roll, for the token |
| A companion linked to a room monster (`:161`) | The DM, who alone sees it | Roll, for the token |
| An SRD-linked token a player owns, such as a 2014 Wild Shape token or a summon (`statBlockLink.ts:73`) | Its owner | Roll, for the token |
| The Monsters panel (`MonstersPanel.tsx:246`) | The DM | Text: a library block, no creature |
| A character's companion blocks list (`CompanionBlocks.tsx:374`) | The DM, the character's players | Text: a library block, no creature |
| A block whose Markdown holds no ability table (`abilityTable.ts`) | Anyone | No grid, so nothing changes |

A preview as a player keeps the boxes and blocks their rolls with the preview's words (section 4.6), as the Dice panel does.

## 3. The box

### 3.1 Look

A box keeps FL-15's look exactly: its padding, radius and raised fill, its three lines (the abbreviation, the score and modifier, "Save +6"), and for a proficient save the 1 px outline inside its edge (`AbilityGrid.tsx:18-45`). Only its markup changes while it rolls, since a `<dl>`'s grouping `<div>` may hold only `<dt>` and `<dd>`, and a button laid inside it would break that content model (D-261031-101, D-261031-136):

- **A text grid** stays today's `<dl data-ability-grid>`, byte for byte: no button, no mark.
- **A rolling grid** is `<div data-ability-grid role="group" aria-label="Abilities">` with the same grid style, holding six `<button type="button">` boxes. Each button is the box: the same inline padding, radius, fill and `boxShadow` outline, `display: block`, `width: 100%`, `text-align: left`, `font: inherit`, `color: inherit`, `border: 0`, `cursor: pointer`, and `data-save-proficient` where the save is proficient. Its three lines are `<span>`s with `display: block` and the same type, marked `data-ability-abbr`, `data-ability-score` (the score still in `<strong>`) and `data-ability-save`, so every word stands where it stands in a text grid.
- **A corner mark**: the mockup's 10 px down chevron, `aria-hidden`, `pointer-events: none`, in the muted text color, placed absolutely 6 px from the box's top and right edges, as the mockup placed it, inside the first line's height and clear of the abbreviation. The button takes `position: relative` for it. It is content placed beside content in the flow, which the alignment check leaves to its containing block.

No hover look, as the app's buttons have none. FL-15's checks read the boxes in either form: lane C extends `saveOutlineLines` (`e2e/helpers/alignment.ts:590`) to take a box's parts from `dt` and `dd` or from those three data attributes, and gives its own self-test (`e2e/alignmentRoom.ts` `fl15-helper`) a rolling box. Its pixel check is unchanged, since the outline and the words are drawn as before.

### 3.2 Name, focus and size

- **Name**: the button's `aria-label` is the box's printed words, "Strength 16, +3, save +6, proficient", using `spokenProficiency` for the last part, so a reader hears each box once, as one control, whether it moves through the page or explores by touch. Its description: "Opens the check and the save" for Constitution, "Opens the check, the save and its skills" for Strength, Intelligence, Wisdom and Charisma, and "Opens the check, the save, its skills and Initiative" for Dexterity. It has `aria-haspopup="menu"`, `aria-expanded` and, while open, `aria-controls` (D-261031-103).
- **Focus**: the global ring (`client/globals.css:113`), 2 px of accent 2 px out, on the button and so around the whole box, hidden after a pointer as elsewhere. Open, FL-17's accent ring stands 2 px outside it (`markRollModeSource`), in both of the menu's views. The grid's 4 px gap leaves each ring clear of its neighbor.
- **Size**: a box is about 56 px tall (116 px for the grid's two rows, `docs/design-v1-dice-ui.md` 6.1), over 44 px. Its width is a third of the block's column less the gaps. Lane C measures both at 320 x 568 at 130%, the narrowest, and the build stops for a design change if a box falls under 44 px wide there.

### 3.3 Presses on the box

The box rolls nothing, so it has no one-roll options. Every way of pressing it opens the same list (D-261031-104). It uses the shared press machine (`client/features/dice/rollPress.ts`) through the binding factored out of `useRollModeMenu` (section 10), so a hold's release, a duplicate native context menu and a cancelled press behave as on roll buttons.

| Press on the box | Does |
| --- | --- |
| Tap, click, Enter or Space | Opens the list. A key opening focuses its first enabled roll, a pointer follows Popover's pointer rule |
| Down or Up | Opens the list on its first or last enabled roll, as any menu button (`Popover.tsx:190`) |
| A still touch of 500 ms | Opens the list. The release's own click picks nothing. The 200 ms inset ring shows first, as on roll buttons |
| Right-click | Opens the list, never the browser's menu. Right-click again closes it |
| ContextMenu or Shift+F10 | Opens the list, first roll focused |
| Any press on the box while its list is open | Closes it, rolling nothing |
| Moving past 8 px, a scroll, a second finger | Cancels a hold, as on roll buttons. Native scrolling and the sheet's swipe keep their touches |

## 4. The ability's list

### 4.1 What it holds

A `Popover kind="menu"`, side "above", flipping below where it does not fit, within the screen (FL-17's placement), anchored to the box. Inside: the title row and the rows, with no foot line (D-261031-105, D-261031-110, D-261031-130).

| Ability | Rows, in order |
| --- | --- |
| Strength | Check, Save, Athletics |
| Dexterity | Check, Save, Acrobatics, Sleight of Hand, Stealth, Initiative (in a score room: Initiative score, Roll initiative) |
| Constitution | Check, Save |
| Intelligence | Check, Save, Arcana, History, Investigation, Nature, Religion |
| Wisdom | Check, Save, Animal Handling, Insight, Medicine, Perception, Survival |
| Charisma | Check, Save, Deception, Intimidation, Performance, Persuasion |

Every skill of the ability is listed, whether the block names it or not, so every skill has one home (`SKILLS`, `shared/rules/skills.ts:23`). Constitution, with no skills, still opens a two-row list rather than rolling its save at once (D-261031-119).

### 4.2 A row

- **Words**: the roll's name at the start, "Check", "Save", "Stealth", "Initiative", and its bonus at the end in tabular figures, "+6", "−1" (`signedText`). The bonus is the one rolled: `bonusFor(numbers, test)` over `creatureRolls(...).numbers` for saves, checks and skills (`shared/dice/bonus.ts:78`), and `initBonus` for Initiative, as the Dice panel's cells read them (`RollOptions.tsx:553-591`). So Jack of All Trades, Alert, a stat block's adjustments and a monster's printed skills are in it already.
- **Tags**: small muted words after the name (D-261031-108, D-261031-135). From the Dice panel cell's rules (`RollOptions.tsx:836-845`): "Asked" where the tap answers an open request, a preset's tag, "Dis", "Adv", "+1d4", "Fails", from `presetTag` (`options.ts:570`), and Initiative's tracker tag, "sets row" or "replaces 17 · −4" (`initiativeTag`, `options.ts:761`). Two differ from the panel, both because the list has no group label to carry what the panel's label carries: a row keeps its whole preset tag, where the panel lifts the parts every save or check shares into the group's label (`commonTags`, `RollOptions.tsx:840-844`), and a save, check or skill the DM's tap would ask is tagged "Asks", which the panel says once in the label, "asks Bree" (4.4). A row whose words and tag do not fit wraps its tag under its name, never its bonus.
- **Marks**: a save or skill the creature is proficient in draws FL-12's box form on the row's own transparent border, heavier for proficient and doubled for expertise (`proficiencyBox` over the popover's fill, `markedBy(level, "box")`), from `creatureProficiency` (`creature.ts:148`), so the list marks what the Dice panel marks (D-261031-106). A check and Initiative have no mark, as in the Dice panel (`marksTest`).
- **Name for a reader**: the whole roll, "Dexterity save +2, proficient", then where it goes, ", answers the DM's request" or ", asks Bree", then the preset in words, "Dis: Restrained" (`presetLine`). Its accessible description is FL-17's shortcut words for a roll with options, `rollModeHint`: "Hold, right-click or Shift+F10 for Advantage, Disadvantage or Secret.", or "for Advantage or Disadvantage." where Secret is not offered (5.2), with `aria-keyshortcuts="ContextMenu Shift+F10"`. A row with no options has neither (D-261031-107).
- **Busy**: a row whose roll waits shows "…" after its bonus and is disabled, `aria-busy`, until its line lands. The row key is the Dice panel's (section 7), so the same save waits in both places and cannot go twice (D-261031-126).

### 4.3 Initiative

Initiative sits under Dexterity, last. It rolls `{ kind: "initiative" }` with the creature's preset, marked as initiative so the server keeps it from players who may not know the order (`asInitiative`, `options.ts:109`). In a fight, its write to the tracker is the Dice panel's: `useWatchInitiative` starts the room's listener once the tag is sent, and it writes once only while the row still holds what it held at the tap (`useRollOption.ts:242-278`). A changed row says "Not set: the row changed meanwhile." in the result line (section 8).

**Score rooms** (`scoreOf`, `options.ts:260`): where the room uses initiative scores and the creature has a row, for the DM or where players may type totals, Dexterity lists two rows (D-261031-109). "Initiative score", with the score at its end, sets the row without dice, as the Dice panel's "Score 12" does (`setInitiative`). It is not a roll, so it has no options and no shortcut description. It sends no roll, so it leaves the result line as it was, and the tracker row shows the score (D-261031-137). Then "Roll initiative", with the bonus at its end, tagged "replaces the score". Read out: "Initiative score 12, sets its row" and "Roll initiative +2, replaces the score".

### 4.4 A creature a player plays, for the DM

The DM's save, check and skill rows for a creature a player plays ask that player while the Dice panel's "Ask Bree to roll saves and checks" switch is on for it, its default (`RollOptions.tsx:409-425`). The block reads the same switch from the option store (`askOff`, keyed by creature) and adds no switch of its own (D-261031-120). Those rows are tagged "Asks", and a tap opens the request sheet filled with that test (`openAsk`, `useRollOption.ts:96`). An ask has no one-roll options, as the one-roll menu's design says (`docs/design-v1-roll-mode-menu.md` 4). Initiative never asks. With Ask off, the rows roll on the server as the DM's rolls.

### 4.5 Title

The ability's name, "Dexterity", in FL-17's title row look (`data-roll-mode-title`, the section label look, two lines at most). The menu's accessible name is "Dexterity rolls". Nothing stands under the rows: the mockup's foot line is dropped, since the roll menus carry no description text (D-261031-110, D-261031-130).

### 4.6 Waiting, blocked and loading

- **Blocked**: with no connection or in a preview (`useRollBlocked`, `useRollOption.ts:25`), the box still opens its list, which reads its numbers. Every row is disabled (`aria-disabled`, still focusable), and one muted line under the title says why, "Rolling needs a connection." or "Rolls are not sent from a preview." (D-261031-121). This line is a state, not help, and goes when the block may roll again.
- **Loading**: a shape's or SRD creature's numbers need the SRD rolls table (`useDiceView`, `client/features/dice/useDiceView.ts`). While it loads the list holds the shared `Loading` line, "Loading the rolls…", in place of its rows, with the shared delay. If it fails, `SrdLoadFailed` says so inline with its reload (D-261031-122).
- **Live**: the rows follow the room while the list is open: a new request tags its row "Asked", a condition changes a tag, a bonus moves with a level. A row's options close if their own roll changes (5.4). The whole list closes when the creature goes, when the block unmounts, when the box stops rolling (section 2), and when a scroll takes the box out of view (`handleRollModeScroll`).

### 4.7 Keys in the list

The list is the shared `Menu` (`client/components/Menu.tsx`), so its keys are every menu's: Up and Down move and wrap, Home and End, a letter types ahead by the row's name, Enter or Space rolls, Tab and Shift+Tab close and move on, Escape closes back on the box. ContextMenu or Shift+F10 on a row with options opens them (section 5). Every key it handles is marked used.

**How a row's press binding meets Menu's own handlers** (D-261031-160). A row gets the binding's pointer, touch, context menu and key handlers through Menu's item `events`, and no `onClick` of its own: Menu's `onClick` stays the one pick (`Menu.tsx:195`). The binding's window capture click listener runs before any element's handler, so a click the press machine swallows never reaches Menu's pick, and one it lets through picks once. The row's own `onKeyDown` takes ContextMenu and Shift+F10 and marks them used before Menu's root `onKeyDown` sees them, which skips a used key. Enter and Space stay Menu's, and the binding's window keydown listener resets the press machine on every key, as for roll buttons. The box takes the binding's handlers and its `onClick` (the press machine's gate, then open or close) with Popover's anchor `ref` and arrow keys, and not Popover's own anchor `onClick`, so a press opens or closes the list once.

## 5. A roll's options inside the list

### 5.1 Opening them

A hold of 500 ms on a row, a right-click on it, or ContextMenu or Shift+F10 on it focused, swaps the list for that roll's one-roll options in the same popover, still anchored to the box (D-261031-111). The press machine is the one-roll menu's (`client/features/dice/rollPress.ts`), one per row: a moving finger cancels, and the 200 ms inset ring shows on the row. A plain tap on the row rolls it, as a tap on any roll button does.

**The held press outlives its row** (D-261031-138). The swap removes the held row while its finger is still down, and in FL-17's binding a control's press machine, its window listeners and its consumed touch end with the control (`useRollModeMenu.tsx:110-150`, `rollPress.ts:112`). The release could then land on Roll with Advantage, drawn where the rows were, and roll it, and the still-held finger could scroll the popover or the sheet. So `useAbilityMenu` owns every row's press machine, kept in a map by row, not by the row's element. Its window listeners (pointer down, move, up and cancel, the capture click, keydown, blur, visibility and scroll) and the held finger's consumed touch belong to the hook. They stay while the list or its options are open, and after that while any machine still holds a press or a click to swallow. The held machine lives until its own synthetic click after the release is spent, a new press starts or a key is pressed, not only until pointerup. It also ends when the box unmounts. The held finger's up, cancel and touchend are heard at the document, since React runs no handler on a row that is gone. So the hold's release clicks nothing, and the finger's drift after the swap scrolls nothing.

**A reader still acts** (D-261031-161). Only the hold's own pointer click is swallowed, a click with `detail` not 0. A later assistive activation, a click with `detail` 0 such as a screen reader's double-tap, on an enabled choice picks it once, as `RollPress.click()` allows today (`rollPress.ts:98-104`, held by `rollPress.test.ts:54`).

### 5.2 What they show

- **Title**: the roll as the list words it, with its ability where the row's name alone is "Check" or "Save": "Dexterity save +2", "Dexterity check +2", "Stealth +6", "Initiative +2", or "Roll initiative +2" in a score room. It is passed to FL-17's title row as `title`, since the row's own words say too little.
- **Choices**: FL-17's `rollModeItems` with `{ d20: true, visibility: "selectable" }`, or `"request"` for a row that answers a request. So Roll with Advantage, Roll with Disadvantage and Roll secretly, the last disabled for an answer with FL-17's reason as its description. No Roll normally: the block reads no Dice panel toggle, so a tap already rolls normally (D-261031-078, D-261031-112). Its accessible name is "Roll options for Dexterity save +2".
- **No Secret where the tap is secret already** (D-261031-131): on a DM's row for a creature no player plays, `startsSecret` (`shared/dice/secret.ts:31`) makes every tap secret, and Roll secretly would send just what the tap sends. Those rows pass a new capability flag, `secretByDefault: true`, which `rollModeItems` reads to leave Secret out and `rollModeHint` to leave it out of the shortcut words. The options there are Roll with Advantage and Roll with Disadvantage. Rows for a creature a player plays, and every player's row, keep Secret. The same duplicate in the Dice panel's own menu for a DM's monster is an FL-17 follow-up, outside this build.
- **The box** keeps FL-17's accent ring, since the row that was held is no longer drawn.

### 5.3 Back, pick and focus

- **Escape or Android Back** in the options goes back to the list, nothing rolled, with the held row focused whether the options opened by key or by pointer, so the next Up or Down starts there. A second Escape or Back closes the list on the box. Popover gains one optional hook, `stepBack`, that it asks before Escape or Back closes it (section 10), since its Escape listener runs first in the capture phase (`Popover.tsx:396`, `:430`).
- **Back registers anew after each step back** (D-261031-162). The back closer drops an overlay's registration and its history entry before it calls that overlay's close (`client/lib/backClose.ts:116-117`), and Popover registers once, `useBackClose(true, ...)` (`Popover.tsx:455`). A popover kept open by `stepBack` would then hold no registration, and the next Back would close the sheet under it or leave the room. So Popover registers with a key that changes on each step back, a count it raises when `stepBack` keeps it open, as `HandoutPopup.tsx:263` does with `useBackClose(key, close)` for each handout shown in turn. The new registration takes the back closer's next entry, so the next Back closes the list, and the one after that whatever was open under it.
- **A pick** rolls once with that choice and closes everything, focus back on the box (FL-17's `onPick`: capture, close, then send).
- **A tap outside**, a press on the box, Tab, or the box leaving view closes everything, rolling nothing.
- **Focus on the swap** (D-261031-163): a key swap focuses the first enabled choice. A pointer swap puts focus on the box, as a pointer opening does (`openFocus`, `client/components/popoverRules.ts:24`), since a press on a row focused that row and the row is going. Either way the hook moves focus before the held row unmounts. Popover's mutation watch would otherwise move focus to the control nearest the one that went, a choice, without closing (`Popover.tsx:407-415`), against the pointer rule.
### 5.4 Staying true

Each row's options are keyed by the roll's source, the row, its route, its test, its bonus, its preset and the creature, as the Dice panel's cells key theirs (`RollOptions.tsx:850`). When the source changes while they are open, as when a request for that save lands, they go back to the list, which shows the new tag. A pick revalidates the route as the one-roll menu's does (`valid`), so options opened for one roll never send another.

## 6. Numbers: Wild Shape and other cases

- **One source**: every bonus, tag and mark in the list comes from `creatureRolls`, `presetFor` and `creatureProficiency`, the Dice panel's own (`creature.ts:148`, `:174`, `client/features/dice/presets.ts:33`). The box's printed words come from the block, as today.
- **Wild Shape with a block**: the section shows the creature's own block, its boxes printed and outlined as the creature's (D-261030-591). Its boxes roll for the character with "Rolls now"'s numbers (`shapedNumbers`, `shapedInitiative`, `shared/rules/pcStats.ts:284`, `:312`): the beast's Strength, Dexterity and Constitution, the druid's Intelligence, Wisdom and Charisma, each save and skill the higher of the druid's rule and the beast's printed one, and initiative from the beast's Dexterity with the druid's Alert. So Bree as a Brown Bear (`docs/design-v1-pc-stats.md` Appendix C) reads "Save +1" in the Wisdom box and "Save +6" in its list. The marks are `creatureProficiency`'s for a shape (D-261031-118).
- **Wild Shape without a block, or another shape such as Polymorph**: the creature's own numbers, initiative still the actor's (`docs/design-v1-pc-stats.md` 3.6).
- **A 2014 Wild Shape token** (an SRD token the player owns) rolls its own block's numbers.
- **Jack of All Trades and other folded bonuses** are already in `pcRollNumbers`' skills (every skill with its whole bonus) and in a block's numbers. A plain ability check takes no Jack, as in the Dice panel.
- **Conditions and effects** come through `presetFor` at the tap, with the routed test for an answer, so Magic Resistance meets a spell's request (`presetOf`, `useRollOption.ts:103`). Restrained, Bless, Exhaustion and a fail such as Stunned on a Dexterity save apply and show as they do in the Dice panel.
- **A request whose test has no row**, such as Intimidation with Strength, is answered from its card, as today.

## 7. The roll itself

The block rolls through the Dice panel's path, `useRollOption().d20` (`useRollOption.ts:66-131`), with the creature, the test, the bonus, `presetFor`'s preset and `presetOf`, the label from `testLabel`, the row key, whether a player plays it and the Ask switch, and the token where the creature has one. So:

- **An open request** this creature has not answered takes the roll as its answer, `roll.dice` with its `rollId`, for the player and for the DM with `unanswered` (`routeOf`, `options.ts:180`).
- **The DM's roll for a played creature** asks its player while Ask is on (4.4).
- **Initiative** writes the tracker through `useWatchInitiative` (4.3).
- **Visibility** is the route's default: a player's roll public, a DM's monster roll secret, as Secret starts for it (`secretStartIn`, `useDicePanel.ts:267`). Roll secretly picks Secret for that roll on a free roll where the tap would be public. Where the tap is secret already, the options offer no Secret (5.2).
- **Row keys** are the Dice panel's, `${creatureKey}|${JSON.stringify(test)}` and `${creatureKey}|initiative` (`RollOptions.tsx:834`, `:903`), so a roll is one roll wherever it shows and is busy in both places (D-261031-114). `JSON.stringify` keeps property order, so the tests are built in the panel's exact shapes: `{ kind: "save", ability }`, `{ kind: "check", ability }` and `{ kind: "check", ability, skill }`, in that order (`RollOptions.tsx:559`, `:567`, `:591`). `blockRolls.ts` builds them in one place, and `blockRolls.test.ts` checks each key against the literal string the panel makes.
- **The Dice panel's newest roll** becomes this roll, with its Again, as for any roll through this path (`useDicePanel.ts:234`, `noted` for an answer).

**What the block must not or cannot do** (D-261031-113, D-261031-115):

- **The Dice panel's pressed Adv, Dis and Secret**: never taken, never read. A toggle pressed in a panel the player cannot see would otherwise change, or be used up by, a roll from the block. Lane A adds `choices: "none"` to the panel's `roll` and to `d20`: no `take`, no `peek`, no manual source, ordinary visibility the route's baseline. The answer route sends no panel source either.
- **The panel's newest line on a failure**: with `choices: "none"`, a roll that does not go (a split the formula refuses, no connection) leaves the Dice panel's newest line as it was, where today `createDicePanel.roll` puts its error there (`fail`, `useDicePanel.ts:188`, `:219`, `:231`). The words go back to the caller through `onFail(words)` instead, and `d20` passes them on, for the answer route's unsent `roll.dice` too (`useRollOption.ts:123-126`). A roll that goes still becomes the panel's newest (D-261031-164).
- **The dice tray**: block rolls throw no 3D dice. `useRollOption()` is called without `"dice"`, as the tracker's Roll is, so no throw origin goes.
- **Group rolls**: one creature only. Several selected, group saves and shared attacks stay in the Dice panel.
- **A typed bonus**: a block always has numbers here (section 2), so no "Roll d20" with a typed bonus.
- **Again and Recent rolls** stay in the Dice panel. The block offers neither.

## 8. The result

- **Where**: a result line directly under the ability grid, inside the block, the grid's width, `space(2)` above (D-261031-116). It appears on the block's first roll on this device and holds the newest roll from this grid. Each new roll from it replaces it. It goes when the block unmounts: a fold, a closed panel, another creature. Recent rolls, the Log and the Dice panel's newest roll keep every roll. No timer. A tap that sends no roll leaves the line as it stood: an ask, whose request sheet opens over it, and "Initiative score", whose tracker row shows the score (D-261031-137).
- **Look**: a raised rounded row as the mockup drew it (`surfaceRaised`, `radius.md`, side padding `space(3)`, at least 44 px tall), holding the sticky line's body: the total in heading type, then `ResultRest`'s label with its FL-12 frame, the dice chips and the verdict, dropping whole parts where short (`Roller.tsx:253`). No Again, no tap through to Recent rolls, no tray, and no pop as it changes, as the Dice panel's newest-roll line has none (the mockup scaled it in).
- **Mode words** (D-261031-132, D-261031-134): a roll sent from its options names on the line the mode the server rolled, from the returned roll and never the item picked: "with Advantage", "with Disadvantage", or "Advantage and Disadvantage cancelled" where a condition cancelled the pick. Roll secretly adds "secret". They follow the label as one part, and `ResultRest` drops that part whole before any other where the line is short, so they cost no extra line. An ordinary tap's line names no mode, even where a condition set one, as the Dice panel's line names none. No "Normal" is ever added.
- **States**: while it waits, the shared `Loading` with its delay, "Rolling…", so a quick answer never flashes. Refused: the refusal's words as an alert. A roll that did not go: the words `onFail` gave (section 7), such as "Rolling needs a connection.", as an alert. Any other null from `d20`, a creature gone, a route turned to an ask, a bonus missing, leaves the line as it stood, since the list closes or revalidates then (5.4). Unknown: "This may have happened. Check the log." Committed with no line left: "Rolled. Its result is no longer in the log." Initiative written too late: a second muted line, "Not set: the row changed meanwhile." (`useInitiativeChanged`).
- **Words for a reader**: the line's description names the effective mode and Secret from the returned envelope (`effectiveRollMode`), on every roll. Its live region says the result once, `spokenResult` with the returned mode and Secret (`Roller.tsx:104`), under the next rule.
- **One announcer per roll** (D-261031-133). A block roll is also the Dice panel's newest roll, and with both mounted the panel's sticky line has its own polite region and its own alert for a refusal (`Roller.tsx:143`, `:158`, `:203`). Both lines show the result. Only one says it. `ReceiptTracker` (`client/features/dice/useReceipt.ts`) gains a claim per tag, `claimVoice(tag)`, which returns its release, and `spoken(tag)`. The surface that sent the roll claims its tag while it is mounted, so the block is its roll's voice. A surface puts a result or a refusal in its live region, or gives its refusal `role="alert"`, only while it holds the tag's claim, or while nobody claims it and nobody has said it yet. It then marks it said. The other shows the same words with no live role. The sticky line claims nothing, so it speaks a block roll only when the block let go before anyone spoke it: the block folded before the roll landed, with Dice open. With neither showing it, the own-roll toast says it, as today (`useRollToasts.ts:118-123`, `useReceipt.ts:237`).
- **Toasts**: the line watches its tag through `useReceipt`, so its own result never toasts. A roll whose block closed before it landed toasts once, unless the Dice panel's line shows it. Other viewers get their usual line, toast and Log entry, and only what their projection holds, so a secret roll reaches other players as "rolled in secret".

**Edge cases**

| Case | Expected |
| --- | --- |
| The same character's block in two panels, its token's and its page | Each has its own list and result line. A roll from one is busy in both, since the row is one |
| The token leaves the scene, is deleted, or stops being the viewer's while the list is open | `blockRoller` turns null, the list closes, the boxes go back to text, nothing is sent |
| A shape taken or ended while the list is open | The block under the section changes, so the list closes with it |
| A request for this save lands while its options are open | The options go back to the list, and Save reads "Asked" |
| A request answered on another device while a row reads "Asked" | The tag goes, and a tap then rolls a free roll |
| A level change or a condition while the list is open | Bonuses and tags change in place |
| Stunned, Dexterity save | Tagged "Fails". The roll still goes, and the server records Fail with its total, as from the Dice panel |
| Two quick taps on a box | Opens, then closes. Nothing rolls |
| The connection drops between opening and a tap | The rows turn disabled with the reason. A tap that got in first sends nothing, the result line says `onFail`'s "Rolling needs a connection.", and the Dice panel's newest line stays as it was |
| The block and the Dice panel both show a roll | Both lines show it, the block's says it once, the panel's stays silent, refusal included |
| A reload while a roll waits | The line goes with the page. Recent rolls and the Log hold the roll |
| A player's secret roll | Their line shows the result. Other players read "rolled in secret", and the DM reads the dice |
| The DM viewing a scene the players are not on | Its tokens' blocks roll, as the Dice panel's options do for a token selected there |
| A token a player owns whose character they do not own | No block shows for them (`statBlockShown`), so nothing changes |

## 9. Layout and measuring

- **No geometry changes when closed**: a rolling box is drawn with a text box's style and words, and the corner mark takes no room, so a rolling grid's boxes, rows and columns equal a text grid's at every size and scale. Lane C measures the two grids of one block against each other. The result line is the only added row, and only after a roll. The list is out of flow.
- **The list on a phone**: Wisdom's and Intelligence's seven 44 px rows come to over 300 px before the title. At 320 x 568 at 130% and in landscape the list may not fit above or below. It then shifts and scrolls inside its box, as Popover does, title included. FL-17 draws popovers above a sheet's scroller, so it is never clipped. Its box carries `data-roll-mode-menu`, the sheet swipe's owned boundary (`client/lib/sheetSwipe.ts:638`), so a drag in it never moves the sheet.
- **Widths**: the menu measures its rows at their own widths (`Menu.tsx` `ROWS_WIDTH`). "Sleight of Hand" with a "Dis +1d4" tag and "+12" should fit the about 246 layout px a 320 px phone gives at 130%, which lane C measures. A row that does not fit wraps its tag under its name.
- **Sizes**: 1440 x 900, 390 x 844 and 320 x 568 at 100% and 130%, the six. The tablet, 820 x 1180, at both. The landscape checks, 844 x 390 and 480 x 320 at 130% only (D-261031-054).
- **Strict helpers**: `measureAlignment` and `measureSpacing` reject a root that matches nothing, and every root here is required, with counts. Roots: a rolling grid closed, the open list, the open options, and the result line with a landed roll, on the PC sheet in the token panel and on the character page, a monster's block for the DM, a companion's block, and Wild Shape's creature block. `saveOutlineLines`, read in both forms (3.1), on every rolling grid. `proficiencyHeightLines` on the open list's marked rows. `menuWordLines` and `popoverScrollbarLines` on both views. Bounding-box checks: the corner mark inside its box's first line and clear of the abbreviation, the box's focus ring and FL-17's ring unclipped by any ancestor.

## 10. Parts and contracts

Lane A freezes these before lanes B and C build on them.

- **`useDicePanel.ts`**: `roll(rolls, { choices: "none", onFail })`, no `take` or `peek`, manual sources empty, ordinary visibility the baseline, the sticky line set as for a panel roll when it goes. A roll that does not go leaves the sticky line alone and calls `onFail(words)` (section 7).
- **`useRollOption.ts`**: `d20({ ..., choices: "none", onFail })`, passing both to the panel roll, sending no panel source on an answer, and calling `onFail` for an answer that did not go. It still returns the tag, `"asked"` or null.
- **`useReceipt.ts`**: `ReceiptTracker.claimVoice(tag)`, returning its release, and `spoken(tag)`, the one-announcer rule of section 8.
- **`rollMode.ts`**: `RollModeCapability.secretByDefault`, read by `rollModeItems` and `rollModeHint` to leave Secret out (5.2).
- **`useRollModeMenu.tsx`**: the press wiring (window listeners, pointer, touch, context menu and key handlers, the consumed touch, the inset ring) factored into `useRollPressBinding`. The machines and their window listeners live in a registry its owner holds, apart from the per-element handlers, so an owner can keep a machine past its control's unmount. `useRollModeMenu` holds one machine for its button as today. `useAbilityMenu` holds the box's and one per row (5.1). Behavior unchanged for roll buttons, held by their existing tests and `rollmodes.e2e.ts`.
- **`RollModeMenu.tsx`**: `RollModeMenuBody`, FL-17's title and choices without the Popover, so a popover that already exists can show them.
- **`Menu.tsx`**: an item may carry `content` (drawn in place of `title`, which still names it for typeahead), `style` and `data` (its mark), `label` (its accessible name) and `events` (the press binding's handlers, never an `onClick`, 4.7). Nothing changes for an item without them.
- **`Popover.tsx`**: optional `stepBack(): boolean`, asked by its Escape and Back handlers before they close it. True keeps it open, and a Back it kept open renews the popover's `useBackClose` key (5.3).
- **`blockRolls.ts`** (new, pure): `blockRoller` (section 2), the three test builders of section 7, and `abilityRows(ability, input)` returning each row's test, words, bonus, tags, level, route kind, options capability with `secretByDefault`, row key, source and name, the score rows included. No React.
- **`useAbilityMenu.tsx`** (new): the box's binding and the popover with its two views, the row machines' map (5.1), the swap and its focus, `stepBack`, the pick and the roll. Returns `{ buttonProps, menu, open }`, and calls `onSent(tag)` or `onUnsent(words)` after each tap or pick, which the grid keeps as its newest result.
- **`AbilityMenu.tsx`** (new): the list's render: the title, the rows, the blocked line and the loading line.
- **`BlockResult.tsx`** (new, lane B): the result line, its mode words and its claim on the tag's voice. `Roller.tsx` exports the sticky line's committed body, total and `ResultRest`, for it to share, and `LastResult` speaks and alerts only under the one-announcer rule.
- **`AbilityGrid.tsx`** takes an optional `roll` prop, `{ creature, tokenId?, name, played }` from `blockRoller`. Without it, it draws today's `<dl>`. With it, it draws the rolling grid of 3.1, keeps the newest result of its six boxes, and draws `BlockResult` right after the grid. `StatBlockView` and `PcStatsView` pass it through. `StatBlockSection`, `PcStatBlock` (its view and `ShapeBody`, from the `from` its mount passes) and `CharacterCard` compute it.
- **Comments**: `StatBlockView`'s "Nothing in it rolls", `PcStatsView`'s "Nothing in it rolls: rolls are made in the Dice panel." and `RollOptions`' "The stat block views stay text." (`RollOptions.tsx:115`) change to name the boxes.

## 11. Tests

Fail-first: every new case below fails before its code lands. Cases that hold today's behavior are regression checks and say so. Each new rule is mutation-checked: its fix removed, its test fails.

**Unit**

- `blockRolls.test.ts`: `blockRoller` over section 2's table, every mount and viewer, a DM's character page with and without a token in view, a lent token, hidden numbers. `abilityRows` for each ability: the order, every skill under its ability, Constitution's two, Initiative last under Dexterity, the score pair in a score room, words and bonuses from `bonusFor` and `initBonus`, Jack of All Trades on a skill and not a check, tags for an answer, an ask, Restrained, Bless, Stunned and a set row, levels from `creatureProficiency` with expertise, Wild Shape's numbers and marks with and without a block, Polymorph.
- `useDicePanel.test.ts` and `flow.test.ts`: `choices: "none"` with Adv, Dis and Secret pressed sends none of them, leaves the store and its version unchanged, uses the baseline (a DM's monster secret, a player's roll public), sets the sticky line on a roll that goes, and restores nothing on a refusal. A roll that does not go leaves the sticky line as it was and calls `onFail` once with its words. Adv, Dis and Secret overrides on top.
- `useRollOption.test.ts`: an answer with `choices: "none"` sends only the preset's sources and the override's, and an unsent answer calls `onFail`.
- `rollMode.test.ts`: `secretByDefault` leaves Secret out of `rollModeItems` and out of `rollModeHint`'s words, and leaves every other capability's items as FL-17 has them.
- `receiptVoice.test.ts` (new): `claimVoice` and its release, `spoken`. With two surfaces, the claimant alone speaks a success and alerts a refusal. A claim released before the result lands lets an unclaimed surface speak it once. A result already said is never said again by a surface mounted later.
- `Menu.test.ts` (new): `content`, `style`, `data`, `label` and `events` render on the item, typeahead reads `title`, a disabled item picks nothing, an item's `events` hold no `onClick`, a used ContextMenu key never reaches Menu's own handling, items without them render as today.
- `popover.test.ts`: `stepBack` true keeps it open on Escape and Back, false or absent closes as today. A Back kept open renews the `useBackClose` key.
- `backClose.test.ts`: a `BackCloser` over a fake history that pushes, steps back and fires its popstate in order, as its tests already build one, with Popover's keyed registration. Alone: options, Back to the list, Back closed, and no entry of ours left behind, so the next Back leaves as it did before the list opened. Above a sheet: options, list, closed, then the third Back closes the sheet and the room is still the page.
- `useRollModeMenu.test.ts` and `rollPress.test.ts` (regression): their cases pass unchanged after the refactor, `rollPress.test.ts:54`'s reader click included.
- `useAbilityMenu.test.ts`: every press of 3.3 opens the list, a press on the open box closes it, a hold's release on the box picks nothing, a row's tap rolls once and closes with focus on the box, a row's hold, right-click and keys swap to its options. A hold on Save released over Roll with Advantage, its row gone, rolls nothing. The held finger's `touchmove` after the swap is prevented until its end, and a new touch scrolls the options normally. A `detail` 0 click on an enabled choice after a hold picks it once. A key swap focuses the first choice, a pointer swap the box. A pick rolls once with its override. Escape and Back step back with the row focused, the second closes. A source change sends the options back. Blocked and loading rows, a busy row that cannot send, and an `onFail` that puts its words in the result.
- `abilityMenu.random.test.ts`: random fake-clock sequences of box and row presses, holds, moves, scrolls, cancels, keys, reader clicks, picks, Escape, Back, source changes and unmounts. At most one view open, at most one roll per activation, no roll from a hold's own click whether or not its row is still drawn, exactly one action for a reader click on an enabled choice, no roll on a step back, a held finger's `touchmove` prevented until its end and never after, nothing after unmount, no timer, machine or listener left after a terminal event.
- `proficiency.test.ts`: a rolling grid is a `role="group"` of six buttons, each with its three data-marked lines, `data-save-proficient` where proficient, its `aria-label` and description, and the corner mark. A text grid renders as today, byte for byte.
- `BlockResult.test.ts`: each state's words, the mode words only for a roll from its options and from the returned roll, dropped first where short, the claim on its tag, no Again.
- `Roller.test.ts`: `LastResult` stays silent and alerts nothing for a tag another surface claims, and speaks one released before anyone said it.

**e2e** (new `e2e/blockrolls.e2e.ts`, labels `sbr-`, its port offset reserved through coordination)

| Case | Expected |
| --- | --- |
| sbr-1. Player taps DEX on Thorn's sheet, then Stealth | List in 4.1's order, one `dice.roll`, the result line, the Dice panel's newest roll |
| sbr-2. Adv pressed in the Dice panel, then a block roll | The block roll has no Advantage, Adv stays pressed, its version unchanged |
| sbr-3. Hold Save 499 ms and 500 ms, release over Roll with Advantage, and drag the held finger after the swap | A tap rolls at 499, options open at 500, the release rolls nothing, the drag scrolls neither the options nor the sheet |
| sbr-4. Options: Advantage, then Escape, Escape | Adv, Dis and Secret, no Normal, one roll with Advantage. Escape goes back to the list on Save, the second closes it on the box |
| sbr-4b. Android Back, through the page's real history, at 390 x 844 | Options, Back to the list, Back closed, then Back closes the token sheet and the room stays. Opened with no sheet under it, two Backs leave no entry of ours behind |
| sbr-5. Right-click and Shift+F10 on the box and on a row | List, then options, no browser menu |
| sbr-6. A DM's request for a Dex save | Save tagged Asked, its tap answers it, Secret disabled in its options |
| sbr-7. DM on Thorn with Ask on, then off | Save asks Thorn, no options. Off, it rolls. Initiative always rolls |
| sbr-8. Initiative in a fight, a changed row, a score room | The row set once, "Not set" after a change, the score set with no dice |
| sbr-9. Wild Shape wolf and Polymorph | The box prints the wolf's save, the list rolls the shaped one. Polymorph the wolf's own |
| sbr-10. Monsters panel, companion blocks list, DM's page off scene | Text: no button, no mark |
| sbr-11. Offline and a preview | The list opens, rows disabled with the reason, nothing sent |
| sbr-12. Fold the block before a roll lands | One own-roll toast. Kept open: no toast |
| sbr-13. Restrained Dex save, options Advantage | Tagged Dis, rolled Normal, cancelled, its description says so |
| sbr-14. A double tap on a waiting row, and the Dice panel's same save | One roll, both busy |
| sbr-15. A hold on Save, then a reader's click (detail 0) on Roll with Advantage, and both context keys | The hold's own click rolls nothing. The reader's click rolls once with Advantage. The keys open the same views as sbr-5 |
| sbr-16. The Dice panel open beside the block, a roll, a refused roll, and the block folded before a roll lands | Both lines show each. One polite announcement for the success, one alert for the refusal. Folded: the Dice panel's line says it once, and with Dice closed the toast does |
| sbr-17. The DM's options on a monster's row, and on Thorn's companion's | Monster: Advantage and Disadvantage only. Companion: Secret too |
| sbr-18. Roll with Advantage from the options, then a plain tap while Restrained | "with Advantage" on the line where it fits, gone at 320 x 568 at 130% and kept in the description. The plain tap's line names no mode |

Extend `pcstats.e2e.ts`, `tokenpanel.e2e.ts`, `characters.e2e.ts` and `companions.e2e.ts` where their grids now roll, their `dt` selectors on a grid (`pcstats.e2e.ts:363`, `tokenpanel.e2e.ts:559`, and `saveOutlines` at `alignmentRoom.ts:3865`) reading either form, and `rollmodes.e2e.ts` for the refactored binding. `e2e/helpers/alignment.ts` reads both forms in `saveOutlineLines` (3.1). The alignment roots of section 9 join FL-7's sweep in `e2e/alignmentRoom.ts` (`proficiencyTests`, run by `proficiency.e2e.ts`) at its sizes and the tablet, with the landscape pair. Screenshots go to two places, each name unique and nothing earlier overwritten (D-261031-165): every shot the lane checks take goes to the coordinator's `tmp/shots/sbr/` folder, and only the visual-pass shots meant for the project owner go to the project owner's screenshot folder (`stat-block-rolls/`). VoiceOver and TalkBack on a device are a manual check, reported as run or not.

## 12. Build plan

Lanes in isolated workspaces on FL-17's merged tip. A file and its unit tests have one owner. A lane that needs a contract change sends it to lane A. No lane touches `shared/` or `server/`.

| Lane | Owns |
| --- | --- |
| A: contract and the list | `client/features/dice/useDicePanel.ts`, `useRollOption.ts`, `useReceipt.ts`, `rollMode.ts`, `useRollModeMenu.tsx`, `RollModeMenu.tsx`, new `blockRolls.ts`, `useAbilityMenu.tsx`, `AbilityMenu.tsx`, `client/components/Menu.tsx`, `Popover.tsx`, and their tests, with `client/lib/backClose.test.ts`'s new cases and new `receiptVoice.test.ts`. Its first commit freezes the types of section 10 with stubs, so B and C start at once |
| B: the grid, mounts and result | `client/features/monsters/AbilityGrid.tsx`, `StatBlockView.tsx`, `proficiency.test.ts`, `client/features/pcstats/PcStatsView.tsx`, `PcStatBlock.tsx`, `client/features/tokens/StatBlockSection.tsx`, `CharacterCard.tsx`, `client/features/dice/Roller.tsx` (its export and `LastResult`'s one-announcer rule), `RollOptions.tsx` (its doc comment only), new `BlockResult.tsx` and their tests |
| C: e2e, sheet and docs | `e2e/blockrolls.e2e.ts`, `e2e/alignmentRoom.ts`, `e2e/helpers/alignment.ts`, the touched e2e files of section 11, `client/state/shortcuts.ts` and its tests, `FEATURES.md`, `docs/dm-guide.md` and its images, the superseded lines of section 13, this doc's As built. It writes e2e against this doc while A and B build, then integrates their exact committed tips and runs the combined checks |

Commits, in order:

1. `feat(dice): roll for one creature without the dice panel's choices` (A)
2. `feat(ui): menu rows with their own content and presses, and a popover step back` (A)
3. `feat(dice): an ability's rolls with one-roll options` (A)
4. `feat(ui): ability boxes that open their rolls` (B)
5. `test(e2e): stat block rolls` (C)
6. `feat(ui): stat block rolls in the shortcut sheet` (C: the registry, its tests and FEATURES.md's Shortcuts tables, which `shortcuts.test.ts` holds together)
7. `docs: stat block rolls in the features, guide and designs` (C)

**Checks**, independent ones in parallel: `pnpm typecheck`, `pnpm test` and `pnpm build` on every lane. Lane A, which owns the shared refactor, also runs `rollmodes`, `dice`, `rolls`, `savespell`, `dicefolds`, `groupsave`, `combatuses`, `paneltabs`, `tools`, `keyboard` and `swipe`, since the menu, popover, press binding, panel roll and receipts are shared. Lane B runs `pcstats`, `tokenpanel`, `characters`, `companions` and `proficiency`. Lane C runs, on the integrated tip, `blockrolls`, every file of lanes A and B, `savespell`, `dicefolds`, `groupsave` and `combatuses` among them, then `combat`, `shortcuts`, `alignment`, `alignment-wide`, `alignment-icons`, `alignment-followups` and `reach`, through the coordinator's lane check with a database and port reserved for it. No server or shared code changes, so `test:int` is not part of it. Lane check shots go to the coordinator's `tmp/shots/sbr/` folder. Per-surface screenshots of the new look for the project owner (the PC sheet, a monster, a companion, Wild Shape, both views open, the result line) go to the project owner's screenshot folder (`stat-block-rolls/`), each name unique and none overwritten, before it ships, as the visual design pass asks (D-261031-165).

## 13. Docs and the shortcut sheet

**Shortcut sheet** (`client/state/shortcuts.ts`, with FEATURES.md's tables in the same commit). Mouse and touch, room-wide, `device: "pointer"`: "Tap, click, hold or right-click an ability box in a stat block": "Open its rolls: the check, the save, its skills, and Initiative under Dexterity. Tap one to roll it", and "Hold or right-click a roll in an ability's rolls": "Show its one-roll options in their place, without rolling". Keys, under "Token and character fields": "Enter, Space, Down, ContextMenu, Shift+F10" on a focused ability box: "Open its rolls, the first one focused", and "Up" there: "Open its rolls, the last one focused". "ContextMenu, Shift+F10" on a roll in an ability's rolls: "Show its one-roll options, the first choice focused. Enter and Space still roll as before". "Escape" there: "From a roll's options, go back to the ability's rolls. From the rolls, close them back on the box". "Up, Down, Home, End" there: "Move through the rolls or the choices". No new surface (D-261031-125).

**FEATURES.md**: "## Characters and monsters" gains the boxes: where they roll, the list, the options in it, the result line, Wild Shape's numbers, and that the Skills line, Initiative line and weapons stay text. Its proficiency bullet (FEATURES.md:437) says the list's rows carry the roll border, while the boxes keep the save outline and the block's text stays unmarked. "## Dice" says a block roll is the newest roll, takes no Next roll choice and throws no dice. The DM guide: a short guide passage under "Dice", "Roll options", beside the stat block passages in "Monsters" and "Stat blocks", in its own voice, each control beside its key, with one new phone picture of an open list.

Draft FEATURES.md bullet, for "## Characters and monsters":

> - **Roll from a stat block**: where you may roll for its creature, tap one of a stat block's six ability boxes for its rolls: the check, the save, each of its skills, and Initiative under Dexterity, each with the bonus it rolls, a proficient one bordered as in the Dice panel. Tap one to roll it. Hold one, right-click it, or press ContextMenu or Shift+F10 on it for Roll with Advantage, Roll with Disadvantage or Roll secretly, and Escape or Back goes back to the list. A DM's roll for a monster is secret already, so its choices are Advantage and Disadvantage only. A small mark in a box's corner shows it opens. The result shows under the boxes, with "with Advantage", "with Disadvantage" or "secret" where a choice added one and the line has room. A roll answers a request that asks for it, writes Initiative into the tracker, and for the DM asks a player's creature while its Ask switch is on. It uses none of the Dice panel's Next roll choices and throws no dice. In Wild Shape the boxes show the creature's block and roll the numbers under "Rolls now". The Skills line, the Initiative line and weapons stay text, and so does a block with no creature behind it, as in the Monsters panel.

Draft DM guide passage, for "Roll options":

> **Rolling from a stat block.** For a quick save or check you don't need the Dice panel. In a creature's stat block, tap one of the six ability boxes, the ones with a small mark in the corner. A short list opens with that ability's check, its save and its skills, and under Dexterity, Initiative. Tap one to roll it, and the result shows under the boxes. For Advantage, Disadvantage or a secret roll, hold the roll for half a second or right-click it, or press **Shift+F10** on it, then pick. A monster's rolls are already hidden from players, so for a monster you'll only see Advantage and Disadvantage there. **Escape**, or Back on Android, takes you back to the list. For a creature a player plays, a save or check asks that player while its Ask switch in the Dice panel is on. Boxes in the Monsters panel stay plain, since no creature stands behind them.

**Superseded text**, replaced in commit 7:

- `docs/design-v1-pc-stats.md` 16.3: "**No tap to roll in the stat block this wave** (decided the same way): the Dice panel stays the one place to roll, and the view stays text." Becomes: "**No tap to roll in the stat block that wave** (decided the same way). Since docs/design-v1-stat-block-rolls.md the six ability boxes open their rolls where the viewer may roll for the creature (D-261031-100). The rest of the view stays text, and every other roll is made in the Dice panel."
- The same doc, near line 169: "**The stat block view stays text this wave** (decided for the project owner, section 16): every roll is made in the Dice panel, where Advantage and secret stand." Becomes: "**The stat block view's ability boxes roll** (docs/design-v1-stat-block-rolls.md): a check, a save, a skill or Initiative, through the Dice panel's path. The rest stays text, and every other roll is made in the Dice panel."
- Near line 252: "The view is React text, never Markdown, so a later tap to roll can turn its numbers into buttons." Becomes: "The view is React text, never Markdown. Its ability boxes open their rolls (docs/design-v1-stat-block-rolls.md), and the rest stays text."
- Near line 275: "It puts no tap to roll on doc 2's view, which stays text (section 16)." Becomes: "It puts no tap to roll on doc 2's view. docs/design-v1-stat-block-rolls.md later makes the view's ability boxes roll through this doc's options."
- `docs/design-v1-roll-options.md` 16.3: "**Tap to roll in the stat block**: not this wave. The Dice panel stays the one place to roll, and its options show the Multiattack line (4.2)." Becomes: "**Tap to roll in the stat block**: not that wave. Since docs/design-v1-stat-block-rolls.md the ability boxes roll a creature's checks, saves, skills and Initiative through these options' path. Everything else rolls here, and the options show the Multiattack line (4.2)."
- The same doc, 4.2: "The stat block views stay text this wave (the project owner's decision, 16)." Becomes: "The stat block views stayed text that wave (16), until their ability boxes opened their rolls (docs/design-v1-stat-block-rolls.md)."
- `docs/design-v1-roll-mode-menu.md` near line 51: "The stat block views (`features/pcstats/PcStatsView.tsx:50`, `features/pcstats/PcStatBlock.tsx:176`, `features/tokens/StatBlockSection.tsx`) remain text." Becomes: "A stat block's ability box opens a list of its rolls (docs/design-v1-stat-block-rolls.md), and each roll in that list has this menu. The box itself is an opener and has none."
- `docs/design-v1-dm-tools.md` 3.6: "The block is read only on the token, and nothing in it rolls." Becomes: "The block is read only on the token. Its six ability boxes open their rolls (docs/design-v1-stat-block-rolls.md), and nothing else in it rolls."

## 14. Decided, for the project owner to overrule

Each follows the project owner's three requests, the mockup's option C and D-261031-076 to 079 and 100, with its rejected options.

1. **D-261031-101 (changed in round 1 by D-261031-136): FL-15's look kept exactly, the box itself pressable.** Its padding, radius, fill, outline, words and height (about 56 px, not the mockup's 64 px) stay, so the grid never grows. Rejected: a separate Roll control, the mockup's option B. Rejected: the mockup's 64 px boxes, which would grow the grid on every block.
2. **D-261031-102: the mockup's 10 px corner mark, 6 px from the corner as the mockup set it, and a pointer cursor, no hover look.** Rejected: the mockup's hover outline, since the app's buttons have none and nothing may need hover. Rejected: a raised border like the Dice panel's cells, which would change FL-15's look. Rejected: no sign at all, since nothing would say the box opens.
3. **D-261031-103 (changed in round 1 by D-261031-136): the box's `aria-label` is its printed words, heard once as one control.** Rejected: a short name such as "Strength rolls" with the numbers as its description, which a reader with hints off would never hear. Rejected: a name and the same words read beside it, which says every number twice.
4. **D-261031-104: every press on the box opens the same list.** Rejected: a hold opening the check's options, a hidden shortcut to one of seven rolls that would make a hold mean two things. Rejected: a hold doing nothing, which on iOS selects words or lets the lifting click toggle the list.
5. **D-261031-105: Check, Save, every skill of the ability in order, then Initiative under Dexterity.** Rejected: only the skills the block lists, which leaves the rest with no home. Rejected: Initiative first, which would put a fight's roll ahead of Dexterity's own check and save, where the mockup put it last.
6. **D-261031-106: a marked row draws FL-12's box form on its own border.** Rejected: the mockup's bold bonus, which FL-15 dropped. Rejected: a frame around the name alone, since a row here is a roll control, as the Dice panel's cells are.
7. **D-261031-107: a row's name for a reader is the whole roll with its route and preset, its accessible description the shortcut words.** Rejected: "Save +6" alone, which leaves out the ability and what the tap does.
8. **D-261031-108: the Dice panel's tags on the rows.** Rejected: no tags, which leaves an answer, an ask or a condition unsaid before the tap.
9. **D-261031-109: "Initiative score" then "Roll initiative" in a score room.** Rejected: the Dice panel's "Score 12" and "Roll instead", which lose the word Initiative outside its own card. Rejected: the roll alone, which drops the room's way of setting a monster's place.
10. **D-261031-110 (its foot line dropped by D-261031-130): the ability's name as the title in FL-17's look.** Rejected: the mockup's small title, which would differ from FL-17's title row on every other roll menu.
11. **D-261031-111: a hold swaps the same popover to the roll's options, and Escape or Back steps back.** Rejected: a second popover over the first, two stacked menus on a phone. Rejected: Escape closing both, the mockup's, which loses the list. Rejected: a Back row, a control added to every options view.
12. **D-261031-112 (changed in round 1 by D-261031-131): Advantage, Disadvantage and Secret, no Normal, and no Secret where the tap is secret already.** No Normal, since the block reads no toggle and a tap already rolls normally (D-261031-078). On a DM's row for a creature no player plays, Advantage and Disadvantage only. Rejected: keeping Secret there to match the Dice panel's menu, a duplicate input. Rejected: a "Roll in the open" choice, a fifth choice outside the approved four (D-261030-452).
13. **D-261031-113: the block takes, reads and changes no Dice panel toggle.** Rejected: taking them, which would use up a choice set for the panel's next roll. Rejected: reading them without taking, which lets a toggle out of sight change a block roll.
14. **D-261031-114: the Dice panel's row keys, and the roll becomes the panel's newest.** Rejected: rows of its own, which let the same save go twice from two places while one waits. Rejected: leaving the panel's newest roll alone, which would show an older roll as the newest.
15. **D-261031-115: no dice tray from the block.** Rejected: throwing dice there, since the tray belongs to the Dice panel and would cover the block.
16. **D-261031-116: the result line under the grid, until the next roll or the block closes, with no Again.** Rejected: the mockup's place at the block's top, which moves the grid under the finger. Rejected: a toast alone, since the project owner wants rolls in the block. Rejected: Again in the block, a control the Dice panel already has. Rejected: the mockup's pop as a result lands, motion the Dice panel's newest-roll line does not have.
17. **D-261031-117: boxes roll for the creatures the Dice panel offers this viewer.** Rejected: player characters only, since one grid serves every block and a DM rolling a monster's save is the same need (D-261031-100). Rejected: a DM rolling for a character with no token in view, which the Dice panel never offers and whose ask needs a token.
18. **D-261031-118: in Wild Shape the boxes print the creature, the list rolls "Rolls now".** Rejected: redrawing the grid with the shaped numbers, which undoes D-261030-591. Rejected: rolling the printed numbers, the wrong bonus.
19. **D-261031-119: Constitution opens a two-row list.** Rejected: rolling its save at once, which makes one box act unlike the other five and lets a stray tap roll.
20. **D-261031-120: the DM's ask follows the Dice panel's switch for the creature.** Rejected: a switch in the list, more text and a control. Rejected: always rolling, which takes a player's own roll from them.
21. **D-261031-121: blocked rows say why under the title, and the box still opens.** Rejected: boxes going back to text while offline, a look that flickers with the connection.
22. **D-261031-122: the shared Loading line while the SRD rolls load, and SrdLoadFailed's words if they fail.** Rejected: rows with no bonus meanwhile, which could roll a guessed number.
23. **D-261031-123: the shared Menu with item content and presses.** Rejected: a list of its own, which would repeat the keys, typeahead, focus and FL-17's clipping fix.
24. **D-261031-124: Popover asks before Escape or Back closes.** Rejected: a capture listener of the list's own, which races Popover's for the same key.
25. **D-261031-125: the sheet's rows under "Token and character fields" and room-wide Mouse and touch.** Rejected: a new "Stat blocks" surface, a registry change for four rows.
26. **D-261031-126: a waiting row is busy in the block and the Dice panel alike.** Rejected: letting the block send again, a second roll the player did not mean.
27. **D-261031-127: the list updates in place, a roll's options go back on a change, the list closes when the creature or the box goes.** Rejected: closing the list on any change, which would shut it each time a condition ticks.
28. **D-261031-128: the result line holds the newest roll from this grid on this device, never another surface's.** Rejected: showing the Dice panel's newest roll, which may be another creature's.
29. **D-261031-129 (changed in round 1 by D-261031-132): the line's description and announcement carry the mode and Secret on every roll, and the line never adds "Normal".** The line names a mode its options added only where that costs no extra line (D-261031-134). Rejected: a plain "Normal" on the line, a word that says nothing happened.

From the review, decided by the coordinator:

30. **D-261031-130: the list's foot hint line is dropped**, since the roll menus carry no description text (D-261031-076) and the shortcut needs no teaching line there. The title row stays. Rejected: keeping the one line.
31. **D-261031-131: Advantage and Disadvantage only on a DM's rows for a creature no player plays**, where the tap rolls secret already, through `secretByDefault` in `rollMode.ts`. The Dice panel's own DM-monster duplicate is an FL-17 follow-up. Rejected: keeping Secret to match the Dice panel's menu.
32. **D-261031-132: the result line names an added mode where it costs no extra line**, as the mockup did and D-261030-583 allows. Rejected: dropping the mode words from the line.

From round 1's fixes:

33. **D-261031-133: one announcer per roll tag, the surface that sent it while it is mounted.** Both lines show the result, the sender says it, the other stays silent, refusals included. A sender gone before the result lands lets the Dice panel's line say it, else the toast. Rejected: the Dice panel's line always speaking, which would say a block roll from a panel the reader is not in. Rejected: each surface saying its own, twice for one roll.
34. **D-261031-134: the line's mode words come from the returned roll and only for a roll from its options.** "with Advantage", "with Disadvantage", "Advantage and Disadvantage cancelled", and "secret" for Roll secretly, dropped first where short. Rejected: naming every roll's mode, a condition's included, which the Dice panel's line does not and which would mark every line of a Restrained creature. Rejected: the picked item's words, which would say Advantage for a roll a condition cancelled.
35. **D-261031-135: a row keeps its whole preset tag and an ask's "Asks" tag**, since the list has no group label to lift shared parts into, as the Dice panel's does. Rejected: the panel's lifted tags, which would leave a Blessed creature's rows unmarked with no label to say it.
36. **D-261031-136: while it rolls, the grid is a group of six buttons, each the whole box.** A button laid inside the `<dl>`'s grouping `<div>` breaks its content model. Each box keeps its look, with its three lines as marked spans, and FL-15's checks read either form. A text grid stays a `<dl>`. Rejected: the overlay button beside the `<dt>` and `<dd>`, invalid markup. Rejected: an overlay button inside the last `<dd>`, valid but leaving the list's terms either read twice or emptied by `aria-hidden`.
37. **D-261031-137: a tap that sends no roll leaves the result line as it stood**: an ask, whose request sheet opens, and "Initiative score", which the tracker row shows. Rejected: clearing the line, which loses the last roll for nothing. Rejected: a line for the score, a result line holding what is not a roll.
38. **D-261031-138: `useAbilityMenu` owns every row's press machine, keyed by row, and keeps the held one past its row's unmount** until its own click after the release is spent. Rejected: keeping the held row drawn and hidden until the release, which leaves a hidden control under the finger and in the focus order. Rejected: FL-17's per-control lifetime, under which the release rolls the choice drawn where the row was.
39. **D-261031-139: `blockRoller`'s `from` is the mount's token or character, and a character's token is the first on the viewer's scene**, as `playerCreatures` picks it. Rejected: the selected token, which a page has no part in. Rejected: any token of the character on any scene, which a DM's view does not hold.
40. **D-261031-160: a row's binding gives Menu no `onClick`, and the window capture listener gates Menu's own pick.** Rejected: a row `onClick` beside Menu's, two picks for one click.
41. **D-261031-161: only the hold's own pointer click is swallowed, and a reader's later `detail` 0 click acts once.** Rejected: swallowing every click after a hold, which would break `RollPress.click()`'s reader rule and its test.
42. **D-261031-162: Popover's Back registration takes a key that changes on each step back.** Rejected: a veto alone, which leaves the list with no registration so the next Back closes the sheet or leaves the room. Rejected: a second registration of the list's own, which two Backs could close out of order.
43. **D-261031-163: a key swap focuses the first choice, a pointer swap the box, both before the held row goes.** Rejected: letting Popover's mutation watch place it, which puts focus inside after a pointer, against the pointer rule.
44. **D-261031-164: with `choices: "none"`, a roll that does not go leaves the Dice panel's newest line alone and reports through `onFail`.** Rejected: today's `fail` on the panel's line, which would replace the panel's newest roll with a block's error out of sight. Rejected: reading null from `d20` as a lost connection, since `d20` returns null for a gone creature, a changed route and a missing bonus too.
45. **D-261031-165: lane check shots in the coordinator's `tmp/shots/sbr/`, visual-pass shots for the project owner in the project owner's screenshot folder (`stat-block-rolls/`), unique names, none overwritten.** Rejected: a `screenshots/` folder in the repository, which the project owner's shots do not use.

## As built

To be written by lane C in commit 7.
