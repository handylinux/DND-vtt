import { attaches, draggedWalkFull, followsInSingleFile, hiddenTowStands, seatsApart, seatsOnSqueeze, walksRoutes } from "../migrate.ts";
import type { RoomState, Token, Viewer } from "../model.ts";
import { inSightOfNonOwners } from "../project.ts";
import type { Op } from "../protocol.ts";
import { movementRules, type BuildState } from "../ruleHooks.ts";
import { carriedGroup, moveGroups, onHolder, publicMembers, seatedAt, squeezedSeatsApart, walkerFor, type SeenByAll } from "./attach.ts";
import type { Point } from "./geom.ts";
import { isHex, sceneGrid } from "./grid.ts";
import { footing } from "./heights.ts";
import { groundUnder, hexFullStop, landing, legSpots, legStop, offGridWallThrough, storedBuild, walkEnd, type MovingToken } from "./movement.ts";
import { fileRoutes, followerTrace, pieceReach, routeWalkers, walkSqueezes, type RoutePoint, type WalkTrace } from "./route.ts";

/**
 * One description of a move (contract section 1, docs/design/design-v1-attach.md
 * 9): each token an op moves, where from and to, along which walk, how,
 * and, for a token that moved only because its holder did, which holder.
 * `planMove` reads it from the op and the state before, so the reducer
 * places a holder's group by it and traps can see the walk before it
 * happens. `describeMove` reads it after, and equals the plan for every op
 * nothing rewrote (a test checks that on random moves).
 *
 * What another viewer can observe of a group's move reads only its public
 * members (8.0), so each entry says which pass it walks in: `public` for a
 * named token every player sees and a group's public members, `private`
 * for the rest, a visible token carried by a holder players cannot see
 * among them, which follows its holder all the same (the carried-object
 * reveal).
 */

export type Pose = { sceneId: string; x: number; y: number; elevation: number };

export type MoveHow = "walk" | "teleport" | "scene" | "reshape";

export type MovedToken = {
  tokenId: string;
  from: Pose;
  to: Pose;
  /** The footprint's top-left corner from `from` to `to`, both included: two points for a straight leg. */
  route: RoutePoint[];
  /** The walk's trace along `route` (route.ts WalkTrace): its walker at each point, by its own walk or as its holder takes it along. */
  trace: WalkTrace;
  how: MoveHow;
  /** The direct holder, for a token that moved only because its holder did. */
  carriedBy?: string;
  pass: "public" | "private";
  /** Whether the move leaves it squeezed, which only its own `token.move` does, or an update that keeps its place. */
  squeezed?: true;
  /** Whether it walks in single file behind its group's lead (`singleFile`), so a trap's cut of the walk keeps its own walk (traps.ts cutOp). */
  file?: true;
};

/**
 * The walks in single file a trap's cut op carries (traps.ts cutOp, review
 * FU45B-ASTRA-01): each creature's own walk to where the trap step had it
 * at the stop, index by index with its holder's cut walk. The cut op lands
 * its holder full size where the stop stands full, so the op alone would
 * take them by their places, on walks neither the server's wall check nor
 * the trap step read. Only the reducer makes a cut op, and a symbol key
 * never comes off the wire, so no client can send one.
 */
const FILE_CUT: unique symbol = Symbol("fileCut");

type FileCut = { readonly [FILE_CUT]?: ReadonlyMap<string, readonly Point[]> };

/** `op` with the walks in single file its cut keeps (`FILE_CUT`). */
export function withFileCut<T extends Op>(op: T, walks: ReadonlyMap<string, readonly Point[]>): T {
  return { ...op, [FILE_CUT]: walks };
}

/** The op's envelope as the plan reads it: the version it was stored at, if any. */
type Versioned = { opVersion?: number };

function poseOf(token: Pick<Token, "sceneId" | "x" | "y" | "elevation">): Pose {
  return { sceneId: token.sceneId, x: token.x, y: token.y, elevation: token.elevation };
}

/** A named token's own move: where the op puts it, along which walk, how, and whether it ends squeezed. */
type Named = { token: Token; to: Pose; route: RoutePoint[]; trace: WalkTrace; how: MoveHow; squeezed?: true };

/** The tokens the op names and moves, with where it puts each. Ops that move nothing give none. */
function namedMoves(op: Op, before: RoomState, env: Versioned): Named[] {
  // Its walk off a holder on the ground as every walk of it reads it (attach.ts walkerFor), a straight leg its one piece.
  const walked = (token: Token, to: Pose, how: MoveHow, pieces: readonly (readonly [number, number, number, 0 | 1])[] = [[to.x, to.y, 0, 0]]): Named => {
    const trace = routeWalkers(before.buildChunks, walkerFor(before, token, seenIn(before, env), { opVersion: env.opVersion, to }), pieces, to.elevation);
    return { token, to, how, trace, route: trace.map(({ x, y, elevation }) => ({ x, y, elevation })) };
  };
  const straight = (token: Token, to: Pose, how: MoveHow): Named => walked(token, to, how);
  switch (op.t) {
    case "token.move": {
      const token = before.tokens[op.tokenId];
      if (!token) return [];
      const to: Pose = { sceneId: token.sceneId, x: op.x, y: op.y, elevation: op.elevation ?? token.elevation };
      const named = op.route && walksRoutes(env.opVersion) ? walked(token, to, "walk", op.route) : straight(token, to, op.teleport !== undefined ? "teleport" : "walk");
      return [op.squeeze ? { ...named, squeezed: true } : named];
    }
    case "token.moveMany":
      return op.moves.flatMap((m) => {
        const token = before.tokens[m.tokenId];
        return token ? [straight(token, { sceneId: token.sceneId, x: m.x, y: m.y, elevation: m.elevation ?? token.elevation }, "walk")] : [];
      });
    case "token.update": {
      const token = before.tokens[op.tokenId];
      const p = op.patch;
      if (!token || (p.x === undefined && p.y === undefined && p.elevation === undefined && p.sceneId === undefined && p.size === undefined && p.w === undefined && p.h === undefined)) return [];
      const to: Pose = { sceneId: p.sceneId ?? token.sceneId, x: p.x ?? token.x, y: p.y ?? token.y, elevation: p.elevation ?? token.elevation };
      const placed = p.x !== undefined || p.y !== undefined || p.size !== undefined || p.w !== undefined || p.h !== undefined;
      const named = straight(token, to, to.sceneId !== token.sceneId ? "scene" : placed ? "reshape" : "walk");
      // A change of height alone leaves a squeeze where it is (reducer/tokens.ts SQUEEZE_FIELDS).
      return [!placed && p.sceneId === undefined && token.squeeze === true ? { ...named, squeezed: true } : named];
    }
    case "token.attach": {
      // A drag leaves the creature where it stands. The rest step onto their seat, a walk.
      const token = before.tokens[op.tokenId];
      if (!token || !onHolder(op.kind) || !attaches(env.opVersion)) return [];
      // A seat is at its holder's elevation, whatever the op says (4.1).
      const elevation = before.tokens[op.to]?.elevation ?? op.elevation;
      return [straight(token, { sceneId: token.sceneId, x: op.x, y: op.y, elevation }, "walk")];
    }
    case "token.detach": {
      const token = before.tokens[op.tokenId];
      if (!token || op.x === undefined || op.y === undefined || !attaches(env.opVersion)) return [];
      return [straight(token, { sceneId: token.sceneId, x: op.x, y: op.y, elevation: op.elevation ?? token.elevation }, "walk")];
    }
    default:
      return [];
  }
}

/**
 * Every token an op moves (contract 3.1): the tokens it names, where it
 * puts them, and since op version 14 what each carries, split by the
 * nearest named ancestor (moveGroups). Each carried token follows the walk
 * its own holder took, offset by its place, top down: what sits on its
 * holder takes the holder's change of elevation, and a dragged creature
 * keeps to its own ground behind a holder that walked on the ground, else
 * takes the holder's change but never sinks below the ground (5.1). Where
 * the holder's walk squeezes, what sits on it takes the seat the holder's
 * stand there gives it instead of its offset, from op version 29
 * (`squeezedSeats`, D-261029-52 on hexes, D-261029-53 on squares). A
 * teleport leaves what it drags, and a scene change takes everything.
 *
 * On squares, from op version 38, a walk that ends squeezed takes what it
 * drags in single file instead of by its place (`singleFile`), and seats
 * what sits on it on squeezed squares of its own (`endSeatsApart`).
 *
 * On a player's walk on a scene whose walls stop moves, a dragged creature
 * outside the public members stops where its own leg test stops it, and
 * what it carries stops with it (4.2): the public members' legs are the
 * permissions' to test, so no landing or refusal reads a hidden one. From
 * op version 38, on a move, it also stands only where no wall passes
 * through its box off its grid (`standsBack`).
 * Sorted by token id.
 */
/** Whether every player sees a token in this state, by the op's envelope. */
function seenIn(state: RoomState, env: Versioned): (t: { id: string }) => boolean {
  return (t) => {
    const token = state.tokens[t.id];
    return token !== undefined && inSightOfNonOwners(state, token, env);
  };
}

export function planMove(op: Op, before: RoomState, actor: Viewer, env: Versioned): MovedToken[] {
  return planWalks(op, before, actor, env).filter(takesAlong);
}

/** Whether the move writes a token of its plan: every token it names, and one it takes along that ends somewhere else. */
export function takesAlong(moved: MovedToken): boolean {
  return moved.carriedBy === undefined || !samePose(moved.from, moved.to);
}

/**
 * `planMove` with the tokens a move takes along that end where they
 * started kept in: what judges where each ends reads them too, as the
 * permission rule's reach of a creature in single file does (review
 * FU45B-ASTRA-04), though the move writes none of them.
 */
export function planWalks(op: Op, before: RoomState, actor: Viewer, env: Versioned): MovedToken[] {
  const named = namedMoves(op, before, env);
  if (named.length === 0) return [];
  const seen = seenIn(before, env);
  const out: MovedToken[] = [];
  const names = new Set(named.map((n) => n.token.id));
  // An attach names its holder too, which stays where it stands (8.0): the step onto the seat takes along nothing at or above
  // it, even round a loop the new link closes through a link the player's check cannot see.
  if (op.t === "token.attach") names.add(op.to);
  const groups = attaches(env.opVersion) ? moveGroups(before.tokens, [...names]) : new Map<string, string[]>();
  // A hidden creature in tow takes the stand test where a move leaves it, as the permission rule judges one every player sees (D-261101-274).
  const stands = (op.t === "token.move" || op.t === "token.moveMany") && hiddenTowStands(env.opVersion);
  for (const n of named) {
    out.push({ tokenId: n.token.id, from: poseOf(n.token), to: n.to, route: n.route, trace: n.trace, how: n.how, pass: seen(n.token) ? "public" : "private", ...(n.squeezed ? { squeezed: true as const } : {}) });
    const members = groups.get(n.token.id) ?? [];
    if (members.length <= 1) continue;
    const shown = new Set(publicMembers(before.tokens, n.token.id, seen, names));
    out.push(...followGroup(before, out[out.length - 1]!, members, (id, holderId) => shown.has(id) && shown.has(holderId), actor.role !== "dm", env, stands, (op as FileCut)[FILE_CUT]));
  }
  return out.sort((a, b) => (a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0));
}

/**
 * How a group's members follow its lead's walk, top down (`follow`):
 * `members` the lead first, then what it takes along, each after its
 * holder, and `isPublic` whether a member and its link to its holder are
 * every player's. Where the walk lines them up in single file, or seats
 * its passengers apart, those are worked out for the group at once, the
 * public members before the rest, so no public place reads a hidden one.
 * `cut` is the walks in single file a trap's cut keeps (`FILE_CUT`).
 */
function followGroup(before: RoomState, lead: MovedToken, members: readonly string[], isPublic: (id: string, holderId: string) => boolean, byPlayer: boolean, env: Versioned, stands = false, cut?: ReadonlyMap<string, readonly Point[]>): MovedToken[] {
  const pub = (id: string) => {
    const link = before.tokens[id]?.attached;
    return link !== undefined && isPublic(id, link.to);
  };
  const file = cut ?? singleFile(before, lead, members.slice(1), pub, env);
  const apart = new Map<string, Map<string, Point> | null>();
  const seatsOn = (holder: MovedToken) => {
    let seats = apart.get(holder.tokenId);
    if (seats === undefined) apart.set(holder.tokenId, (seats = endSeatsApart(before, holder, members, pub, env)));
    return seats;
  };
  const out: MovedToken[] = [];
  const walked = new Map<string, MovedToken>([[lead.tokenId, lead]]);
  for (const id of members.slice(1)) {
    const member = before.tokens[id]!;
    const holderMove = walked.get(member.attached!.to);
    if (!holderMove) continue;
    const own = file?.get(id);
    const holderOwn = file?.get(holderMove.tokenId);
    // Behind a holder in the file that a wall stopped, no further along than it (review FU45B-ASTRA-03).
    const walk = own && holderOwn ? behindStop(member, own, holderOwn, holderMove.route) : own;
    const moved = follow(before, member, holderMove, pub(id), byPlayer, env, { file: walk, seats: seatsOn, stands });
    if (!moved) continue;
    walked.set(id, moved);
    out.push(moved);
  }
  return out;
}

/**
 * Where each creature the lead's walk drags along walks when it follows in
 * single file (route.ts fileRoutes, D-261101-250): from op version 38, on
 * squares, on the lead's own walk that ends squeezed as the op says. Every
 * dragged member of the group goes, the public ones first. Null where they
 * follow by their places.
 */
function singleFile(before: RoomState, lead: MovedToken, members: readonly string[], pub: (id: string) => boolean, env: Versioned): Map<string, Point[]> | null {
  if (!followsInSingleFile(env.opVersion) || lead.squeezed !== true || lead.how !== "walk" || lead.carriedBy !== undefined) return null;
  const scene = before.scenes[lead.from.sceneId];
  const standing = before.tokens[lead.tokenId];
  if (!scene || !standing || isHex(sceneGrid(scene))) return null;
  const dragged = members.map((id) => before.tokens[id]!).filter((t) => t.attached?.kind === "drag");
  if (dragged.length === 0) return null;
  return fileRoutes(standing, lead.route, [dragged.filter((t) => pub(t.id)), dragged.filter((t) => !pub(t.id))]);
}

/**
 * Where what sits on `holder` sits where its walk ends squeezed, each on a
 * squeezed square of its own where there are enough (attach.ts
 * squeezedSeatsApart, D-261101-251): from op version 38, on squares, on the
 * holder's own walk, the public passengers first. Null where each takes its
 * nearest alone.
 */
function endSeatsApart(before: RoomState, holder: MovedToken, members: readonly string[], pub: (id: string) => boolean, env: Versioned): Map<string, Point> | null {
  if (!seatsApart(env.opVersion) || holder.squeezed !== true || holder.how !== "walk" || holder.carriedBy !== undefined) return null;
  const scene = before.scenes[holder.from.sceneId];
  const standing = before.tokens[holder.tokenId];
  if (!scene || !standing || isHex(sceneGrid(scene))) return null;
  const seated = members.map((id) => before.tokens[id]!).filter((t) => t.attached?.to === holder.tokenId && onHolder(t.attached.kind));
  if (seated.length < 2) return null;
  return squeezedSeatsApart(sceneGrid(scene), standing, holder.route[holder.route.length - 1]!, [seated.filter((t) => pub(t.id)), seated.filter((t) => !pub(t.id))], env.opVersion);
}

/**
 * A walk in single file (`own`) cut where its holder, whose own walk in the
 * file is `holderOwn`, stopped (`stoppedAtWalls`), as it walked `walked`:
 * the walks are index by index with the lead's, so the holder stopped a
 * share of the way along its piece, and this walk stops as far along its
 * own, on its own lattice, short rather than past it. Taken whole where
 * the holder walked its whole walk.
 */
function behindStop(member: MovingToken, own: readonly Point[], holderOwn: readonly Point[], walked: readonly Point[]): readonly Point[] {
  const m = walked.length - 1;
  if (m === 0) return own.slice(0, 1);
  const end = walked[m]!;
  if (m === holderOwn.length - 1 && end.x === holderOwn[m]!.x && end.y === holderOwn[m]!.y) return own;
  const reach = (a: Point, b: Point) => Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  const whole = reach(holderOwn[m - 1]!, holderOwn[m]!);
  const share = whole === 0 ? 1 : reach(holderOwn[m - 1]!, end) / whole;
  const from = own[m - 1]!;
  const to = own[m]!;
  let at: Point = from;
  for (const spot of legSpots({ ...member, x: from.x, y: from.y }, to)) if (reach(from, spot) <= share * reach(from, to) + 1e-9) at = spot;
  return [...own.slice(0, m), at];
}

/** How a member follows: its single-file walk where it has one, the holder's squeezed seats apart, and whether a hidden one takes the stand test. */
type Following = { file?: readonly Point[] | undefined; seats?: (holder: MovedToken) => Map<string, Point> | null; stands?: boolean };

function samePose(a: Pose, b: Pose): boolean {
  return a.sceneId === b.sceneId && a.x === b.x && a.y === b.y && a.elevation === b.elevation;
}

/**
 * How a carried token follows its holder's actual walk, or null when it
 * stays (a dragged creature a teleport leaves). On a player's walk
 * (`byPlayer`) a dragged creature outside the public members stops at walls.
 */
function follow(before: RoomState, member: Token, holder: MovedToken, isPublic: boolean, byPlayer: boolean, env: Versioned, how: Following = {}): MovedToken | null {
  const kind = member.attached!.kind;
  const from = poseOf(member);
  const pass = isPublic ? "public" : "private";
  const ox = member.x - holder.from.x;
  const oy = member.y - holder.from.y;
  if (holder.how === "teleport" && !onHolder(kind)) return null;
  if (holder.how === "scene" || onHolder(kind)) {
    // What sits on its holder keeps its height above it at every point, and a scene change takes all by the holder's change.
    const oz = member.elevation - holder.from.elevation;
    const seats = onHolder(kind) ? squeezedSeats(before, member, holder, env, how.seats?.(holder)?.get(member.id)) : null;
    const route = holder.route.map((p, i) => ({ ...(seats?.[i] ?? { x: p.x + ox, y: p.y + oy }), elevation: p.elevation + oz }));
    const last = route[route.length - 1]!;
    return { tokenId: member.id, from, to: { sceneId: holder.to.sceneId, ...last }, route, trace: followerTrace(member, route), how: holder.how, carriedBy: holder.tokenId, pass };
  }
  const chunks = before.buildChunks;
  // A holder walking off its own mount walks on the ground once clear of it (attach.ts walkerFor), and so does what it drags:
  // as the holder's walk stands where it starts (route.ts WalkTrace).
  const grounded = footing(chunks, holder.trace[0]!) === "ground";
  // Its own ground behind a walker, under its own footprint as it walks (route.ts followerTrace), else the holder's change of
  // elevation, never below the ground there.
  const self = followerTrace(member, [from])[0]!;
  const elevationAt = (x: number, y: number, holderElevation: number): number => {
    const ground = groundUnder(chunks, self, { x, y });
    return grounded ? ground : Math.max(member.elevation + (holderElevation - holder.from.elevation), ground);
  };
  let route: RoutePoint[] = [{ x: member.x, y: member.y, elevation: member.elevation }];
  // In single file its own walk, else the holder's offset by its place.
  const file = how.file;
  for (const [i, p] of holder.route.entries()) {
    if (i === 0) continue;
    const at = file?.[i] ?? { x: p.x + ox, y: p.y + oy };
    route.push({ x: at.x, y: at.y, elevation: elevationAt(at.x, at.y, p.elevation) });
  }
  if (!isPublic && byPlayer && holder.how === "walk") route = stoppedAtWalls(before, member, route, holder.route, elevationAt, env, how.stands === true);
  const last = route[route.length - 1]!;
  return { tokenId: member.id, from, to: { sceneId: member.sceneId, ...last }, route, trace: followerTrace(member, route), how: holder.how, carriedBy: holder.tokenId, pass, ...(file ? { file: true as const } : {}) };
}

/**
 * Where what sits on a holder sits at each point of the holder's walk when
 * that walk squeezes, and on hexes on any walk (D-261029-52 on hexes,
 * D-261029-53 on squares), or null where the offset holds all the way: for
 * ops stored before version 29 (migrate.ts seatsOnSqueeze), for a walk on
 * squares that neither squeezes nor starts squeezed, whose offset keeps it
 * on its seat, for a change of scene or shape, which no squeeze survives,
 * and for a holder another token carries, since only a token's own move
 * takes a squeeze (reducer/tokens.ts carriedAlong). At each point it sits where the
 * holder's stand there seats it (attach.ts seatedAt): on its own seat
 * where the holder stands full size, and where it squeezes on the seat
 * nearest that on the squares or hexes it squeezes onto. So a rider sits
 * on its mount's square or hex through a corridor one wide, its light and
 * sight with it, and is on its own seat again past it, and the walk's
 * route, sweeps and ruler read it there. On squares, from op version 36,
 * the holder stands squeezed only at the walk's ends and full size between,
 * even along the first piece of a walk that starts squeezed, where its
 * trace keeps the squeeze, so never squeezed there by the walls (route.ts
 * walkSqueezes, D-261101-180), and the area and trap sweeps find a rider
 * between the ends where no wall decides. A device's route search and cut
 * read what the rider drags by the same seat (route.ts seatShift). On
 * hexes its own seat is the anchor nearest its place, so every walk there
 * seats it, and one nudged off its anchor sits on it again, as a device
 * reads it (review DP34-OPUS-10). Its link reads the full footprint
 * (docs/design/design-v1-attach.md 5.1), which every such seat lies in, so it
 * never lets go mid-corridor. `apart` is its seat where the walk ends,
 * where it takes one apart from the others on the holder (`endSeatsApart`).
 */
function squeezedSeats(before: RoomState, member: Token, holder: MovedToken, env: Versioned, apart?: Point): (Point | null)[] | null {
  if (!seatsOnSqueeze(env.opVersion) || holder.carriedBy !== undefined || (holder.how !== "walk" && holder.how !== "teleport")) return null;
  const scene = before.scenes[member.sceneId];
  const standing = before.tokens[holder.tokenId];
  if (!scene || !standing) return null;
  const squeezedAt = walkSqueezes(before, standing, holder.route, holder.trace, holder.squeezed === true, env.opVersion);
  const g = sceneGrid(scene);
  if (!isHex(g) && !squeezedAt.some((s) => s)) return null;
  const last = holder.route.length - 1;
  // Where the walk ends squeezed, the seat it takes apart from the others on the holder, where it has one (followGroup).
  return holder.route.map((p, i) => (i === 0 ? null : i === last && apart ? apart : seatedAt(g, member, standing, p, squeezedAt[i]!, env.opVersion)));
}

/**
 * A routed walk's reach as the 300-square cap reads it (docs/design/design-v1-movement.md
 * 10, review R7-OPUS-1): piece by piece, the largest over the walker and
 * its public members, each on its own elevation path as the move takes it
 * along (`follow`), so a creature it drags over ground that rises and falls
 * counts its climbs, which the walker's own path never shows. A token on a
 * holder some player cannot see is not among them (L3-SOL-39), so no hidden
 * path decides the cap. The server's check (permissions.ts routeFits) and
 * the client's, of a route before it sends it (drop.ts landingOf), are this
 * one rule. A player's route on a scene with fog on counts no climbs or
 * falls (MD2-O-13): the trace reads the real ground's heights, so counting
 * them would refuse a route in place by the heights of ground the player
 * never touched. The cap only bounds the work a route costs, and its
 * squares across the ground do that alone. `squeezed` is whether the move
 * ends squeezed, so what sits on the walker is read on the seat the move
 * gives it there (review DP34-OPUS-3), and what it drags in single file
 * on squares (`singleFile`).
 */
export function checkSetReach(before: RoomState, token: Pick<Token, "id" | "sceneId" | "x" | "y" | "elevation">, trace: WalkTrace, seen: SeenByAll, feetPerCell: number, role: Viewer["role"], squeezed = false): number {
  const route = trace.map(({ x, y, elevation }) => ({ x, y, elevation }));
  const lead: MovedToken = { tokenId: token.id, from: poseOf(token), to: { sceneId: token.sceneId, ...route[route.length - 1]! }, route, trace, how: "walk", pass: "public", ...(squeezed ? { squeezed: true as const } : {}) };
  const walks = [lead, ...followGroup(before, lead, publicMembers(before.tokens, token.id, seen, new Set([token.id])), () => true, false, {})];
  // Infinite feet per square make every rise no reach.
  const perSquare = role === "player" && before.scenes[token.sceneId]?.fogEnabled === true ? Infinity : feetPerCell;
  let reach = 0;
  for (let i = 1; i < route.length; i++) reach += Math.max(...walks.map((w) => pieceReach(w.route[i - 1]!, w.route[i]!, perSquare)));
  return reach;
}

/**
 * A dragged creature outside the public members, on a player's walk where
 * walls stop moves (4.2): its own offset walk up to its first piece the
 * leg test stops, which it ends at the last clear spot of, as a lone
 * token's drop lands (design 9.8), on its own ground there. It is stored
 * full size wherever it stops (reducer/tokens.ts carriedAlong), so on hexes
 * from op version 32 each piece ends full size, never squeezed where it
 * lies on a squeeze's anchors, and a stopped piece ends at the last stand
 * of its line where it stands full size (movement.ts hexFullStop,
 * migrate.ts draggedWalkFull). On squares its walk is judged by its core,
 * which a corridor one square wide lets through, so it keeps the drop's
 * landing at every op version: refusing only a stopped walk's squeezed
 * landing there would part it from the walk that is not stopped. With
 * `stands`, a move's from op version 38, where it ends it then takes the
 * stand test too (`standsBack`).
 */
function stoppedAtWalls(before: RoomState, member: Token, route: RoutePoint[], holderRoute: readonly RoutePoint[], elevationAt: (x: number, y: number, holderElevation: number) => number, env: Versioned, stands = false): RoutePoint[] {
  const scene = before.scenes[member.sceneId];
  if (scene?.blockMovement !== true) return route;
  // Its stands on hexes as the op was written under (movement.ts storedBuild).
  const build = storedBuild(before, env.opVersion);
  // A creature a holder drags beside it walks as itself, since a drag is no seat (route.ts followerTrace).
  const trace = followerTrace(member, route);
  const full = draggedWalkFull(env.opVersion) && isHex(sceneGrid(scene));
  let kept = route;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = full ? { ...route[i]!, squeeze: false } : route[i]!;
    const at = trace[i - 1]!;
    if (movementRules.legBlocker(build, at, b) === null) continue;
    const stop = (full ? hexFullStop(build, at, b) : null) ?? landing(build, at, b, "walk");
    kept = route.slice(0, i);
    if (stop.x !== a.x || stop.y !== a.y) kept.push({ x: stop.x, y: stop.y, elevation: elevationAt(stop.x, stop.y, holderRoute[i - 1]!.elevation) });
    break;
  }
  return stands ? standsBack(build, member, kept, holderRoute, elevationAt) : kept;
}

/**
 * A hidden creature's walk in tow as it ends where it may stand
 * (migrate.ts hiddenTowStands, D-261101-274): where its walk ends off its
 * grid with a wall through its box outside a real narrow space
 * (movement.ts offGridWallThrough), the last spot back along its last
 * piece that its leg and its stand both take, as a public one's walk is cut
 * (client drop.ts standingBack), else that piece's start. Only a creature
 * with a side a squeeze shrinks can meet it, and only it and what it
 * carries move for it: no refusal, landing or public walk reads it. What
 * players may still see is the private pass's own reveal, as for a leg
 * that stops it: a token they see that it carries steps back with it
 * (8.0), and one hidden only by sight still lights the ground around it.
 */
function standsBack(build: BuildState, member: Token, route: RoutePoint[], holderRoute: readonly RoutePoint[], elevationAt: (x: number, y: number, holderElevation: number) => number): RoutePoint[] {
  const n = route.length;
  if (n < 2) return route;
  const from = followerTrace(member, route)[n - 2]!;
  if (!offGridWallThrough(build, walkEnd(build, from, route[n - 1]!))) return route;
  const spots = legSpots(from, route[n - 1]!);
  for (let k = spots.length - 2; k > 0; k--) {
    const spot = { ...spots[k]!, elevation: elevationAt(spots[k]!.x, spots[k]!.y, holderRoute[n - 2]!.elevation) };
    if (legStop(build, from, spot) === null && !offGridWallThrough(build, walkEnd(build, from, spot))) return [...route.slice(0, n - 1), spot];
  }
  return route.slice(0, n - 1);
}

/**
 * The same description after the op (contract 3.1, step 4 of 3.6): the
 * plan, each token where the op left it. It equals the plan whenever the
 * reducer placed every token as planned, which a test checks on random
 * moves. A token the op deleted has no entry.
 */
export function describeMove(op: Op, before: RoomState, after: RoomState, actor: Viewer, env: Versioned): MovedToken[] {
  const out: MovedToken[] = [];
  for (const moved of planMove(op, before, actor, env)) {
    const token = after.tokens[moved.tokenId];
    if (token) out.push({ ...moved, to: poseOf(token) });
  }
  return out;
}

/** The tokens of a group that sit on their holders all the way down, the holder first: what a ground change lifts with it (5.2). */
export function ridingGroup(tokens: RoomState["tokens"], holderId: string): string[] {
  return carriedGroup(tokens, holderId, new Set(), (child) => child.attached !== undefined && onHolder(child.attached.kind));
}
