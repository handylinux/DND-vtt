import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import { checkLimits } from "#shared/limits.ts";
import { FREE_WALL_LATTICE } from "#shared/model.ts";
import { holds, mutatedJson } from "#shared/propertyTestutil.ts";
import { clientOpSchema } from "#shared/protocol.ts";
import { splitCheck } from "#shared/rules/walls.ts";
import { apply, room } from "#shared/testutil.ts";
import { importOps, importScene, placeMap } from "./batch.ts";
import { convertUvtt, type ImportOptions } from "./convert.ts";
import { MAX_FILE_LIGHTS, MAX_POINTS, MAX_POLYLINES, MAX_PORTALS, SLACK_SQUARES } from "./limits.ts";
import { readUvtt, type Point, type UvttMap } from "./schema.ts";
import { uvttFile, type FileInput } from "./synthetic.ts";

/**
 * Property tests of the Universal VTT import (docs/design/design-v1-maps-vision.md
 * 3.1). The file is untrusted: any exporter, any edit, any corruption. The
 * reader must turn every JSON value into a map or one of its sentences, and
 * every map it reads must convert into ops the server takes whole, since
 * an import refused partway would leave half a scene. schema.test.ts and
 * convert.test.ts pin the cases by hand.
 */

const OPTIONS = fc.record({ objects: fc.boolean(), portals: fc.constantFrom<ImportOptions["portals"]>("window", "open"), feetPerCell: fc.constantFrom(5, 10) });

/** A coordinate as exporters write them: on the grid, on a half or a tenth, or anywhere, and now and then past the map's slack. */
function coordinate(from: number, to: number): fc.Arbitrary<number> {
  const span = to - from;
  return fc.oneof(
    fc.integer({ min: Math.ceil(from), max: Math.floor(to) }),
    fc.integer({ min: 0, max: Math.floor(span * 10) }).map((n) => from + n / 10),
    fc.double({ min: from, max: to, noNaN: true }),
    fc.double({ min: from - 3, max: to + 3, noNaN: true }),
  );
}

/** A file in the shape Dungeondraft writes, small enough that a conversion takes a few milliseconds. */
const fileInput: fc.Arbitrary<FileInput> = fc
  .record({
    origin: fc.oneof(fc.constant({ x: 0, y: 0 }), fc.record({ x: fc.double({ min: -5, max: 5, noNaN: true }), y: fc.double({ min: -5, max: 5, noNaN: true }) })),
    size: fc.record({ x: fc.oneof(fc.integer({ min: 1, max: 24 }), fc.double({ min: 0.5, max: 24, noNaN: true })), y: fc.oneof(fc.integer({ min: 1, max: 24 }), fc.double({ min: 0.5, max: 24, noNaN: true })) }),
    ppg: fc.constantFrom(50, 70, 100, 256),
  })
  .chain(({ origin, size, ppg }) => {
    const x = coordinate(origin.x - SLACK_SQUARES, origin.x + size.x + SLACK_SQUARES);
    const y = coordinate(origin.y - SLACK_SQUARES, origin.y + size.y + SLACK_SQUARES);
    const point = fc.record({ x, y }).map((p): Point => ({ x: p.x, y: p.y }));
    const line = fc.array(point, { minLength: 1, maxLength: 6 });
    return fc.record({
      origin: fc.constant(origin),
      size: fc.constant(size),
      ppg: fc.constant(ppg),
      walls: fc.array(line, { maxLength: 10 }),
      objects: fc.array(line, { maxLength: 4 }),
      portals: fc.array(fc.record({ a: point, b: point, closed: fc.boolean() }).map((p) => ({ a: p.a, b: p.b, closed: p.closed })), { maxLength: 6 }),
      lights: fc.array(fc.record({ at: point, range: fc.oneof(fc.integer({ min: 0, max: 12 }), fc.double({ min: 0, max: 40, noNaN: true })) }).map((l) => ({ at: l.at, range: l.range })), { maxLength: 6 }),
    });
  });

/** Every wall, door and light of a read map lies in its rectangle widened by the slack, and every number is finite. */
function assertReadMap(map: UvttMap): void {
  const x0 = map.origin.x - SLACK_SQUARES;
  const y0 = map.origin.y - SLACK_SQUARES;
  const x1 = map.origin.x + map.size.x + SLACK_SQUARES;
  const y1 = map.origin.y + map.size.y + SLACK_SQUARES;
  const inside = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  assert.ok(map.size.x > 0 && map.size.y > 0 && map.pixelsPerGrid > 0, "the map has a size and a grid");
  assert.ok([map.origin.x, map.origin.y, map.size.x, map.size.y, map.pixelsPerGrid].every(Number.isFinite), "its numbers are finite");
  assert.ok(map.walls.length + map.objects.length <= MAX_POLYLINES && map.portals.length <= MAX_PORTALS && map.lights.length <= MAX_FILE_LIGHTS, "its counts are bounded");
  assert.ok([...map.walls, ...map.objects].reduce((n, line) => n + line.length, 0) <= MAX_POINTS);
  for (const line of [...map.walls, ...map.objects]) for (const p of line) assert.ok(inside(p), `wall point ${JSON.stringify(p)} near the map`);
  for (const portal of map.portals) assert.ok(inside(portal.a) && inside(portal.b), "a door near the map");
  for (const light of map.lights) assert.ok(inside(light.at) && Number.isFinite(light.range) && light.range >= 0, "a light near the map");
  assert.equal(typeof map.image, "string");
}

describe("the Universal VTT import, over untrusted files (property)", () => {
  test("reading any JSON never throws: it is a map with everything near it, or a sentence for the DM", () => {
    holds(
      fc.property(fc.oneof(fc.jsonValue({ maxDepth: 4 }), mutatedJson(fileInput.map((input) => uvttFile(input)))), (raw) => {
        const read = readUvtt(raw);
        if (!read.ok) {
          assert.ok(typeof read.error === "string" && read.error.length > 0, "a refusal has words");
          return;
        }
        assertReadMap(read.map);
        assert.equal(readUvtt(raw, { geometry: false }).ok, true, "a file read whole is read without the geometry check too");
      }),
      3_000,
    );
  });

  test("a map it reads converts to ops the server takes whole, every wall and light inside the scene", () => {
    holds(
      fc.property(fileInput, OPTIONS, (input, options) => {
        const read = readUvtt(uvttFile(input));
        if (!read.ok) return;
        const converted = convertUvtt(read.map, options);
        if (!converted.ok) {
          assert.ok(converted.error.length > 0);
          return;
        }
        const plan = converted.plan;
        const { w, h } = plan.frame;
        for (const e of plan.edges) {
          const [x, y, side] = e.key.split(",");
          const ex = Number(x);
          const ey = Number(y);
          assert.ok(Number.isInteger(ex) && Number.isInteger(ey), `edge ${e.key} on the grid`);
          assert.ok(side === "n" ? ex >= 0 && ex < w && ey >= 0 && ey <= h : side === "w" && ex >= 0 && ex <= w && ey >= 0 && ey < h, `edge ${e.key} inside ${w}x${h}`);
        }
        for (const wall of plan.walls) {
          for (const [px, py] of [wall.a, wall.b]) {
            assert.ok(px >= 0 && px <= w && py >= 0 && py <= h, `free wall end ${px},${py} inside ${w}x${h}`);
            assert.ok(Number.isInteger(px * FREE_WALL_LATTICE) && Number.isInteger(py * FREE_WALL_LATTICE), "free wall ends on the lattice");
          }
        }
        assert.equal(new Set(plan.walls.map((x) => x.id)).size, plan.walls.length, "wall ids are unique");
        for (const light of plan.lights) assert.ok(light.x >= 0 && light.x <= w && light.y >= 0 && light.y <= h, `light ${light.x},${light.y} inside`);

        const map = placeMap(plan, { assetId: "a1", width: w * 70, height: h * 70, fileImageWidth: w * 70 });
        if (!map) return;
        let n = 0;
        const ops = importOps(importScene(plan, map, { id: "imp", name: "Import" }), plan, () => `light-${++n}`);
        let state = room();
        let seq = 1;
        for (const op of ops) {
          const parsed = clientOpSchema.safeParse(op);
          assert.ok(parsed.success, parsed.success ? "" : `${op.t}: ${parsed.error.message}`);
          state = apply(state, parsed.data, undefined, ++seq);
          const limits = checkLimits(state, "imp");
          assert.ok(limits.ok, limits.ok ? "" : limits.message);
        }
        const split = splitCheck(state, "imp");
        assert.ok(split.ok, split.ok ? "" : split.message);
      }),
      1_000,
    );
  });
});
