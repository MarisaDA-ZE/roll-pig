# 配置与运行

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
| `limits.maxUrlBytes` | `LIMITS_MAX_URL_BYTES` | `2048` |
| `limits.maxHeaderBytes` | `LIMITS_MAX_HEADER_BYTES` | `16384` |
| `limits.maxBodyBytes` | `LIMITS_MAX_BODY_BYTES` | `16384` |

端口范围为 1–65535，时区填写 `Asia/Shanghai`、`UTC` 等命名时区。布尔环境变量使用 `true` 或 `false`，整数使用十进制数字。

`roll.secret` 是计算每日结果的服务端密钥。部署时设置为固定、非空的私有字符串。

`assets.baseUrl` 可留空，或填写不含凭据、查询参数和片段标识的 HTTP(S) 地址。环境变量设为空字符串时覆盖配置文件中的地址。

## 请求限制

`limits.maxConcurrency` 限制所有接口和静态图片的总并发请求数。超过上限的请求进入队列，按先入先出的顺序处理。队列最多容纳 `limits.maxQueueSize` 个请求，设为 `0` 时直接拒绝超出的请求。

`limits.queueTimeoutMs` 限制排队时间。请求开始处理后，`limits.requestTimeoutMs` 计时，覆盖请求体接收、业务处理和响应传输。图片传输期间仍计入并发数，请求结束或连接断开后扣除。

队列已满、排队超时或处理超时返回 `503`，附带 `Retry-After: 2`。已经开始发送响应时，超时会关闭连接。

`limits.maxUrlBytes`、`limits.maxHeaderBytes` 和 `limits.maxBodyBytes` 分别限制 URL 长度、Header 总大小和 Body 大小，单位为字节，取值为 1–2147483647 的整数。

HTTP 连接使用以下固定限制：

| 项目 | 限制 |
| --- | --- |
| Header 数量 | 100 个 |
| Header 接收期限 | 10 秒 |
| 完整请求接收期限 | 15 秒 |
| 连接无数据传输期限 | 10 秒 |
| Keep-alive 空闲期限 | 5 秒 |

接口通过查询参数接收身份信息，请求体仅在大小限制内读取并丢弃。

## Docker 配置

从源码构建和启动镜像：

```bash
docker build -t rollpig:local .
docker run -d --name rollpig --read-only --stop-timeout 15 -p 3000:3000 rollpig:local
```

Compose 的启动、日志和停止命令：

```bash
docker compose up -d --build
docker compose logs -f
docker compose down
```

运行时通过环境变量传入配置，例如使用终端中已设置的抽取密钥：

```bash
docker run -d --name rollpig --read-only --stop-timeout 15 -p 3000:3000 \
  --env ROLL_SECRET \
  --env ASSETS_BASE_URL=https://static.example.com \
  rollpig:local
```

Compose 示例从终端环境或 `.env` 读取 `ROLL_SECRET` 和 `ASSETS_BASE_URL`。其他参数可添加到服务的 `environment` 中，名称见[配置表](#配置)。

使用配置文件时，将准备好的 `config.yaml` 只读挂载到 `/app/config.yaml`：

```bash
docker run -d --name rollpig --read-only --stop-timeout 15 -p 3000:3000 \
  --mount type=bind,source="$(pwd)/config.yaml",target=/app/config.yaml,readonly \
  rollpig:local
```

环境变量仍优先于挂载文件。修改配置文件后重启容器生效。

镜像内置图片，以非 root 用户运行。Compose 默认使用只读文件系统，限制为 1 个 CPU 和 256 MiB 内存。

健康检查访问容器内的 `/health`，使用配置中的监听地址和端口。HTTP 请求超时为 2 秒，Docker 为检查进程设置的总时限为 10 秒。修改服务端口时，端口映射右侧的容器端口需同步调整。

## 日志与退出

日志以每行一个 JSON 对象写入标准输出。请求日志包含 `requestId`、`method`、`path`、`status`、`duration`、`queueWaitMs` 和 `errorCode`，耗时单位为毫秒。服务端生成的请求 ID 同时放在响应头 `X-Request-Id` 中。

`path` 使用固定路由名称，静态图片记为 `/assets/pigs/:filename`，未知路径记为 `/[unknown]`；查询参数和请求头内容不写入日志。连接在响应前断开时，日志状态记为 `499`；传输中断通过 `errorCode` 标识。

收到 `SIGINT` 或 `SIGTERM` 后，服务停止接收新连接，拒绝排队请求，并等待活动请求完成。等待 10 秒后关闭剩余连接并退出。

Compose 的停止宽限期为 15 秒。
