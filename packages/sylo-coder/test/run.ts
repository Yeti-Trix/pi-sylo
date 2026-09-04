/**
 * sylo-coder test entry point.
 *   npx tsx packages/sylo-coder/test/run.ts
 *
 * Runs the matching-scenario corpus + the tool-execute integration suite,
 * prints a combined summary, and exits non-zero on any failure.
 */
import { runMatchingScenarios, runMultiScenarios, summarize } from './harness.ts'
import { runToolExecuteSuite } from './tool-execute.ts'

async function main(): Promise<void> {
  runMatchingScenarios()
  runMultiScenarios()
  await runToolExecuteSuite()
  summarize()
}

await main()