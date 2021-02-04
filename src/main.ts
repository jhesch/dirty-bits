import * as core from '@actions/core'
import { detectDirtyBits } from './core'
import { getInputs } from './input'
import { setOutputs } from './output'

async function run(): Promise<void> {
  try {
    const inputs = getInputs()
    const results = await detectDirtyBits(inputs)
    setOutputs(inputs, results)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
