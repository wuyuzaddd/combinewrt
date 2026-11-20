# combinewrt

自用 OpenWrt 固件在线构建站。公开页面只读，管理员登录后可提交构建、查看历史与下载产物。

V2 已完成 tickets 01–16：多目标模型、ImageBuilder/源码混合构建、配置模式、签名 feed set、源监视、SQLite 构建队列与 Simple/Advanced 界面。逐项验收证据见 [`docs/v2-acceptance.md`](docs/v2-acceptance.md)，故障处理见 [`docs/v2-runbook.md`](docs/v2-runbook.md)；V1 的计划与构建记录仍可只读打开。

## 技术栈

- Next.js 16（App Router、Turbopack）+ React 19 + TypeScript
- SQLite（`node:sqlite`，WAL 模式）
- Tailwind CSS 4
- Vitest + Playwright

## V2 架构

### 混合构建引擎

同一次提交只产生一个 `BuildPlanV2`（`schemaVersion: 2`），由计划里的 `engine` 决定执行路径：

| 引擎 | 适用 | 工作流 | 产物 |
| --- | --- | --- | --- |
| `imagebuilder` | 标准内核线（默认 6.12）、EFI/Legacy、ext4/squashfs、combined/rootfs/VMDK/qcow2 | `build.yml` | ImageBuilder 直接产出，VMDK/qcow2 由 `qemu-img convert -f raw` 从 combined 镜像转换 |
| `source` | 6.6 / 6.18 实验内核线、需要内核配置的变体（含 Docker） | `source-build.yml` | ImmortalWrt 源码构建，固定 commit + `.config` + `feeds.conf` |

两条路径共用同一套计划、失败标记（`COMBINEWRT_FAILURE`）、manifest 和 artifact 契约，source offer 也记录相同的 provenance。源码构建只接收由 `src/lib/build/source.ts` 生成的确定性 recipe；工作流不会自行发明配置或拉取未固定的源码。

### 目标、变体与内核线

- **Target / DeviceProfile**：V2.0 只承诺 `x86/64` + `generic`；ARM 可以出现在 capability registry 中，但标记为未验证，不计入验收。
- **ImageVariant** 是四维组合：`boot`（`efi` / `legacy`）× `filesystem`（`ext4` / `squashfs`）× `artifact`（`combined` / `rootfs` / `vmdk` / `qcow2` / `emmc`）× `overlaySizeMb`。能力由 `config/capabilities/targets.json` 声明，UI 不猜测；`npm run capabilities:validate` 在 CI 中校验 registry。
- **KernelLine**：6.12 为默认 ImageBuilder 线；6.6、6.18 为实验源码线，必须 pin 到 40-hex commit。5.15/6.1 明确拒绝。`config/kernel-lines.json` 由 `npm run kernel-lines:validate` 校验。
- **eMMC** 只在能力模型中存在，真实构建随首个 ARM 目标，不属于 V2.0。

### 配置模式（Modes）

`Mode` 是 checked-in 的声明式输入（`config/modes/*.json`），由 base preset + overlays 组成，分文件/board、包/kmod、内核配置三层。一个 build 只能有一个 base preset，overlay 之间做 `requires` / `conflicts` / `exclusiveGroup` 检查；冲突在计划阶段以可读的 409 拒绝，工作流只执行已经被接受的计划。V2 的 16 个 mode：`istoreos-brand`、`nas`、`docker`、`wan-eth0`、`switch-port`、`ipv6`、`pppoe`、`wifi`、`webserver-lighttpd`、`webserver-nginx`、`webserver-uhttpd`、`https-selfsigned`、`usb-wired`、`usb-wifi`、`wwan`、`bypass`。

- 网络配置（IPv6、PPPoE、WiFi、switch-port、LAN DHCP、DNS）是类型化表单，生成受控的 uci-defaults；没有自由文本 UCI 或 shell 输入框。PPPoE/WiFi 密码只进入构建输入，不写日志、不回显到 preview 或 source offer。
- `docker` 需要 `engine: source` + `ext4` + `combined` + overlay 能力；squashfs 会被计划器拒绝。
- 主题不是 mode：主题包来自 extension feed，作为计划的 bundle/主题选择安装，不再有第二个安装器。

### 包来源与镜像 feed set

四层来源：official（ImmortalWrt，可选 `IMMORTALWRT_MIRROR`）、dllkids、supplement、extension。外部源必须先进 `config/sources/registry.json`（SPDX、source、pin、ABI、targets、`publicAllowed`）；每个包按 target × kernel line 解析成 `prebuilt` / `rebuild` / `blocked`，prebuilt 不可用或 ABI 不匹配时回退到已登记 recipe，否则 409。V2.0 不镜像外部二进制，只存 URL + pin。

镜像 feed set（ticket 09）：

- 保留官方 `distfeeds.list`，项目仓库追加到 `/etc/apk/repositories.d/90-combinewrt.list`。
- 公开镜像 = official + 签名 supplement（选用 extension 包时再加 extension）；私有镜像 = 同上 + 显式 `apk-dllkids` 包装。dllkids 从不进入默认 repository 行，也不会因私有/公开判断失误泄漏进公开镜像。
- supplement 与 extension 是 `combinewrt-packages` Pages 上的两个独立签名索引，路径版本冻结为 `/supplement/<baseVersion>/<target>/` 与 `/extension/<baseVersion>/<target>/`。这两条版本冻结路径是规范路径（canonical），新计划与新部署只按它拼接；站点根下扁平的 `/x86_64/` 只是 supplement 索引的 V1 兼容镜像，仅留给旧镜像的 repository 行与旧部署的显式配置，永远不作为新部署默认。镜像只安装项目 feed key `/etc/apk/keys/combinewrt-feed.pub.pem`（EC P-256，fingerprint `f7128667…`），不全局 `--allow-untrusted`。
- 构建前的工作流 preflight 用同一套 repository 与 key 执行 `apk add --simulate`，失败在 `make image` 之前以包名/来源报错。

### 源同步（source watch）

- 站点每 `SOURCE_WATCH_INTERVAL_HOURS`（默认 6 小时）检查 dllkids 索引与 supplement/extension 的固定 ref；pin、候选和历史进 SQLite。
- dllkids 变化按事务性规则自动采纳：只有元数据未变、依赖闭包通过时才推进 active pin；**同版本包哈希变化会阻止自动采纳**（`blocked_same_version_hash`），保留候选供人工处理；解析失败或刷新失败会回滚到上一 pin。
- supplement 源码 commit 变化自动触发构建，构建通过且元数据未变才自动发布 live；失败或元数据变化只写 staging（`publish.json` / `staging.json` 审计），live 索引不动。
- 检测目标 ≤24h、重建/发布目标 ≤48h；有 webhook 时即时，定时 watch 始终兜底。实际延迟证据与未验证项见验收文档。

### 构建队列与产物

- 构建先写 SQLite `builds` 行（`queued`），由队列按 FIFO 与 `MAX_CONCURRENT_BUILDS`（默认 2，1–16）派发；超出的构建只排队，不调用 GitHub。每个 build id 在工作流侧还有 `concurrency.group`，重复派发不会并行执行同一构建。
- 取消：排队中的构建原地取消，不调用 GitHub；运行中的构建调用 GitHub cancel 并记录状态。
- 产物：GitHub artifact 保留 7 天 + 站点缓存 7 天（`ARTIFACT_RETENTION_DAYS`）；单产物上限 2 GiB（`ARTIFACT_SIZE_LIMIT_BYTES`），VMDK/qcow2 转换后超过上限会以可读错误失败，不会静默截断。站点缓存另有总大小上限 `ARTIFACT_CACHE_MAX_BYTES`（默认 20 GiB）。下载端点支持 `Range`/206 与 `X-Checksum-SHA256`，经站点鉴权代理流式输出。
- 失败：工作流输出 `COMBINEWRT_FAILURE={"step":…,"package":…,"source":…,"message":…}`，详情页按步骤、包名、来源定位；V1 的 `COMBINEWRT_FAILED_PACKAGE=` 仍兼容。

### Simple 与 Advanced

| | Simple | Advanced |
| --- | --- | --- |
| 目标 | 默认 x86/64 generic | 可搜索 target/profile |
| 发行版 | release 频道 | release/snapshot 频道 |
| 镜像 | boot/filesystem/artifact/overlay | 同左 + 不可用变体显示 registry 原因 |
| 配置 | base preset | base + overlays（含 typed network） |
| 包 | 分组 chips、bundle、主题 | 同左 + 来源/license/翻译状态 |
| 其它 | — | kernel line、pin/feed set、source-watch 状态、capability 详情 |

Simple 隐藏 target/kernel/pin 内部细节，日常构建只需几次点击；Advanced 暴露所有边缘选项。公开目录只读，构建与下载仍仅管理员可用。

### V1 兼容

- 迁移只追加、不重命名；V1 行保持可读，新增列可空或有默认值。
- V1 `BuildPlan` JSON 视为 `schemaVersion: 1`，计划页与 source offer 只读渲染；V1 派发 payload 没有 `composition.v2`，工作流走原来的 ImageBuilder 路径。
- 旧计划、旧构建详情、旧 source offer 页面不报错；V2 字段只增量出现。

## 本地运行

要求 Node.js 24+。

```bash
npm ci
cp .env.example .env.local

# 生成会话密钥（至少 32 字符）
openssl rand -base64 48

# 生成管理员密码哈希
npm run hash-password -- 'your-admin-password'

npm run dev
```

打开 <http://localhost:3000>，在 `/login` 用管理员密码登录。

## 环境变量

完整示例见 [`.env.example`](.env.example) 与 [`deploy/combinewrt.env.example`](deploy/combinewrt.env.example)。`src/lib/config.ts` 对必填项、格式和取值范围做一次性校验，缺项或非法时进程启动即失败并列出全部问题。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SESSION_SECRET` | 是 | 会话 HMAC 密钥，至少 32 字符；轮换后所有会话立即失效 |
| `ADMIN_PASSWORD_HASH` | 是 | `scrypt$<salt>$<hash>`，由 `npm run hash-password` 生成；明文密码不落盘 |
| `DATABASE_PATH` | 否 | 默认 `./data/combinewrt.db`，目录会自动创建 |
| `APP_ORIGIN` | 否 | 站点对外绝对地址（含协议），默认 `http://localhost:3000`；生产必须是 `https://` |
| `APK_BIN` | 否 | apk-tools 3 可执行文件；目录刷新、source watch 和 preflight 需要它 |
| `IMMORTALWRT_BASE_VERSION` | 否 | 首次启动写入基线的 ImmortalWrt 版本，默认 `25.12.2` |
| `IMMORTALWRT_MIRROR` | 否 | 覆盖官方 feed base 的镜像 URL；留空使用 `https://downloads.immortalwrt.org` |
| `DLLKIDS_FEED_URL` | 否 | dllkids 包索引目录 |
| `DLLKIDS_INDEX_SHA256_SEED` | 否 | 首次安装的 dllkids `packages.adb` sha256 seed；采纳后以数据库 `source_pins` 为准。旧名 `DLLKIDS_INDEX_SHA256` 仍兼容 |
| `COMBINEWRT_FEED_BASE_URL` | 否 | 项目签名 feed 站点根（supplement/extension 的版本冻结路径由此拼接） |
| `SUPPLEMENT_FEED_URL` | 否 | supplement 索引目录；默认按 base version 拼成规范路径 `/supplement/<baseVersion>/<target>/`。扁平 `/x86_64/` 仅 V1 兼容，不要在新部署里配置 |
| `SUPPLEMENT_KEY_URL` | 否 | 项目 feed 公钥地址 |
| `SUPPLEMENT_KEY_FINGERPRINT` | 否 | 公钥字节的 sha256；镜像 preflight 与源监视都用它校验 |
| `SUPPLEMENT_FEED_COMMIT` | 否 | supplement 源提交；留空时只固定公钥与索引 sha256 |
| `SUPPLEMENT_INDEX_SHA256` | 否 | supplement 索引 pin（64-hex，可留空） |
| `EXTENSION_INDEX_SHA256` | 否 | extension 索引 pin（64-hex，可留空） |
| `SUPPLEMENT_SOURCE_REPO` | 否 | supplement 上游仓库，默认 `kiddin9/op-packages` |
| `SUPPLEMENT_SOURCE_REF` | 否 | supplement 上游分支，默认 `main` |
| `SUPPLEMENT_TARGET` | 否 | supplement feed 的目标架构，默认 `x86_64` |
| `SUPPLEMENT_PUBLISH_AUDIT_URL` | 否 | feed 仓写出的 live 发布审计 |
| `SUPPLEMENT_STAGING_AUDIT_URL` | 否 | feed 仓写出的 staging 审计 |
| `SUPPLEMENT_WATCH_ENABLED` | 否 | 设为 `false` 关闭 supplement source watch |
| `SOURCE_WATCH_INTERVAL_HOURS` | 否 | source watch 间隔，默认 6，范围 1–168 |
| `SOURCE_CACHE_DIR` | 否 | 源索引缓存目录，默认与 DB 同目录的 `source-cache/` |
| `BUILD_ADAPTER` | 否 | `fake`（默认，本地 stub）或 `github`（真实 Actions） |
| `BUILD_REPO` | 条件 | `owner/repo`；`BUILD_ADAPTER=github` 时必填 |
| `BUILD_REPO_TOKEN` | 条件 | 仅授权该仓库 `Actions: write` 的 PAT |
| `BUILD_WORKFLOW` | 否 | ImageBuilder 工作流文件名，默认 `build.yml` |
| `SOURCE_BUILD_WORKFLOW` | 否 | 源码构建工作流文件名，默认 `source-build.yml` |
| `SUPPLEMENT_WORKFLOW` | 否 | supplement 包构建工作流文件名，默认 `packages.yml` |
| `MAX_CONCURRENT_BUILDS` | 否 | 同时派发/运行的构建数，默认 2，范围 1–16 |
| `BUILD_REF` | 否 | 构建仓库的分支或 tag，默认 `main` |
| `ARTIFACT_CACHE_DIR` | 否 | 站点产物缓存目录，默认与 DB 同目录的 `artifacts/` |
| `ARTIFACT_RETENTION_DAYS` | 否 | 产物缓存保留天数，默认 7；0 表示不清理 |
| `ARTIFACT_CACHE_MAX_BYTES` | 否 | 站点缓存总大小上限，默认 20 GiB；0 表示不限制 |

## 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建 |
| `npm start` | 启动生产构建（需先 `npm run build`） |
| `npm run start:prod` | 构建后启动，首次部署一条命令 |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest 单次运行 |
| `npm run capabilities:validate` | 校验 capability registry（targets/profiles/variants/kernel lines/modes） |
| `npm run sources:validate` | 校验 source registry、extension bundles 与 pin/SPDX |
| `npm run kernel-lines:validate` | 校验内核线 registry 与源码 pin |
| `npm run test:e2e` | 构建后跑 Playwright e2e |
| `npm run test:e2e:only` | 复用已有 `.next` 构建，只跑 e2e |
| `npm run hash-password -- '<password>'` | 生成管理员密码哈希 |

## 构建派发

`/build` 提交后创建 Build 记录并入队，随后由队列派发；页面跳转到 `/builds/<id>`，详情页每 4 秒刷新一次状态，展示排队位置、日志尾部、失败原因、sha256/大小与产物下载按钮。

- 默认 `BUILD_ADAPTER=fake`：进程内假 run（queued → running → succeeded），只用于本地联调，不会产生真实固件。
- `BUILD_ADAPTER=github`：通过 `repository_dispatch`（V1 事件 `combinewrt-build`，源码构建事件 `combinewrt-source-build`）把计划放进 `client_payload` 派发给 `BUILD_REPO`。V2 payload 把 target/kernelLine/variant/modes/feedSet/preflight 嵌套在 `composition.v2` / `composition.feedSet` 下，保持在 dispatch 的 10 个顶层属性限制内。
- 站点按 run-name 里的 build id 找回 run；ImageBuilder 与 source 构建分别按 `build.yml` / `source-build.yml` 查找。完成后拉取日志与产物，解析 manifest 记录 sha256/大小，再经站点鉴权代理流式下载。首次 ImageBuilder 构建约 10–20 分钟；源码构建冷启动约 1 小时，暖缓存（dl/staging/ccache）可降到约 25–30 分钟。
- 失败原因优先取结论，其次从 `COMBINEWRT_FAILURE` 或日志末尾的 `error`/`failed` 行提取摘要。
- 站点在 `ARTIFACT_CACHE_DIR` 按需缓存产物，按 `ARTIFACT_RETENTION_DAYS` 与 `ARTIFACT_CACHE_MAX_BYTES` 清理；构建历史与元数据保留。GitHub 到期清理 artifact 且本地无缓存时，下载返回 409/502。

### V2 计划与源码构建

- ImageBuilder 计划的变体映射由站点（`src/lib/image/variants.ts`）与工作流脚本（`.github/scripts/variant-config.sh`）共同遵守，`npm test` 中的 parity 测试会校验两边一致。
- 源码构建的 recipe 由 `generateSourceRecipe` 生成：固定 source commit/feed commit、完整 `.config`、`feeds.conf`、包列表与 image glob。工作流只做 checkout、写配置、构建、校验 kernel 版本、打包与 manifest，不执行任意脚本。
- 变体在计划阶段被 capability registry 拒绝时返回 409（含 target/variant 与原因）；工作流侧还会再校验一次 artifact kind，防止旧 payload 绕过。

## 首次部署（GitHub Actions）

### 构建仓库 `combinewrt-build`

1. 新建公开构建仓库，把 `build-workflow/build.yml`、`source-build.yml`、`packages.yml`、`extension.yml` 复制到 `.github/workflows/`；`build-workflow/fail.sh`、`variant-config.sh`、`redact-plan.sh` 复制到 `.github/scripts/`。站点仓库里的 `build-workflow/` 是**唯一权威副本**，构建仓库的 main 必须与它逐字节一致。
2. `build.yml` 必须由仓库默认分支提供（`repository_dispatch` 不支持指定 ref），事件类型 `combinewrt-build`；`source-build.yml` 使用 `combinewrt-source-build`。工作流从 `github.event.client_payload` 读取计划，`run-name` 使用 `${{ github.event.client_payload.buildId }}`，否则站点匹配不到 run。
3. 创建仅授权该仓库的 fine-grained PAT：`Actions: read and write`（派发、读日志、读产物）、`Contents: read`。放到 `BUILD_REPO_TOKEN`，不要提交。
4. 配置 `BUILD_ADAPTER=github`、`BUILD_REPO=owner/repo`、`BUILD_REF=main`，重启站点；缺配置会启动失败并列出全部问题。
5. 公开仓库的 Actions 日志与产物对所有人可见，不要把 secret 写进构建输入；公开镜像不要包含 fastnet/linkease 等许可未清的包，也不要在日志里 `echo` 密码或 root hash。

### Feed 仓库 `combinewrt-packages`

supplement 与 extension 的索引/签名/发布在独立的公开仓库，由构建仓库在成功后用 `repository_dispatch` 触发（`packages-built`，`client_payload.build_run_id`）。它承载：

- `publish.yml`：生成 catalog、用项目 feed key 签名 `packages.adb` 与所有 apk、校验、写审计、部署 Pages；`publish_mode=live|staging` 决定推进 live 还是只写 staging。
- `feed-test.yml`：真实 apk 客户端安装/篡改测试。
- `ci.yml`：lint/typecheck/test。

站点只需要读权限：`SUPPLEMENT_*_AUDIT_URL`、`SUPPLEMENT_INDEX_SHA256`、`EXTENSION_INDEX_SHA256` 与 feed base URL。密钥 `FEED_SIGNING_KEY` 只存在 feed 仓 secrets，站点和构建仓都不持有私钥。**Pages 的 `deploy` job 通常只允许默认分支**，非 main 分支的 publish run 可以完成签名/审计/gh-pages 提交，但部署会被环境规则拒绝；正式发布需要 main 上的运行。

### 与站点仓库的关系

- 站点仓库 = 计划、UI、队列、源监视与部署文档；`build-workflow/` 是工作流的唯一来源。
- 构建仓库 = 公开的 GitHub Actions 执行器；只接收计划，不保存站点状态。
- feed 仓库 = 公开的签名包与索引站点；保存签名密钥与发布审计。
- 三者都不互相 vendoring 第三方源码或二进制；站点只记录 URL + pin。

## 目录快照

管理员登录后打开 `/catalog`，点“刷新目录”：站点会从 `https://downloads.immortalwrt.org/releases/<版本>/` 拉取 `profiles.json` 与 7 个 feed 的 `packages.adb`，解析成不可变快照。

- 快照按“基线版本 + `version_code`（feed commit）”键控；同一键重复刷新不会重建。
- 只接受 `arch_packages=x86_64` 的 profiles；V2 的镜像格式由 capability registry 决定，不再只从 `images[].name` 推导。
- 软件包按名称/描述搜索、按分类浏览，并按 target/kernel line 过滤；详情含版本、安装大小、直接依赖、license、origin。
- 任一解析失败则本次刷新整体失败，旧快照保持为 active，页面不会出现半空目录。

刷新需要 apk-tools 3。最省事的方式是从 ImmortalWrt ImageBuilder 取：

```bash
# 解压 ImageBuilder 后
export APK_BIN="$PWD/immortalwrt-imagebuilder-25.12.2-x86-64.Linux-x86_64/staging_dir/host/bin/apk"
```

该包装脚本依赖同目录 `../lib/`，不要只拷 `apk` 文件。也可以安装发行版自带的 apk-tools 3。

## 测试与 CI

本地与 GitHub Actions（`.github/workflows/ci.yml`）跑同一组检查：

```bash
npm run lint
npm run typecheck
npm run capabilities:validate
npm run sources:validate
npm run kernel-lines:validate
npm test
npm run build
npx playwright install chromium
npm run test:e2e:only
```

- 单元测试 80 个文件 / 662 个用例，覆盖 planner 的能力/变体/mode 组合、V1 计划兼容、registry 校验、工作流 YAML 结构、队列顺序/并发/取消/重启恢复、source watch 事务与发布闸门、artifact 上限/保留/流式下载。
- `src/lib/build/workflow-yaml.test.ts` 会实际解析 `build-workflow/*.yml`（js-yaml）并检查步骤顺序、签名 key 不进入产物；`workflow.test.ts` 对 `variant-config.sh` 与站点变体映射做 parity 校验。
- 端到端测试使用 Playwright + 临时 SQLite + `BUILD_ADAPTER=fake`，不访问外部网络：`e2e/build-flow.spec.ts` 覆盖 V1 登录、三层来源计划、派发、轮询、下载与拒绝路径；`e2e/build-v2.spec.ts` 覆盖 Simple V2 构建 + V2 source offer、Advanced 冲突 409、不可用 eMMC 变体禁用原因、V1 构建页与 source offer 可读。种子脚本 `scripts/seed-e2e.ts` 每次删除并重建 `DATABASE_PATH`（默认 `/tmp/combinewrt-e2e.db`）。
- CI 还显式执行 workflow YAML 校验与 `kernel-lines:validate`；工作流文件本身是构建仓库 main 的权威来源。

### 构建失败诊断

构建工作流在失败时输出一行机器可读标记：

```text
COMBINEWRT_FAILURE={"step":"download-packages","package":"lucky","source":"dllkids","version":"3.5.0-r1","message":"..."}
```

站点解析最后一个标记，在构建详情页显示步骤、包名、来源、版本与原因；旧工作流仍兼容 `COMBINEWRT_FAILED_PACKAGE=<name>`。步骤标识：`prepare-plan`、`install-tools`、`download-imagebuilder`、`download-packages`、`write-files`、`preflight`、`build-image`、`assert-packages`、`postprocess`、`package-artifact`、`dispatch`、`timeout`、`workflow`。成功结束但没有产物的构建只显示警告，不会被误判为失败。

## 生产部署

可直接使用仓库内的 `deploy/combinewrt.service`、`deploy/combinewrt.env.example`、`deploy/nginx-combinewrt.conf.example` 与 `deploy/backup-db.sh`；安装、升级、备份/恢复、SQLite 新表、staging/live feed 发布与保留策略见 [`deploy/README.md`](deploy/README.md)。健康检查为 `GET /api/health`。

首次部署清单：

1. **主机**：Node.js 24+，持久化磁盘存放 SQLite、source cache 与构建缓存，建议至少 2GB 内存。
2. **反向代理**：Nginx/Caddy 终止 TLS，转发到 `127.0.0.1:3000`，并**覆盖**（不是追加）`X-Forwarded-For` / `X-Real-IP` 与 `X-Forwarded-Proto`。登录限速按 IP 分桶，若代理放行客户端自带的转发头，攻击者可伪造 IP 绕过限速。
3. **环境**：`APP_ORIGIN=https://your.domain`；`SESSION_SECRET` 用 `openssl rand -base64 48`；`ADMIN_PASSWORD_HASH` 离线生成；`DATABASE_PATH`、`ARTIFACT_CACHE_DIR`、`SOURCE_CACHE_DIR` 指到持久目录。
4. **进程管理**：用 systemd 托管，示例见 `deploy/combinewrt.service`；`ProtectSystem=strict` 时把数据目录加入 `ReadWritePaths`。
5. **备份**：定期备份 SQLite；WAL 模式下用 `sqlite3 data/combinewrt.db ".backup backup.db"`，不要只拷主文件。
6. **构建/feed 仓库**：按上文创建并同步；PAT 只放在站点服务器的环境变量中，不下发前端。
7. **产物下载**：GitHub artifact 保留 7 天，站点按需缓存到 `ARTIFACT_CACHE_DIR` 并按保留期/总大小清理；不要把大文件提交进 git。
8. **健康检查**：`curl -fsS http://127.0.0.1:3000/api/health` 返回 `{"ok":true}`。

## 安全说明

- 单管理员；密码只存 scrypt 哈希（N=16384、r=8、p=1、64 字节输出）。
- 登录限速 5 次 / 15 分钟 / IP；被限速时即使密码正确也拒绝。
- 会话 7 天，HMAC-SHA256 签名，`HttpOnly` + `SameSite=Lax`；HTTPS 下自动加 `Secure`。
- 公网部署时建议在反向代理层再加一层限速/WAF。
- feed 签名私钥只存在 `combinewrt-packages` 的 GitHub secrets；站点、构建仓与镜像只带公钥。dllkids 无签名，自动采纳的残余风险见 ADR 0008。

## 目录

```text
src/app/                页面与 route handlers（/api/login、/api/logout、/api/health、/api/catalog/*、/api/build/plan、/api/builds/*、/api/admin/source-watch）
src/app/build/          Simple/Advanced 构建表单、mode/typed-network 表单与计划预览
src/app/builds/         构建历史、详情、状态轮询与 V2 source offer
src/app/admin/          源监视、artifact 缓存与基线管理
src/lib/base/           基线版本记录、发布发现、切换/回退与冒烟构建编排
src/lib/build/          计划组合、variants、postprocess、feeds/preflight、modes、source recipe、kernel lines
src/lib/builds/         构建记录、队列、派发适配器（fake/github）、reconciler、artifact cache 与保留
src/lib/source-watch/   dllkids source watch、事务化 pin 采纳与回滚
src/lib/supplement-watch/ supplement 构建/发布闸门与审计
src/lib/extension/      extension registry、主题、bundle 与 catalog 聚合
src/lib/source-offer/   构建 source manifest（GPL source offer，V1/V2）
build-workflow/         构建仓库用的权威工作流模板（build/source-build/packages/extension + scripts）
config/capabilities/    target/profile/variant/kernel line/mode capability registry
config/modes/           声明式配置模式
config/kernel-lines.json内核线 registry
config/sources/         包来源 registry 与 pin
config/extension/       主题与 bundle 声明
patches/                仅放 OpenWrt 派生 patch（GPL-2.0-only，当前为空）
LICENSES/               MIT 与 GPL-2.0-only 许可证全文
src/lib/config.ts       环境变量校验
src/lib/db.ts           SQLite 打开与迁移
src/lib/migrations.ts   内置迁移（只追加）
scripts/                hash-password、seed-e2e 与三个 registry 校验脚本
docs/v2-acceptance.md   V2 验收矩阵与真实证据
docs/v2-runbook.md      故障回滚、哈希异常、staging 发布、队列与缓存清理
deploy/                 systemd/nginx/env/备份示例
```

## 许可与商标

站点与编排代码以 MIT 许可发布，见 `LICENSE`、`LICENSES/MIT.txt` 和 `NOTICE`。

`patches/` 中任何 OpenWrt/ImmortalWrt 派生 patch 均为 GPL-2.0-only，见
`LICENSES/GPL-2.0-only.txt`；目前没有 patch。每次构建都会生成
`/builds/<id>/source-offer`，记录 OpenWrt 基线、官方 feed commits、dllkids
`packages.adb` sha256、自有 supplement/extension 源与构建配置。

仓库不 vendor 或镜像任何第三方源码/二进制：官方 feed 与 dllkids 只记录 URL 和
pin，dllkids 不镜像；补充包由独立签名源托管。含 proprietary/无许可证包的构建仅限
自用，不进入公开镜像。OpenWrt® 是 Software Freedom Conservancy 的注册商标。本项目是独立项目，与 OpenWrt 项目及 SFC 无隶属、背书或赞助关系；站点与文档中对 OpenWrt 的使用仅为描述性说明。
