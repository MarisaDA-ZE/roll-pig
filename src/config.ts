import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';

/** 用于识别未设置私有抽取密钥的默认值。 */
const DEFAULT_SECRET = 'change-me';
/** YAML 和环境变量均未指定对应字段时使用的配置。 */
const defaults = {
  server: { host: '0.0.0.0', port: 3000, trustProxy: false },
  roll: { timezone: 'Asia/Shanghai', secret: DEFAULT_SECRET },
  assets: { baseUrl: '' },
  limits: {
    maxConcurrency: 64,
    maxQueueSize: 128,
    queueTimeoutMs: 3000,
    requestTimeoutMs: 5000,
    maxUrlBytes: 2048,
    maxHeaderBytes: 16384,
    maxBodyBytes: 16384,
  },
};

const hostSchema = z.string().refine((value) => {
  if (isIP(value)) return true;
  // 允许 DNS 主机名，不接受 URL、路径、带端口的地址或格式错误的 IP 地址。
  return value.length <= 253 && !/^[\d.]+$/.test(value)
    && value.split('.').every((label) =>
      /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label));
}, 'Expected an IP address or hostname.');

const timezoneSchema = z.string().min(1).refine((value) => {
  if (value.trim() !== value || /^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Expected a valid named timezone.');

const baseUrlSchema = z.string().refine((value) => {
  if (value === '') return true;
  if (!/^https?:\/\//.test(value) || /[\s\\?#]/.test(value)) return false;
  try {
    const url = new URL(value);
    return Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}, 'Expected an empty string or an HTTP(S) URL without credentials, query or fragment.')
  .transform((value) => value.replace(/\/+$/, ''));

/** 正整数毫秒值，上限防止 Node.js 定时器发生整数溢出。 */
const timeoutSchema = z.number().int().min(1).max(2_147_483_647);
/** 请求大小的字节上限，限制在正的有符号 32 位整数范围内。 */
const sizeSchema = z.number().int().min(1).max(2_147_483_647);
const serverSchema = z.strictObject({
  /** 监听的 IP 地址或主机名，不包含协议、路径或端口。 */
  host: hostSchema,
  /** TCP 监听端口，范围为 1–65535。 */
  port: z.number().int().min(1).max(65535),
  /** 是否让 Express 信任反向代理提供的转发信息。 */
  trustProxy: z.boolean(),
});
const rollSchema = z.strictObject({
  /** 计算业务日期使用的命名时区。 */
  timezone: timezoneSchema,
  /** HMAC 抽取密钥；多实例使用相同值才能得到一致结果。 */
  secret: z.string().refine((value) => value.trim().length > 0, 'Expected a non-empty secret.'),
});
/** 可选的图片 URL 前缀，加载时去除末尾斜线。 */
const assetsSchema = z.strictObject({ baseUrl: baseUrlSchema });
const limitsSchema = z.strictObject({
  /** 同时接收请求体、处理业务或传输响应的最大请求数。 */
  maxConcurrency: z.number().int().min(1),
  /** 等待名额的最大请求数；为 0 时不排队。 */
  maxQueueSize: z.number().int().min(0),
  /** 请求等待活动名额的最长时间，单位为毫秒。 */
  queueTimeoutMs: timeoutSchema,
  /** 获得名额后到完整响应传输结束的最长时间，单位为毫秒。 */
  requestTimeoutMs: timeoutSchema,
  /** 请求 URL 的最大字节数，包含查询字符串。 */
  maxUrlBytes: sizeSchema,
  /** 请求 Header 的最大总字节数。 */
  maxHeaderBytes: sizeSchema,
  /** 请求体的最大字节数，对声明长度和分块传输均生效。 */
  maxBodyBytes: sizeSchema,
});
const configSchema = z.strictObject({
  server: serverSchema,
  roll: rollSchema,
  assets: assetsSchema,
  limits: limitsSchema,
});

/**
 * 创建只检查字段名称的可选对象结构，供 YAML 合并前校验使用。
 *
 * @remarks
 * 字段值暂不校验，使环境变量可以覆盖 YAML 中类型错误的已知字段。
 *
 * @param shape - 最终配置对象允许的字段集合。
 * @returns 所有已知字段均可省略、拒绝未知字段的 Zod 结构。
 */
function optionalFields(shape: z.ZodRawShape) {
  return z.strictObject(Object.fromEntries(
    Object.keys(shape).map((key) => [key, z.unknown().optional()]),
  ));
}
const fileSchema = z.strictObject({
  server: optionalFields(serverSchema.shape).optional(),
  roll: optionalFields(rollSchema.shape).optional(),
  assets: optionalFields(assetsSchema.shape).optional(),
  limits: optionalFields(limitsSchema.shape).optional(),
});

/** 合并默认值、YAML 和环境变量并完成校验后的完整配置。 */
export type Config = z.infer<typeof configSchema>;

/** 配置读取、语法解析或字段校验失败时使用的错误。 */
export class ConfigError extends Error {
  /**
   * 创建可在启动日志中输出的配置错误。
   *
   * @param message - 不包含配置值、密钥或 YAML 原文的错误说明。
   */
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * 校验输入并将失败原因转换为不包含输入值的配置错误。
 *
 * @typeParam T - 用于推导返回值类型的 Zod 结构。
 * @param schema - 字段结构及取值规则。
 * @param value - 待校验的配置数据。
 * @returns 校验及转换后的配置数据。
 * @throws {@link ConfigError}
 * 输入不符合结构或取值规则。
 */
function validated<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  // 错误信息不包含输入值、YAML 原文或未知字段名，避免泄露敏感内容。
  const issues = result.error.issues.map((issue) => {
    const path = issue.path.join('.') || 'config';
    const message = issue.code === 'unrecognized_keys'
      ? 'Unknown configuration key.'
      : issue.code === 'custom' ? issue.message : 'Invalid value or type.';
    return `${path}: ${message}`;
  });
  throw new ConfigError(`Invalid configuration: ${issues.join(' ')}`);
}

/**
 * 读取 YAML 配置，拒绝重复键、解析警告及过量别名展开。
 *
 * @param filePath - 配置文件路径。
 * @returns 解析后的数据；文件不存在或没有 YAML 内容时返回空对象。
 * @throws {@link ConfigError}
 * 文件无法读取或 YAML 无法安全解析。
 */
function readConfigFile(filePath: string): unknown {
  let source: string;
  try {
    source = readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new ConfigError('Unable to read config.yaml.');
  }
  try {
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length || document.warnings.length) {
      throw new Error('Invalid YAML');
    }
    return document.contents === null ? {} : document.toJS({ maxAliasCount: 100 });
  } catch {
    throw new ConfigError('Invalid YAML in config.yaml; check syntax, duplicate keys and aliases.');
  }
}

/** 配置字段与环境变量的对应关系。 */
const envKeys = {
  server: { host: 'SERVER_HOST', port: 'SERVER_PORT', trustProxy: 'SERVER_TRUST_PROXY' },
  roll: { timezone: 'ROLL_TIMEZONE', secret: 'ROLL_SECRET' },
  assets: { baseUrl: 'ASSETS_BASE_URL' },
  limits: {
    maxConcurrency: 'LIMITS_MAX_CONCURRENCY',
    maxQueueSize: 'LIMITS_MAX_QUEUE_SIZE',
    queueTimeoutMs: 'LIMITS_QUEUE_TIMEOUT_MS',
    requestTimeoutMs: 'LIMITS_REQUEST_TIMEOUT_MS',
    maxUrlBytes: 'LIMITS_MAX_URL_BYTES',
    maxHeaderBytes: 'LIMITS_MAX_HEADER_BYTES',
    maxBodyBytes: 'LIMITS_MAX_BODY_BYTES',
  },
} as const;

/**
 * 按默认值、YAML、环境变量的顺序加载并校验运行配置。
 *
 * @remarks
 * 后一层覆盖前一层。环境变量为空字符串时也参与覆盖；
 * 数字仅接受十进制整数，布尔值仅接受 `true` 或 `false`。
 * 使用默认抽取密钥时调用告警函数，不输出密钥内容。
 *
 * @param options - 配置目录、环境变量和告警输出的注入选项。
 * @returns 字段完整且经过校验的配置，每次调用均创建独立对象。
 * @throws {@link ConfigError}
 * 文件读取、YAML 解析、字段结构或最终配置值校验失败。
 */
export function loadConfig(options: {
  /** config.yaml 所在目录，默认使用进程工作目录。 */
  cwd?: string;
  /** 参与覆盖的环境变量集合，默认使用 process.env。 */
  env?: NodeJS.ProcessEnv;
  /** 配置告警的接收函数，默认使用 console.warn。 */
  warn?: (message: string) => void;
} = {}): Config {
  const env = options.env ?? process.env;
  const file = validated(fileSchema, readConfigFile(resolve(options.cwd ?? process.cwd(), 'config.yaml')));
  const merged: Record<string, Record<string, unknown>> = {};
  for (const section of ['server', 'roll', 'assets', 'limits'] as const) {
    const values: Record<string, unknown> = { ...defaults[section], ...file[section] };
    for (const [key, envKey] of Object.entries(envKeys[section])) {
      const raw = env[envKey];
      if (raw === undefined) continue;
      const defaultValue = (defaults[section] as Record<string, unknown>)[key];
      if (typeof defaultValue === 'number') {
        // 拒绝空白、十六进制、科学计数法和小数，避免隐式转换造成歧义。
        values[key] = /^\d+$/.test(raw) ? Number(raw) : raw;
      } else if (typeof defaultValue === 'boolean') {
        values[key] = raw === 'true' ? true : raw === 'false' ? false : raw;
      } else {
        values[key] = raw;
      }
    }
    merged[section] = values;
  }
  const config = validated(configSchema, merged);
  if (config.roll.secret === DEFAULT_SECRET) {
    (options.warn ?? console.warn)('roll.secret is using the default value');
  }
  return config;
}
