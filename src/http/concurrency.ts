import type { RequestHandler } from 'express';
import type { Config } from '../config.js';
import { HttpError, sendError } from './errors.js';
import { recordQueueWait } from './logging.js';

/** 等待队列持有的请求操作，封装请求自身的计时与清理状态。 */
interface WaitingRequest {
  /** 获得活动名额后开始计时，并将请求交给后续中间件。 */
  start(): void;
  /**
   * 从等待队列移除请求并发送错误响应。
   *
   * @param error - 排队超时或服务退出等可公开的错误。
   */
  reject(error: HttpError): void;
}

/**
 * 创建供所有路由共用的并发控制器和 FIFO 有界等待队列。
 *
 * @remarks
 * 参数对象中的 maxConcurrency 限制活动请求数，maxQueueSize 限制等待数量且允许为 0。
 * queueTimeoutMs 和 requestTimeoutMs 分别限制等待及获得名额后的时间，单位为毫秒。
 * 参数应先通过配置校验；活动名额持续到响应传输完成或连接断开。
 * 超时后已开始发送的响应会关闭连接，未发送的响应使用统一 JSON 错误。
 *
 * @returns 包含准入中间件、停止准入方法和当前状态快照的控制器。
 */
export function createRequestGate({ maxConcurrency, maxQueueSize, queueTimeoutMs, requestTimeoutMs }:
  Pick<Config['limits'], 'maxConcurrency' | 'maxQueueSize' | 'queueTimeoutMs' | 'requestTimeoutMs'>) {
  let active = 0;
  let closing = false;
  const waiting = new Set<WaitingRequest>();

  /** 按进入顺序填满空闲名额；停止准入后不再启动等待请求。 */
  function drain() {
    while (!closing && active < maxConcurrency && waiting.size) {
      const entry = waiting.values().next().value!;
      waiting.delete(entry);
      entry.start();
    }
  }

  /** 为请求分配活动名额、加入等待队列，或立即返回过载及退出错误。 */
  const middleware: RequestHandler = (req, res, next) => {
    if (closing || (active >= maxConcurrency && waiting.size >= maxQueueSize)) {
      sendError(res, new HttpError(closing ? 'SHUTTING_DOWN' : 'QUEUE_FULL'), true);
      return;
    }
    const entered = performance.now();
    let running = false;
    let finished = false;
    let timer: NodeJS.Timeout | undefined;
    /** 只清理一次队列、名额、监听器和计时器，再唤醒后续等待请求。 */
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
    /** 停止接收请求并拒绝全部等待项，保留已活动请求直到完成；可重复调用。 */
    close() {
      closing = true;
      for (const entry of waiting) entry.reject(new HttpError('SHUTTING_DOWN'));
    },
    /** 当前活动数、等待数和停止准入状态的独立快照。 */
    get state() { return { active, queued: waiting.size, closing }; },
  };
}

/** HTTP 服务与 Express 应用共用的请求并发控制器。 */
export type RequestGate = ReturnType<typeof createRequestGate>;
