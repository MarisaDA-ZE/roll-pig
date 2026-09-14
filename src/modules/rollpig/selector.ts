import { createHmac } from 'node:crypto';
import { CatalogError } from './catalog.js';
import type { Catalog, Pig } from './types.js';

export function selectPig(
  catalog: Catalog,
  input: { readonly date: string; readonly namespace: string; readonly userId: string },
  secret: string,
): Pig {
  if (!catalog.length) throw new CatalogError('INVALID_CATALOG', 'Catalog must not be empty.');
  const { date, namespace, userId } = input;
  // 身份由调用方校验；保留原始字符串，包括 userId 的前导零和中文字符。
  const digest = createHmac('sha256', secret).update(`${date}:${namespace}:${userId}`, 'utf8').digest();
  // 先以 BigInt 取余，再转为数组索引，避免 64 位整数丢失精度。
  const index = Number(digest.readBigUInt64BE(0) % BigInt(catalog.length));
  return catalog[index]!;
}
