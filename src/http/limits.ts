import type { RequestHandler } from 'express';
import type { Config } from '../config.js';
import { HttpError, sendError } from './errors.js';

/** 固定的连接保护参数；并发、排队、处理超时及请求大小由配置控制。 */
export const transportDefaults = {
  /** 请求 Header 的最大数量。 */
  maxHeaderCount: 100,
  /** 接收完整 Header 的期限，单位为毫秒。 */
  headersTimeoutMs: 10_000,
  /** 接收完整请求的期限，包含 Header 和 Body，单位为毫秒。 */
  receiveTimeoutMs: 15_000,
  /** 连接没有数据传输时的最长等待时间，单位为毫秒。 */
  socketTimeoutMs: 10_000,
  /** 响应结束后等待同一连接上下一次请求的时间，单位为毫秒。 */
  keepAliveTimeoutMs: 5_000,
  /** 服务退出时等待活动连接结束的最长时间，单位为毫秒。 */
  shutdownTimeoutMs: 10_000,
  /** 检查 Header 及完整请求接收超时的间隔，单位为毫秒。 */
  checkingIntervalMs: 1_000,
};
/** 程序内使用的完整连接保护参数，不属于 YAML 配置结构。 */
export type TransportLimits = typeof transportDefaults;

/**
 * 创建检查请求大小和格式、按流读取并丢弃请求体的中间件。
 *
 * @remarks
 * 同时检查 Content-Length 声明值和实际接收字节数，不缓存或解压请求体。
 * 读取完成后才交给后续路由；请求格式错误或大小超限时发送错误并关闭连接。
 *
 * @param limits - 已校验的配置，使用其中的 URL、Header 和 Body 大小上限。
 * @param transport - Header 数量等连接保护参数，默认使用固定值。
 * @returns 应放在并发控制之后、业务路由之前的 Express 中间件。
 */
export function requestLimits(limits: Config['limits'], transport: TransportLimits = transportDefaults): RequestHandler {
  return (req, res, next) => {
    // 将 HTTP/1.1 的 Host 检查放到中间件中，统一返回 JSON 错误并记录请求日志。
    if (req.httpVersionMajor === 1 && req.httpVersionMinor === 1 && !req.headers.host) {
      sendError(res, new HttpError('INVALID_REQUEST'), true);
      return;
    }
    if (Buffer.byteLength(req.originalUrl) > limits.maxUrlBytes) {
      sendError(res, new HttpError('URL_TOO_LONG'), true);
      return;
    }
    const headerBytes = req.rawHeaders.reduce((bytes, part) => bytes + Buffer.byteLength(part) + 2, 0);
    if (req.rawHeaders.length / 2 > transport.maxHeaderCount || headerBytes > limits.maxHeaderBytes) {
      sendError(res, new HttpError('HEADERS_TOO_LARGE'), true);
      return;
    }
    if (Number(req.headers['content-length'] ?? 0) > limits.maxBodyBytes) {
      sendError(res, new HttpError('BODY_TOO_LARGE'), true);
      return;
    }
    if (req.headers.expect && req.headers.expect.toLowerCase() !== '100-continue') {
      sendError(res, new HttpError('EXPECTATION_FAILED'), true);
      return;
    }
    if (req.readableEnded) { next(); return; }
    let received = 0;
    const cleanup = () => {
      req.off('data', data);
      req.off('end', ended);
      req.off('aborted', cleanup);
      res.off('finish', cleanup);
      res.off('close', cleanup);
      req.pause();
    };
    const data = (chunk: Buffer) => {
      received += chunk.length;
      if (received > limits.maxBodyBytes) {
        cleanup();
        sendError(res, new HttpError('BODY_TOO_LARGE'), true);
      }
    };
    const ended = () => { cleanup(); next(); };
    // 接口不使用请求体，只计数并丢弃数据，不缓存或解压请求内容。
    req.on('data', data);
    req.once('end', ended);
    req.once('aborted', cleanup);
    res.once('finish', cleanup);
    res.once('close', cleanup);
    req.resume();
  };
}
