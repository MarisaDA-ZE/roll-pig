import { resolve } from 'node:path';
import express, { Router } from 'express';
import { resourceFile } from '../modules/rollpig/catalog.js';
import type { Catalog } from '../modules/rollpig/types.js';
import { HttpError } from './errors.js';

/**
 * 创建仅开放运行清单中成品图片的静态资源路由。
 *
 * @remarks
 * 挂载到 `/assets/pigs`。创建时检查已登记文件的路径，响应使用一年的
 * immutable 缓存策略，并支持 HEAD、条件请求和字节范围请求。
 *
 * @param resourcesRoot - 包含 rendered 目录的资源根目录。
 * @param catalog - 已加载的运行清单；省略时不开放任何图片。
 * @returns 按文件名白名单提供成品 PNG 的 Express 路由。
 * @throws CatalogError
 * 已登记图片缺失或资源路径校验失败。
 */
export function createAssetsRouter(resourcesRoot: string, catalog?: Catalog) {
  const router = Router();
  const renderedRoot = resolve(resourcesRoot, 'rendered');
  const filenames = new Set(catalog?.map((pig) => pig.asset));
  for (const filename of filenames) resourceFile(renderedRoot, filename);

  router.get('/:filename', (req, _res, next) => {
    // 仅开放成品清单中的图片，清单、临时文件及任意路径不作为静态资源暴露。
    if (!filenames.has(req.params.filename)) throw new HttpError('NOT_FOUND');
    next();
  }, express.static(renderedRoot, {
    maxAge: '1y',
    immutable: true,
    dotfiles: 'deny',
    index: false,
    redirect: false,
    fallthrough: false,
  }));

  return router;
}
