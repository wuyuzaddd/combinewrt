# combinewrt

自用 OpenWrt 固件在线构建站。公开页面只读，管理员登录后可提交构建、查看历史与下载产物。

当前进度：ticket 04（站点骨架、管理员会话、目录快照、构建表单与计划预览、派发与状态轮询 stub）。真实 ImageBuilder 构建与产物在 ticket 05 接入。

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
| `APK_BIN` | 否 | apk-tools 3 可执行文件，用于读取 feed 的 `packages.adb`；默认 `apk`。目录刷新需要它 |
| `IMMORTALWRT_BASE_VERSION` | 否 | 锁定的 ImmortalWrt 版本，默认 `25.12.2` |
| `BUILD_ADAPTER` | 否 | `fake`（默认，本地 stub）或 `github`（派发到真实 Actions） |
| `BUILD_REPO` | 条件 | `owner/repo`；`BUILD_ADAPTER=github` 时必填 |
| `BUILD_REPO_TOKEN` | 条件 | 仅授权该仓库 `Actions: write` 的 PAT；`github` 适配器必填 |
| `BUILD_WORKFLOW` | 否 | 构建仓库内的工作流文件名，默认 `build.yml` |
| `BUILD_REF` | 否 | 工作流所在分支，默认 `main` |

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

## 构建派发（ticket 04）

`/build` 提交后创建 Build 记录并调用适配器派发，跳转到 `/builds/<id>`；详情页每 4 秒刷新一次状态，展示日志尾部、失败原因与产物下载按钮。

- 默认 `BUILD_ADAPTER=fake`：进程内假 run（queued → running → succeeded），只用于本地联调，不会产生真实固件。
- `BUILD_ADAPTER=github`：向 `BUILD_REPO` 派发 `BUILD_WORKFLOW`，按 `run-name` 里的 build id 找回 run；完成后拉取日志尾部与产物，经站点鉴权代理下载。
- 失败原因优先取结论，其次从日志末尾的 `error`/`failed` 行提取摘要。
- 站点只保存运行元数据；产物保留 30 天后由 GitHub 清理，届时下载返回 409/502。

### 首次部署（GitHub Actions）

1. 新建公开构建仓库，把 `build-workflow/build.yml` 复制到 `.github/workflows/build.yml`（GitHub 只执行该路径；ticket 05 会替换为真实 ImageBuilder 构建）。
2. 工作流必须在 `BUILD_REF`（默认 `main`）上，且 dispatch 时已存在；`run-name` 含 `${{ inputs.build_id }}`，并声明 `build_id`/`artifact_name`/`profile`/`image_type` 四个 inputs，否则 GitHub 422 或站点匹配不到 run。
3. 创建仅授权该仓库的 fine-grained PAT，勾选 `Actions: read and write`（派发、读日志、读产物都走这一项）。放到 `BUILD_REPO_TOKEN`，不要提交。
4. 配置 `BUILD_ADAPTER=github`、`BUILD_REPO=owner/repo`、`BUILD_REF=main`，重启站点；缺配置会启动失败并列出全部问题。
5. 注意：公开仓库的 Actions 日志与产物对所有人可见，不要把 secret 写进构建输入。

## 目录快照（ticket 02）

管理员登录后打开 `/catalog`，点“刷新目录”：站点会从 `https://downloads.immortalwrt.org/releases/<版本>/` 拉取 `profiles.json` 与 7 个 feed 的 `packages.adb`，解析成不可变快照。

- 快照按“基线版本 + `version_code`（feed commit）”键控；同一键重复刷新不会重建。
- 只接受 `arch_packages=x86_64` 的 profiles；镜像格式从 `images[].name` 推导（ext4 EFI、squashfs EFI、rootfs.tar.gz）。
- 软件包按名称/描述搜索、按分类浏览；详情含版本、安装大小、直接依赖、license、origin。
- 任一解析失败则本次刷新整体失败，旧快照保持为 active，页面不会出现半空目录。

刷新需要 apk-tools 3。最省事的方式是从 ImmortalWrt ImageBuilder 取：

```bash
# 解压 ImageBuilder 后
export APK_BIN="$PWD/immortalwrt-imagebuilder-25.12.2-x86-64.Linux-x86_64/staging_dir/host/bin/apk"
```

该包装脚本依赖同目录 `../lib/`，不要只拷 `apk` 文件。也可以安装发行版自带的 apk-tools 3。

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
6. **公开构建仓库**：创建 public 的 build 仓库，放入 `build-workflow/build.yml`；fine-grained PAT 只授予该仓库 `Actions: write`。设置 `BUILD_ADAPTER=github`、`BUILD_REPO=owner/repo`、`BUILD_REPO_TOKEN=github_pat_...`（详见“构建派发”）。PAT 只放在站点服务器的环境变量/secret 中，不下发前端。工作流日志公开，禁止 `echo` 密码，root 密码只以 crypt hash 传给构建。
7. **产物下载**：构建产物放 workflow artifact（保留 30 天），站点用 token 代理下载；不要把大文件提交进 git。

## 安全说明

- 单管理员；密码只存 scrypt 哈希（N=16384、r=8、p=1、64 字节输出）。
- 登录限速 5 次 / 15 分钟 / IP；被限速时即使密码正确也拒绝。
- 会话 7 天，HMAC-SHA256 签名，`HttpOnly` + `SameSite=Lax`；HTTPS 下自动加 `Secure`。
- 公网部署时建议在反向代理层再加一层限速/WAF。

## 目录

```text
src/app/                页面与 route handlers（/api/login、/api/logout、/api/health、/api/catalog/*、/api/build/plan、/api/builds/*）
src/app/catalog/        目录浏览与包详情
src/app/build/          构建表单与计划预览
src/app/builds/         构建历史、详情与状态轮询
src/lib/builds/         构建记录、派发适配器（fake/github）与状态服务
build-workflow/         构建仓库用的 stub 工作流模板
src/lib/auth/           会话、密码、限速、登录服务
src/lib/catalog/        profiles/adb 解析、快照存储、刷新服务与 ImmortalWrt 数据源
src/lib/build/          表单校验、依赖解析、冲突、密码哈希、uci-defaults 与计划
src/lib/config.ts       环境变量校验
src/lib/db.ts           SQLite 打开与迁移
src/lib/migrations.ts   内置迁移
scripts/hash-password.mjs
```

## 许可与商标

代码以 MIT 许可发布，见 `LICENSE`。

OpenWrt® 是 Software Freedom Conservancy 的注册商标。本项目是独立项目，与 OpenWrt 项目及 SFC 无隶属、背书或赞助关系；站点与文档中对 OpenWrt 的使用仅为描述性说明。
