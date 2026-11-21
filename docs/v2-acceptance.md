# combinewrt V2.0 验收矩阵

本文件逐行对应本地设计文档 `spec.md`（`.scratch/v2-build-site/spec.md`，不随仓库发布）的 **V2.0 Acceptance Matrix**，并记录真实 run id、artifact sha256/大小、apk db 断言、kernel 版本、镜像检查与未验证项。所有数字来自 `wuyuzaddd/combinewrt-build` / `wuyuzaddd/combinewrt-packages` 的真实 GitHub Actions 运行或本仓库可复现的本地校验；没有 run id 的行明确标为未验证。**字节数口径**：凡写"sha256 + 大小"的，数字都指 **GitHub artifact ZIP 内的镜像文件**（即 manifest 的 `sha256`/`size`）；GitHub artifact ZIP **容器**本身的 digest 与字节数是另一组数，本文件在用到时显式标注为"artifact zip"，两者不可混用（见 §4）。

- 基线：`v2-integration`（tickets 01–15 已合并）；本轮最终 main 复核的站点 HEAD 为 `8af7b35`
- 证据时间：2026-11-16（首轮）、2026-11-18（Docker boot-equivalent）、2026-11-20（最终 main 复核）、2026-11-21（ticket 13 实现与真实下载复测通过）
- 构建仓：[`wuyuzaddd/combinewrt-build`](https://github.com/wuyuzaddd/combinewrt-build)（main = `51d7102`，2026-11-20 复核前后一致；四个 workflow 与 `.github/scripts/*` 已与站点 `build-workflow/` 逐字节同步。旧 main 上的 V2 冒烟 [43868727061](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43868727061) 全步骤通过，最终 main 上的新证据见各行）
- Feed 仓：[`wuyuzaddd/combinewrt-packages`](https://github.com/wuyuzaddd/combinewrt-packages)
- 状态图例：✅ 真实运行/可复现证据成立；🟡 单测/fixture/部分证据成立，缺真机或端到端；⬜ 未验证或明确不在 V2.0 范围

## 矩阵总览

| # | 维度 | 验收要求 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | Target | `x86/64` + `generic`；ARM 只建模 | ✅ | registry 校验；x86/64 多次真实构建；ARM `mediatek/filogic` 仅在 registry，无真实构建 |
| 2 | Boot | EFI、Legacy | ✅ | EFI run [43704700295](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704700295)；Legacy run [43704714436](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704714436) |
| 3 | Filesystem | ext4、squashfs | ✅ | 同上两条 run 的 artifact 名与 manifest |
| 4 | Artifact | combined、rootfs tar、VMDK、qcow2；overlay 可设 | ✅ | combined `43704700295`、Legacy `43704714436`、qcow2 `43704727299`、VMDK `43866425386`；**rootfs tar 走产品路径真实构建**：站点 `POST /api/builds` 建 `87cc882f-c43d-4bd2-957d-26c724cf0294` → build 仓 run [44757850173](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44757850173) 成功（`repository_dispatch`，非手工 dispatch），产物 `immortalwrt-25.12.2-x86-64-generic-targz-rootfs.tar.gz` sha256 `03518a0618622b13a321677bd33047006229627565c8e4018849276bf475e571`，12,643,389 B，manifest `variant={artifact:"rootfs",boot:"efi",filesystem:"ext4"}` |
| 5 | eMMC | 模型/能力/UI 完成，真实构建不计入 | ✅ | registry 明确 `supported:false`/experimental，UI 禁用并给出原因（e2e）；spec 原文“真实 eMMC 构建随首个 ARM 目标，不计入 V2.0”，验收要求已全部落地 |
| 6 | Kernel | 6.12 默认；6.6/6.18 实验；至少一条源码线产出镜像 | ✅ | 6.12 默认走 ImageBuilder（`43704700295`，日志安装 `kernel=6.12.103`）；6.6 源码冷 `43711004777` / 暖 `43853764898`（kernel 6.6.159）；“至少一条源码线产出镜像”成立。**镜像实际内核取自工作流日志与包版本；manifest 的 `kernelLine` 是计划输入，不作内核证据**（见 §6）。6.18 已 pin（`a4ba8240…`）但未构建，属实验线，spec 不要求验收 |
| 7 | Modes | 16 个声明式 mode；主题走 extension bundle | ✅ | 16 个 mode 声明 + typed network（LAN/DHCP/WAN/IPv6/WiFi/switch-port/bypass）由 `capabilities:validate` 与单测覆盖；互斥/requires 在计划阶段 409（e2e）；主题走 extension 包/bundle 路径，真实签名包 `apk verify` 通过；**13 个 bundle 的可安装性已真实执行**：feed 仓 CI run [44753804235](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/44753804235) 成功，13/13 bundle 通过真实 `apk add --simulate` 闭包测试（0 失败 0 跳过）。真机连通性属硬件外因素，不在本行 |
| 8 | Docker | 源码构建、ext4 combined + overlay、`/var/lib/docker` 可写 | ✅ | 源码构建 compose 正确性 `43866444618`（1h39m57s，307 opkg 包，ext4 可写）；**最终 boot-equivalent 验证 [44309616413](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44309616413) 成功**（33m31s，`buildSeconds 1530`，cache 全暖，**镜像内文件** `immortalwrt-24.10-SNAPSHOT-x86-64-generic-ext4-combined-efi.img.gz` sha256 `9fea0ca09775e6ebe1d3ceca0f3346b37bda9e62764b5292993e49ef7ce131ba`，106,990,213 B — 这是 manifest 记录的镜像大小，不是 GitHub artifact zip 容器大小）：3 个 `plan.files[]` 以正确 mode 在镜像内、镜像自带 uci-defaults 含 `mkdir -p /var/lib/docker` + `data_root='/var/lib/docker'`、按镜像自身 `/var→tmp` 链条挂 tmpfs 后 chroot 执行该脚本，`/var/lib/docker` 存在且可写、`data_root` 已更新 |
| 9 | Feeds | 公开/私有 image feed set 正确生成并进 source offer | ✅ | 真实 preflight run 43709222330；feeds/source-offer 单测与 e2e |
| 10 | Source sync | dllkids 自动采纳 + supplement 自动发布真实跑通一次 | ✅ | supplement 构建→发布→staging→提升真实跑通（`43702446473`/`43703618796`/`43703141721`/`43703283136`）且 main 部署 `43907601591`；**dllkids 自动采纳已在真实站点跑通**（2026-11-20，live feed index sha `36ad823d…`，641 个包）：首次观察即自动 `adopted_bootstrap` 落库（`adopted_by=auto`，seed `04a549ed…` 未被当作权威），随后两次目录刷新都用 DB pin 构建 snapshot `1`（12,262 个包），采纳时间 2026-11-20T13:30:47Z |
| 11 | Build ops | 队列并发、失败标记、产物下载、source offer、V1 计划只读 | ✅ | 失败标记 `43705890215`、下载/保留期/2 GiB 上限（单测 + 路由测试）、source offer（e2e V2）、V1 只读（`44757195318` + e2e）；**队列真实派发与交付**：build `548c413f-b41b-4070-bf81-cb35a2adbe1c` 在 `MAX_CONCURRENT_BUILDS=1` 下排队 **204.3 s 且 `runId:null`（未调用 GitHub）**，槽位释放后由 reconciler 自动派发 → run [44758426869](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44758426869) 成功，**镜像内文件** sha256 `83c5cc6c01213096ea2e6c9e1809e6d55922f6c034301cc339a3d7445fcc9b70`，12,643,301 B，站点下载路由 **HTTP 200**。早前证据：`44294267917`、`44294943285`、`44298291283`。注意下载路由当前下发的是 GitHub artifact ZIP 容器而文件名标 `.tar.gz`，见“未验证”表中“开放缺陷”一行（ticket 13；2026-11-21 实现：继续交付 ZIP 容器，标注改为容器真实值并在前端提示解压；**真实下载复测已通过**：HTTP 200，12,598,254 B，`X-Checksum-SHA256` = `023fe721…`，`X-Image-Sha256` = `83c5cc6c…` / 12,643,301 B，206/416 均正确） |
| 13 | Package feed | 上游新组（quickstart / iStore / partexp）进签名 feed，版本合法、签名可验证、来源可审计 | 🟡 | 构建：extension run [44893395104](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44893395104) **7/7 成功**（`manifest: 7/7 packages ok`），每个包 `apk version -t` 返回 `=`（含 `0.17.1_rc20261028-r7`）且 `apk verify` OK；bundle 依赖测试 15 bundles / 0 failure；发布：staging run [44894387084](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/44894387084) 成功，7 个包与 `packages.adb` 用项目 feed key 重签后 `apk verify` 全 OK，`verify-feed: ok — 7 package versions`，`extension-staging.json` 的 `sourceRepo/sourceCommit/sourcePath` 逐一指向 istoreos/quickstart / istoreos/istore / sirpdboy/luci-app-partexp；同名断言：官方 5 个 feed 共 10,316 个包 ∩ 本 feed 7 个包 = ∅。**未做的部分见“未验证”表**：live 发布（ADR 0008 的 recipe 门禁要求人工批准）、真实 rootfs 内 `apk add` 安装、`feed-test.yml` 负例 |
| 12 | Regression | V1 x86_64 标准构建仍通过；旧页面不报错 | ✅ | V1 run [44757195318](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44757195318)（build 仓 main `51d7102`，`workflow_dispatch`，conclusion success）：`immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz` sha256 `022787df9a7f3b10a767ef13aef4f7fb366e0cbb6f23cbc1d1ee5f5a49015255`，21,262,492 B，manifest 为 4 字段 V1 形状；e2e V1 页面；迁移单测 |

## 字节口径说明

一次 GitHub Actions run 产生的 artifact 是 **ZIP 容器**，容器里有构建出的镜像文件。两者字节不同：

- **镜像内文件**：manifest 的 `sha256`/`size`，也是构建记录 `artifact_sha256`/`artifact_size` 记的值；
- **artifact zip 容器**：`gh api .../runs/<id>/artifacts` 的 digest 与字节数，通常比镜像文件略小（重新压缩）。
- **下载路由（2026-11-21 实现，ticket 13；migration `150_artifact_container` 记录容器 sha256/size）**：`GET /api/builds/<id>/artifact` **继续交付 GitHub artifact 的 ZIP 容器**（不在服务端解包），但标注改为容器真实值：文件名 `<artifactName>.zip`、`Content-Type: application/zip`、`Content-Length` = 容器字节数、`X-Checksum-SHA256` = 响应字节自身的 sha256；另补 `X-Image-Name`/`X-Image-Sha256`/`X-Image-Size` 三个头部，值取自构建记录里**镜像文件**的 `artifact_name`/`artifact_sha256`/`artifact_size`。前端在下载按钮下同时写明“下载的是 ZIP 容器（需解压）”与“解压后镜像：名称 / 大小 / sha256”。产物字节上限可用 env `ARTIFACT_MAX_BYTES` 覆盖，默认 2 GiB，只量容器字节（不量镜像虚拟大小）。跟进票：`.scratch/v2-hardening/issues/13-artifact-container-labelling.md`。

本文件所有 ✅ 行的 sha256/大小都取**镜像内文件**；只有在讨论下载路由行为时才引用 zip 容器（见 §11 与第 13 项待办）。

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

| 变体 | Run | 产物 | sha256（镜像内文件） | 大小（镜像内文件） |
| --- | --- | --- | --- | --- |
| EFI ext4 combined | [43704700295](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704700295) | `.img.gz` | `6227c53aeb55cffc840688b87e4a1ee795494dd1c2f74c4fe49cd84fda040a86` | 21,262,502 B |
| Legacy squashfs combined | [43704714436](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704714436) | `.img.gz` | `ff310aa0584e2946ac2dd0af0fdb9d2007dc9da8d7f3ca40bab3e1b942530599` | 18,660,330 B |
| EFI ext4 qcow2 + overlay 512 | [43704727299](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704727299) | `.qcow2` | `4680a71fcd7e3557462ce4760ca1d22d945e78cf2958283b4dca2a2e26f71252` | 49,217,536 B |
| EFI ext4 VMDK + overlay 512 | [43866425386](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43866425386) | `.vmdk` | `273955d24ad612ca0b540fe9616d11848b4a232ecbf53752a04c69141e51bae2` | 49,872,896 B |
| EFI ext4 rootfs tar（产品路径） | [44757850173](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44757850173) | `…-targz-rootfs.tar.gz` | `03518a0618622b13a321677bd33047006229627565c8e4018849276bf475e571` | 12,643,389 B |

- rootfs tar 是**产品路径**产物：2026-11-20 通过站点 `POST /api/builds`（HTTP 201）提交 `imageVariant={boot:"efi",filesystem:"ext4",artifact:"rootfs"}`，站点准备 V2 计划、GitHub adapter 发 `repository_dispatch` 并解析出 run id，run 成功并在 manifest 里记录上面这组 sha256/大小与 `variant`。不是手工 `workflow_dispatch`，也不是只靠 `mapImageVariant`/`variant-config.sh` 的 parity 测试（该测试仍覆盖 `rootfs` 命名与 `CONFIG_TARGET_ROOTFS_TARGZ=y`）。
- qcow2 run 的 manifest 记录源 raw `.img` sha256 `d2e0b4f18e739e3e1522720187365703c5eebb6a0cdf236e0ae40af7b1ca9946`、大小 570,719,744 B（544 MiB 虚拟磁盘），证明 overlay 512 MiB 生效；工作流日志记录 `gzip -dc …; qemu-img convert -f raw -O qcow2 …`。
- VMDK run 的 manifest（`/tmp/vmdk-art/.../manifest.json`，sha256 与产物一致）记录 raw 570,719,744 B、converted 49,872,896 B；本地 `qemu-img info` 输出 `file format: vmdk`、`virtual size: 544 MiB (570719744 bytes)`、`create type: monolithicSparse`。
- VMDK run 的 "Assert top-level packages" 步骤挂载了 `loop0p2`（ext4 rootfs），日志逐行输出 `verified package: luci`、`verified package: curl`，说明 apk db 可读且顶层包确实在镜像里。

### 5. eMMC

- capability registry 中有 `emmc` artifact 模型；UI 对 x86 的 eMMC 变体显示 registry 给出的不可用原因，`e2e/build-v2.spec.ts` 覆盖“不可用变体禁用并显示原因”。
- 没有真实 eMMC 构建。spec 明确 eMMC 真实验收随首个 ARM 目标，不计入 V2.0。

### 6. Kernel lines

| 线 | 引擎 | 证据 | 结果 |
| --- | --- | --- | --- |
| 6.12（默认） | ImageBuilder | [43704700295](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704700295) | 镜像实际内核来自**工作流日志与安装的 `kernel` 包版本**：日志安装 `kernel=6.12.103~…`（25.12.2 ImageBuilder 自带），故该镜像是 6.12.103。**该 run 的 artifact manifest 里 `kernelLine` 是 `{"id":"linux-6.6","version":"6.6","engine":"imagebuilder"}` —— manifest 字段记录的是计划输入，不是实际构建出的内核，不能当作内核证据**。默认线真实产出镜像成立 |
| 6.6（实验） | source | [43711004777](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43711004777) | 冷启动 61m05s，`buildSeconds 3165`，kernel **6.6.159**，sha256 `11b7506040398d84ae11ac839ccfde68658915f148292c4c7c233514aa087365`，19,262,416 B |
| 6.6（实验，暖缓存） | source | [43853764898](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43853764898) | 25m51s，`buildSeconds 1219`（冷启动的 38%），kernel **6.6.159**，sha256 `50ec85770836ffacfed31b09bc61f16c72abfa673e4b163f0b5362b165178e99`，19,260,397 B；manifest `cache:{download:true,staging:true,ccache:true}` |
| 6.18（实验） | source | 仅 registry pin `a4ba8240d8a1aaef7e8c6f2d65e841a9bfd2b8c5` | ⬜ 从未构建 |

源码构建的 kernel 版本不是只看 recipe：工作流在 checkout 后校验 `KERNEL_PATCHVER`/`include/kernel-6.6`，构建后从 `build_dir/**/kernel.release` 读出实际版本并与 `expectedKernel` 比对，不符即失败。6.12 源码线（source engine）没有跑过；默认 6.12 只经过 ImageBuilder 验证。

### 7. Modes、typed network 与主题

- 16 个 mode 与 registry 完全一致：`istoreos-brand`、`nas`、`docker`、`wan-eth0`、`switch-port`、`ipv6`、`pppoe`、`wifi`、`webserver-uhttpd`、`webserver-nginx`、`webserver-lighttpd`、`https-selfsigned`、`usb-wired`、`usb-wifi`、`wwan`、`bypass`。
- 声明式校验与生成由 `src/lib/build/modes.test.ts` 覆盖（36 例），包括：
  - `switch-port` 的 WAN/LAN 端口映射生成、端口复用拒绝；
  - `ipv6` 与 typed IPv6 设置必须成对出现；
  - `pppoe` 凭据只写入生成的 uci-defaults、验证消息不含密码；生成文件内容在计划落库前脱敏、`build.yml` 写文件后就地重写 `plan.json`，因此凭据不进入日志或 `builds.plan_json`；
  - `wifi` 需要 radio 能力或 `usb-wifi`，缺 typed 设置被拒绝；
  - `wan-eth0` 与 `switch-port` 互斥；
  - `docker` 在 squashfs 上被拒绝，在 ext4/source 上接受。
- e2e `e2e/build-v2.spec.ts` 真实走 HTTP：Advanced 选择 Docker/6.6 后切回 6.12 得到可读 409；Simple V2 构建与 V2 source offer 渲染通过。
- **未做真机网络验证**：没有在真实硬件上启动镜像验证 IPv6/PPPoE/WiFi/switch-port 的连通性；本行证据是“生成正确、拒绝路径可读”，不是硬件验收。
- 主题与 bundle：extension feed 的 build run [43711097432](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43711097432) 成功；publish run [43725476372](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/43725476372) 为 **publish 成功 / deploy 被 Pages 环境规则拒绝（run conclusion `failure`）**，即产物与索引已生成但 live 站点未更新（后续真实部署见 §10 的 `43907601591`）。新克隆用只含项目公钥的 key dir 执行 `apk verify`，两个主题包与 `packages.adb` 均 `OK`。
- **bundle 可安装性（2026-11-20 起已执行）**：feed 仓 CI run [44753804235](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/44753804235)（`feed-test.yml` 的 `bundles` job）对 `config/extension/bundles.json` 的 13 个 bundle 展开包列表，逐包解析到首选源层并对一次性 apk 数据库执行真实 `apk add --simulate`：**13/13 通过，0 失败 0 跳过**。故意把 `kmod-does-not-exist` 加进 `proxy-openclash-tun` 时脚本退出 1 并输出 `COMBINEWRT_FAILURE bundle=proxy-openclash-tun package=kmod-does-not-exist target=x86/64`（12 通过 1 失败），证明失败路径会点名 bundle/包/target。strict schema 仍拒绝 scripts/hooks，bundle 只引用 registry 包。

### 8. Docker

- 构建：source 源码构建 run [43866444618](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43866444618)，kernel line 6.6（kernel 6.6.159），`imageVariant={boot:efi,filesystem:ext4,artifact:combined,overlaySizeMb:512}`，`modes=[docker]`，engine `source`。
- 计划层要求：`config/modes/docker.json` 的 `requires` 为 `engine:source`、`filesystem:ext4`、`artifact:combined`、`capability:overlay`；squashfs 在计划阶段被拒绝（单测覆盖）。
- Recipe：`CONFIG_OVERLAY_FS=y`、`CONFIG_CGROUPS=y`、`CONFIG_NAMESPACES=y`、`CONFIG_NET_NS/PID_NS/UTS_NS/IPC_NS/USER_NS=y`、`CONFIG_BRIDGE/VETH/BRIDGE_NETFILTER/NF_NAT/MEMCG/BLK_CGROUP/CGROUP_PIDS/CGROUP_CPUACCT=y`，并安装 `docker`、`dockerd`、`containerd`、`runc`、`tini`、`ca-bundle`、`kmod-veth`、`kmod-br-netfilter`、`kmod-ipt-nat`、`iptables-nft`。
- 镜像检查（run [43866444618](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43866444618)，成功，2026-11-16T12:25:30Z→14:05:30Z，总耗时 1h39m57s，`buildSeconds 5389`，冷缓存 `{download:false,staging:false,ccache:false}`）：
  - manifest：`immortalwrt-24.10-SNAPSHOT-x86-64-generic-ext4-combined-efi.img.gz`，sha256 `77ea59a21928f83dd26964851dcbdddd641138fdcfbe6c8848eec26a50835fbb`，**107,416,918 B（镜像内文件）**，`kernelVersion 6.6.159`，`kernelLine 6.6`，source `af0775ab…`（openwrt-24.10）。
  - 宿主机没有可用的 loop 设备（`losetup` 返回 operation not permitted），因此用 GPT 偏移 `dd` 出 p2 后用 `debugfs` 离线检查；这不是镜像问题，是当前容器权限限制。
  - p2 = `rootfs`，ext4（`has_journal ext_attr resize_inode filetype extent sparse_super large_file uninit_bg`），300 MiB，`e2fsck -fn` 状态 clean（仅提示 inode bitmap 末尾 padding 未设置，属上游 mkfs 的 cosmetic 警告）；`/usr/lib/os-release` = `ImmortalWrt 24.10-SNAPSHOT`。
  - 包管理：24.10 使用 **opkg**，`/usr/lib/opkg/status` 共 **307** 个包。`docker 27.3.1-r1`、`dockerd 27.3.1-r3`、`containerd 1.7.22-r1`、`runc 1.1.14-r1`、`tini 0.19.0-r2`、`ca-bundle 20260816-r2`、`kmod-veth/kmod-br-netfilter/kmod-ipt-nat 6.6.159-r1`、`iptables-nft 1.8.10-r1`、`kernel 6.6.159~365a65b8…-r1` 全部为 `install ok installed`；`/etc/init.d/dockerd`（0755）与 `/etc/config/dockerd`（0600）存在。
  - 可写性：`/opt/docker` 存在（0755），在离线镜像副本上用 `debugfs -w` 执行 `mkdir /opt/docker/t16-write-test` 成功（随后 rmdir），证明 ext4 数据分区可写。镜像内 `/etc/config/dockerd` 的 `data_root` 是 **`/opt/docker/`**（包默认值）。
  - **该 run 未满足的断言（已被 44309616413 补上）**：镜像内 **没有 `/var/lib/docker`**；`/var` 是指向 `tmp` 的符号链接，因此 `/var/lib/docker` 即使创建也在 tmpfs 上。原因是当时的 `source-build.yml` 只消费 `SourceRecipe`（`config`/`feedsConf`/`packages`），**没有写入计划的 `files`**：docker mode 生成的 uci-defaults（`mkdir -p /var/lib/docker`、设置 data root）以及 feed set 生成的 `/etc/apk/...` 文件都只进入 ImageBuilder payload，未进入源码构建。源码构建实际使用 stock 的 `/opt/docker`，且 24.10 是 opkg 而非 apk，V2 的 apk feed set 本来也不适用于这条源码线。
  - 结论：源码构建、kernel 6.6.159、docker 包集、ext4 可写、dockerd init/config 均已验证；`/var/lib/docker` 由下一条的 boot-equivalent run 验证。
- 中间失败 run [43891611647](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43891611647)（2026-11-16，ref `fix/v2-review`）：`Write generated files overlay` 与 `make` 均成功，但后续验证步骤失败。**2026-11-18 更正根因**：该 run 的失败并不是 chroot 里 `/var` 不可写，而是 `gzip -dc` 对镜像尾部 padding 返回退出码 2，`set -e` 在解压处就直接终止（整份日志 0 条 `COMBINEWRT_FAILURE`）。此前文档中"chroot /var 不可写 + 结构化标记"的描述有误，已按日志更正。
- **最终验证 run [44309616413](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44309616413)**（2026-11-18T13:02:00Z→13:35:31Z，`fix/v2-docker-verify`，33m31s，`buildSeconds 1530`，cache `{download:true,staging:true,ccache:true}`）：
  - 解压只接受 `exit 2 + "trailing garbage ignored"`，其余一律失败；
  - 断言 `plan.files[]` 的 3 个路径全部以记录的 mode（0755/0644/0755）存在于挂载的 rootfs；
  - 断言镜像内 uci-defaults 含 `mkdir -p /var/lib/docker`、`chmod 0711`、`data_root='/var/lib/docker'`；
  - 解析镜像自身的 `/var` 符号链接链（今天 `→ tmp`），在解析结果上挂 16 MiB tmpfs，`chroot` 执行镜像自带的 `/etc/uci-defaults/91-combinewrt-docker`；
  - 结果：`/var/lib/docker` 存在、可写（chroot 内 create+delete 验证），`dockerd data_root` 变为 `/var/lib/docker`；日志 `docker data root verified at first boot: /var/lib/docker exists on the tmpfs-backed /var, is writable, and dockerd data_root matches`。
  - artifact：`immortalwrt-24.10-SNAPSHOT-x86-64-generic-ext4-combined-efi.img.gz`，sha256 `9fea0ca09775e6ebe1d3ceca0f3346b37bda9e62764b5292993e49ef7ce131ba`，106,990,213 B（**镜像内文件**；独立下载后 sha 与 manifest 一致；GitHub artifact zip 容器是另一组字节，未在此引用；`debugfs` 可见 uci-defaults 0755/495 B，`/var → tmp`）。
  - 该方法之所以等价于"启动后"：镜像的 `/var` 是指向 `tmp` 的符号链接，首次启动由 init 在 `/var` 挂 tmpfs，所以 `/var/lib/docker` 只可能存在于启动后；验证重放了同一过程（镜像自带脚本 + 镜像自身解析出的 `/var` + tmpfs），无需 KVM。
- 另有未由本次运行覆盖的项：真正用 QEMU/init 启动镜像、以及真正拉起 dockerd 跑容器，见"未验证"表。

### 9. Feeds 与 preflight

- 真实构建 [43709222330](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43709222330)（05+09 合并后）：工作流下载项目公钥、校验 sha256 与 `feedSet.key.fingerprint` 一致、`apk update` 拉取 **11624** 个包索引、`apk add --simulate` 通过后才执行 `make image`。
- `src/lib/build/feeds.ts` 生成 public/private 两种 feed set：public = official + 签名 supplement（选用 extension 包时再加 extension）；private = 同上 + `apk-dllkids` 包装。dllkids 从不进入默认 repository 行，`/etc/apk/repositories.d/90-combinewrt.list` 版本冻结，保留 `distfeeds.list`，只安装 `/etc/apk/keys/combinewrt-feed.pub.pem`。
- source offer 的 `feedSet`（文件内容剥离）进入构建 provenance；V1 offer 保持 `feedSet: null`。单测与 e2e 均覆盖。
- preflight 失败形状：`COMBINEWRT_FAILURE={"step":"preflight","package":"…","source":"…","message":"installability preflight failed for …"}`，并由工作流在任何镜像构建之前退出。
- 未验证：没有一条 run 专门对比“同一计划 public vs private 产物中 repository 文件不同”的镜像内文件；该差异由单测覆盖。

### 10. Source sync

**supplement（真实跑通）**

| 阶段 | Run | 结果（run conclusion 见括号） |
| --- | --- | --- |
| 上游 commit 构建 | [43702446473](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43702446473) | 构建成功，6/6 包，`source_commit 19a44706dde7554f21c9d0503cdcfc399914067f`，run-name `packages 25.12.2`（build `success`） |
| 自动发布 live | [43703618796](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/43703618796) | publish 成功（`success`，main）；当时布局只有扁平 `/x86_64/`，`/supplement/<base>/<target>/` 指针尚未建立 |
| staging（元数据变化） | [43703141721](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/43703141721) | **publish 成功 / deploy 被 Pages 环境规则拒绝**：build job 写好 `staging.json` 且 live 索引不变，deploy job 因 `github-pages` environment 只允许 `main` 而失败（run conclusion `failure`） |
| staging → live 提升 | [43703283136](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/43703283136) | **publish 成功 / deploy 被 Pages 环境规则拒绝**（`failure`）；build 记录 `promoted_from_staging=true`，gh-pages 有 frozen path，但 live 站点未更新 |
| 项目密钥重签名 | [43726635531](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/43726635531) | **publish 成功 / deploy 被 Pages 环境规则拒绝**（`failure`）；build job 6/6 apk + index `OK` |
| V2 review 修复后的真实部署 | [43891341975](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/43891341975) | `success`（branch `fix/v2-feedset`）：`/supplement/25.12.2/x86_64/packages.adb` 200，与 frozen 路径同 sha256，`apk verify` OK |
| **main 上正式发布（Pages 实际部署）** | [43907601591](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/43907601591) | `success`（`--ref main`，`feed_kind=supplement`，`publish_mode=live`）：deploy job 成功；线上 `/supplement/25.12.2/x86_64/packages.adb` **HTTP 200**，`sha256 9d201223c8c66badb24b87525c2bb063ae7fe8fde2c77f9b34ac580ffcaf1531`，与 frozen 目录 `19a44706…/packages.adb` **完全一致**；`/x86_64/packages.adb`、`/extension/25.12.2/x86_64/packages.adb`、`/staging.json` 均 200 |

**dllkids（真实自动采纳，2026-11-20）**

- 真实在线站点在全新数据库上**自动采纳成功**：watch 第一次 `POST {"action":"check"}` 就在 99.2 s 内返回 `status:"adopted"`、`observedPin = activePin = 36ad823d3af722e851afb933b71a96a8eec488e2bfdce0f3bbd72af54f821399`（live index `packages.adb` 105,777 B、**641 个包**、`diff:null`、`reason:"safe_change"`），**没有用 `force`**；`source_pins` 记 `adopted_by=auto`，`source_pin_events` 一条 `adopted_bootstrap`（`04a549ed…` → `36ad823d…`，snapshot `1`，`2026-11-20T13:30:47.951Z`）。
- 随后两次 `POST /api/catalog/refresh` 都用 DB pin 构建：`created:false`、snapshot `1`、`sourcePins.dllkids = 36ad823d…`，snapshot 记 `12,262` 个包、`profile_count 1`、`feed_commit 6a373eeb09fa7bc8`。把 env 换成假 seed `ffff…` 重启后再刷新，active pin 仍是 `36ad823d…` —— 证明权威是 DB 而不是配置。
- 采纳前的预期失败也在服务器日志里：内置 seed `04a549ed…` 与 live index 不符，启动时的惰性刷新报 `dllkids packages.adb sha256 mismatch`；采纳后不再出现。
- 事务性采纳、同版本哈希阻断、解析失败回滚、缓存回滚由 `src/lib/source-watch/service.test.ts` 等 16 例 fake fetch/fake clock 测试覆盖；**"同版本号哈希变化仍阻断"这条仍是单测证据**（真实站点未遇到同版本改写）。
- **延迟指标未测量**：detect ≤24h / rebuild+publish ≤48h 是设计目标；这次采纳来自手动触发的一次 check，不能证明 6 小时调度的延迟。需要站点上线并连续运行至少 48 小时后再补测。
- extension registry ref 变化已在 source-watch 调度器接线（`runExtensionWatchIfDue` → `recordObservedCandidate`，`src/lib/source-watch/extension.ts`）：观察到 upstream head 与 registry pin 不同时只为 `extension` 源记录一个 candidate（sha256 of the observed commit map + 缓存字节），**不采纳、不自动发布**；单测用 fake fetch/clock 覆盖，未做真实端到端。

### 11. Build ops

- **队列/并发**：单测覆盖 FIFO、cap 2（第 3 个排队）、完成/失败/取消释放槽位、重启恢复、排队不超时、取消排队（不调用 GitHub）、运行中取消、dispatch 竞态。**真实队列交付（2026-11-20，最终 main）**：`MAX_CONCURRENT_BUILDS=1` 下第一个构建占住槽位，第二个 build `548c413f-b41b-4070-bf81-cb35a2adbe1c` 的 `POST /api/builds` 在 0.022 s 返回 201 `status:"queued"`、`runId:null`、`dispatchedAt:null`（**没有调用 GitHub**），排队 **204.3 s**；槽位一释放，`build_events` 显示同一毫秒 `queued → running dispatch 14:57:17.950Z`（与上一个 build 的 `running → succeeded poll` 同毫秒），即由 reconciler 自动派发，不是用户重试。对应 run [44758426869](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44758426869)（`repository_dispatch`，main，conclusion success，117 s）跑完并 `succeeded`。`MAX_CONCURRENT_BUILDS` 默认 2（1–16）。早前的真实派发证据：`44294267917`、`44294943285`、`44298291283`、`44297603737`。
- **失败标记**：[43705890215](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43705890215) 预期失败，日志含 `COMBINEWRT_FAILURE={"step":"prepare-plan",…,"context":{"target":"x86/64","variant":"efi-ext4-emmc","engine":"imagebuilder"}}`。
- **产物下载**：ticket 14 的 route 单测覆盖 200/206/416、`Accept-Ranges`、`Content-Range`、`Content-Disposition`、`X-Checksum-SHA256`、2 GiB 上限与保留清理；e2e 覆盖下载按钮/鉴权代理。真实下载：`GET /api/builds/548c…/artifact` → **HTTP 200，12,598,254 B**，响应 sha256 `023fe7216bba3b7280539223fd3b4aaff27467e49dcec59fcbcd34276c342053`，等于该 run 的 **GitHub artifact zip 容器** digest；zip 内 `bin/targets/x86/64/immortalwrt-25.12.2-x86-64-generic-targz-rootfs.tar.gz` 才是构建记录里的 `83c5cc6c…` / 12,643,301 B。**下载路由当前把 zip 容器当固件下发**（文件名仍是 `.tar.gz`、`content-type: application/gzip`），这是既有行为，已作为开放缺陷（ticket 13）跟踪，见“未验证”表。2026-11-21 实现（ticket 13）：不在服务端解包，下载继续交付 ZIP 容器，但 `Content-Disposition`（`<artifactName>.zip`）/`Content-Type`（`application/zip`）/`Content-Length`/`X-Checksum-SHA256` 改为容器真实值，并补 `X-Image-Name`/`X-Image-Sha256`/`X-Image-Size` 三个头部与页面解压提示；上限由 `ARTIFACT_MAX_BYTES` 配置（默认 2 GiB，只量容器字节）。因此本行上面那组 12,598,254 B / `023fe721…` 就是**正确口径**，不再是缺陷；真实下载复测已于 2026-11-21 在本机 Docker Compose 部署上通过：响应 12,598,254 B / `023fe721…`，解压后镜像 sha 与大小与记录一致，二次请求 0.049 s 命中缓存。
- **source offer**：V1/V2 单测 + e2e V2 source offer（engine/target/kernel/modes/feed set/pins）；V1 offer 保持原 schema。
- **V1 只读兼容**：V1 构建 [44757195318](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44757195318) 成功，manifest 只有 4 个字段；e2e 打开 V1 构建页与 source offer 不报错；`src/lib/db.test.ts` 覆盖“populated V1 database → V2 schema 不丢行”。

### 12. Regression

- V1 标准构建 [44757195318](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44757195318)（build 仓 main `51d7102`，`workflow_dispatch`，对 `main` 跑，conclusion `success`，265 s）：`immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz` sha256 `022787df9a7f3b10a767ef13aef4f7fb366e0cbb6f23cbc1d1ee5f5a49015255`，21,262,492 B；manifest 无 `schemaVersion`，只有 `artifactName`/`path`/`sha256`/`size` 四个字段；日志证明走的是 V1 路径（`V1 plan: keep the ImageBuilder default configuration`）。
- `e2e/build-flow.spec.ts` 7 个 V1 场景 + `e2e/build-v2.spec.ts` 4 个 V2 场景，共 11/11 通过。
- 旧快照/旧计划页面由 V1 只读路径渲染。**迁移规则**：不删除 V1 数据；允许 FK 保护下的表重建，需在迁移注释写明理由（`010_v2_domain` 是唯一例外：它 `disableForeignKeys: true`、`CREATE …_next` → 拷贝 → `DROP` 旧 `catalog_snapshots` → `RENAME`，注释写明"重建掉旧表，关掉 FK 否则 `catalog_profiles`/`catalog_packages` 会级联删除"）。除此之外的迁移只做加法。
- **兼容性与 V1 规范的关系**：V1 规范已按 ADR 0009 标注为历史记录，共**五处**取代关系。前四处见 ADR 0009（dllkids pin 权威改 DB `source_pins`、supplement feed 走版本冻结路径、新计划一律 `schemaVersion: 2`、`ImageFormatId` 只留只读路径）；**第五处**已标注在 V1 spec 头部：V1 §Package Source Composition 规则 2「不把 dllkids/自有仓库 URL 写进镜像 repositories」被 V2 镜像 feed set（`/etc/apk/repositories.d/90-combinewrt.list` + 私有镜像的 `apk-dllkids` 包装，ADR 0007）取代，V1 该规则只保留为历史理由说明。V1 代码路径只允许读旧数据，不允许写新的 V1 形状记录。

### 13. V2 两轴评审修复（2026-11-16，含 11-18 / 11-20 更新）

- **源码引擎的 `files` overlay（spec:106 / matrix 7、8）**：`SourceRecipe` 现在携带计划的 `files[]`（同一 `path`/`content`/`mode` 契约）与 feed set 摘要；`source-build.yml` 在 `make` 前把这些文件写进源码树的 `files/`（OpenWrt 的 `prepare_rootfs` 从 `$(TOPDIR)/files` 应用），并安装 `combinewrt-feed.pub.pem`；构建后再从产物镜像里逐个断言文件存在。docker mode 的 uci-defaults 同时 `mkdir -p /var/lib/docker` 并把 `/etc/config/dockerd` 的 `data_root` 指向该路径（`/var`→tmpfs，故 `dockerd` 启动时在 tmpfs 上创建；验收语义是“boot 后可写”）。rootfs 产物名与 glob 统一为 `.tar.gz`，并发出 `CONFIG_TARGET_ROOTFS_TARGZ=y`。
- **密钥**：`build.yml` 在 “Write files” 之后用 temp+mv 就地重写 `plan.json`，把 `files[].content` 换成 `<redacted at rest>`（占位符与 `src/lib/builds/redact.ts` 一致，不再泄漏字节数）；站点不再把生成文件内容、`plan.modes.network.wan.password`、`plan.modes.network.wifi.key` 写进 `builds.plan_json`（`src/lib/builds/redact.ts`），派发使用进程内的完整计划，重启后若只剩脱敏计划则显式失败而不是悄悄少写 overlay；派发路径不打印计划负载。
- **`client_payload` 嵌套（spec:108）**：source dispatch 顶层只保留 `buildId`/`schemaVersion`/`engine`/`baseVersion`/`profileId`/`artifactName`/`composition`（7 个），整套 recipe 嵌在 `composition` 下；`source-build.yml` 先归一化回扁平 recipe。单测同时断言 ImageBuilder（10 个）与 source 两条派发的顶层属性上限。
- **dllkids 采纳在刷新中生效**：`refreshActiveCatalog` 先读 `source_pins`（`active`），配置常量只在没有 DB pin 时作为 seed；单测证明 DB 采纳值优先于过期的 env 值。2026-11-20 的真实在线采纳已把这条从单测升级为线上证据（见 §10）。
- **extension watch（ADR 0008）**：调度器新增 `runExtensionWatchIfDue`，对 `config/sources/registry.json` 的 extension 条目观察 upstream head，变化只记 candidate（可审计、可缓存），不采纳、不发布。
- **验证状态（2026-11-20）**：带 overlay 的源码构建最终验证 run [44309616413](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44309616413) 成功（boot-equivalent tmpfs `/var` + chroot 执行镜像自带 uci-defaults，`/var/lib/docker` 存在且可写、`data_root` 更新），Docker 行已转 ✅；2026-11-16 的失败 run 43891611647 根因已更正为 `gzip -dc` 对尾部 padding 返回 2 被 `set -e` 终止（见 §8）。product-path rootfs、队列交付、V1 最终 main 回归见 §4/§11/§12（`44757850173` / `44758426869` / `44757195318`）。
- **feed set URL 一致**：`feeds.ts` 与 preflight 都用 `/supplement/<baseVersion>/<target>/packages.adb`；feed 仓库发布流水线新增部署后断言（live pointer 与 frozen 路径同 sha256 + `apk verify`），分支真实 run 43891341975 证明该 URL 可下载且签名可验证。
- **正确性护栏**：`migrate()` 断言版本严格递增且唯一，并拒绝排序在已应用版本之前的待应用版本；`openDatabase` 设置 `PRAGMA busy_timeout = 5000`；`isBuildPlanV2Form` 要求显式 `schemaVersion === 2` **且**有 `target`；删除 `source-build.yml` 的死 `push` 触发器；`workflow-yaml` 测试钉死 `--allow-untrusted` 的允许清单（仅 build.yml 的下载包 verify/mkndx 共 3 处）；被跳过的契约测试会打印跳过原因。

**按 ADR 保留的兼容性（记录而非修改）**：V1 表单提交映射为 v2 计划（ADR 0009 冲突 3 已取代 ticket 03 的“旧 V1 表单仍走 v1 plan”），但工作流端仍接受扁平 V1 payload 并对其产出 4 字段 V1 manifest（§12 的 `44757195318` 即为该路径）；`ImageFormatId` 只留在 V1 只读路径；`DLLKIDS_INDEX_SHA256` 配置常量继续保留，但只是全新安装的 seed，DB `source_pins` 是唯一权威。

### 14. 软件包扩展：quickstart / iStore / partexp（2026-11-21）

**上游事实（均为 2026-11-21 用 `api.github.com` 重新核对，不采信二手说法）**

| 包 | 上游 | pin | 许可 | 备注 |
| --- | --- | --- | --- | --- |
| `quickstart` | `istoreos/quickstart` | tag `v0.17.1-rc20261028` → commit `0183b167…` | MIT（`/license` API） | release asset `quickstart-binary-0.17.1-rc20261028.tar.gz`，16,229,016 B，sha256 `c2fa6bfe…`（与 release asset 的 `digest` 一致）；版本规范化为 `0.17.1_rc20261028-r7`（`-rc` 形式被 apk 拒收） |
| `luci-app-quickstart` | 同上 + LuCI 包装 | 同上 | GPL-2.0-only | controller/view/i18n 取自 `kiddin9/op-packages@19a44706`（该仓 LICENSE 为 GPL-2.0），静态资源不 vendor |
| `luci-app-store` / `luci-lib-taskd` / `luci-lib-xterm` / `taskd` | `istoreos/istore` | `a97ace34…`（2026-09-25） | MIT（仓库 LICENSE） | `luci-app-store` 的 `PKG_VERSION=0.2.1-r1`；此前 registry 按 op-packages 记成 GPL-3.0-only 是错的 |
| `luci-app-partexp` | `sirpdboy/luci-app-partexp` | `ef79d6b8…` | Apache-2.0（`PKG_LICENSE`；文件头写 GPLv3） | 依赖 `kmod-loop`，故只声明 `kernelLines: ["6.12"]` |
| `luci-app-netspeedtest` | `sirpdboy/luci-app-netspeedtest` | — | — | **本轮不做**：`api.github.com` 返回 `Repository access blocked`，且 `homebox`/`ookla-speedtest` 是 `PKG_HASH:=skip` 的不可再分发二进制 |

**编译通道**：`istoreos/quickstart` 没有 OpenWrt 包定义（只有 Go 前端与 `web/`），所以 `extension` 通道新增了“本地配方”形态：
`recipe: "local:<name>"` → 编译仓 `.github/packages/<name>`，`repo`/`ref` 仍作为发布审计的来源（`publish.json` 的 `sourceRepo/sourceCommit/sourcePath`）。站点侧
`src/lib/sources/registry.ts` 与编译仓 `scripts/select-extension-packages.mjs` 用同一规则校验（本地配方名必须等于包名，`recipeHash = sha256(recipe)`）。

**构建**（编译仓 `main` `de10c5c`，run [44893395104](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44893395104)，feed lock `e918983c30d1df22ffe98b180bd25850711a6fe6`）：

| 包 | 版本 | 产物 |
| --- | --- | --- |
| quickstart | `0.17.1_rc20261028-r7` | 6,181,570 B；解包后 `/usr/sbin/quickstart` 13,811,233 B、`/etc/init.d/quickstart`、`/etc/config/quickstart`、`/etc/uci-defaults/09-quickstart`、`/www/luci-static/quickstart` 40 个文件（`app.js`/`index.js`/`vendor.js`/`style.css`/`i18n`/`device-icons`…） |
| luci-app-quickstart | `0.17.1_rc20261028-r7` | controller（`quickstart.lua`、`istore_backend.lua`）、view（`home.htm`、`main.htm`）、`50_luci-quickstart`；无 htdocs 副本 |
| luci-app-store | `0.2.1-r1` | |
| luci-lib-taskd | `1.0.26-r1` | |
| luci-lib-xterm | `4.18.0-r1` | |
| taskd | `1.0.3-r2` | |
| luci-app-partexp | `2.0.5-r20260318` | |

每个 leg 的两个新断言都通过：`Assert the apk version is legal`（`apk version -t <v> <v>` → `=`）与 `Verify built apk signature`（`apk verify` OK）；
manifest job 的 `bundle report: 15 bundles, 3 proxy, 7 nas/download/monitor, 0 failure(s), 6 skipped`。

**发布**（feed 仓 `main` `af7aba5`，staging run [44894387084](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/44894387084)）：7 个 apk 与 `packages.adb` 用项目 feed key 重签后逐个 `apk verify` OK，
`verify-feed: ok — 7 package versions in catalog, index and on disk`；冻结路径 `/staging/extension/25.12.2/x86_64/e918983c…`，
`extension-staging.json` 索引 sha256 `505027a2281b0318a45e9ec700f8ec8afdae5bc028ef5356b4a66286bdbc69d7`（1,964 B）。
live 发布未执行：包集从 6 个（supplement）变为 7 个（extension），ADR 0008 的 recipe/包集门禁本来就会把这类变更压成“待人工批准”，
批准后由同一 workflow 以 `publish_mode=live` 提升。

**本轮顺带修掉的三个流水线缺陷（都有提交与 run 记录）**

1. `include/scan.mk` 只把含 `call BuildPackage` 字样的 Makefile 计为包目录 —— 纯 `luci.mk` 配方会被静默忽略（`No rule to make target 'package/<name>/compile'`）；
   配方现在保留 marker 行，`stage-local-recipe.sh` 也据此提前失败。
2. `extension.yml` 派发 publish 时没传 `feed_kind`，feed 仓默认按 `supplement` 校验，扩展发布 100% 被 “not an packages workflow run” 拒掉；
   现由派发方显式传 `feed_kind=extension`，`publish.yml` 同时用 `github.event.action` 兜底（`event_type=extension-built`）。
3. `publish.yml` 的 deploy job 对 staging run 也断言“live 指针已服务且签名”，导致正确 staged 的 run 永远红；现在 `deploy` 只在 `publish_mode == live` 时运行。

**约束遵守**：没有把 `--allow-untrusted` 写进镜像或默认 repositories（`workflow-yaml` 测试继续钉死允许清单）；没有改动签名密钥流程；
所有下载都带 sha256（`PKG_HASH` 为 64-hex，`stage-local-recipe.sh` 拒绝 `skip`）；`luci-app-store` 的 `root/bin/is-opkg`
仍会用 `apk --allow-untrusted` 从 `istore.istoreos.com` 拉包 —— **只发布包、不改其运行时行为**，风险写在 §12 的 11.5.1 与 README 里待决策。

**已知遗留（不计入本轮验收）**

- 真实 rootfs 内 `apk add quickstart luci-app-quickstart luci-app-store …` 与 `apk del` 干净卸载未跑（需先 live 发布，或直接对 staging 目录做 feed-test）。
- `feed-test.yml` 的负例（篡改索引/未知密钥/篡改 apk）未重跑。
- supplement feed 的 live 索引仍含旧的 `luci-app-store`/`luci-lib-taskd`/`luci-lib-xterm`/`taskd`（版本 `luci-lib-taskd 1.0.26-r2`、`taskd 1.0.3-r1`）；
  下一次 supplement 发布（ALLOWED 已缩到 `luci-app-fwlive`/`luci-app-substore`）会移除它们。在那之前两个 feed 同名并存，apk 会取版本较高者（即旧 supplement 的 r2）。
- `luci-app-netspeedtest` 未做（上游仓库 blocked + 不可再分发二进制）。

## 最终 V2 回归清单

| 要求 | Run | 结果 |
| --- | --- | --- |
| V1 标准构建 | [44757195318](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44757195318)（build main `51d7102`） | ✅ |
| EFI ext4 | [43704700295](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704700295) | ✅ |
| Legacy squashfs | [43704714436](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704714436) | ✅ |
| VMDK | [43866425386](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43866425386) | ✅ |
| qcow2 | [43704727299](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704727299) | ✅ |
| rootfs tar（产品路径） | [44757850173](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44757850173) | ✅ |
| source kernel | [43853764898](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43853764898)（暖）/ [43711004777](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43711004777)（冷） | ✅ |
| Docker | [43866444618](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43866444618)（包集/可写性）/ [44309616413](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44309616413)（boot-equivalent overlay + `/var/lib/docker`） | ✅ 源码构建、包集、ext4 可写、overlay 文件、`/var/lib/docker` 可写与 `data_root` 均已验证（见 §8） |
| 队列交付 | [44758426869](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44758426869)（build `548c413f…` 排队 204.3 s 后由 reconciler 派发） | ✅ |

## 未验证 / 明确不在 V2.0 范围

截至 **2026-11-20 23:00（Asia/Shanghai）**，V2.0 Acceptance Matrix 12 行全部 ✅；下表列出“spec 不要求、受硬件/边界限制无法在 V2.0 内证明”的项，以及**已知缺陷待办**，均不计入验收。

| 项 | 原因 / 当前状态 |
| --- | --- |
| 真实 ARM（`mediatek/filogic`）构建与真实 eMMC 镜像 | registry 建模、UI 标注禁用原因；spec 明确随首个 ARM 目标，不计入 V2.0 |
| kernel 6.18 镜像 | 已 pin 到 `a4ba8240…`，属实验线，从未构建；spec 只要求"6.6、6.18 为实验线" |
| source engine 跑 6.12 默认线 | 6.12 默认由 ImageBuilder 承担（`43704700295`）；源码线只承诺"至少一条"（6.6 已真实产出） |
| 真正 QEMU/init 启动镜像并拉起 dockerd 跑容器 | 本机无 KVM；Docker 行用 boot-equivalent tmpfs + chroot 验证（run `44309616413`），未做完整开机与容器运行 |
| bundle 包在构建出的镜像内实装 | bundle 闭包可安装性已用真实 `apk add --simulate` 执行（`44753804235`，13/13，见 §7），但未在真实构建产物的 rootfs 内 `apk add` 落盘 |
| source watch 24h/48h 连续延迟观察 | 现有 run 均为按需/手动触发；调度器单测覆盖 6h 节奏，但没有连续 48h 线上观察 |
| IPv6/PPPoE/WiFi/switch-port 真机连通性 | 只验证生成与拒绝路径（单测 + e2e 409），无硬件启动测试 |
| public vs private 镜像内 repository 文件 diff | 生成逻辑由单测覆盖，未对比两条真实镜像内的文件差异 |
| 新组包在真实 rootfs 内实装（`apk add` / `apk del`） | 需要 live feed 或直接对 staging 目录跑 `feed-test.yml`；本轮只到 staging（见 §14） |
| `feed-test.yml` 负例（篡改索引/未知密钥/篡改 apk） | 本轮未重跑；该 workflow 自身逻辑未改动 |
| live 发布新组包 | 包集与 recipe 变化触发 ADR 0008 的人工批准门禁；staging 已就绪（`/staging/extension/25.12.2/x86_64/e918983c…`） |
| `luci-app-netspeedtest` | 上游 `sirpdboy/luci-app-netspeedtest` 被 GitHub 屏蔽（`Repository access blocked`）+ `homebox`/`ookla-speedtest` 为 `PKG_HASH:=skip` 的不可再分发二进制，按提示词 §3.3 兜底条款本轮不做 |
| **已修复（2026-11-21，ticket 13）：下载路由交付 ZIP 容器却按 `.tar.gz` 命名** | `GET /api/builds/<id>/artifact` 实际流式返回 zip 容器（12,598,254 B / `023fe721…`），却用 `Content-Disposition: …tar.gz` 与 `application/gzip` 标注；与构建记录的 `artifactSha256`/`artifactSize`（镜像内文件）不一致，用户拿到 zip 却按 `.tar.gz` 命名。**已按设计修复**：交付 ZIP 容器不变，标注改为容器真实值，补 `X-Image-*` 头部与页面解压提示（migration `150_artifact_container` 记录容器 sha256/size。单测/路由测试已覆盖；真实下载复测已于 2026-11-21 通过（compose 部署））；跟进票：`.scratch/v2-hardening/issues/13-artifact-container-labelling.md` |

## 本地可复现校验

在 `v2/ticket-09` 工作树（`/tmp/combinewrt-wt/v2-09`，基于 main `2a73087`）执行：

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

结果（2026-11-20 复核）：`npm test` **88 文件 / 812 用例通过**；`npm run typecheck` 干净；`npm run lint` 干净；`capabilities:validate` = 2 targets / 2 profiles / 21 variants / 3 kernel lines / 16 modes；`sources:validate` = 14 packages（official 7 / dllkids 1 / supplement 1 / extension 5）、13 bundles、2 themes；`kernel-lines:validate` = 3 lines（2 source / 1 imagebuilder）；限资源 `npm run build` exit 0（Next.js 16.4.6）；`npm run test:e2e:only` **11/11 passed（57.4s，2026-11-16 记录，本轮未重跑）**。

按 runbook 在临时端口启动（临时 DB、dummy secret/hash、`BUILD_ADAPTER=fake`）并请求 `/api/health`：`next start -p 3101`（`DATABASE_PATH=/tmp/t16-health.db`、dummy `SESSION_SECRET`/`ADMIN_PASSWORD_HASH`、`BUILD_ADAPTER=fake`）→ `✓ Ready in 131ms`，`curl -fsS http://127.0.0.1:3101/api/health` → `{"ok":true}`；进程随后关闭，临时 DB 已删除（未提交）。

新库从零迁移与旧库升级：

- `src/lib/db.test.ts` → "creates the database file and applies migrations"（空目录 → 全量迁移）
- `src/lib/db.test.ts` → "migrates a populated V1 database to the V2 domain schema without losing rows"（V1 行保留、V2 表/列新增）
- `src/lib/db.test.ts` → "is idempotent across restarts"（重复启动不重复执行）
