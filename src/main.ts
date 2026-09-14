import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { CatalogError, loadCatalog } from './modules/rollpig/catalog.js';
import type { Catalog } from './modules/rollpig/types.js';

try {
  const config = loadConfig();
  let catalog: Catalog | undefined;
  try {
    catalog = loadCatalog();
  } catch (error) {
    if (!(error instanceof CatalogError) || error.code !== 'CATALOG_NOT_READY') throw error;
    console.warn('CATALOG_NOT_READY: Rendered resources are missing; health checks will return 503.');
  }
  const app = createApp(config, catalog);
  const { host, port } = config.server;
  app.listen(port, host, () => {
    console.log(`Rollpig listening on ${host}:${port}`);
  }).on('error', () => {
    console.error('Unable to listen on the configured server address.');
    process.exitCode = 1;
  });
} catch (error) {
  console.error(error instanceof ConfigError || error instanceof CatalogError ? error.message : 'Unable to start Rollpig.');
  process.exitCode = 1;
}
