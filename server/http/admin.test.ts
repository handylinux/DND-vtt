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
    "The room The Long Campaign (ABCD-2345) has a log archive of 2.1 GB, more than a room's storage quota of 1.1 GB. Log archives are kept outside the quota, so one can grow until free disk reaches its floor, where log archiving and image uploads stop for every room.",
  );
  assert.equal(
    archiveWarning(room(300_000_000), QUOTA, 3 * GB, FLOOR),
    "Free space on the database's disk (3.0 GB) is near its 2.1 GB floor. Under it, log lines are not archived and images cannot be uploaded in any room. The largest log archive is the room The Long Campaign (ABCD-2345), at 300 MB.",
  );
  assert.match(archiveWarning(room(300_000_000), QUOTA, GB, FLOOR) ?? "", /^Free space on the database's disk \(1\.0 GB\) is under its 2\.1 GB floor\./);
  assert.equal(archiveWarning(null, QUOTA, GB, FLOOR), "Free space on the database's disk (1.0 GB) is under its 2.1 GB floor. Under it, log lines are not archived and images cannot be uploaded in any room.", "with no archive to name, the disk alone");
  assert.equal(archiveWarning(room(2 * QUOTA), QUOTA, null, FLOOR)?.startsWith("The room The Long Campaign"), true, "a disk that cannot be read still leaves the quota rule");
  assert.equal(archiveWarning(room(100), QUOTA, 2 * FLOOR, FLOOR), null, "twice the floor free is not near it");
});
