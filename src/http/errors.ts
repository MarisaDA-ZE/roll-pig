import type { ServerResponse } from 'node:http';
import type { ErrorRequestHandler } from 'express';
import { recordError } from './logging.js';

/** 面向客户端的固定错误码、HTTP 状态和说明，不包含内部异常原文。 */
const errors = {
  INVALID_NAMESPACE: { status: 400, message: 'Namespace must contain 1 to 32 letters, digits, underscores or hyphens.' },
  INVALID_USER_ID: { status: 400, message: 'User ID must contain 1 to 64 characters.' },
  INVALID_URL: { status: 400, message: 'Invalid URL encoding.' },
  INVALID_REQUEST: { status: 400, message: 'Invalid request.' },
  CATALOG_NOT_READY: { status: 503, message: 'Catalog is not ready.' },
  NOT_FOUND: { status: 404, message: 'Resource not found.' },
  PRECONDITION_FAILED: { status: 412, message: 'Request precondition failed.' },
  RANGE_NOT_SATISFIABLE: { status: 416, message: 'Requested range is not satisfiable.' },
  INTERNAL_ERROR: { status: 500, message: 'Internal server error.' },
  QUEUE_FULL: { status: 503, message: 'Server is busy.' },
  QUEUE_TIMEOUT: { status: 503, message: 'Request queue timed out.' },
  REQUEST_TIMEOUT: { status: 503, message: 'Request timed out.' },
  SHUTTING_DOWN: { status: 503, message: 'Server is shutting down.' },
  URL_TOO_LONG: { status: 414, message: 'Request URL is too long.' },
  HEADERS_TOO_LARGE: { status: 431, message: 'Request headers are too large.' },
  BODY_TOO_LARGE: { status: 413, message: 'Request body is too large.' },
  RECEIVE_TIMEOUT: { status: 408, message: 'Request reception timed out.' },
  EXPECTATION_FAILED: { status: 417, message: 'Unsupported request expectation.' },
} as const;

/** 可直接映射为 API 错误响应的公开错误。 */
export class HttpError extends Error {
  /** 与公开错误码对应的 HTTP 响应状态。 */
  readonly status: number;

  /**
   * 从固定映射中取得错误说明和 HTTP 状态。
   *
   * @param code - 允许向客户端返回的错误码，同时保存在实例中。
   */
  constructor(readonly code: keyof typeof errors) {
    super(errors[code].message);
    this.status = errors[code].status;
  }
}

/**
 * 将业务错误、URI 错误或中间件异常转换为公开错误。
 *
 * @param error - 捕获的任意异常。
 * @returns 已知错误的固定映射，或隐藏内部细节的 INTERNAL_ERROR。
 */
function publicError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof URIError) return new HttpError('INVALID_URL');
  // 静态文件中间件的错误只映射状态码，不向客户端传递文件路径或异常原文。
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  switch (status) {
    case 400: return new HttpError('INVALID_REQUEST');
    case 403:
    case 404: return new HttpError('NOT_FOUND');
    case 412: return new HttpError('PRECONDITION_FAILED');
    case 416: return new HttpError('RANGE_NOT_SATISFIABLE');
    default: return new HttpError('INTERNAL_ERROR');
  }
}

/**
 * 将公开错误编码为统一的 JSON 响应正文。
 *
 * @param error - 仅含公开错误码和固定说明的错误。
 * @returns 包含 error 对象的 JSON 字符串。
 */
export function errorBody(error: HttpError) {
  return JSON.stringify({ error: { code: error.code, message: error.message } });
}

/**
 * 记录错误并发送禁止缓存的 JSON 响应，必要时关闭连接。
 *
 * @remarks
 * 已完成传输的响应不再写入；已发送响应头或调用 end 但尚未传完时直接关闭套接字，
 * 避免将 JSON 追加到图片或同一连接上的其他响应中。
 * 所有 503 响应附带值为 2 的 Retry-After 响应头。
 *
 * @param res - Node HTTP 或 Express 的响应对象。
 * @param failure - 已转换为公开信息的错误。
 * @param closeConnection - 是否禁用连接复用，并在最多 1 秒后强制关闭慢连接；默认不启用。
 */
export function sendError(res: ServerResponse, failure: HttpError, closeConnection = false) {
  recordError(res, failure.code);
  if (res.destroyed || res.writableFinished) return;
  if (res.headersSent || res.writableEnded) {
    res.req.socket.destroy();
    return;
  }
  // 文件传输可能已经设置图片响应头；错误响应改用 JSON，并取消长期缓存。
  for (const header of ['Content-Type', 'Content-Length', 'ETag', 'Last-Modified', 'Accept-Ranges']) {
    res.removeHeader(header);
  }
  if (failure.status !== 416) res.removeHeader('Content-Range');
  const body = errorBody(failure);
  res.statusCode = failure.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.setHeader('Cache-Control', 'no-store');
  if (failure.status === 503) res.setHeader('Retry-After', '2');
  if (closeConnection) {
    res.setHeader('Connection', 'close');
    // 拒绝请求后不再接收请求体，给小型错误响应留出发送时间，再强制结束慢连接。
    const deadline = setTimeout(() => res.req.socket.destroy(), 1_000);
    deadline.unref();
    res.once('close', () => clearTimeout(deadline));
  }
  res.end(body);
}

/**
 * Express 最终错误处理中间件，将任意异常交给统一错误响应流程。
 *
 * @remarks
 * 必须在路由之后注册，并保留四个形参以便 Express 识别为错误中间件。
 *
 * @param error - 路由抛出或中间件传递的异常。
 * @param _req - 当前请求，由 Express 传入。
 * @param res - 用于返回错误或关闭传输的响应对象。
 * @param _next - Express 错误中间件签名要求的后续处理函数。
 */
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  sendError(res, publicError(error));
};
