import { resolve } from 'node:path';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { HttpError } from '../../http/errors.js';
import type { createRollService } from './service.js';

const namespaceSchema = z.string().min(1).max(32).refine((value) => !/[^A-Za-z0-9_-]/.test(value));
const userIdSchema = z.string().min(1).refine((value) => Array.from(value).length <= 64);

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

export function createDailyPigRouter(
  service: ReturnType<typeof createRollService> | undefined,
  baseUrl: string,
  resourcesRoot: string,
) {
  const router = Router();
  const imagePrefix = `${baseUrl.replace(/\/+$/, '')}/assets/pigs/`;
  const renderedRoot = resolve(resourcesRoot, 'rendered');

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
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const code = (error as NodeJS.ErrnoException).code;
      next(code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR'
        ? new HttpError('CATALOG_NOT_READY') : error);
    });
  });

  return router;
}
