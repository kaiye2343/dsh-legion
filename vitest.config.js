// Pure-JS vitest config for sandbox execution.
// The TS config (vitest.config.ts) triggers Vite's rolldown bundler, which
// calls exec("net use") via optimizeSafeRealPathSync — blocked by the sandbox
// (EPERM on piped stdio spawn). This JS file loads via --configLoader runner,
// which processes the config on the fly without bundling.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWorkspacePackages, resolveWorkspaceInstalledPackage } from './scripts/workspace-packages.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const WORKSPACE_PACKAGES = readWorkspacePackages(ROOT)

const installed = (path) => {
  const separator = path.indexOf('/')
  const packageName = `@deepseek-ai/${separator === -1 ? path : path.slice(0, separator)}`
  const packageRoot = resolveWorkspaceInstalledPackage(ROOT, WORKSPACE_PACKAGES, packageName)
  return separator === -1 ? packageRoot : resolve(packageRoot, path.slice(separator + 1))
}

const officialClientSource = (packageName, sourceDirectory, path, localFallback = `src/${path}`) =>
  process.env.DSH_LEGION_DSH_TEST_SOURCE === undefined
    ? installed(`${packageName}/${localFallback}`)
    : resolve(process.env.DSH_LEGION_DSH_TEST_SOURCE, 'packages/client', sourceDirectory, 'src', path)

export default {
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@deepseek-ai/dsh-api-gateway/client': installed('dsh-api-gateway/lib/types/client/index.js'),
      '@deepseek-ai/dsh-api-session-controller/client': installed('dsh-api-session-controller/lib/types/client/index.js'),
      // DSH 0.2.0 flattened the client entries: each of these packages ships
      // `lib/client.js`, and its `./client` export points there. The 0.1.x
      // `lib/types/client/...` paths no longer contain emitted JS.
      '@deepseek-ai/dsh-client-ui-chat/client': installed('dsh-client-ui-chat/lib/client.js'),
      '@deepseek-ai/dsh-client-ui-conversation/client': installed('dsh-client-ui-conversation/lib/client.js'),
      '@deepseek-ai/dsh-client-ui-renderer/client': installed('dsh-client-ui-renderer/lib/client.js'),
      '@deepseek-ai/dsh-client-ui-renderer/src/client/bind.ts': officialClientSource('dsh-client-ui-renderer', 'ui-renderer', 'client/bind.ts', 'lib/client.js'),
      '@deepseek-ai/dsh-client-ui-renderer/src/client/scoped-slots.tsx': officialClientSource('dsh-client-ui-renderer', 'ui-renderer', 'client/scoped-slots.tsx', 'lib/client.js'),
      '@deepseek-ai/dsh-client-ui-session/client': installed('dsh-client-ui-session/lib/client.js'),
      'react-dom/client': resolve(resolveWorkspaceInstalledPackage(ROOT, WORKSPACE_PACKAGES, 'react-dom'), 'client.js'),
      'react-dom': resolve(resolveWorkspaceInstalledPackage(ROOT, WORKSPACE_PACKAGES, 'react-dom'), 'index.js'),
      'use-sync-external-store/shim/with-selector': resolve(resolveWorkspaceInstalledPackage(ROOT, WORKSPACE_PACKAGES, 'use-sync-external-store'), 'shim/with-selector.js'),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts', 'packages/*/tests/**/*.spec.ts'],
    pool: 'threads',
    singleThread: true,
    server: { deps: { inline: [/@deepseek-ai\/dsh-(?:client-test-runtime|client-ui-renderer|client-ui-session|api-session-controller)/] } },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'packages/*/src/**/*.ts'],
    },
  },
}
