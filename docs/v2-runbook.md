# combinewrt V2 运行手册

面向单管理员部署（一个 Node 进程 + 一个 SQLite 文件 + GitHub Actions 构建农场）。所有命令默认：

- 代码目录 `/opt/combinewrt`
- 数据目录 `/var/lib/combinewrt`
- 服务名 `combinewrt`
- 站点本机 `http://127.0.0.1:3000`

先确认健康检查：

```bash
curl -fsS http://127.0.0.1:3000/api/health
# {"ok":true}
```

失败时按顺序看：`journalctl -u combinewrt -n 200 --no-pager` → `deploy/README.md` 的启动失败章节 → 数据库/环境变量。

## 1. 构建失败与回滚

### 1.1 判断失败类型

构建详情页会显示 `COMBINEWRT_FAILURE` 解析出的步骤、包名、来源与原因。步骤含义：

| step | 含义 | 常见原因 |
| --- | --- | --- |
| `prepare-plan` | payload/变体校验 | 旧 payload、非法 artifact、target 不安全 |
| `download-imagebuilder` | 下载 ImageBuilder | 上游 404、版本号写错、镜像不可达 |
| `download-packages` | 下载 pinned 第三方包 | dllkids/supplement pin 漂移、URL 失效 |
| `preflight` | 安装性模拟 | 包名不存在、依赖/ABI 冲突、feed key 指纹不匹配 |
| `build-image` | ImageBuilder make | 包与内核不匹配、磁盘/时间上限 |
| `assert-packages` | 挂载镜像查 apk db | 包没真正进入镜像 |
| `postprocess` | qcow2/VMDK 转换 | `qemu-img` 失败、超过 2 GiB 上限 |
| `package-artifact` | 产物/manifest | 预期文件名没出现 |
| `dispatch` / `timeout` / `workflow` | 站点侧 | PAT、GitHub API、工作流超时 |

### 1.2 重试

- 计划/输入错误（`prepare-plan`、`preflight` 的包名冲突）：修正计划后重新提交，不要重跑同一条 run。
- 上游临时错误（下载、runner 抖动）：在构建详情页点重试，或重新提交同一个计划；队列会重新派发。
- 同一 build id 的重复派发由工作流 `concurrency.group` 串行化，不会并行跑两份。

### 1.3 回滚一次失败的发布

构建失败不会自动改变基线或 live feed。若失败发生在“已发布 live 索引”之后（少见）：

```bash
# 1) 暂停自动发布，避免继续推进
sudo systemctl stop combinewrt
# 2) 从备份恢复数据库（pin、发布审计、构建记录）
sudo cp /var/backups/combinewrt/combinewrt-YYYYMMDDTHHMMSSZ.db /var/lib/combinewrt/combinewrt.db
sudo chown combinewrt:combinewrt /var/lib/combinewrt/combinewrt.db
sudo chmod 0600 /var/lib/combinewrt/combinewrt.db
# 3) 启动并确认健康
sudo systemctl start combinewrt
curl -fsS http://127.0.0.1:3000/api/health
```

feed 仓的 `gh-pages` 历史是审计记录：不要 force-push 覆盖已发布的冻结目录；需要撤回时发布一个指向旧索引的 live 运行，或在站点侧把 `SUPPLEMENT_INDEX_SHA256` / `EXTENSION_INDEX_SHA256` 恢复到旧值并刷新目录。镜像内已安装的包不受站点回滚影响。

### 1.4 升级/部署回滚

站点升级失败时：`git -C /opt/combinewrt log --oneline -3` 找到上一个可用 commit，`git checkout <sha>`，
`npm ci && npm run build`，重启服务；数据库迁移是只追加的，旧代码可以打开新库（多出的表/列被忽略），
但不要在新代码已写入 V2 pin 后长期回退到不认识这些表的极旧版本。

## 2. dllkids 同版本哈希异常

**症状**：source watch 面板出现候选（candidate），状态 `blocked_same_version_hash`；目录未自动切换；
`source_pin_events` 有对应记录；catalog 仍是旧 pin。

**含义**：上游在**同一版本号**下替换了包字节。ADR 0008 规定这必须阻断自动采纳，因为无法用版本号判断
这是修复还是供应链替换。

处理步骤：

1. 打开 `/admin` 的 Source watch 面板，记录当前 active pin、候选 pin、diff 与错误。
2. 拉取候选索引并核对：
   ```bash
   # 以面板显示的候选 URL 为准
   curl -fsSL '<candidate packages.adb URL>' -o /tmp/candidate.adb
   sha256sum /tmp/candidate.adb
   # 与 source_pins.candidate 的 cache_sha256 比较
   sudo sqlite3 /var/lib/combinewrt/combinewrt.db \
     "select source,status,pin,cache_sha256,updated_at from source_pins order by source,status;"
   ```
3. 人工审查变的是哪些包、上游是否发布了同版本重建公告、license/ABI 是否仍匹配。不要只看版本号。
4. 只有在确认安全后，才在面板点“强制采纳”（或 `POST /api/admin/source-watch` 的 force 路径）。
   强制采纳会记录事件；之后刷新目录。
5. 如果无法确认：保持阻断，等上游 bump 版本；或把 `DLLKIDS_INDEX_SHA256` 固定在已知安全值，
   关闭 `SUPPLEMENT_WATCH_ENABLED` 不会影响 dllkids 目录刷新，但会停止 supplement 自动构建。
6. 回滚：面板“回滚”恢复上一 active pin 与快照；缓存不足时用 `SOURCE_CACHE_DIR` 中的基线重新采纳。

注意：dllkids 无签名。自动采纳的残余风险见 ADR 0008；不要把“强制采纳”当成常规操作。

## 3. supplement staging 发布

**何时进入 staging**：上游源码 commit 变化但元数据（包集、版本、license、`publicAllowed`、recipe）变化，
或依赖/测试失败；或发布闸门判定不能直接 live。站点会显示 `publish_pending` / staging 审计。

1. 查看 staging 审计：
   ```bash
   curl -fsSL https://wuyuzaddd.github.io/combinewrt-packages/staging.json | jq .
   ```
   记录 `buildRunId`、冻结路径 `/staging/<base>/<target>/<commit>/`、`index.sha256`、包列表。
2. 在 feed 仓下载 staging 产物，用只含项目公钥的 key dir 验证：
   ```bash
   git clone --depth 1 ssh://git@ssh.github.com:443/wuyuzaddd/combinewrt-packages.git /tmp/feed-check
   cd /tmp/feed-check
   mkdir -p /tmp/feed-keys && cp keys/combinewrt-feed.pub.pem /tmp/feed-keys/
   APK=/path/to/apk
   $APK verify --keys-dir /tmp/feed-keys staging/<base>/<target>/<commit>/packages.adb
   for f in staging/<base>/<target>/<commit>/*.apk; do $APK verify --keys-dir /tmp/feed-keys "$f"; done
   ```
3. 检查包集/版本/依赖与 source offer 是否一致；必要时在临时 chroot/rootfs 里 `apk add` 这些包。
4. 通过后提升：用同一个 `build_run_id`、`feed_kind=supplement`、`publish_mode=live` 重新跑 `publish.yml`。
   审计会记录 `promoted_from_staging=true`，live 指针与版本冻结路径一起更新；提升会重新生成并签名，
   不复制 staging 字节。
5. 更新站点的 `SUPPLEMENT_INDEX_SHA256`，刷新目录，确认 source offer 里的 pin 已更新。
6. 失败/回退：live 索引不动；把站点 pin 保持旧值即可。不要删除 staging 冻结目录——它是审计历史。
   历史 `/staging/25.12.2/x86_64/19a44706…/` 中仍有修复前未签名的包（冻结历史），不要把它当作可安装源。

## 4. 队列拥堵

**症状**：构建详情显示“排队中 / 第 N 位”；`builds` 中多行 `status='queued'`；没有新的 GitHub run。

1. 查看队列：
   ```bash
   sudo sqlite3 /var/lib/combinewrt/combinewrt.db \
     "select id,status,engine,target,created_at,dispatched_at from builds order by created_at limit 20;"
   ```
2. 确认并发上限：`MAX_CONCURRENT_BUILDS`（默认 2）。运行中的构建会占用槽位；源码构建可能跑 1 小时，
   不要因为“看起来卡住”就反复提交。
3. 取消不需要的排队构建（详情页取消）：排队中的取消是原地完成，不调用 GitHub；运行中的取消会调用
   GitHub cancel 并释放槽位。
4. 需要临时提高并发时，修改 `/etc/combinewrt.env` 的 `MAX_CONCURRENT_BUILDS`（1–16），
   `systemctl restart combinewrt`。注意 GitHub 账户的并发与 runner 限额；不要超过 4–6 除非确认配额。
5. 队列卡住且没有 running：检查 `dispatched_at`、失败信息与服务日志；dispatch 失败会记录
   `step=dispatch` 并释放槽位。重启进程后 reconciler 会 sweep 队列并 poll 运行中的 run，不会重复派发。
6. 不要直接改数据库里的 `status` 来“放行”；用站点取消/重试，保留 `build_events` 时间线。

## 5. artifact 缓存清理

**自动**：每天按 `ARTIFACT_RETENTION_DAYS`（默认 7）删除过期文件，再按最旧 mtime 驱逐到
`ARTIFACT_CACHE_MAX_BYTES`（默认 20 GiB）以下；只删缓存文件，不删构建记录、manifest 或 source offer。

**手动**（先确认路径）：

```bash
# 查看当前缓存与索引
sudo sqlite3 /var/lib/combinewrt/combinewrt.db \
  "select count(*), sum(size_bytes) from artifact_cache_entries;"
du -sh /var/lib/combinewrt/artifacts/* 2>/dev/null | sort -h | tail

# 删除某个构建的缓存（文件 + 索引行）；保留构建历史
BUILD_ID='<build id>'
sudo rm -rf "/var/lib/combinewrt/artifacts/$BUILD_ID"
sudo sqlite3 /var/lib/combinewrt/combinewrt.db \
  "delete from artifact_cache_entries where build_id='$BUILD_ID';"
```

删除后下一次下载会回源 GitHub artifact；若 GitHub 也已过期，下载返回 409/502（可读错误），不是 500。
不要用 `rm -rf artifacts/*` 后保留索引行——reconciler 会在下一轮丢弃失效行，但短时间内页面数字会不一致。
大文件（VMDK/qcow2）超过 2 GiB 会在构建阶段失败，而不是进入缓存；不要手工把超大文件塞进缓存目录。

## 6. 其它常见故障

### 6.1 启动失败

`journalctl -u combinewrt -n 200 --no-pager` 中找 `[combinewrt] startup failed:`。常见：
`SESSION_SECRET` 不足 32 字符、`ADMIN_PASSWORD_HASH` 格式错、`APP_ORIGIN` 非法、
`BUILD_ADAPTER=github` 缺 `BUILD_REPO`/`BUILD_REPO_TOKEN`、`MAX_CONCURRENT_BUILDS` 越界。
配置错误会一次性列出全部问题，不会带病启动。

### 6.2 健康检查 503

`/api/health` 会执行 `loadConfig()` 与 `SELECT 1`。503 时先看日志；如果数据库被锁/损坏：
停机 → 用 `.backup` 恢复 → 启动 → 再查健康。WAL 模式下不要只拷主数据库文件。

### 6.3 feed key 指纹不匹配

preflight 报 `project feed key sha256 does not match the pinned fingerprint`。说明
`SUPPLEMENT_KEY_FINGERPRINT` 与 `SUPPLEMENT_KEY_URL` 的字节不一致。确认 key URL 指向项目公钥
（sha256 `f7128667…`），不要为了“让构建通过”而清空 fingerprint；更新 fingerprint 必须来自可信渠道。

### 6.4 V1 页面升级后异常

V1 计划/构建应只读可打开。若页面报错，先确认迁移是否完成（`app_meta`/`builds` 可查），
再用 `curl -fsS /api/health` 与 `journalctl` 定位；不要删除 V1 行来“修复”页面。

### 6.5 systemd 只读错误

`ProtectSystem=strict` 下新增数据目录必须加入 `ReadWritePaths`。症状是迁移/缓存/source watch 报
`EROFS` 或 permission denied；修改 unit 后 `systemctl daemon-reload && systemctl restart combinewrt`。

### 6.6 手工派发 V2 payload 的契约

用 `workflow_dispatch` 手工冒烟时（正式路径始终是站点的 `repository_dispatch`），payload 必须满足：

- `imageType` 是 V1 枚举 `ext4-efi` / `squashfs-efi` / `rootfs-tar`，不是 `combined`。
- `composition.topLevelPackages` 必须存在；只给顶层 `packages` 会被 `Assert top-level packages` 拒绝。
- `artifactName` 必须与 ImageBuilder 实际产出的文件名一致（例如
  `immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz`），不要自造 `combinewrt-*` 名字。
- `files` 必须存在（空数组 `[]` 可以）。
- V2 变体还必须带 `composition.v2`，其中 `schemaVersion: 2` 与 `target.id` 缺一不可；否则
  Prepare plan 会快速失败。
- 至少要有一个真实包（例如 `luci`）；“无包冒烟”按设计不会通过。

这些约束是工作流 `Prepare plan` / `Assert top-level packages` 的真实行为，2026-11-16 的同步冒烟
（run `43868727061`）在 main 上逐步骤通过，可作为对照。
