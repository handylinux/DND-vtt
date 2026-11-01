# Releasing

How a maintainer cuts a release: the version bump, the changelog, the tag,
the Image workflow that builds, signs and publishes the image, and the
Docker Hub overview.

## Releasing

For maintainers. The image is built and pushed to Docker Hub only by GitHub
Actions, in [`.github/workflows/image.yml`](../.github/workflows/image.yml),
never from a laptop.

The Node image is pinned in `Dockerfile`'s `ARG NODE_IMAGE` and is updated by hand.

Once, before the first tag, create the repository `raccoon-vtt` on Docker
Hub under the namespace the image uses, and make it public. A repository
that a push creates takes the account's default visibility, which can be
private, and hosts could not pull it. The workflow also counts a version
as absent only when Docker Hub answers "not found", which needs the
repository to exist.

1. On main, bump `version` in `package.json` to the new `X.Y.Z` and run
   `pnpm selfhost`, which writes the new `X.Y` into `selfhost/`, and
   `pnpm readme-button`, which draws the new version into the Docker Hub
   button at the top of the README (it needs Chrome).
2. Regenerate the changelog before tagging. Replace `X.Y.Z` with the new
   version:

   ```sh
   docker run --rm -v "$PWD:/app" -w /app ghcr.io/orhun/git-cliff/git-cliff:2.14.2 --config cliff.toml --tag vX.Y.Z -o CHANGELOG.md
   ```

   Leave out Docker's `--user` flag. The image's entrypoint already writes
   the file as the owner of the mounted folder, and `--user` makes it fail
   with a `setpriv` error on a Mac.

   Commit the version bump and all generated files, including CHANGELOG.md.
   Unit tests fail while the generated files or newest released changelog
   heading are out of date.
3. Wait for CI to pass on that commit.
4. Tag the commit `vX.Y.Z` and push the tag.

The tag starts the Image workflow. It checks that the tag matches
`package.json`, that the commit is on main and that CI passed on that exact
commit, and builds the arm64 image on an arm64 runner. Then the publish
job waits for a reviewer to approve the `dockerhub` environment on the
run's page, once. After the approval it builds the amd64 image and runs
the smoke test (`selfhost/smoke-test.sh`): the image comes up healthy with
`selfhost/compose.yml`, and the files its services mount match `docker/`
byte for byte. It then pushes amd64 and arm64 from the same build, checks
that the amd64 image pushed is the one it tested, and signs the
multi-architecture digest with Cosign, retrying up to three times, before
tagging `X.Y.Z` or moving `X.Y` and `latest`. After publication succeeds,
a read-only job generates the release notes, and a separate job creates the
GitHub Release.
An existing GitHub Release is left unchanged on a rerun.

Tags only move forward, by what Docker Hub holds. A release always tags
`X.Y.Z`. It moves `X.Y` and `latest` only when that tag does not exist yet
or holds this release or an older one, and otherwise leaves it with a
warning naming the version it keeps. So a patch to an older minor, an
older release that finishes last, or a re-run of an older one never moves a
host back, and a tag whose release failed holds nothing back.

A version already on Docker Hub is never rebuilt or replaced: to change
one, release the next patch. The one exception is a run that pushed
`X.Y.Z` and then stopped before `X.Y` or `latest`. Run it again: it finds
`X.Y.Z` from the same commit, signs that digest and adds the floating tags.
If signing exhausts retries before `X.Y.Z` exists, no tag moves and a rerun rebuilds.
A run that finds `X.Y.Z` from another commit refuses.

Releases run one at a time, so push one tag at a time and let its run
finish before you push the next. GitHub keeps only one run waiting for the
slot, and a release waiting behind another is cancelled when a third
arrives.

The `dockerhub` environment, in the repository's settings, holds the
secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (a Docker Hub personal
access token, with the permission that
[The Docker Hub overview](#the-docker-hub-overview) names), admits only
`v*` tags and has a required reviewer. A `DOCKERHUB_NAMESPACE` variable
there publishes under another namespace than the username. A push to a
`ci/` branch that changes the image or `selfhost/`, and a run of Image
started by hand from the Actions tab, build and smoke-test without pushing.

### The Docker Hub overview

The Docker Hub repository's overview comes from
[`selfhost/DOCKERHUB.md`](../selfhost/DOCKERHUB.md), and its short description
from `selfhost/DOCKERHUB-short.txt`, which says the same as the
Dockerfile's description label (a unit test checks that). A release does
not send them. Send them by hand whenever either file changes:

1. Release the change as usual, so a `vX.Y.Z` tag carries it.
2. In the Actions tab, open Docker Hub description
   ([`.github/workflows/dockerhub-description.yml`](../.github/workflows/dockerhub-description.yml)),
   choose Run workflow, and pick that tag under "Use workflow from".
3. Approve the `dockerhub` environment on the run's page, once.

It sends the two files as they are at that tag, with this repository's
address filled into the overview's links. The environment refuses a run on
a branch, so a fix to the overview reaches Docker Hub only once a release
tag carries it.

It signs in with the same `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` as a
release, so that token needs the Repo Read, Write, Delete permission.
Pushing images needs only Read & Write, but changing a repository's
description takes Read, Write, Delete. With less, Docker Hub may refuse the
change, and the run's error names the permission.
