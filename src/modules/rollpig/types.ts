export interface PigDetails {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly analysis: string;
}

// 源数据引用原图，供构建期渲染使用。
export interface SourcePig extends PigDetails {
  readonly source: string;
}

// 运行时仅引用带内容哈希的成品图。
export interface Pig extends PigDetails {
  readonly asset: string;
}

export type SourceCatalog = readonly SourcePig[];
export type Catalog = readonly Pig[];
