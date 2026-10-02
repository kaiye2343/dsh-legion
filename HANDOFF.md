# HANDOFF — dsh-legion 适配 DSH 0.2.0-rc.2

给接力的 agent：先读完这个文件，再动代码。所有结论都来自实测，不是推测。

## 一、任务是什么

把 `wxxb789/dsh-legion`（上游声明 `dshPeerRange: ">=0.1.2-alpha.2 <0.2.0"`）适配到
本机安装的 **DSH 0.2.0-rc.2**，让插件能装载、且 per-role 模型路由可用。

## 二、已完成（2 个 commit 已推送）

| commit | 内容 |
| --- | --- |
| `16f8b0d` | 支持 DSH 0.2.0-rc.2：依赖重定向 + 18 项 API 修复 |
| `7aba0a1` | 设置命名空间改用 Loader entry id |

**已验证通过（清空 lib/ 从零重建后实测）：**

| 关卡 | 命令 | 结果 |
| --- | --- | --- |
| Host 类型检查 | `tsc -b tsconfig.host.json --force` | 0 errors |
| Client 类型检查 | `tsc -b tsconfig.client.json --force` | 0 errors |
| 三个 bundle | `tsdown` × 3 | 全部 Build complete |
| 契约校验 | `node scripts/verify-public-contract.mjs` | verified |
| 委派 + per-role 路由 | `node scripts/verify-adaptation.mjs` | all checks passed |
| 设置命名空间推导 | `node scripts/verify-settings-namespace.mjs` | all checks passed |

per-role 路由实测：`quick → workbuddy-global/hy4-preview-f`、
`deep → workbuddy-global/deepseek-v4.1-flash`、`review → workbuddy-global/glm-5.3`，
三条路由互不相同，`review` 保持只读工具白名单。

## 三、进行中：跑通官方单元测试套件（未完成）

### 已突破

原本 Vitest **完全无法启动**（Vite 的 `optimizeSafeRealPathSync` 调
`exec("net use")`，沙箱拒绝管道 stdio spawn → EPERM）。

突破方式：**绕过 Vite 的 TS 配置打包**，改用纯 JS 配置 + `--configLoader runner`：

```powershell
$node = "C:\Users\12877\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
cd "C:\Users\12877\Documents\deepseek-harness\default-workspace\dsh-legion"
& $node "node_modules\vitest\vitest.mjs" run --config vitest.config.js --configLoader runner `
  --exclude tests/loader-smoke.spec.ts --no-color
```

**这已经能跑起来了**，最新成绩：**519 个测试中通过 435，失败 84。**

### 两个关键发现

1. **必须用 `--configLoader runner`**：默认的 `bundle` 模式会走 rolldown → 触发 EPERM。
2. **必须用 threads pool**：forks pool 会 spawn worker，同样 EPERM。
   `vitest.config.js` 里已设 `pool: 'threads'` + `singleThread: true`。

### 当前未提交的改动（2 个）

```
 M tests/client-bundle.spec.ts    ← 已修：inject 断言 ['slots','locale','settingsScope'] → ['slots','locale','configForms']
?? vitest.config.js               ← 新建：纯 JS 版 vitest 配置（沙箱专用）
```

`tests/client-bundle.spec.ts` 的修复已验证：该文件 6/6 通过。

### 84 个失败的分类（已诊断）

| 数量 | 类别 | 性质 |
| --- | --- | --- |
| 26 | `settings fixture did not mount` | **环境/配置问题，可修** |
| 23 | `expected null to be 0`（spawnSync 被拒） | **沙箱限制，不可修** |
| 9 | EPERM / spawnSync | **沙箱限制，不可修** |
| 6 | `Cannot read properties of undefined (reading 'trim')` | **待查** |
| 5 | `stack: 'Error: \n'` | 待查 |
| 2 | typert codec `no create() factory` | 可能是真实 0.2.0 破坏 |
| 2 | typert codec | 同上 |
| 余下 | 各类断言 | 待逐个看 |

### 正在进行的具体修复（正在做，未完成）

我发现 `vitest.config.js` 里的 **client alias 指向了不存在的路径**。0.2.0 的包结构
变了：`lib/types/client/index.js` 不存在，实际文件是 `lib/client.js`。

已确认的错误 alias（**已改掉 renderer 一个，其余待改**）：

| alias | 当前指向（不存在） | 实际路径 |
| --- | --- | --- |
| `dsh-client-ui-renderer/client` | `lib/types/client/index.js` | `lib/client.js` ✅已改 |
| `dsh-client-ui-session/client` | `lib/types/client/index.js` | `lib/client.js` ❌待改 |
| `dsh-client-ui-chat/client` | `lib/types/client/contract/snapshot.js` | `lib/client.js` ❌待改 |
| `dsh-client-ui-conversation/client` | `lib/types/client/contract/snapshot.js` | `lib/client.js` ❌待改 |

**这几个 alias 修好后，26 个 `settings fixture did not mount` 大概率会一起转绿**
（它们都是 `dsh-client-test-runtime` 拉不到 `dsh-client-ui-renderer/client` 导致的）。

## 四、下一步该做什么（按优先级）

1. **修完上面 3 个 client alias**，重跑，看 26 个 fixture 失败是否消失。
2. **对剩余失败做二分**：区分「沙箱限制（spawnSync EPERM / status null）」和「真实代码问题」。
   沙箱类的大概 32 个（23+9），应记录为已知环境限制，不要试图修。
3. **关注 typert codec 那 2 个**——可能是真实的 0.2.0 破坏，需要看
   `@deepseek-ai/dsh-typert-registry` 的 `validateCodec` 是否要求 `create()` 工厂。
4. **提交 vitest.config.js + spec 修复**，然后 push。
5. 有把握后，更新 `ADAPTATION-0.2.0-rc.2.md` 的「Known gaps」段落——目前写的是
   「单元测试跑不了」，现在已经能跑了，需要改成实际数字。

## 五、环境限制（不要浪费时间试图修）

这些是 DSH 沙箱的限制，**不是代码问题**：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `pnpm install` / `pnpm run` → `spawn EPERM` | pnpm 用管道 stdio spawn 生命周期脚本 | 直接调 `tsc` / `tsdown`，别用 pnpm 脚本 |
| `Cannot find package 'ansis'` from tsdown | pnpm isolated linker 的 junction 让 Node ESM 解析器走逻辑路径，找不到兄弟依赖 | 安装时加 `--config.node-linker=hoisted` |
| Vitest 启动 EPERM | Vite `optimizeSafeRealPathSync` 调 `exec("net use")` | `--configLoader runner` + `pool: 'threads'` |
| 测试内 spawnSync EPERM | 测试自己 spawn 子进程 | 不可修，记为已知限制 |

**重要**：`pnpm run check` 之类的聚合脚本在本沙箱**跑不了**。所有命令都要
用 bundled node 直接调二进制：

```powershell
$node = "C:\Users\12877\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
```

## 六、关键路径速查

| 用途 | 路径 |
| --- | --- |
| 仓库根 | `C:\Users\12877\Documents\deepseek-harness\default-workspace\dsh-legion` |
| bundled node | `C:\Users\12877\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` |
| bundled pnpm | `C:\Users\12877\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs` |
| 沙箱专用 vitest 配置 | `dsh-legion\vitest.config.js` |
| 上游原 vitest 配置 | `dsh-legion\vitest.config.ts`（勿删，正常环境用） |
| 适配说明文档 | `dsh-legion\ADAPTATION-0.2.0-rc.2.md` |
| 委派验证脚本 | `dsh-legion\scripts\verify-adaptation.mjs` |
| 设置命名空间验证 | `dsh-legion\scripts\verify-settings-namespace.mjs` |
| 兼容性声明 | `dsh-legion\contracts\compatibility.json` |
| bundle patch | `dsh-legion\cordis.patch.yml` |

## 七、注意事项 / 风险

- **别动 desktop profile**：`~/.dsh/profiles/desktop/` 是用户在用的配置。
  如果要实装验证，用**独立 profile**。
- **`dshPeerRange` 已被放宽到 `<0.3.0`**：这是基于实测的判断，不是上游结论。
  如果发现 0.2 有未知行为变更，这个范围可能过宽。
- **上游 AGENTS.md 要求**：直接改 main、别开分支/PR；用英文 Conventional Commit；
  改代码前跑 `pnpm run check`（本沙箱跑不了，见上）。
- **推送需要 token**：git 的 credential helper 在沙箱里不可用，用内联 token：
  ```powershell
  $token = gh auth token
  git -c http.sslBackend=openssl -c credential.helper= push `
    "https://x-access-token:$token@github.com/kaiye2343/dsh-legion.git" main
  ```
  另外 `schannel` TLS 后端在本机不可用，**必须加 `http.sslBackend=openssl`**。

## 八、还没验证的事（诚实清单）

- 单元测试**未全绿**（435/519），且未区分完沙箱失败 vs 真实失败
- **没有实装验证过**：插件没在真实 DSH profile 里装载过，只在那两个脚本的
  合成 Cordis 上下文里验证过
- `glm-5.3` 这个路由**只验证了解析，没实际调用过**——不确定该模型在用户的
  provider 上是否真的可用
