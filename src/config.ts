import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';

const DEFAULT_SECRET = 'change-me';
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

const timeoutSchema = z.number().int().min(1).max(2_147_483_647);
const sizeSchema = z.number().int().min(1).max(2_147_483_647);
const serverSchema = z.strictObject({
  host: hostSchema,
  port: z.number().int().min(1).max(65535),
  trustProxy: z.boolean(),
});
const rollSchema = z.strictObject({
  timezone: timezoneSchema,
  secret: z.string().refine((value) => value.trim().length > 0, 'Expected a non-empty secret.'),
});
const assetsSchema = z.strictObject({ baseUrl: baseUrlSchema });
const limitsSchema = z.strictObject({
  maxConcurrency: z.number().int().min(1),
  maxQueueSize: z.number().int().min(0),
  queueTimeoutMs: timeoutSchema,
  requestTimeoutMs: timeoutSchema,
  maxUrlBytes: sizeSchema,
  maxHeaderBytes: sizeSchema,
  maxBodyBytes: sizeSchema,
});
const configSchema = z.strictObject({
  server: serverSchema,
  roll: rollSchema,
  assets: assetsSchema,
  limits: limitsSchema,
});

// 合并前检查 YAML 结构，环境变量覆盖后再校验配置值。
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

export type Config = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

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

export function loadConfig(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
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
