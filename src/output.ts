import * as core from '@actions/core'
import * as fs from 'fs'
import { Results } from './core'
import { Inputs } from './input'

export const OutputNames = {
  allClean: 'all-clean',
  allDirty: 'all-dirty',
  someDirty: 'some-dirty',
  cleanBits: 'clean-bits',
  dirtyBits: 'dirty-bits',
  results: 'json-results',
}

export function setOutputs(inputs: Inputs, results: Results): void {
  core.setOutput(OutputNames.allClean, results.dirtyBits.length === 0)
  core.setOutput(OutputNames.allDirty, results.cleanBits.length === 0)
  core.setOutput(OutputNames.someDirty, results.dirtyBits.length > 0)
  results.cleanBits.map(bit => core.setOutput(bit, 'clean'))
  results.dirtyBits.map(bit => core.setOutput(bit, 'dirty'))
  const cleanBits = results.cleanBits.join(' ')
  const dirtyBits = results.dirtyBits.join(' ')
  core.info(`Clean bits: ${cleanBits}`)
  core.info(`Dirty bits: ${dirtyBits}`)
  core.setOutput(OutputNames.cleanBits, cleanBits)
  core.setOutput(OutputNames.dirtyBits, dirtyBits)
  if (inputs.resultsFile) {
    fs.writeFileSync(inputs.resultsFile, JSON.stringify(results, null, 2))
    core.info(`Wrote results to ${inputs.resultsFile}`)
  }
  // Matched files are included in the results file but not in the
  // string output.
  for (const matchResult of Object.values(results.bits)) {
    delete matchResult.matchedFiles
  }
  core.setOutput(OutputNames.results, results)
}
