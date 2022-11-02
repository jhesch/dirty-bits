import * as core from '@actions/core'

export interface Inputs {
  token: string
  rulesFile: string
  resultsFile: string
  owner: string
  repo: string
  base: string
  head: string
  rewriteNullCommit: boolean
}

export function getInputs(): Inputs {
  const inputs = {} as Inputs
  inputs.token = core.getInput('token', { required: true })
  inputs.rulesFile = core.getInput('rules-file', { required: true })
  core.debug(`Rules file: ${inputs.rulesFile}`)
  inputs.resultsFile = core.getInput('results-file')
  core.debug(`Results file: ${inputs.resultsFile}`)
  const repository = core.getInput('repository', { required: true })
  const [owner, repo] = repository.split('/')
  if (!owner || !repo) {
    throw new Error(`invalid repository ${repository}; expected format: {owner}/{repo}`)
  }
  inputs.owner = owner
  inputs.repo = repo
  core.debug(`Repo: ${inputs.owner}/${inputs.repo}`)
  inputs.base = core.getInput('base')
  inputs.head = core.getInput('head')
  if ((inputs.base && !inputs.head) || (inputs.head && !inputs.base)) {
    throw new Error('base and head must be specified together')
  }
  if (inputs.base && inputs.head) {
    core.debug(`Commit range: ${inputs.base}...${inputs.head}`)
  }
  inputs.rewriteNullCommit = core.getInput('rewrite-null-commit') === 'true'
  return inputs
}
