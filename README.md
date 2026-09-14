# Rollpig

基于 Node.js 24、TypeScript 和 Express 5 的可自托管每日小猪 HTTP API 项目。

## 抽取规则

用户身份由 `namespace` 和 `userId` 组成，例如 `qq:123456`。业务日期按 `roll.timezone` 计算，每天午夜刷新。

抽取采用 HMAC-SHA256，由业务日期、用户身份、`secret` 和猪猪库共同决定。同一用户在同一业务日期的结果固定，跨日也可能重复。

多实例部署使用相同的时区、`secret` 和猪猪库。更新密钥或猪猪库可能改变抽取结果。

## 运行

需要 Node.js 24 和 pnpm 10。

```bash
pnpm install
pnpm build
pnpm start
```

构建命令编译代码并生成成品图，服务默认监听 `0.0.0.0:3000`。

开发模式使用 `pnpm dev`，支持文件修改后自动重启。类型检查使用 `pnpm typecheck`。

## 配置

将 [config.example.yaml](./config.example.yaml) 复制为工作目录下的 `config.yaml`，按需修改。未填写的配置使用默认值，环境变量优先于配置文件。

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

端口范围为 1–65535，时区填写 `Asia/Shanghai`、`UTC` 等命名时区。布尔环境变量使用 `true` 或 `false`，整数使用十进制数字。

`roll.secret` 是计算每日结果的服务端密钥。部署时设置为固定、非空的私有字符串。

`assets.baseUrl` 可留空，或填写不含凭据、查询参数和片段标识的 HTTP(S) 地址。环境变量设为空字符串时覆盖配置文件中的地址。

## 接口

| 请求 | 响应 |
| --- | --- |
| `GET /` | `{"message":"Hello, Rollpig!"}` |
| `GET /health` | 就绪时返回 `200 {"status":"ok"}`；资源未就绪时返回 `503`，错误码为 `CATALOG_NOT_READY` |

## 素材

内置数据、原图和字体位于 `resources/`。自定义素材按[资源包格式](./resources/README.md#导入素材)整理后导入并生成成品图：

```bash
pnpm resources:prepare <资源包目录>
pnpm resources:render
```

导入目录默认为 `temp/resource/`。成品输出到 `resources/rendered/`，资源更新后重启服务生效。

字体选择、卡片规格和清单格式见[素材说明](./resources/README.md)。

## 许可与致谢

本项目参考 [MegSopern/astrbot_plugin_rollpig](https://github.com/MegSopern/astrbot_plugin_rollpig)，猪猪数据及素材也引用自该项目。

代码采用 [MIT 许可](./LICENSE)。上游版权声明及许可全文见 [astrbot_plugin_rollpig-MIT.txt](./licenses/astrbot_plugin_rollpig-MIT.txt)。

图片和字体适用各自的许可，来源与版权声明见[第三方声明](./THIRD_PARTY_NOTICES.md)。
