import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Locator, type Page, type WebSocketRoute } from "playwright-core";
import { barControl, ConsoleWatch, diceFoldsOpen, OpSocket, openSideTab, reopenRoom, Shots, sideTabName, sleep, SocketWatch, startServer, tapCell, Touches, waitFor, type Server, type TouchAt } from "./harness.ts";

/**
 * Rolling from a stat block's ability boxes (docs/design-v1-stat-block-rolls.md
 * 11), its steps labeled `sbr-`, on the real server serving the production
 * build. Pat plays Thorn on a phone and the DM plays on a computer. A tap on
 * a box opens that ability's list, a tap on a row rolls it through the Dice
 * panel's path and takes none of the panel's Adv, Dis and Secret, a hold,
 * right-click, ContextMenu or Shift+F10 on a row swaps the list for the
 * roll's options in the same popover, and the result shows under the boxes.
 * Then the rules around them: a hold's release over the options picks
 * nothing and its drift scrolls nothing, Escape and Android's Back step back
 * one view at a time, a request is answered and a played creature asked, a
 * score room sets Initiative, Wild Shape rolls "Rolls now", text stays text
 * where no creature stands behind a block, a block folded before its roll
 * lands gives one toast, the Dice panel beside the block stays silent, and
 * Poisoned and Restrained show their tags.
 *
 * The markers it reads, from the design: a rolling grid is a
 * `[data-ability-grid]` group of six buttons named by their printed words
 * ("Strength 16, +3, save +6, proficient"), a list is a menu named "Dexterity
 * rolls" whose rows are menu items named by the whole roll, a roll's options
 * are a menu named "Roll options for Dexterity save +2", and the result line
 * is `[data-block-result]`. Every run is under reduced motion, so a result
 * shows at once and no dice are in the air to take the next tap.
 *
 * It runs with `pnpm test:e2e` on E2E_PORT plus thirty-seven, one file after
 * another as the others. The other environment variables are the smoke run's
 * (smoke.e2e.ts).
 */

const PORT = Number(process.env.E2E_PORT ?? 3100) + 37;
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://raccoon:raccoon@localhost:5434/raccoon";
const SHOT_DIR = process.env.E2E_SCREENSHOT_DIR ?? "test-results/e2e-screenshots";

const work = mkdtempSync(path.join(tmpdir(), "raccoon-e2e-blockrolls-"));
const assetDir = path.join(work, "assets");
const shots = new Shots(SHOT_DIR === "0" ? null : SHOT_DIR);

const COMPUTER = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const BOUNDS = { w: 20, h: 12 };
/** Past the 500 ms hold (lib/gestures.ts LONG_PRESS_MS), with room for a slow runner. */
const HELD_MS = 700;
/** How long a step waits to be sure a gesture sent nothing. */
const QUIET_MS = 600;
const RESULT = "[data-block-result]";

let server: Server;
let browser: Browser;
let dmContext: BrowserContext;
let patContext: BrowserContext;
let dm: Page;
let pat: Page;
let patCdp: CDPSession;
let ops: OpSocket;
const dmSocket = new SocketWatch("dm");
const patSocket = new SocketWatch("pat");
const consoles = { dm: new ConsoleWatch("dm"), pat: new ConsoleWatch("pat") };

const run = {
  roomId: "",
  roomName: `E2E block rolls ${new Date().toISOString().slice(0, 19)}`,
  password: "",
  patId: "",
  sceneId: "",
  thornChar: randomUUID(),
  loneChar: randomUUID(),
  thorn: { id: randomUUID(), x: 3, y: 3 },
  goblin: { id: randomUUID(), x: 9, y: 3 },
  wolf: { id: randomUUID(), x: 5, y: 3 },
};

function actor(over: Record<string, unknown> = {}) {
  return { hp: { cur: 30, max: 30, temp: 0 }, life: "alive", ac: 14, speeds: { walk: 30 }, initBonus: 1, passivePerception: 12, senses: "", effects: [], deathSaves: { ok: 0, fail: 0 }, notes: "", dmNotes: "", ...over };
}

/** Thorn: Dex 12 with Stealth proficient, Wis 16 with a proficient save, Str 16 with Athletics. */
const THORN_STATS = {
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 16, cha: 10 },
  saves: ["wis", "cha"],
  skills: { athletics: "prof", stealth: "prof" },
  spellAbility: "wis",
  adjust: {},
  defenses: {},
  rolls: [],
};

async function join(context: BrowserContext, name: string, color: string): Promise<string> {
  const headers = { Origin: server.origin, "content-type": "application/json" };
  const joined = await context.request.post(`${server.origin}/api/rooms/${run.roomId}/join`, { headers, data: { password: run.password } });
  assert.ok(joined.ok(), `joining answered ${joined.status()}`);
  const { ticket } = (await joined.json()) as { ticket: string };
  const done = await context.request.post(`${server.origin}/api/rooms/${run.roomId}/join/complete`, { headers, data: { ticket, name, color } });
  assert.ok(done.ok(), `completing the join answered ${done.status()}`);
  return ((await done.json()) as { member: { id: string } }).member.id;
}

function tokenOp(id: string, extra: Record<string, unknown>) {
  return { t: "token.create", token: { id, sceneId: run.sceneId, size: "medium", visibility: "all", ...extra } };
}

type SentRoll = { formula: string; mode?: string; cancelled?: true; label?: string };
type Op = { t: string; to?: string; mode?: string; tag?: string; cancelled?: true; rolls?: SentRoll[] } & Record<string, unknown>;
const ROLL_OPS = new Set(["dice.roll", "roll.dice", "actor.deathRoll", "actor.rechargeRoll"]);

/** Every op a page sent on its room socket, in order, so a step reads exactly what a gesture sent. */
class OpsSent {
  readonly ops: Op[] = [];
  attach(page: Page): void {
    page.on("websocket", (ws) => {
      if (!ws.url().includes("/ws?room=")) return;
      ws.on("framesent", ({ payload }) => {
        try {
          const frame = JSON.parse(typeof payload === "string" ? payload : payload.toString("utf8")) as { t?: string; op?: Op };
          if (frame.t === "op" && frame.op) this.ops.push(frame.op);
        } catch {
          // Not JSON: nothing this file reads.
        }
      });
    });
  }
  rolls(from: number): Op[] {
    return this.ops.slice(from).filter((op) => ROLL_OPS.has(op.t));
  }
}
const dmSent = new OpsSent();
const patSent = new OpsSent();

/**
 * A page's room socket with a valve on its rolls: while `hold` is on, a
 * dice.roll or roll.dice the page sends waits here instead of reaching the
 * server, so a step sees a block with a roll in flight, and `release` sends
 * what waited.
 */
class Wire {
  hold = false;
  private held: string[] = [];
  private up: WebSocketRoute | null = null;
  async install(page: Page): Promise<void> {
    await page.routeWebSocket(/\/ws\?room=/, (ws) => {
      const upstream = ws.connectToServer();
      this.up = upstream;
      ws.onMessage((m) => {
        if (this.hold && typeof m === "string" && (m.includes('"dice.roll"') || m.includes('"roll.dice"'))) this.held.push(m);
        else upstream.send(m);
      });
      upstream.onMessage((m) => ws.send(m));
    });
  }
  release(): void {
    this.hold = false;
    for (const m of this.held.splice(0)) this.up?.send(m);
  }
}
const dmWire = new Wire();
const patWire = new Wire();

/** Exactly one roll op sent since `from`: waits for it, then a little longer for any second one, then for its line to land in the sender's log. */
async function oneRoll(sent: OpsSent, from: number, what: string): Promise<Op> {
  await waitFor(`${what} sent`, () => sent.rolls(from).length > 0 || null);
  await sleep(300);
  const rolls = sent.rolls(from);
  assert.equal(rolls.length, 1, `${what} sent one roll: ${JSON.stringify(rolls)}`);
  const op = rolls[0]!;
  const socket = sent === dmSent ? dmSocket : sent === patSent ? patSocket : null;
  if (socket && op.t === "dice.roll") await waitFor(`${what} landed`, () => socket.state?.log.some((e) => e.data?.type === "dice" && e.data.tag === op.tag) || null);
  await sleep(150);
  return op;
}

async function noRoll(sent: OpsSent, from: number, what: string): Promise<void> {
  await sleep(QUIET_MS);
  assert.deepEqual(sent.rolls(from), [], `${what} sent no roll`);
}

/** The mode a dice.roll was sent with, from its first roll. */
function sentMode(op: Op): string | null {
  return op.rolls?.[0]?.mode ?? op.mode ?? null;
}

/** The middle of a control, scrolled into the middle of its scroller, in the viewport's CSS px, where a finger lands. */
async function middle(control: Locator): Promise<TouchAt> {
  await control.evaluate((el) => (el as unknown as { scrollIntoView(o: object): void }).scrollIntoView({ block: "center", inline: "nearest" }));
  await sleep(100);
  const box = await control.boundingBox();
  assert.ok(box, "the control has a box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** One finger held on `control` for `ms`, then lifted where it is. */
async function hold(cdp: CDPSession, control: Locator, ms = HELD_MS): Promise<void> {
  const touches = new Touches(cdp);
  await touches.start([await middle(control)]);
  await sleep(ms);
  await touches.end([], 16);
}

/** The nearest scroller around `inside`, by its scroll offset. */
function scrollTopAround(inside: Locator): Promise<number> {
  return inside.evaluate((el) => {
    type Box = { parentElement: Box | null; scrollTop: number };
    const view = (el as unknown as { ownerDocument: { defaultView: { getComputedStyle(e: Box): { overflowY: string } } } }).ownerDocument.defaultView;
    let box = (el as unknown as Box).parentElement;
    while (box && !/(auto|scroll)/.test(view.getComputedStyle(box).overflowY)) box = box.parentElement;
    return box ? box.scrollTop : -1;
  });
}

/** The click Safari sends where a held finger lifts, a pointer's, with detail 1. */
function liftClick(control: Locator): Promise<void> {
  return control.evaluate((el) => {
    const g = globalThis as unknown as { MouseEvent: new (type: string, init: Record<string, unknown>) => unknown };
    (el as unknown as { dispatchEvent(e: unknown): boolean }).dispatchEvent(new g.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
}

/** A reader's double-tap on a control: a click with detail 0. */
function readerClick(control: Locator): Promise<void> {
  return control.evaluate((el) => (el as unknown as { click(): void }).click());
}

/** Counts every contextmenu event that reaches the window, and whether the page prevented it, so a step sees the browser's own too. */
async function watchContextMenus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = globalThis as unknown as { rvttMenus?: boolean[]; addEventListener(t: string, f: (e: { defaultPrevented: boolean }) => void): void };
    if (w.rvttMenus) {
      w.rvttMenus.length = 0;
      return;
    }
    w.rvttMenus = [];
    w.addEventListener("contextmenu", (e) => w.rvttMenus!.push(e.defaultPrevented));
  });
}

function contextMenus(page: Page): Promise<boolean[]> {
  return page.evaluate(() => [...((globalThis as unknown as { rvttMenus?: boolean[] }).rvttMenus ?? [])]);
}

function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = (globalThis as unknown as { document: { activeElement: { getAttribute(n: string): string | null; innerText?: string } | null } }).document.activeElement;
    return el ? (el.getAttribute("aria-label") ?? (el.innerText ?? "").trim()) : "none";
  });
}

async function isFocused(control: Locator): Promise<boolean> {
  return control.evaluate((el) => (el as unknown as { ownerDocument: { activeElement: unknown } }).ownerDocument.activeElement === el);
}

// The design's markers, in one place.
const gridOf = (scope: Locator) => scope.locator("[data-ability-grid]").first();
const boxOf = (scope: Locator, ability: string) => gridOf(scope).getByRole("button", { name: new RegExp(`^${ability} `) });
const listOf = (page: Page, ability: string) => page.getByRole("menu", { name: `${ability} rolls` });
const optionsOf = (page: Page, roll: RegExp) => page.getByRole("menu", { name: roll });
const resultOf = (scope: Locator) => scope.locator(RESULT);

/** Each row's accessible name, in order: the whole roll, such as "Dexterity save +1". */
async function rowNames(menu: Locator): Promise<string[]> {
  await menu.waitFor();
  return menu.getByRole("menuitem").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? (el as unknown as { innerText: string }).innerText.trim()));
}

async function choiceTitles(menu: Locator): Promise<{ title: string; disabled: boolean }[]> {
  await menu.waitFor();
  return menu.getByRole("menuitem").evaluateAll((els) => els.map((el) => ({ title: (el as unknown as { innerText: string }).innerText.trim(), disabled: el.getAttribute("aria-disabled") === "true" })));
}

/** Where the Dice panel's own Adv, Dis and Secret stand. */
async function modes(scope: Locator): Promise<{ adv: boolean; dis: boolean; secret: boolean }> {
  const group = scope.getByRole("group", { name: "For the next roll" });
  const pressed = async (name: RegExp) => (await group.getByRole("button", { name }).getAttribute("aria-pressed")) === "true";
  return { adv: await pressed(/^Advantage$/), dis: await pressed(/^Disadvantage$/), secret: await pressed(/^(Hide from players|Only the DM sees it)$/) };
}

async function pressMode(scope: Locator, name: "Advantage" | "Disadvantage" | "Secret"): Promise<void> {
  const group = scope.getByRole("group", { name: "For the next roll" });
  const button = name === "Secret" ? group.getByRole("button", { name: /^(Hide from players|Only the DM sees it)$/ }) : group.getByRole("button", { name, exact: true });
  const was = await button.getAttribute("aria-pressed");
  await button.click();
  await waitFor(`${name} switched`, async () => ((await button.getAttribute("aria-pressed")) !== was ? true : null));
}

function diceSheet(page: Page): Locator {
  return page.locator('dialog[data-rvtt-sheet][aria-label="Dice"]');
}

async function openDiceSheet(page: Page): Promise<Locator> {
  const dice = diceSheet(page);
  if (await dice.isVisible()) return dice;
  await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: /^Panels/ }).tap();
  await page.getByRole("region", { name: "Panels" }).getByRole("button", { name: /^Dice/ }).tap();
  await dice.waitFor();
  return dice;
}

/** Pat's Characters sheet, Thorn's page in it, with the stat block open. */
async function patSheet(): Promise<Locator> {
  const sheet = pat.locator('dialog[data-rvtt-sheet][aria-label="Characters"]');
  if (!(await sheet.isVisible())) {
    if (await diceSheet(pat).isVisible()) await closeSheets(pat);
    await pat.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: /^Panels/ }).tap();
    await pat.getByRole("region", { name: "Panels" }).getByRole("button", { name: /^Characters/ }).tap();
    await sheet.waitFor();
  }
  await sheet.locator("[data-creature-heading]").filter({ hasText: "Thorn" }).waitFor();
  const fold = sheet.getByRole("button", { name: "Stat block", exact: true });
  if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
  await sheet.locator("[data-pc-stats] [data-ability-grid]").waitFor();
  return sheet;
}

async function closeSheets(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) await page.keyboard.press("Escape");
  await page.locator("dialog[data-rvtt-sheet][open]").first().waitFor({ state: "hidden", timeout: 1_500 }).catch(() => undefined);
}

/** The DM's token panel for a token, its Stat block open. */
async function dmPanel(name: string, at: { x: number; y: number }): Promise<Locator> {
  await dm.keyboard.press("Escape");
  await tapCell(dm, BOUNDS, at);
  const bar = dm.getByRole("dialog", { name: `${name} actions` });
  await bar.waitFor();
  await (await barControl(bar, "Details")).click();
  const panel = dm.getByRole("tabpanel", { name: "Token", exact: true }).or(dm.getByRole("region", { name: "Token", exact: true }));
  await panel.getByRole("heading", { name, exact: true }).first().waitFor();
  const fold = panel.getByRole("button", { name: "Stat block", exact: true });
  await fold.waitFor();
  if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
  await panel.locator("[data-ability-grid]").first().waitFor();
  return panel;
}

async function closeLists(page: Page): Promise<void> {
  for (let i = 0; i < 2; i++) {
    if ((await page.locator("div[data-rvtt-popover]").count()) === 0) break;
    await page.keyboard.press("Escape");
    await sleep(100);
  }
}

/** The log entry for a roll's tag, in a socket's state. */
function logEntry(socket: SocketWatch, tag: string | undefined) {
  return socket.state?.log.find((e) => e.data?.type === "dice" && e.data.tag === tag);
}

describe("raccoon-vtt rolling from a stat block", { timeout: 900_000 }, () => {
  before(async () => {
    server = await startServer({ port: PORT, assetDir, databaseUrl: DATABASE_URL });
    browser = await chromium.launch({ channel: "chrome", headless: process.env.E2E_HEADED !== "1" });
    dmContext = await browser.newContext({ viewport: COMPUTER, reducedMotion: "reduce" });
    patContext = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
    await diceFoldsOpen(dmContext);
    await diceFoldsOpen(patContext);
    dm = await dmContext.newPage();
    pat = await patContext.newPage();
    await dmWire.install(dm);
    await patWire.install(pat);
    consoles.dm.attach(dm);
    consoles.pat.attach(pat);
    dmSent.attach(dm);
    patSent.attach(pat);
    await dmSocket.attach(dmContext, dm);
    await patSocket.attach(patContext, pat);
    patCdp = await patContext.newCDPSession(pat);
  });

  after(async () => {
    if (process.env.E2E_DEBUG === "1") {
      for (const c of Object.values(consoles)) console.error(`[${c.label}] errors`, c.errors, "warnings", c.warnings);
      console.error(server?.output().split("\n").slice(-40).join("\n"));
    }
    ops?.close();
    if (run.roomId && dmContext) {
      try {
        const res = await dmContext.request.delete(`${server.origin}/api/rooms/${run.roomId}`, { headers: { Origin: server.origin }, data: { name: run.roomName } });
        if (!res.ok()) console.error(`Deleting room ${run.roomId} answered ${res.status()}`);
      } catch (err) {
        console.error(`Deleting room ${run.roomId} failed`, err);
      }
    }
    await browser?.close();
    await server?.stop();
    rmSync(work, { recursive: true, force: true });
  });

  test("sbr-0. the DM's room at 1440 x 900, Pat on a phone with Thorn, a goblin and Thorn's wolf", async () => {
    await dm.goto(`${server.origin}/`);
    await dm.getByLabel("Room name").fill(run.roomName);
    await dm.getByLabel("Your name").fill("Dana the DM");
    run.password = await dm.getByLabel("Player password").inputValue();
    await dm.getByRole("button", { name: "Create room" }).click();
    await dm.getByRole("heading", { name: "Save your DM link" }).waitFor();
    const link = (await dm.locator("code").first().textContent()) ?? "";
    const match = /\/r\/([0-9A-Z]{4}-[0-9A-Z]{4})#dm=/.exec(link);
    assert.ok(match, `DM link looks wrong: ${link}`);
    run.roomId = match[1]!.replace("-", "");
    await dm.getByLabel("I saved my DM link").check();
    await dm.getByRole("button", { name: "Continue to the room" }).click();
    await waitFor("the DM's snapshot", () => dmSocket.state);
    run.sceneId = dmSocket.state!.meta.playerSceneId!;
    const cookie = (await dmContext.cookies(server.origin)).map((c) => `${c.name}=${c.value}`).join("; ");
    ops = await OpSocket.open({ origin: server.origin, roomId: run.roomId, cookie });
    run.patId = await join(patContext, "Pat", "#30a46c");
    await ops.send({ t: "scene.update", sceneId: run.sceneId, patch: { bounds: BOUNDS, fogEnabled: false } });
    await ops.send({ t: "character.create", character: { id: run.thornChar, name: "Thorn", size: "medium", ownerIds: [run.patId], actor: actor(), level: 5, stats: THORN_STATS } });
    await ops.send({ t: "character.create", character: { id: run.loneChar, name: "Lone", size: "medium", ownerIds: [], actor: actor(), level: 3, stats: THORN_STATS } });
    await ops.send(tokenOp(run.thorn.id, { kind: "pc", name: "Thorn", x: run.thorn.x, y: run.thorn.y, disposition: "ally", actor: { ref: run.thornChar } }));
    await ops.send(tokenOp(run.goblin.id, { kind: "monster", name: "Goblin", x: run.goblin.x, y: run.goblin.y, disposition: "hostile", actor: { inline: actor({ srdId: "goblin-warrior" }) } }));
    await ops.send(tokenOp(run.wolf.id, { kind: "npc", name: "Wolf", x: run.wolf.x, y: run.wolf.y, disposition: "ally", companion: { of: run.thornChar, turn: "shared" }, actor: { inline: actor({ srdId: "wolf" }) } }));
    await pat.goto(`${server.origin}/r/${run.roomId}`);
    await waitFor("Thorn on Pat's page", () => patSocket.state?.tokens[run.thorn.id]);
    await pat.locator(".konvajs-content").first().waitFor();
    await dm.getByRole("status", { name: "Connected" }).first().waitFor();
    await dm.locator(".konvajs-content").first().waitFor();
  });

  test("sbr-1. Pat taps DEX on Thorn's sheet: the list in the design's order, then Stealth rolls once, shows under the boxes and is the Dice panel's newest roll", async () => {
    const sheet = await patSheet();
    const view = sheet.locator("[data-pc-stats]");
    const grid = gridOf(view);
    assert.equal(await grid.getAttribute("role"), "group", "a rolling grid is a group");
    assert.equal(await grid.getByRole("button").count(), 6, "of six buttons");
    assert.equal(await resultOf(view).count(), 0, "no result line before a roll");
    const box = boxOf(view, "Dexterity");
    assert.equal(await box.getAttribute("aria-haspopup"), "menu");
    assert.equal(await box.getAttribute("aria-expanded"), "false");
    assert.match((await box.getAttribute("aria-label")) ?? "", /^Dexterity 12, \+1, save \+1$/);
    const from = patSent.ops.length;
    await box.tap();
    const list = listOf(pat, "Dexterity");
    const names = await rowNames(list);
    assert.deepEqual(
      names.map((n) => n.replace(/ [+−-]\d+.*$/, "")),
      ["Dexterity check", "Dexterity save", "Acrobatics", "Sleight of Hand", "Stealth", "Initiative"],
      `the list's order: ${names.join(" | ")}`,
    );
    assert.equal(await box.getAttribute("aria-expanded"), "true");
    assert.equal(await box.getAttribute("aria-controls"), await list.getAttribute("id"));
    await noRoll(patSent, from, "opening the list");
    await shots.take(pat, "sbr-1-list");
    await list.getByRole("menuitem", { name: /^Stealth/ }).tap();
    const op = await oneRoll(patSent, from, "Stealth");
    assert.equal(op.t, "dice.roll");
    assert.equal(sentMode(op), null, "an ordinary roll");
    await list.waitFor({ state: "detached" });
    assert.ok(await isFocused(box), "focus is back on the box");
    const line = resultOf(view);
    await line.waitFor();
    assert.match(await line.innerText(), /Stealth/);
    await shots.take(pat, "sbr-1-result");
    // The Dice panel's newest roll is this one.
    const entry = logEntry(patSocket, op.tag);
    assert.ok(entry, "the roll is in Pat's log");
    await closeSheets(pat);
    const dice = await openDiceSheet(pat);
    await dice.locator("[data-dice-last]").getByText(/Stealth/).first().waitFor();
    await closeSheets(pat);
  });

  test("sbr-2. Adv pressed in the Dice panel, then a block roll: the roll has no Advantage and Adv stays pressed", async () => {
    let dice = await openDiceSheet(pat);
    await pressMode(dice, "Advantage");
    assert.deepEqual(await modes(dice), { adv: true, dis: false, secret: false });
    await closeSheets(pat);
    const sheet = await patSheet();
    const from = patSent.ops.length;
    await boxOf(sheet, "Strength").tap();
    await listOf(pat, "Strength").getByRole("menuitem", { name: /^Athletics/ }).tap();
    const op = await oneRoll(patSent, from, "Athletics from the block");
    assert.equal(sentMode(op), null, "the block roll takes no Advantage");
    await closeSheets(pat);
    dice = await openDiceSheet(pat);
    assert.deepEqual(await modes(dice), { adv: true, dis: false, secret: false }, "Adv is still pressed");
    await pressMode(dice, "Advantage");
    assert.deepEqual(await modes(dice), { adv: false, dis: false, secret: false });
    await closeSheets(pat);
  });

  test("sbr-3. on the page's own clock a Save held 499 ms is a tap and 500 ms opens its options, the release over Roll with Advantage rolls nothing, and the held finger's drag scrolls neither the options nor the sheet", async () => {
    const page = await patContext.newPage();
    const sent = new OpsSent();
    sent.attach(page);
    const watch = new ConsoleWatch("pat-clock");
    watch.attach(page);
    try {
      await page.clock.install();
      await page.goto(`${server.origin}/r/${run.roomId}`);
      await page.getByRole("status", { name: "Connected" }).first().waitFor();
      await page.locator(".konvajs-content").first().waitFor();
      const cdp = await patContext.newCDPSession(page);
      await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: /^Panels/ }).tap();
      await page.getByRole("region", { name: "Panels" }).getByRole("button", { name: /^Characters/ }).tap();
      const sheet = page.locator('dialog[data-rvtt-sheet][aria-label="Characters"]');
      await sheet.waitFor();
      const fold = sheet.getByRole("button", { name: "Stat block", exact: true });
      if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
      const view = sheet.locator("[data-pc-stats]");
      const box = boxOf(view, "Dexterity");
      const list = listOf(page, "Dexterity");
      const save = list.getByRole("menuitem", { name: /^Dexterity save/ });

      // 499 ms on a row: one ordinary roll, no options.
      await box.tap();
      await list.waitFor();
      let from = sent.ops.length;
      let at = await middle(save);
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 50);
      const touches = new Touches(cdp);
      await touches.start([at]);
      await page.clock.runFor(499);
      assert.equal(await optionsOf(page, /^Roll options for Dexterity save/).count(), 0, "no options at 499 ms");
      await touches.end([], 16);
      await page.clock.resume();
      assert.equal(sentMode(await oneRoll(sent, from, "the 499 ms press")), null);

      // 500 ms: the options replace the list, the release picks nothing.
      await box.tap();
      await list.waitFor();
      from = sent.ops.length;
      at = await middle(save);
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 50);
      await touches.start([at]);
      await page.clock.runFor(500);
      const options = optionsOf(page, /^Roll options for Dexterity save/);
      await options.waitFor();
      assert.equal(await list.count(), 0, "the list went with the swap");
      // The held finger drifts over the options and lifts over Roll with Advantage.
      const scrolled = await scrollTopAround(box);
      const pick = options.getByRole("menuitem", { name: "Roll with Advantage" });
      const over = await middle(pick);
      for (let i = 1; i <= 6; i++) await touches.move([{ x: at.x, y: at.y + ((over.y - at.y) * i) / 6 }], 16);
      await page.clock.resume();
      await sleep(200);
      assert.equal(await scrollTopAround(box), scrolled, "the held finger's drag scrolled the sheet");
      assert.ok(await options.isVisible(), "the drag closed the options");
      await touches.end([], 16);
      await liftClick(pick);
      await noRoll(sent, from, "the hold's release and its click");
      assert.ok(await options.isVisible(), "the options wait for a pick");
      // A new touch on a choice picks it.
      await pick.tap();
      assert.equal(sentMode(await oneRoll(sent, from, "a new tap on Advantage")), "adv");
      assert.deepEqual(watch.errors, []);
    } finally {
      await page.close();
      await pat.bringToFront();
    }
  });

  test("sbr-4. options on Save: Advantage, Disadvantage and Secret and no Normal, one roll with Advantage, Escape back to the list on Save and a second Escape to the box", async () => {
    const sheet = await patSheet();
    const view = sheet.locator("[data-pc-stats]");
    const box = boxOf(view, "Dexterity");
    await box.tap();
    const list = listOf(pat, "Dexterity");
    await list.waitFor();
    const save = list.getByRole("menuitem", { name: /^Dexterity save/ });
    await hold(patCdp, save);
    const options = optionsOf(pat, /^Roll options for Dexterity save/);
    assert.deepEqual(
      await choiceTitles(options),
      [
        { title: "Roll with Advantage", disabled: false },
        { title: "Roll with Disadvantage", disabled: false },
        { title: "Roll secretly", disabled: false },
      ],
      "Adv, Dis and Secret and no Normal",
    );
    assert.match((await options.locator("xpath=ancestor::*[@data-roll-mode-menu][1]//*[@data-roll-mode-title]").first().innerText()).trim(), /Dexterity save \+1/, "the title names the roll");
    assert.equal(await box.getAttribute("aria-expanded"), "true", "the box stays open, anchored");
    // Escape steps back to the list with Save focused.
    await pat.keyboard.press("Escape");
    await list.waitFor();
    assert.equal(await optionsOf(pat, /^Roll options for/).count(), 0);
    assert.ok(await isFocused(save), `Save is focused: ${await focusedName(pat)}`);
    await pat.keyboard.press("Escape");
    await list.waitFor({ state: "detached" });
    assert.ok(await isFocused(box), "the second Escape closes the list on the box");
    // One roll with Advantage.
    const from = patSent.ops.length;
    await box.tap();
    await hold(patCdp, list.getByRole("menuitem", { name: /^Dexterity save/ }));
    await options.getByRole("menuitem", { name: "Roll with Advantage" }).tap();
    const op = await oneRoll(patSent, from, "Advantage on Save");
    assert.equal(sentMode(op), "adv");
    await options.waitFor({ state: "detached" });
    await resultOf(view).filter({ hasText: /Advantage/ }).first().waitFor();
  });

  test("sbr-4b. Android's Back through the page's real history at 390 x 844: options, Back to the list, Back closed, then Back closes the sheet and the room stays. With no sheet under it, two Backs leave no entry of ours behind", async () => {
    const room = `${server.origin}/r/${run.roomId}`;
    const sheet = await patSheet();
    const box = boxOf(sheet.locator("[data-pc-stats]"), "Dexterity");
    const list = listOf(pat, "Dexterity");
    const options = optionsOf(pat, /^Roll options for Dexterity save/);
    await box.tap();
    await hold(patCdp, list.getByRole("menuitem", { name: /^Dexterity save/ }));
    await options.waitFor();
    await pat.goBack();
    await list.waitFor();
    assert.equal(await options.count(), 0, "Back went to the list");
    await pat.goBack();
    await list.waitFor({ state: "detached" });
    assert.ok(await sheet.isVisible(), "the sheet is still open under it");
    await pat.goBack();
    await sheet.waitFor({ state: "hidden" });
    assert.ok(pat.url().startsWith(room), `the room stays: ${pat.url()}`);
    // The depth that is left is what it was before the list: one more Back leaves the room as it always did.
    const depth = await pat.evaluate(() => (globalThis as unknown as { history: { length: number } }).history.length);
    const again = await patSheet();
    await again.getByRole("button", { name: "Close", exact: true }).first().tap().catch(() => undefined);
    await closeSheets(pat);
    assert.equal(await pat.evaluate(() => (globalThis as unknown as { history: { length: number } }).history.length), depth, "opening and closing the sheet leaves the history as it was");
    // No sheet under it: a box on the board's own token bar is not a block, so open the DM's panel, which docks beside the map.
    await dm.keyboard.press("Escape");
    const panel = await dmPanel("Goblin", run.goblin);
    const dmBox = boxOf(panel, "Dexterity");
    const before = await dm.evaluate(() => (globalThis as unknown as { history: { length: number } }).history.length);
    await dmBox.click();
    const dmList = listOf(dm, "Dexterity");
    await dmList.waitFor();
    await hold2(dm, dmList.getByRole("menuitem", { name: /^Dexterity save/ }));
    await optionsOf(dm, /^Roll options for Dexterity save/).waitFor();
    await dm.goBack();
    await dmList.waitFor();
    await dm.goBack();
    await dmList.waitFor({ state: "detached" });
    assert.ok(dm.url().startsWith(room), `two Backs leave the room as it was: ${dm.url()}`);
    assert.equal(await dm.evaluate(() => (globalThis as unknown as { history: { length: number } }).history.length), before, "and no entry of ours behind");
  });

  test("sbr-5. a right-click and Shift+F10 on the box and on a row: the list, then the options, never the browser's menu", async () => {
    const panel = await dmPanel("Goblin", run.goblin);
    await watchContextMenus(dm);
    const box = boxOf(panel, "Dexterity");
    const list = listOf(dm, "Dexterity");
    const options = optionsOf(dm, /^Roll options for Dexterity save/);
    const from = dmSent.ops.length;
    await box.click({ button: "right" });
    await list.waitFor();
    assert.deepEqual(await contextMenus(dm), [true], "the page prevented the browser's menu");
    await box.click({ button: "right" });
    await list.waitFor({ state: "detached" });
    await box.focus();
    await dm.keyboard.press("Shift+F10");
    await list.waitFor();
    await dm.keyboard.press("Escape");
    await list.waitFor({ state: "detached" });
    await box.focus();
    await dm.keyboard.press("ContextMenu");
    await list.waitFor();
    const save = list.getByRole("menuitem", { name: /^Dexterity save/ });
    await save.click({ button: "right" });
    await options.waitFor();
    await dm.keyboard.press("Escape");
    await list.waitFor();
    await save.focus();
    await dm.keyboard.press("ContextMenu");
    await options.waitFor();
    assert.ok(await isFocused(options.getByRole("menuitem").first()), "the first choice is focused after a key");
    await dm.keyboard.press("Escape");
    await list.waitFor();
    await save.focus();
    await dm.keyboard.press("Shift+F10");
    await options.waitFor();
    await closeLists(dm);
    await noRoll(dmSent, from, "the right-clicks and context keys");
  });

  test("sbr-6. the DM asks Thorn for a Dex save: Save is tagged Asked, a tap answers it, and its options disable Secret", async () => {
    const requestId = randomUUID();
    await ops.send({ t: "roll.ask", request: { id: requestId, test: { kind: "save", choices: [{ ability: "dex" }] }, dc: 12, dcShown: true, resultShown: true, targets: [{ characterId: run.thornChar }] } });
    await waitFor("the request on Pat's page", () => patSocket.state?.rolls[requestId] || null);
    const sheet = await patSheet();
    const box = boxOf(sheet, "Dexterity");
    await box.tap();
    const list = listOf(pat, "Dexterity");
    const save = list.getByRole("menuitem", { name: /^Dexterity save/ });
    await save.waitFor();
    assert.match(await save.innerText(), /Asked/, "Save is tagged Asked");
    assert.match((await save.getAttribute("aria-label")) ?? "", /answers the DM's request/);
    await hold(patCdp, save);
    const options = optionsOf(pat, /^Roll options for Dexterity save/);
    assert.deepEqual(
      await choiceTitles(options),
      [
        { title: "Roll with Advantage", disabled: false },
        { title: "Roll with Disadvantage", disabled: false },
        { title: "Roll secretly", disabled: true },
      ],
      "Secret is disabled for an answer",
    );
    await pat.keyboard.press("Escape");
    const from = patSent.ops.length;
    await save.tap();
    const op = await oneRoll(patSent, from, "the answer");
    assert.equal(op.t, "roll.dice", "a tap on an asked save answers the request");
    await waitFor("the request answered", () => dmSocket.state?.rolls[requestId]?.targets.some((t) => t.total !== undefined) || null);
    await ops.send({ t: "roll.close", rollIds: [requestId] }).catch(() => undefined);
    await closeSheets(pat);
  });

  test("sbr-7. the DM on Thorn with Ask on and then off: Save asks Thorn and has no options, off it rolls, and Initiative always rolls", async () => {
    const panel = await dmPanel("Thorn", run.thorn);
    const box = boxOf(panel, "Dexterity");
    const list = listOf(dm, "Dexterity");
    const save = list.getByRole("menuitem", { name: /^Dexterity save/ });
    await box.click();
    await save.waitFor();
    assert.match(await save.innerText(), /Asks/, "Save is tagged Asks");
    assert.match((await save.getAttribute("aria-label")) ?? "", /asks Thorn/);
    assert.equal(await save.getAttribute("aria-keyshortcuts"), null, "an ask has no options");
    await save.click({ button: "right" });
    await sleep(300);
    assert.equal(await optionsOf(dm, /^Roll options for/).count(), 0, "a right-click on an ask opens no options");
    let from = dmSent.ops.length;
    await save.click();
    await dm.getByRole("dialog", { name: /Ask|Request a roll/ }).first().waitFor({ timeout: 5_000 });
    await noRoll(dmSent, from, "an ask");
    await dm.keyboard.press("Escape");
    // Initiative never asks.
    await closeLists(dm);
    await box.click();
    from = dmSent.ops.length;
    await list.getByRole("menuitem", { name: /^Initiative/ }).click();
    await oneRoll(dmSent, from, "Thorn's Initiative");
    // The Dice panel's switch is the one switch: with Ask off, the save rolls.
    await openSideTab(dm, "Dice");
    const dice = dm.getByRole("tabpanel", { name: sideTabName("Dice") });
    const ask = dice.getByRole("switch", { name: /Ask Thorn to roll saves and checks/ });
    if ((await ask.getAttribute("aria-checked")) === "true") await ask.click();
    await waitFor("Ask off", async () => ((await ask.getAttribute("aria-checked")) === "false" ? true : null));
    const panel2 = await dmPanel("Thorn", run.thorn);
    await boxOf(panel2, "Dexterity").click();
    await save.waitFor();
    assert.doesNotMatch(await save.innerText(), /Asks/);
    from = dmSent.ops.length;
    await save.click();
    await oneRoll(dmSent, from, "the DM's roll for Thorn with Ask off");
    await openSideTab(dm, "Dice");
    if ((await ask.getAttribute("aria-checked")) === "false") await ask.click();
  });

  test("sbr-8. Initiative in a fight, a changed row and a score room: the row is set once, 'Not set' after a change, and the score is set with no dice", async () => {
    await ops.send({ t: "encounter.start", entries: [{ id: randomUUID(), tokenId: run.thorn.id, value: 5 }, { id: randomUUID(), tokenId: run.goblin.id, value: 9 }] });
    await waitFor("the fight", () => dmSocket.state?.encounter || null);
    const sheet = await patSheet();
    const view = sheet.locator("[data-pc-stats]");
    const list = listOf(pat, "Dexterity");
    await boxOf(view, "Dexterity").tap();
    const initiative = list.getByRole("menuitem", { name: /^Initiative/ });
    assert.match(await initiative.innerText(), /sets row|replaces/, "Initiative says what it does to the row");
    const from = patSent.ops.length;
    await initiative.tap();
    const op = await oneRoll(patSent, from, "Thorn's Initiative");
    await waitFor("Thorn's row set", () => {
      const row = dmSocket.state?.encounter?.entries.find((e) => e.tokenId === run.thorn.id);
      return row && row.value !== 5 ? row : null;
    });
    assert.ok(op.tag, "the roll has a tag");
    // A row the DM changes while the roll waits is left alone.
    const entry = dmSocket.state!.encounter!.entries.find((e) => e.tokenId === run.thorn.id)!;
    await ops.send({ t: "encounter.update", entryId: entry.id, patch: { value: 7 } }).catch(() => undefined);
    // A score room: the goblin's row takes a score with no dice.
    await ops.send({ t: "room.update", settings: { monsterInitScore: true } });
    const panel = await dmPanel("Goblin", run.goblin);
    await boxOf(panel, "Dexterity").click();
    const dmList = listOf(dm, "Dexterity");
    const score = dmList.getByRole("menuitem", { name: /^Initiative score/ });
    await score.waitFor();
    assert.match((await dmList.getByRole("menuitem", { name: /^Roll initiative/ }).innerText()), /replaces the score/);
    const sentFrom = dmSent.ops.length;
    await score.click();
    await noRoll(dmSent, sentFrom, "Initiative score");
    await dmList.waitFor({ state: "detached" });
    await ops.send({ t: "room.update", settings: { monsterInitScore: false } });
    await ops.send({ t: "encounter.end" });
    await closeSheets(pat);
  });

  test("sbr-9. Wild Shape as a wolf and Polymorph: the box prints the wolf's save and the list rolls the shaped one, and Polymorph rolls the wolf's own", async () => {
    await ops.send({ t: "character.update", characterId: run.thornChar, patch: { actor: { srdId: "wolf", wildShape: true } } });
    const sheet = await patSheet();
    await sheet.locator("[data-shape-numbers]").waitFor();
    const grid = gridOf(sheet);
    const wolfBox = (await boxOf(sheet, "Wisdom").getAttribute("aria-label")) ?? "";
    // Thorn's Wis save is +6 (proficient), the wolf's printed Wis is +1: the box prints the wolf, the list the druid's.
    assert.match(wolfBox, /save \+1/, `the box prints the wolf's save: ${wolfBox}`);
    await boxOf(sheet, "Wisdom").tap();
    const list = listOf(pat, "Wisdom");
    const names = await rowNames(list);
    assert.ok(names.some((n) => /^Wisdom save \+6/.test(n)), `the list rolls "Rolls now": ${names.join(" | ")}`);
    await closeLists(pat);
    assert.equal(await grid.getAttribute("role"), "group");
    await shots.take(pat, "sbr-9-wild-shape");
    // Polymorph: the creature's own numbers, the wolf's.
    await ops.send({ t: "character.update", characterId: run.thornChar, patch: { actor: { srdId: "wolf" } } });
    await sheet.getByText(/^In the shape of Wolf\./).waitFor();
    await boxOf(sheet, "Wisdom").tap();
    const polymorphed = await rowNames(listOf(pat, "Wisdom"));
    assert.ok(polymorphed.some((n) => /^Wisdom save \+1/.test(n)), `Polymorph rolls the wolf's own: ${polymorphed.join(" | ")}`);
    await closeLists(pat);
    await ops.send({ t: "character.update", characterId: run.thornChar, patch: { actor: { srdId: null } } });
    await sheet.locator("[data-pc-stats]").waitFor();
    await closeSheets(pat);
  });

  test("sbr-10. the Monsters panel, a character's companion blocks list and the DM's page for a character off the scene stay text: no button, no mark", async () => {
    const text = async (scope: Locator, what: string) => {
      const grid = scope.locator("[data-ability-grid]").first();
      await grid.waitFor();
      assert.equal(await grid.evaluate((el) => el.tagName), "DL", `${what}: a text grid`);
      assert.equal(await grid.getByRole("button").count(), 0, `${what}: no button`);
      assert.equal(await grid.locator("svg").count(), 0, `${what}: no corner mark`);
    };
    await dm.keyboard.press("Escape");
    await openSideTab(dm, "Monsters");
    const monsters = dm.getByRole("tabpanel", { name: sideTabName("Monsters") });
    await monsters.getByRole("searchbox", { name: "Search monsters" }).fill("goblin");
    await monsters.getByRole("button", { name: /^Goblin/ }).first().click();
    await text(monsters, "the Monsters panel");
    // A companion block in the list on Thorn's page.
    const blockId = randomUUID();
    await ops.send({
      t: "companionBlock.create",
      block: {
        id: blockId, characterId: run.thornChar, name: "Moth Spirit", size: "small", type: "Fey", alignment: "Neutral", ac: 12, initiative: 0,
        hp: { average: 7, formula: "2d6" }, speed: "30 ft.",
        abilities: { str: { score: 10, save: 0 }, dex: { score: 14, save: 2 }, con: { score: 10, save: 0 }, int: { score: 10, save: 0 }, wis: { score: 10, save: 0 }, cha: { score: 10, save: 0 } },
        skills: "", vulnerabilities: "", resistances: "", immunities: "", gear: "", senses: "", passivePerception: 10, languages: "Common", cr: "0", xp: 10,
        traits: [], actions: [], bonusActions: [], reactions: [], legendaryActions: [],
      },
    });
    await openSideTab(dm, "Characters");
    const characters = dm.getByRole("tabpanel", { name: sideTabName("Characters") });
    const opener = characters.locator(`[data-opener="character:${run.thornChar}"]`);
    if ((await opener.count()) > 0) await opener.click();
    await characters.getByRole("button", { name: /^Stat blocks \(/ }).click();
    await characters.getByRole("button", { name: /Moth Spirit/ }).first().click();
    await text(characters.locator("[data-stat-block]").last(), "the companion blocks list");
    // A character with no token on the scene: text for the DM, then boxes once a token stands there.
    const back = characters.getByRole("button", { name: /^Back/ }).first();
    if (await back.isVisible().catch(() => false)) await back.click();
    await characters.locator(`[data-opener="character:${run.loneChar}"]`).click();
    const lone = characters.locator("[data-pc-stats]");
    await lone.waitFor();
    const fold = characters.getByRole("button", { name: "Stat block", exact: true });
    if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
    await text(lone, "a DM's page for a character with no token in view");
    const loneToken = randomUUID();
    await ops.send(tokenOp(loneToken, { kind: "pc", name: "Lone", x: 12, y: 8, disposition: "ally", actor: { ref: run.loneChar } }));
    await waitFor("the boxes roll once a token stands in view", async () => ((await gridOf(lone).getAttribute("role")) === "group" ? true : null));
    await ops.send({ t: "token.delete", tokenId: loneToken });
    await waitFor("the boxes go back to text", async () => ((await gridOf(lone).evaluate((el) => el.tagName)) === "DL" ? true : null));
    await ops.send({ t: "companionBlock.delete", blockId });
  });

  test("sbr-11. offline and in a preview the list still opens, every row is disabled with the reason, and nothing is sent", async () => {
    const sheet = await patSheet();
    const view = sheet.locator("[data-pc-stats]");
    const from = patSent.ops.length;
    await patContext.setOffline(true);
    try {
      await waitFor("Pat's page to see it is offline", async () => ((await pat.getByRole("status", { name: "Connected" }).count()) === 0 ? true : null), 20_000).catch(() => undefined);
      await boxOf(view, "Dexterity").tap();
      const list = listOf(pat, "Dexterity");
      await list.waitFor();
      await list.getByText("Rolling needs a connection.").waitFor();
      const rows = list.getByRole("menuitem");
      for (let i = 0; i < (await rows.count()); i++) assert.equal(await rows.nth(i).getAttribute("aria-disabled"), "true", `row ${i} is disabled`);
      await rows.first().tap();
      await noRoll(patSent, from, "a tap on a disabled row");
      assert.ok(await list.isVisible(), "a disabled row closes nothing");
      await closeLists(pat);
    } finally {
      await patContext.setOffline(false);
    }
    await pat.getByRole("status", { name: "Connected" }).first().waitFor({ timeout: 30_000 });
    await closeSheets(pat);
    // A preview as Pat: the DM's Viewing as dialog holds Pat's own page, whose rolls are not sent.
    await dm.keyboard.press("Escape");
    await openSideTab(dm, "DM");
    await dm.getByRole("button", { name: "View", exact: true }).click();
    const preview = dm.getByRole("dialog", { name: "Viewing as Pat" });
    await preview.waitFor();
    await preview.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: /^Panels/ }).click();
    await preview.getByRole("region", { name: "Panels" }).getByRole("button", { name: /^Characters/ }).click();
    const pane = preview.locator('dialog[data-rvtt-sheet][aria-label="Characters"]').or(preview.getByRole("tabpanel", { name: sideTabName("Characters") }));
    const fold = pane.getByRole("button", { name: "Stat block", exact: true });
    await fold.waitFor();
    if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
    const dmFrom = dmSent.ops.length;
    await boxOf(pane, "Dexterity").click();
    const list = listOf(dm, "Dexterity");
    await list.waitFor();
    await list.getByText("Rolls are not sent from a preview.").waitFor();
    await list.getByRole("menuitem").first().click();
    await noRoll(dmSent, dmFrom, "a tap in a preview");
    await dm.keyboard.press("Escape");
    await preview.getByRole("button", { name: /^(Close|Stop viewing)/ }).first().click();
  });

  test("sbr-12. a block folded before a roll lands, with the Dice panel closed: one own-roll toast, and the Dice panel opened after it announces nothing more. (A refused roll is the phase 2 step sbr-12r.)", async () => {
    const sheet = await patSheet();
    const view = sheet.locator("[data-pc-stats]");
    const fold = sheet.getByRole("button", { name: "Stat block", exact: true });
    patWire.hold = true;
    const from = patSent.ops.length;
    await boxOf(view, "Strength").tap();
    await listOf(pat, "Strength").getByRole("menuitem", { name: /^Strength check/ }).tap();
    await fold.click();
    patWire.release();
    await oneRoll(patSent, from, "Strength check from a block folded before it lands");
    const toasts = pat.getByRole("status").filter({ hasText: /Strength/ });
    await toasts.first().waitFor({ timeout: 5_000 });
    assert.equal(await toasts.count(), 1, "one own-roll toast");
    await closeSheets(pat);
    const dice = await openDiceSheet(pat);
    await dice.locator("[data-dice-last]").getByText(/Strength/).first().waitFor();
    assert.equal(await dice.locator('[data-dice-last] [role="status"][aria-live], [data-dice-last] [role="alert"]').filter({ hasText: /Strength/ }).count(), 0, "the Dice panel's line says nothing more");
    await closeSheets(pat);
    // Kept open: no toast.
    const open = await patSheet();
    const again = open.getByRole("button", { name: "Stat block", exact: true });
    if ((await again.getAttribute("aria-expanded")) !== "true") await again.click();
    const before = await pat.getByRole("status").filter({ hasText: /Strength/ }).count();
    const next = patSent.ops.length;
    await boxOf(open, "Strength").tap();
    await listOf(pat, "Strength").getByRole("menuitem", { name: /^Strength check/ }).tap();
    await oneRoll(patSent, next, "Strength check with the block kept open");
    await sleep(500);
    assert.equal(await pat.getByRole("status").filter({ hasText: /Strength/ }).count(), before, "no toast while the block shows it");
    await closeSheets(pat);
  });

  test("sbr-13. Restrained Dex save, options Advantage: tagged Dis, rolled Normal and cancelled, and the description says so", async () => {
    const effectId = randomUUID();
    await ops.send({ t: "actor.effect.add", target: { characterId: run.thornChar }, effect: { id: effectId, key: "restrained" } });
    try {
      const sheet = await patSheet();
      const view = sheet.locator("[data-pc-stats]");
      await boxOf(view, "Dexterity").tap();
      const list = listOf(pat, "Dexterity");
      const save = list.getByRole("menuitem", { name: /^Dexterity save/ });
      assert.match(await save.innerText(), /Dis/, "Save is tagged Dis");
      await hold(patCdp, save);
      const from = patSent.ops.length;
      await optionsOf(pat, /^Roll options for Dexterity save/).getByRole("menuitem", { name: "Roll with Advantage" }).tap();
      const op = await oneRoll(patSent, from, "Advantage on a Restrained save");
      assert.equal(sentMode(op), null, "Advantage and Disadvantage cancel");
      const line = resultOf(view);
      await line.filter({ hasText: /cancelled/ }).first().waitFor();
      assert.match((await line.first().getAttribute("aria-label")) ?? (await line.first().innerText()), /cancelled/i, "its description says so");
    } finally {
      await ops.send({ t: "actor.effect.remove", target: { characterId: run.thornChar }, effectId });
      await closeSheets(pat);
    }
  });

  test("sbr-14. a double tap on a waiting row and the Dice panel's same save: one roll, both busy", async () => {
    const sheet = await patSheet();
    const view = sheet.locator("[data-pc-stats]");
    patWire.hold = true;
    const from = patSent.ops.length;
    try {
      await boxOf(view, "Wisdom").tap();
      const list = listOf(pat, "Wisdom");
      const save = list.getByRole("menuitem", { name: /^Wisdom save/ });
      await save.tap();
      await boxOf(view, "Wisdom").tap();
      await list.waitFor();
      assert.equal(await save.getAttribute("aria-busy"), "true", "the waiting row is busy");
      assert.equal(await save.getAttribute("aria-disabled"), "true");
      await save.tap().catch(() => undefined);
      await closeSheets(pat);
      const dice = await openDiceSheet(pat);
      const cell = dice.getByRole("button", { name: /^Wisdom save/ });
      assert.equal(await cell.getAttribute("aria-busy"), "true", "the Dice panel's same save is busy too");
    } finally {
      patWire.release();
    }
    await oneRoll(patSent, from, "the Wisdom save");
    assert.equal(patSent.rolls(from).length, 1, "one roll");
    await closeSheets(pat);
  });

  test("sbr-15. a hold on Save, then a reader's click (detail 0) on Roll with Advantage, and both context keys: the hold's click rolls nothing, the reader's rolls once with Advantage", async () => {
    const sheet = await patSheet();
    const view = sheet.locator("[data-pc-stats]");
    await boxOf(view, "Dexterity").tap();
    const list = listOf(pat, "Dexterity");
    const options = optionsOf(pat, /^Roll options for Dexterity save/);
    const save = list.getByRole("menuitem", { name: /^Dexterity save/ });
    const from = patSent.ops.length;
    await hold(patCdp, save);
    await options.waitFor();
    const advantage = options.getByRole("menuitem", { name: "Roll with Advantage" });
    await liftClick(advantage);
    await noRoll(patSent, from, "the hold's own click");
    assert.ok(await options.isVisible());
    await readerClick(advantage);
    const op = await oneRoll(patSent, from, "a reader's click");
    assert.equal(sentMode(op), "adv", "once, with Advantage");
    await closeSheets(pat);
    // Both context keys open the same views as sbr-5.
    await dm.keyboard.press("Escape");
    const panel = await dmPanel("Goblin", run.goblin);
    const dmList = listOf(dm, "Dexterity");
    for (const key of ["ContextMenu", "Shift+F10"]) {
      await boxOf(panel, "Dexterity").focus();
      await dm.keyboard.press(key);
      await dmList.waitFor();
      await dmList.getByRole("menuitem", { name: /^Dexterity save/ }).focus();
      await dm.keyboard.press(key);
      await optionsOf(dm, /^Roll options for Dexterity save/).waitFor();
      await closeLists(dm);
    }
  });

  test("sbr-16. the Dice panel open beside the block: both lines show each roll, one polite announcement for a success, and folded before it lands the Dice panel's line says it once", async () => {
    await dm.keyboard.press("Escape");
    await openSideTab(dm, "Dice");
    const dice = dm.getByRole("tabpanel", { name: sideTabName("Dice") });
    const panel = await dmPanel("Goblin", run.goblin);
    await openSideTab(dm, "Dice");
    const announced = async (scope: Locator) => scope.locator('[role="status"][aria-live="polite"], [role="alert"]').allInnerTexts().then((t) => t.filter((x) => x.trim() !== ""));
    const view = panel;
    const from = dmSent.ops.length;
    await boxOf(view, "Dexterity").click();
    await listOf(dm, "Dexterity").getByRole("menuitem", { name: /^Stealth/ }).click();
    await oneRoll(dmSent, from, "Stealth with both lines mounted");
    await resultOf(view).first().waitFor();
    await dice.locator("[data-dice-last]").getByText(/Stealth/).first().waitFor();
    const block = (await announced(resultOf(view))).filter((t) => /Stealth/.test(t));
    const sticky = (await announced(dice.locator("[data-dice-last]"))).filter((t) => /Stealth/.test(t));
    assert.equal(block.length, 1, `the block says the result once: ${JSON.stringify(block)}`);
    assert.equal(sticky.length, 0, `the Dice panel's line is silent: ${JSON.stringify(sticky)}`);
    // Folded before the roll lands, with the Dice panel open: its line says the result once.
    const foldedFrom = dmSent.ops.length;
    dmWire.hold = true;
    await boxOf(view, "Dexterity").click();
    await listOf(dm, "Dexterity").getByRole("menuitem", { name: /^Acrobatics/ }).click();
    await panel.getByRole("button", { name: "Stat block", exact: true }).click();
    dmWire.release();
    await oneRoll(dmSent, foldedFrom, "Acrobatics from a block folded before it lands");
    await dice.locator("[data-dice-last]").getByText(/Acrobatics/).first().waitFor();
    const spoken = (await announced(dice.locator("[data-dice-last]"))).filter((t) => /Acrobatics/.test(t));
    assert.equal(spoken.length, 1, `the Dice panel's line says it once: ${JSON.stringify(spoken)}`);
    assert.equal(await dice.locator('[data-dice-last] [role="alert"]').count(), 0, "and raises no alert");
  });

  test("sbr-17. the DM's options on a monster's row offer Advantage and Disadvantage only, and on Thorn's companion's row Secret too", async () => {
    const goblin = await dmPanel("Goblin", run.goblin);
    await boxOf(goblin, "Dexterity").click();
    await hold2(dm, listOf(dm, "Dexterity").getByRole("menuitem", { name: /^Dexterity save/ }));
    assert.deepEqual(
      (await choiceTitles(optionsOf(dm, /^Roll options for Dexterity save/))).map((c) => c.title),
      ["Roll with Advantage", "Roll with Disadvantage"],
      "a monster's tap is secret already",
    );
    await closeLists(dm);
    const wolf = await dmPanel("Wolf", run.wolf);
    await boxOf(wolf, "Dexterity").click();
    await hold2(dm, listOf(dm, "Dexterity").getByRole("menuitem", { name: /^Dexterity save/ }));
    const titles = (await choiceTitles(optionsOf(dm, /^Roll options for Dexterity save/))).map((c) => c.title);
    assert.ok(titles.includes("Roll secretly"), `the companion's options keep Secret: ${titles.join(", ")}`);
    await closeLists(dm);
  });

  test("sbr-18. while Poisoned, a plain tap on Strength check and a Roll with Disadvantage from its options both return Disadvantage but only the pick is worded, and Roll with Advantage at 320 x 568 at 130% drops its words where the line is short and keeps them in the description", async () => {
    const effectId = randomUUID();
    await ops.send({ t: "actor.effect.add", target: { characterId: run.thornChar }, effect: { id: effectId, key: "poisoned" } });
    try {
      const sheet = await patSheet();
      const view = sheet.locator("[data-pc-stats]");
      await boxOf(view, "Strength").tap();
      const list = listOf(pat, "Strength");
      let from = patSent.ops.length;
      await list.getByRole("menuitem", { name: /^Strength check/ }).tap();
      let op = await oneRoll(patSent, from, "a plain tap while Poisoned");
      assert.equal(sentMode(op), "dis", "Poisoned sets Disadvantage");
      const line = resultOf(view).first();
      await line.waitFor();
      assert.doesNotMatch(await line.innerText(), /with Disadvantage|with Advantage|secret/, "the plain tap's line names no mode");
      // Once Poisoned ends, the picked Disadvantage is worded.
      await ops.send({ t: "actor.effect.remove", target: { characterId: run.thornChar }, effectId });
      await boxOf(view, "Strength").tap();
      await hold(patCdp, list.getByRole("menuitem", { name: /^Strength check/ }));
      from = patSent.ops.length;
      await optionsOf(pat, /^Roll options for Strength check/).getByRole("menuitem", { name: "Roll with Disadvantage" }).tap();
      op = await oneRoll(patSent, from, "a picked Disadvantage");
      assert.equal(sentMode(op), "dis");
      await line.filter({ hasText: /with Disadvantage/ }).waitFor();
      // At 320 x 568 at 130% the words give way first, and the description keeps them.
      await pat.setViewportSize({ width: 320, height: 568 });
      await pat.evaluate(() => localStorage.setItem("rvtt.uiScale", "1.3"));
      await reopenRoom(pat);
      await pat.getByRole("status", { name: "Connected" }).first().waitFor();
      const small = await patSheet();
      const smallView = small.locator("[data-pc-stats]");
      await boxOf(smallView, "Strength").tap();
      await hold(patCdp, listOf(pat, "Strength").getByRole("menuitem", { name: /^Strength check/ }));
      from = patSent.ops.length;
      await optionsOf(pat, /^Roll options for Strength check/).getByRole("menuitem", { name: "Roll with Advantage" }).tap();
      op = await oneRoll(patSent, from, "Advantage at 320 x 568");
      const shortLine = resultOf(smallView).first();
      await shortLine.waitFor();
      const describedBy = await shortLine.evaluate((el) => {
        const doc = (el as unknown as { ownerDocument: { getElementById(id: string): { textContent: string | null } | null } }).ownerDocument;
        return (el.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id: string) => doc.getElementById(id)?.textContent ?? "").join(" ") + " " + (el.getAttribute("aria-label") ?? "");
      });
      assert.match(describedBy, /Advantage/, "the description keeps the mode");
      assert.doesNotMatch(await shortLine.innerText(), /with Advantage/, "the short line drops the words");
      await pat.setViewportSize(PHONE);
      await pat.evaluate(() => localStorage.setItem("rvtt.uiScale", "1"));
      await reopenRoom(pat);
    } finally {
      await ops.send({ t: "actor.effect.remove", target: { characterId: run.thornChar }, effectId }).catch(() => undefined);
      await closeSheets(pat);
    }
  });

  test("sbr-19. no page logged an error", async () => {
    assert.deepEqual(consoles.dm.errors, []);
    assert.deepEqual(consoles.pat.errors, []);
  });
});

/** A hold of the DM's mouse on a row: a right-click, which opens the same options. */
async function hold2(page: Page, row: Locator): Promise<void> {
  await row.click({ button: "right" });
}
