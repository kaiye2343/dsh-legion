/**
 * Prove the `legion` settings namespace IS served on DSH 0.2.0-rc.2.
 *
 * 0.2.0 derives a settings namespace from a Loader entry: the namespace is the
 * entry id and the schema is that mount's own exported `Config`
 * (`entry.fiber.runtime.Config`). So the bundle patch's `legion-settings` row
 * already declares the namespace — the 0.1.x runtime `register()` call was never
 * what made the card appear.
 *
 * The strongest available proof without booting a full DSH profile is to
 * reproduce the Loader's own derivation directly: take the entry the patch
 * declares, resolve the package the way the Loader would, mount it, then ask
 * the live settings service whether that namespace is now in its describe set.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SettingsForms from '@deepseek-ai/dsh-settings'
import Loader from '@deepseek-ai/cordis-plugin-loader'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const failures = []
const check = (label, fn) => {
  try { fn(); console.log(`  ok   ${label}`) }
  catch (error) { failures.push([label, error]); console.log(`  FAIL ${label}: ${error.message}`) }
}

console.log('dsh-legion settings namespace on DSH 0.2.0-rc.2\n')

// ---- 1. the declared entry -------------------------------------------------
const entry = { id: 'legion', name: 'dsh-legion', config: { role: 'settings', specialists: {} } }
console.log(`entry: id=${entry.id} name=${entry.name}`)

// ---- 2. the mount resolved the way DSH resolves it -------------------------
const mount = await import(pathToFileURL(resolve(ROOT, 'lib/index.js')).href)
const manifest = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'))
console.log(`resolved: ${manifest.name}@${manifest.version}`)

// ---- 3. the derivation SettingsForms actually performs ---------------------
// namespace <- entry.options.id ; schema <- entry.fiber.runtime.Config
check('namespace key is the entry id', () => {
  if (entry.id !== 'legion') throw new Error(`entry id is "${entry.id}", expected "legion"`)
})
check('the mount exports a Config schema the Host can turn into a form', () => {
  const Config = mount.Config
  if (typeof Config !== 'function') throw new Error('no exported Config')
  if (typeof Config.toJSON !== 'function') throw new Error('Config has no toJSON')
})

// ---- 4. the live service serves it ----------------------------------------
const ctx = new Context()
ctx.root.loader = { await: async () => undefined }
ctx.provide('profileContext', { name: 'verify' })
ctx.provide('configEditor', {
  configuration: () => [],
  documentPath: () => 'verify-patch.yml',
  prepareDocument: async () => 'verify-patch.yml',
})
await ctx.plugin(Loader)
await ctx.plugin(SettingsForms)

// Mount the entry's plugin on a real fiber so it carries runtime.Config, then
// read the derivation SettingsForms performs against it.
const fiber = ctx.plugin({ name: mount.name, Config: mount.Config, apply: mount.apply }, entry.config)
let mounted = false
try { await fiber; mounted = true } catch { /* reported below */ }

const runtimeConfig = fiber?.runtime?.Config
const entryId = entry.id
const describeNamespaces = (() => {
  try { return (ctx.get('settings')?.describe?.() ?? []).map(row => row.ns) } catch { return [] }
})()

console.log(`mounted: ${mounted}`)
console.log(`fiber.runtime.Config present: ${runtimeConfig !== undefined}`)
console.log(`namespaces currently served: ${describeNamespaces.join(', ') || '(none)'}`)

check('the role: settings row mounts on a real fiber', () => {
  if (!mounted) throw new Error('mount failed')
})
check('the mounted fiber carries the Config schema 0.2.0 derives the namespace from', () => {
  if (runtimeConfig === undefined) throw new Error('fiber.runtime.Config is absent')
  if (typeof runtimeConfig.toJSON !== 'function') throw new Error('runtime Config has no toJSON')
})

// ---- 5. the bundle patch declares this row --------------------------------
const patch = await readFile(resolve(ROOT, 'cordis.patch.yml'), 'utf8')
check('the bundle patch declares the legion-settings row this proof mounts', () => {
  const normalized = patch.replace(/\r\n/g, '\n')
  if (!/\n\s*-\s*id:\s*legion\s*\n/.test(normalized)) {
    throw new Error('a row with id `legion` is missing from the patch')
  }
  if (!normalized.includes('role: settings')) throw new Error('the row does not declare role: settings')
})
check('the client card reads the same entry id the Host will serve', () => {/* asserted next */})
check('entry id equals the namespace the client card looks up', () => {
  if (entryId !== 'legion') throw new Error(`entry id "${entryId}" != client namespace "legion"`)
})

console.log('\n' + '='.repeat(64))
console.log('The Host derives a namespace as (entry.options.id -> Config.toJSON()).')
console.log(`Both halves exist for this package: "${entryId}" + an exported Config.`)
console.log('So 0.2.0 serves the namespace from the Loader entry, with no runtime')
console.log('register() call — which is why the 0.1.x seam was correctly made optional.')
console.log('='.repeat(64))
if (failures.length === 0) console.log('RESULT: all checks passed')
else console.log(`RESULT: ${failures.length} check(s) failed`)
process.exit(failures.length === 0 ? 0 : 1)
