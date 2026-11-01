import assert from "node:assert/strict";
import { test } from "node:test";
import { cellPxHint, nameGrid } from "./kinds.ts";

test("a cols x rows name suggests the cell size when both axes agree", () => {
  assert.equal(cellPxHint("crypt_30x20.jpg", 3000, 2000), 100);
  assert.equal(cellPxHint("Crypt 30 X 20 final.png", 2100, 1400), 70);
  assert.equal(cellPxHint("road-24×18.webp", 1680, 1260), 70);
  assert.equal(cellPxHint("odd_7x5.png", 1000, 714), 142.86);
});

test("no suggestion when the name has no hint or the axes disagree", () => {
  assert.equal(cellPxHint(undefined, 3000, 2000), undefined);
  assert.equal(cellPxHint("tavern.jpg", 3000, 2000), undefined);
  assert.equal(cellPxHint("crypt_30x20.jpg", 3000, 3000), undefined);
});

test("pixel sizes and out-of-range counts are not cell counts", () => {
  assert.equal(cellPxHint("wallpaper_1920x1080.jpg", 1920, 1080), undefined);
  assert.equal(cellPxHint("big_300x200.jpg", 6000, 4000), undefined);
  assert.equal(cellPxHint("zero_0x10.jpg", 100, 100), undefined);
});

/** A name's hex reading in whole px, since the art's edge is a whole px and the cell size comes out a hundredth off. */
function hexPx(name: string, width: number, height: number) {
  const { hexes } = nameGrid(name, width, height);
  return hexes && { ...(hexes.rows === undefined ? {} : { rows: Math.round(hexes.rows) }), ...(hexes.columns === undefined ? {} : { columns: Math.round(hexes.columns) }) };
}

test("a name's counts are also read as hex rows and hex columns, each by its own lattice (D-261101-190)", () => {
  // 20 x 14 hexes of 70 px: rows are 20.5 hexes wide and 12.41 hexes tall, columns the other way about.
  assert.deepEqual(hexPx("crypt_20x14.jpg", 1435, 869), { rows: 70 });
  assert.deepEqual(hexPx("crypt_20x14.jpg", 1233, 1015), { columns: 70 });
  assert.deepEqual(hexPx("Crypt 30 X 20.png", 2135, 1233), { rows: 70 });
  assert.deepEqual(nameGrid("crypt_20x14.jpg", 1400, 980), { squares: 70 });
  assert.equal(nameGrid("crypt_20x14.jpg", 1435, 869).squares, undefined);
});

test("a hex reading needs both axes within 2%, and the art's exact edge", () => {
  assert.deepEqual(nameGrid("crypt_20x14.jpg", 1435, 900), {});
  assert.deepEqual(nameGrid("crypt_20x14.jpg", 1400, 869), {}, "20 hexes with no half hex for the odd rows is not rows' span");
  assert.deepEqual(hexPx("crypt_20x14.jpg", 1435, Math.round(869 * 1.019)), { rows: 70 });
  assert.deepEqual(nameGrid("big_300x200.jpg", 21000, 12500), {});
  assert.deepEqual(nameGrid("tavern.jpg", 1435, 869), {});
  assert.deepEqual(nameGrid(undefined, 1435, 869), {});
});
