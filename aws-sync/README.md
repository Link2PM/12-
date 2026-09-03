# Healthy AWS 同步服务

这是训练 PWA 的最小快照服务，面向单用户、单实例部署。服务仅使用 Python 标准库和 SQLite，可直接运行在带持久化 EBS 的 EC2 上；Caddy 通过 `health.gaindar.com/api/*` 同源反向代理给它。

它替代已经停用的 Supabase Edge Function，但保持“浏览器上传整份快照”的数据模型。服务使用 ETag 做条件写入，避免延迟请求或另一台设备用旧快照覆盖新记录。即使误传，服务也会在入库前丢弃顶层 `media` 字段；它不会保存媒体 Blob、同步密钥或 AI API Key。

## 接口

| 方法与路径 | 鉴权 | 说明 |
|---|---|---|
| `GET /api/health` | 无 | 进程健康检查，不检查数据库内容 |
| `POST /api/sync` | Bearer | 校验、清理并按 ETag 条件 upsert 当前用户的最新快照 |
| `GET /api/snapshot` | Bearer | 读取当前用户的最新快照、版本与 ETag |
| `OPTIONS`（以上路径） | 无 | 浏览器 CORS 预检 |

`POST /api/sync` 请求体必须是 JSON 对象，并包含：

```json
{
  "exportedAt": "2026-09-03T10:00:00.000Z",
  "appVersion": "1.2.0",
  "workoutLogs": [],
  "exerciseNotes": [],
  "dailyHabits": [],
  "bodyMetrics": [],
  "settings": [{"key": "startDate", "value": "2026-09-07"}],
  "aiAnalysis": []
}
```

首次写入成功的响应示例（摘要仅为示意）：

```http
HTTP/1.1 200 OK
ETag: "0123456789abcdef..."
Access-Control-Expose-Headers: ETag
```

```json
{
  "ok": true,
  "syncedAt": "2026-09-03T10:00:01.000Z",
  "updatedAt": "2026-09-03T10:00:01.000Z",
  "payloadSha256": "0123456789abcdef...",
  "requestSha256": "abcdef0123456789...",
  "serverRevision": 1,
  "counts": {
    "workoutLogs": 0,
    "exerciseNotes": 0,
    "dailyHabits": 0,
    "bodyMetrics": 0,
    "settings": 1,
    "aiAnalysis": 0
  },
  "strippedSettings": [],
  "unchanged": false
}
```

`requestSha256` 是服务端实际收到的请求体字节摘要，供前端核对回执确实对应本次提交。`payloadSha256` 与 ETag 是服务端清理后“持久状态”的规范 JSON SHA-256；计算时有意排除每次请求都会变化的 `exportedAt`。因此同一份训练状态稍后重传会返回 `unchanged: true`，不会推进 `updatedAt` 或 `serverRevision`，但 `syncedAt` 仍表示本次请求被确认的时间。

### 条件写入协议

1. 空数据库的首次写入可不带 `If-Match`；浏览器因数据库恢复而误带旧 ETag 时也允许作为空库初始化。
2. 每次成功的 `POST` 和 `GET /api/snapshot` 都返回带双引号的 `ETag`，浏览器应原样持久化。
3. 已有快照且本地持久状态发生变化时，`POST` 必须发送 `If-Match: "<上次 ETag>"`。
4. 缺少条件时返回 `428`，条件已过期时返回 `412`；两者都携带当前 `ETag` 和 `currentPayloadSha256`，且不会写库。
5. 浏览器遇到 `412`/`428` 后必须停止自动覆盖，先读取云端快照，再由用户确认如何处理。确认用本机数据覆盖时，使用刚读取的当前 ETag 重试。

冲突响应示例：

```http
HTTP/1.1 412 Precondition Failed
ETag: "fedcba9876543210..."
```

```json
{
  "ok": false,
  "error": "precondition_failed",
  "message": "If-Match does not match the latest snapshot",
  "currentPayloadSha256": "fedcba9876543210..."
}
```

主要错误码：

- `400`：JSON、UTF-8 或 Content-Length 无效；
- `401`：Bearer 密钥错误或缺失；
- `403`：浏览器 Origin 不在允许列表；
- `413`：请求体超过 5 MiB；
- `415`：不是 `application/json`；
- `422`：快照结构错误，或出现敏感字段、嵌套媒体/二进制字段；
- `428`：已有不同快照，但请求缺少 `If-Match`；
- `412`：`If-Match` 已不是服务端最新版。

### 敏感字段防护

前端仍应只上传安全设置白名单。服务端作为第二道防线：

- `settings` 只保留 `startDate`、`aiProvider`、`aiModel` 三项，且值必须符合短文本类型；其他设置统一剥离；
- 名字含 `secret`、`token`、`password`、`credential`、`privateKey`、`apiKey`、`accessKey`、`authorization` 或 `bearer` 的字段若出现在 `settings` 之外，整次请求返回 `422`；
- 顶层 `media` 会被丢弃；嵌套媒体/Blob/附件字段或任意字段中的 `data:` URL 返回 `422`；
- 未声明的顶层字段返回 `422`，避免未来客户端字段未经审核便自动落库；
- 日志不记录 Authorization、请求体或设置值。

## 本地测试

从仓库根目录运行：

```bash
python3 -W error::ResourceWarning -m unittest discover -s aws-sync -p 'test_*.py' -v
```

本地手动启动示例：

```bash
HEALTHY_SYNC_SECRET=local-test-secret-24-chars \
HEALTHY_SYNC_DB=/tmp/healthy-sync-test.sqlite3 \
HEALTHY_ALLOWED_ORIGINS=http://127.0.0.1:8080 \
python3 aws-sync/server.py
```

然后可以分别检查：

```bash
curl -i http://127.0.0.1:8787/api/health
curl -i -X OPTIONS http://127.0.0.1:8787/api/sync \
  -H 'Origin: http://127.0.0.1:8080' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type,if-match'
```

上传测试快照时，从环境变量读取测试密钥，不要把密钥写入命令历史或仓库文件：

```bash
curl -i -X POST http://127.0.0.1:8787/api/sync \
  -H "Authorization: Bearer ${HEALTHY_SYNC_SECRET}" \
  -H 'Content-Type: application/json' \
  --data-binary @test-snapshot.json
```

已有快照的变更上传还要加入上次响应的 ETag：

```bash
curl -i -X POST http://127.0.0.1:8787/api/sync \
  -H "Authorization: Bearer ${HEALTHY_SYNC_SECRET}" \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "<sha256-from-last-response>"' \
  --data-binary @updated-test-snapshot.json
```

## EC2 + systemd + Caddy 部署材料

仓库提供：

- `deploy/healthy-sync.service`：受限权限的 systemd 单元；
- `deploy/healthy-sync.env.example`：不含真实密钥的环境文件模板；
- `deploy/Caddyfile.example`：推荐的同源 `/api/*` 路由及 PWA 缓存策略。

建议目录：

```text
/opt/healthy-sync/server.py
/etc/healthy-sync.env          # root:root，0600
/var/lib/healthy-sync/         # healthy-sync 用户，0700，位于持久化 EBS
/etc/systemd/system/healthy-sync.service
```

上线前由运维完成以下操作：

1. 创建无登录权限的 `healthy-sync` 系统用户，并复制 `server.py`；
2. 从示例生成 `/etc/healthy-sync.env`，用密码生成器创建新的随机 Bearer 密钥；不得沿用已暴露或提交过的值；
3. 安装并启动 systemd 单元，只监听 `127.0.0.1:8787`；
4. 将 Caddy 片段合并进现有站点，而不是覆盖其他路由；
5. 先用独立端口、独立数据库和独立 `HEALTHY_SYNC_USER_KEY` 建立 staging 实例，跑完整写入测试；
6. 前端切换到同源 `/api/sync` 后，生产环境只做健康检查、鉴权/CORS 检查和已有正式快照的读取验证，不上传合成测试快照；
7. 发布 PWA 时更新 Service Worker 缓存名，并清理 CDN 中的 `index.html`、`plan.js`、`sw.js` 缓存。

服务监听回环地址，EC2 安全组不需要为 8787 开放公网入站。Caddy 负责 TLS；应用侧仍会精确校验 Origin。

### 数据持久化与备份

SQLite 适合当前单实例、单用户的快照用途，但数据库文件必须放在持久化 EBS，不要放在临时盘，也不要让多个服务实例同时共享网络文件系统。上线流程应加入定期 SQLite 在线备份及恢复演练。需要多实例或双向合并时，应迁移到 PostgreSQL，而不是复制 SQLite 文件。

## 上线验收清单

- 本仓库 unittest 全绿；
- 未鉴权的 `POST` 与 `GET /api/snapshot` 均为 `401`；
- 允许 Origin 的 `OPTIONS` 为 `204`，未知 Origin 为 `403`；
- staging 中约 300 KiB 的脱敏真实结构样本上传成功，服务端 counts 与持久状态 SHA-256 可复核；
- 除 `startDate`、`aiProvider`、`aiModel` 外的设置不会落库；嵌套媒体/Data URL 被拒绝；
- 重复上传不产生重复快照；并发相同首写仅一次变更；延迟旧请求返回 `412`，无法覆盖最新版；
- 超过 5 MiB 返回 `413`；
- 断网、重启浏览器、重新联网后，前端仍能补推 pending 变更；
- 自动同步只重试网络错误、`408`/`425`/`429` 与 `5xx`；`401`/`403`/`412`/`413`/`415`/`422`/`428` 不形成无限重试；
- 生产不执行合成数据 `POST`。如必须验证写路径，只能先备份，并将刚读取的正式 `snapshot` 原样携当前 ETag 回放，确认响应为 `unchanged: true`；
- CDN 缓存清理后，线上版本号与三个静态文件哈希均为本次发布版本。
