import {
  discoverBundledSkillPaths,
  discoverBundledSkillPathsFromPiPackages,
  readPiPackageSpecs,
} from '../src/shared/bundled-skill-discovery.ts'

const agent = process.argv[2] ?? `${process.env.USERPROFILE}/.pi/agent`
const cwd =
  process.argv[3] ??
  `${process.env.APPDATA}/@sylo/host/sylo-project`

console.log('agentDir:', agent)
console.log('cwd:', cwd)
console.log('packages:', readPiPackageSpecs(agent, cwd))
const fromPkgs = discoverBundledSkillPathsFromPiPackages(agent, cwd)
console.log('fromPiPackages count:', fromPkgs.length)
for (const p of fromPkgs) console.log(' ', p)
const full = discoverBundledSkillPaths([], agent, cwd)
console.log('discoverBundledSkillPaths count:', full.length)
