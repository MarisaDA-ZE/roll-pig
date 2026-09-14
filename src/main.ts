import { ConfigError, loadConfig } from './config.js';
import { createHttpService } from './http/server.js';
import { writeLog } from './http/logging.js';
import { CatalogError, loadCatalog } from './modules/rollpig/catalog.js';
import type { Catalog } from './modules/rollpig/types.js';

try {
  const config = loadConfig({ warn: (message) => writeLog({ event: 'config.warning', message }) });
  let catalog: Catalog | undefined;
  try {
    catalog = loadCatalog();
  } catch (error) {
    if (!(error instanceof CatalogError) || error.code !== 'CATALOG_NOT_READY') throw error;
    writeLog({ event: 'catalog.unavailable', errorCode: 'CATALOG_NOT_READY' });
  }
  const { server, shutdown } = createHttpService(config, catalog);
  const stop = () => { void shutdown(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  server.once('close', () => {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  });
  const { host, port } = config.server;
  server.listen(port, host, () => {
    writeLog({ event: 'server.listening', host, port });
  }).on('error', () => {
    writeLog({ event: 'server.error', message: 'Unable to listen on the configured server address.' });
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    process.exitCode = 1;
  });
} catch (error) {
  writeLog({ event: 'startup.error', message: error instanceof ConfigError || error instanceof CatalogError
    ? error.message : 'Unable to start Rollpig.' });
  process.exitCode = 1;
}
