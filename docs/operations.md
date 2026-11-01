# Operations

Running a RaccoonVTT server day to day: the admin commands, the admin page,
the logs, and changing the database password. Installing, updating and
backing up a server are in [self-hosting.md](self-hosting.md), where
[Sizing](self-hosting.md#sizing) says how much disk the backups need.

The commands here are written for a server that builds its own image, with
`-f docker-compose.server.yml`. On a server that runs the published image,
leave that out, as
[Make your group's room](self-hosting.md#4-make-your-groups-room) says.

## Admin commands

All of them run inside the app container:

```bash
docker compose -f docker-compose.server.yml exec raccoon node scripts/admin.ts help
```

| Command | What it does |
| --- | --- |
| `list-rooms` | every room with its last activity and size |
| `create-room <name> <dmName>` | a new room, bypassing the creation limits. Prints the password, the player link and the DM link |
| `pin <roomId>` / `unpin <roomId>` | a pinned room is never unloaded to make space |
| `dm-link <roomId>` | replaces the DM link and prints the new one. Every DM device is signed out. Use it when every DM device and the link are lost |
| `import <file.zip> [dmName]` | restores a room export, for exports too big for the site's 95 MB upload limit |
| `hash-password` | makes the `ADMIN_PASSWORD_HASH` line that turns on the admin page (below) |

Room IDs work with or without the dash.

To import an export, copy it onto the asset volume first, import it, then
delete the copy:

```bash
docker compose -f docker-compose.server.yml exec raccoon mkdir -p /data/assets/import
docker compose -f docker-compose.server.yml cp ./room-export.zip raccoon:/data/assets/import/room-export.zip
docker compose -f docker-compose.server.yml exec raccoon node scripts/admin.ts import /data/assets/import/room-export.zip "Dana"
docker compose -f docker-compose.server.yml exec raccoon rm /data/assets/import/room-export.zip
```

The import makes a new room with a new ID, a new player password and a new
DM link, and prints them with the player link. It uses a temporary folder of
its own, so it is safe to run while the site is in use.

## Admin page

The page at `https://<your host>/admin` lists every room with its size,
images, last activity and whether it is loaded, shows the storage the server
uses and the last backups, and pins, unpins or deletes rooms. It never shows
what is in a room and cannot enter one. It is off until the server has an
admin password: without one, `/admin` is the not-found page.

To turn it on:

1. Make the password's hash. It asks for a password of 16 or more
   characters twice, without showing it, or makes one when you press Enter:

   ```bash
   cd ~/raccoon-vtt
   docker compose -f docker-compose.server.yml run --rm --no-deps raccoon node scripts/admin.ts hash-password
   ```

2. Open `.env` in an editor and paste the line it printed, as it is. It
   looks like `ADMIN_PASSWORD_HASH='$argon2id$v=19$...'`. The single quotes
   keep Compose from reading the `$` signs as variables.
3. Restart the app with the new setting:

   ```bash
   docker compose -f docker-compose.server.yml up -d
   ```

4. Open `https://<your host>/admin` and sign in. A session lasts 12 hours.

Five wrong passwords from one address close the login to it for a while,
and 50 from anywhere in an hour close it for an hour. The CLI always works.
Changing the hash signs every admin out. To turn the page off, delete the
line from `.env` and run `docker compose -f docker-compose.server.yml up -d`
again.

Deleting a room there is the same as the DM's delete: its players are sent
out at once, and its images go too unless another room uses them.

## Logs

```bash
docker compose -f docker-compose.server.yml logs -f raccoon
docker compose -f docker-compose.server.yml logs egress
docker compose -f docker-compose.server.yml logs backup
```

The backup log has one line per run, `good` or why it was not.

The egress log lists every outbound destination the app asked for, allowed
(`TCP_TUNNEL`) or refused (`TCP_DENIED`). The pairs of
`error:transaction-end-before-headers` lines from 127.0.0.1 every 30 seconds
are its health check. Containers use Docker's `local` log driver, which
rotates on its own.

## Changing the database password

Postgres reads `POSTGRES_PASSWORD` only when it creates the database, so
changing `.env` alone breaks the app's login. Change it in postgres first:

```bash
docker compose -f docker-compose.server.yml exec postgres psql -U raccoon -d raccoon -c '\password raccoon'
```

Then put the same value in `.env` as `POSTGRES_PASSWORD` and restart the app:

```bash
docker compose -f docker-compose.server.yml up -d raccoon
```
