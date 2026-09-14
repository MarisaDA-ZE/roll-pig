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
| `GET /api/v1/daily-pig?namespace=qq&userId=123456` | 用户当天的猪猪信息与图片地址 |
| `GET /api/v1/daily-pig/image?namespace=qq&userId=123456` | 用户当天的小猪成品 PNG |
| `GET /assets/pigs/<filename>` | 成品清单中的 PNG 图片 |

### 每日小猪

```bash
curl "http://localhost:3000/api/v1/daily-pig?namespace=qq&userId=123456"
```

| 参数 | 格式 |
| --- | --- |
| `namespace` | 必填，1–32 个字符，允许英文字母、数字、`_` 和 `-` |
| `userId` | 必填，1–64 个 Unicode 码点，作为字符串处理，保留前导零 |

`namespace` 和 `userId` 共同标识用户。两个查询参数各接受一个字符串值，身份区分大小写，特殊字符需进行 URL 编码。重复参数及数组、对象形式返回参数错误。日期由服务端按配置时区计算。

响应示例：

```json
{
  "date": "2026-09-15",
  "pig": {
    "id": "pig",
    "name": "猪",
    "description": "圆滚滚的小猪。",
    "analysis": "吃饱睡好，慢慢来。",
    "image": "/assets/pigs/pig.0123456789ab.png"
  }
}
```

每日小猪接口使用 `Cache-Control: no-store`。`pig.image` 指向同一只猪共享的静态图片，可直接用于图片展示。

### 成品图直出

使用相同的身份参数获取当天的成品图：

```bash
curl "http://localhost:3000/api/v1/daily-pig/image?namespace=qq&userId=123456" -o daily-pig.png
```

响应体为完整 PNG，使用 `Content-Type: image/png` 和 `Cache-Control: no-store`。接口地址可直接用于浏览器图片展示，或由客户端下载。参数或资源错误使用下文的 JSON 错误格式。

JSON 和图片接口支持 GET、HEAD；HEAD 仅返回响应头。同一业务日期、身份和配置对应同一只猪。两次请求跨越午夜时，使用 JSON 中的 `pig.image` 可展示与该份结果对应的图片。

### 静态图片与 CDN

`/assets/pigs/<filename>` 返回固定的成品 PNG，使用 `Cache-Control: public, max-age=31536000, immutable`，支持 HEAD、条件请求和字节范围请求。

`assets.baseUrl` 为空时，图片地址为 `/assets/pigs/<filename>`。填写 `https://static.example.com` 后，地址为 `https://static.example.com/assets/pigs/<filename>`；填写 `https://static.example.com/rollpig/` 时，地址为 `https://static.example.com/rollpig/assets/pigs/<filename>`。

CDN 前缀保留其中的路径，末尾斜线自动移除。本地 `/assets/pigs/` 同时提供图片，可作为 CDN 回源地址。`assets.baseUrl` 作用于 JSON 中的 `pig.image`，成品图直出接口从本地资源读取图片。

### 错误响应

错误响应使用 JSON 和 `Cache-Control: no-store`：

```json
{
  "error": {
    "code": "INVALID_NAMESPACE",
    "message": "Namespace must contain 1 to 32 letters, digits, underscores or hyphens."
  }
}
```

| HTTP 状态 | 错误码 | 含义 |
| --- | --- | --- |
| `400` | `INVALID_NAMESPACE` / `INVALID_USER_ID` | 身份参数不符合格式要求 |
| `400` | `INVALID_URL` / `INVALID_REQUEST` | URL 编码或请求格式错误 |
| `404` | `NOT_FOUND` | 路由或图片不存在 |
| `412` | `PRECONDITION_FAILED` | 图片请求的前置条件不成立 |
| `416` | `RANGE_NOT_SATISFIABLE` | 请求的字节范围超出图片大小 |
| `503` | `CATALOG_NOT_READY` | 猪猪资源未就绪，或图片直出所需的成品缺失 |
| `500` | `INTERNAL_ERROR` | 服务内部错误 |

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
