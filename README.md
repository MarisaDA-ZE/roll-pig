# Rollpig

基于 Node.js 24、TypeScript 和 Express 5 的可自托管每日小猪 HTTP API 项目。

## 抽取规则

使用 `namespace` 区分平台，以 `userId` 标识用户，例如 `qq:123456`。每日日期按 `roll.timezone` 计算，在该时区的午夜切换。

日期、用户身份和 `secret` 通过 HMAC-SHA256 确定猪猪结果。同一天使用相同配置和猪猪库，重复抽取、服务重启或切换实例都得到相同结果，无需保存用户记录。不同日期也可能抽到同一只猪。

更换 `secret` 或猪猪库可能改变结果，多实例部署应使用一致的配置和资源。

## 运行

需要 Node.js 24 和 pnpm 10。

```bash
pnpm install
pnpm build
pnpm start
```

默认监听 `0.0.0.0:3000`。开发时使用 `pnpm dev`，文件修改后会自动重启；`pnpm typecheck` 用于检查 TypeScript 类型。

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

端口范围为 1–65535，时区填写 `Asia/Shanghai`、`UTC` 等命名时区。布尔环境变量只接受 `true`、`false`，整数使用十进制数字。配置有误时，服务会报错并退出。

`secret` 用于服务端计算每日结果，无需由客户端提供，且不能为空。部署时请替换默认值；使用默认值会在启动时输出警告。

`assets.baseUrl` 可留空，或填写 HTTP(S) 地址，不能包含用户名、密码、查询参数或片段标识。设为空字符串可清除配置文件中的地址。

## 接口

| 请求 | 响应 |
| --- | --- |
| `GET /` | `{"message":"Hello, Rollpig!"}` |
| `GET /health` | 成品 catalog 加载成功时返回 `{"status":"ok"}`；缺少成品资源时返回 `503`，错误码为 `CATALOG_NOT_READY` |

## 素材

将猪猪数据、图片和字体按[素材说明](./resources/README.md)整理后导入：

```bash
pnpm resources:prepare <原始资源目录>
```

省略目录参数时读取 `temp/resource/`。导入会检查数据格式、重复 ID、文件及路径，并根据图片文件头确定扩展名。自定义素材的使用和分发权限由使用者确认。

服务读取 `resources/rendered/pigs.json` 和对应成品图，启动时检查文件及内容哈希。更新资源后需要重启。

## 许可与致谢

本项目参考 [MegSopern/astrbot_plugin_rollpig](https://github.com/MegSopern/astrbot_plugin_rollpig)，猪猪数据及素材也引用自该项目。

代码采用 [MIT 许可](./LICENSE)。上游版权声明及许可全文见 [astrbot_plugin_rollpig-MIT.txt](./licenses/astrbot_plugin_rollpig-MIT.txt)。

图片和字体遵循各自的许可，不能因为所在仓库采用 MIT 就直接使用。具体来源和授权记录见[第三方来源说明](./THIRD_PARTY_NOTICES.md)；授权未确认的素材不使用、不分发。
