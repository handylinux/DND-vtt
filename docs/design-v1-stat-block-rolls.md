# raccoon-vtt v1: rolling from a stat block's ability boxes

Status: draft 1 for design review, 2026-10-31. Code references are from main at `19dc9e7a`. The build starts after FL-17 merges and refreshes these references against that tip, since FL-17 changes `RollModeMenu.tsx`, `useRollModeMenu.tsx`, `rollMode.ts` and `Popover.tsx`. Client only: no server, protocol, projection or stored state changes. No implementation or browser measurements are claimed here.

The project owner asked on 2026-10-31: "So I'm aware the roll panel is independently useful because it allows rolling for multiple tokens at once, but it does feel a bit clunky to have to go to a separate roll panel to do so while in the stat block. Please come up with a design that allows players to do basic character based rolls from the stat block (skills, saves, initiative, etc). We don't need a whole dice selector like we have in the roll tab though. Open to ideas here so please mock a few up for me". Then: "The stat block rolls should also obviously have the long press/right click shortcut". Shown four mockups, they picked: "I like C but we should only implement the rolls in the ability boxes and not mess with the skills row (leave as text) or add weapons".

So this is the mockups' option C, "Tap an ability", limited to the six ability boxes (D-261031-100). A tap on a box opens a short list of that ability's rolls: its check, its save, its skills, and Initiative under Dexterity. A tap on a roll rolls it. Every roll in the list takes the one-roll options' hold, right-click, ContextMenu and Shift+F10 shortcut, and holding one swaps the list for that roll's options (D-261031-077). It builds on FL-17's menu: no description paragraphs (D-261031-076), "Roll normally" only where a tap would not roll normally (D-261031-078), and a title row naming the roll with an accent ring on what was pressed (D-261031-079). Decisions here are D-261031-101 to D-261031-129, listed in section 14.

## What differs from the mockup the project owner saw

These change what the mockup showed. Each is decided in section 14 and open to overrule.

1. **No hover outline on a box.** The app draws no hover looks on its buttons, so a box shows only the mockup's small corner mark and a pointer cursor (D-261031-102).
2. **A proficient roll in the list shows FL-12's border on its row, not a bold bonus.** FL-15 dropped bold as a sign (D-261030-588), and a row in this list is a roll control, so it takes the border the Dice panel's cells take (D-261031-106).
3. **The result shows under the ability grid, not at the top of the block.** A line added above the grid would push the box just tapped down under the finger (D-261031-116).
4. **Escape in a roll's options steps back to the ability's list**, and a second Escape closes it. The mockup closed both at once (D-261031-111).
5. **A hold or right-click on a box opens its list**, as a tap does. The mockup's boxes ignored both (D-261031-104).
6. **Titles and the open box follow FL-17**: the title row's small capitals, and the accent ring outside the box, not the mockup's bold title and light border (D-261031-079).
7. **A room that uses initiative scores** lists "Initiative score" before "Roll initiative" under Dexterity for a monster in the fight. The mockup had no such room (D-261031-109).
8. **A DM's roll for a monster from its block is secret**, as an ordinary Dice panel roll for it starts. The block reads no Dice panel toggle, so rolling one in the open stays in the Dice panel (D-261031-112, D-261031-113).

## 1. Scope

- **In**: the six boxes of the shared ability grid, where the block belongs to a creature the viewer may roll for (section 2). Each opens a list of that ability's check, save and skills, with Initiative under Dexterity. Each roll in it rolls on a tap and has the one-roll options. A result line under the grid.
- **Out**: the Skills line, the Initiative and Passive Perception line, spellcasting, weapons and every named roll, which stay text (D-261031-100). Death saves stay in HP and the Dice panel. No group rolls, no typed bonus, no Ask switch, no Again and no dice tray in the block. No new roll permissions or routes.
- **Fixed**: FL-15's look of a box (D-261030-588) and the grid's size at every width and interface scale. 44 px targets. Nothing that needs hover. Alignment within 1 px under the strict helpers.

## 2. Where the boxes roll

**The rule.** The boxes roll where the block is a creature's that the Dice panel would let this viewer roll for, and stay text everywhere else (D-261031-117). A player: a creature `playerCreatures` lists (`client/features/dice/options.ts:134`), so their own characters wherever their tokens stand, their characters' companions on the players' scene and other creatures they own there. The DM: a creature's token on the scene in view, and a character with a token on that scene. A token on the scene is rolled for as `{ tokenId }`, a character's block as `{ characterId }` with its token on the scene kept for the DM's ask, the forms the Dice panel uses (`RollOptions.tsx:199`, `useOptionsEndOnGroup`). Both resolve to one creature key (`creatureKey`, `options.ts:160`), so a row and a request match either form.

One pure function decides it, `blockRoller(view, you, sceneId, from)` in `client/features/dice/blockRolls.ts`, returning the creature, its token, its name and whether a player plays it, or null. A character whose numbers this viewer does not hold (`readsCharacter`, so `creatureRolls(...).numbers` is null, `client/features/dice/creature.ts:174`) also stays text. A block whose numbers wait on the SRD rolls table still rolls, and its list shows the loading line until they come (4.6).

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

The box keeps FL-15's markup and look exactly: its `<div>` in the `<dl>`, the abbreviation in `<dt>`, the score and save in `<dd>`, its padding, radius and raised fill, and for a proficient save the 1 px outline inside its edge (`AbilityGrid.tsx:18-45`). Where it rolls it gains two things that take no room (D-261031-101, D-261031-102):

- **A button over the whole box**: `position: absolute`, `inset: 0`, no fill, no border, the box's radius, `cursor: pointer`. The box takes `position: relative`. The button holds no content, so no word moves and FL-15's outline and its pixel check are untouched (`e2e/helpers/alignment.ts:590`, `saveOutlineLines`).
- **A corner mark**: the mockup's 10 px down chevron, `aria-hidden`, in the muted text color, placed absolutely 4 px from the box's top and right edges, inside the first line's height and clear of the abbreviation. It is a sibling of the button inside the box, with `pointer-events: none`, so it is content placed beside content in the flow, which the alignment check leaves to its containing block.

A box that stays text draws no button and no mark, so its markup is today's, byte for byte. No hover look, as the app's buttons have none.

### 3.2 Name, focus and size

- **Name**: the button carries the box's printed words, "Strength 16, +3, save +6, proficient", using `spokenProficiency` for the last part. Its description: "Opens the check and the save" for Constitution, "Opens the check, the save and its skills" for Strength, Intelligence, Wisdom and Charisma, and "Opens the check, the save, its skills and Initiative" for Dexterity. It has `aria-haspopup="menu"`, `aria-expanded` and, while open, `aria-controls`. The box's own words take `aria-hidden` while the button stands, so a reader hears the box once, and touch exploration, which lands on the button, hears every number (D-261031-103).
- **Focus**: the global ring (`client/globals.css:113`), 2 px of accent 2 px out, on the button and so around the whole box, hidden after a pointer as elsewhere. Open, FL-17's accent ring stands 2 px outside it (`markRollModeSource`), in both of the menu's views. The grid's 4 px gap leaves each ring clear of its neighbor.
- **Size**: a box is about 56 px tall (116 px for the grid's two rows, `docs/design-v1-dice-ui.md` 6.1), over 44 px. Its width is a third of the block's column less the gaps. Lane C measures both at 320 x 568 at 130%, the narrowest, and the build stops for a design change if a box falls under 44 px wide there.

### 3.3 Presses on the box

The box rolls nothing, so it has no one-roll options. Every way of pressing it opens the same list (D-261031-104). It uses the shared press machine (`client/features/dice/rollPress.ts`) through the binding factored out of `useRollModeMenu` (section 10), so a hold's release, a duplicate native context menu and a cancelled press behave as on roll buttons.

| Press on the box | Does |
| --- | --- |
| Tap, click, Enter or Space | Opens the list. A key opening focuses its first enabled roll, a pointer follows Popover's pointer rule |
| Down or Up | Opens the list on its first or last enabled roll, as any menu button (`Popover.tsx:190`) |
| A still touch of 500 ms | Opens the list. The release picks nothing. The 200 ms inset hint shows first, as on roll buttons |
| Right-click | Opens the list, never the browser's menu. Right-click again closes it |
| ContextMenu or Shift+F10 | Opens the list, first roll focused |
| Any press on the box while its list is open | Closes it, rolling nothing |
| Moving past 8 px, a scroll, a second finger | Cancels a hold, as on roll buttons. Native scrolling and the sheet's swipe keep their touches |

## 4. The ability's list

### 4.1 What it holds

A `Popover kind="menu"`, side "above", flipping below where it does not fit, within the screen (FL-17's placement), anchored to the box. Inside: the title row, the rows, and the hint (D-261031-105, D-261031-110).

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

- **Words**: the roll's name at the start, "Check", "Save", "Stealth", "Initiative", and its bonus at the end in tabular figures, "+6", "−1" (`signedText`). The bonus is the one rolled: `bonusFor(numbers, test)` over `creatureRolls(...).numbers` for saves, checks and skills (`shared/dice/bonus.ts:78`), and `initBonus` for Initiative, as the Dice panel's cells read them (`RollOptions.tsx:553-583`). So Jack of All Trades, Alert, a stat block's adjustments and a monster's printed skills are in it already.
- **Tags**: small muted words after the name, the Dice panel cell's tag rules (`RollOptions.tsx:836-845`, D-261031-108). "Asked" where the tap answers an open request. "Asks" where the DM's tap asks the player (4.4). A preset's tag, "Dis", "Adv", "+1d4", "Fails", from `presetTag` (`options.ts:570`). Initiative's tracker tag, "sets row" or "replaces 17 · −4" (`initiativeTag`, `options.ts:761`). A row whose words and tag do not fit wraps its tag under its name, never its bonus.
- **Marks**: a save or skill the creature is proficient in draws FL-12's box form on the row's own transparent border, heavier for proficient and doubled for expertise (`proficiencyBox` over the popover's fill, `markedBy(level, "box")`), from `creatureProficiency` (`creature.ts:148`), so the list marks what the Dice panel marks (D-261031-106). A check and Initiative have no mark, as in the Dice panel (`marksTest`).
- **Name for a reader**: the whole roll, "Dexterity save +2, proficient", then where it goes, ", answers the DM's request" or ", asks Bree", then the preset in words, "Dis: Restrained" (`presetLine`). Its description is FL-17's hint for a roll with options, "Hold, right-click or Shift+F10 for Advantage, Disadvantage or Secret." (`rollModeHint`), with `aria-keyshortcuts="ContextMenu Shift+F10"`. A row with no options has neither (D-261031-107).
- **Busy**: a row whose roll waits shows "…" after its bonus and is disabled, `aria-busy`, until its line lands. The row key is the Dice panel's (section 7), so the same save waits in both places and cannot go twice (D-261031-126).

### 4.3 Initiative

Initiative sits under Dexterity, last. It rolls `{ kind: "initiative" }` with the creature's preset, marked as initiative so the server keeps it from players who may not know the order (`asInitiative`, `options.ts:109`). In a fight, its write to the tracker is the Dice panel's: `useWatchInitiative` starts the room's listener once the tag is sent, and it writes once only while the row still holds what it held at the tap (`useRollOption.ts:242-278`). A changed row says "Not set: the row changed meanwhile." in the result line (section 8).

**Score rooms** (`scoreOf`, `options.ts:260`): where the room uses initiative scores and the creature has a row, for the DM or where players may type totals, Dexterity lists two rows (D-261031-109). "Initiative score", with the score at its end, sets the row without dice, as the Dice panel's "Score 12" does (`setInitiative`). It is not a roll, so it has no options and no hint. Then "Roll initiative", with the bonus at its end, tagged "replaces the score". Read out: "Initiative score 12, sets its row" and "Roll initiative +2, replaces the score".

### 4.4 A creature a player plays, for the DM

The DM's save, check and skill rows for a creature a player plays ask that player while the Dice panel's "Ask Bree to roll saves and checks" switch is on for it, its default (`RollOptions.tsx:409-425`). The block reads the same switch from the option store (`askOff`, keyed by creature) and adds no switch of its own (D-261031-120). Those rows are tagged "Asks", and a tap opens the request sheet filled with that test (`openAsk`, `useRollOption.ts:96`). An ask has no one-roll options, as the one-roll menu's design says (`docs/design-v1-roll-mode-menu.md` 4). Initiative never asks. With Ask off, the rows roll on the server as the DM's rolls.

### 4.5 Title and hint

- **Title**: the ability's name, "Dexterity", in FL-17's title row look (`data-roll-mode-title`, the section label look, two lines at most). The menu's accessible name is "Dexterity rolls".
- **Hint**: one muted small line at the list's foot, the mockup's: "Hold or right-click a roll for Advantage, Disadvantage or Secret." It shows only while some row has options, and wraps within the rows' width (`contain: inline-size`), never widening the menu. D-261031-076 removed the help paragraphs from the one-roll menu. This one line is in a different menu, and it is the only thing on screen that teaches the hold inside a list (D-261031-110).

### 4.6 Waiting, blocked and loading

- **Blocked**: with no connection or in a preview (`useRollBlocked`, `useRollOption.ts:25`), the box still opens its list, which reads its numbers. Every row is disabled (`aria-disabled`, still focusable), and one muted line under the title says why, "Rolling needs a connection." or "Rolls are not sent from a preview." (D-261031-121). No hint shows.
- **Loading**: a shape's or SRD creature's numbers need the SRD rolls table (`useDiceView`, `client/features/dice/useDiceView.ts`). While it loads the list holds the shared `Loading` line, "Loading the rolls…", in place of its rows, with the shared delay. If it fails, `SrdLoadFailed` says so inline with its reload (D-261031-122).
- **Live**: the rows follow the room while the list is open: a new request tags its row "Asked", a condition changes a tag, a bonus moves with a level. A row's options close if their own roll changes (5.4). The whole list closes when the creature goes, when the block unmounts, when the box stops rolling (section 2), and when a scroll takes the box out of view (`handleRollModeScroll`).

### 4.7 Keys in the list

The list is the shared `Menu` (`client/components/Menu.tsx`), so its keys are every menu's: Up and Down move and wrap, Home and End, a letter types ahead by the row's name, Enter or Space rolls, Tab and Shift+Tab close and move on, Escape closes back on the box. ContextMenu or Shift+F10 on a row with options opens them (section 5). Every key it handles is marked used.

## 5. A roll's options inside the list

### 5.1 Opening them

A hold of 500 ms on a row, a right-click on it, or ContextMenu or Shift+F10 on it focused, swaps the list for that roll's one-roll options in the same popover, still anchored to the box (D-261031-111). The press machine is the one-roll menu's, one per row, so the release after a hold selects nothing, a moving finger cancels, the 200 ms inset hint shows on the row, and the consumed finger cannot scroll the popover (`attachConsumedTouch`). A plain tap on the row rolls it, as a tap on any roll button does.

### 5.2 What they show

- **Title**: the roll as the list words it, with its ability where the row's name alone is "Check" or "Save": "Dexterity save +2", "Dexterity check +2", "Stealth +6", "Initiative +2", or "Roll initiative +2" in a score room. It is passed to FL-17's title row as `title`, since the row's own words say too little.
- **Choices**: FL-17's `rollModeItems` with `{ d20: true, visibility: "selectable" }`, or `"request"` for a row that answers a request. So Roll with Advantage, Roll with Disadvantage and Roll secretly, the last disabled for an answer with FL-17's reason as its description. No Roll normally: the block reads no Dice panel toggle, so a tap already rolls normally (D-261031-078, D-261031-112). Its accessible name is "Roll options for Dexterity save +2".
- **The box** keeps FL-17's accent ring, since the row that was held is no longer drawn.

### 5.3 Back, pick and focus

- **Escape or Android Back** in the options goes back to the list, the held row focused, nothing rolled. A second Escape or Back closes the list on the box. Popover gains one optional hook that it asks before Escape or Back closes it (section 10), since its Escape listener runs first in the capture phase (`Popover.tsx:396`, `:430`, `:455`).
- **A pick** rolls once with that choice and closes everything, focus back on the box (FL-17's `onPick`: capture, close, then send).
- **A tap outside**, a press on the box, Tab, or the box leaving view closes everything, rolling nothing.
- **Focus on the swap**: a key swap focuses the first enabled choice, and a pointer swap follows Popover's pointer rule. The swap moves focus before the held row unmounts, so Popover never sees its focused control vanish and close (`Popover.tsx`'s mutation watch).

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
- **Visibility** is the route's default: a player's roll public, a DM's monster roll secret, as Secret starts for it (`secretStartIn`, `useDicePanel.ts:267`). Roll secretly picks Secret for that roll on a free roll.
- **Row keys** are the Dice panel's, `${creatureKey}|${JSON.stringify(test)}` and `${creatureKey}|initiative`, so a roll is one roll wherever it shows and is busy in both places (D-261031-114).
- **The Dice panel's newest roll** becomes this roll, with its Again, as for any roll through this path (`useDicePanel.ts:234`, `noted` for an answer).

**What the block must not or cannot do** (D-261031-113, D-261031-115):

- **The Dice panel's pressed Adv, Dis and Secret**: never taken, never read. A toggle pressed in a panel the player cannot see would otherwise change, or be used up by, a roll from the block. Lane A adds `choices: "none"` to the panel's `roll` and to `d20`: no `take`, no `peek`, no manual source, ordinary visibility the route's baseline, the sticky line kept. The answer route sends no panel source either.
- **The dice tray**: block rolls throw no 3D dice. `useRollOption()` is called without `"dice"`, as the tracker's Roll is, so no throw origin goes.
- **Group rolls**: one creature only. Several selected, group saves and shared attacks stay in the Dice panel.
- **A typed bonus**: a block always has numbers here (section 2), so no "Roll d20" with a typed bonus.
- **Again and Recent rolls** stay in the Dice panel. The block offers neither.

## 8. The result

- **Where**: a result line directly under the ability grid, inside the block, the grid's width, `space(2)` above (D-261031-116). It appears on the block's first roll on this device and holds the newest roll from this grid. Each new roll from it replaces it. It goes when the block unmounts: a fold, a closed panel, another creature. Recent rolls, the Log and the Dice panel's newest roll keep every roll. No timer.
- **Look**: a raised rounded row as the mockup drew it (`surfaceRaised`, `radius.md`, side padding `space(3)`, at least 44 px tall), holding the sticky line's body: the total in heading type, then `ResultRest`'s label with its FL-12 frame, the dice chips and the verdict, dropping whole parts where short (`Roller.tsx:253`). No Again, no tap through to Recent rolls, no tray.
- **States**: while it waits, the shared `Loading` with its delay, "Rolling…", so a quick answer never flashes. Refused: the refusal's words as an alert. A tap that sent nothing, `d20` returning null on a roll route: the panel's words, "Rolling needs a connection.", as an alert. Unknown: "This may have happened. Check the log." Committed with no line left: "Rolled. Its result is no longer in the log." Initiative written too late: a second muted line, "Not set: the row changed meanwhile." (`useInitiativeChanged`). An ask shows no line: the request sheet opens.
- **Words for a reader**: a polite live region says it once, `spokenResult` with the returned mode and Secret (`Roller.tsx:104`). The line's description names the effective mode and Secret from the returned envelope (`effectiveRollMode`). The line itself adds no "Normal" and no mode word (D-261030-583, D-261031-129).
- **Toasts**: the line watches its tag through `useReceipt`, so its own result never toasts. A roll whose block closed before it landed toasts once, as the Dice panel's does (`useRollToasts.ts:118-123`, `useReceipt.ts:237`). Other viewers get their usual line, toast and Log entry, and only what their projection holds, so a secret roll reaches other players as "rolled in secret".

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
| The connection drops between opening and a tap | The rows turn disabled with the reason. A tap that got in first sends nothing and the result line says "Rolling needs a connection." |
| A reload while a roll waits | The line goes with the page. Recent rolls and the Log hold the roll |
| A player's secret roll | Their line shows the result. Other players read "rolled in secret", and the DM reads the dice |
| The DM viewing a scene the players are not on | Its tokens' blocks roll, as the Dice panel's options do for a token selected there |
| A token a player owns whose character they do not own | No block shows for them (`statBlockShown`), so nothing changes |

## 9. Layout and measuring

- **No geometry changes when closed**: the button and the corner mark take no room, so a rolling grid's boxes, rows and columns equal a text grid's at every size and scale. The result line is the only added row, and only after a roll. The list is out of flow.
- **The list on a phone**: Wisdom's and Intelligence's seven 44 px rows come to over 300 px before the title and hint. At 320 x 568 at 130% and in landscape the list may not fit above or below. It then shifts and scrolls inside its box, as Popover does, title included. FL-17 draws popovers above a sheet's scroller, so it is never clipped. Its box carries `data-roll-mode-menu`, the sheet swipe's owned boundary (`lib/sheetSwipe.ts:638`), so a drag in it never moves the sheet.
- **Widths**: the menu measures its rows at their own widths (`Menu.tsx` `ROWS_WIDTH`). "Sleight of Hand" with a "Dis +1d4" tag and "+12" should fit the about 246 layout px a 320 px phone gives at 130%, which lane C measures. A row that does not fit wraps its tag under its name.
- **Sizes**: 1440 x 900, 390 x 844 and 320 x 568 at 100% and 130%, the six. The tablet, 820 x 1180, at both. The landscape checks, 844 x 390 and 480 x 320 at 130% only (D-261031-054).
- **Strict helpers**: `measureAlignment` and `measureSpacing` reject a root that matches nothing, and every root here is required, with counts. Roots: a rolling grid closed, the open list, the open options, and the result line with a landed roll, on the PC sheet in the token panel and on the character page, a monster's block for the DM, a companion's block, and Wild Shape's creature block. `saveOutlineLines` on every rolling grid. `proficiencyHeightLines` on the open list's marked rows. `menuWordLines` and `popoverScrollbarLines` on both views. Bounding-box checks: the corner mark inside its box's first line and clear of the abbreviation, the box's focus ring and FL-17's ring unclipped by any ancestor.

## 10. Parts and contracts

Lane A freezes these before lanes B and C build on them.

- **`useDicePanel.ts`**: `roll(rolls, { choices: "none" })`, no `take` or `peek`, manual sources empty, ordinary visibility the baseline, the sticky line set as for a panel roll.
- **`useRollOption.ts`**: `d20({ ..., choices: "none" })`, passing it to the panel roll and sending no panel source on an answer. It still returns the tag, `"asked"` or null.
- **`useRollModeMenu.tsx`**: the press wiring (window listeners, pointer, touch, context menu and key handlers, the consumed touch, the hold hint) factored into `useRollPressBinding(env)`, used by `useRollModeMenu`, the box and each row. Behavior unchanged, held by its existing tests and `rollmodes.e2e.ts`.
- **`RollModeMenu.tsx`**: `RollModeMenuBody`, FL-17's title and choices without the Popover, so a popover that already exists can show them.
- **`Menu.tsx`**: an item may carry `content` (drawn in place of `title`, which still names it for typeahead), `style` and `data` (its mark), `label` (its accessible name) and `events` (the press binding's handlers). Nothing changes for an item without them.
- **`Popover.tsx`**: optional `stepBack(): boolean`, asked by its Escape and Back handlers before they close it. True keeps it open.
- **`blockRolls.ts`** (new, pure): `blockRoller` (section 2) and `abilityRows(ability, input)` returning each row's test, words, bonus, tags, level, route kind, options capability, source and name, the score rows included. No React.
- **`useAbilityMenu.tsx`** (new): the box's binding and the popover with its two views, a press binding per row, the swap, `stepBack`, the pick and the roll. Returns `{ buttonProps, menu, open }`, and calls `onSent(tag)` or `onUnsent(words)` after each tap or pick, which the grid keeps as its newest result.
- **`AbilityMenu.tsx`** (new): the list's render, the title, rows, blocked line, loading and hint.
- **`BlockResult.tsx`** (new, lane B): the result line. `Roller.tsx` exports the sticky line's committed body, total and `ResultRest`, for it to share.
- **`AbilityGrid.tsx`** takes an optional `roll` prop, `{ creature, tokenId?, name, played }` from `blockRoller`. Without it, it draws today's text grid. With it, it keeps the newest result of its six boxes and draws `BlockResult` right after its `<dl>`. `StatBlockView` and `PcStatsView` pass it through. `StatBlockSection`, `PcStatBlock` (its view and `ShapeBody`) and `CharacterCard` compute it.
- **Comments**: `StatBlockView`'s "Nothing in it rolls" and `PcStatsView`'s "Nothing in it rolls: rolls are made in the Dice panel." change to name the boxes.

## 11. Tests

Fail-first: every new case below fails before its code lands. Cases that hold today's behavior are regression checks and say so. Each new rule is mutation-checked: its fix removed, its test fails.

**Unit**

- `blockRolls.test.ts`: `blockRoller` over section 2's table, every mount and viewer, a DM's character page with and without a token in view, a lent token, hidden numbers. `abilityRows` for each ability: the order, every skill under its ability, Constitution's two, Initiative last under Dexterity, the score pair in a score room, words and bonuses from `bonusFor` and `initBonus`, Jack of All Trades on a skill and not a check, tags for an answer, an ask, Restrained, Bless, Stunned and a set row, levels from `creatureProficiency` with expertise, Wild Shape's numbers and marks with and without a block, Polymorph.
- `useDicePanel.test.ts` and `flow.test.ts`: `choices: "none"` with Adv, Dis and Secret pressed sends none of them, leaves the store and its version unchanged, uses the baseline (a DM's monster secret, a player's roll public), sets the sticky line, and restores nothing on a refusal. Adv, Dis and Secret overrides on top.
- `useRollOption.test.ts`: an answer with `choices: "none"` sends only the preset's sources and the override's.
- `Menu.test.ts` (new): `content`, `style`, `data`, `label` and `events` render on the item, typeahead reads `title`, a disabled item picks nothing, items without them render as today.
- `popover.test.ts`: `stepBack` true keeps it open on Escape and Back, false or absent closes as today.
- `useRollModeMenu.test.ts` (regression): its cases pass unchanged after the refactor.
- `useAbilityMenu.test.ts`: every press of 3.3 opens the list, a press on the open box closes it, a hold's release picks nothing, a row's tap rolls once and closes with focus on the box, a row's hold, right-click and keys swap to its options, a pick rolls once with its override, Escape and Back step back with the row focused, the second closes, a source change sends the options back, blocked and loading rows, the hint only with options, a busy row cannot send, and a send that returns null puts the connection words in the result.
- `abilityMenu.random.test.ts`: random fake-clock sequences of box and row presses, holds, moves, scrolls, cancels, keys, picks, Escape, Back, source changes and unmounts. At most one view open, at most one roll per activation, no roll on a hold's release or a step back, nothing after unmount, no timer or consumed-touch listener left after a terminal event.
- `proficiency.test.ts`: a rolling grid keeps `dl`, `dt`, `dd` and `data-save-proficient`, its button's name and the hidden words, the mark only when rolling. A text grid renders as today.
- `BlockResult.test.ts`: each state's words, the live region once, no Again.

**e2e** (new `e2e/blockrolls.e2e.ts`, labels `sbr-`, its port offset reserved through coordination)

| Case | Expected |
| --- | --- |
| sbr-1. Player taps DEX on Thorn's sheet, then Stealth | List in 4.1's order, one `dice.roll`, the result line, the Dice panel's newest roll |
| sbr-2. Adv pressed in the Dice panel, then a block roll | The block roll has no Advantage, Adv stays pressed, its version unchanged |
| sbr-3. Hold Save 499 ms and 500 ms, release | A tap rolls at 499, options open at 500, the release picks nothing |
| sbr-4. Options: Advantage, Escape, Back, a second Escape | Adv, Dis and Secret, no Normal, one roll with Advantage. Back to the list on Save, then closed on the box |
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
| sbr-15. A reader's click (detail 0) after a hold, and both context keys | No roll on that click, the same views as sbr-3 and sbr-5 |

Extend `pcstats.e2e.ts`, `tokenpanel.e2e.ts`, `characters.e2e.ts` and `companions.e2e.ts` where their grids now roll, and `rollmodes.e2e.ts` for the refactored binding. The alignment roots of section 9 join FL-7's sweep in `e2e/alignmentRoom.ts` (`proficiencyTests`, run by `proficiency.e2e.ts`) at its sizes and the tablet, with the landscape pair, and save new screenshots under `screenshots/stat-block-rolls/` without overwriting earlier ones. VoiceOver and TalkBack on a device are a manual check, reported as run or not.

## 12. Build plan

Lanes in isolated workspaces on FL-17's merged tip. A file and its unit tests have one owner. A lane that needs a contract change sends it to lane A. No lane touches `shared/` or `server/`.

| Lane | Owns |
| --- | --- |
| A: contract and the list | `client/features/dice/useDicePanel.ts`, `useRollOption.ts`, `useRollModeMenu.tsx`, `RollModeMenu.tsx`, new `blockRolls.ts`, `useAbilityMenu.tsx`, `AbilityMenu.tsx`, `client/components/Menu.tsx`, `Popover.tsx`, and their tests. Its first commit freezes the types of section 10 with stubs, so B and C start at once |
| B: the grid, mounts and result | `client/features/monsters/AbilityGrid.tsx`, `StatBlockView.tsx`, `proficiency.test.ts`, `client/features/pcstats/PcStatsView.tsx`, `PcStatBlock.tsx`, `client/features/tokens/StatBlockSection.tsx`, `CharacterCard.tsx`, `client/features/dice/Roller.tsx` (the export only), new `BlockResult.tsx` and their tests |
| C: e2e, sheet and docs | `e2e/blockrolls.e2e.ts`, `e2e/alignmentRoom.ts`, the touched e2e files of section 11, `client/state/shortcuts.ts` and its tests, `FEATURES.md`, `docs/dm-guide.md` and its images, the superseded lines of section 13, this doc's As built. It writes e2e against this doc while A and B build, then integrates their exact committed tips and runs the combined checks |

Commits, in order:

1. `feat(dice): roll for one creature without the dice panel's choices` (A)
2. `feat(ui): menu rows with their own content and presses, and a popover step back` (A)
3. `feat(dice): an ability's rolls with one-roll options` (A)
4. `feat(ui): ability boxes that open their rolls` (B)
5. `test(e2e): stat block rolls` (C)
6. `feat(ui): stat block rolls in the shortcut sheet` (C: the registry, its tests and FEATURES.md's Shortcuts tables, which `shortcuts.test.ts` holds together)
7. `docs: stat block rolls in the features, guide and designs` (C)

**Checks**, independent ones in parallel: `pnpm typecheck`, `pnpm test` and `pnpm build` on every lane. Lane A also runs `rollmodes`, `dice`, `rolls`, `paneltabs`, `tools`, `keyboard` and `swipe`, since the menu, popover and press binding are shared. Lane B runs `pcstats`, `tokenpanel`, `characters`, `companions` and `proficiency`. Lane C runs, on the integrated tip, `blockrolls`, every file above, `combat`, `shortcuts`, `alignment`, `alignment-wide`, `alignment-icons`, `alignment-followups` and `reach`, through the coordinator's lane check with a database and port reserved for it. No server or shared code changes, so `test:int` is not part of it. Per-surface screenshots of the new look (the PC sheet, a monster, a companion, Wild Shape, both views open, the result line) go to the project owner before it ships, as the visual design pass asks.

## 13. Docs and the shortcut sheet

**Shortcut sheet** (`client/state/shortcuts.ts`, with FEATURES.md's tables in the same commit). Mouse and touch, room-wide, `device: "pointer"`: "Tap, click, hold or right-click an ability box in a stat block": "Open its rolls: the check, the save, its skills, and Initiative under Dexterity. Tap one to roll it", and "Hold or right-click a roll in an ability's rolls": "Show its one-roll options in their place, without rolling". Keys, under "Token and character fields": "Enter, Space, Down, ContextMenu, Shift+F10" on a focused ability box: "Open its rolls, the first one focused". "ContextMenu, Shift+F10" on a roll in an ability's rolls: "Show its one-roll options, the first choice focused. Enter and Space still roll as before". "Escape" there: "From a roll's options, go back to the ability's rolls. From the rolls, close them back on the box". "Up, Down, Home, End" there: "Move through the rolls or the choices". No new surface (D-261031-125).

**FEATURES.md**: "## Characters and monsters" gains the boxes: where they roll, the list, the options in it, the result line, Wild Shape's numbers, and that the Skills line, Initiative line and weapons stay text. Its proficiency bullet (FEATURES.md:437) says the list's rows carry the roll border, while the boxes keep the save outline and the block's text stays unmarked. "## Dice" says a block roll is the newest roll, takes no Next roll choice and throws no dice. The DM guide: a short guide passage under "Dice", "Roll options", beside the stat block passages in "Monsters" and "Stat blocks", in its own voice, each control beside its key, with one new phone picture of an open list.

Draft FEATURES.md bullet, for "## Characters and monsters":

> - **Roll from a stat block**: where you may roll for its creature, tap one of a stat block's six ability boxes for its rolls: the check, the save, each of its skills, and Initiative under Dexterity, each with the bonus it rolls, a proficient one bordered as in the Dice panel. Tap one to roll it. Hold one, right-click it, or press ContextMenu or Shift+F10 on it for Roll with Advantage, Roll with Disadvantage or Roll secretly, and Escape goes back to the list. A small mark in a box's corner shows it opens. The result shows under the boxes. A roll answers a request that asks for it, writes Initiative into the tracker, and for the DM asks a player's creature while its Ask switch is on. It uses none of the Dice panel's Next roll choices and throws no dice. In Wild Shape the boxes show the creature's block and roll the numbers under "Rolls now". The Skills line, the Initiative line and weapons stay text, and so does a block with no creature behind it, as in the Monsters panel.

Draft DM guide passage, for "Roll options":

> **Rolling from a stat block.** For a quick save or check you don't need the Dice panel. In a creature's stat block, tap one of the six ability boxes, the ones with a small mark in the corner. A short list opens with that ability's check, its save and its skills, and under Dexterity, Initiative. Tap one to roll it, and the result shows under the boxes. For Advantage, Disadvantage or a secret roll, hold the roll for half a second or right-click it, or press **Shift+F10** on it, then pick. **Escape** takes you back to the list. For a creature a player plays, a save or check asks that player while its Ask switch in the Dice panel is on. Boxes in the Monsters panel stay plain, since no creature stands behind them.

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

1. **D-261031-101: a button laid over the box, FL-15's markup kept.** Rejected: turning the box into a button, which cannot hold `dt` and `dd`, so the grid's meaning and FL-15's checks would change. Rejected: a separate Roll control, the mockup's option B.
2. **D-261031-102: the mockup's 10 px corner mark and a pointer cursor, no hover look.** Rejected: the mockup's hover outline, since the app's buttons have none and nothing may need hover. Rejected: a raised border like the Dice panel's cells, which would change FL-15's look. Rejected: no sign at all, since nothing would say the box opens.
3. **D-261031-103: the button's name carries the box's words, and the words are hidden from readers while it stands.** Rejected: reading both, which says every number twice. Rejected: a short name such as "Strength rolls", which touch exploration would hear without the numbers.
4. **D-261031-104: every press on the box opens the same list.** Rejected: a hold opening the check's options, a hidden shortcut to one of seven rolls that would make a hold mean two things. Rejected: a hold doing nothing, which on iOS selects words or lets the lifting click toggle the list.
5. **D-261031-105: Check, Save, every skill of the ability in order, then Initiative under Dexterity.** Rejected: only the skills the block lists, which leaves the rest with no home. Rejected: Initiative first, which would put a fight's roll ahead of Dexterity's own check and save, where the mockup put it last.
6. **D-261031-106: a marked row draws FL-12's box form on its own border.** Rejected: the mockup's bold bonus, which FL-15 dropped. Rejected: a frame around the name alone, since a row here is a roll control, as the Dice panel's cells are.
7. **D-261031-107: a row's name for a reader is the whole roll with its route and preset, its description the hint.** Rejected: "Save +6" alone, which leaves out the ability and what the tap does.
8. **D-261031-108: the Dice panel's tags on the rows.** Rejected: no tags, which leaves an answer, an ask or a condition unsaid before the tap.
9. **D-261031-109: "Initiative score" then "Roll initiative" in a score room.** Rejected: the Dice panel's "Score 12" and "Roll instead", which lose the word Initiative outside its own card. Rejected: the roll alone, which drops the room's way of setting a monster's place.
10. **D-261031-110: the ability's name as the title in FL-17's look, and the mockup's one hint line at the foot.** Rejected: no hint, which leaves the hold inside a list with nothing on screen to teach it. Rejected: a longer line naming the keys, which the rows' descriptions already say.
11. **D-261031-111: a hold swaps the same popover to the roll's options, and Escape or Back steps back.** Rejected: a second popover over the first, two stacked menus on a phone. Rejected: Escape closing both, the mockup's, which loses the list. Rejected: a Back row, a control added to every options view.
12. **D-261031-112: Advantage, Disadvantage and Secret, no Normal, Secret kept even where a DM's tap is already secret.** Rejected: dropping Secret here alone, which would make this roll's options differ from the same roll's in the Dice panel. Rejected: a "Roll in the open" choice, a fifth choice outside the approved four (D-261030-452).
13. **D-261031-113: the block takes, reads and changes no Dice panel toggle.** Rejected: taking them, which would use up a choice set for the panel's next roll. Rejected: reading them without taking, which lets a toggle out of sight change a block roll.
14. **D-261031-114: the Dice panel's row keys, and the roll becomes the panel's newest.** Rejected: rows of its own, which let the same save go twice from two places while one waits. Rejected: leaving the panel's newest roll alone, which would show an older roll as the newest.
15. **D-261031-115: no dice tray from the block.** Rejected: throwing dice there, since the tray belongs to the Dice panel and would cover the block.
16. **D-261031-116: the result line under the grid, until the next roll or the block closes, with no Again.** Rejected: the mockup's place at the block's top, which moves the grid under the finger. Rejected: a toast alone, since the project owner wants rolls in the block. Rejected: Again in the block, a control the Dice panel already has.
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
29. **D-261031-129: the result line adds no mode word, its description and announcement carry the mode and Secret.** Rejected: a "Normal" or "Advantage" on the line, which D-261030-583 keeps off result lines that would wrap.

## As built

To be written by lane C in commit 7.
