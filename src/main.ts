/**
 * Rollpig 服务入口：加载配置与成品清单，监听 HTTP 请求并处理退出信号。
 *
 * @remarks
 * 缺失成品资源时仍启动服务并报告未就绪；配置错误或损坏的清单阻止启动。
 * 启动失败将进程退出码设为 1，SIGINT 和 SIGTERM 共用优雅退出流程。
 */
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
