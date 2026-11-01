import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveWarning } from "./admin.ts";

const GB = 1_000_000_000;
const FLOOR = 2 * 1024 ** 3;
const QUOTA = 1024 * 1024 ** 2;
const room = (bytes: number) => ({ id: "ABCD2345", name: "The Long Campaign", bytes });

test("the archive warning: past a room's quota, or with the database's disk near or under its floor, naming the largest archive (LOG-OPUS-18)", () => {
  assert.equal(archiveWarning(room(200_000_000), QUOTA, 50 * GB, FLOOR), null, "an ordinary history on a roomy disk says nothing");
  assert.equal(archiveWarning(null, QUOTA, 50 * GB, FLOOR), null, "no archive at all says nothing");
  assert.equal(archiveWarning(room(QUOTA), QUOTA, 50 * GB, FLOOR), null, "an archive of exactly the quota is not past it");
  assert.notEqual(archiveWarning(room(QUOTA + 1), QUOTA, 50 * GB, FLOOR), null, "a byte past it warns");
  assert.equal(
    archiveWarning(room(2 * QUOTA), QUOTA, 50 * GB, FLOOR),
    "The room The Long Campaign (ABCD-2345) has a log archive of 2.1 GB, more than a room's storage quota of 1.1 GB. Log archives are kept outside the quota, so one can grow until the database's disk reaches its floor, where log lines stop being archived in every room. Image uploads stop there too when images are stored on that disk.",
  );
  assert.equal(
    archiveWarning(room(300_000_000), QUOTA, 3 * GB, FLOOR),
    "Free space on the database's disk (3.0 GB) is near its 2.1 GB floor. Under it, log lines are not archived in any room. Image uploads stop at the same floor on the image volume, so they stop too when images are stored on this disk. The largest log archive is the room The Long Campaign (ABCD-2345), at 300 MB.",
  );
  assert.match(archiveWarning(room(300_000_000), QUOTA, GB, FLOOR) ?? "", /^Free space on the database's disk \(1\.0 GB\) is under its 2\.1 GB floor\./);
  assert.equal(archiveWarning(null, QUOTA, GB, FLOOR), "Free space on the database's disk (1.0 GB) is under its 2.1 GB floor. Under it, log lines are not archived in any room. Image uploads stop at the same floor on the image volume, so they stop too when images are stored on this disk.", "with no archive to name, the disk alone");
  assert.equal(archiveWarning(room(2 * QUOTA), QUOTA, null, FLOOR)?.startsWith("The room The Long Campaign"), true, "a disk that cannot be read still leaves the quota rule");
  assert.equal(archiveWarning(room(100), QUOTA, 2 * FLOOR, FLOOR), null, "twice the floor free is not near it");
  // Uploads read the image volume and the archive reads the database's disk, which may be another (FU43-DATA-05).
  for (const words of [archiveWarning(room(2 * QUOTA), QUOTA, 50 * GB, FLOOR), archiveWarning(room(100), QUOTA, GB, FLOOR)]) {
    assert.doesNotMatch(words ?? "", /images cannot be uploaded|image uploads stop for every room/);
    assert.match(words ?? "", /when images are stored on (this|that) disk/);
  }
});
