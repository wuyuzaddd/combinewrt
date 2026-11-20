# combinewrt 生产部署

目标：一台 LAN 主机，一个 Node 进程，一个 SQLite 文件，一个反向代理。V2 仍然只有一个进程；ImageBuilder 与源码构建都派发到 GitHub Actions，不在本站执行。

## 前提

- Node.js 24（`node -v`）
- `sqlite3` CLI（备份/恢复）
- `apk` 3（`APK_BIN`，读取 feed 索引、source watch 与安装性 preflight）
- 一个非 root 的系统用户 `combinewrt`
- 代码目录 `/opt/combinewrt`，数据目录 `/var/lib/combinewrt`
- 一个公开的构建仓库 `combinewrt-build` 与 feed 仓库 `combinewrt-packages`（见下文）

## 首次安装

```bash
sudo useradd --system --home /opt/combinewrt --shell /usr/sbin/nologin combinewrt
sudo loginctl enable-linger combinewrt
sudo mkdir -p /opt/combinewrt /var/lib/combinewrt \
  /var/lib/combinewrt/artifacts /var/lib/combinewrt/source-cache
sudo chown -R combinewrt:combinewrt /opt/combinewrt /var/lib/combinewrt

# 如果部署主机在构建时出现过热（开发机曾遇到），可选用下面的限流包装；
# CPU/内存上限是建议，不是运行要求。
# sudo -u combinewrt systemd-run --user --scope -p CPUQuota=600% -p MemoryMax=6G -p RuntimeMaxSec=1800 -- \
#   bash -c "cd /opt/combinewrt && NODE_OPTIONS='--max-old-space-size=6144' npm run build"

# 以部署用户检出代码
sudo -u combinewrt git clone https://github.com/wuyuzaddd/combinewrt.git /opt/combinewrt
cd /opt/combinewrt
sudo -u combinewrt npm ci
sudo -u combinewrt npm run build

# 环境文件，权限 0600
sudo install -m 0600 deploy/combinewrt.env.example /etc/combinewrt.env
sudo editor /etc/combinewrt.env
```

`/etc/combinewrt.env` 至少填写：

- `SESSION_SECRET`：`openssl rand -base64 48`
- `ADMIN_PASSWORD_HASH`：`npm run hash-password -- 'your-admin-password'`
- `APP_ORIGIN`：浏览器实际访问的 origin，例如 `https://firmware.example.lan`
- `DATABASE_PATH`、`ARTIFACT_CACHE_DIR`、`SOURCE_CACHE_DIR`
- `APK_BIN`
- `BUILD_REPO_TOKEN`（`BUILD_ADAPTER=github` 时）

V2 新增/关键变量（完整列表见 `deploy/combinewrt.env.example` 与 `README.md` 的环境变量表）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MAX_CONCURRENT_BUILDS` | 2 | 同时派发/运行的构建数；其余在 SQLite 排队，不调用 GitHub |
| `SOURCE_BUILD_WORKFLOW` | `source-build.yml` | 源码构建工作流文件名；计划 `engine: "source"` 时使用 |
| `SOURCE_WATCH_INTERVAL_HOURS` | 6 | dllkids/supplement/extension 源检查间隔（1–168） |
| `SOURCE_CACHE_DIR` | `<db dir>/source-cache` | 源索引缓存，用于基线 diff 与离线回滚 |
| `ARTIFACT_RETENTION_DAYS` | 7 | 站点产物缓存保留天数（0 关闭） |
| `ARTIFACT_CACHE_MAX_BYTES` | 20 GiB | 站点产物缓存总大小上限（0 不限制） |
| `SUPPLEMENT_INDEX_SHA256` / `EXTENSION_INDEX_SHA256` | 空 | 两个签名索引的 pin；发布新索引后按需更新 |
| `SUPPLEMENT_WATCH_ENABLED` | true | 关闭 supplement 自动构建/发布 |
| `IMMORTALWRT_MIRROR` | 空 | 可选官方镜像；不改变版本冻结的 supplement/extension 路径 |

“源码构建开关”不是一个独立布尔值：是否走源码构建由计划里的 `engine` 与内核线决定（6.6/6.18 必须 source，Docker 等内核配置 mode 必须 source），`SOURCE_BUILD_WORKFLOW` 只决定派发到哪个工作流文件。这样 V1 计划与 ImageBuilder 计划不会被一个全局开关误切换。

不要把环境文件、数据库、签名私钥或构建产物提交到仓库。

```bash
sudo install -m 0644 deploy/combinewrt.service /etc/systemd/system/combinewrt.service
sudo systemctl daemon-reload
sudo systemctl enable --now combinewrt
sudo systemctl status combinewrt
curl -fsS http://127.0.0.1:3000/api/health
# {"ok":true}
```

反向代理示例见 `deploy/nginx-combinewrt.conf.example`。保留 `Host` 与
`X-Forwarded-Proto`；下载端点使用流式响应，示例中关闭了 `proxy_buffering`，
并放宽了读取/发送超时，避免 2 GiB 上限内的 qcow2/VMDK 下载被代理提前断开。

## systemd 与文件权限

- `deploy/combinewrt.service` 使用 `ProtectSystem=strict`，只把 `/var/lib/combinewrt` 与
  `/opt/combinewrt/.next/cache` 放进 `ReadWritePaths`。如果改了 `DATABASE_PATH`、
  `ARTIFACT_CACHE_DIR` 或 `SOURCE_CACHE_DIR`，必须把对应目录也加入 `ReadWritePaths`，
  否则迁移、缓存或 source watch 会以只读错误失败。
- `PrivateTmp=true` 不影响持久数据；临时构建/解压都在 GitHub runner 上完成。
- 进程只需要出站 HTTPS（GitHub API、feed 站点）与本地 SQLite；不需要入站 3000 以外的端口。
- `Restart=on-failure` 与 `KillSignal=SIGINT` 让迁移失败或未捕获异常时干净退出并由 systemd 重启；
  迁移失败不会带病启动。

## 日志与启动失败

```bash
journalctl -u combinewrt -n 200 --no-pager
journalctl -u combinewrt -f
```

启动阶段的配置或数据库错误会以
`[combinewrt] startup failed: ...` 写入服务日志，进程退出并由 systemd 重启。
健康检查 `/api/health` 会实际执行 `loadConfig()` 与 `SELECT 1`，失败返回 503。

## 升级

```bash
sudo systemctl stop combinewrt
sudo -u combinewrt /usr/local/sbin/combinewrt-backup /var/backups/combinewrt
cd /opt/combinewrt
sudo -u combinewrt git pull --ff-only
sudo -u combinewrt npm ci
sudo -u combinewrt npm run build
sudo systemctl start combinewrt
curl -fsS http://127.0.0.1:3000/api/health
```

数据库迁移在进程启动时自动执行；迁移只追加、不重命名，V1 行保持可读。迁移失败时进程不会带病启动。
V2 迁移新增的表：`source_pins`、`source_pin_events`、`source_watch_state`、
`supplement_publishes`、`supplement_publish_events`、`artifact_cache_entries`，并给 `builds`
追加可空的 `engine`、`target`、`dispatched_at` 列与 `builds_queue(status, created_at)` 索引。
旧库升级后仍能打开 V1 构建与计划页面。

## 备份与恢复

在线备份（应用可以继续运行）：

```bash
sudo install -m 0755 deploy/backup-db.sh /usr/local/sbin/combinewrt-backup
sudo DATABASE_PATH=/var/lib/combinewrt/combinewrt.db \
  /usr/local/sbin/combinewrt-backup /var/backups/combinewrt
```

`.backup` 生成一致性快照，包含 V1 与 V2 的全部表（上面列出的新表也在同一个 SQLite 文件里，
不需要单独备份）。建议每天 cron，并定期把备份复制到另一台主机。`source-cache/` 与
`artifacts/` 是可重建缓存：前者可由 source watch 重新抓取，后者在 GitHub artifact 保留期内可重新下载，
不必与数据库同等对待；但删除它们会丢失离线回滚基线和已缓存产物。

恢复：

```bash
sudo systemctl stop combinewrt
sudo cp /var/backups/combinewrt/combinewrt-YYYYMMDDTHHMMSSZ.db \
  /var/lib/combinewrt/combinewrt.db
sudo chown combinewrt:combinewrt /var/lib/combinewrt/combinewrt.db
sudo chmod 0600 /var/lib/combinewrt/combinewrt.db
sudo systemctl start combinewrt
curl -fsS http://127.0.0.1:3000/api/health
```

恢复后登录管理页确认当前基线版本、目录快照、source pin 与 artifact 缓存面板；旧快照仍保留在数据库中。
如果恢复的是较旧备份，`/api/admin/source-watch` 的“立即检查”会重新观察上游，但不会自动采纳同版本哈希变化。

## Feed 仓库：staging 与 live 发布

supplement 与 extension 的索引/签名/发布在 `wuyuzaddd/combinewrt-packages`：

- **live**：`publish_mode=live` 把新索引写到版本冻结路径（`/supplement/<base>/<target>/`、
  `/extension/<base>/<target>/`）并推进 live 指针；这两个版本冻结路径是规范路径，新部署的 `SUPPLEMENT_FEED_URL` 只指向它。站点根下扁平的 `/x86_64/` 是 supplement 索引的 V1 兼容镜像，只为旧镜像与旧部署保留、保持可下载，永远不作为新部署默认。
- **staging**：`publish_mode=staging` 只写 `/staging/<base>/<target>/<commit>/` 与 `staging.json`，
  live 索引与 `publish.json` 不动。元数据变化或依赖测试失败时站点只允许 staging。
- **提升**：确认 staging 内容后，用同一 `build_run_id` 再跑一次 `publish_mode=live`，审计会记录
  `promoted_from_staging=true`；提升会重新生成并签名，不复制 staging 的旧字节。
- **站点侧**：`SUPPLEMENT_PUBLISH_AUDIT_URL` / `SUPPLEMENT_STAGING_AUDIT_URL` 读取审计，
  `SUPPLEMENT_INDEX_SHA256` / `EXTENSION_INDEX_SHA256` 是索引 pin。发布后更新 pin 并刷新目录。
- **Pages 部署限制**：`deploy` job 通常只允许默认分支；非 main 的 publish run 可以完成
  签名、verify、audit 与 gh-pages 提交，但部署会被环境规则拒绝。正式上线必须在 main 上运行。
- **签名链**：supplement 和 extension 的包与索引都由项目 feed key（EC P-256，指纹
  `f7128667…`）签名；镜像只安装 `/etc/apk/keys/combinewrt-feed.pub.pem`。历史 staging 目录里
  修复前的未签名包保持冻结，不作为可安装来源。

构建仓库 `combinewrt-build` 的 main 必须与站点 `build-workflow/` 逐字节一致；升级站点后先同步
`build.yml`、`source-build.yml`、`packages.yml`、`extension.yml` 与 `.github/scripts/*`，再重启站点。

## 保留策略

- `ARTIFACT_RETENTION_DAYS`（默认 7，0 关闭）控制下载产物的本地缓存清理。
- `ARTIFACT_CACHE_MAX_BYTES`（默认 20 GiB，0 不限制）在按天清理后再按最旧 mtime 驱逐，直到低于上限。
- 单个产物上限 2 GiB；超过上限的 qcow2/VMDK 会让构建以可读错误失败，不会截断。
- 构建记录、目录快照、source pin 与发布审计不会自动删除；需要清理时先停机备份，再手工删除旧行。
- 备份文件不要与数据库放在同一块磁盘上。

## 本机验证

不占用生产端口时，可用同一套启动命令验证：

```bash
DATABASE_PATH=/tmp/combinewrt-deploy.db \
ARTIFACT_CACHE_DIR=/tmp/combinewrt-artifacts \
SOURCE_CACHE_DIR=/tmp/combinewrt-source-cache \
SESSION_SECRET=ticket16-integration-secret-0123456789abcdef \
ADMIN_PASSWORD_HASH='<existing hash>' \
BUILD_ADAPTER=fake \
MAX_CONCURRENT_BUILDS=2 \
PORT=3114 npm run start
curl -fsS http://127.0.0.1:3114/api/health
```

重启后再请求一次健康检查，确认 SQLite 文件可复用且迁移可重入。
