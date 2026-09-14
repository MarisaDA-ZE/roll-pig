/**
 * 成品渲染命令入口，生成图片和运行清单并输出生成数量。
 *
 * @remarks
 * 第一个位置参数为资源目录，默认使用 resources；第二个为可选字体文件名。
 * 失败时输出错误并将进程退出码设为 1。
 *
 * @example
 * ```sh
 * pnpm resources:render resources 可爱字体.ttf
 * ```
 */
import { resolve } from 'node:path';
import { CatalogError } from '../modules/rollpig/catalog.js';
import { renderResources } from '../render/build.js';

try {
  if (process.argv.length > 4) throw new Error('Usage: resources:render [resource-directory] [font-filename]');
  const root = resolve(process.argv[2] ?? 'resources');
  const catalog = await renderResources(root, process.argv[3]);
  console.log(`Rendered ${catalog.length} pig images.`);
} catch (error) {
  console.error(error instanceof CatalogError ? `${error.code}: ${error.message}`
    : error instanceof Error ? error.message : 'Unable to render resources.');
  process.exitCode = 1;
}
