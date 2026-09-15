# API 参考

Rollpig 通过 HTTP 提供每日小猪资料、PNG 卡片和静态图片。以下示例使用本地地址 `http://localhost:3000`。

| 请求 | 响应 |
| --- | --- |
| `GET /` | `{"message":"Hello, Rollpig!"}` |
| `GET /health` | 就绪时返回 `200 {"status":"ok"}`；资源未就绪时返回 `503`，错误码为 `CATALOG_NOT_READY` |
| `GET /api/v1/daily-pig?namespace=qq&userId=123456` | 用户当天的小猪资料与图片地址 |
| `GET /api/v1/daily-pig/image?namespace=qq&userId=123456` | 用户当天的小猪 PNG 卡片 |
| `GET /assets/pigs/<filename>` | 成品清单中的 PNG 图片 |

## 查询每日小猪

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

## 获取每日图片

图片接口与资料接口使用相同的身份参数：

```bash
curl "http://localhost:3000/api/v1/daily-pig/image?namespace=qq&userId=123456" -o daily-pig.png
```

响应体为 PNG，响应头包含 `Content-Type: image/png` 和 `Cache-Control: no-store`。参数或资源错误返回 [JSON 错误响应](#错误响应)。

JSON 和图片接口支持 GET、HEAD；HEAD 仅返回响应头。同一业务日期、身份和配置对应同一只猪。两次请求跨越午夜时，使用 JSON 中的 `pig.image` 可展示与该份结果对应的图片。

## 静态图片与 CDN

`/assets/pigs/<filename>` 返回固定的成品 PNG，使用 `Cache-Control: public, max-age=31536000, immutable`，支持 HEAD、条件请求和字节范围请求。

`assets.baseUrl` 决定 JSON 中的图片地址前缀：

| `assets.baseUrl` | `pig.image` |
| --- | --- |
| 空字符串 | `/assets/pigs/<filename>` |
| `https://static.example.com` | `https://static.example.com/assets/pigs/<filename>` |
| `https://static.example.com/rollpig/` | `https://static.example.com/rollpig/assets/pigs/<filename>` |

地址前缀中的路径予以保留，末尾斜线自动移除。本地 `/assets/pigs/` 可作为 CDN 回源地址；每日图片接口始终读取本地文件。

## 错误响应

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
| `408` | `RECEIVE_TIMEOUT` | 请求接收超时 |
| `412` | `PRECONDITION_FAILED` | 图片请求的前置条件不成立 |
| `413` | `BODY_TOO_LARGE` | 请求体超过大小限制 |
| `414` | `URL_TOO_LONG` | URL 超过长度限制 |
| `416` | `RANGE_NOT_SATISFIABLE` | 请求的字节范围超出图片大小 |
| `417` | `EXPECTATION_FAILED` | 不支持的 Expect 请求头 |
| `431` | `HEADERS_TOO_LARGE` | Header 大小或数量超过限制 |
| `503` | `CATALOG_NOT_READY` | 猪猪资源未就绪，或图片直出所需的成品缺失 |
| `503` | `QUEUE_FULL` | 活动名额和等待队列已满 |
| `503` | `QUEUE_TIMEOUT` | 排队超时 |
| `503` | `REQUEST_TIMEOUT` | 处理或响应传输超时 |
| `503` | `SHUTTING_DOWN` | 服务正在退出 |
| `500` | `INTERNAL_ERROR` | 服务内部错误 |

配置项及默认值见[配置与运行](./CONFIGURATION.md)。
