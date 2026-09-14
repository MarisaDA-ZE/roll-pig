import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';

try {
  const config = loadConfig();
  const app = createApp(config);
  const { host, port } = config.server;
  app.listen(port, host, () => {
    console.log(`Rollpig listening on ${host}:${port}`);
  }).on('error', () => {
    console.error('Unable to listen on the configured server address.');
    process.exitCode = 1;
  });
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : 'Unable to start Rollpig.');
  process.exitCode = 1;
}
