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
