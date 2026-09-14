/**
 * 创建按指定时区输出业务日期的格式化函数。
 *
 * @remarks
 * 固定使用公历和拉丁数字，结果不受宿主机默认时区或语言影响。
 * 返回的函数复用同一个 Intl 格式化器。
 *
 * @param timezone - Intl 支持的命名时区，例如 Asia/Shanghai 或 UTC。
 * @returns 接收有效 Date 并返回 YYYY-MM-DD 字符串的函数。
 * @throws RangeError
 * 创建时指定了无效时区，或调用返回的函数时传入了无效日期。
 */
export function createBusinessDateFormatter(timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return (now: Date): string => {
    // 分别提取年月日，避免日期格式随语言或宿主机时区变化。
    const parts = formatter.formatToParts(now);
    const year = parts.find((part) => part.type === 'year')!.value.padStart(4, '0');
    const month = parts.find((part) => part.type === 'month')!.value;
    const day = parts.find((part) => part.type === 'day')!.value;
    return `${year}-${month}-${day}`;
  };
}
