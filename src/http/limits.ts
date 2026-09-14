import type { RequestHandler } from 'express';
import type { Config } from '../config.js';
import { HttpError, sendError } from './errors.js';

// 连接保护使用固定参数；并发、排队、处理超时及请求大小从配置读取。
export const transportDefaults = {
  maxHeaderCount: 100,
  headersTimeoutMs: 10_000,
  receiveTimeoutMs: 15_000,
  socketTimeoutMs: 10_000,
  keepAliveTimeoutMs: 5_000,
  shutdownTimeoutMs: 10_000,
  checkingIntervalMs: 1_000,
};
export type TransportLimits = typeof transportDefaults;

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
