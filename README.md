# combinewrt

自用 OpenWrt 固件在线构建站。公开页面只读，管理员登录后可提交构建、查看历史与下载产物。

当前进度：ticket 01（站点骨架 + 管理员会话登录）。构建编排、镜像产物与包目录在后续 ticket 中实现。

## 技术栈

- Next.js 16（App Router、Turbopack）+ React 19 + TypeScript
- SQLite（`node:sqlite`，WAL 模式）
- Tailwind CSS 4
- Vitest

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

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SESSION_SECRET` | 是 | 会话 HMAC 密钥，至少 32 字符；轮换后所有会话立即失效 |
| `ADMIN_PASSWORD_HASH` | 是 | `scrypt$<salt>$<hash>`，由 `npm run hash-password` 生成；明文密码不落盘 |
| `DATABASE_PATH` | 否 | 默认 `./data/combinewrt.db`，目录会自动创建 |
| `APP_ORIGIN` | 否 | 站点对外绝对地址（含协议），默认 `http://localhost:3000`；生产必须是 `https://` |

缺少必填项或格式错误时，进程启动即失败，并一次性列出全部问题。

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
| `npm run hash-password -- '<password>'` | 生成管理员密码哈希 |

## 测试与 CI

`npm run lint`、`npm run typecheck`、`npm test`、`npm run build` 在本地与 GitHub Actions（`.github/workflows/ci.yml`）跑同一组检查。

## 首次部署清单

1. **主机**：Node.js 24+，持久化磁盘存放 SQLite 与构建缓存，建议至少 2GB 内存。
2. **反向代理**：Nginx/Caddy 终止 TLS，转发到 `127.0.0.1:3000`，并**覆盖**（不是追加）`X-Forwarded-For` / `X-Real-IP` 与 `X-Forwarded-Proto`。登录限速按 IP 分桶，若代理放行客户端自带的转发头，攻击者可伪造 IP 绕过限速。
3. **环境**：`APP_ORIGIN=https://your.domain`；`SESSION_SECRET` 用 `openssl rand -base64 48`；`ADMIN_PASSWORD_HASH` 离线生成；`DATABASE_PATH` 指到持久目录。
4. **进程管理**：用 systemd 或容器托管，示例：

   ```ini
   [Unit]
   Description=combinewrt
   After=network.target

   [Service]
   WorkingDirectory=/opt/combinewrt
   EnvironmentFile=/opt/combinewrt/.env
   ExecStart=/usr/bin/npm start
   Restart=always
   User=combinewrt

   [Install]
   WantedBy=multi-user.target
   ```

5. **备份**：定期备份 SQLite；WAL 模式下用 `sqlite3 data/combinewrt.db ".backup backup.db"`，不要只拷主文件。
6. **公开构建仓库（后续 ticket）**：创建 public 的 build 仓库；fine-grained PAT 只授予该仓库 `Actions: write`。约定环境变量为 `BUILD_REPO=owner/repo` 与 `BUILD_REPO_TOKEN=github_pat_...`（ticket 04/05 接入，当前版本尚未读取）；PAT 只放在站点服务器的环境变量/secret 中，不下发前端。工作流日志公开，禁止 `echo` 密码，root 密码只以 crypt hash 传给构建。
7. **产物下载**：构建产物放 workflow artifact（保留 30 天），站点用 token 代理下载；不要把大文件提交进 git。

## 安全说明

- 单管理员；密码只存 scrypt 哈希（N=16384、r=8、p=1、64 字节输出）。
- 登录限速 5 次 / 15 分钟 / IP；被限速时即使密码正确也拒绝。
- 会话 7 天，HMAC-SHA256 签名，`HttpOnly` + `SameSite=Lax`；HTTPS 下自动加 `Secure`。
- 公网部署时建议在反向代理层再加一层限速/WAF。

## 目录

```text
src/app/                页面与 route handlers（/api/login、/api/logout、/api/health）
src/lib/auth/           会话、密码、限速、登录服务
src/lib/config.ts       环境变量校验
src/lib/db.ts           SQLite 打开与迁移
src/lib/migrations.ts   内置迁移
scripts/hash-password.mjs
```

## 许可与商标

代码以 MIT 许可发布，见 `LICENSE`。

OpenWrt® 是 Software Freedom Conservancy 的注册商标。本项目是独立项目，与 OpenWrt 项目及 SFC 无隶属、背书或赞助关系；站点与文档中对 OpenWrt 的使用仅为描述性说明。
