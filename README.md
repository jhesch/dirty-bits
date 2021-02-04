# Dirty Bits GitHub Action

> Exposes your repo's dirty bits

Dirty Bits is a GitHub Action that identifies the parts of a repository
that need to be built, tested, deployed, etc. depending on which files
have changed.

Maybe you have a monorepo and a slick CI/CD system. Maybe you want to be
able to tweak the frontend without having to build and test the backend
unnecessarily. Maybe the indexer shouldn't be deployed too when the only
thing that changed since the last release was the task worker.

Like the [dirty bits](https://en.wikipedia.org/wiki/Dirty_bit) that mark
memory blocks as modified signal that the blocks need to processed,
Dirty Bits identifies the parts of a repository that have been modified
and signals that they need to be processed.

## How it works

You tell Dirty Bits what to do by writing a _rules file_. The rules file
associates a list of patterns with each relevant part (or "bit") of your
repo, and the patterns instruct Dirty Bits to mark each bit dirty when a
changed file matches. The patterns are similar to
[gitignore](https://git-scm.com/docs/gitignore) patterns.

If your repo looks like this:

```shell
$ ls
README.md backend/ frontend/ indexer/ lib/ worker/
```

you may want to build the frontend whenever files in the `frontend` or
`lib` directories are touched, but not for changes to `README.md` or
files under `backend`, `indexer` or `worker`. There might be some files
under `frontend` that you do not want to trigger a build, like other
markdown files with a `.md` extension. Any files included by a previous
patterns like `frontend/**` can be excluded with a negated pattern later
in the list, like `!*.md`:

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
pattern and will not cause the `frontend` bit to be marked dirty.

The repo bit names, like `frontend` in the rules file above, are just
identifiers for you and do not carry any special meaning within Dirty
Bits. In some cases, however, it can be useful to have their names match
the corresponding directories in the repo when writing workflow files.
See [Example usage](#example-usage) for an example.

Dirty Bits responds to
[pull_request](https://docs.github.com/en/actions/reference/events-that-trigger-workflows#pull_request),
[push](https://docs.github.com/en/actions/reference/events-that-trigger-workflows#push)
and
[release](https://docs.github.com/en/actions/reference/events-that-trigger-workflows#release)
events. It identifies two commits that represent the state of the
repository before and after the event that triggered the action. Those
commits are referred to as `base` (the repo state before the event) and
`head` (the repo state at the event). In the case of a `release` event,
Dirty Bits will attempt to find the last _published_ release prior to
the the active release and use its `tag_name` as `base`.

If Dirty Bits is unable to determine with confidence which files were
modified, it marks all bits dirty.

## Inputs

### `rules-file`

**Required** The path to the rules file containing a list of patterns
for each repo bit.

The rules file should be committed to the repository, perhaps to
`.github/dirty-bits-rules.yaml`.

### `results-file`

If set, Dirty Bits writes its results to a JSON file at this location on
the runner's filesystem. The file includes everything in the
`json-results` output plus the list of files that matched the Dirty Bits
rules for each repo bit. Example value: `${{ runner.temp }}/dirty-bits-results.json`

The rules file should be committed to the repository, perhaps to
`.github/dirty-bits-rules.yaml`.

### `token`

The authentication token to use for GitHub API calls. Defaults to
`github.token` from the [github
context](https://docs.github.com/en/actions/reference/context-and-expression-syntax-for-github-actions#github-context).

### `repository`

The owner and repository name. For example, `Codertocat/Hello-World`.
Defaults to `github.repository` from the [github
context](https://docs.github.com/en/actions/reference/context-and-expression-syntax-for-github-actions#github-context).

### `base`

The commit SHA or tag that represents the state of the repository before
the event that triggered the action. By default `base` is automatically
detected. Mutually required with `head`.

### `head`

The commit SHA or tag that represents the state of the repository at the
event that triggered the action. By default `head` is automatically
detected. Mutually required with `base`.

## Outputs

In addition to the explicitly named outputs listed below, there will be
an ouput for each repo bit named in the rules file. The value of the
output for each repo bit is either `clean` or `dirty`.

The example rules file above might produce the following outputs:

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

A space-separated list of the repo bits that are marked as clean.
Example value: `backend indexer`.

### `dirty-bits`

A space-separated list of the repo bits that are marked as dirty.
Example value: `frontend worker`.

### `json-results`

The results as a JSON string.

The example rules file above might produce the following `json-results`
on a release event with tag `v1.0.2` that includes changes to `frontend`
and `worker`:

```json
{
  "cleanBits": ["backend indexer"],
  "dirtyBits": ["frontend worker"],
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

See [Example usage](#example-usage) for an example of how to use
`json-results` in a workflow.

## Example usage

```yaml
name: 'Dirty Bits example'
on:
  release:
    types: [published]

jobs:
  # Determine which repo bits have changed.
  get-dirty:
    runs-on: ubuntu-latest
    outputs:
      json-results: ${{ steps.dirty-bits.outputs.json-results }}
      some-dirty: ${{ steps.dirty-bits.outputs.some-dirty }}
    steps:
      - uses: actions/checkout@v2 # check out the rules file
      - uses: jhesch/dirty-bits@v1
        id: dirty-bits
        with:
          rules-file: .github/dirty-bits-rules.yaml
      - run: |
          echo These bits are clean: ${{ steps.dirty-bits.outputs.clean-bits }}
          echo These bits are dirty: ${{ steps.dirty-bits.outputs.dirty-bits }}
          echo The frontend bit is ${{ steps.dirty-bits.outputs.frontend }}
        shell: bash
  # Deploy the bits that changed, and only those bits.
  deploy:
    runs-on: ubuntu-latest
    needs: get-dirty
    # Skip the deploy job altogether if all clean.
    if: needs.get-dirty.outputs.some-dirty == 'true'
    steps:
      - run: |
          gcloud app deploy $(echo '${{ needs.get-dirty.outputs.json-results }}' \
            | jq -r '.dirtyBits | map("\(.)/app.yaml") | join(" ")')
        shell: bash
```

The run step in the example `deploy` job uses
[jq](https://stedolan.github.io/jq/) to map each dirty bit to the
corresponding `app.yaml` file in the bit's directory, resulting in a
command like `gcloud app deploy frontend/app.yaml worker/app.yaml`. Note
that this requires naming each bit in the rules file the same as its
directory in the repo.
