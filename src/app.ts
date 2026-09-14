import express from 'express';

export const app = express();

app.disable('x-powered-by');

app.get('/', (_req, res) => {
  res.json({ message: 'Hello, Rollpig!' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
