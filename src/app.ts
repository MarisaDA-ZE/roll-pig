import express from 'express';
import type { Config } from './config.js';

export function createApp(config: Config) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.server.trustProxy);

  app.get('/', (_req, res) => {
    res.json({ message: 'Hello, Rollpig!' });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}
