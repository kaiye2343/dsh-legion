import type { Context } from '@deepseek-ai/cordis'
import SettingsForms, { type SettingsDescriptor, type SettingsNamespace } from '@deepseek-ai/dsh-settings'

/**
 * In-memory `ctx.settings` stand-in for the DSH 0.2.0 settings seam.
 *
 * DSH 0.2 replaced the old `SettingsProvider` base (which exposed
 * `load`/`persist`/`publish` hooks) with `SettingsForms`, a profile-patch backed
 * service. The fixture keeps the observable surface Legion's tests rely on —
 * `describe()`, `update()`, `replace()`, `mutate()` and external document
 * commits — while holding the document in memory instead of writing the real
 * profile patch.
 */
export class SettingsFixture {
  private document: Record<string, unknown>
  private provider: MemorySettings | undefined
  private disposeProvider: (() => Promise<void>) | undefined

  constructor(
    stored: Record<string, Record<string, unknown>> = {},
    readonly missFirstGet = false,
  ) {
    this.document = structuredClone(stored)
  }

  async mount(ctx: Context): Promise<void> {
    // `SettingsForms` declares `inject: ["configEditor", "profileContext"]`, so
    // it stays PENDING — and `ctx.get('settings')` stays undefined — unless both
    // are already provided. A test host that only mounts the provider would
    // otherwise hang here rather than fail informatively.
    // SettingsForms awaits the profile Loader during construction; a unit-test
    // root has no Loader, so it gets a settled stub. Only `await` is read, so the
    // narrow cast stands in for the full Loader surface the type demands.
    ctx.root.loader ??= { await: async () => undefined } as unknown as typeof ctx.root.loader
    if (ctx.get('profileContext') === undefined) ctx.provide('profileContext', { name: 'settings-fixture' })
    if (ctx.get('configEditor') === undefined) {
      ctx.provide('configEditor', {
        // `describe()` maps over this; it must be an array of entry records.
        configuration: () => [],
        documentPath: () => 'settings-fixture.yml',
        prepareDocument: async () => 'settings-fixture.yml',
      })
    }
    const fiber = ctx.plugin(MemorySettings, this)
    await fiber
    const provider = ctx.get('settings')
    if (!(provider instanceof MemorySettings)) throw new Error('settings fixture did not mount')
    this.provider = provider
    this.disposeProvider = () => fiber.dispose()
  }

  async unmount(): Promise<void> {
    await this.disposeProvider?.()
    this.disposeProvider = undefined
  }

  get service(): MemorySettings {
    if (this.provider === undefined) throw new Error('settings fixture is not mounted')
    return this.provider
  }

  get registrations(): Map<string, ReturnType<MemorySettings['describe']>[number]> {
    return new Map(this.service.describe().map(descriptor => [descriptor.ns, descriptor]))
  }

  commit(namespace: string, section: Record<string, unknown>): void {
    this.document[namespace] = structuredClone(section)
    this.service.pushExternal(this.document)
  }

  load(): Record<string, unknown> {
    return structuredClone(this.document)
  }

  persist(namespace: SettingsNamespace, section: Record<string, unknown>): void {
    this.document[namespace] = structuredClone(section)
  }
}

class MemorySettings extends SettingsForms {
  /**
   * Namespaces this fixture has been asked to serve, keyed by namespace.
   *
   * DSH 0.2's real `SettingsForms.describe()` derives its rows from Loader
   * entries, which an in-memory double has none of — so it would always answer
   * `[]` and every registration assertion would fail for the wrong reason. The
   * fixture therefore tracks registrations itself and answers `describe()` from
   * that, which is the surface `SettingsFixture.registrations` reads.
   */
  private readonly owned = new Map<string, { ns: SettingsNamespace; base: unknown; schema: unknown }>()

  constructor(ctx: Context, private readonly fixture: SettingsFixture) {
    super(ctx)
  }

  /** 0.2 keeps form policy on the service; the fixture is always editable. */
  override get writable(): boolean {
    return true
  }

  /**
   * The 0.1.x runtime registration seam, reimplemented so `registerSettingsNamespace`
   * — which Legion keeps as a capability-detected fallback — has something to call.
   * The real 0.2 service omits this member, and Legion is built to degrade when it
   * is absent; this double offers it so the registration path stays under test.
   */
  register<Value>(
    namespace: string,
    schema: unknown,
    options?: { base?: Value },
  ): { getSnapshot(): { value: Value | undefined; user: unknown; base: unknown }; subscribe(l: () => void): () => void } {
    this.owned.set(namespace, {
      ns: namespace as SettingsNamespace,
      base: options?.base,
      schema,
    })
    const section = (): Value | undefined => this.fixture.load()[namespace] as Value | undefined
    return {
      getSnapshot: () => ({
        value: section() ?? options?.base,
        user: section(),
        base: options?.base,
      }),
      subscribe: () => () => {},
    }
  }

  /** Rows for every namespace this double was asked to serve. */
  override describe(): SettingsDescriptor[] {
    return [...this.owned.values()].map(entry => ({
      ns: entry.ns,
      autoGenerate: true,
      schema: entry.schema,
      value: this.fixture.load()[entry.ns],
      revision: 0,
      applies: 'live' as const,
    }))
  }

  pushExternal(document: Record<string, unknown>): void {
    for (const [namespace, section] of Object.entries(document)) {
      this.fixture.persist(namespace as SettingsNamespace, section as Record<string, unknown>)
    }
  }
}
