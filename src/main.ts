import { app } from './app.js';

const port = Number(process.env.SERVER_PORT ?? 3000);
const host = process.env.SERVER_HOST ?? '0.0.0.0';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('SERVER_PORT must be an integer between 1 and 65535.');
}

app.listen(port, host, () => {
  console.log(`Rollpig listening on http://${host}:${port}`);
});
