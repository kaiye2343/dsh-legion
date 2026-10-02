# DSH 0.2.0-rc.2 adaptation

Fork of [`wxxb789/dsh-legion`](https://github.com/wxxb789/dsh-legion) retargeted at the
DSH version installed on this machine. Upstream declares
`dshPeerRange: ">=0.1.2-alpha.2 <0.2.0"`; the installed harness is **0.2.0-rc.2**,
which is outside that window.

## Target

| Item | Value |
| --- | --- |
| Installed DSH | `0.2.0-rc.2` (desktop runtime + CLI, confirmed by `dsh --version`) |
| Upstream peer range | `>=0.1.2-alpha.2 <0.2.0` |
| Adapted peer range | `>=0.1.2-alpha.2 <0.3.0` |
| `latestTestedDshVersion` | `0.2.0-rc.2` |
| Node | `^22.19.0 \|\| >=24.0.0` |

## API breaks found and fixed

Each row is a real signature change verified against the installed packages (not prose).

| # | Subsystem | 0.1.x | 0.2.0-rc.2 | Where |
| --- | --- | --- | --- | --- |
| 1 | schemastery | any `^3.18.2` | `~3.18.4` — adds the `Volatile<>` output wrapper, so a schema no longer assigns to its own inferred type | `package.json` |
| 2 | `dsh-settings` class | `SettingsProvider` | `SettingsForms`; `writable` became a getter; `load`/`persist`/`publish` are gone | `tests/settings-fixture.ts` |
| 3 | Settings namespace | plugin called `provider.register(ns, schema)` at runtime | **no `register()` on the service**; the Host derives the namespace as `entry.options.id` and takes the schema from that mount's exported `Config` | `src/settings.ts`, `cordis.patch.yml` |
| 4 | Client settings form | `ctx.settingsScope.bind({ namespace })` | `ctx.configForms.get(entryId)`, addressed by Host Loader entry id | `src/client/index.ts` |
| 5 | Settings scope type | `SettingsScope<T>` | `ConfigForm<T>` (− `ConfigFormSnapshot` for the type-only import) | `src/client/settings-form.ts` |
| 6 | Plugins slot | `'settings.plugin.item'` (keyed) | `'settings.plugins.tab'` (list), `key` → `id`, and `label` is now required | `src/client/index.ts` |
| 7 | Slot inject | `settingsScope` service | `configForms` service | `src/client/index.ts` |
| 8 | Icon | `IconChevronDownOutline14` | `IconChevronDownOutlineMedium` (size suffix dropped) | `src/client/LegionCard.ts` |
| 9 | Session list | `SessionListState.current` | **removed**; the contract now says "navigation belongs to view owners" | `packages/run-receipt-feed/src/client/model.ts` |
| 10 | Main selection | read off `sessions.list` | `ctx.uiSession.adapter.current` binding, whose scope `key` carries the selected Session | `packages/run-receipt-feed/src/client/index.ts` |
| 11 | Subagent registry | — | mounts as `subagents`; needs an `agents` binding before providers satisfy a Specialist | `src/index.ts` (`DELEGATION_INJECT`, unchanged upstream) |
| 12 | Content blocks | `ContentBlock[]` | `readonly ContentBlock[]` in `SubagentResult.output` | `src/execution.ts`, `src/settlement.ts` |
| 13 | Agent creation | `ctx.agentLoop.create(...)` sync | returns `Promise<Agent>` | `tests/continuable-real.spec.ts` |
| 14 | Write acceptance | `ConfigForm.mutate()` → `Promise<void>` | → `Promise<boolean>` | `tests/settings-card.spec.ts` |
| 15 | Test runtime | `stubSettingsScope` | `stubConfigForm` | both client specs |
| 16 | Stream open | `wireStream.open(endpoint, payload, signal)` | `open(endpoint, payload, uplink, peer, signal)` | `packages/run-receipt-feed/tests/remote-transport.spec.ts` |
| 17 | Session events | `assistant/chunk` | gone; usage and finish reasons ride `assistant/message` (+ `stream`) | `tests/run-receipt-telemetry.spec.ts` |
| 18 | Test sessions | `sessions.add(fixture, { current })`, `setCurrent()` | `add(fixture)` only; selection is a view-owner concern | `packages/run-receipt-feed/tests/client-overlay.spec.ts` |

## Build blockers worked around (environment, not code)

These are specific to building inside this sandbox; they are not upstream defects.

| Symptom | Cause | Workaround |
| --- | --- | --- |
| `pnpm install` / `run` → `spawn EPERM` | pnpm spawns lifecycle scripts with piped stdio, which the sandbox denies | run `tsc`/`tsdown` directly |
| `Cannot find package 'ansis'` from tsdown | pnpm's isolated linker junctions each package into `.pnpm`, and Node's ESM resolver walks the *logical* path, where a dependency's siblings are unreachable | `--config.node-linker=hoisted` |
| Vite/Vitest config load → `spawn EPERM` | `optimizeSafeRealPathSync` shells out to `net use` with piped stdio | use `scripts/verify-adaptation.mjs` |

## Verification performed

```sh
# typecheck both surfaces against 0.2.0-rc.2
node node_modules/typescript/bin/tsc -b tsconfig.host.json --force   # 0 errors
node node_modules/typescript/bin/tsc -b tsconfig.client.json --force # 0 errors

# build all three bundles
node node_modules/tsdown/dist/run.mjs
node node_modules/tsdown/dist/run.mjs --config tsdown.bin.config.ts
node node_modules/tsdown/dist/run.mjs --config tsdown.client.config.ts

# the repository's own contract gate
node scripts/verify-public-contract.mjs                              # verified

# runtime adaptation check on a real Cordis context
node scripts/verify-adaptation.mjs                                   # all checks passed
node scripts/verify-settings-namespace.mjs                           # all checks passed
```

`scripts/verify-adaptation.mjs` mounts the built plugin on a live Cordis context
alongside the real `dsh-tools`, `dsh-subagent`, `dsh-subagent-spawn-in-process`,
`dsh-system-prompt`, `dsh-session`, `dsh-llm` and `dsh-settings` services at
0.2.0-rc.2. It asserts:

1. the module exports `name` + `apply`;
2. the plugin applies without throwing;
3. the `role: settings` row mounts, the missing `register` seam is detected, and
   the gap is reported rather than swallowed;
4. all three Specialists compile into an **active** catalog against the live
   subagent registry;
5. each role keeps its own model route — `quick` →
   `workbuddy-global/hy4-preview-f`, `deep` →
   `workbuddy-global/deepseek-v4.1-flash`, `review` → `workbuddy-global/glm-5.3` —
   with three distinct routes, so a Lead steers cost by role; `review` also keeps
   its read-only tool allowlist.

`scripts/verify-settings-namespace.mjs` reproduces the derivation `SettingsForms`
performs (`entry.options.id` + `fiber.runtime.Config`) against the real service,
and asserts the row id in `cordis.patch.yml` matches the entry id the client
card looks up.

### What works on 0.2.0-rc.2

- Plugin loads and mounts; no profile-boot breakage.
- Specialist catalog compiles; per-role model routing is preserved end to end
  for all three roles (`quick`, `deep`, `review`).
- Bounded delegation, cohorts, and ephemeral strategies keep their upstream
  semantics.
- The client bundle builds and its settings form is migrated to `ConfigForm`.
- The `legion` settings namespace is served: on 0.2 the namespace key is the
  Loader entry id, so the bundle patch's Settings row was renamed from
  `legion-settings` to `legion` to match what the client card reads.

### The settings namespace, precisely

DSH 0.2's `SettingsForms` derives a namespace as
`entry.options.id` → schema `entry.fiber.runtime.Config`:

```js
this.revisions.set(entry.id, { ns: entry.options.id, ... })
const schema = entry.fiber?.runtime?.Config
```

So the 0.1.x runtime `register()` call was **never what made the card appear** on
0.2 — the row id is. Two consequences were applied:

- `cordis.patch.yml`: the Settings row id became `legion`, because the id *is*
  the namespace now and the client card reads `LEGION_NAMESPACE`.
- `src/client/index.ts`: `LEGION_HOST_ENTRY_ID` is defined as
  `LEGION_NAMESPACE` rather than restated, so the two halves cannot drift.

`src/settings.ts` still tolerates a Host without `register`: it reports the gap
and falls through to the composition entry, which is what keeps a 0.1.x Host and
a 0.2.x Host on the same code path.

## Known gaps

- The unit suite cannot run here: Vitest boots through Vite, whose Windows
  realpath shim spawns a subprocess the sandbox denies. The two harnesses below
  cover the same host surfaces in-process instead.
