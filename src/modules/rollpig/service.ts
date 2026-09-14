import type { Config } from '../../config.js';
import { CatalogError } from './catalog.js';
import { createBusinessDateFormatter } from './date.js';
import { selectPig } from './selector.js';
import type { Catalog, RollResult } from './types.js';

/**
 * 创建按业务时区计算每日结果的抽取服务。
 *
 * @remarks
 * 第二个参数中的 timezone 决定业务日期，secret 用于 HMAC 抽取。
 * 创建时保存这两个值；后续修改传入的配置对象不会改变该实例的行为。
 *
 * @param catalog - 已校验、非空且顺序稳定的运行清单。
 * @param now - 获取当前时刻的函数，默认读取系统时间。
 * @returns 提供每日抽取方法的服务实例。
 * @throws {@link CatalogError}
 * 运行清单为空。
 * @throws RangeError
 * 业务时区无效。
 */
export function createRollService(
  catalog: Catalog,
  { timezone, secret }: Readonly<Config['roll']>,
  now: () => Date = () => new Date(),
) {
  if (!catalog.length) throw new CatalogError('INVALID_CATALOG', 'Catalog must not be empty.');
  const formatDate = createBusinessDateFormatter(timezone);

  return {
    /**
     * 读取一次当前时间，返回该用户在对应业务日期的抽取结果。
     *
     * @param namespace - 已由调用方校验的命名空间，区分大小写。
     * @param userId - 已由调用方校验的用户 ID，保留原始字符串。
     * @returns 已冻结的业务日期与猪猪条目组合。
     * @throws RangeError
     * 注入的时钟返回了无效日期。
     */
    roll(namespace: string, userId: string): RollResult {
      // 每次抽取只读取一次时钟，返回日期与抽取输入使用同一个业务日期。
      const date = formatDate(now());
      const pig = selectPig(catalog, { date, namespace, userId }, secret);
      return Object.freeze({ date, pig });
    },
  };
}
