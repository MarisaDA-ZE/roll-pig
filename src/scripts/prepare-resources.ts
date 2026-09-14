/**
 * 素材导入命令入口，将资源包中的猪猪数据、原图和字体整理到 resources。
 *
 * @remarks
 * 第一个位置参数为资源包目录，默认使用 temp/resource；输入需包含 pig.json、
 * image 和 font 目录。按图片文件头确定输出扩展名。
 * 写入前检查已有文件是否一致，只补充缺失文件或填充空清单；
 * 失败时输出错误并将进程退出码设为 1。
 *
 * @example
 * ```sh
 * pnpm resources:prepare temp/resource
 * ```
 */
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CatalogError, loadSourceCatalog, parseCatalogEntries, pigDetailsSchema, readSourceImage, resourceFile,
} from '../modules/rollpig/catalog.js';

try {
  const inputRoot = resolve(process.argv[2] ?? 'temp/resource');
  const outputRoot = resolve('resources');
  const raw: unknown = JSON.parse(readFileSync(resourceFile(inputRoot, 'pig.json'), 'utf8'));
  const pigs = parseCatalogEntries(pigDetailsSchema, raw);
  const sources = pigs.map((pig) => ({
    ...pig, source: `${pig.id}.${readSourceImage(inputRoot, 'image', `${pig.id}.png`).extension}`,
  }));
  const fonts = readdirSync(resolve(inputRoot, 'font'))
    .filter((name) => /\.(ttf|otf)$/i.test(name)).sort();
  if (!fonts.length) throw new CatalogError('INVALID_RESOURCE', 'No font files found.');
  for (const font of fonts) resourceFile(inputRoot, 'font', font);

  // 目标目录不能是符号链接，避免新文件写入资源目录之外。
  for (const directory of [outputRoot, ...['source', 'fonts', 'rendered'].map((name) => resolve(outputRoot, name))]) {
    const info = lstatSync(directory, { throwIfNoEntry: false });
    if (info && (info.isSymbolicLink() || !info.isDirectory())) {
      throw new CatalogError('INVALID_RESOURCE', 'Output must be a regular directory.');
    }
  }

  // 导入只补充文件或复用相同内容，不覆盖已有的本地修改。
  const outputs = [
    ...sources.map((pig) => ({ directory: 'source', name: pig.source, sourceDirectory: 'image', sourceName: `${pig.id}.png` })),
    ...fonts.map((name) => ({ directory: 'fonts', name, sourceDirectory: 'font', sourceName: name })),
  ];
  for (const output of outputs) {
    const target = resolve(outputRoot, output.directory, output.name);
    if (existsSync(target)) {
      const current = resourceFile(outputRoot, output.directory, output.name);
      if (!readFileSync(current).equals(readFileSync(resourceFile(inputRoot, output.sourceDirectory, output.sourceName)))) {
        throw new CatalogError('INVALID_RESOURCE', `Existing resource differs: ${output.name}.`);
      }
    }
  }
  const catalog = `${JSON.stringify(sources, null, 2)}\n`;
  const catalogExists = existsSync(resolve(outputRoot, 'pigs.json'));
  let fillEmptyCatalog = false;
  if (catalogExists) {
    const current = readFileSync(resourceFile(outputRoot, 'pigs.json'), 'utf8');
    const parsed: unknown = JSON.parse(current);
    fillEmptyCatalog = Array.isArray(parsed) && parsed.length === 0;
    if (current.replace(/\r\n/g, '\n') !== catalog && !fillEmptyCatalog) {
      throw new CatalogError('INVALID_CATALOG', 'Existing resources/pigs.json differs from the import.');
    }
  }
  for (const directory of ['source', 'fonts', 'rendered']) {
    mkdirSync(resolve(outputRoot, directory), { recursive: true });
  }
  for (const output of outputs) {
    if (!existsSync(resolve(outputRoot, output.directory, output.name))) {
      copyFileSync(resourceFile(inputRoot, output.sourceDirectory, output.sourceName), resolve(outputRoot, output.directory, output.name), constants.COPYFILE_EXCL);
    }
  }
  if (!catalogExists || fillEmptyCatalog) {
    writeFileSync(resolve(outputRoot, 'pigs.json'), catalog, { encoding: 'utf8', flag: catalogExists ? 'w' : 'wx' });
  }
  const imported = loadSourceCatalog(outputRoot);
  console.log(`Prepared ${imported.length} pigs and ${fonts.length} fonts.`);
} catch (error) {
  console.error(error instanceof CatalogError ? `${error.code}: ${error.message}` : 'Unable to prepare resources.');
  process.exitCode = 1;
}
