/**
 * 容器健康检查入口，按服务配置访问本机的健康接口。
 *
 * @remarks
 * 使用与服务相同的 YAML 和环境变量加载规则，支持自定义监听端口及 IPv6。
 * 只访问本地 HTTP 接口，不加载图片或访问 CDN；失败时以退出码 1 报告。
 */
import { isIP } from 'node:net';
import { loadConfig } from '../config.js';

try {
  const { host, port } = loadConfig({ warn: () => {} }).server;
  const address = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
  const hostname = isIP(address) === 6 ? `[${address}]` : address;
  const response = await fetch(`http://${hostname}:${port}/health`, {
    signal: AbortSignal.timeout(2_000),
    redirect: 'error',
  });
  if (!response.ok) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
