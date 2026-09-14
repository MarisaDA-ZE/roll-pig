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
