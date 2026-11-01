import "../components/testing/register.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { forgetRoom, readKnownRooms, type KnownRoom, type RoomStanding } from "../lib/knownRooms.ts";

const { Children, createElement, isValidElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { ForgetRoomDialog, KnownRoomRow, knownRoomFacts } = await import("./Home.tsx");
const { Button } = await import("../components/Button.tsx");
const { Dialog } = await import("../components/Dialog.tsx");

type Element = ReactElement<{ children?: ReactNode; style?: CSSProperties; onClick?(): void }>;
function elements(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const el = child as Element;
    return [el, ...elements(el.props.children)];
  });
}

const room: KnownRoom = { roomId: "K7QH2MXA", name: "Tuesday", role: "dm", memberName: "Dana", openedAt: 1 };
const other: KnownRoom = { ...room, roomId: "ABCD2345", name: "One-shot", openedAt: 2 };

describe("forgetting a saved room from Home", () => {
  for (const standing of [null, { kind: "in", role: "dm", memberName: "Dana", roomName: "Tuesday night" }, { kind: "out", roomName: null }, { kind: "unknown" }] satisfies (RoomStanding | null)[]) {
    test(`asks before changing storage when the room is ${standing?.kind ?? "being checked"}`, () => {
      let value = JSON.stringify([room, other]);
      let writes = 0;
      const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; writes++; } };
      // The row starts with its question closed, so a tap on the row or the page alone can never forget.
      const closed = renderToStaticMarkup(createElement(KnownRoomRow, { room, standing, onForget: () => forgetRoom(room.roomId, storage) }));
      assert.doesNotMatch(closed, /Forget this room/);
      assert.match(closed, />Forget</);
      assert.equal(writes, 0);

      let closes = 0;
      const question = ForgetRoomDialog({ name: knownRoomFacts(room, standing).name, onClose: () => closes++, onForget: () => forgetRoom(room.roomId, storage) }) as ReactElement<Parameters<typeof Dialog>[0]>;
      assert.equal(question.type, Dialog, "the question is the app's confirmation dialog");
      assert.equal(question.props.title, "Forget this room?");
      const words = renderToStaticMarkup(createElement("div", null, question.props.children));
      assert.match(words, /Tuesday/);
      assert.match(words, /only removes.*this device(?:'|&#x27;)s list/);
      assert.match(words, /room itself stays/);
      assert.equal(writes, 0, "opening the question changes nothing");
      const buttons = elements(question.props.footer);
      buttons.find((el) => el.props.children === "Cancel")!.props.onClick!();
      question.props.onClose();
      assert.equal(closes, 2, "Cancel and dismissing both close the question");
      assert.equal(writes, 0, "neither forgets the room");
      buttons.find((el) => el.props.children === "Forget room")!.props.onClick!();
      assert.equal(closes, 3, "Forget room closes the question");
      assert.equal(writes, 1);
      assert.deepEqual(readKnownRooms(storage), [other], "only the confirmed room leaves this device's list");
    });
  }
});

describe("a saved room's row", () => {
  test("says the room's standing on this device", () => {
    assert.deepEqual(knownRoomFacts(room, null), { name: "Tuesday", who: "DM, as Dana", status: "Checking…" });
    assert.deepEqual(knownRoomFacts(room, { kind: "in", role: "player", memberName: "Pat", roomName: "Tuesday night" }), { name: "Tuesday night", who: "as Pat", status: null }, "a live standing wins over what was saved");
    assert.match(knownRoomFacts(room, { kind: "out", roomName: "Renamed" }).status ?? "", /Use your DM link/);
    assert.equal(knownRoomFacts(room, { kind: "out", roomName: "Renamed" }).name, "Renamed");
    assert.match(knownRoomFacts({ ...room, role: "player" }, { kind: "out", roomName: null }).status ?? "", /Join again with the password/);
    assert.equal(knownRoomFacts(room, { kind: "unknown" }).status, "Could not check just now.");
    assert.equal(knownRoomFacts({ ...room, name: "  " }, null).name, "Room K7QH-2MXA", "an unnamed room reads by its ID");
  });
});

test("dialog bodies reserve classic scrollbar space only when requested", () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "document");
  const elementBefore = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { body: { nodeType: 1 } } });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: class {} });
  try {
    for (const bodyStyle of [undefined, { scrollbarGutter: "stable" }]) {
      for (const children of ["Short list", Array.from({ length: 100 }, (_, i) => createElement("p", { key: i }, `Creature ${i}`))]) {
        let bodies = 0;
        function Probe() {
          const portal = Dialog({ title: "A dialog", onClose() {}, children, bodyStyle });
          const body = elements(portal.children).find((el) => el.props.style?.overflowY === "auto");
          assert.ok(body, "the shared scrolling body draws");
          assert.equal(body.props.style?.scrollbarGutter, bodyStyle?.scrollbarGutter);
          bodies++;
          return null;
        }
        renderToStaticMarkup(createElement(Probe));
        assert.equal(bodies, 1);
      }
    }
  } finally {
    if (before) Object.defineProperty(globalThis, "document", before);
    else Reflect.deleteProperty(globalThis, "document");
    if (elementBefore) Object.defineProperty(globalThis, "HTMLElement", elementBefore);
    else Reflect.deleteProperty(globalThis, "HTMLElement");
  }
});
