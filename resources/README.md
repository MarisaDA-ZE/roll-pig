# 猪猪素材

`resources/` 存放猪猪数据、原图、字体和成品图。源数据用于整理素材，服务运行时读取成品清单及对应图片。

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

## 导入

原始资源包使用以下结构：

```text
resource/
├── pig.json
├── image/
│   └── <id>.png
└── font/
    └── *.ttf / *.otf
```

`pig.json` 是包含 `id`、`name`、`description`、`analysis` 的 JSON 数组，图片文件名与 `id` 对应。

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
pnpm resources:prepare <原始资源目录>
```

省略参数时读取 `temp/resource/`。导入命令按文件头识别 PNG、WebP、JPEG，将图片和字体复制到对应目录，并生成 `resources/pigs.json`。相同文件可重复导入；与已有内容冲突时停止，保留已有文件。

导入会检查数据字段、重复 ID、文件存在性和路径安全，`font/` 中至少需要一个 `.ttf` 或 `.otf` 文件。自定义素材的使用和分发权限由使用者确认。

## 源数据

`pigs.json` 中的每条记录描述一只猪，`source` 指向 `source/` 下的原图：

```json
[
  {
    "id": "pig",
    "name": "猪",
    "description": "圆滚滚的小猪。",
    "analysis": "吃饱睡好，慢慢来。",
    "source": "pig.png"
  }
]
```

| 字段 | 格式 |
| --- | --- |
| `id` | 唯一标识，1–64 个字符；小写字母或数字开头，可包含 `_` 和 `-`，不能使用 Windows 保留设备名 |
| `name` | 非空名称 |
| `description` | 非空描述 |
| `analysis` | 非空分析文本 |
| `source` | `<id>.png`、`<id>.webp` 或 `<id>.jpg`，扩展名与实际格式一致 |

清单至少包含一条记录。加载顺序按 ID 的 ASCII 顺序排列，与 JSON 中的条目顺序无关。

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

文件名中的 `0123456789ab` 为示例，实际取 PNG 文件 SHA-256 摘要的小写十六进制前 12 位。

服务启动时检查清单和每张成品图，包括文件存在性、PNG 文件头及内容哈希。成品缺失时健康检查返回 `503 CATALOG_NOT_READY`；清单或文件内容不合法时启动失败。资源更新后需重启服务。

图片引用使用文件名，不接受路径或远程 URL；文件及符号链接的目标必须位于资源根目录内。

## 许可清单

[asset-licenses.json](./asset-licenses.json) 记录本项目引用素材中已确认的来源、文件版本和许可信息，不参与导入校验；导入自己的素材无需填写该文件。版权声明及许可文本见[第三方声明](../THIRD_PARTY_NOTICES.md)。
