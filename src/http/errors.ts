import type { ErrorRequestHandler } from 'express';

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

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const failure = publicError(error);
  // 文件传输可能已经设置图片响应头；错误响应改用 JSON，并取消长期缓存。
  for (const header of ['Content-Type', 'Content-Length', 'ETag', 'Last-Modified', 'Accept-Ranges']) {
    res.removeHeader(header);
  }
  if (failure.status !== 416) res.removeHeader('Content-Range');
  res.set('Cache-Control', 'no-store').status(failure.status).json({
    error: { code: failure.code, message: failure.message },
  });
};
