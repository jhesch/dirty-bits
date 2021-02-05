import * as github from '@actions/github'
import { Octokit } from '@octokit/rest'
import { compareCommits, detect, loadRules, match, Rules } from '../src/core'
import { Inputs } from '../src/input'

import nock = require('nock')

nock.disableNetConnect()

describe('load rules', () => {
  test('simple', async () => {
    const rules = loadRules('__tests__/rules.yaml')
    expect(rules.backend).toHaveLength(3)
    expect(rules.backend).toContain('backend/version.sh')
    expect(rules.frontend).toHaveLength(5)
    expect(rules.frontend).toContain('frontend/version.sh')
  })
  test('catch reserved words', async () => {
    expect(() => {
      const rules = loadRules('__tests__/rules-reserved.yaml')
    }).toThrowError('invalid rules file: "some-dirty" is a reserved word')
  })
})

describe('compare commits', () => {
  const octokit = new Octokit()
  const owner = 'octocat'
  const repo = 'Hello-World'
  const base = 'v1.0.0'
  const head = 'v1.0.1'

  test('simple case', async () => {
    const mockRequest = nock('https://api.github.com')
      .get(path => path.includes('compare'))
      .reply(200, {
        commits: [],
        total_commits: 0,
        files: [
          {
            sha: 'bbcd538c8e72b8c175046e27cc8f907076331401',
            filename: 'file1.txt',
            status: 'added',
          },
        ],
      })
    const files = await compareCommits({ octokit, base, head, inputs: { owner, repo } } as any)
    expect(mockRequest.isDone()).toBeTruthy()
    expect(files).toHaveLength(1)
    expect(files[0].filename).toEqual('file1.txt')
    expect(files[0].sha).toEqual('bbcd538c8e72b8c175046e27cc8f907076331401')
    expect(files[0].previous_filename).toBeUndefined()
    expect(files[0].current_filename).toBeUndefined()
  })

  test('renamed file is appended', async () => {
    const mockRequest = nock('https://api.github.com')
      .get(path => path.includes('compare'))
      .reply(200, {
        commits: [],
        total_commits: 0,
        files: [
          {
            sha: '3a62183a291a269534afb8eeee1e400dab6f9921',
            filename: 'functions/src/composite/buildHandler.ts',
            status: 'renamed',
            previous_filename: 'functions/src/composite.ts',
          },
        ],
      })
    const files = await compareCommits({ octokit, base, head, inputs: { owner, repo } } as any)
    expect(mockRequest.isDone()).toBeTruthy()
    expect(files).toHaveLength(2)
    expect(files[0].filename).toEqual('functions/src/composite/buildHandler.ts')
    expect(files[0].sha).toEqual('3a62183a291a269534afb8eeee1e400dab6f9921')
    expect(files[0].previous_filename).toEqual('functions/src/composite.ts')
    expect(files[0].current_filename).toBeUndefined()
    expect(files[1].filename).toEqual('functions/src/composite.ts')
    expect(files[1].sha).toEqual('3a62183a291a269534afb8eeee1e400dab6f9921')
    expect(files[1].previous_filename).toBeUndefined()
    expect(files[1].current_filename).toEqual('functions/src/composite/buildHandler.ts')
  })
})

test('match', () => {
  const ctx = {} as any
  const rules = {
    backend: ['backend/**/*.go'],
    frontend: ['frontend/**', 'app.yaml', '!*/app.yaml', '!README.md', '!*.sh', 'frontend/version.sh'],
    worker: ['worker/**'],
  } as Rules
  const changedFiles = [
    { filename: 'app.yaml' },
    { filename: 'backend/README.md' },
    { filename: 'backend/app.yaml' },
    { filename: 'backend/main.go' },
    { filename: 'backend/foo.go' },
    { filename: 'backend/bar.go' },
    { filename: 'backend/version.sh' },
    { filename: 'frontend/src/app/main.ts' },
    { filename: 'frontend/src/app/app.module.ts' },
    { filename: 'frontend/README.md' },
    { filename: 'frontend/deploy.sh' },
    { filename: 'frontend/version.sh' },
  ]
  const matchResult = match(ctx, rules, changedFiles as any[])
  expect(matchResult.backend.dirty).toBeTruthy()
  expect(matchResult.backend.matchedFiles).toHaveLength(3)
  expect(matchResult.backend.matchedFiles).toContain('backend/main.go')
  expect(matchResult.frontend.dirty).toBeTruthy()
  expect(matchResult.frontend.matchedFiles).toHaveLength(4)
  expect(matchResult.frontend.matchedFiles).toContain('frontend/version.sh')
  expect(matchResult.worker.dirty).toBeFalsy()
  expect(matchResult.worker.matchedFiles).toHaveLength(0)
})

describe('release event', () => {
  const octokit = new Octokit()
  const rules = { frontend: ['frontend/**'] } as Rules
  const inputs = {} as Inputs
  github.context.eventName = 'release'
  github.context.payload = { release: { tag_name: 'v1.0.0', draft: false, prerelease: false } }

  test('no previous release', async () => {
    const mockRequest = nock('https://api.github.com')
      .get(path => path.includes('releases'))
      .reply(200, [{ tag_name: 'v1.0.0', draft: false, prerelease: false }])
    const ctx = { octokit, inputs } as any
    const results = await detect(ctx, rules)
    expect(mockRequest.isDone()).toBeTruthy()
    expect(results.bits.frontend.dirty).toBeTruthy()
    expect(results.dirtyBits).toHaveLength(1)
    expect(results.dirtyBits).toContain('frontend')
    expect(results.allDirty).toBeTruthy()
    expect(results.allDirtyReason).toBe('unable to find previous release')
  })
})
