import { createHmac } from 'node:crypto';
import { CatalogError } from './catalog.js';
import type { Catalog, Pig } from './types.js';

/**
 * 通过业务日期和用户身份确定当天对应的猪猪。
 *
 * @remarks
 * 对 `date:namespace:userId` 的 UTF-8 字节计算 HMAC-SHA256，
 * 取摘要前 8 字节的大端无符号整数对清单长度取余。
 * 相同输入、密钥和清单顺序得到相同条目，不保存用户状态。
 * 调用方负责校验日期和身份；此函数保留大小写、空白和前导零。
 *
 * @param catalog - 非空且顺序稳定的运行清单。
 * @param input - 业务日期、命名空间和用户 ID。
 * @param secret - 多实例间保持一致的服务端 HMAC 密钥。
 * @returns 清单中被选中的原条目。
 * @throws {@link CatalogError}
 * 运行清单为空。
 */
export function selectPig(
  catalog: Catalog,
  input: {
    /** 已按业务时区计算的 YYYY-MM-DD 日期。 */
    readonly date: string;
    /** 用户来源的命名空间，用于隔离不同平台的相同用户 ID。 */
    readonly namespace: string;
    /** 命名空间内的用户标识，作为原始字符串参与计算。 */
    readonly userId: string
  },
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
