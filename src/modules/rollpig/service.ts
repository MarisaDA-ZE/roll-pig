import type { Config } from '../../config.js';
import { CatalogError } from './catalog.js';
import { createBusinessDateFormatter } from './date.js';
import { selectPig } from './selector.js';
import type { Catalog, RollResult } from './types.js';

export function createRollService(
  catalog: Catalog,
  { timezone, secret }: Readonly<Config['roll']>,
  now: () => Date = () => new Date(),
) {
  if (!catalog.length) throw new CatalogError('INVALID_CATALOG', 'Catalog must not be empty.');
  const formatDate = createBusinessDateFormatter(timezone);

  return {
    roll(namespace: string, userId: string): RollResult {
      // 每次抽取只读取一次时钟，返回日期与抽取输入使用同一个业务日期。
      const date = formatDate(now());
      const pig = selectPig(catalog, { date, namespace, userId }, secret);
      return Object.freeze({ date, pig });
    },
  };
}
