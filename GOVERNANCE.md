# Governance

raccoon-vtt is a small project with one maintainer. This page explains how
decisions are made, who does what, and how the project can carry on if the
maintainer has to step away.

## How decisions are made

The project uses a single-maintainer model: the maintainer makes the final
call on what the app does, what is merged and when a release goes out.
Anyone can help shape that call, and the discussion happens in public.

- Bug reports and ideas start as GitHub issues, through the bug report and
  feature request templates. They are discussed on the issue, where
  anyone can read along and join in.
- A larger feature gets a design note in [docs/design/](docs/design/README.md)
  before it is built. The note records what was asked for, the rules the
  feature must follow and the cases it is tested against, so the reasoning
  stays public long after the decision.
- Contributions arrive as pull requests, which the maintainer reviews. A
  change is accepted when it fits the project's direction
  ([ROADMAP.md](ROADMAP.md)), follows [CONTRIBUTING.md](CONTRIBUTING.md),
  comes with tests and passes every check.
- Every change to `main`, the maintainer's own included, has to pass the
  required **CI passed** check first. The repository's rules allow no
  exceptions to this.
- When people disagree, the maintainer reads the arguments on the issue or
  pull request, decides, and explains the decision there.

The maintainer may change this page the same way as any other file, in a
public commit.

## Roles and responsibilities

| Role | Who | Responsibilities |
| --- | --- | --- |
| Maintainer | The person behind the GitHub account that owns this repository, as its address, `jwhitlow45/raccoon-vtt`, shows | Sets the project's direction and keeps [ROADMAP.md](ROADMAP.md) current. Triages issues and reviews and merges pull requests. Answers vulnerability reports and ships their fixes as [SECURITY.md](SECURITY.md) promises. Cuts releases as [docs/releasing.md](docs/releasing.md) describes, including approving each one's publication to Docker Hub. Keeps dependencies and documentation current. Enforces the [code of conduct](CODE_OF_CONDUCT.md). Holds the repository's settings, the Docker Hub repository and the release secrets. |
| Contributor | Anyone who opens an issue or a pull request. GitHub lists everyone whose commits have landed on its [contributors page](https://github.com/jwhitlow45/raccoon-vtt/graphs/contributors). | Follows [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md). Adds tests for each change and describes how it was checked. Certifies the Developer Certificate of Origin for each pull request. |
| Security reporter | Anyone who finds a vulnerability | Reports it privately, as [SECURITY.md](SECURITY.md) explains, and keeps the details private until a fix is out. |

The people who run their own servers are the project's users rather than a
role in it. [docs/self-hosting.md](docs/self-hosting.md) explains how to
keep a server updated and backed up.

## Releases

The maintainer decides when a release is ready. Versions follow Semantic
Versioning, and each one is a `vX.Y.Z` tag on a commit of `main` that has
passed CI. GitHub Actions then builds the image, signs it and the
release's source archive, and publishes them, so no release is ever built
on a personal computer. [docs/releasing.md](docs/releasing.md) has every
step, and [CHANGELOG.md](CHANGELOG.md) lists what each release changed.
Only the latest release receives security fixes.

## Continuity

Everything the project needs to keep going lives in this repository and
its GitHub settings: the code, the documentation, the tests, and the
workflows that build, test, sign and publish each release. Releases are
signed with short-lived keys issued to the workflow run itself, so there
is no long-lived signing key to hand over. Whoever holds admin rights on
the repository can triage issues, merge changes and cut a release. To
publish images under a Docker Hub account of their own, they put that
account's username and token in the `dockerhub` environment's secrets, as
[docs/releasing.md](docs/releasing.md) describes.
