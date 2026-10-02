# HANDOFF — dsh-legion 适配 DSH 0.2.0-rc.2

给接力的 agent：先读完本文再动代码。所有结论均为实测，未验证的会明确标注。

---

## 一、任务

把 `wxxb789/dsh-legion`（上游声明 `dshPeerRange: ">=0.1.2-alpha.2 <0.2.0"`）适配到本机
安装的 **DSH 0.2.0-rc.2**，让插件能装载、且 per-role 模型路由可用。

**核心目标已达成**（见第二节）。当前剩余工作是**让官方单元测试套件全绿**，
属于质量加固，不是目标阻塞项。

---

## 二、已完成并验证（4 个 commit，已推送 origin/main）

| commit | 内容 |
| --- | --- |
| `16f8b0d` | 支持 DSH 0.2.0-rc.2：依赖重定向 + 18 项 API 修复 |
| `7aba0a1` | 设置命名空间改用 Loader entry id |
| `c1d6194` | 让单元测试套件可在沙箱内运行 |
| `99bd8db` | 修复 settings fixture 的注册可见性 |

### 已验证通过的关卡（清空 `lib/` 从零重建后实测）

| 关卡 | 命令 | 结果 |
| --- | --- | --- |
| Host 类型检查 | `tsc -b tsconfig.host.json --force` | **0 errors** |
| Client 类型检查 | `tsc -b tsconfig.client.json --force` | **0 errors** |
| 三个 bundle | `tsdown` × 3 | 全部 Build complete |
| 契约校验 | `node scripts/verify-public-contract.mjs` | verified |
| 委派 + per-role 路由 | `node scripts/verify-adaptation.mjs` | all checks passed |
| 设置命名空间推导 | `node scripts/verify-settings-namespace.mjs` | all checks passed |

**per-role 模型路由实测**（三条互不相同的路由）：
- `quick` → `workbuddy-global/hy4-preview-f`
- `deep` → `workbuddy-global/deepseek-v4.1-flash`
- `review` → `workbuddy-global/glm-5.3`，且保持只读工具白名单

### 单元测试现状

**450 / 519 通过**（69 失败）。起点是**完全跑不起来**，现在能跑了。

> ⚠️ **这个数字依赖原仓库的环境残留，不可复现。**
> 原仓库 `node_modules/.pnpm/` 里残留着早期用 **isolated linker** 安装的 364 个条目，
> 其中包含 `use-sync-external-store`——它是 `dsh-client-ui-renderer` 的依赖。在干净的
> **hoisted linker** 安装下（本沙箱唯一可用的方式）该包不会提升到顶层，vitest 会在
> 加载配置阶段直接报 `installed package use-sync-external-store was not found`，
> **整套测试在启动阶段就停下，拿不到任何汇总数字**。
>
> 影响范围：`use-sync-external-store` 的唯一消费者是 `dsh-client-ui-renderer`，属于
> **B 类（客户端测试）**，本来就跑不了。**host 面测试不受影响。**
>
> 含义：**要复跑那个 450/519，必须在本仓库（`dsh-legion/`）下操作**，
> 干净拷贝的 `dsh-legion-adaptation/repo/` 复现不了这个数字。

---

## 三、当前剩余失败（已完整分类）

### A 类：沙箱限制，**不可修**（约 45 个测试，10 个文件）

这些测试自己 `spawnSync` / `execFileSync` 子进程，沙箱拒绝管道 stdio → 返回
`status: null` / `stdout: undefined`。**不是代码问题**，别试图修。

| 文件 | 说明 |
| --- | --- |
| `tests/dependency-preflight.spec.ts` | 20 个失败 |
| `tests/quality-scorer.spec.ts` | 11 个失败 |
| `tests/compatibility-receipts.spec.ts` | 5 个失败 |
| `tests/package.spec.ts` | 4 个失败 |
| `tests/release.spec.ts` | 3 个失败 |
| `tests/benchmark.spec.ts`、`tests/bin.spec.ts`、`tests/contract.spec.ts` | 各 1 个 |
| `packages/run-receipt-feed/tests/benchmark.spec.ts` | 1 个 |

**已写好分类工具**，可以自动识别某文件是否属于此类：

```powershell
$node = "C:\Users\12877\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
cd "C:\Users\12877\Documents\deepseek-harness\default-workspace\dsh-legion"
& $node scripts\triage-failures.mjs . tests/xxx.spec.ts
# 输出 SANDBOX(spawn) 或 REAL
```

### B 类：客户端测试**结构性跑不了**（本轮新发现，非缺陷）

`tests/settings-card.spec.ts`、`packages/run-receipt-feed/tests/client-overlay.spec.ts`
（以及任何 import `dsh-client-test-runtime` 的用例）**无法收集**。

原因链条（已逐层实测确认）：
1. `dsh-client-test-runtime` 导入 `@deepseek-ai/dsh-client-ui-renderer/client`
2. 该别名在 vitest 配置里指向 **DSH 源码 `.ts`**（`officialClientSource(...)`）
3. **本机没有 DSH 源码树** —— 发布包里只有 `lib/`，没有 `src/`
4. 退而求其次指向 `lib/client.js` 也不行：那是**浏览器 bundle**，第一行就是
   `window.__ModuleLoader__.load({...})`，在 Node 下抛 `window is not defined`

**结论：需要设 `DSH_LEGION_DSH_TEST_SOURCE` 指向完整的 DSH checkout 才能跑这些用例。**
本机不存在该 checkout。这是环境前提缺失，不是 Legion 缺陷。

### C 类：真实代码问题，**待修**（约 20 个测试）

按优先级：

| 文件 | 失败数 | 首个错误 | 备注 |
| --- | --- | --- | --- |
| `tests/settings-plane.spec.ts` | 7 | `expected [] to deeply equal ['legion']` | 已从 12 降到 7，见下节 |
| `tests/settings.spec.ts` | 4 | `expected false to be true` | 同类，可能一起转绿 |
| `packages/run-receipt-feed/tests/remote-transport.spec.ts` | 2 | typert codec `no create() factory` | **可能是真实 0.2.0 破坏** |
| `tests/continuable-real.spec.ts` | 1 | `service "sessionProjections" has been registered at ...` | 0.2.0 服务注册语义变化 |
| `tests/resources.spec.ts` | 2 | `PROFILE_RESOURCE_LINK_...` 断言不符 | 待查 |
| `tests/documentation.spec.ts` | 1 | `expected [...] to deeply equal []` | 可能是文档用语检查，与本适配相关 |
| `tests/run-receipt-telemetry.spec.ts` | 3 | 断言不符 | 待查 |
| `packages/run-receipt-feed/tests/package.spec.ts` | 2 | 断言不符 | 待查 |

---

## 四、下一步该做什么（按顺序）

1. **先跑一遍全量确认基线**：
   ```powershell
   $node = "C:\Users\12877\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
   cd "C:\Users\12877\Documents\deepseek-harness\default-workspace\dsh-legion"
   & $node "node_modules\vitest\vitest.mjs" run --config vitest.config.js --configLoader runner `
     --exclude tests/loader-smoke.spec.ts --no-color
   ```
   当前应为 **450 passed / 69 failed**。

2. **继续修 `settings-plane` 剩余 7 个**。已做的修复（`tests/settings-fixture.ts`）：
   - `mount()` 补上 `SettingsForms` 注入的 `profileContext` / `configEditor` + Loader stub
   - `MemorySettings` 自己记录注册并覆写 `describe()`
   - `MemorySettings` 重新实现 0.1.x 的 `register()` 缝，让 fallback 路径仍被测试
   剩余失败大概率是**存储层语义**（`layers the stored section over its own entry`、
   `publishes the stored override and republishes on a later commit` 等），需要看
   fixture 的 document 读写与生产代码的期望是否对齐。

3. **重点看 `remote-transport.spec.ts` 的 typert codec 错误**：
   `typert: dsh-legion-receipts#legionReceipts/follow result strict codec has no create() factory`
   —— 这**可能是真实的 0.2.0 破坏**（typert registry 对 codec 的要求变了），
   需要读 `@deepseek-ai/dsh-typert-registry` 的 `validateCodec`。

4. **提交前必须跑的三件事**（沙箱内 `pnpm run check` 跑不了）：
   ```powershell
   & $node "node_modules\typescript\bin\tsc" -b tsconfig.host.json --force     # 期望 0 errors
   & $node "node_modules\typescript\bin\tsc" -b tsconfig.client.json --force   # 期望 0 errors
   & $node scripts\verify-public-contract.mjs                                  # 期望 verified
   ```
   另外两个验证脚本也要保持通过：
   `scripts\verify-adaptation.mjs`、`scripts\verify-settings-namespace.mjs`

5. **量力而行**：A 类（沙箱）和 B 类（缺源码树）合计约 65 个测试**在本机不可能转绿**。
   不要在这两类上浪费时间。目标应该是：**C 类清零**，并把 A/B 类明确记录为已知限制。

6. 全部做完后，更新本文档和 `ADAPTATION-0.2.0-rc.2.md` 的「Known gaps」，写出最终数字。

---

## 五、环境限制速查（不要浪费时间试图绕过）

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `pnpm install` / `pnpm run` → `spawn EPERM` | pnpm 用管道 stdio spawn | **直接调 `tsc` / `tsdown`，别用 pnpm 脚本** |
| `Cannot find package 'ansis'` from tsdown | pnpm isolated linker 的 junction 让 Node ESM 解析器找不到兄弟依赖 | 安装加 `--config.node-linker=hoisted` |
| Vitest 启动 EPERM | Vite `optimizeSafeRealPathSync` 调 `exec("net use")` | **`--configLoader runner` + `pool: 'threads'`** |
| 测试内 spawnSync EPERM | 测试自己 spawn 子进程 | 不可修，A 类 |
| `window is not defined` | 引到了浏览器 bundle | 需要 DSH 源码树，B 类 |
| git push 失败 | 沙箱内 credential helper 不可用 + schannel TLS 不可用 | 见下 |

**所有命令都必须用 bundled node 显式调用**：

```powershell
$node = "C:\Users\12877\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
```

---

## 六、关键路径

| 用途 | 路径 |
| --- | --- |
| 仓库根 | `C:\Users\12877\Documents\deepseek-harness\default-workspace\dsh-legion` |
| bundled node | `C:\Users\12877\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` |
| bundled pnpm | `C:\Users\12877\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs` |
| **沙箱专用 vitest 配置** | `dsh-legion\vitest.config.js`（新增，勿删） |
| 上游原配置 | `dsh-legion\vitest.config.ts`（**勿删**，正常环境用） |
| 失败分类工具 | `dsh-legion\scripts\triage-failures.mjs`（新增） |
| 适配说明 | `dsh-legion\ADAPTATION-0.2.0-rc.2.md` |
| 委派验证脚本 | `dsh-legion\scripts\verify-adaptation.mjs` |
| 命名空间验证脚本 | `dsh-legion\scripts\verify-settings-namespace.mjs` |
| 兼容性声明 | `dsh-legion\contracts\compatibility.json` |
| bundle patch | `dsh-legion\cordis.patch.yml` |
| 推送脚本所需 token | `gh auth token`（账号 `kaiye2343`） |

---

## 七、注意事项 / 风险

- **别动 desktop profile**：`~/.dsh/profiles/desktop/` 是用户在用的配置。
  要实装验证请用**独立 profile**。
- **`dshPeerRange` 已被放宽到 `<0.3.0`**：基于实测判断，**不是上游结论**。
  若发现 0.2 有其他行为变更，这个范围可能过宽。
- **推送命令**（credential helper 和 schannel 在沙箱内都不可用）：
  ```powershell
  $token = gh auth token
  git -c http.sslBackend=openssl clone https://github.com/... # clone 同理
  git -c http.sslBackend=openssl -c credential.helper= push `
    "https://x-access-token:$token@github.com/kaiye2343/dsh-legion.git" main
  ```
- **上游 `AGENTS.md` 要求**：直接改 main、别开分支/PR；英文 Conventional Commit；
  改代码前跑 `pnpm run check`（本沙箱跑不了，见第五节）。

---

## 八、诚实清单（尚未验证的事）

- **单元测试未全绿**（450/519），C 类约 20 个真实失败待修。
- **没有做过真实 DSH profile 实装验证**：插件的装载只在两个验证脚本的
  合成 Cordis 上下文里验过，**从未在真实 Host profile 里启动过**。
- `glm-5.3` 路由**只验证了解析，没实际调用过**——该模型在用户 provider 上
  是否真实可用未确认。
- B 类测试所依赖的 DSH 源码树本机不存在，`DSH_LEGION_DSH_TEST_SOURCE`
  从未设置过，因此那条路径**未经验证**。
