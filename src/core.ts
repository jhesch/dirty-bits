import * as core from '@actions/core'
import * as github from '@actions/github'
import { GitHub } from '@actions/github/lib/utils'
import { components } from '@octokit/openapi-types'
import { PullRequestEvent, PushEvent, ReleaseEvent, WorkflowDispatchEvent } from '@octokit/webhooks-definitions/schema'
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import minimatch from 'minimatch'
import { Inputs } from './input'
import { OutputNames } from './output'

type DiffEntry = components['schemas']['diff-entry']

/** Results for repo a bit. */
interface BitResults {
  dirty: boolean
  matchedFiles?: string[]
}

/** Maps repo bit name to results. */
interface MatchResults {
  [bitName: string]: BitResults
}

/** Final dirty bit detection results. */
export interface Results {
  /** Indicates all bits are marked clean. */
  allClean: boolean

  /** Indicates all bits are marked dirty. */
  allDirty: boolean

  /** Indicates the reason all bits are assumed dirty. */
  allDirtyReason?: undefined | string

  /** Indicates at least one bit is marked dirty. */
  someDirty: boolean

  /** Match results keyed by repo bit name. */
  bits: MatchResults

  /** Names of clean bits. */
  cleanBits: string[]

  /** Names of dirty bits. */
  dirtyBits: string[]

  /** Base commit used to determine changed files. */
  base: string

  /** Head commit used to determine changed files. */
  head: string

  /** The GitHub HTML compare commits URL for `base` and `head`. */
  compareCommitsUrl: string
}

interface ActionContext {
  /** Octokit client. */
  octokit: InstanceType<typeof GitHub>

  /** Action inputs. */
  inputs: Inputs

  /** Base commit, from inputs or computed. */
  base: string

  /** Head commit, from inputs or computed. */
  head: string

  /** The GitHub HTML compare commits URL for `base` and `head`. */
  compareCommitsUrl: string

  /** Indicates whether all bits are assumed dirty. */
  allDirty: boolean

  /** Indicates the reason all bits are assumed dirty. */
  allDirtyReason?: undefined | string
}

/** Maps repo bit name to a list of patterns. */
export interface Rules {
  [bitName: string]: string[]
}

/**
 * Represents a changed file.
 *
 * Note: `previous_filename` and `current_filename` are mutually
 * exclusive.
 */
interface ChangedFile {
  filename: string
  status: string
  sha: string
  previous_filename?: string | undefined
  current_filename?: string | undefined
}

export function loadRules(rulesFile: string): Rules {
  core.startGroup('Loading rules')
  core.info(`Loading rules from ${rulesFile}`)
  let rules: Rules
  try {
    rules = yaml.load(fs.readFileSync(rulesFile, 'utf8')) as Rules
  } catch (e) {
    throw new Error(`loading rules file ${rulesFile} failed: ${e}`)
  }
  const reserved = new Set<string>(Object.values(OutputNames))
  for (const [bit, patterns] of Object.entries(rules)) {
    if (reserved.has(bit)) {
      throw new Error(`invalid rules file: "${bit}" is a reserved word`)
    }
    core.info(`Patterns for ${bit}: ${patterns.join(',')}`)
  }
  core.endGroup()
  return rules
}

function markAllDirty(ctx: ActionContext, message: string): void {
  core.info(`Marking all repo bits dirty: ${message}`)
  ctx.allDirty = true
  ctx.allDirtyReason = message
}

async function findPreviousRelease(ctx: ActionContext, release: string): Promise<string> {
  const { octokit } = ctx
  const { owner, repo } = ctx.inputs
  // https://docs.github.com/en/rest/reference/repos#list-releases
  const listReleasesResponse = await octokit.repos.listReleases({ owner, repo, per_page: 10 })
  const releases = listReleasesResponse.data.filter(r => !r.draft && !r.prerelease).map(r => r.tag_name)
  core.debug(`Found ${releases.length} published releases`)
  if (releases.length < 2) {
    markAllDirty(ctx, 'unable to find previous release')
    return ''
  }
  if (releases[0] !== release) {
    core.error(`releases[0] ${releases[0]} !== release ${release}`)
    throw new Error(`releases[0] ${releases[0]} !== release ${release}`)
  }
  return releases[1]
}

async function findCommitRange(ctx: ActionContext, eventName: string): Promise<void> {
  if (ctx.inputs.base && ctx.inputs.head) {
    // We already have a commit range from inputs. All we need to do is
    // copy the values up.
    ctx.base = ctx.inputs.base
    ctx.head = ctx.inputs.head
    return
  }
  switch (eventName) {
    case 'pull_request': {
      const pullPayload = github.context.payload as PullRequestEvent
      core.info(`Event: pull request #${pullPayload.number}`)
      ctx.base = pullPayload.pull_request.base.sha
      ctx.head = pullPayload.pull_request.head.sha
      break
    }
    case 'push': {
      const pushPayload = github.context.payload as PushEvent
      core.info(`Event: push ${pushPayload.ref}`)
      ctx.base = pushPayload.before
      ctx.head = pushPayload.after
      break
    }
    case 'release': {
      const releasePayload = github.context.payload as ReleaseEvent
      const currentRelease = releasePayload.release.tag_name
      core.info(`Event: release tag ${currentRelease}`)
      const previousRelease = await findPreviousRelease(ctx, currentRelease)
      core.info(`Previous release tag ${previousRelease}`)
      ctx.base = previousRelease
      ctx.head = currentRelease
      break
    }
    case 'workflow_dispatch': {
      type DispatchPayload = WorkflowDispatchEvent & {
        inputs: { base: string; head: string }
      }
      const dispatchPayload = github.context.payload as DispatchPayload
      ctx.base = dispatchPayload.inputs.base
      ctx.head = dispatchPayload.inputs.head
      core.info(`Event: workflow dispatch ${dispatchPayload.workflow}`)
      core.info(`Commit range from workflow inputs: ${ctx.base}...${ctx.head}`)
      break
    }
    default:
      throw new Error(`unsupported event type "${eventName}"`)
  }
}

/** Extracts relevant properties from diff entries. */
function extract(entry: DiffEntry): ChangedFile {
  const { filename, status, sha } = entry
  const e = { filename, status, sha } as ChangedFile
  if (status === 'renamed') {
    e.previous_filename = entry.previous_filename
  }
  return e
}

/**
 * Extracts relevant properties from diff entries, replacing filename
 * with the old name prior to rename and sets `current_filename`.
 */
function extractRenamed(entry: DiffEntry): ChangedFile {
  const { filename, status, sha, previous_filename } = entry
  return { filename: previous_filename ?? '', status, sha, current_filename: filename }
}

export async function compareCommits(ctx: ActionContext): Promise<ChangedFile[]> {
  if (ctx.allDirty) {
    // There was a problem that caused all bits to be marked dirty, so
    // there's no point in continuing.
    return []
  }
  const { octokit, base, head } = ctx
  const { owner, repo } = ctx.inputs
  core.info(`Comparing ${base}...${head}`)
  const nullCommit = '0000000000000000000000000000000000000000'
  if (base === nullCommit || head === nullCommit) {
    markAllDirty(ctx, `null commit (${nullCommit}) found`)
    return []
  }
  // https://docs.github.com/en/rest/reference/repos#compare-two-commits
  const response = await octokit.repos.compareCommits({ owner, repo, base, head })
  ctx.compareCommitsUrl = response.data.html_url
  const numCommits = response.data.commits.length
  const totalCommits = response.data.total_commits
  if (numCommits < totalCommits) {
    // Too many commits; mark all bits dirty.
    markAllDirty(ctx, `${base}...${head} includes ${totalCommits} commits (max ${numCommits})`)
    return []
  }
  const changedFiles = response.data.files.map(extract)
  // Append the previous filename of each renamed file to the dirty
  // list.
  const previousFiles = response.data.files.filter(f => f.status === 'renamed').map(extractRenamed)
  const allChangedFiles = changedFiles.concat(previousFiles)
  if (core.isDebug()) {
    core.startGroup('Changed files from compareCommits:')
    allChangedFiles.map(f => core.debug(f.filename))
    core.endGroup()
  }
  return allChangedFiles
}

export function match(ctx: ActionContext, rules: Rules, changedFiles: ChangedFile[]): MatchResults {
  if (ctx.allDirty) {
    // There was a problem that caused all bits to be marked dirty, so
    // there's no point in continuing.
    return {}
  }
  const results: MatchResults = {}
  for (const [bitName, patterns] of Object.entries(rules)) {
    core.startGroup(`Matches for ${bitName}`)
    const files = changedFiles.map(f => f.filename)
    let matchedFiles: string[] = []
    for (const p of patterns) {
      if (p.startsWith('!')) {
        matchedFiles = minimatch.match(matchedFiles, p, { matchBase: true })
      } else {
        matchedFiles = matchedFiles.concat(minimatch.match(files, p, { matchBase: true }))
      }
      core.info(`Matches for pattern "${p}":`)
      matchedFiles.map(f => core.info(`  ${f}`))
      if (matchedFiles.length === 0) core.info('  NONE')
    }
    results[bitName] = {
      dirty: matchedFiles.length > 0,
      matchedFiles,
    }
    core.endGroup()
  }
  return results
}

export async function detect(ctx: ActionContext, rules: Rules): Promise<Results> {
  await findCommitRange(ctx, github.context.eventName)
  const changedFiles = await compareCommits(ctx)
  const matchResults = match(ctx, rules, changedFiles)
  const cleanBits: string[] = []
  const dirtyBits: string[] = []
  const bits = matchResults
  if (ctx.allDirty) {
    for (const bitName of Object.keys(rules)) {
      dirtyBits.push(bitName)
      bits[bitName] = { dirty: true }
    }
  } else {
    for (const [bitName, matchResult] of Object.entries(bits)) {
      matchResult.dirty ? dirtyBits.push(bitName) : cleanBits.push(bitName)
    }
  }
  return {
    allClean: dirtyBits.length === 0,
    allDirty: cleanBits.length === 0,
    allDirtyReason: ctx.allDirtyReason,
    someDirty: dirtyBits.length > 0,
    cleanBits,
    dirtyBits,
    bits,
    base: ctx.base,
    head: ctx.head,
    compareCommitsUrl: ctx.compareCommitsUrl,
  } as Results
}

export async function detectDirtyBits(inputs: Inputs): Promise<Results> {
  const octokit = github.getOctokit(inputs.token)
  const ctx = { octokit, inputs } as ActionContext
  const rules = loadRules(inputs.rulesFile)
  return detect(ctx, rules)
}
