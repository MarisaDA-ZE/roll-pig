/** 原始素材和成品清单共用的猪猪标识与文案。 */
export interface PigDetails {
  /** 稳定的 ASCII 标识，用于清单排序和资源文件命名。 */
  readonly id: string;
  /** 卡片标题及 API 返回的显示名称。 */
  readonly name: string;
  /** 展示在原图下方的简短描述。 */
  readonly description: string;
  /** 展示在卡片底部的分析文案。 */
  readonly analysis: string;
}

/** 构建期使用的猪猪条目，引用 source 目录中的原图。 */
export interface SourcePig extends PigDetails {
  /** 原图文件名，格式为猪猪 ID 加上 png、webp 或 jpg 扩展名。 */
  readonly source: string;
}

/** 运行时使用的猪猪条目，引用带内容哈希的成品 PNG。 */
export interface Pig extends PigDetails {
  /** rendered 目录中的文件名，由 ID、12 位十六进制哈希和 png 扩展名组成。 */
  readonly asset: string;
}

/** 源数据清单；由加载器校验、按 ID 排序并冻结数组与条目。 */
export type SourceCatalog = readonly SourcePig[];
/** 运行清单；稳定的条目顺序参与每日抽取结果的计算。 */
export type Catalog = readonly Pig[];

/** 单次每日抽取的业务结果，日期与所选猪猪使用同一次时钟读数。 */
export interface RollResult {
  /** 按配置时区计算的业务日期，格式为 YYYY-MM-DD。 */
  readonly date: string;
  /** 运行清单中被选中的条目。 */
  readonly pig: Pig;
}
