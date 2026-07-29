# Releasing Dirty Bits

The `main` branch contains source code but does not contain the generated
`dist/` directory. Each release tag points to a release-only commit whose
parent is the exact `main` commit being released. That commit adds the
generated `dist/` files without changing `main` or creating a release
branch.

A full version tag, such as `v3.0.2`, never moves. The corresponding major
tag, `v3`, moves to the latest release in that major series. Minor moving
tags such as `v3.0` are not created.

## Before releasing

Merge all source, dependency, documentation, and configuration changes
intended for the release into `main`, and confirm that the required checks
pass. Choose the next full semantic version in the form `vMAJOR.MINOR.PATCH`.

Do not prepare or commit `dist/` manually. The release workflow installs the
locked dependencies, builds and tests the action, and generates `dist/`.

## Release from the GitHub website

1. Open the repository's **Actions** tab.
2. Select the **Release** workflow.
3. Select **Run workflow**.
4. Leave the branch set to `main`.
5. Enter the full version tag, for example `v3.0.2`.
6. Select **Run workflow** and wait for the run to succeed.

Do not start the process from the **Draft a new release** page. The workflow
creates the release and its generated release notes after the build and tests
pass.

## Release with the GitHub CLI

From any directory, run:

```shell
gh workflow run release.yaml \
  --repo jhesch/dirty-bits \
  --ref main \
  -f version=v3.0.2
gh run watch --repo jhesch/dirty-bits --exit-status
```

Replace `v3.0.2` with the intended version. The second command prompts for a
run when necessary; select the release run that the first command started.

## What the workflow publishes

The workflow verifies that it is running against the current tip of `main`
and that the full version tag does not already exist. It then:

1. Runs the complete build, formatting check, lint, packaging, and test suite.
2. Creates a release-only commit containing the generated `dist/` directory.
3. Creates the full version tag on that commit; this tag is never moved.
4. Moves the major tag to that commit.
5. Creates the GitHub release with generated release notes.

Consumers should normally use the major tag, such as
`jhesch/dirty-bits@v3`, or pin the release commit's full SHA when stronger
reproducibility and supply-chain controls are required. They should not use
`@main`: it is a development branch and intentionally lacks the packaged
entry point required to run the action.

## Failure and recovery

Most failures occur before any tag is pushed and can be corrected on `main`
before starting a new run. The full and major tags are pushed atomically
immediately before the GitHub release is created. If that final release
creation step fails, inspect the failed run before retrying: the tags may
already exist even though the GitHub release does not. In that case, create
the GitHub release for the existing full tag rather than moving or reusing
the full version tag:

```shell
gh release create v3.0.2 \
  --repo jhesch/dirty-bits \
  --verify-tag \
  --generate-notes \
  --title v3.0.2
```
