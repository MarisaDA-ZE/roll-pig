import { randomUUID } from 'node:crypto';
import { createServer, STATUS_CODES, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { createApp } from '../app.js';
import type { Config } from '../config.js';
import type { Catalog } from '../modules/rollpig/types.js';
import { createRequestGate } from './concurrency.js';
import { errorBody, HttpError, sendError } from './errors.js';
import { transportDefaults, type TransportLimits } from './limits.js';
import { recordError, writeLog, type LogSink } from './logging.js';

/**
 * 创建具有连接保护、请求调度和优雅退出能力的 HTTP 服务。
 *
 * @remarks
 * 返回的服务尚未监听端口，由调用方执行 listen 并绑定进程信号。
 * HTTP 解析阶段的错误也使用固定错误信息；已有响应传输时直接关闭异常连接。
 *
 * @param config - 已通过校验的完整运行配置。
 * @param catalog - 已校验资源文件的运行清单，缺省时由接口报告未就绪。
 * @param options - 资源目录、时钟、日志和连接参数的注入选项。
 * @returns HTTP server、可重复调用的 shutdown 方法及共用的请求并发控制器。
 */
export function createHttpService(config: Config, catalog?: Catalog, options: {
  /** 资源根目录，默认使用工作目录下的 resources。 */
  resourcesRoot?: string;
  /** 抽取服务的时钟，默认读取系统时间。 */
  now?: () => Date;
  /** 请求和服务生命周期日志的接收函数，默认输出到标准输出。 */
  log?: LogSink;
  /** 程序内覆盖固定连接参数，主要用于测试；接收超时应保持 Header 不大于完整请求。 */
  transport?: Partial<TransportLimits>;
} = {}) {
  const log = options.log ?? writeLog;
  const transport = { ...transportDefaults, ...options.transport };
  const gate = createRequestGate(config.limits);
  const app = createApp(config, catalog, { ...options, transport, gate, log });
  const sockets = new Set<Socket>();
  // 同一连接可能存在多个流水线响应，需要逐一跟踪尚未传输完成的响应。
  const responses = new Map<Socket, Set<ServerResponse>>();
  const invalidSockets = new WeakSet<Socket>();
  const server = createServer({
    maxHeaderSize: config.limits.maxHeaderBytes,
    headersTimeout: transport.headersTimeoutMs,
    requestTimeout: transport.receiveTimeoutMs,
    connectionsCheckingInterval: transport.checkingIntervalMs,
    keepAliveTimeout: transport.keepAliveTimeoutMs,
    highWaterMark: 16_384,
    requireHostHeader: false,
  }, (req, res) => {
    const pending = responses.get(req.socket)!;
    pending.add(res);
    const completed = () => {
      pending.delete(res);
      res.off('finish', completed);
      res.off('close', completed);
    };
    res.once('finish', completed);
    res.once('close', completed);
    app(req, res);
  });
  // 保留完整 Header 后统一校验数量，避免截掉 Host；解析器仍限制总字节数。
  server.maxHeadersCount = 0;
  server.keepAliveTimeoutBuffer = 0;
  server.setTimeout(transport.socketTimeoutMs, (socket) => {
    for (const res of responses.get(socket) ?? []) recordError(res, 'RECEIVE_TIMEOUT');
    socket.destroy();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    responses.set(socket, new Set());
    socket.once('close', () => { sockets.delete(socket); responses.delete(socket); });
  });
  server.on('checkExpectation', (req, res) => { server.emit('request', req, res); });
  server.on('clientError', (error: NodeJS.ErrnoException, socket: Socket) => {
    if (socket.destroyed) return;
    if (invalidSockets.has(socket)) { socket.destroy(); return; }
    invalidSockets.add(socket);
    const failure = new HttpError(error.code === 'HPE_HEADER_OVERFLOW' ? 'HEADERS_TOO_LARGE'
      : error.code === 'ERR_HTTP_REQUEST_TIMEOUT' ? 'RECEIVE_TIMEOUT' : 'INVALID_REQUEST');
    const pending = responses.get(socket);
    const current = pending?.size === 1 ? pending.values().next().value : undefined;
    if (current && !current.headersSent && !current.req.complete) {
      sendError(current, failure, true);
      return;
    }
    // 已有响应时不能往同一字节流追加一份原始 HTTP 错误，直接关闭异常连接。
    if (pending?.size) {
      for (const res of pending) recordError(res, failure.code);
      socket.destroy();
      return;
    }
    const requestId = randomUUID();
    log({ event: 'client_error', requestId, method: 'UNKNOWN', path: '/[invalid]', status: failure.status,
      duration: 0, queueWaitMs: 0, errorCode: failure.code });
    const body = errorBody(failure);
    if (socket.writable) socket.end(
      `HTTP/1.1 ${failure.status} ${STATUS_CODES[failure.status]}\r\nConnection: close\r\n`
      + `Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nX-Request-Id: ${requestId}\r\n`
      + `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
    const deadline = setTimeout(() => socket.destroy(), 1_000);
    deadline.unref();
    socket.once('close', () => clearTimeout(deadline));
  });

  let stopping: Promise<void> | undefined;
  /**
   * 停止准入并等待活动连接结束，超过退出期限后强制关闭剩余连接。
   *
   * @returns 在服务关闭回调触发时完成的 Promise；重复调用返回同一个 Promise。
   */
  function shutdown(): Promise<void> {
    if (stopping) return stopping;
    stopping = new Promise<void>((done) => {
      gate.close();
      log({ event: 'server.stopping' });
      const deadline = setTimeout(() => {
        log({ event: 'server.shutdown_timeout' });
        for (const pending of responses.values()) for (const res of pending) recordError(res, 'SHUTTING_DOWN');
        for (const socket of sockets) socket.destroy();
      }, transport.shutdownTimeoutMs);
      deadline.unref();
      server.close(() => {
        clearTimeout(deadline);
        log({ event: 'server.stopped' });
        done();
      });
    });
    return stopping;
  }

  return { server, shutdown, gate };
}
