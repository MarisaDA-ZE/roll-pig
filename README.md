# Rollpig

基于 Node.js 24、TypeScript 和 Express 5 的每日小猪 HTTP API 项目。
当前已完成工程初始化与配置管理，抽取玩法及资源保护尚待实现。

## 本地开发

```bash
pnpm install
pnpm dev
```

默认监听 `0.0.0.0:3000`，可通过 `SERVER_HOST`、`SERVER_PORT` 环境变量覆盖。

## 配置

配置优先级从低到高为：内置默认值 → 当前工作目录的 `config.yaml` → 环境变量。
可以将 `config.example.yaml` 复制为 `config.yaml` 后修改；不提供配置文件也能启动，无需数据库或其他外围服务。
本地 `config.yaml` 已被 Git 忽略。

| 配置项 | 环境变量 | 默认值 |
| --- | --- | --- |
| `server.host` | `SERVER_HOST` | `0.0.0.0` |
| `server.port` | `SERVER_PORT` | `3000` |
| `server.trustProxy` | `SERVER_TRUST_PROXY` | `false` |
| `roll.timezone` | `ROLL_TIMEZONE` | `Asia/Shanghai` |
| `roll.secret` | `ROLL_SECRET` | `change-me` |
| `assets.baseUrl` | `ASSETS_BASE_URL` | 空字符串 |
| `limits.maxConcurrency` | `LIMITS_MAX_CONCURRENCY` | `64` |
| `limits.maxQueueSize` | `LIMITS_MAX_QUEUE_SIZE` | `128` |
| `limits.queueTimeoutMs` | `LIMITS_QUEUE_TIMEOUT_MS` | `3000` |
| `limits.requestTimeoutMs` | `LIMITS_REQUEST_TIMEOUT_MS` | `5000` |

配置规则：

- 配置文件可以只填写部分字段；未知字段、非法结构或 YAML 语法错误会阻止启动。字段值在环境变量覆盖后统一校验。
- YAML 中端口及资源限制使用整数，`trustProxy` 使用布尔值；环境变量中的布尔值仅接受 `true`、`false`，整数仅接受十进制数字字符串。
- 监听地址支持 IPv4、IPv6 或主机名；端口范围为 1–65535。默认不信任代理转发信息。
- 时区使用有效的命名时区，例如 `Asia/Shanghai` 或 `UTC`，不依赖宿主机时区。
- secret 不允许为空或全空白。使用默认值时启动日志输出警告，但不输出 secret 内容。生产环境应设置私有且稳定的 secret；其变化会影响后续实现的每日抽取映射。
- 资源 URL 前缀为空或 HTTP(S) URL，可包含路径前缀，不允许凭据、查询参数或 fragment，末尾斜杠会被移除。`ASSETS_BASE_URL` 设为空字符串可清除文件中的前缀。
- 并发上限至少为 1，队列长度可为 0；超时范围为 1–2147483647 毫秒。其他字段的空环境变量不会退回默认值，而会校验失败。

当前启动入口已应用监听地址、端口和代理配置。时区、secret、资源前缀和资源限制已可加载及校验，将由后续业务步骤使用；并发保护本身尚未实现。

## 当前接口

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
  config.ts  # 配置加载、覆盖与校验
  main.ts    # HTTP 服务启动入口
docs/        # 项目设计文档
```
