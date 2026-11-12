# 拾光群岛 后端

## 表结构

应用首次安装到班级服务器后，需要执行 `schema.sql` 建表：

```bash
sqlite3 server/database/classintra.db < market-apps/shiguang/backend/schema.sql
```

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/shiguang/state` | 查询当前用户状态 |
| POST | `/api/shiguang/incr`  | 自增（body: `{ delta?: number }`） |

两个接口都需要登录态（`auth.requireAuth`）。

## 卸载行为

应用卸载后，其 API 返回 JSON 404 而非前端 `index.html`。表数据不会被自动清理——
如需保留用户数据请勿在卸载时 DROP，如需清理请提供显式的清理入口。
