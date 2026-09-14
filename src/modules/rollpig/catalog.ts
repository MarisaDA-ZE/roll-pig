import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Catalog, SourceCatalog } from './types.js';

export class CatalogError extends Error {
  constructor(
    public readonly code: 'INVALID_CATALOG' | 'INVALID_RESOURCE' | 'CATALOG_NOT_READY',
    message: string,
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
  .refine((id) => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(id));
const textSchema = z.string().refine((value) => value.trim().length > 0);
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

function readJson(root: string, ...segments: string[]): unknown {
  const file = resourceFile(root, ...segments);
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    throw new CatalogError('INVALID_CATALOG', 'Unable to read valid catalog JSON.');
  }
}

export function readPng(root: string, directory: string, filename: string): Buffer {
  const file = resourceFile(root, directory, filename);
  const content = readFileSync(file);
  if (content.length <= 8 || !content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new CatalogError('INVALID_RESOURCE', `Invalid PNG file: ${filename}.`);
  }
  return content;
}

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

export function assetFilename(id: string, content: Uint8Array): string {
  if (!idSchema.safeParse(id).success) throw new CatalogError('INVALID_CATALOG', 'Invalid pig ID.');
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return `${id}.${hash}.png`;
}

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
