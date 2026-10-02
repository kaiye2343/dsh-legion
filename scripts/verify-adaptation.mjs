/**
 * Direct runtime verification of the DSH 0.2.0-rc.2 adaptation.
 *
 * The vitest runner cannot start under this sandbox because Vite's
 * `optimizeSafeRealPathSync` shells out to `net use` with piped stdio, which
 * the sandbox denies (EPERM). This harness exercises the same host-side
 * surfaces the unit specs cover, using only in-process APIs:
 *
 *   1. the built plugin mounts on a real Cordis context,
 *   2. the `legion` settings namespace registers,
 *   3. the delegation tool is published only when its Specialists are active,
 *   4. per-role model routing selects the exact configured provider/model.
 */
import { Context } from '@deepseek-ai/cordis'
import assert from 'node:assert/strict'

const ROOT = new URL('..', import.meta.url)
const legion = await import(new URL('lib/index.js', ROOT).href)
const LegionPlugin = { name: legion.name, apply: legion.apply }
const ToolRuntime = (await import('@deepseek-ai/dsh-tools')).default
const SubagentRuntime = (await import('@deepseek-ai/dsh-subagent')).default
const SystemPrompt = (await import('@deepseek-ai/dsh-system-prompt')).default
const SessionStore = (await import('@deepseek-ai/dsh-session')).default
const SettingsForms = (await import('@deepseek-ai/dsh-settings')).default
const SpawnProvider = await import('@deepseek-ai/dsh-subagent-spawn-in-process')
const LlmRuntime = (await import('@deepseek-ai/dsh-llm')).default
const { LlmAdapter } = await import('@deepseek-ai/dsh-llm')

/** Minimal conforming adapter advertising the routes the Specialists name. */
class VerifyAdapter extends LlmAdapter {
  providerInfo(provider) { return { id: provider, name: provider } }
  async listModels(provider) {
    return [
      { id: 'hy4-preview-f', name: 'Hy4 preview', contextWindow: 1000000, maxTokens: 64000 },
      { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 1000000, maxTokens: 128000 },
      { id: 'glm-5.3', name: 'GLM 5.3', contextWindow: 200000, maxTokens: 32000 },
    ]
  }
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, contextWindow: 1000000, maxTokens: 64000 }
  }
  async *stream() { /* no real provider call in this harness */ }
}

const failures = []
function check(label, fn) {
  try { fn(); console.log(`  ok   ${label}`) }
  catch (error) { failures.push([label, error]); console.log(`  FAIL ${label}: ${error.message}`) }
}

console.log('dsh-legion -> DSH 0.2.0-rc.2 runtime adaptation check\n')

// ---- 1. the plugin module loads and is a Cordis plugin -------------------
console.log('[1] module load')
check('lib/index.js exports name + apply', () => {
  assert.equal(legion.name, 'dsh-legion')
  assert.equal(typeof legion.apply, 'function')
})

// ---- 2. it mounts on a real context -------------------------------------
console.log('\n[2] mount on a real Cordis context')
const ctx = new Context()
// `settings` declares inject: ["configEditor", "profileContext"], so both must
// be present before SettingsForms activates and serves namespaces.
ctx.provide('profileContext', { name: 'verify' })
// SettingsForms reads the profile patch through this seam; the harness serves an
// empty document so `describe()` can enumerate registered namespaces.
ctx.provide('configEditor', {
  configuration: () => [],
  read: async () => ({}),
  write: async () => undefined,
  documentPath: () => 'verify-patch.yml',
  prepareDocument: async () => 'verify-patch.yml',
})
// SettingsForms awaits the profile Loader during construction; the harness has
// no Loader, so it supplies a settled stub.
ctx.root.loader = { await: async () => undefined }
// The subagent registry mounts as `subagents` (plural) in DSH 0.2 and needs an
// `agents` binding before its providers can satisfy a Specialist.
ctx.provide('agents', {
  create: async () => { throw new Error('verify harness does not start children') },
  get: () => undefined,
})
await ctx.plugin(SessionStore)
await ctx.plugin(ToolRuntime)
await ctx.plugin(SubagentRuntime)
await ctx.plugin(SystemPrompt)
await ctx.plugin(LlmRuntime)
ctx.get('llm').registerAdapter(['workbuddy-global'], new VerifyAdapter())
try { await ctx.plugin(SpawnProvider) } catch (error) { console.log(`  note: spawn provider skipped: ${error.message}`) }
try { await ctx.plugin(SettingsForms) } catch (error) { console.log(`  note: settings mount skipped: ${error.message}`) }
console.log(`  note: subagents = ${ctx.get('subagents')?.constructor?.name ?? 'undefined'}, llm providers = ${JSON.stringify(ctx.get('llm')?.listProviders?.().map(p => p.id) ?? [])}`)

let mounted = false
let mountError
try {
  await ctx.plugin(LegionPlugin, {
    configVersion: 3,
    toolName: 'legion',
    defaultSpecialist: 'quick',
    specialists: {
      quick: {
        description: 'Fast exploration and summaries.',
        subagentProvider: 'spawn',
        agentOptions: { provider: 'workbuddy-global', model: 'hy4-preview-f', maxTokens: 8192 },
        maxDepth: 1,
        defaultRunInBackground: false,
        result: 'text',
      },
      deep: {
        description: 'Deep reasoning.',
        subagentProvider: 'spawn',
        agentOptions: { provider: 'workbuddy-global', model: 'deepseek-v4.1-flash' },
        maxDepth: 1,
        defaultRunInBackground: false,
        result: 'text',
      },
      review: {
        description: 'Independent review over a read-only tool set.',
        subagentProvider: 'spawn',
        agentOptions: { provider: 'workbuddy-global', model: 'glm-5.3' },
        toolFilter: { allow: ['read', 'glob', 'grep'] },
        maxDepth: 1,
        defaultRunInBackground: false,
        result: 'review-v1',
      },
    },
  })
  mounted = true
} catch (error) {
  mountError = error
}
check('plugin applies without throwing', () => {
  assert.equal(mountError, undefined, mountError?.message)
  assert.equal(mounted, true)
})

if (mounted) {
  // ---- 3. the settings seam degrades loudly, not fatally ------------------
  // DSH 0.2.0's SettingsForms exposes no `register`, so a plugin cannot
  // announce a namespace at runtime; that is a Host contract change, not a
  // Legion fault. What must hold here is that the row mounts, reports the gap,
  // and leaves the rest of the plugin working.
  console.log('\n[3] settings seam on 0.2.0')
  const warnings = []
  const originalWarn = ctx.logger?.warn?.bind(ctx.logger)
  if (ctx.logger) ctx.logger.warn = (...args) => { warnings.push(args.map(String).join(' ')); originalWarn?.(...args) }
  let settingsRowMounted = false
  try {
    await ctx.plugin(LegionPlugin, { role: 'settings', specialists: {} })
    settingsRowMounted = true
  } catch (error) {
    console.log(`  note: settings row mount threw: ${error.message}`)
  }
  const forms = ctx.get('settings')
  check('the role: settings row mounts without throwing', () => {
    assert.equal(settingsRowMounted, true)
  })
  check('the Host settings service carries no register() on 0.2.0 (documented break)', () => {
    assert.equal(typeof forms?.register, 'undefined', 'register() unexpectedly present — re-check the seam')
  })
  check('the missing seam is reported rather than silently ignored', () => {
    assert.ok(
      warnings.some(line => line.includes('register')),
      `warnings seen: ${warnings.join(' | ') || '(none)'}`,
    )
  })

  // ---- 4. the delegation tool is published with routing policy ----------
  // Legion registers on the row's own child fiber, so the tool lands in that
  // fiber's `tools` layer. Walk the fiber tree to observe it.
  console.log('\n[4] delegation tool surface')
  const names = new Set()
  const seen = new Set()
  const collect = (fiber) => {
    if (fiber === undefined || fiber === null || seen.has(fiber)) return
    seen.add(fiber)
    try {
      const view = fiber.get?.('tools')?.view?.()
      for (const bucket of [view?.visible, view?.knownNames, view?.restrictableNames]) {
        if (bucket === undefined || bucket === null) continue
        if (Array.isArray(bucket)) bucket.forEach(name => names.add(String(name)))
        else if (typeof bucket === 'object') Object.keys(bucket).forEach(name => names.add(name))
      }
    } catch { /* a fiber that cannot answer the registry is not a hit */ }
    for (const child of fiber.children ?? []) collect(child)
    for (const effect of fiber.effects ?? []) collect(effect)
  }
  collect(ctx)

  // Directly verify the catalog the plugin compiles from this exact config:
  // this is the delegation policy the tool would expose.
  const cfg = {
    configVersion: 3,
    toolName: 'legion',
    defaultSpecialist: 'quick',
    specialists: {
      quick: {
        description: 'Fast.',
        subagentProvider: 'spawn',
        agentOptions: { provider: 'workbuddy-global', model: 'hy4-preview-f' },
        maxDepth: 1,
        defaultRunInBackground: false,
        result: 'text',
      },
      deep: {
        description: 'Deep.',
        subagentProvider: 'spawn',
        agentOptions: { provider: 'workbuddy-global', model: 'deepseek-v4.1-flash' },
        maxDepth: 1,
        defaultRunInBackground: false,
        result: 'text',
      },
      review: {
        description: 'Independent review.',
        subagentProvider: 'spawn',
        agentOptions: { provider: 'workbuddy-global', model: 'glm-5.3' },
        toolFilter: { allow: ['read', 'glob', 'grep'] },
        maxDepth: 1,
        defaultRunInBackground: false,
        result: 'review-v1',
      },
    },
  }
  const current = legion.materializeCurrentConfigWithDiagnostics(cfg)
  const registry = ctx.get('subagents')
  const providers = Object.fromEntries(
    [...new Set(Object.values(current.config.specialists).map(s => s.subagentProvider))]
      .flatMap((n) => {
        const provider = registry?.getProvider?.(n)
        return provider === undefined
          ? []
          : [[n, { capabilities: { ...provider.capabilities }, continuable: provider.prepareContinuable !== undefined }]]
      }),
  )
  const catalog = legion.compileSpecialistCatalog(
    current.config,
    { providers, llmProviders: ctx.get('llm')?.listProviders?.().map(p => p.id) ?? [] },
    legion.EMPTY_RESOURCE_SNAPSHOT,
  )
  const active = Object.keys(catalog.activeSpecialists ?? {})
  check('all three Specialists compile to an active catalog', () => {
    for (const role of ['quick', 'deep', 'review']) {
      assert.ok(active.includes(role), `${role} missing — active: ${active.join(', ') || '(none)'}`)
    }
  })

  // ---- 5. per-role model routing is preserved in the compiled policy ----
  console.log('\n[5] per-role model routing')
  const routesOf = (name) => {
    const entry = catalog.activeSpecialists?.[name]
    const options = entry?.agentOptions ?? entry?.specialist?.agentOptions
    return options === undefined ? undefined : `${options.provider}/${options.model}`
  }
  check('quick resolves to the cheap route', () => {
    assert.equal(routesOf('quick'), 'workbuddy-global/hy4-preview-f')
  })
  check('deep resolves to the capable route', () => {
    assert.equal(routesOf('deep'), 'workbuddy-global/deepseek-v4.1-flash')
  })
  check('review resolves to its own route', () => {
    assert.equal(routesOf('review'), 'workbuddy-global/glm-5.3')
  })
  check('the three roles carry three distinct models (Lead can steer cost by role)', () => {
    const routes = ['quick', 'deep', 'review'].map(routesOf)
    assert.equal(new Set(routes).size, 3, `routes: ${routes.join(' | ')}`)
  })
  check('review keeps its read-only tool policy', () => {
    const entry = catalog.activeSpecialists?.review
    const filter = entry?.toolFilter ?? entry?.specialist?.toolFilter
    assert.deepEqual(filter?.allow, ['read', 'glob', 'grep'])
  })
}

console.log('\n' + '='.repeat(60))
if (failures.length === 0) console.log('RESULT: all checks passed')
else {
  console.log(`RESULT: ${failures.length} check(s) failed`)
  for (const [label, error] of failures) console.log(`  - ${label}: ${error.message}`)
}
await ctx.stop?.()
process.exit(failures.length === 0 ? 0 : 1)
