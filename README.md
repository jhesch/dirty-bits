<p align="center">
  <a href="https://github.com/jhesch/dirty-bits/actions?query=workflow%3Abuild-test"><img alt="Dirty Bits build-test status" src="https://github.com/jhesch/dirty-bits/workflows/build-test/badge.svg"></a>
</p>

# Dirty Bits GitHub action

> Exposes your repo's dirty bits

Dirty Bits is a GitHub action that identifies the parts of a repository
that need to be built, tested, deployed, etc. depending on which files
have changed.

Maybe you have a monorepo and a slick CI/CD system. Maybe you want to be
able to tweak the frontend without having to build and test the backend
unnecessarily. Maybe the indexer shouldn't be deployed when the only
thing that changed since the last release is the task worker.

Like the [dirty bit](https://en.wikipedia.org/wiki/Dirty_bit) that marks
a memory block as modified and signals that the block needs to
processed, Dirty Bits identifies the parts of a repository that have
been modified and signals that they need to be processed.

## TL;DR

See the [example rules file](#example-rules-file) and the [example
workflow file](#example-usage).
## How it works

Dirty Bits runs as part of a GitHub Actions workflow and detects which
files have been added, removed, updated or renamed. It compares those
files against a set of rules to determine the parts (or "bits") of the
repo that have changed. It marks those bits "dirty" to inform other
steps and jobs in the workflow how to proceed.

The Dirty Bits action can respond to
[pull_request](https://docs.github.com/en/actions/reference/events-that-trigger-workflows#pull_request),
[push](https://docs.github.com/en/actions/reference/events-that-trigger-workflows#push),
[release](https://docs.github.com/en/actions/reference/events-that-trigger-workflows#release)
and
[workflow_dispatch](https://docs.github.com/en/actions/reference/events-that-trigger-workflows#workflow_dispatch)
events. It identifies two commits that represent the state of the
repository before and after the event that triggered the action. Those
commits are referred to as `base` (the repo state before the event) and
`head` (the repo state at the event). In the case of a `release` event,
Dirty Bits will attempt to find the last _published_ release prior to
the the active release and use its tag name as `base`.

The rules are applied to the set of files that differ between `base` and
`head` in order to determine the repo's dirty bits.

If Dirty Bits is unable to determine with confidence which files were
modified, it marks all bits dirty.

## Rules file

You tell Dirty Bits what to do by writing a _rules file_. The rules file
associates a list of patterns with the relevant bits of your repo, and
the patterns instruct Dirty Bits to mark each bit dirty when a changed
file matches. The patterns are similar to
[gitignore](https://git-scm.com/docs/gitignore) patterns. The [filter
pattern cheat
sheet](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions#filter-pattern-cheat-sheet)
from the GitHub Actions docs provides a useful overview.

If your repo looks like this:

```shell
$ ls
README.md backend/ frontend/ indexer/ lib/ worker/
```

you may want to build the frontend whenever files in the `frontend` or
`lib` directories are touched, but not for changes to `README.md` or
files under `backend`, `indexer` or `worker`.

There might be some files under `frontend` that you do not want to
trigger a build, like other markdown files with a `.md` extension. Any
files included by a previous pattern like `frontend/**` can be excluded
with a negated pattern later in the list, like `!*.md` in the example
below.

### Example rules file

```yaml
backend:
  - 'backend/**'
  - 'lib/**'

frontend:
  - 'frontend/**'
  - 'lib/**'
  - '!*.md'

indexer:
  - 'indexer/**'
  - 'lib/**'

worker:
  - 'worker/**'
  - 'lib/**'
```

Using the rules file above, a change to `frontend/README.md` will match
the `frontend/**` pattern but will be excluded by the later `!*.md`
pattern and will not cause the `frontend` repo bit to be marked dirty.

The repo bit names, like `frontend` in the rules file above, are just
identifiers for you and do not carry any special meaning within Dirty
Bits. In some cases, however, it can be useful to have their names match
corresponding locations in the repo when writing workflow files. See the
final step of the `deploy` job in [Example usage](#example-usage) for an
example.

## Inputs

### `rules-file`

**Required** The path to the YAML rules file containing a list of
patterns for each repo bit.

The rules file should be committed to the repository, perhaps to
`.github/dirty-bits.yaml`.

### `results-file`

If set, Dirty Bits writes its results to a JSON file at this location on
the runner's filesystem. The file includes everything in the
`json-results` output plus the list of files that matched the Dirty Bits
rules for each repo bit. Example value: `${{ runner.temp }}/dirty-bits-results.json`

### `token`

The authentication token to use for GitHub API calls. Defaults to
`github.token` from the [github
context](https://docs.github.com/en/actions/reference/context-and-expression-syntax-for-github-actions#github-context).

### `repository`

The owner and repository name. For example, `Codertocat/Hello-World`.
Defaults to `github.repository` from the [github
context](https://docs.github.com/en/actions/reference/context-and-expression-syntax-for-github-actions#github-context).

### `base`

The commit SHA, branch or tag name that represents the state of the
repository before the event that triggered the action. By default `base`
is automatically detected. Mutually required with `head`.

### `head`

The commit SHA, branch or tag name that represents the state of the
repository at the event that triggered the action. By default `head` is
automatically detected. Mutually required with `base`.

## Outputs

In addition to the explicitly named outputs listed below, there will be
an ouput for each repo bit named in the rules file. The value of the
output for each repo bit is either `clean` or `dirty`.

The [example rules file](#example-rules-file) above might produce the
following outputs:

| Output     | Value   |
| ---------- | ------- |
| `backend`  | `clean` |
| `frontend` | `dirty` |
| `indexer`  | `clean` |
| `worker`   | `dirty` |

Since repo bit names automatically become outputs, the output names
below are considered reserved words and cannot be used as repo bit names
in the rules file.

### `all-clean`

A boolean value to indicate whether all repo bits are marked clean.

### `all-dirty`

A boolean value to indicate whether all repo bits are marked dirty.

### `some-dirty`

A boolean value to indicate whether at least one repo bit is marked
dirty.

### `clean-bits`

A space-separated list of the repo bits that are marked clean. Example
value: `backend indexer`

### `dirty-bits`

A space-separated list of the repo bits that are marked dirty. Example
value: `frontend worker`

### `json-results`

The results as a JSON string.

The [example rules file](#example-rules-file) above might produce the
following `json-results` on a release event with tag `v1.0.2` that
includes changes to `frontend` and `worker` (the output is formatted
here for readability):

```json
{
  "allClean": false,
  "allDirty": false,
  "someDirty": true,
  "cleanBits": [
    "backend",
    "indexer"
  ],
  "dirtyBits": [
    "frontend",
    "worker"
  ],
  "bits": {
    "backend": {
      "dirty": false
    },
    "frontend": {
      "dirty": true
    },
    "indexer": {
      "dirty": false
    },
    "worker": {
      "dirty": true
    }
  },
  "base": "v1.0.1",
  "head": "v1.0.2",
  "compareCommitsUrl": "https://github.com/octocat/hello-world/compare/v1.0.1...v1.0.2"
}
```

`compareCommitsUrl` points to a [GitHub
page](https://docs.github.com/en/github/committing-changes-to-your-project/comparing-commits)
with information about the commits between `base` and `head`, including
the files that were changed.

If Dirty Bits panicked and had to mark all bits dirty, `json-results`
will include a top-level property named `allDirtyReason` with text
describing the problem.

See [Example usage](#example-usage) for an example of how to use
`json-results` in a workflow.

## Example usage

```yaml
name: Dirty Bits example

on:
  release:
    types: [published]

defaults:
  run:
    shell: bash

jobs:
  # Determine which repo bits have changed.
  get-dirty:
    runs-on: ubuntu-latest
    # Make outputs available to the deploy and notify jobs.
    outputs:
      json-results: ${{ steps.dirty-bits.outputs.json-results }}
      some-dirty: ${{ steps.dirty-bits.outputs.some-dirty }}
    steps:
      # Check out the rules file.
      - uses: actions/checkout@v2
      # Detect dirty bits.
      - uses: jhesch/dirty-bits@v1
        id: dirty-bits
        with:
          rules-file: .github/dirty-bits.yaml
      - run: |
          echo These bits are clean: ${{ steps.dirty-bits.outputs.clean-bits }}
          echo These bits are dirty: ${{ steps.dirty-bits.outputs.dirty-bits }}
          echo The frontend bit is ${{ steps.dirty-bits.outputs.frontend }}

  # Deploy the repo bits that changed, and only those bits.
  deploy:
    runs-on: ubuntu-latest
    needs: get-dirty
    # Run the deploy job only if some bits are dirty.
    if: needs.get-dirty.outputs.some-dirty == 'true'
    # Make outputs available to the notify job.
    outputs:
      completed: ${{ steps.complete.outputs.completed }}
    steps:
      - uses: actions/checkout@v2
      # Build and execute a deploy command based on Dirty Bits results.
      - run: |
          gcloud app deploy $(echo '${{ needs.get-dirty.outputs.json-results }}' | \
            jq -r '.dirtyBits | map("\(.)/app.yaml") | join(" ")') -q
      - id: complete
        run: echo "::set-output name=completed::true"

  # Post to Slack on successful deployment.
  notify:
    runs-on: ubuntu-latest
    needs: [get-dirty, deploy]
    # Run the notify job whether or not the deploy job succeeded.
    if: always()
    steps:
      - name: All clean
        if: needs.get-dirty.outputs.some-dirty == 'false'
        run: echo Nothing to deploy
      - name: Failure
        if: |
          needs.get-dirty.outputs.some-dirty == 'true' &&
          needs.deploy.outputs.completed != 'true'
        run: echo Deployment failed
      - name: Success
        if: |
          needs.get-dirty.outputs.some-dirty == 'true' &&
          needs.deploy.outputs.completed == 'true'
        run: |
          curl -s -H 'Content-type: application/json' --data \
            $(echo '${{ needs.get-dirty.outputs.json-results }}' | \
              jq -c '{text: "Deployed: \(.dirtyBits | join(", ")
              )\nChages: <\(.compareCommitsUrl)|\(.base)...\(.head)>"}') \
            ${{ secrets.SLACK_WEBHOOK_URL }}
```

The run step in the example `deploy` job uses
[jq](https://stedolan.github.io/jq/) to map each dirty bit to the
corresponding `app.yaml` file in the bit's directory, resulting in a
command like `gcloud app deploy frontend/app.yaml worker/app.yaml -q`.
Note that this requires naming each bit in the rules file the same as
its directory in the repo.

## Development

When you are developing your workflow and rules files, it can be useful
to execute Dirty Bits on demand with a commit range that you control.
Using the `workflow_dispatch` event, you can define a workflow and
trigger it manually with custom `base` and `head` inputs:

```yaml
on:
  workflow_dispatch:
    inputs:
      base:
        description: Base commit
        required: true
        default: HEAD^
      head:
        description: Head commit
        required: true
        default: HEAD

jobs:
  ...
```
See the [workflow_dispatch
reference](https://docs.github.com/en/actions/reference/events-that-trigger-workflows#workflow_dispatch)
for details.
