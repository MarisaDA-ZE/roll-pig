import type { RequestHandler } from 'express';
import type { Config } from '../config.js';
import { HttpError, sendError } from './errors.js';
import { recordQueueWait } from './logging.js';

interface WaitingRequest {
  start(): void;
  reject(error: HttpError): void;
}

export function createRequestGate({ maxConcurrency, maxQueueSize, queueTimeoutMs, requestTimeoutMs }:
  Pick<Config['limits'], 'maxConcurrency' | 'maxQueueSize' | 'queueTimeoutMs' | 'requestTimeoutMs'>) {
  let active = 0;
  let closing = false;
  const waiting = new Set<WaitingRequest>();

  function drain() {
    while (!closing && active < maxConcurrency && waiting.size) {
      const entry = waiting.values().next().value!;
      waiting.delete(entry);
      entry.start();
    }
  }

  const middleware: RequestHandler = (req, res, next) => {
    if (closing || (active >= maxConcurrency && waiting.size >= maxQueueSize)) {
      sendError(res, new HttpError(closing ? 'SHUTTING_DOWN' : 'QUEUE_FULL'), true);
      return;
    }
    const entered = performance.now();
    let running = false;
    let finished = false;
    let timer: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (waiting.delete(entry)) recordQueueWait(res, performance.now() - entered);
      if (running) active--;
      req.off('aborted', cleanup);
      res.off('finish', cleanup);
      res.off('close', cleanup);
      drain();
    };
    const entry: WaitingRequest = {
      start() {
        if (finished || req.destroyed || res.destroyed) { cleanup(); return; }
        clearTimeout(timer);
        recordQueueWait(res, performance.now() - entered);
        running = true;
        active++;
        // 名额覆盖请求体接收及整个响应传输，图片开始发送并不表示请求已经结束。
        timer = setTimeout(() => sendError(res, new HttpError('REQUEST_TIMEOUT'), true), requestTimeoutMs);
        timer.unref();
        next();
      },
      reject(error) {
        waiting.delete(entry);
        clearTimeout(timer);
        recordQueueWait(res, performance.now() - entered);
        sendError(res, error, true);
      },
    };
    req.once('aborted', cleanup);
    res.once('finish', cleanup);
    res.once('close', cleanup);
    if (active < maxConcurrency) entry.start();
    else {
      waiting.add(entry);
      timer = setTimeout(() => entry.reject(new HttpError('QUEUE_TIMEOUT')), queueTimeoutMs);
      timer.unref();
    }
  };

  return {
    middleware,
    close() {
      closing = true;
      for (const entry of waiting) entry.reject(new HttpError('SHUTTING_DOWN'));
    },
    get state() { return { active, queued: waiting.size, closing }; },
  };
}

export type RequestGate = ReturnType<typeof createRequestGate>;
