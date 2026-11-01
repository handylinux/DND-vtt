<p align="center">
  <img src="public/icon.svg" alt="RaccoonVTT logo" width="128" height="128">
</p>

<h1 align="center">raccoon-vtt</h1>

<p align="center">
  <a href="https://hub.docker.com/r/jwhitlow45/raccoon-vtt"><img src="docs/images/docker-hub-button.png" width="240" alt="Get it on Docker Hub"></a>
</p>

<p align="center">
  <a href="https://github.com/jwhitlow45/raccoon-vtt/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/jwhitlow45/raccoon-vtt/ci.yml?branch=main&amp;label=CI&amp;logo=githubactions&amp;logoColor=white" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License: AGPL-3.0"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/jwhitlow45/raccoon-vtt"><img src="https://api.scorecard.dev/projects/github.com/jwhitlow45/raccoon-vtt/badge" alt="OpenSSF Scorecard"></a>
  <a href="https://hub.docker.com/r/jwhitlow45/raccoon-vtt"><img src="https://img.shields.io/docker/pulls/jwhitlow45/raccoon-vtt?logo=docker&amp;logoColor=white&amp;label=pulls" alt="Docker pulls"></a>
  <a href="https://hub.docker.com/r/jwhitlow45/raccoon-vtt/tags"><img src="https://img.shields.io/docker/image-size/jwhitlow45/raccoon-vtt/latest?logo=docker&amp;logoColor=white&amp;label=size" alt="Docker image size"></a>
  <img src="https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-blue?logo=linux&amp;logoColor=white" alt="Platforms: amd64 and arm64">
  <img src="https://img.shields.io/badge/rules-5.5e-c0392b" alt="Rules: D&amp;D 5.5e (2024)">
</p>

A self-hosted virtual tabletop for D&D groups playing the 2024 rules
(5.5e), on a square grid. It is made for phones first, and works on
tablets, laptops and a TV at the table too. Every device stays in sync
live. The DM sees everything, and players see only what the fog and the DM
allow.

One server hosts many groups at once. Each room is one campaign, with its
own room ID, player password and DM. Whoever creates a room becomes its DM
through a private DM link. There are no accounts.

- Maps from an image, a blank grid, the built-in map builder, or a
  Universal VTT file from Dungeondraft, Dungeon Alchemist or DungeonFog.
- Fog of war, and party vision with walls, doors, lights, darkvision and
  raised ground.
- Tokens with HP, conditions, elevation and lights. Rulers, movement
  tracking, and areas of effect that count height.
- An initiative tracker, roll requests, an encounter builder, and the SRD
  5.2.1 monsters, conditions and spell areas built in.
- A journal with secrets, map pins, chat and whispers, handouts, an X-card,
  and a table display for a TV.

Dice roll on the server, so everyone sees the same result. Anyone can still
roll real dice and type the total.

One Node 24 process serves the React app, the JSON API and the WebSocket.
Postgres holds the rooms, and uploaded images live on a volume. In
production it runs with Docker Compose behind any HTTPS reverse proxy or
tunnel that passes WebSockets through.

- [Docs](#docs) lists the guides for running, developing and releasing it.
- [CREDITS.md](CREDITS.md) lists every piece of third-party art, its source
  and its license. None of the art is AI generated.
- [License](#license): the code is under the GNU AGPL v3.0.

## Features

[FEATURES.md](FEATURES.md) lists what RaccoonVTT does today, grouped by
area, in plain words for the DM and the players. [docs/design/mvp.md](docs/design/mvp.md)
is the planning list behind it, with what comes next and what was skipped.
Update FEATURES.md in the same change that adds, changes or removes a
feature.

The app lists its written docs on a Docs page at `/docs`, linked from Home.
The [DM guide](docs/dm-guide.md) teaches the DM tools step by step, from a
quick start to building maps, running fights and worked scenarios. Update it
too when a change alters a step it describes.

## Quick start

To try it on your own computer with nothing but Docker, run the published
image from [Docker Hub](https://hub.docker.com/r/jwhitlow45/raccoon-vtt)
next to a postgres. Nothing to clone or build:

```bash
mkdir raccoon-vtt-try && cd raccoon-vtt-try
cat > compose.yml <<'EOF'
name: raccoon-try
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: raccoon
      POSTGRES_PASSWORD: raccoon
      POSTGRES_DB: raccoon
    volumes:
      - db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U raccoon -d raccoon"]
      interval: 5s
      timeout: 5s
      retries: 10
  raccoon:
    image: docker.io/jwhitlow45/raccoon-vtt:latest
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      NODE_ENV: development
      DATABASE_URL: postgres://raccoon:raccoon@postgres:5432/raccoon
      PUBLIC_ORIGIN: http://127.0.0.1:9180
    ports:
      - "127.0.0.1:9180:3000"
    volumes:
      - assets:/data/assets
volumes:
  db:
  assets:
EOF
docker compose up -d
```

Then open http://127.0.0.1:9180. Open exactly that address, not
`localhost`, because the WebSocket checks Origin exactly. Create a room on
the Home page. To see the player's side, copy the player link from the
room's Menu and open it in a private window or another browser.

It runs with `NODE_ENV=development`, because production insists on an https
origin, and it listens only on this computer. `docker compose down` stops
it and keeps your rooms. `docker compose down -v` deletes them too. To put
it on the internet, follow
[Self-hosting with the published image](#self-hosting-with-the-published-image).

## Self-hosting with the published image

Each release is also an image on Docker Hub,
`docker.io/jwhitlow45/raccoon-vtt`, for linux/amd64 and linux/arm64. With
it a server needs no copy of this repository and builds nothing: two files
are the whole setup. You need a Linux server with Docker Engine 28 or later
and the Docker Compose plugin 2.31 or later, and a hostname for the site.

Pick a release from the repository's tags, `vX.Y.Z`, and download its two
files into a folder of their own. Replace `<this repository's URL>` with
the GitHub address of this repository:

```bash
mkdir ~/raccoon-vtt && cd ~/raccoon-vtt
tag=vX.Y.Z
curl -fsSLo compose.yml "<this repository's URL>/raw/$tag/selfhost/compose.yml"
curl -fsSLo .env "<this repository's URL>/raw/$tag/selfhost/env.example"
chmod 600 .env
sed -i "s/^POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s|^ROOM_SECRET_KEY=$|ROOM_SECRET_KEY=$(openssl rand -base64 32)|" .env
```

Then open `.env` in an editor. Set `PUBLIC_ORIGIN` to `https://` plus the
hostname, and uncomment `COMPOSE_PROFILES=https` to have Caddy serve it
over HTTPS, or leave it for your own reverse proxy or tunnel. Then start
it:

```bash
docker compose up -d
docker compose ps
```

[docs/self-hosting.md](docs/self-hosting.md#self-hosting-with-the-published-image)
walks through every step, with HTTPS, the firewall rules, updates and
backups.

## Docs

- [docs/self-hosting.md](docs/self-hosting.md): installing a server, its
  settings, HTTPS and the reverse proxy, updating, backups and verifying
  the image.
- [docs/operations.md](docs/operations.md): running it day to day, with the
  admin commands, the admin page and the logs.
- [docs/development.md](docs/development.md): local development, the checks
  and tests, and continuous integration.
- [docs/releasing.md](docs/releasing.md): tagging a release, the image
  workflow, the changelog and the Docker Hub overview.
- [docs/dm-guide.md](docs/dm-guide.md): the DM guide, also in the app at
  `/docs`.
- [docs/design/](docs/design/README.md): the technical design and the
  design note behind each feature.
- [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and
  [CHANGELOG.md](CHANGELOG.md).

## License

The code is under the GNU Affero General Public License v3.0 (AGPL-3.0),
in the [LICENSE](LICENSE) file. In plain words: you may use, change and
share it. If you run a changed copy as a site that other people use, you
must offer those people the source code of your changed version.

The third-party art, the common-password list and the SRD 5.2.1 text that
ship with the app keep their own licenses. [CREDITS.md](CREDITS.md) lists
each one, and [shared/srd/NOTICE.md](shared/srd/NOTICE.md) holds the SRD's
notice.
