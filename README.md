# Rollpig

可自托管的每日小猪 API，为用户抽取当天的小猪，提供资料和 PNG 卡片。

传入平台或应用标识 `namespace` 和用户标识 `userId`，即可获取抽取结果。同一用户当天的结果保持一致，次日按配置时区重新计算。

- 内置 96 只小猪，支持替换图片、文案和字体。
- 提供 JSON 和图片接口，便于接入机器人或网页。
- 图片在构建时生成，静态地址支持长期缓存和 CDN。
- 使用 Node.js 运行，支持 Docker 部署，无需数据库或 Redis。

## 快速开始

### Docker

在项目根目录运行：

```bash
docker build -t rollpig:local .
docker run -d --name rollpig -p 3000:3000 rollpig:local
```

服务默认监听 `3000` 端口：

```bash
curl "http://localhost:3000/api/v1/daily-pig?namespace=qq&userId=123456"
```

项目也提供 [Compose 示例](./compose.yaml)，可使用 `docker compose up -d --build` 构建并启动。

### Node.js

运行环境：Node.js 24、pnpm 10。

```bash
pnpm install
pnpm build
pnpm start
```

`pnpm build` 编译代码并生成全部图片。默认服务地址为 `http://localhost:3000`。

## 接口用法

### 获取小猪资料

```http
GET /api/v1/daily-pig?namespace=qq&userId=123456
```

响应包含日期、小猪名称、描述、分析和图片地址：

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

### 获取小猪图片

```bash
curl "http://localhost:3000/api/v1/daily-pig/image?namespace=qq&userId=123456" -o daily-pig.png
```

图片接口返回当天的 PNG 卡片。资料中的 `pig.image` 则指向该张卡片的固定地址，适合保存和展示已有抽取结果。

参数格式、缓存规则、健康检查和错误码见 [API 参考](./API.md)。

## 配置

配置文件为项目根目录下的 `config.yaml`，可从 [config.example.yaml](./config.example.yaml) 复制。环境变量优先于配置文件，未配置的字段使用默认值。

常用配置：

```yaml
server:
  port: 3000

roll:
  timezone: Asia/Shanghai
  secret: replace-with-a-private-secret

assets:
  baseUrl: ""
```

- `roll.timezone`：每日抽取使用的时区，默认 `Asia/Shanghai`。
- `roll.secret`：抽取密钥，部署时设置为固定的私有字符串。
- `assets.baseUrl`：图片地址前缀，留空时使用本站路径；可设为 CDN 地址。

Docker 中的配置文件挂载位置为 `/app/config.yaml`。Compose 可通过 `ROLL_SECRET` 和 `ASSETS_BASE_URL` 环境变量配置密钥和图片前缀。完整配置、挂载示例及运行限制见[配置与运行](./CONFIGURATION.md)。

## 抽取规则

抽取采用 HMAC-SHA256，根据配置时区下的日期、`namespace`、`userId` 和密钥，在小猪库中确定结果。每日午夜重新计算，连续两天也可能抽到同一只小猪。

重启服务保留当天的抽取结果。多实例使用相同的时区、密钥和小猪库；修改密钥或小猪库可能改变结果。

## 自定义小猪

小猪的文案、原图和字体位于 `resources/`。资源包导入和图片生成命令：

```bash
pnpm resources:prepare <资源包目录>
pnpm resources:render
```

生成的图片及清单位于 `resources/rendered/`，重启服务后加载。Docker 部署通过重新构建镜像更新资源。

资源包结构、数据字段和字体设置见[素材说明](./resources/README.md)。

## 开发

项目使用 TypeScript 和 Express 5，图片由 sharp 与 fontkit 在构建阶段生成。

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动开发服务，文件修改后自动重启 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm build` | 编译代码并生成图片 |
| `pnpm start` | 运行构建后的服务 |

## 许可与致谢

项目参考 [MegSopern/astrbot_plugin_rollpig](https://github.com/MegSopern/astrbot_plugin_rollpig)，小猪数据、图片及字体引用自该项目。

代码采用 [MIT 许可](./LICENSE)。上游许可全文见 [astrbot_plugin_rollpig-MIT.txt](./licenses/astrbot_plugin_rollpig-MIT.txt)，素材来源及版权说明见[第三方声明](./THIRD_PARTY_NOTICES.md)。
