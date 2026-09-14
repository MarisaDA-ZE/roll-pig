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

/**
 * 组装请求保护、每日小猪接口、静态图片和错误处理。
 *
 * @remarks
 * 所有路由共用请求日志与并发限制。清单缺失或为空时仍可创建应用，
 * 健康检查和每日小猪接口通过错误响应报告资源未就绪。
 * 此函数不监听端口；连接超时和优雅退出由 HTTP 服务负责。
 *
 * @param config - 已通过校验的完整运行配置。
 * @param catalog - 已校验资源文件的运行清单。
 * @param options - 资源目录、时钟和运行组件的注入选项。
 * @returns 已注册全部路由及中间件的 Express 应用。
 */
export function createApp(config: Config, catalog?: Catalog, options: {
  /** 资源根目录，默认使用工作目录下的 resources。 */
  resourcesRoot?: string;
  /** 抽取时使用的时钟，默认读取系统当前时间。 */
  now?: () => Date;
  /** 与 HTTP 服务共用的并发控制器；省略时按配置创建。 */
  gate?: RequestGate;
  /** 日志接收函数，默认逐行输出 JSON 到标准输出。 */
  log?: LogSink;
  /** 程序内注入的连接保护参数，省略时使用固定默认值。 */
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
