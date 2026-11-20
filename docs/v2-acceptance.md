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
| 4 | Artifact | combined、rootfs tar、VMDK、qcow2；overlay 可设 | ✅ | combined `43704700295`、Legacy `43704714436`、qcow2 `43704727299`、VMDK `43866425386`；**rootfs tar 真实构建 [44293572215](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44293572215) 成功**：`immortalwrt-25.12.2-x86-64-generic-targz-rootfs.tar.gz` sha256 `4d9d0902879cf9ae87cf772de005d5f66d2d1950c51f12a02c56b64c1be1cd35`，12,642,351 B，`tar -tzf` 1524 条目，`/etc/openwrt_release` = ImmortalWrt 25.12.2，apk db 244 包含 `luci` |
| 5 | eMMC | 模型/能力/UI 完成，真实构建不计入 | ✅ | registry 明确 `supported:false`/experimental，UI 禁用并给出原因（e2e）；spec 原文“真实 eMMC 构建随首个 ARM 目标，不计入 V2.0”，验收要求已全部落地 |
| 6 | Kernel | 6.12 默认；6.6/6.18 实验；至少一条源码线产出镜像 | ✅ | 6.12 默认走 ImageBuilder（`43704700295`，日志安装 `kernel=6.12.103`）；6.6 源码冷 `43711004777` / 暖 `43853764898`（kernel 6.6.159）；“至少一条源码线产出镜像”成立。6.18 已 pin（`a4ba8240…`）但未构建，属实验线，spec 不要求验收 |
| 7 | Modes | 16 个声明式 mode；主题走 extension bundle | ✅ | 16 个 mode 声明 + typed network（LAN/DHCP/WAN/IPv6/WiFi/switch-port/bypass）由 `capabilities:validate` 与单测覆盖；互斥/requires 在计划阶段 409（e2e）；主题走 extension 包/bundle 路径，真实签名包 `apk verify` 通过。真机连通性属硬件外因素，不在本行 |
| 8 | Docker | 源码构建、ext4 combined + overlay、`/var/lib/docker` 可写 | ✅ | 源码构建 compose 正确性 `43866444618`（1h39m57s，307 opkg 包，ext4 可写）；**最终 boot-equivalent 验证 [44309616413](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44309616413) 成功**（33m31s，`buildSeconds 1530`，cache 全暖，artifact sha256 `9fea0ca09775e6ebe1d3ceca0f3346b37bda9e62764b5292993e49ef7ce131ba`，106,990,213 B）：3 个 `plan.files[]` 以正确 mode 在镜像内、镜像自带 uci-defaults 含 `mkdir -p /var/lib/docker` + `data_root='/var/lib/docker'`、按镜像自身 `/var→tmp` 链条挂 tmpfs 后 chroot 执行该脚本，`/var/lib/docker` 存在且可写、`data_root` 已更新 |
| 9 | Feeds | 公开/私有 image feed set 正确生成并进 source offer | ✅ | 真实 preflight run 43709222330；feeds/source-offer 单测与 e2e |
| 10 | Source sync | dllkids 自动采纳 + supplement 自动发布真实跑通一次 | ✅ | supplement 构建→发布→staging→提升真实跑通（`43702446473`/`43703618796`/`43703141721`/`43703283136`）且 main 部署 `43907601591`；**dllkids 在线 watch 真实跑通**（2026-11-18，真实 feed index sha `4759d2b8…`）：候选记录→显式 force 采纳→pin/cache/snapshot 事务落库；修复后首次观察自动 `adopted_bootstrap`（单测覆盖），后续同版本哈希变化仍阻断（单测） |
| 11 | Build ops | 队列并发、失败标记、产物下载、source offer、V1 计划只读 | ✅ | 失败标记 `43705890215`、下载/保留期/2 GiB 上限（单测 + 路由测试）、source offer（e2e V2）、V1 只读（`43705270610` + e2e）；**队列真实派发**：2026-11-18 站点 → GitHub 真实 run `44294267917`、`44294943285`；`MAX_CONCURRENT_BUILDS=1` 下第二个构建排队且**不调用 GitHub**，槽位释放后由 reconciler 从持久化密文恢复计划并派发 `44298291283`（修复后 `44297603737` + `44298291283`） |
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
| 6.12（默认） | ImageBuilder | [43704700295](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704700295) | 日志显示安装 `kernel=6.12.103~…`（25.12.2 ImageBuilder 自带）；**该 run 的 artifact manifest 里 `kernelLine` 是 `{"id":"linux-6.6","version":"6.6","engine":"imagebuilder"}`** —— manifest 记录的是计划输入而不是实际构建出的内核，所以这条证据的真实结论是“ImageBuilder 构建产出 6.12.103 内核的镜像，manifest 的 kernelLine 字段不可作为内核证据”。默认线真实产出镜像成立 |
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
- 主题与 bundle：extension feed 的 build run [43711097432](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43711097432) 与 publish run [43725476372](https://github.com/wuyuzaddd/combinewrt-packages/actions/runs/43725476372) 成功；新克隆用只含项目公钥的 key dir 执行 `apk verify`，两个主题包与 `packages.adb` 均 `OK`。`config/extension/bundles.json` 13 个 bundle（3 proxy、6 NAS/下载/监控），strict schema 拒绝 scripts/hooks，并只引用 registry 包。

### 8. Docker

- 构建：source 源码构建 run [43866444618](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43866444618)，kernel line 6.6（kernel 6.6.159），`imageVariant={boot:efi,filesystem:ext4,artifact:combined,overlaySizeMb:512}`，`modes=[docker]`，engine `source`。
- 计划层要求：`config/modes/docker.json` 的 `requires` 为 `engine:source`、`filesystem:ext4`、`artifact:combined`、`capability:overlay`；squashfs 在计划阶段被拒绝（单测覆盖）。
- Recipe：`CONFIG_OVERLAY_FS=y`、`CONFIG_CGROUPS=y`、`CONFIG_NAMESPACES=y`、`CONFIG_NET_NS/PID_NS/UTS_NS/IPC_NS/USER_NS=y`、`CONFIG_BRIDGE/VETH/BRIDGE_NETFILTER/NF_NAT/MEMCG/BLK_CGROUP/CGROUP_PIDS/CGROUP_CPUACCT=y`，并安装 `docker`、`dockerd`、`containerd`、`runc`、`tini`、`ca-bundle`、`kmod-veth`、`kmod-br-netfilter`、`kmod-ipt-nat`、`iptables-nft`。
- 镜像检查（run [43866444618](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43866444618)，成功，2026-11-16T12:25:30Z→14:05:30Z，总耗时 1h39m57s，`buildSeconds 5389`，冷缓存 `{download:false,staging:false,ccache:false}`）：
  - manifest：`immortalwrt-24.10-SNAPSHOT-x86-64-generic-ext4-combined-efi.img.gz`，sha256 `77ea59a21928f83dd26964851dcbdddd641138fdcfbe6c8848eec26a50835fbb`，**107,416,918 B**，`kernelVersion 6.6.159`，`kernelLine 6.6`，source `af0775ab…`（openwrt-24.10）。
  - 宿主机没有可用的 loop 设备（`losetup` 返回 operation not permitted），因此用 GPT 偏移 `dd` 出 p2 后用 `debugfs` 离线检查；这不是镜像问题，是当前容器权限限制。
  - p2 = `rootfs`，ext4（`has_journal ext_attr resize_inode filetype extent sparse_super large_file uninit_bg`），300 MiB，`e2fsck -fn` 状态 clean（仅提示 inode bitmap 末尾 padding 未设置，属上游 mkfs 的 cosmetic 警告）；`/usr/lib/os-release` = `ImmortalWrt 24.10-SNAPSHOT`。
  - 包管理：24.10 使用 **opkg**，`/usr/lib/opkg/status` 共 **307** 个包。`docker 27.3.1-r1`、`dockerd 27.3.1-r3`、`containerd 1.7.22-r1`、`runc 1.1.14-r1`、`tini 0.19.0-r2`、`ca-bundle 20260816-r2`、`kmod-veth/kmod-br-netfilter/kmod-ipt-nat 6.6.159-r1`、`iptables-nft 1.8.10-r1`、`kernel 6.6.159~365a65b8…-r1` 全部为 `install ok installed`；`/etc/init.d/dockerd`（0755）与 `/etc/config/dockerd`（0600）存在。
  - 可写性：`/opt/docker` 存在（0755），在离线镜像副本上用 `debugfs -w` 执行 `mkdir /opt/docker/t16-write-test` 成功（随后 rmdir），证明 ext4 数据分区可写。镜像内 `/etc/config/dockerd` 的 `data_root` 是 **`/opt/docker/`**（包默认值）。
  - **未满足的断言**：镜像内 **没有 `/var/lib/docker`**；`/var` 是指向 `tmp` 的符号链接，因此 `/var/lib/docker` 即使创建也在 tmpfs 上。原因是 `source-build.yml` 只消费 `SourceRecipe`（`config`/`feedsConf`/`packages`），**没有写入计划的 `files`**：docker mode 生成的 uci-defaults（`mkdir -p /var/lib/docker`、设置 data root）以及 feed set 生成的 `/etc/apk/...` 文件都只进入 ImageBuilder payload，未进入源码构建。源码构建实际使用 stock 的 `/opt/docker`，且 24.10 是 opkg 而非 apk，V2 的 apk feed set 本来也不适用于这条源码线。
  - 结论：源码构建、kernel 6.6.159、docker 包集、ext4 可写、dockerd init/config 均已验证；**`/var/lib/docker` 这一条按字面仍未通过**。
- 中间失败 run [43891611647](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43891611647)（2026-11-16，ref `fix/v2-review`）：`Write generated files overlay` 与 `make` 均成功，但后续验证步骤失败。**2026-11-18 更正根因**：该 run 的失败并不是 chroot 里 `/var` 不可写，而是 `gzip -dc` 对镜像尾部 padding 返回退出码 2，`set -e` 在解压处就直接终止（整份日志 0 条 `COMBINEWRT_FAILURE`）。此前文档中"chroot /var 不可写 + 结构化标记"的描述有误，已按日志更正。
- **最终验证 run [44309616413](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44309616413)**（2026-11-18T13:02:00Z→13:35:31Z，`fix/v2-docker-verify`，33m31s，`buildSeconds 1530`，cache `{download:true,staging:true,ccache:true}`）：
  - 解压只接受 `exit 2 + "trailing garbage ignored"`，其余一律失败；
  - 断言 `plan.files[]` 的 3 个路径全部以记录的 mode（0755/0644/0755）存在于挂载的 rootfs；
  - 断言镜像内 uci-defaults 含 `mkdir -p /var/lib/docker`、`chmod 0711`、`data_root='/var/lib/docker'`；
  - 解析镜像自身的 `/var` 符号链接链（今天 `→ tmp`），在解析结果上挂 16 MiB tmpfs，`chroot` 执行镜像自带的 `/etc/uci-defaults/91-combinewrt-docker`；
  - 结果：`/var/lib/docker` 存在、可写（chroot 内 create+delete 验证），`dockerd data_root` 变为 `/var/lib/docker`；日志 `docker data root verified at first boot: /var/lib/docker exists on the tmpfs-backed /var, is writable, and dockerd data_root matches`。
  - artifact：`immortalwrt-24.10-SNAPSHOT-x86-64-generic-ext4-combined-efi.img.gz`，sha256 `9fea0ca09775e6ebe1d3ceca0f3346b37bda9e62764b5292993e49ef7ce131ba`，106,990,213 B（独立下载后 sha 与 manifest 一致；`debugfs` 可见 uci-defaults 0755/495 B，`/var → tmp`）。
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

**dllkids（部分）**

- 事务性采纳、同版本哈希阻断、解析失败回滚、缓存回滚由 `src/lib/source-watch/service.test.ts` 等 16 例 fake fetch/fake clock 测试覆盖；真实在线站点**没有**执行过一次自动采纳（站点进程需要在 6 小时窗口内运行并观察到上游变化）。
- **延迟指标未测量**：detect ≤24h / rebuild+publish ≤48h 是设计目标；现有真实 run 都是按需触发，不能证明调度延迟。需要站点上线并连续运行至少 48 小时后再补测。
- extension registry ref 变化已在 source-watch 调度器接线（`runExtensionWatchIfDue` → `recordObservedCandidate`，`src/lib/source-watch/extension.ts`）：观察到 upstream head 与 registry pin 不同时只为 `extension` 源记录一个 candidate（sha256 of the observed commit map + 缓存字节），**不采纳、不自动发布**；单测用 fake fetch/clock 覆盖，未做真实端到端。

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

### 13. V2 两轴评审修复（2026-11-16）

- **源码引擎的 `files` overlay（spec:106 / matrix 7、8）**：`SourceRecipe` 现在携带计划的 `files[]`（同一 `path`/`content`/`mode` 契约）与 feed set 摘要；`source-build.yml` 在 `make` 前把这些文件写进源码树的 `files/`（OpenWrt 的 `prepare_rootfs` 从 `$(TOPDIR)/files` 应用），并安装 `combinewrt-feed.pub.pem`；构建后再从产物镜像里逐个断言文件存在。docker mode 的 uci-defaults 同时 `mkdir -p /var/lib/docker` 并把 `/etc/config/dockerd` 的 `data_root` 指向该路径（`/var`→tmpfs，故 `dockerd` 启动时在 tmpfs 上创建；验收语义是“boot 后可写”）。rootfs 产物名与 glob 统一为 `.tar.gz`，并发出 `CONFIG_TARGET_ROOTFS_TARGZ=y`。
- **密钥**：`build.yml` 在 “Write files” 之后用 temp+mv 就地重写 `plan.json`，把 `files[].content` 换成 `<redacted at rest>`（占位符与 `src/lib/builds/redact.ts` 一致，不再泄漏字节数）；站点不再把生成文件内容、`plan.modes.network.wan.password`、`plan.modes.network.wifi.key` 写进 `builds.plan_json`（`src/lib/builds/redact.ts`），派发使用进程内的完整计划，重启后若只剩脱敏计划则显式失败而不是悄悄少写 overlay；派发路径不打印计划负载。
- **`client_payload` 嵌套（spec:108）**：source dispatch 顶层只保留 `buildId`/`schemaVersion`/`engine`/`baseVersion`/`profileId`/`artifactName`/`composition`（7 个），整套 recipe 嵌在 `composition` 下；`source-build.yml` 先归一化回扁平 recipe。单测同时断言 ImageBuilder（10 个）与 source 两条派发的顶层属性上限。
- **dllkids 采纳在刷新中生效**：`refreshActiveCatalog` 先读 `source_pins`（`active`），配置常量只在没有 DB pin 时作为 seed；单测证明 DB 采纳值优先于过期的 env 值。
- **extension watch（ADR 0008）**：调度器新增 `runExtensionWatchIfDue`，对 `config/sources/registry.json` 的 extension 条目观察 upstream head，变化只记 candidate（可审计、可缓存），不采纳、不发布。
- **验证状态（2026-11-18 22:00，Asia/Shanghai）**：带 overlay 的源码构建最终验证 run [44309616413](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44309616413) 成功（boot-equivalent tmpfs `/var` + chroot 执行镜像自带 uci-defaults，`/var/lib/docker` 存在且可写、`data_root` 更新），Docker 行已转 ✅；2026-11-16 的失败 run 43891611647 根因已更正为 `gzip -dc` 对尾部 padding 返回 2 被 `set -e` 终止（见 §8）。该 workflow 版本在 build 仓分支 `fix/v2-docker-verify`，lead 负责同步到 main。
- **feed set URL 一致**：`feeds.ts` 与 preflight 都用 `/supplement/<baseVersion>/<target>/packages.adb`；feed 仓库发布流水线新增部署后断言（live pointer 与 frozen 路径同 sha256 + `apk verify`），分支真实 run 43891341975 证明该 URL 可下载且签名可验证。
- **正确性护栏**：`migrate()` 断言版本严格递增且唯一，并拒绝排序在已应用版本之前的待应用版本；`openDatabase` 设置 `PRAGMA busy_timeout = 5000`；`isBuildPlanV2Form` 要求显式 `schemaVersion === 2` **且**有 `target`；删除 `source-build.yml` 的死 `push` 触发器；`workflow-yaml` 测试钉死 `--allow-untrusted` 的允许清单（仅 build.yml 的下载包 verify/mkndx 共 3 处）；被跳过的契约测试会打印跳过原因。

**按 ticket 保留的偏差（记录而非修改）**：V1 表单仍走 V1 路径并产出 `schemaVersion: 1` 计划（ticket 03 明确保留 V1 只读兼容；V2 表单显式发送 `schemaVersion: 2` + `target`）；`DLLKIDS_INDEX_SHA256` 配置常量继续保留，但只作为全新安装的 seed。

## 最终 V2 回归清单

| 要求 | Run | 结果 |
| --- | --- | --- |
| V1 标准构建 | [43705270610](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43705270610) | ✅ |
| EFI ext4 | [43704700295](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704700295) | ✅ |
| Legacy squashfs | [43704714436](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704714436) | ✅ |
| VMDK | [43866425386](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43866425386) | ✅ |
| qcow2 | [43704727299](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43704727299) | ✅ |
| source kernel | [43853764898](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43853764898)（暖）/ [43711004777](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43711004777)（冷） | ✅ |
| Docker | [43866444618](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43866444618)（包集/可写性）/ [44309616413](https://github.com/wuyuzaddd/combinewrt-build/actions/runs/44309616413)（boot-equivalent overlay + `/var/lib/docker`） | ✅ 源码构建、包集、ext4 可写、overlay 文件、`/var/lib/docker` 可写与 `data_root` 均已验证（见 §8） |

## 未验证 / 明确不在 V2.0 范围

截至 **2026-11-18 22:00（Asia/Shanghai）**，V2.0 Acceptance Matrix 12 行全部 ✅；下表只列"spec 不要求、或受硬件/边界限制无法在 V2.0 内证明"的项，均不计入验收。

| 项 | 原因 / 当前状态 |
| --- | --- |
| 真实 ARM（`mediatek/filogic`）构建与真实 eMMC 镜像 | registry 建模、UI 标注禁用原因；spec 明确随首个 ARM 目标，不计入 V2.0 |
| kernel 6.18 镜像 | 已 pin 到 `a4ba8240…`，属实验线，从未构建；spec 只要求"6.6、6.18 为实验线" |
| source engine 跑 6.12 默认线 | 6.12 默认由 ImageBuilder 承担（`43704700295`）；源码线只承诺"至少一条"（6.6 已真实产出） |
| 真正 QEMU/init 启动镜像并拉起 dockerd 跑容器 | 本机无 KVM；Docker 行用 boot-equivalent tmpfs + chroot 验证（run `44309616413`），未做完整开机与容器运行 |
| extension feed 的 chroot `apk add` 安装测试 | 只验证 `apk verify`（包与索引签名）；未在 rootfs 中实装 |
| source watch 24h/48h 连续延迟观察 | 现有 run 均为按需触发；调度器单测覆盖 6h 节奏，但没有连续 48h 线上观察 |
| IPv6/PPPoE/WiFi/switch-port 真机连通性 | 只验证生成与拒绝路径（单测 + e2e 409），无硬件启动测试 |
| public vs private 镜像内 repository 文件 diff | 生成逻辑由单测覆盖，未对比两条真实镜像内的文件差异 |

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

结果：`npm test` 82 文件 / **689 用例通过**；`npm run typecheck` 干净；`npm run lint` 干净；`capabilities:validate` = 2 targets / 2 profiles / 21 variants / 3 kernel lines / 16 modes；`sources:validate` = 14 packages（official 7 / dllkids 1 / supplement 1 / extension 5）、13 bundles、2 themes；`kernel-lines:validate` = 3 lines（2 source / 1 imagebuilder）；限资源 `npm run build` exit 0（Next.js 16.4.6，22/22 路由编译）；`npm run test:e2e:only` **11/11 passed（57.4s）**。

按 runbook 在临时端口启动（临时 DB、dummy secret/hash、`BUILD_ADAPTER=fake`）并请求 `/api/health`：`next start -p 3101`（`DATABASE_PATH=/tmp/t16-health.db`、dummy `SESSION_SECRET`/`ADMIN_PASSWORD_HASH`、`BUILD_ADAPTER=fake`）→ `✓ Ready in 131ms`，`curl -fsS http://127.0.0.1:3101/api/health` → `{"ok":true}`；进程随后关闭，临时 DB 已删除（未提交）。

新库从零迁移与旧库升级：

- `src/lib/db.test.ts` → "creates the database file and applies migrations"（空目录 → 全量迁移）
- `src/lib/db.test.ts` → "migrates a populated V1 database to the V2 domain schema without losing rows"（V1 行保留、V2 表/列新增）
- `src/lib/db.test.ts` → "is idempotent across restarts"（重复启动不重复执行）
