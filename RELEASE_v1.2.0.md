# Healthy v1.2.0 发布交接单

> 状态：本地发布候选已冻结并通过实现侧门禁；生产尚未发布。CTO 必须先做 exact-tree 复核与 staging，再执行生产部署和验收。

## 1. 发布范围

- 应用版本：`v1.2.0`
- Service Worker 缓存：`healthy-v6`
- 同步服务版本：`1.2.0`
- 当前仓库基线与当时生产静态基线：`f1a5d12fbae9845b969451201eb7b3acafc8d1df`
- 当前分支：`main`；`origin/main` 与上述基线一致；候选尚未提交。
- 生产域名：`https://health.gaindar.com/`
- GitHub Billing：本次按用户要求跳过，登记为 `NOT CI PASS`；不得把它写成 CI 已通过。

本次包含：

1. 将 V4 12 周计划映射到 App Week 20–31，Week 19 为过渡周；旧 Week 3–18 完整对象保持不变。
2. 同一动作保留 canonical 名称，并新增稳定 `movementId`；历史完成记录只补索引，不改原 `exerciseId`。
3. 22 个 V4 动作均有显式 Bilibili 教学入口。
4. 默认同步入口迁移为同源 `/api/sync`，并加入离线补推、指数退避、严格回执、ETag 冲突保护、跨标签页变更令牌及旧 IndexedDB 设置迁移。
5. 新增单用户 AWS/EC2 快照服务候选和 systemd/Caddy 部署材料；同步 payload 不包含媒体、AI Key、同步密钥或同步地址。

## 2. 精确候选文件

CTO 只能精确暂存下列文件，禁止 `git add -A`：

| 文件 | SHA-256 |
|---|---|
| `CLAUDE.md` | `6dc442066d56892476c2cf844d0238390a6d5b1df4d4870a37e4c54d5761995c` |
| `index.html` | `0e4fbf49689d816e7c4b7a22644c82963e217b5205b693979285d58fdf0a0e7e` |
| `plan.js` | `bf0614e921b5aabb33d7c8b120d4459ae3f6a920854da72f79680cdc91dd0ff4` |
| `sw.js` | `7c2d76ad39cb4b1c7c61a065227d358dc19ad61a25c29572a74395dbafc3d82f` |
| `scripts/test-v4-integration.js` | `7a232c3f38b2f0f22c45f0a9a3706cdc7aa73c8573f1cc6bf1409384c28d0a62` |
| `aws-sync/.gitignore` | `b960db3ce15d152eb3a621af24289db0d773f623c0501a397641bead1b268d18` |
| `aws-sync/README.md` | `eeecd38927ffafe8763a238892e6ce8e0aca3a8ee4c2245a0f2c33a5660f4cf1` |
| `aws-sync/server.py` | `e1265cb0cd0c8c44e74e29a307b775c10d8b3ee4af1eec34da3790b12c366b26` |
| `aws-sync/test_server.py` | `2559ecdb7e9efe0a6e95b8947df9df001d09bc3cfbf3e8cf3f7ec057090385f7` |
| `aws-sync/deploy/Caddyfile.example` | `d88b45e169b854857a686b3f0b505f8f2a89f3ffffe57708029dc3f9ce0e1a5a` |
| `aws-sync/deploy/healthy-sync.env.example` | `71bd630536e0dfee2c42fe1ebfa90bab13dff901c2e6bbb534f16a858170b629` |
| `aws-sync/deploy/healthy-sync.service` | `737670ead0863c2490199d556f821a37750662f540f52ac3179575e948c3d491` |
| `RELEASE_v1.2.0.md` | 交接单自身；CTO 冻结 prospective tree 时重新计算 |

以下内容必须留在本机且不得纳入本次提交或部署：`.claude/`、`.DS_Store`、`STATUS_2026-08-30.md`、训练计划审阅稿/执行卡、Word 文档、AI 报告、`healthy-mcp/` 训练快照、`supabase/` 与 `cloudflare-connector/` 旧实现。不得提交任何真实 `.env`、Bearer 密钥、AI Key、数据库或训练导出 JSON。

## 3. 已通过的门禁

- `node scripts/validate-plan.js`：PASS，Week 3–31、150 个训练日、1105 个动作条目。
- `node scripts/test-v4-integration.js`：PASS，脱敏真实历史精确回填 99 条。
- `HEALTHY_TEST_NO_PRIVATE_SNAPSHOT=1 node scripts/test-v4-integration.js`：PASS，纯净检出夹具精确回填 7 条。
- V4：12 周、每周正式槽位 `[4,4,2,4,4]`、22 个唯一动作、全部稳定索引和显式视频映射。
- Week 3–18：逐周完整对象固定 SHA-256 回归通过。
- 同步：跨标签页在途竞态、重启恢复、旧 IDB settings 先迁移后改 URL、严格请求/响应摘要、counts、敏感设置、ETag、412/428 冲突流程均通过。
- Service Worker：`/api`、`/api/*`、带 Authorization 的 GET 均不进入缓存。
- `python3 -W error::ResourceWarning -m unittest discover -s aws-sync -p 'test_*.py' -v`：17/17 PASS。
- `plan.js`、`sw.js`、测试脚本、`index.html` 内联脚本语法：PASS。
- `git diff --check`：PASS。
- 本地浏览器 smoke：v1.2.0、周次/计划渲染、教学入口、手动同步、习惯自动同步、冲突摘要/取消/确认、同步期间再编辑后继续 pending 均已验证。清空所有数据未在浏览器里破坏性实测，仅完成代码审阅；生产前不得拿正式数据试清空。

最终独立审查未发现 P0/P1，结论仅为“可交 CTO staging”，不代表生产已经恢复。

## 4. CTO 上线顺序

1. 只读确认真实 AWS 架构、当前 Caddy/静态目录、持久化卷、备份和部署方式。仓库中的 SQLite 服务是已测试的最小候选，不得假定它就是现有迁移数据库；若生产已使用其他数据库，应保持本文 API 契约接入该数据层。
2. 按上表校验全部哈希，并从基线 `f1a5d12...` 生成 prospective exact tree；确认只包含白名单文件。
3. 先在独立端口、独立数据库、独立 user key 的 staging 部署后端；运行 17 项测试、真实 `caddy validate`、约 300 KiB 脱敏结构样本往返、并发/冲突与双标签页浏览器 smoke。
4. 为生产创建或确认同步密钥，只写入仓库外的 `/etc/healthy-sync.env`，权限 `0600`。如更换密钥，需安排用户在设置页一次性更新；任何消息、日志、提交或交接单均不得包含密钥值。
5. 备份现有生产快照/数据库并记录 ETag、服务配置和静态资源；后端先发布，确认 `/api/health`、鉴权、CORS、读取和条件写入契约后，再发布前端。
6. 精确部署 `index.html`、`plan.js`、`sw.js`；清理 Cloudflare/CDN 中这三项及首页缓存。不能依赖最长四小时的旧缓存自然过期。
7. 生产只做健康、未鉴权 401、CORS、经鉴权读取验证。禁止上传合成训练数据；若必须验证写路径，只可先备份，再把刚读取的正式 snapshot 携当前 ETag 原样回放，并确认 `unchanged: true`。
8. 在 iOS 现有 PWA 实例中验收版本 `v1.2.0`、App Week 19/20 日期、旧训练记录、动作笔记、视频跳转、pending 状态及一次真实新记录同步。不要删除旧主屏图标；先导出备份，再处理任何 PWA 重装。
9. 回传最终 commit/tree、部署目标、线上三份静态文件 SHA-256、服务版本、生产 smoke、备份位置与回滚锚。

## 5. 回滚

生产静态基线为提交 `f1a5d12fbae9845b969451201eb7b3acafc8d1df`：

| 文件 | 基线 SHA-256 |
|---|---|
| `index.html` | `b7dbda6864dcdb1ca85eac5dd61cb286075e314110d7767bc97594e8481fbf3f` |
| `plan.js` | `36aa79379369adf53c721cfb4c8c58b78b8b671afad8559091f52f2686c7e4ac` |
| `sw.js` | `1b1967f2723e99dd7d905c69900d9f0b07cee33bf42d565a9a955f7ca72f92fe` |
| `CLAUDE.md` | `53d46c8d28a41121d13aef945d502a237e28bde6b68085336a71196f72eeecc7` |

若前端出现问题，恢复上述精确静态资源并再次清 CDN 缓存。同步服务与数据库不得直接删除；先停止新写入、保留数据库和日志，再按部署前备份恢复。任何回滚后都要重新验证旧训练数据仍可读取。
