import type { Context } from '@deepseek-ai/cordis'
import SettingsForms, { type SettingsNamespace } from '@deepseek-ai/dsh-settings'

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
  constructor(ctx: Context, private readonly fixture: SettingsFixture) {
    super(ctx)
  }

  /** 0.2 keeps form policy on the service; the fixture is always editable. */
  override get writable(): boolean {
    return true
  }

  pushExternal(document: Record<string, unknown>): void {
    for (const [namespace, section] of Object.entries(document)) {
      this.fixture.persist(namespace as SettingsNamespace, section as Record<string, unknown>)
    }
  }
}
