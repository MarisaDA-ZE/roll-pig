import express from 'express';
import type { Config } from './config.js';
import type { Catalog } from './modules/rollpig/types.js';

export function createApp(config: Config, catalog?: Catalog) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.server.trustProxy);

  app.get('/', (_req, res) => {
    res.json({ message: 'Hello, Rollpig!' });
  });

  app.get('/health', (_req, res) => {
    if (!catalog?.length) {
      res.status(503).json({ error: { code: 'CATALOG_NOT_READY', message: 'Catalog is not ready.' } });
      return;
    }
    res.json({ status: 'ok' });
  });

  return app;
}
