import { resolve } from 'node:path';
import express from 'express';
import type { Config } from './config.js';
import { createAssetsRouter } from './http/assets.js';
import { createRequestGate, type RequestGate } from './http/concurrency.js';
import { errorHandler, HttpError } from './http/errors.js';
import { requestLimits, type TransportLimits } from './http/limits.js';
import { requestLogging, type LogSink } from './http/logging.js';
import { createDailyPigRouter } from './modules/rollpig/route.js';
import { createRollService } from './modules/rollpig/service.js';
import type { Catalog } from './modules/rollpig/types.js';

export function createApp(config: Config, catalog?: Catalog, options: {
  resourcesRoot?: string;
  now?: () => Date;
  gate?: RequestGate;
  log?: LogSink;
  transport?: TransportLimits;
} = {}) {
  const app = express();
  const service = catalog?.length ? createRollService(catalog, config.roll, options.now) : undefined;
  const resourcesRoot = options.resourcesRoot ?? resolve('resources');

  app.disable('x-powered-by');
  app.disable('etag');
  app.set('trust proxy', config.server.trustProxy);

  app.use(requestLogging(options.log));
  app.use((options.gate ?? createRequestGate(config.limits)).middleware);
  app.use(requestLimits(config.limits, options.transport));

  app.use('/assets/pigs', createAssetsRouter(resourcesRoot, catalog));
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/', (_req, res) => {
    res.json({ message: 'Hello, Rollpig!' });
  });

  app.get('/health', (_req, res) => {
    if (!service) throw new HttpError('CATALOG_NOT_READY');
    res.json({ status: 'ok' });
  });

  app.use('/api/v1/daily-pig', createDailyPigRouter(service, config.assets.baseUrl, resourcesRoot));
  app.use((_req, _res, next) => next(new HttpError('NOT_FOUND')));
  app.use(errorHandler);

  return app;
}
