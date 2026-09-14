import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { RequestHandler } from 'express';

/** 结构化日志条目；附加字段限于 JSON 标量，不接收原始请求或异常对象。 */
export type LogEntry = {
  /** 日志事件名称，用于区分请求、启动、退出和配置告警。 */
  event: string;
  /** 事件附加字段；字段内容由调用方筛选后写入。 */
  [key: string]: string | number | boolean | null
};
/**
 * 接收结构化日志的同步函数。
 *
 * @param entry - 已整理好公开字段的日志条目，接收方应避免抛出异常。
 */
export type LogSink = (entry: LogEntry) => void;
/**
 * 添加 UTC 时间并将日志作为单行 JSON 写入标准输出。
 *
 * @param entry - 待输出的日志条目，不应包含查询身份、请求头或密钥。
 */
export const writeLog: LogSink = (entry) => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry }));

/** 请求完成前供并发控制和错误处理共同补充的日志字段。 */
interface RequestContext {
  /** 等待活动名额的耗时，单位为整数毫秒。 */
  queueWaitMs: number;
  /** 本次请求最先记录的错误码，无错误时为 null。 */
  errorCode: string | null;
}
const contexts = new WeakMap<ServerResponse, RequestContext>();

/**
 * 记录请求的首个错误，保留引起后续传输异常的原始原因。
 *
 * @param res - 已经过请求日志中间件的响应；没有上下文时不作记录。
 * @param code - 固定错误码，不应传入异常原文。
 */
export function recordError(res: ServerResponse, code: string) {
  const context = contexts.get(res);
  if (context && !context.errorCode) context.errorCode = code;
}

/**
 * 更新请求最终的排队耗时。
 *
 * @param res - 已经过请求日志中间件的响应；没有上下文时不作记录。
 * @param milliseconds - 从进入并发控制到获得名额或离开队列的毫秒数，记录时四舍五入。
 */
export function recordQueueWait(res: ServerResponse, milliseconds: number) {
  const context = contexts.get(res);
  if (context) context.queueWaitMs = Math.round(milliseconds);
}

/**
 * 将原始 URL 转换为不包含用户数据的固定日志路径。
 *
 * @param url - 可能包含查询参数或未知路径的原始 URL。
 * @returns 已知路由名、静态图片占位路径或未知路径占位符。
 */
function publicPath(url: string) {
  const path = url.split('?')[0]!.replace(/\/$/, '').toLowerCase();
  if (path === '') return '/';
  if (['/health', '/api/v1/daily-pig', '/api/v1/daily-pig/image'].includes(path)) return path;
  if (path.startsWith('/assets/pigs/')) return '/assets/pigs/:filename';
  // 未知路径也可能含用户标识；日志只记录固定路由名称，不保留查询字符串。
  return '/[unknown]';
}

/**
 * 为请求生成服务端 ID，并在响应完成或连接关闭时输出一次日志。
 *
 * @remarks
 * 应先于并发控制和请求校验注册，以记录被拒绝或排队的请求。
 * 日志使用固定路由名称，不记录查询参数和请求头内容；响应前断开记为 499。
 * 输出延后到本轮事件清理之后，使排队耗时和首个错误码能够完整写入。
 *
 * @param log - 日志接收函数，默认输出到标准输出。
 * @returns 设置 X-Request-Id 并跟踪请求生命周期的 Express 中间件。
 */
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
    /** 移除完成监听并安排单次日志输出，兼容正常结束与中途断开。 */
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
