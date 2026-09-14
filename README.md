# Rollpig

基于 Node.js 24、TypeScript 和 Express 5 的最小 HTTP 服务示例。
本次仅初始化工程，业务设计见 [docs](./docs/rollpig-project-development-v2.md)。

## 本地开发

```bash
pnpm install
pnpm dev
```

默认监听 `0.0.0.0:3000`，可通过 `SERVER_HOST`、`SERVER_PORT` 环境变量覆盖。

| 请求 | 响应 |
| --- | --- |
| `GET /` | `{"message":"Hello, Rollpig!"}` |
| `GET /health` | `{"status":"ok"}` |

## 构建与运行

```bash
pnpm typecheck
pnpm build
pnpm start
```

开发模式使用 `tsx watch` 自动重启，编译产物输出到 `dist/`。

## 目录

```text
src/
  app.ts     # Express 应用及示例路由
  main.ts    # HTTP 服务启动入口
docs/        # 项目设计文档
```
