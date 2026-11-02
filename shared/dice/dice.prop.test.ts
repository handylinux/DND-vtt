import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import { LIMITS } from "../limits.ts";
import type { DiceResult } from "../model.ts";
import { holds } from "../propertyTestutil.ts";
import { addDie, diceCount, FORMULA_ERRORS, formatFormula, formulaRange, parseExtra, parseFormula, parseRollText, type AdvantageMode, type DiceTerm, type Formula, type NumberTerm, type Term } from "./formula.ts";
import { rerolled, rolledTerms, rollFormula, totalOf, withDie, withLucky, type Draw } from "./roll.ts";

/**
 * Property tests of the dice grammar and the roller (docs/design/design-v1-dice.md
 * 3 and 4). The Dice field takes any text a player types, and the server
 * reads every formula an op carries, so the parser meets arbitrary strings.
 * formula.test.ts and roll.test.ts pin the cases by hand. These check the
 * rules every input must keep.
 */

const sign = fc.constantFrom<1 | -1>(1, -1);
const sides = fc.oneof(fc.constantFrom(2, 4, 6, 8, 10, 12, 20, 100), fc.integer({ min: 2, max: LIMITS.diceSidesMax }));
const count = fc.oneof(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: LIMITS.dicePerOp }));

const diceTerm: fc.Arbitrary<DiceTerm> = count.chain((n) =>
  fc.record({ sign, sides, keep: fc.option(fc.record({ high: fc.boolean(), n: fc.integer({ min: 1, max: n }) }), { nil: undefined }) }).map(({ sign, sides, keep }) => {
    // Plain objects as the parser builds them: no `keep` key on a term without one, and no record's null prototype.
    const term: DiceTerm = { kind: "dice", sign, count: n, sides };
    if (keep) term.keep = { high: keep.high, n: keep.n };
    return term;
  }),
);
const numberTerm: fc.Arbitrary<NumberTerm> = fc.tuple(sign, fc.integer({ min: 0, max: LIMITS.diceNumberMax })).map(([sign, value]) => ({ kind: "number", sign, value }));
const term: fc.Arbitrary<Term> = fc.oneof(diceTerm, numberTerm);

const withinBounds = (f: Formula) => {
  const dice = diceCount(f);
  return dice >= 1 && dice <= LIMITS.dicePerOp && f.length <= LIMITS.diceTermsPerFormula && formatFormula(f).length <= LIMITS.diceFormulaChars;
};
const anyFormula = fc.oneof(fc.array(term, { minLength: 1, maxLength: 4 }), fc.array(term, { minLength: 1, maxLength: LIMITS.diceTermsPerFormula, size: "max" })).filter(withinBounds);

/**
 * A formula filled to a bound: a positive d20 first, as a D20 Test has, then
 * dice up to exactly 100, or numbers until one more would pass 100
 * characters or 20 parts. Only here does a change that grows a roll meet a
 * bound often enough for the default run to try it.
 */
const atBound: fc.Arbitrary<Formula> = fc.tuple(anyFormula, fc.boolean()).map(([f, byDice]) => {
  const out: Formula = [{ kind: "dice", sign: 1, count: 1, sides: 20 }, ...f.map((t) => (t.kind === "dice" && t.keep ? { ...t, keep: { ...t.keep } } : { ...t }))];
  const thousand: NumberTerm = { kind: "number", sign: 1, value: LIMITS.diceNumberMax };
  if (byDice) {
    const last = out.findLast((t): t is DiceTerm => t.kind === "dice" && t !== out[0]);
    if (last) last.count += Math.max(0, LIMITS.dicePerOp - diceCount(out));
  } else {
    while (withinBounds([...out, thousand])) out.push(thousand);
  }
  return out;
});

/** A formula the grammar accepts: at least one die, and within every bound of 3.2. */
const formula: fc.Arbitrary<Formula> = fc.oneof({ weight: 4, arbitrary: anyFormula }, { weight: 1, arbitrary: atBound }).filter(withinBounds);

/** Mostly what a player types, and now and then something past a bound or beside the grammar. */
const rarely = <T>(common: fc.Arbitrary<T>, rare: fc.Arbitrary<T>) => fc.oneof({ weight: 12, arbitrary: common }, { weight: 1, arbitrary: rare });

/**
 * Text built from the grammar's own pieces, near and past every bound, with
 * now and then one stray character put in, so most of it reads some way into
 * a formula before it is accepted or refused.
 */
const diceText = fc
  .tuple(
    rarely(fc.oneof(fc.constant(""), fc.integer({ min: 1, max: 12 }).map(String)), fc.oneof(fc.integer({ min: 0, max: 120 }).map(String), fc.constantFrom("0", "01", "99999999999999999999"))),
    fc.constantFrom("d", "d", "d", "D"),
    rarely(fc.constantFrom("4", "6", "8", "10", "12", "20", "100", "%"), fc.integer({ min: 0, max: 1200 }).map(String)),
    fc.oneof(
      { weight: 4, arbitrary: fc.constant("") },
      { weight: 1, arbitrary: fc.tuple(rarely(fc.constantFrom("kh", "kl", "dh", "dl", "KH"), fc.constant("k")), rarely(fc.constantFrom("", "1"), fc.integer({ min: 0, max: 120 }).map(String))).map(([k, n]) => k + n) },
    ),
  )
  .map((parts) => parts.join(""));
const numberText = rarely(fc.integer({ min: 0, max: 20 }).map(String), fc.oneof(fc.integer({ min: 0, max: 1200 }).map(String), fc.constantFrom("00", "1e3")));
const separator = rarely(fc.constantFrom("+", "-", "\u2212", " + ", " - "), fc.constantFrom(" ", "", "++", "\t-"));
const word = fc.constantFrom("adv", "dis", "Advantage", "DIS", "fire", "x", "+3", "d6", "\t");
const grammarText = fc
  .tuple(
    fc.option(fc.constantFrom("+", "-", "\u2212", " "), { nil: "", freq: 4 }),
    fc.oneof(fc.array(fc.oneof({ weight: 3, arbitrary: diceText }, { weight: 2, arbitrary: numberText }), { minLength: 1, maxLength: 3 }), fc.array(fc.oneof(diceText, numberText), { minLength: 1, maxLength: 22, size: "max" })),
    fc.array(separator, { minLength: 22, maxLength: 22 }),
    fc.option(fc.array(word, { minLength: 1, maxLength: 4 }), { nil: [], freq: 2 }),
    fc.oneof({ weight: 3, arbitrary: fc.constant(undefined) }, { weight: 1, arbitrary: fc.tuple(fc.nat(), fc.constantFrom("x", "%", "\n", "\u2028", "\u0000", ".", "(", "+")) }),
  )
  .map(([lead, terms, seps, words, stray]) => {
    let text = lead + terms.map((t, i) => (i === 0 ? t : seps[i]! + t)).join("");
    if (words.length > 0) text += ` ${words.join(" ")}`;
    if (!stray) return text;
    // One stray character anywhere: a dangling sign at the end, a typo glued to a term, a line break.
    const at = stray[0] % (text.length + 1);
    return text.slice(0, at) + stray[1] + text.slice(at);
  });

/** Any text at all, weighted toward text that reads partly as dice. */
const anyText = fc.oneof(
  { weight: 4, arbitrary: grammarText },
  { weight: 2, arbitrary: formula.map((f) => formatFormula(f)) },
  { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 80 }) },
  { weight: 1, arbitrary: fc.string({ maxLength: 120 }) },
);

/** Every bound of 3.2 on a formula the parser handed back. */
function assertWithinGrammar(f: Formula, needsDie: boolean): void {
  assert.ok(f.length >= 1 && f.length <= LIMITS.diceTermsPerFormula, `1 to ${LIMITS.diceTermsPerFormula} terms`);
  for (const t of f) {
    assert.ok(t.sign === 1 || t.sign === -1, "a sign is 1 or -1");
    if (t.kind === "number") {
      assert.ok(Number.isInteger(t.value) && t.value >= 0 && t.value <= LIMITS.diceNumberMax, `a number is 0 to ${LIMITS.diceNumberMax}`);
      continue;
    }
    assert.ok(Number.isInteger(t.count) && t.count >= 1 && t.count <= LIMITS.dicePerOp, `a term rolls 1 to ${LIMITS.dicePerOp} dice`);
    assert.ok(Number.isInteger(t.sides) && t.sides >= 2 && t.sides <= LIMITS.diceSidesMax, `a die has 2 to ${LIMITS.diceSidesMax} sides`);
    if (t.keep) assert.ok(Number.isInteger(t.keep.n) && t.keep.n >= 1 && t.keep.n <= t.count, "a keep keeps 1 to all of its dice");
  }
  const dice = diceCount(f);
  assert.ok(dice <= LIMITS.dicePerOp && (!needsDie || dice >= 1), "the whole formula rolls at most 100 dice, and at least one where it must");
  assert.ok(formatFormula(f).length <= LIMITS.diceFormulaChars, "its canonical text fits an op");
}

/** A draw that reads its faces from generated numbers, so a failure shrinks to small faces. */
function drawFrom(values: readonly number[]): Draw {
  let i = 0;
  return (s) => 1 + (values[i++ % values.length]! % s);
}

/** What any stored result must keep: its text parses, its faces fit its dice, and its total is their sum within the range. */
function assertReadsBack(result: DiceResult): void {
  const parsed = parseFormula(result.formula);
  assert.ok(parsed.ok, `the stored text ${result.formula} parses`);
  const terms = rolledTerms(result);
  assert.ok(terms, "the result reads back as terms and faces");
  const read = terms.flatMap((t) => ("faces" in t ? t.faces : []));
  assert.deepEqual(read, result.faces, "the terms hold every face once, in order");
  for (const t of terms) {
    if (!("faces" in t)) continue;
    for (const face of t.faces) assert.ok(Number.isInteger(face) && face >= 1 && face <= t.term.sides, `a face of a d${t.term.sides} is 1 to ${t.term.sides}`);
    assert.equal(t.kept.filter(Boolean).length, t.term.keep?.n ?? t.term.count, "a term keeps exactly its n");
  }
  assert.equal(totalOf(parsed.formula, result.faces), result.total, "the total is the kept faces and numbers");
  const { min, max } = formulaRange(parsed.formula);
  assert.ok(result.total >= min && result.total <= max, `the total ${result.total} is within ${min} to ${max}`);
}

describe("the dice grammar, over any text (property)", () => {
  test("never throws, and whatever it reads is within the grammar's bounds", () => {
    holds(
      fc.property(anyText, (text) => {
        const formula = parseFormula(text);
        if (formula.ok) assertWithinGrammar(formula.formula, true);
        const extra = parseExtra(text);
        if (extra.ok) assertWithinGrammar(extra.formula, false);
        const roll = parseRollText(text);
        if (!roll.ok) return;
        assertWithinGrammar(roll.formula, true);
        assert.ok(roll.label === undefined || (roll.label !== "" && roll.label.length <= LIMITS.diceLabelChars && roll.label === roll.label.trim()), "a label is 1 to 60 characters with no space at either end");
        for (const s of roll.sources) assert.equal(s.from, "typed");
      }),
      20_000,
    );
  });

  test("a formula's canonical text reads back as the same formula", () => {
    holds(
      fc.property(formula, (f) => {
        const back = parseFormula(formatFormula(f));
        assert.ok(back.ok, formatFormula(f));
        assert.deepEqual(back.formula, f);
      }),
      5_000,
    );
    holds(
      fc.property(grammarText, (text) => {
        const first = parseFormula(text);
        if (!first.ok) return;
        const again = parseFormula(formatFormula(first.formula));
        assert.ok(again.ok);
        assert.deepEqual(again.formula, first.formula, "canonical text is a fixed point");
      }),
      5_000,
    );
  });

  test("a quick die adds exactly one die and keeps the words, or refuses only at a bound", () => {
    const quick = fc.constantFrom(4, 6, 8, 10, 12, 20, 100);
    holds(
      fc.property(fc.oneof(grammarText, formula.map((f) => formatFormula(f))), quick, (text, s) => {
        const before = parseRollText(text);
        const added = addDie(text, s);
        if (!before.ok) return;
        const after = parseRollText(added);
        if (!after.ok) {
          assert.ok([FORMULA_ERRORS.dice, FORMULA_ERRORS.long, FORMULA_ERRORS.terms].includes(after.error as never), `refused at a bound, not: ${after.error}`);
          return;
        }
        assert.equal(diceCount(after.formula), diceCount(before.formula) + 1, `${JSON.stringify(text)} to ${JSON.stringify(added)}`);
        assert.equal(after.label, before.label);
        assert.deepEqual(after.sources, before.sources);
      }),
      5_000,
    );
  });
});

describe("rolling and reading back a result (property)", () => {
  const mode = fc.option(fc.constantFrom<AdvantageMode>("adv", "dis"), { nil: undefined });
  const faces = fc.array(fc.nat(), { minLength: 1, maxLength: 40 });

  test("a roll draws one face per die, within its sides, and its total lies in the formula's range", () => {
    holds(
      fc.property(formula, mode, faces, (f, m, values) => {
        const rolled = rollFormula(f, drawFrom(values), m);
        if (!rolled.ok) {
          assert.ok(m !== undefined, "only a mode refuses a formula the grammar accepts");
          assert.ok([FORMULA_ERRORS.mode, FORMULA_ERRORS.dice, FORMULA_ERRORS.long].includes(rolled.error as never), `a mode refuses at a bound, not: ${rolled.error}`);
          return;
        }
        assert.equal(rolled.result.mode, m);
        assert.equal(rolled.result.faces.length, diceCount(f) + (m ? 1 : 0), "one face per die, and one more for a mode's second d20");
        assertReadsBack(rolled.result);
      }),
      5_000,
    );
  });

  test("a reroll, Lucky or an added die leaves a result that still reads back and sums right", () => {
    const change = fc.oneof(
      fc.record({ kind: fc.constant("heroic" as const), face: fc.nat() }),
      fc.record({ kind: fc.constant("halfling" as const), face: fc.nat() }),
      fc.record({ kind: fc.constant("lucky" as const) }),
      fc.record({ kind: fc.constant("die" as const), sides: fc.constantFrom(4, 6, 8, 10, 12) }),
    );
    holds(
      fc.property(formula, mode, faces, change, (f, m, values, c) => {
        const draw = drawFrom(values);
        const rolled = rollFormula(f, draw, m);
        if (!rolled.ok) return;
        const result = rolled.result;
        const changed =
          c.kind === "heroic"
            ? rerolled(result, "heroic-inspiration", c.face % result.faces.length, draw)
            : c.kind === "halfling"
              ? rerolled(result, "halfling-luck", c.face % result.faces.length, draw)
              : c.kind === "lucky"
                ? withLucky(result, draw)
                : withDie(result, c.sides, draw);
        if (!changed.ok) return;
        assertReadsBack(changed.result);
        if (c.kind === "heroic" || c.kind === "halfling") {
          assert.equal(changed.result.formula, result.formula, "a reroll keeps the formula");
          const moved = changed.result.faces.filter((face, i) => face !== result.faces[i]).length;
          assert.ok(moved <= 1, "a reroll changes at most the one face it names");
        }
      }),
      5_000,
    );
  });
});
