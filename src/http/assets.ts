import { resolve } from 'node:path';
import express, { Router } from 'express';
import { resourceFile } from '../modules/rollpig/catalog.js';
import type { Catalog } from '../modules/rollpig/types.js';
import { HttpError } from './errors.js';

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
