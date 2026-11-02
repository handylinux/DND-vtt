/**
 * Reading a state record by key. A record is a plain object, so a key an op
 * names such as "constructor" or "__proto__" finds a member of
 * Object.prototype where the record holds no entry of that name. Code that
 * reads that member as an entity throws, or writes nonsense into the room.
 * Every read of a record by key goes through `ownEntry`, which finds only the
 * record's own entries.
 */
export function ownEntry<T>(record: Readonly<Record<string, T>> | null | undefined, key: string): T | undefined {
  return record !== undefined && record !== null && Object.hasOwn(record, key) ? record[key] : undefined;
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

/** Whether any string in a value, such as an op, names a member of Object.prototype. */
export function holdsPrototypeName(value: unknown): boolean {
  if (typeof value === "string") return PROTOTYPE_MEMBERS.has(value) || prefixedPrototypeName(value);
  if (Array.isArray(value)) return value.some(holdsPrototypeName);
  if (value !== null && typeof value === "object") return Object.entries(value).some(([key, child]) => PROTOTYPE_MEMBERS.has(key) || holdsPrototypeName(child));
  return false;
}

/** An entity key such as "token:constructor", which a restore entry names. */
function prefixedPrototypeName(value: string): boolean {
  const colon = value.indexOf(":");
  return colon > 0 && PROTOTYPE_MEMBERS.has(value.slice(colon + 1));
}
