# combinewrt 生产部署

目标：一台 LAN 主机，一个 Node 进程，一个 SQLite 文件，一个反向代理。

## 前提

- Node.js 24（`node -v`）
- `sqlite3` CLI（备份/恢复）
- `apk` 3（`APK_BIN`，读取 feed 索引）
- 一个非 root 的系统用户 `combinewrt`
- 代码目录 `/opt/combinewrt`，数据目录 `/var/lib/combinewrt`

## 首次安装

```bash
sudo useradd --system --home /opt/combinewrt --shell /usr/sbin/nologin combinewrt
sudo loginctl enable-linger combinewrt
sudo mkdir -p /opt/combinewrt /var/lib/combinewrt /var/lib/combinewrt/artifacts
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
- `DATABASE_PATH`、`ARTIFACT_CACHE_DIR`
- `APK_BIN`
- `BUILD_REPO_TOKEN`（`BUILD_ADAPTER=github` 时）

不要把环境文件、数据库或构建产物提交到仓库。

```bash
sudo install -m 0644 deploy/combinewrt.service /etc/systemd/system/combinewrt.service
sudo systemctl daemon-reload
sudo systemctl enable --now combinewrt
sudo systemctl status combinewrt
curl -fsS http://127.0.0.1:3000/api/health
# {"ok":true}
```

反向代理示例见 `deploy/nginx-combinewrt.conf.example`。保留 `Host` 与
`X-Forwarded-Proto`；下载端点使用流式响应，示例中关闭了 `proxy_buffering`。

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

数据库迁移在进程启动时自动执行；迁移失败时进程不会带病启动。

## 备份与恢复

在线备份（应用可以继续运行）：

```bash
sudo install -m 0755 deploy/backup-db.sh /usr/local/sbin/combinewrt-backup
sudo DATABASE_PATH=/var/lib/combinewrt/combinewrt.db \
  /usr/local/sbin/combinewrt-backup /var/backups/combinewrt
```

`.backup` 生成一致性快照。建议每天 cron，并定期把备份复制到另一台主机。

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

恢复后登录管理页确认当前基线版本与目录快照；旧快照仍保留在数据库中。

## 保留策略

- `ARTIFACT_RETENTION_DAYS`（默认 7，0 关闭）控制下载产物的本地缓存清理。
- 构建记录与目录快照不会自动删除；需要清理时先停机备份，再手工删除旧行。
- 备份文件不要与数据库放在同一块磁盘上。

## 本机验证

不占用生产端口时，可用同一套启动命令验证：

```bash
DATABASE_PATH=/tmp/combinewrt-deploy.db \
ARTIFACT_CACHE_DIR=/tmp/combinewrt-artifacts \
SESSION_SECRET=ticket07-integration-secret-0123456789abcdef \
ADMIN_PASSWORD_HASH='<existing hash>' \
BUILD_ADAPTER=fake \
PORT=3114 npm run start
curl -fsS http://127.0.0.1:3114/api/health
```

重启后再请求一次健康检查，确认 SQLite 文件可复用且迁移可重入。
