/**
 * Triage the failing specs into "sandbox limitation" vs "real code problem".
 *
 * Several specs shell out with spawnSync/execFileSync. The DSH sandbox denies
 * piped-stdio child spawns, so those calls come back with `status: null` and
 * `stdout: undefined` — indistinguishable from a real failure unless the spec
 * is inspected. This script reads each failing spec's source, looks for child
 * process usage, and reports which failures that explains.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.argv[2] ?? '.'
const fails = process.argv.slice(3)

const SPAWN_RE = /\b(?:spawnSync|execFileSync|execSync|spawn)\s*\(/

for (const spec of fails) {
  const path = join(ROOT, spec)
  let source
  try { source = readFileSync(path, 'utf8') } catch { console.log(`${spec}\tMISSING`); continue }
  const usesSpawn = SPAWN_RE.test(source)
  const spawnLines = source.split(/\r?\n/)
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => SPAWN_RE.test(line))
    .map(([n]) => n)
  console.log(`${spec}\t${usesSpawn ? 'SANDBOX(spawn)' : 'REAL'}\t${spawnLines.join(',')}`)
}
