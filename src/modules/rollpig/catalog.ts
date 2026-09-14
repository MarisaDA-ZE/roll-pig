import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Catalog, SourceCatalog } from './types.js';

/** 清单结构错误、资源无效或资源缺失时使用的分类错误。 */
export class CatalogError extends Error {
  /**
   * 创建资源错误，供启动流程、构建命令或 HTTP 层分别处理。
   *
   * @param code - 区分清单无效、资源无效和资源未就绪的错误码。
   * @param message - 供服务端诊断使用的说明，不应直接作为 HTTP 错误正文。
   */
  constructor(
    public readonly code: 'INVALID_CATALOG' | 'INVALID_RESOURCE' | 'CATALOG_NOT_READY',
    message: string,
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}

/** 可用于跨平台文件名的猪猪 ID，排除 Windows 保留设备名。 */
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
  .refine((id) => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(id));
const textSchema = z.string().refine((value) => value.trim().length > 0);
/** 猪猪基础字段的严格结构，文案保留原始空白但不允许全为空白。 */
export const pigDetailsSchema = z.strictObject({
  id: idSchema,
  name: textSchema,
  description: textSchema,
  analysis: textSchema,
});
const sourcePigSchema = pigDetailsSchema.extend({ source: z.string() })
  .refine((pig) => ['png', 'webp', 'jpg'].some((extension) => pig.source === `${pig.id}.${extension}`), { path: ['source'] });
const pigSchema = pigDetailsSchema.extend({ asset: z.string() })
  .refine((pig) => {
    const match = /^([a-z0-9][a-z0-9_-]{0,63})\.([a-f0-9]{12})\.png$/.exec(pig.asset);
    return match?.[1] === pig.id;
  }, { path: ['asset'] });

/**
 * 校验非空清单、拒绝重复 ID，并生成顺序稳定的只读条目数组。
 *
 * @remarks
 * 按 ID 的字符串顺序排序，不依赖系统语言。冻结数组及每个条目的第一层属性，
 * 不递归冻结自定义结构中的嵌套对象。
 *
 * @typeParam T - 含只读 ID 的清单条目类型。
 * @param schema - 单个条目的字段校验规则。
 * @param value - 从 JSON 读取的待校验清单。
 * @returns 按 ID 升序排列、数组与条目均已冻结的清单。
 * @throws {@link CatalogError}
 * 清单为空、条目不符合规则或存在重复 ID。
 */
export function parseCatalogEntries<T extends { readonly id: string }>(
  schema: z.ZodType<T>, value: unknown,
): readonly T[] {
  const result = z.array(schema).min(1).safeParse(value);
  if (!result.success) {
    const paths = result.error.issues.map((issue) => issue.path.join('.') || 'catalog');
    throw new CatalogError('INVALID_CATALOG', `Invalid catalog fields: ${paths.join(', ')}.`);
  }
  const ids = new Set<string>();
  for (const pig of result.data) {
    if (ids.has(pig.id)) throw new CatalogError('INVALID_CATALOG', `Duplicate pig ID: ${pig.id}.`);
    ids.add(pig.id);
  }
  // ID 只含 ASCII 字符，直接比较可避免系统语言和 JSON 排列影响抽取顺序。
  result.data.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return Object.freeze(result.data.map((pig) => Object.freeze(pig)));
}

/**
 * 解析资源文件的真实路径，并检查文件是否位于资源根目录内。
 *
 * @param root - 已存在的资源根目录。
 * @param segments - 依次拼接的单层目录名或文件名，不允许路径分隔符和父目录引用。
 * @returns 根目录内普通文件的绝对真实路径，已解析符号链接。
 * @throws {@link CatalogError}
 * 路径段非法、文件越界或不是普通文件时报告资源无效；文件缺失时报告未就绪。
 */
export function resourceFile(root: string, ...segments: string[]): string {
  // 仅接受单层文件名；同时检查真实路径，阻止符号链接越过资源根目录。
  if (segments.some((part) => !part || part === '.' || part === '..'
    || /[\\/:\x00-\x1f]/.test(part) || /[. ]$/.test(part))) {
    throw new CatalogError('INVALID_RESOURCE', 'Invalid resource path.');
  }
  try {
    const realRoot = realpathSync(root);
    const file = realpathSync(resolve(realRoot, ...segments));
    const localPath = relative(realRoot, file);
    if (!localPath || isAbsolute(localPath) || localPath === '..' || localPath.startsWith(`..${sep}`)) {
      throw new CatalogError('INVALID_RESOURCE', 'Resource points outside its root.');
    }
    if (!statSync(file).isFile()) throw new CatalogError('INVALID_RESOURCE', 'Resource must be a regular file.');
    return file;
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CatalogError('CATALOG_NOT_READY', 'Required catalog or resource file is missing.');
    }
    throw new CatalogError('INVALID_RESOURCE', 'Unable to access a resource file.');
  }
}

/**
 * 在资源路径检查通过后读取并解析 JSON。
 *
 * @param root - 资源根目录。
 * @param segments - 根目录下依次拼接的目录名和文件名。
 * @returns 尚未进行字段校验的 JSON 数据。
 * @throws {@link CatalogError}
 * 资源路径不可用，或文件无法读取为有效 JSON。
 */
function readJson(root: string, ...segments: string[]): unknown {
  const file = resourceFile(root, ...segments);
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    throw new CatalogError('INVALID_CATALOG', 'Unable to read valid catalog JSON.');
  }
}

/**
 * 读取资源文件并检查 PNG 签名。
 *
 * @remarks
 * 只检查文件头，不解码像素；完整图片解码由构建期渲染负责。
 *
 * @param root - 资源根目录。
 * @param directory - 根目录下的单层目录名。
 * @param filename - 目录中的单层文件名。
 * @returns 包含原始 PNG 文件内容的缓冲区。
 * @throws {@link CatalogError}
 * 资源路径不可用，或文件缺少有效 PNG 签名。
 */
export function readPng(root: string, directory: string, filename: string): Buffer {
  const file = resourceFile(root, directory, filename);
  const content = readFileSync(file);
  if (content.length <= 8 || !content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new CatalogError('INVALID_RESOURCE', `Invalid PNG file: ${filename}.`);
  }
  return content;
}

/**
 * 读取原图，并根据文件头识别 PNG、WebP 或 JPEG 格式。
 *
 * @remarks
 * 不依赖原文件扩展名，也不执行完整图片解码。
 *
 * @param root - 资源包或项目资源的根目录。
 * @param directory - 原图所在的单层目录名。
 * @param filename - 原图文件名。
 * @returns 原始文件内容及识别出的规范扩展名。
 * @throws {@link CatalogError}
 * 资源路径不可用，或文件头不属于支持的图片格式。
 */
export function readSourceImage(root: string, directory: string, filename: string) {
  const content = readFileSync(resourceFile(root, directory, filename));
  // 原始文件的后缀可能与实际格式不一致，导入时以文件头为准。
  if (content.length > 8 && content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return { content, extension: 'png' };
  }
  if (content.length > 12 && content.toString('ascii', 0, 4) === 'RIFF'
    && content.toString('ascii', 8, 12) === 'WEBP') {
    return { content, extension: 'webp' };
  }
  if (content.length > 3 && content.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) {
    return { content, extension: 'jpg' };
  }
  throw new CatalogError('INVALID_RESOURCE', `Unsupported source image: ${filename}.`);
}

/**
 * 根据猪猪 ID 与成品内容生成带哈希的 PNG 文件名。
 *
 * @param id - 符合清单规则的猪猪 ID。
 * @param content - 完整成品字节；调用方负责保证其为 PNG。
 * @returns 由 ID、SHA-256 前 12 位十六进制字符及 png 扩展名组成的文件名。
 * @throws {@link CatalogError}
 * 猪猪 ID 不符合命名规则。
 */
export function assetFilename(id: string, content: Uint8Array): string {
  if (!idSchema.safeParse(id).success) throw new CatalogError('INVALID_CATALOG', 'Invalid pig ID.');
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return `${id}.${hash}.png`;
}

/**
 * 加载源清单，并核对每张原图的文件头与扩展名。
 *
 * @param root - 含 pigs.json 和 source 目录的资源根目录，默认使用工作目录下的 resources。
 * @returns 已校验、按 ID 排序并冻结的源清单。
 * @throws {@link CatalogError}
 * 清单无效、资源缺失、路径非法或图片格式与文件名不一致。
 */
export function loadSourceCatalog(root = resolve('resources')): SourceCatalog {
  const pigs = parseCatalogEntries(sourcePigSchema, readJson(root, 'pigs.json'));
  for (const pig of pigs) {
    const { extension } = readSourceImage(root, 'source', pig.source);
    if (pig.source !== `${pig.id}.${extension}`) {
      throw new CatalogError('INVALID_RESOURCE', `Source image extension mismatch: ${pig.id}.`);
    }
  }
  return pigs;
}

/**
 * 加载运行清单，核对所有成品的 PNG 签名与内容哈希。
 *
 * @remarks
 * 仅读取 rendered 目录中的清单和图片，运行时无需原图、字体或渲染依赖。
 * 清单与全部成品通过检查后才返回结果。
 *
 * @param root - 资源根目录，默认使用工作目录下的 resources。
 * @returns 已校验、按 ID 排序并冻结的运行清单。
 * @throws {@link CatalogError}
 * 清单无效、成品缺失、资源路径非法、PNG 签名错误或内容哈希不一致。
 */
export function loadCatalog(root = resolve('resources')): Catalog {
  // 启动时检查全部成品，通过后才能对外宣告 ready；运行时不需要源图或字体。
  const pigs = parseCatalogEntries(pigSchema, readJson(root, 'rendered', 'pigs.json'));
  for (const pig of pigs) {
    const content = readPng(root, 'rendered', pig.asset);
    if (pig.asset !== assetFilename(pig.id, content)) {
      throw new CatalogError('INVALID_RESOURCE', `Asset content hash mismatch: ${pig.id}.`);
    }
  }
  return pigs;
}
