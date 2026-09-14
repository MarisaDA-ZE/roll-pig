import type { ServerResponse } from 'node:http';
import type { ErrorRequestHandler } from 'express';
import { recordError } from './logging.js';

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

export class HttpError extends Error {
  readonly status: number;

  constructor(readonly code: keyof typeof errors) {
    super(errors[code].message);
    this.status = errors[code].status;
  }
}

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

export function errorBody(error: HttpError) {
  return JSON.stringify({ error: { code: error.code, message: error.message } });
}

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

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  sendError(res, publicError(error));
};
