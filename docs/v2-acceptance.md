# combinewrt V2.0 验收矩阵

本文件逐行对应本地设计文档 `spec.md`（`.scratch/v2-build-site/spec.md`，不随仓库发布）的 **V2.0 Acceptance Matrix**，并记录真实 run id、artifact sha256/大小、apk db 断言、kernel 版本、镜像检查与未验证项。所有数字来自 `wuyuzaddd/combinewrt-build` / `wuyuzaddd/combinewrt-packages` 的真实 GitHub Actions 运行或本仓库可复现的本地校验；没有 run id 的行明确标为未验证。

- 基线：`v2-integration` @ `0165891`（tickets 01–15 已合并）
- 证据时间：2026-11-16
- 构建仓：[`wuyuzaddd/combinewrt-build`](https://github.com/wuyuzaddd/combinewrt-build)（main = `92761d3`，四个 workflow 与 `.github/scripts/*` 已与站点 `build-workflow/` 逐字节同步；main 上的 V2 冒烟 [43868727061](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43868727061) 全步骤通过）
- Feed 仓：[`wuyuzaddd/combinewrt-packages`](https://github.com/wuyuzaddd/combinewrt-packages)
- 状态图例：✅ 真实运行/可复现证据成立；🟡 单测/fixture/部分证据成立，缺真机或端到端；⬜ 未验证或明确不在 V2.0 范围

## 矩阵总览

| # | 维度 | 验收要求 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | Target | `x86/64` + `generic`；ARM 只建模 | ✅ | registry 校验；x86/64 多次真实构建；ARM `mediatek/filogic` 仅在 registry，无真实构建 |
| 2 | Boot | EFI、Legacy | ✅ | EFI run [43704700295](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704700295)；Legacy run [43704714436](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704714436) |
| 3 | Filesystem | ext4、squashfs | ✅ | 同上两条 run 的 artifact 名与 manifest |
| 4 | Artifact | combined、rootfs tar、VMDK、qcow2；overlay 可设 | 🟡 | combined/qcow2/VMDK 真实构建；rootfs tar 仅有 parity fixture，未真实构建 |
| 5 | eMMC | 模型/能力/UI 完成，真实构建不计入 | 🟡 | registry + UI 禁用原因（e2e）；无真实 eMMC 构建（本就不承诺） |
| 6 | Kernel | 6.12 默认；6.6/6.18 实验；至少一条源码线产出镜像 | 🟡 | 6.12 ImageBuilder、6.6 源码冷/暖各一次；6.18 已 pin 但从未构建 |
| 7 | Modes | 16 个声明式 mode；主题走 extension bundle | 🟡 | mode/typed-network 单测与 e2e 冲突 409；无真机网络验证；主题包真实签名/verify 通过 |
| 8 | Docker | 源码构建、ext4 combined + overlay、`/var/lib/docker` 可写 | 🟡 | 源码构建 run（见下），从 artifact 检查镜像；host 侧挂载验证见 §8 |
| 9 | Feeds | 公开/私有 image feed set 正确生成并进 source offer | ✅ | 真实 preflight run 43709222330；feeds/source-offer 单测与 e2e |
| 10 | Source sync | dllkids 自动采纳 + supplement 自动发布真实跑通一次 | 🟡 | supplement 构建→发布→staging→提升真实跑通；dllkids 自动采纳只有 fake clock/fetch 单测，未在在线站点采纳 |
| 11 | Build ops | 队列并发、失败标记、产物下载、source offer、V1 计划只读 | 🟡 | 失败标记/下载/source offer/V1 只读有真实或 e2e 证据；队列只有单测，未做真实 GitHub 派发 |
| 12 | Regression | V1 x86_64 标准构建仍通过；旧页面不报错 | ✅ | V1 run [43705270610](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43705270610)；e2e V1 页面；迁移单测 |

## 逐行证据

### 1. Target

`config/capabilities/targets.json` 声明两个 target：`x86/64`（`x86_64`，profile `generic`）与 `mediatek/filogic`（`aarch64_cortex-a53`，registry-only）。`npm run capabilities:validate` 输出：

```text
capabilities: 2 targets, 2 profiles, 21 variants, 3 kernel lines, 16 modes
```

V2.0 的真实构建证据全部来自 `x86/64` + `generic`。ARM 条目在 registry 与 UI 中存在，但没有真实设备/镜像构建，因此不计入验收（见 §未验证）。

### 2. Boot

| Boot | Run | Artifact | 结果 |
| --- | --- | --- | --- |
| EFI | [43704700295](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704700295) | `immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz` | 成功；sha256 `6227c53aeb55cffc840688b87e4a1ee795494dd1c2f74c4fe49cd84fda040a86`，21,262,502 B |
| Legacy | [43704714436](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704714436) | `immortalwrt-25.12.2-x86-64-generic-squashfs-combined.img.gz` | 成功；sha256 `ff310aa0584e2946ac2dd0af0fdb9d2007dc9da8d7f3ca40bab3e1b942530599`，18,660,330 B |

两条 run 的日志分别显示 `CONFIG_GRUB_EFI_IMAGES=y` / `CONFIG_GRUB_IMAGES=n` 与相反组合；Legacy 产物没有 `-efi` 后缀，符合上游命名。

### 3. Filesystem

- ext4：`43704700295`（`CONFIG_TARGET_ROOTFS_EXT4FS=y`，`SQUASHFS=n`）。
- squashfs：`43704714436`（`SQUASHFS=y`，`EXT4FS=n`）。
- VMDK/qcow2 的真实 run 也分别使用 ext4（见 §4）。

### 4. Artifact 与 overlay

| 变体 | Run | 产物 | sha256 | 大小 |
| --- | --- | --- | --- | --- |
| EFI ext4 combined | [43704700295](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704700295) | `.img.gz` | `6227c53aeb55cffc840688b87e4a1ee795494dd1c2f74c4fe49cd84fda040a86` | 21,262,502 B |
| Legacy squashfs combined | [43704714436](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704714436) | `.img.gz` | `ff310aa0584e2946ac2dd0af0fdb9d2007dc9da8d7f3ca40bab3e1b942530599` | 18,660,330 B |
| EFI ext4 qcow2 + overlay 512 | [43704727299](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704727299) | `.qcow2` | `4680a71fcd7e3557462ce4760ca1d22d945e78cf2958283b4dca2a2e26f71252` | 49,217,536 B |
| EFI ext4 VMDK + overlay 512 | [43866425386](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43866425386) | `.vmdk` | `273955d24ad612ca0b540fe9616d11848b4a232ecbf53752a04c69141e51bae2` | 49,872,896 B |

- qcow2 run 的 manifest 记录源 raw `.img` sha256 `d2e0b4f18e739e3e1522720187365703c5eebb6a0cdf236e0ae40af7b1ca9946`、大小 570,719,744 B（544 MiB 虚拟磁盘），证明 overlay 512 MiB 生效；工作流日志记录 `gzip -dc …; qemu-img convert -f raw -O qcow2 …`。
- VMDK run 的 manifest（`/tmp/vmdk-art/.../manifest.json`，sha256 与产物一致）记录 raw 570,719,744 B、converted 49,872,896 B；本地 `qemu-img info` 输出 `file format: vmdk`、`virtual size: 544 MiB (570719744 bytes)`、`create type: monolithicSparse`。
- VMDK run 的 "Assert top-level packages" 步骤挂载了 `loop0p2`（ext4 rootfs），日志逐行输出 `verified package: luci`、`verified package: curl`，说明 apk db 可读且顶层包确实在镜像里。
- **rootfs tar 未真实构建**：`mapImageVariant`/`variant-config.sh` 的 parity 测试覆盖 `rootfs` 命名与 `CONFIG_TARGET_ROOTFS_TARGZ=y`，但没有一条真实 run 产出 `.tar.gz`，因此本行只能算部分成立。

### 5. eMMC

- capability registry 中有 `emmc` artifact 模型；UI 对 x86 的 eMMC 变体显示 registry 给出的不可用原因，`e2e/build-v2.spec.ts` 覆盖“不可用变体禁用并显示原因”。
- 没有真实 eMMC 构建。spec 明确 eMMC 真实验收随首个 ARM 目标，不计入 V2.0。

### 6. Kernel lines

| 线 | 引擎 | 证据 | 结果 |
| --- | --- | --- | --- |
| 6.12（默认） | ImageBuilder | [43704700295](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704700295) | 日志显示安装 `kernel=6.12.103~…`，manifest `kernelLine.id=6.12`；默认线真实产出镜像 |
| 6.6（实验） | source | [43711004777](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43711004777) | 冷启动 61m05s，`buildSeconds 3165`，kernel **6.6.159**，sha256 `11b7506040398d84ae11ac839ccfde68658915f148292c4c7c233514aa087365`，19,262,416 B |
| 6.6（实验，暖缓存） | source | [43853764898](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43853764898) | 25m51s，`buildSeconds 1219`（冷启动的 38%），kernel **6.6.159**，sha256 `50ec85770836ffacfed31b09bc61f16c72abfa673e4b163f0b5362b165178e99`，19,260,397 B；manifest `cache:{download:true,staging:true,ccache:true}` |
| 6.18（实验） | source | 仅 registry pin `a4ba8240d8a1aaef7e8c6f2d65e841a9bfd2b8c5` | ⬜ 从未构建 |

源码构建的 kernel 版本不是只看 recipe：工作流在 checkout 后校验 `KERNEL_PATCHVER`/`include/kernel-6.6`，构建后从 `build_dir/**/kernel.release` 读出实际版本并与 `expectedKernel` 比对，不符即失败。6.12 源码线（source engine）没有跑过；默认 6.12 只经过 ImageBuilder 验证。

### 7. Modes、typed network 与主题

- 16 个 mode 与 registry 完全一致：`istoreos-brand`、`nas`、`docker`、`wan-eth0`、`switch-port`、`ipv6`、`pppoe`、`wifi`、`webserver-uhttpd`、`webserver-nginx`、`webserver-lighttpd`、`https-selfsigned`、`usb-wired`、`usb-wifi`、`wwan`、`bypass`。
- 声明式校验与生成由 `src/lib/build/modes.test.ts` 覆盖（40 例），包括：
  - `switch-port` 的 WAN/LAN 端口映射生成、端口复用拒绝；
  - `ipv6` 与 typed IPv6 设置必须成对出现；
  - `pppoe` 凭据只写入生成的 uci-defaults、验证消息不含密码；
  - `wifi` 需要 radio 能力或 `usb-wifi`，缺 typed 设置被拒绝；
  - `wan-eth0` 与 `switch-port` 互斥；
  - `docker` 在 squashfs 上被拒绝，在 ext4/source 上接受。
- e2e `e2e/build-v2.spec.ts` 真实走 HTTP：Advanced 选择 Docker/6.6 后切回 6.12 得到可读 409；Simple V2 构建与 V2 source offer 渲染通过。
- **未做真机网络验证**：没有在真实硬件上启动镜像验证 IPv6/PPPoE/WiFi/switch-port 的连通性；本行证据是“生成正确、拒绝路径可读”，不是硬件验收。
- 主题与 bundle：extension feed 的 build run [43711097432](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43711097432) 与 publish run [43725476372](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/43725476372) 成功；新克隆用只含项目公钥的 key dir 执行 `apk verify`，两个主题包与 `packages.adb` 均 `OK`。`config/extension/bundles.json` 13 个 bundle（3 proxy、6 NAS/下载/监控），strict schema 拒绝 scripts/hooks，并只引用 registry 包。

### 8. Docker

- 构建：source 源码构建 run [43866444618](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43866444618)，kernel line 6.6（kernel 6.6.159），`imageVariant={boot:efi,filesystem:ext4,artifact:combined,overlaySizeMb:512}`，`modes=[docker]`，engine `source`。
- 计划层要求：`config/modes/docker.json` 的 `requires` 为 `engine:source`、`filesystem:ext4`、`artifact:combined`、`capability:overlay`；squashfs 在计划阶段被拒绝（单测覆盖）。
- Recipe：`CONFIG_OVERLAY_FS=y`、`CONFIG_CGROUPS=y`、`CONFIG_NAMESPACES=y`、`CONFIG_NET_NS/PID_NS/UTS_NS/IPC_NS/USER_NS=y`、`CONFIG_BRIDGE/VETH/BRIDGE_NETFILTER/NF_NAT/MEMCG/BLK_CGROUP/CGROUP_PIDS/CGROUP_CPUACCT=y`，并安装 `docker`、`dockerd`、`containerd`、`runc`、`tini`、`ca-bundle`、`kmod-veth`、`kmod-br-netfilter`、`kmod-ipt-nat`、`iptables-nft`。
- 镜像检查：`{{DOCKER_EVIDENCE}}`

### 9. Feeds 与 preflight

- 真实构建 [43709222330](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43709222330)（05+09 合并后）：工作流下载项目公钥、校验 sha256 与 `feedSet.key.fingerprint` 一致、`apk update` 拉取 **11624** 个包索引、`apk add --simulate` 通过后才执行 `make image`。
- `src/lib/build/feeds.ts` 生成 public/private 两种 feed set：public = official + 签名 supplement（选用 extension 包时再加 extension）；private = 同上 + `apk-dllkids` 包装。dllkids 从不进入默认 repository 行，`/etc/apk/repositories.d/90-combinewrt.list` 版本冻结，保留 `distfeeds.list`，只安装 `/etc/apk/keys/combinewrt-feed.pub.pem`。
- source offer 的 `feedSet`（文件内容剥离）进入构建 provenance；V1 offer 保持 `feedSet: null`。单测与 e2e 均覆盖。
- preflight 失败形状：`COMBINEWRT_FAILURE={"step":"preflight","package":"…","source":"…","message":"installability preflight failed for …"}`，并由工作流在任何镜像构建之前退出。
- 未验证：没有一条 run 专门对比“同一计划 public vs private 产物中 repository 文件不同”的镜像内文件；该差异由单测覆盖。

### 10. Source sync

**supplement（真实跑通）**

| 阶段 | Run | 结果 |
| --- | --- | --- |
| 上游 commit 构建 | [43702446473](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43702446473) | 成功，6/6 包，`source_commit 19a44706dde7554f21c9d0503cdcfc399914067f`，run-name `packages 25.12.2` |
| 自动发布 live | [43703618796](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/43703618796) | 成功；由构建 run 自动 dispatch |
| staging（元数据变化） | [43703141721](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/43703141721) | 成功；写 `staging.json`，live 索引不变 |
| staging → live 提升 | [43703283136](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/43703283136) | 成功，`promoted_from_staging=true` |
| 项目密钥重签名 | [43726635531](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/43726635531) | 成功；6/6 apk + index `OK` |

**dllkids（部分）**

- 事务性采纳、同版本哈希阻断、解析失败回滚、缓存回滚由 `src/lib/source-watch/service.test.ts` 等 16 例 fake fetch/fake clock 测试覆盖；真实在线站点**没有**执行过一次自动采纳（站点进程需要在 6 小时窗口内运行并观察到上游变化）。
- **延迟指标未测量**：detect ≤24h / rebuild+publish ≤48h 是设计目标；现有真实 run 都是按需触发，不能证明调度延迟。需要站点上线并连续运行至少 48 小时后再补测。
- extension registry ref 变化走同一 watch 的候选重建路径，单测覆盖，未做真实端到端。

### 11. Build ops

- **队列/并发**：ticket 13 的单测覆盖 FIFO、cap 2（第 3 个排队）、完成/失败/取消释放槽位、重启恢复、排队不超时、取消排队（不调用 GitHub）、运行中取消、dispatch 竞态；**没有**从站点队列真实派发到 GitHub 的 run。`MAX_CONCURRENT_BUILDS` 默认 2（1–16）。
- **失败标记**：[43705890215](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43705890215) 预期失败，日志含 `COMBINEWRT_FAILURE={"step":"prepare-plan",…,"context":{"target":"x86/64","variant":"efi-ext4-emmc","engine":"imagebuilder"}}`。
- **产物下载**：ticket 14 的 route 单测覆盖 200/206/416、`Accept-Ranges`、`Content-Range`、`Content-Disposition`、`X-Checksum-SHA256`、2 GiB 上限与保留清理；e2e 覆盖下载按钮/鉴权代理。
- **source offer**：V1/V2 单测 + e2e V2 source offer（engine/target/kernel/modes/feed set/pins）；V1 offer 保持原 schema。
- **V1 只读兼容**：V1 构建 [43705270610](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43705270610) 成功，manifest 只有 4 个字段；e2e 打开 V1 构建页与 source offer 不报错；`src/lib/db.test.ts` 覆盖“populated V1 database → V2 schema 不丢行”。

### 12. Regression

- V1 标准构建 [43705270610](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43705270610)：成功，`immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz` sha256 `6227c53a…`（与 V1 行为一致），manifest 无 `schemaVersion`。
- `e2e/build-flow.spec.ts` 7 个 V1 场景 + `e2e/build-v2.spec.ts` 4 个 V2 场景，共 11/11 通过。
- 旧快照/旧计划页面由 V1 只读路径渲染；迁移只追加。

## 最终 V2 回归清单

| 要求 | Run | 结果 |
| --- | --- | --- |
| V1 标准构建 | [43705270610](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43705270610) | ✅ |
| EFI ext4 | [43704700295](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704700295) | ✅ |
| Legacy squashfs | [43704714436](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704714436) | ✅ |
| VMDK | [43866425386](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43866425386) | ✅ |
| qcow2 | [43704727299](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704727299) | ✅ |
| source kernel | [43853764898](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43853764898)（暖）/ [43711004777](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43711004777)（冷） | ✅ |
| Docker | [43866444618](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43866444618) | 🟡（见 §8） |

## 未验证 / 明确不在 V2.0 范围

| 项 | 原因 / 当前状态 |
| --- | --- |
| 真实 ARM（`mediatek/filogic`）构建 | registry 建模，无设备与真实构建；spec 明确不计入 V2.0 |
| 真实 eMMC 镜像 | 随首个 ARM 目标；x86 无 eMMC 产品 |
| rootfs tar 真实构建 | 只有变体映射/命名 fixture；没有真实 run |
| source engine 跑 6.12 默认线 | 6.12 只经 ImageBuilder 验证；源码构建只跑过 6.6 |
| kernel 6.18 镜像 | 已 pin 到 `a4ba8240…`，从未构建，保持实验 |
| Pages 从 main 真实部署 | 非 main 的 publish run 的 deploy job 被 `github-pages` 环境规则拒绝；需要 main 上的一次运行 |
| extension feed 的 chroot 安装测试 | 目前只验证 `apk verify`（包与索引），未在 chroot 中 `apk add` |
| dllkids 在线自动采纳 | 只有 fake fetch/clock 单测；未在运行中的站点触发 |
| source watch 24h/48h 延迟 | 未连续运行 48h 观察；现有 run 都是按需触发 |
| IPv6/PPPoE/WiFi/switch-port 真机连通性 | 只验证生成与拒绝路径，无硬件启动测试 |
| 队列真实派发 | 单测覆盖队列语义；没有“站点队列 → GitHub run”的真实链路证据 |
| public vs private 镜像内 repository 文件 diff | 由单测覆盖生成逻辑，未对比两条真实镜像 |
| Docker `/var/lib/docker` 首次启动行为 | 镜像内验证见 §8；没有在真实 Docker 容器/VM 中启动 dockerd 跑容器 |

## 本地可复现校验

在 `v2/ticket-16` 工作树（`/tmp/combinewrt-wt/v2-16`）执行：

```bash
npm test
npm run typecheck
npm run lint
npm run capabilities:validate
npm run sources:validate
npm run kernel-lines:validate
npm run build        # 限资源包装见 deploy/README.md
npm run test:e2e:only
```

结果：`npm test` 80 文件 / **662 用例通过**；`npm run typecheck` 干净；`npm run lint` 干净；`capabilities:validate` = 2 targets / 2 profiles / 21 variants / 3 kernel lines / 16 modes；`sources:validate` = 14 packages（official 7 / dllkids 1 / supplement 1 / extension 5）、13 bundles、2 themes；`kernel-lines:validate` = 3 lines（2 source / 1 imagebuilder）；限资源 `npm run build` exit 0（Next.js 16.4.6，22/22 路由编译）；`npm run test:e2e:only` **11/11 passed（57.4s）**。

按 runbook 在临时端口启动（临时 DB、dummy secret/hash、`BUILD_ADAPTER=fake`）并请求 `/api/health`：`next start -p 3101`（`DATABASE_PATH=/tmp/t16-health.db`、dummy `SESSION_SECRET`/`ADMIN_PASSWORD_HASH`、`BUILD_ADAPTER=fake`）→ `✓ Ready in 131ms`，`curl -fsS http://127.0.0.1:3101/api/health` → `{"ok":true}`；进程随后关闭，临时 DB 已删除（未提交）。

新库从零迁移与旧库升级：

- `src/lib/db.test.ts` → "creates the database file and applies migrations"（空目录 → 全量迁移）
- `src/lib/db.test.ts` → "migrates a populated V1 database to the V2 domain schema without losing rows"（V1 行保留、V2 表/列新增）
- `src/lib/db.test.ts` → "is idempotent across restarts"（重复启动不重复执行）
