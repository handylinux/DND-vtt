import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { PasswordHasher } from "../auth/passwords.ts";
import { randomIp, startTestApp, type TestApp } from "../auth/testing.ts";

/**
 * Every API route and the socket run through the per-request limiter
 * (server/auth/ratelimit.ts), which only covers routes registered after it.
 * The routes are read from the built app rather than listed here, so a route
 * added later is checked too. The limiter's own counting is tested in
 * server/auth/ratelimit.itest.ts.
 */

/** Every route of the app as [method, path], read from Fastify's printed route tree. */
function routesOf(app: FastifyInstance): Array<[method: string, path: string]> {
  const routes: Array<[string, string]> = [];
  const segments: string[] = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split("\n")) {
    const node = /^((?:│ {3}| {4})*)[└├]── (.+?)(?: \(([^)]+)\))?$/.exec(line);
    if (!node) continue;
    segments.length = node[1]!.length / 4;
    segments.push(node[2]!);
    for (const method of node[3]?.split(", ") ?? []) routes.push([method, segments.join("")]);
  }
  return routes;
}

describe("request limits on every route", () => {
  let t: TestApp;
  before(async () => {
    // With an admin password the admin routes exist, and they are checked too.
    t = await startTestApp({ env: { ADMIN_PASSWORD_HASH: await new PasswordHasher().hash("an admin password for tests") } });
  });
  after(() => t.close());

  test("every route under /api/ and the socket carries the limiter's headers, before any check of its own", async () => {
    const limited = routesOf(t.app).filter(([, path]) => path.startsWith("/api/") || path === "/ws");
    const listed = new Set(limited.map(([method, path]) => `${method} ${path}`));
    // The routes CodeQL reported as unlimited, so a parse that found nothing cannot pass.
    for (const route of [
      "POST /api/rooms",
      "GET /api/rooms/:id",
      "POST /api/rooms/:id/join",
      "POST /api/rooms/import",
      "POST /api/dm/redeem",
      "POST /api/display/redeem",
      "POST /api/admin/login",
      "GET /api/admin/rooms",
      "GET /ws",
    ]) {
      assert.ok(listed.has(route), `${route} is among the routes read from the app`);
    }

    const unlimited: string[] = [];
    for (const [method, path] of limited) {
      // No cookie and a made-up id: the limiter counts the address, and the
      // route refuses at its first check, before anything is written.
      const res = await t.app.inject({
        method: method as "GET",
        url: path.replace(/:\w+/g, "nope"),
        remoteAddress: randomIp(),
        headers: { "sec-fetch-site": "same-origin" },
      });
      if (res.headers["x-ratelimit-limit"] !== "120") unlimited.push(`${method} ${path} (${res.statusCode})`);
    }
    assert.deepEqual(unlimited, []);
  });
});
