import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { RequestHandler } from 'express';

export type LogEntry = { event: string; [key: string]: string | number | boolean | null };
export type LogSink = (entry: LogEntry) => void;
export const writeLog: LogSink = (entry) => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry }));

interface RequestContext {
  queueWaitMs: number;
  errorCode: string | null;
}
const contexts = new WeakMap<ServerResponse, RequestContext>();

export function recordError(res: ServerResponse, code: string) {
  const context = contexts.get(res);
  if (context && !context.errorCode) context.errorCode = code;
}

export function recordQueueWait(res: ServerResponse, milliseconds: number) {
  const context = contexts.get(res);
  if (context) context.queueWaitMs = Math.round(milliseconds);
}

function publicPath(url: string) {
  const path = url.split('?')[0]!.replace(/\/$/, '').toLowerCase();
  if (path === '') return '/';
  if (['/health', '/api/v1/daily-pig', '/api/v1/daily-pig/image'].includes(path)) return path;
  if (path.startsWith('/assets/pigs/')) return '/assets/pigs/:filename';
  // 未知路径也可能含用户标识；日志只记录固定路由名称，不保留查询字符串。
  return '/[unknown]';
}

export function requestLogging(log: LogSink = writeLog): RequestHandler {
  return (req, res, next) => {
    const started = performance.now();
    const requestId = randomUUID();
    const path = publicPath(req.originalUrl);
    const method = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE'].includes(req.method)
      ? req.method : 'OTHER';
    const context: RequestContext = { queueWaitMs: 0, errorCode: null };
    contexts.set(res, context);
    res.setHeader('X-Request-Id', requestId);
    const completed = () => {
      res.off('finish', completed);
      res.off('close', completed);
      const duration = Math.round(performance.now() - started);
      // 等本次完成事件中的队列清理执行后，再记录最终的排队耗时。
      queueMicrotask(() => {
        contexts.delete(res);
        log({
          event: 'request', requestId, method, path,
          status: res.headersSent ? res.statusCode : 499,
          duration, queueWaitMs: context.queueWaitMs,
          errorCode: context.errorCode ?? (res.writableFinished ? null : 'CONNECTION_CLOSED'),
        });
      });
    };
    res.once('finish', completed);
    res.once('close', completed);
    next();
  };
}
