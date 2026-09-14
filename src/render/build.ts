import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openSync, type Font } from 'fontkit';
import { CatalogError, assetFilename, loadCatalog, loadSourceCatalog, resourceFile } from '../modules/rollpig/catalog.js';
import type { Catalog, Pig } from '../modules/rollpig/types.js';
import { renderCard } from './card.js';

/**
 * 从资源目录加载单个 TTF 或 OTF 字体。
 *
 * @param root - 包含 fonts 目录的资源根目录。
 * @param requested - 指定的字体文件名；省略时优先使用可爱字体.ttf，否则使用排序后的首个字体。
 * @returns 已由 fontkit 解析、可用于测量与绘制字形的字体。
 * @throws {@link CatalogError}
 * 无可用字体、资源路径非法、字体解析失败或文件属于字体集合。
 */
function loadFont(root: string, requested?: string): Font {
  const names = readdirSync(resolve(root, 'fonts')).filter((name) => /\.(ttf|otf)$/i.test(name)).sort();
  const name = requested ?? (names.includes('可爱字体.ttf') ? '可爱字体.ttf' : names[0]);
  if (!name) throw new CatalogError('INVALID_RESOURCE', 'No font files found.');
  const path = resourceFile(root, 'fonts', name);
  try {
    const font = openSync(path);
    if ('fonts' in font) throw new Error('Font collections are not supported.');
    return font;
  } catch {
    throw new CatalogError('INVALID_RESOURCE', `Unable to load font: ${name}.`);
  }
}

/**
 * 通过同目录临时文件替换成品，内容一致时跳过写入。
 *
 * @remarks
 * 调用方应先确认输出目录有效。已有目标必须为普通文件，
 * 单个文件替换完成前保持原文件内容，退出写入流程时清理临时文件。
 *
 * @param root - 包含 rendered 输出目录的资源根目录。
 * @param name - 由调用方保证安全的单层目标文件名。
 * @param content - 成品 PNG 字节或清单文本。
 * @throws {@link CatalogError}
 * 已有目标为符号链接、不是普通文件或无法通过资源路径检查。
 */
function writeArtifact(root: string, name: string, content: Buffer | string) {
  const target = resolve(root, 'rendered', name);
  const info = lstatSync(target, { throwIfNoEntry: false });
  if (info) {
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new CatalogError('INVALID_RESOURCE', 'Output must be a regular file.');
    }
    if (readFileSync(resourceFile(root, 'rendered', name)).equals(Buffer.from(content))) return;
  }
  // 先写同目录临时文件，再替换目标，避免留下半张图片或半份清单。
  const temporary = resolve(root, 'rendered', `.${name}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { flag: 'wx' });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * 根据源清单逐张渲染成品 PNG，并在全部图片成功后更新运行清单。
 *
 * @remarks
 * 单张生成用于限制峰值内存。每个文件通过临时文件替换，已有相同内容不重写，
 * 旧哈希图片继续保留。中途失败不会撤回本次已完成的图片；
 * 新清单只在所有图片生成并写入成功后发布。
 *
 * @param root - 包含源清单、source 和 fonts 目录的资源根目录，默认使用工作目录下的 resources。
 * @param fontName - 可选的单层字体文件名，省略时按内置优先顺序选择。
 * @returns 重新读取并验证过成品签名与哈希的运行清单。
 * @throws {@link CatalogError}
 * 输出路径、清单、原图或字体无效，或图片与文案无法完成渲染。
 */
export async function renderResources(root = resolve('resources'), fontName?: string): Promise<Catalog> {
  root = resolve(root);
  for (const directory of [root, resolve(root, 'rendered')]) {
    const info = lstatSync(directory, { throwIfNoEntry: false });
    if (info && (info.isSymbolicLink() || !info.isDirectory())) {
      throw new CatalogError('INVALID_RESOURCE', 'Output must be a regular directory.');
    }
  }
  const sources = loadSourceCatalog(root);
  const font = loadFont(root, fontName);
  mkdirSync(resolve(root, 'rendered'), { recursive: true });
  const catalog: Pig[] = [];
  // 逐张生成以限制峰值内存；全部成功后再更新清单，旧哈希图片继续保留。
  for (const { source, ...pig } of sources) {
    let image: Buffer;
    try {
      image = await renderCard(pig, readFileSync(resourceFile(root, 'source', source)), font);
    } catch (error) {
      throw new CatalogError('INVALID_RESOURCE', `Unable to render ${pig.id}: ${error instanceof Error ? error.message : 'Unknown rendering error.'}`);
    }
    const asset = assetFilename(pig.id, image);
    writeArtifact(root, asset, image);
    catalog.push({ ...pig, asset });
  }
  writeArtifact(root, 'pigs.json', `${JSON.stringify(catalog, null, 2)}\n`);
  return loadCatalog(root);
}
