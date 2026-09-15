# 小猪素材

每只小猪由名称、描述、分析文本和一张原图组成。构建时，原图与文字合成为 PNG 卡片，供 API 和静态图片接口使用。

## 目录结构

```text
resources/
├── pigs.json           # 小猪数据
├── source/             # 原图
├── fonts/              # 字体
├── asset-licenses.json # 素材来源与许可记录
└── rendered/
    ├── pigs.json       # 生成的图片清单
    └── <id>.<hash>.png # PNG 卡片
```

## 导入素材

资源包采用以下结构，`pig.json` 中的每条记录对应 `image/` 下的一张图片：

```text
resource/
├── pig.json
├── image/
│   └── pig.png
└── font/
    └── example.ttf
```

`pig.json` 示例：

```json
[
  {
    "id": "pig",
    "name": "猪",
    "description": "圆滚滚的小猪。",
    "analysis": "吃饱睡好，慢慢来。"
  }
]
```

在项目根目录导入并生成卡片：

```bash
pnpm resources:prepare <资源包目录>
pnpm resources:render
```

省略资源包目录时，导入命令读取 `temp/resource/`。图片复制到 `resources/source/`，字体复制到 `resources/fonts/`，数据写入 `resources/pigs.json`。

资源包中的图片以 `<id>.png` 命名，内容支持 PNG、WebP 和 JPEG；导入后的扩展名按实际格式确定。`font/` 至少包含一个 TTF 或 OTF 字体。同一资源包可以重复导入，与已有文件内容冲突时停止。

## 卡片生成

`pnpm resources:render` 将卡片和图片清单写入 `resources/rendered/`。`pnpm build` 包含相同的图片生成步骤。

默认字体为 `fonts/可爱字体.ttf`。该文件不存在时，使用按文件名排序的第一个 TTF 或 OTF 字体。指定资源目录及字体：

```bash
pnpm resources:render resources 可爱字体.ttf
```

字体需覆盖全部文案字符。卡片按名称、原图、描述、分析的顺序排版，文字自动换行并保留分段。

| 项目 | 规格 |
| --- | --- |
| 图片格式 | PNG |
| 卡片宽度 | 720 像素 |
| 卡片高度 | 随内容调整，最高 4096 像素 |
| 原图区域 | 384 × 384 像素，等比缩放 |
| 原图像素上限 | 3200 万 |
| 单个文本字段长度上限 | 4096 |

全部图片生成成功后更新清单，旧哈希图片保留在输出目录中。服务重启后加载新清单；Docker 部署通过重新构建镜像更新素材。

## 数据格式

### 源数据

`resources/pigs.json` 在资源包数据的基础上增加 `source` 字段：

| 字段 | 格式 |
| --- | --- |
| `id` | 唯一标识，1–64 个字符；小写字母或数字开头，可包含 `_` 和 `-`，不能使用 Windows 保留设备名 |
| `name` | 非空名称 |
| `description` | 非空描述 |
| `analysis` | 非空分析文本 |
| `source` | 原图文件名，如 `pig.png`；支持 `<id>.png`、`<id>.webp`、`<id>.jpg`，扩展名与内容格式一致 |

清单至少包含一条记录，加载时按 ID 的 ASCII 顺序排序。

### 图片清单

`rendered/pigs.json` 保留源数据中的文本，以 `asset` 替代 `source`：

```json
[
  {
    "id": "pig",
    "name": "猪",
    "description": "圆滚滚的小猪。",
    "analysis": "吃饱睡好，慢慢来。",
    "asset": "pig.0123456789ab.png"
  }
]
```

文件名中的 `hash` 为 PNG 内容 SHA-256 摘要的小写十六进制前 12 位。服务运行使用该清单及对应的 PNG 文件。

`source` 和 `asset` 只填写文件名。引用的文件及符号链接目标均须位于资源根目录内。

## 来源与许可

项目内置素材引用自 [MegSopern/astrbot_plugin_rollpig](https://github.com/MegSopern/astrbot_plugin_rollpig)。来源及版权说明见[第三方声明](../THIRD_PARTY_NOTICES.md)，文件版本及已核实的许可信息见 [asset-licenses.json](./asset-licenses.json)。
