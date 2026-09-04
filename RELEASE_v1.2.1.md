# Healthy v1.2.1 同步回执热修复交接单

> 状态：✅ 2026-09-04 已由 CTO 完成 exact-tree 复核、生产备份、后端优先发布、网关切换、前端发布和生产 smoke。正式训练快照在 v1.2.0 客户端提示失败前已经写入并完整保留；iOS PWA 的最终关闭重开与一次同步确认仍须由用户在原设备完成。

## 1. 事故结论与修复边界

- 用户填写 `/api/sync` 与最新密钥后，401 已消失；随后提示“服务端未返回可校验的数据版本”。
- 该提示只会在 POST 已返回 2xx，且 `ok`、`syncedAt`、请求 SHA-256、设置过滤结果和各表 counts 全部通过后触发。服务端先提交 SQLite 再返回回执，因此该次快照很可能已经落库，只是客户端没有确认。
- 根因是生产链路经过 Caddy 与 Cloudflare。压缩或内容转换会把源站强 ETag 弱化为 `W/"..."`、附加编码后缀或移除，而 v1.2.0 只接受精确的 `"<64位 SHA-256>"`。
- v1.2.1 不改变训练计划、动作 ID、数据库结构、同步地址或同步密钥。

修复包含四层：

1. 服务端 API 增加 `Cache-Control: no-store, no-transform`，同步服务版本升为 `1.2.1`。
2. Caddy 的 `encode zstd gzip` 只应用于静态页面，不再包裹 `/api/*` 反代。
3. 前端以已鉴权 JSON 的 `payloadSha256` 作为应用级数据版本，规范化为强 `If-Match`；响应头若仍含 SHA-256，必须交叉一致，否则继续拒绝。
4. 对 v1.2.0 “服务端已落库、客户端丢失回执”的升级路径，收到 412/428 后先只读云端快照。仅当训练、笔记、习惯、体测、安全设置和 AI 分析逐项完全相同时自动恢复确认；任何差异仍保持冲突阻断并要求用户确认，不能静默覆盖。

依据：[Cloudflare ETag 行为](https://developers.cloudflare.com/cache/reference/etag-headers/)、[Cloudflare 内容压缩与 `no-transform`](https://developers.cloudflare.com/speed/optimization/content/compression/)、[Caddy `encode`](https://caddyserver.com/docs/caddyfile/directives/encode)。

## 2. 版本与冻结基线

- 基线提交：`ecdd145c01495cab6408adb03836a142e7d2274b`
- 应用版本：`v1.2.1`
- Service Worker：`healthy-v7`
- 同步服务：`healthy-sync 1.2.1`
- 生产同步入口：`/api/sync`
- 分支：`codex/healthy-sync-etag-v1.2.1`

提交前候选文件 SHA-256：

| 文件 | SHA-256 |
|---|---|
| `index.html` | `38b7aa33bf224335546a7dfa520d223a13f76853cda549c671a0b7a1c7e23d17` |
| `plan.js`（内容必须保持不变） | `bf0614e921b5aabb33d7c8b120d4459ae3f6a920854da72f79680cdc91dd0ff4` |
| `sw.js` | `5b36f469b4bda27a96c9019b6ddac30d634e3570577e7f3b71c135b8634e7734` |
| `aws-sync/server.py` | `5064650e7eaf0587446f190406190d23c57df1b1c4ba60bfbc774833554e2cc0` |
| `aws-sync/test_server.py` | `61bb0faafbd2376666323a650119232b8a8d0c2d59b83ee0035e52612b9c24a63` |
| `aws-sync/deploy/Caddyfile.example` | `6c9a475f568b486b023f9294d5f8c37ee9b66df58bca26ab93fd8de988ea9ca6` |
| `aws-sync/README.md` | `0184f107148f88d2666b9a399144c866322180e9303aa024a3050c0e8625a5eb` |
| `scripts/test-v4-integration.js` | `7bcd0c67a468b6b125fe4c3ba7549f9530514fe9133f33d7eaedcab7e6c24f63` |
| `CLAUDE.md` | `0d7be73b084921dd64de9fcc79f9c23113f98e472b3b8a8cd9947f46fb189f00` |

`RELEASE_v1.2.1.md` 是交接单自身；CTO 在提交后记录最终 commit/tree，并对实际部署文件重新核验。禁止从 dirty working tree 直接部署，禁止 `git add -A`。

## 3. 已通过的本地门禁

- `node scripts/validate-plan.js`：PASS，Week 3–31、150 个训练日、1105 个动作条目。
- `node scripts/test-v4-integration.js` 与无私有快照夹具：PASS。
- `plan.js`、`sw.js`、`index.html` 内联脚本语法：PASS。
- `python3 -W error::ResourceWarning -m unittest discover -s aws-sync -p 'test_*.py' -v`：17/17 PASS。
- `git diff --check`：PASS。
- 新覆盖：强/弱/缺失/压缩后缀 ETag、头体哈希不一致、规范强 ETag 持久化、下一次 `If-Match`、v1.2.0 跨版本丢失回执、远端不同数据继续阻断、人工确认后仍只使用规范强 ETag、并发 dirty token。
- 独立审查：P0–P2=0。

仓库测试无法替代真实 Caddy/Cloudflare 链路，因此边缘压缩与响应头是生产必验项。

## 4. CTO 上线顺序

1. 冻结最终 commit/tree；只允许交接单列出的文件变化，`plan.js` 必须保持上述原哈希。
2. 在任何部署、重启或清缓存前，先对生产 SQLite 做一致性备份与 integrity check；再经鉴权只读获取当前正式 snapshot，保存到仓库外受限目录。同步留存实际 Caddy 配置、`systemctl cat healthy-sync`、真实 `ExecStart` 路径、当前已部署 `server.py`/静态文件及其 SHA-256，形成可复现回滚锚。只在回执登记时间、版本、counts、ETag/摘要和备份 SHA-256，禁止记录密钥或训练正文。
3. 将 `aws-sync/server.py` 部署到生产 unit 的真实 `ExecStart` 路径，重启 `healthy-sync`，核对 active、`NRestarts` 与本次启动日志；再按样例调整实际 Caddy，使 `/api/*` 不经过 `encode`。运行 `caddy validate` 后 reload，不覆盖站点其他规则。
4. 后端验收：服务 enabled/active、restart=0；`GET /api/health` 为 200 且版本 `1.2.1`；未鉴权 snapshot 为 401；同源 CORS 为 204；API 返回 `no-store, no-transform`。用 `Accept-Encoding: gzip`、`br`、`zstd`/浏览器默认分别只读验证，数据版本仍可用。
5. 经鉴权只读 `GET /api/snapshot`：若快照存在，核对强 ETag 与正文 `payloadSha256`、revision、时间和 counts；若不存在，诚实记录 404。生产禁止上传合成数据。
6. 后端门禁通过后再发布 `index.html` 与 `sw.js`；`plan.js` 内容不变，只通过 `?v=1.2.1` 重新引用。清理首页、`index.html`、`plan.js`、`sw.js` 的 CDN 缓存。上线前确认可用的 purge 权限；若仍无权限，只能在明确审批后以首页 DYNAMIC/no-cache 加公网裸 URL 字节哈希完全一致作为替代验收，并诚实记录未执行 purge。
7. 公网核对 `APP_VERSION=1.2.1`、`healthy-v7`、三份静态文件 SHA-256、Service Worker 不拦截 `/api/*` 或带 Authorization 的请求。
8. GitHub Billing/Actions 问题可继续登记为跳过，但不得写成 CI PASS。

## 5. 用户最终验收

- 上线前用户不要反复点击同步，不删除主屏 PWA，不清空 Safari 网站数据，也不重新输入或轮换密钥。
- CTO 完成后，用户关闭并重新打开现有 PWA，确认设置页为 `v1.2.1`。应用会尝试恢复旧 pending；若没有自动出现成功提示，只点击一次“立即同步”。
- 若云端是刚才已经写入的相同数据，客户端可显示“云端已有完全相同的数据，已恢复同步”；这属于成功，不会重复或覆盖训练记录。
- 只有用户端显示成功，且服务端只读核验时间、revision、摘要和 counts 后，才可声明同步闭环恢复。

## 6. 回滚

- 后端门禁失败：停止前端发布，按部署前回滚锚恢复原服务代码与实际 Caddy 配置，重启服务并 validate/reload Caddy；保留当前数据库、部署前备份和日志，不得因客户端提示失败而删除快照。
- 仅前端异常：可回滚 `index.html`/`sw.js`；向后兼容的 `healthy-sync 1.2.1` 可保留。回滚静态文件后仍需 purge 并复核公网哈希；若采用获批的无 purge 替代方案，也必须重新完成对应验收。
- 除非确认数据库损坏并另行获得明确授权，不得用旧备份覆盖生产快照。

## 7. 最终生产回执（由 CTO 填写）

- 冻结候选：本地 commit `74266989d41c3a15d9afa56858c0dea24517b728`；GitHub API 等价 commit `c56839dc701d6cabbe8f4ffe77846192f96a4990`；共同 tree `09c21a3cc5caa5294b74582d4fe61d9a08838beb`。
- PR/合并提交：[PR #3](https://github.com/Link2PM/12-/pull/3)；最终 main `660458cbf49d242442e9d9235149318e3d3f7189`，tree 与测试 tree 完全一致。GitHub Actions 因 Billing 跳过，登记为 `NOT CI PASS`；发布依据为 exact-tree 本地 required-equivalent、17/17 后端测试、独立审查与生产 smoke。
- 一致性备份：`/var/backups/healthy/20260904T023605Z-pre-v1.2.1`，目录 `root:root`/`0700`、文件 `0600`；`SHA256SUMS` 的 SHA-256 为 `7a646ade1a8c0040809bc5a25680e3f3e889c3855178a779cdcbcdc2d7866465`。备份包含 SQLite、实际 Caddyfile、systemd unit、服务代码与三份静态文件，不含环境文件或密钥；SQLite integrity check 为 `ok`。
- 部署：生产实例 `i-0381db4f8d525912d`；后端 `healthy-sync 1.2.1` 先发，随后调整实际 Caddy 压缩边界，最后发布 `index.html`/`sw.js`。后端与 Caddy 均 `active/running`、`NRestarts=0`；环境文件保持 `root:root`/`0600`；最终数据库 integrity check 为 `ok`。
- 服务/API：公网 `/api/health` 200 且版本 `1.2.1`；未鉴权 snapshot 401；未知 API 404；同源 CORS OPTIONS 204；API `Cache-Control: no-store, no-transform`。经鉴权只读矩阵在 `identity`、`gzip`、`br`、`zstd` 四种请求下均得到相同强 ETag，且与正文 `payloadSha256` 完全一致；无 API `Content-Encoding` 改写。
- Cloudflare：未执行 purge（现有 token 无该权限），采用已批准的替代验收：首页 `CF-Cache-Status: DYNAMIC`、`Cache-Control: no-cache, must-revalidate`，公网裸资源逐字节哈希与候选完全一致。
- 线上静态哈希：`index.html` = `38b7aa33bf224335546a7dfa520d223a13f76853cda549c671a0b7a1c7e23d17`；`plan.js` = `bf0614e921b5aabb33d7c8b120d4459ae3f6a920854da72f79680cdc91dd0ff4`（内容未变）；`sw.js` = `5b36f469b4bda27a96c9019b6ddac30d634e3570577e7f3b71c135b8634e7734`。公网已确认 `APP_VERSION=1.2.1`、`plan.js?v=1.2.1`、`healthy-v7`。
- 真实快照只读验收：部署前后均为 `serverRevision=1`、`updatedAt=2026-09-04T01:09:33.530Z`、摘要 `56744af996141d930dba0244f8fba30c04cedac798ffaf1927a8b77600cdf660`；counts 保持 `workoutLogs=561`、`exerciseNotes=281`、`dailyHabits=41`、`bodyMetrics=4`、`settings=3`、`aiAnalysis=8`。发布过程中未执行 POST，未改写、删除或合成正式训练数据。
- 权限收口：发布包只读临时 IAM policy `healthy-v121-release-get-20260904` 已删除并复核不存在。生产同步密钥未进入仓库、日志或回执；本机 Keychain 存在性已按不读取值方式复核，service=`health.gaindar.com Healthy Sync v1.2.0`、account=`link`。
- 用户设备最终一步：关闭并重新打开原 iOS 主屏 PWA，确认页面版本 `v1.2.1`；若未自动显示恢复成功，只点击一次“立即同步”。不得删除旧主屏图标、清 Safari 网站数据或反复点击。完成后再用只读 revision/摘要/counts 确认设备端闭环。
