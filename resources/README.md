# 猪猪素材

`resources/` 存放猪猪数据、原图、字体和生成的 PNG 卡片。

```text
resources/
├── pigs.json           # 源数据
├── source/             # 原图
├── fonts/              # 字体
├── asset-licenses.json # 项目引用素材的许可记录
└── rendered/
    ├── pigs.json       # 成品清单
    └── <id>.<hash>.png # 成品图
```

## 导入素材

原始资源包使用以下结构：

```text
resource/
├── pig.json
├── image/
│   └── <id>.png
└── font/
    └── *.ttf / *.otf
```

`pig.json` 是包含 `id`、`name`、`description`、`analysis` 的 JSON 数组。图片文件名与 `id` 对应，`font/` 中至少放置一个 TTF 或 OTF 字体。

例如，以下数据对应 `image/pig.png`：

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

在项目根目录执行：

```bash
pnpm resources:prepare <资源包目录>
```

导入目录默认为 `temp/resource/`。图片复制到 `source/`，字体复制到 `fonts/`，数据整理为 `resources/pigs.json`。

原始图片以 `<id>.png` 命名，内容支持 PNG、WebP 和 JPEG，导入后的扩展名按实际格式确定。同一资源包可重复导入；与已有内容冲突时停止导入。

## 生成成品图

在项目根目录执行：

```bash
pnpm resources:render
```

生成结果写入 `resources/rendered/`，包括 PNG 图片和 `pigs.json` 成品清单。`pnpm build` 同时构建代码和图片。

可指定资源目录和该目录 `fonts/` 下的字体文件名：

```bash
pnpm resources:render resources 可爱字体.ttf
```

字体直接从 `fonts/` 读取，需覆盖文案中的全部字符。默认字体为 `可爱字体.ttf`；该文件不存在时，使用按文件名排序的第一个 TTF 或 OTF 字体。

卡片依次展示名称、原图、描述和分析，文字自动换行，支持分段。

| 项目 | 规格 |
| --- | --- |
| 成品格式 | PNG |
| 卡片宽度 | 720 像素 |
| 卡片高度 | 随内容调整，最高 4096 像素 |
| 原图展示区域 | 384 × 384 像素，等比缩放 |
| 原图像素上限 | 3200 万 |
| 单个文本字段长度上限 | 4096 |

成品清单对应最近一次成功构建，旧哈希图片保留在输出目录中。

## 源数据

`resources/pigs.json` 在原始数据的基础上增加 `source` 字段，指向 `source/` 下的原图。

| 字段 | 格式 |
| --- | --- |
| `id` | 唯一标识，1–64 个字符；小写字母或数字开头，可包含 `_` 和 `-`，不能使用 Windows 保留设备名 |
| `name` | 非空名称 |
| `description` | 非空描述 |
| `analysis` | 非空分析文本 |
| `source` | `<id>.png`、`<id>.webp` 或 `<id>.jpg`，扩展名与实际格式一致 |

清单至少包含一条记录，按 ID 的 ASCII 顺序加载。

## 成品清单

`rendered/pigs.json` 沿用源数据的文本字段，以 `asset` 替代 `source`：

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

成品文件名格式为 `<id>.<hash>.png`，`hash` 取 PNG 内容 SHA-256 摘要的小写十六进制前 12 位。

服务启动时加载成品清单及图片。部署资源为 `rendered/` 中的清单和对应 PNG，资源更新后重启服务生效。

`source` 和 `asset` 均填写文件名，引用文件及链接目标位于资源根目录内。

## 素材来源

素材来源与版权声明见[第三方声明](../THIRD_PARTY_NOTICES.md)。[asset-licenses.json](./asset-licenses.json) 记录项目引用素材的文件版本、来源链接和已核实的许可信息。
