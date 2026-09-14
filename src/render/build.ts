import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openSync, type Font } from 'fontkit';
import { CatalogError, assetFilename, loadCatalog, loadSourceCatalog, resourceFile } from '../modules/rollpig/catalog.js';
import type { Catalog, Pig } from '../modules/rollpig/types.js';
import { renderCard } from './card.js';

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
