import { resolve } from 'node:path';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { HttpError } from '../../http/errors.js';
import type { createRollService } from './service.js';

const namespaceSchema = z.string().min(1).max(32).refine((value) => !/[^A-Za-z0-9_-]/.test(value));
const userIdSchema = z.string().min(1).refine((value) => Array.from(value).length <= 64);

/**
 * 从原始请求 URL 中严格解析唯一的 namespace 和 userId 查询参数。
 *
 * @remarks
 * 拒绝非法编码、重复参数和数组或对象形式，保留身份中的大小写与前导零。
 * 其他查询参数不参与身份计算。
 *
 * @param url - 包含原始查询字符串的请求 URL。
 * @returns 已通过长度与格式校验的两个身份字段。
 * @throws URIError
 * 查询字符串包含非法百分号编码或 UTF-8 编码。
 * @throws {@link HttpError}
 * 身份参数缺失、重复或格式不符合要求。
 */
function parseIdentity(url: string) {
  const queryStart = url.indexOf('?');
  const query = queryStart === -1 ? '' : url.slice(queryStart + 1);
  // URLSearchParams 会容错替换非法编码，先严格检查，避免把不同输入合并成同一身份。
  decodeURIComponent(query);
  const params = new URLSearchParams(query);
  const keys = Array.from(params.keys());
  const singleValue = (name: string) => {
    const values = params.getAll(name);
    return values.length === 1 && !keys.some((key) => key.startsWith(`${name}[`)) ? values[0] : undefined;
  };
  const namespace = namespaceSchema.safeParse(singleValue('namespace'));
  if (!namespace.success) throw new HttpError('INVALID_NAMESPACE');
  const userId = userIdSchema.safeParse(singleValue('userId'));
  if (!userId.success) throw new HttpError('INVALID_USER_ID');
  return { namespace: namespace.data, userId: userId.data };
}

/**
 * 创建每日小猪的 JSON 查询和成品 PNG 直出路由。
 *
 * @remarks
 * 挂载到 `/api/v1/daily-pig`，两个路由共用身份解析和抽取服务。
 * 图片直出从本地读取成品；baseUrl 仅影响 JSON 中的图片地址。
 * 调用方应先设置 API 的 no-store 缓存策略，并在后方挂载统一错误处理中间件。
 *
 * @param service - 抽取服务；未提供时请求返回资源未就绪错误。
 * @param baseUrl - 静态图片的可选 HTTP(S) 地址前缀，可包含路径。
 * @param resourcesRoot - 包含 rendered 目录的本地资源根目录。
 * @returns 提供根路径 JSON 和 image 子路径 PNG 的 Express 路由。
 */
export function createDailyPigRouter(
  service: ReturnType<typeof createRollService> | undefined,
  baseUrl: string,
  resourcesRoot: string,
) {
  const router = Router();
  const imagePrefix = `${baseUrl.replace(/\/+$/, '')}/assets/pigs/`;
  const renderedRoot = resolve(resourcesRoot, 'rendered');

  /**
   * 校验请求身份并使用同一个服务入口执行抽取。
   *
   * @param req - 保留原始 URL 的 Express 请求。
   * @returns 用户当天的抽取结果。
   * @throws {@link HttpError}
   * 身份参数无效或抽取服务尚未就绪。
   * @throws URIError
   * 原始查询字符串无法严格解码。
   */
  function resultFor(req: Request) {
    const { namespace, userId } = parseIdentity(req.originalUrl);
    if (!service) throw new HttpError('CATALOG_NOT_READY');
    return service.roll(namespace, userId);
  }

  router.get('/', (req, res) => {
    const { date, pig } = resultFor(req);
    res.json({
      date,
      pig: {
        id: pig.id,
        name: pig.name,
        description: pig.description,
        analysis: pig.analysis,
        image: `${imagePrefix}${pig.asset}`,
      },
    });
  });

  router.get('/image', (req, res, next) => {
    const { pig } = resultFor(req);
    // 文件名来自已加载的 catalog；按用户查询的地址跨日可变，沿用 API 的 no-store。
    res.sendFile(pig.asset, {
      root: renderedRoot,
      dotfiles: 'deny',
      cacheControl: false,
      lastModified: false,
      acceptRanges: false,
    }, (error) => {
      if (!error || res.destroyed) return;
      const code = (error as NodeJS.ErrnoException).code;
      next(code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR'
        ? new HttpError('CATALOG_NOT_READY') : error);
    });
  });

  return router;
}
