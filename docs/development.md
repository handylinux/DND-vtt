# Development

How to run RaccoonVTT from a copy of the repository, the checks a change
must pass, and how continuous integration runs them. To run it on a server
instead, see [self-hosting.md](self-hosting.md).

## Local development

You need Node 24.7 or later, Docker, and pnpm through corepack
(`corepack enable` once). `package.json` pins the pnpm version.

```bash
pnpm install
pnpm db:up                  # postgres in docker, on 127.0.0.1:5434
cp .env.example .env.local
pnpm dev                    # http://localhost:5173
```

`pnpm dev` runs the API server with `--watch` and Vite in one terminal. Vite
proxies `/api` and `/ws` to the server, so the browser sees one origin, as it
does in production. The schema applies itself on the first connection, so
there is no migration step.

Postgres listens on 5434, not the usual 5432, so it can run beside a
postgres already on your machine. `RACCOON_DB_PORT` overrides it. The API
server listens on 3000, and `PORT` in `.env.local` moves it. Vite's proxy
follows `PORT`.

| Command | What it does |
| --- | --- |
| `pnpm dev` | API server and Vite, with reload |
| `pnpm dev:db` | `pnpm db:up`, then `pnpm dev` |
| `pnpm typecheck` | `tsc --noEmit` for the server and the client |
| `pnpm test` | unit tests (`*.test.ts`) |
| `pnpm test:int` | integration tests against the dev postgres (`*.itest.ts`). Run `pnpm db:up` first |
| `pnpm test:e2e` | builds the client, then runs the browser tests (`e2e/*.e2e.ts`) against a server on port 3100 (`E2E_PORT`) and the dev postgres, one file at a time as a single shard of [continuous integration](#continuous-integration): the join limits' counts are cleared before each file, and a failing file runs once more. Needs Google Chrome installed. Screenshots go to `test-results/e2e-screenshots` (gitignored), or to the folder in `E2E_SCREENSHOT_DIR`, and `E2E_SCREENSHOT_DIR=0` takes none. Run it alone, not beside `pnpm test:int`, since both use the same database |
| `pnpm test:e2e:shard <index> <count>` | one shard of the browser tests, as [continuous integration](#continuous-integration) runs them. Run `pnpm build` first |
| `pnpm build` | the client into `dist/` |
| `pnpm db:psql` | a psql shell in the dev postgres |
| `pnpm db:down` | stop the dev postgres, keeping its data |
| `pnpm db:reset` | drop the dev database volume and start fresh |
| `pnpm admin <command>` | the [admin commands](operations.md#admin-commands), against the dev database |
| `pnpm test:backup` | the backup check (`scripts/backup-check.ts`): `docker/backup.sh` through its compose services, in a compose project and postgres of its own (port 5235). Needs Docker, takes about 5 minutes. Run it before a release that touches backups |

`docker compose up --build raccoon` builds the production image from this
checkout and runs it against the dev postgres, on http://127.0.0.1:9180, as
the [Quick start](../README.md#quick-start) runs the published one. It is how to try a
build before it goes to a server.

### Property tests

Some unit tests are property tests, written with
[fast-check](https://fast-check.dev/) in files named `*.prop.test.ts`. Each
states a rule that must hold for every input, such as "the dice parser never
throws, and every formula it accepts is within the grammar's bounds", and
checks it against thousands of generated inputs: any text in the Dice field
and in a journal page, Universal VTT files and D&D Beyond characters with
edits a broken exporter or a hostile sender could make, protocol messages
past every bound, and random wall geometry. When a case breaks the rule,
fast-check shrinks it to a small counterexample and prints it with the seed
that found it.

`pnpm test` runs them on a fixed seed, so every run tries the same cases and
a failure in continuous integration fails the same way on your machine. Two
environment variables widen the search when you work on one of these areas:

| Variable | What it does |
| --- | --- |
| `FC_SEED` | another seed, for cases the default run never tries |
| `FC_RUNS` | how many cases each property tries, in place of its own count |

```bash
FC_SEED=7 FC_RUNS=20000 node --test shared/dice/dice.prop.test.ts
```

To replay a failure, run its file again with the seed fast-check printed.
The `*.random.test.ts` files are seeded random tests of the same idea, with
generators of their own.

## Continuous integration

GitHub Actions runs [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
on every push to `main` or to a branch under `ci/`, on pull requests to
`main`, and by hand from the Actions tab. It needs no secrets and deploys
nothing.

[CodeQL](../.github/workflows/codeql.yml) scans code on main and pull requests.
[OpenSSF Scorecard](../.github/workflows/scorecard.yml) checks repository security
on main. Both also run weekly. [Dependabot](../.github/dependabot.yml) proposes
weekly grouped updates after a 14-day cooldown. The Image workflow's Release
step publishes a GitHub Release only after its signed image and tags have
been published successfully.

These jobs run on Ubuntu:

- **build**: `pnpm build` once, kept for the e2e shards.
- **typecheck-int**: `pnpm typecheck` and `pnpm test:int`, the second
  against a postgres service container like the one in `docker-compose.yml`.
- **unit**: `pnpm test`, which needs no database.
- **e2e**, 14 shards at once: each shard installs, downloads the build,
  gets a postgres service container of its own and runs its share of
  `e2e/*.e2e.ts`, one file at a time, in Google Chrome.

A push to a `ci/` branch whose merge base is `main`'s tip, and that
changes only docs against it, runs just the typecheck, the unit tests, the
build and `e2e/guide.e2e.ts`, which draws the DM guide from `docs/`, and
still ends green, so the deploy gate takes it. The docs are the Markdown
files, pictures and Excalidraw sources under `docs/`, and the Markdown
files at the repository's root (`scripts/ci-scope.ts`). Anything else may
reach the app, its image or its tests. Any other push, a branch behind
`main` among them, and every push to `main`, runs everything.

The app draws its text in Inter, which it serves itself from
`public/fonts/`, so a page lays out the same on the Linux shards as on a
phone or a Mac. Each shard still installs Roboto, Ubuntu's package taken
from its archive by its checksum, and makes it the system font with
`e2e/fonts.conf`, as the fallback font. It draws only before
Inter loads and for the few characters Inter's subset lacks, as on an
Android phone. A file that still fails on Linux from font metrics alone,
and cannot be made tolerant without losing what it guards, goes in
`e2e/macos-only.json` with the reason. The Linux shards leave those files
out, and an **e2e-macos** job runs them on a Mac. The list is empty, and
the macOS job runs only when it is not.

A newer push to a `ci/` branch cancels that branch's run in progress. Every
push to `main` runs to the end, so each commit there is tested. A failing
e2e file runs once more, and its shard fails only if the rerun fails too. A
file that passed only on its rerun shows as a warning on the run. A shard
that failed, was cancelled or reran keeps its logs and screenshots as an
artifact for two weeks.

Each shard has a deadline 5 minutes inside its job's time limit
(`--deadline`). A run's limit leaves time for a rerun and for the files
after it, a rerun that would not fit is skipped, and the shard reports
what ran either way. So a file that hangs every time still fails with its
logs kept, rather than the job being cut off.

`scripts/e2e-shard.ts` decides which files each shard runs, by the times in
`e2e/durations.json`: the longest file first, each onto the shard with the
least time so far. A file missing there counts as `defaultSeconds`. Each
shard prints the time every file took. After a file grows or a new one
lands, rewrite the list from a few green runs with
`node scripts/e2e-durations.ts <run id> ...`, which reads those times
through `gh`. The list holds CI seconds, the largest of the runs given, and
the shard count is chosen so the longest shard plans about 8 minutes. A run
is 17 jobs and peaks at 16 at once, of the account's 20 Linux jobs, so a
second run that overlaps it queues part of its shards.

A file that takes much over 5 minutes in CI holds its shard up, so a long
one is split into files that each build their own room from a module they
share, as `e2e/alignmentRoom.ts` does for the alignment sweep's five files,
`e2e/barrestRoom.ts` for the resting bar's four and `e2e/tokenpanelRoom.ts`
for the token panel's four. The new alignment and token-panel splits have
initial planning estimates in `e2e/durations.json`, pending measured CI
times. Keep every test when splitting and check each resulting file stays
under five minutes.

A shard runs on a laptop too, against the dev postgres. Build first, then
give the shard's number and the shard count. `--list` prints what every
shard would run, without running it. On a Mac a shard includes the files
of `e2e/macos-only.json`, and `--macos-only` shards only those.

```bash
pnpm build
pnpm test:e2e:shard 1 3
pnpm test:e2e:shard 1 3 --list
```

It reads `E2E_PORT`, `DATABASE_URL` and `E2E_SCREENSHOT_DIR` as
`pnpm test:e2e` does. Each file's output also goes to
`test-results/e2e-logs`, and its screenshots to a folder of its own. Shards
can run side by side on one machine when each has its own database and its
own `E2E_PORT`, at least 30 apart: a file uses ports up to `E2E_PORT` plus
29, and the join limits count every run from one address in the database.
On macOS, reserve port 7000 for AirPlay Receiver. Choose a whole 30-port
range that excludes it, such as 7010 to 7039 with `E2E_PORT=7010`, then
7040 to 7069 with `E2E_PORT=7040`. Bases from 6971 through 7000 include
port 7000 and must be skipped. Lane briefs should reserve those whole
ranges too.

## Building for another architecture

The server builds its own image, for its own CPU architecture. This is
only for trying another architecture's image on your own machine, for
example linux/amd64 on an Apple Silicon Mac:

```bash
docker buildx build --platform linux/amd64 -t raccoon-vtt:amd64 --load .
```

The client build runs natively and only the production dependency install
runs under emulation. pnpm installs the native packages that match the
target, so the image gets `@img/sharp-linux-x64` and
`@node-rs/argon2-linux-x64-gnu`.
