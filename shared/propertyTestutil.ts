import fc from "fast-check";

/**
 * The run settings every property test (`*.prop.test.ts`) shares. `pnpm
 * test` runs each property on one fixed seed, so a run is the same cases
 * every time and a failure in continuous integration reproduces on any
 * machine. FC_SEED picks other cases and FC_RUNS sets how many each
 * property tries, for a longer search by hand (docs/development.md).
 */
const DEFAULT_SEED = 20_261_101;

type Env = Readonly<Record<string, string | undefined>>;

function wholeNumber(env: Env, name: string, least: number): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  // A typo here would quietly run the defaults, or no cases at all, which reads as a search that found nothing.
  if (!Number.isSafeInteger(value) || value < least) {
    throw new Error(Number.isFinite(least) ? `${name} must be a whole number of at least ${least}, not "${raw}"` : `${name} must be a whole number, not "${raw}"`);
  }
  return value;
}

/** The seed every property runs on, and the run count that replaces each property's own, from FC_SEED and FC_RUNS. */
export function runSettings(env: Env): { seed: number; runs: number | undefined } {
  return { seed: wholeNumber(env, "FC_SEED", -Infinity) ?? DEFAULT_SEED, runs: wholeNumber(env, "FC_RUNS", 1) };
}

const { seed, runs } = runSettings(process.env);

/**
 * Checks a property over `numRuns` generated cases, or FC_RUNS of them. Each
 * property picks its own count, so the whole set stays a few seconds of the
 * unit suite. A failure prints the shrunk counterexample with its seed and path.
 */
export function holds<Ts>(property: fc.IProperty<Ts>, numRuns: number): void {
  fc.assert(property, { seed, numRuns: runs ?? numRuns });
}

/**
 * Values JSON.parse can hand a server or an import that a well-formed sender
 * never writes: -0, the infinities that `1e999` parses to, the edges of the
 * safe integers, long and empty strings, and a key that names a prototype.
 */
const oddJson = fc.oneof(
  { weight: 3, arbitrary: fc.jsonValue({ maxDepth: 2 }) },
  {
    weight: 2,
    arbitrary: fc.constantFrom<unknown>(0, -0, -1, 0.5, 1.5, 2 ** 31, 2 ** 53, -(2 ** 53), 1e300, Infinity, -Infinity, "", " ", "x".repeat(5_000), "__proto__", [], {}, null, true, false),
  },
  { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 20 }) },
);
const oddKey = fc.constantFrom("t", "id", "kind", "x", "", "__proto__", "constructor", "toString");

type Edit = { at: number; kind: "replace" | "delete" | "add"; key: string; value: unknown };
const edit: fc.Arbitrary<Edit> = fc.record({ at: fc.nat(), kind: fc.constantFrom("replace", "replace", "delete", "add"), key: oddKey, value: oddJson });

type Slot = { parent: Record<string, unknown> | unknown[]; key: string | number };

function slotsOf(value: unknown, out: Slot[]): Slot[] {
  if (Array.isArray(value)) {
    value.forEach((child, i) => {
      out.push({ parent: value, key: i });
      slotsOf(child, out);
    });
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.push({ parent: value as Record<string, unknown>, key });
      slotsOf(child, out);
    }
  }
  return out;
}

/** Sets an own property as JSON.parse does, so `__proto__` becomes a key rather than a prototype. */
function put(target: Record<string, unknown> | unknown[], key: string | number, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

function applyEdit(root: unknown, given: Edit): unknown {
  // The constants above are one object each, so every edit puts in a copy that a later edit may change.
  const e = { ...given, value: given.value !== null && typeof given.value === "object" ? structuredClone(given.value) : given.value };
  const slots = slotsOf(root, []);
  if (slots.length === 0 || e.at % (slots.length + 1) === slots.length) return e.kind === "replace" ? e.value : root;
  const slot = slots[e.at % (slots.length + 1)]!;
  const target = slot.parent[slot.key as keyof typeof slot.parent] as unknown;
  if (e.kind === "replace") put(slot.parent, slot.key, e.value);
  else if (e.kind === "delete") {
    if (Array.isArray(slot.parent)) slot.parent.splice(slot.key as number, 1);
    else delete slot.parent[slot.key as string];
  } else if (Array.isArray(target)) target.push(e.value);
  else if (target !== null && typeof target === "object") put(target as Record<string, unknown>, e.key, e.value);
  else put(slot.parent, slot.key, e.value);
  return root;
}

/**
 * A well-formed JSON value with up to three edits a hostile or broken
 * sender could make anywhere in it: a value replaced by an odd one, a key
 * or an item dropped, a key or an item added. A fuzzer that starts from
 * valid input gets past the first check of a schema, where random JSON
 * almost never does.
 */
export function mutatedJson(base: fc.Arbitrary<unknown>): fc.Arbitrary<unknown> {
  return fc.tuple(base, fc.array(edit, { maxLength: 3 })).map(([value, edits]) => edits.reduce(applyEdit, JSON.parse(JSON.stringify(value)) as unknown));
}
