/**
 * Whether reads of a state record by key find only the record's own entries
 * (ownEntry), and a new entity may not take an id that names a member of
 * Object.prototype (Tx.put). Ops stored before version 41 read a record as
 * any plain object reads by key, so an id such as "constructor" found the
 * prototype's member, and they made such ids. They replay so, junk results
 * included: the ops and undos stored after them were applied to what they
 * wrote, and an undo's guard hashes it. Live ops carry no stored version and
 * take today's rule.
 */
export function readsOwnKeys(opVersion: number | undefined): boolean {
  return !(opVersion !== undefined && opVersion < 41);
}

/** On while an op stored before own-key reads applies (withRecordReads). */
let readsAnyKey = false;

/**
 * Reading a state record by key. A record is a plain object, so a key an op
 * names such as "constructor" or "__proto__" finds a member of
 * Object.prototype where the record holds no entry of that name. Code that
 * reads that member as an entity throws, or writes nonsense into the room.
 * Every read of a record by key goes through `ownEntry`, which finds only the
 * record's own entries, except while an older op replays (readsOwnKeys).
 */
export function ownEntry<T>(record: Readonly<Record<string, T>> | null | undefined, key: string): T | undefined {
  if (record === undefined || record === null) return undefined;
  return readsAnyKey || Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * Runs one op's reads by the rule of its stored version (readsOwnKeys). The
 * reads sit in some 650 places across the reducer, the rules and the
 * projections it asks, most of which never see the op's envelope, so one
 * switch for the op's length stands in for passing the version to each. The
 * reducer is synchronous, so nothing else reads while it is on. The switch
 * goes back to what it was in `finally`, so a throw leaves no later read on
 * the old rule, and an apply nested in the op's own (its trap step's twin)
 * keeps the op's.
 */
export function withRecordReads<T>(opVersion: number | undefined, run: () => T): T {
  const was = readsAnyKey;
  readsAnyKey = !readsOwnKeys(opVersion);
  try {
    return run();
  } finally {
    readsAnyKey = was;
  }
}

const PROTOTYPE_MEMBERS: ReadonlySet<string> = new Set(Object.getOwnPropertyNames(Object.prototype));

/**
 * Whether a key names a member of Object.prototype. No new entity takes such
 * an id (Tx.put): "__proto__" cannot be a plain object's own key by
 * assignment, and the server and the clients key their own maps by entity
 * id, where any of these names finds the prototype's member.
 */
export function namesPrototypeMember(key: string): boolean {
  return PROTOTYPE_MEMBERS.has(key);
}
