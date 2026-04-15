import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { log } from "./logger.js";
import type { TopupConfig } from "./auto-topup.js";
import { DEFAULT_TOPUP_CONFIG } from "./auto-topup.js";
import type { SpendLimits } from "./spend-control.js";

// Prefer the renamed directory, but keep reading legacy installs until they migrate.
const PRIMARY_POLICY_DIR = join(homedir(), ".okclawrouter");
const LEGACY_POLICY_DIR = join(homedir(), ".okxclawrouter");
const POLICY_DIR =
  existsSync(PRIMARY_POLICY_DIR) || !existsSync(LEGACY_POLICY_DIR)
    ? PRIMARY_POLICY_DIR
    : LEGACY_POLICY_DIR;
const POLICY_FILE = join(POLICY_DIR, "policy.json");

export interface SecurityPolicy {
  /** 是否在每笔支付前执行 tx-scan */
  scanPayments: boolean;
  /** tx-scan 失败时是否阻断支付（fail-safe） */
  blockOnScanFailure: boolean;
  /** 是否允许 warn 级别继续支付 */
  allowWarnLevel: boolean;
}

export interface Policy {
  version: number;
  /** 支出限额 */
  spendLimits: SpendLimits;
  /** 安全策略 */
  security: SecurityPolicy;
  /** 自动补仓配置 */
  autoTopup: TopupConfig;
  /** 上次更新时间 */
  updatedAt: string;
}

export const DEFAULT_POLICY: Policy = {
  version: 1,
  spendLimits: {
    perRequest: 0.05,
    hourly: 2.0,
    daily: 10.0,
  },
  security: {
    scanPayments: true,
    blockOnScanFailure: true,
    allowWarnLevel: true,
  },
  autoTopup: DEFAULT_TOPUP_CONFIG,
  updatedAt: new Date().toISOString(),
};

/**
 * 从磁盘加载 policy，如不存在则写入默认值。
 */
export function loadPolicy(): Policy {
  try {
    if (!existsSync(POLICY_FILE)) {
      savePolicy(DEFAULT_POLICY);
      return DEFAULT_POLICY;
    }
    const raw = readFileSync(POLICY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    // 深度合并：保证新增字段有默认值
    return deepMerge(DEFAULT_POLICY, parsed) as Policy;
  } catch (err) {
    log.warn("Policy 读取失败，使用默认配置:", err);
    return DEFAULT_POLICY;
  }
}

/**
 * 将 policy 持久化到磁盘。
 */
export function savePolicy(policy: Policy): void {
  try {
    if (!existsSync(POLICY_DIR)) {
      mkdirSync(POLICY_DIR, { recursive: true });
    }
    const updated = { ...policy, updatedAt: new Date().toISOString() };
    writeFileSync(POLICY_FILE, JSON.stringify(updated, null, 2), "utf-8");
    log.debug(`Policy 已保存: ${POLICY_FILE}`);
  } catch (err) {
    log.error("Policy 保存失败:", err);
  }
}

/**
 * 更新 policy 的指定字段并持久化。
 */
export function updatePolicy(patch: Partial<Policy>): Policy {
  const current = loadPolicy();
  const updated = deepMerge(current, patch) as Policy;
  savePolicy(updated);
  return updated;
}

/**
 * 解析 CLI key=value 格式的 policy 设置。
 * 支持点号路径，例如: security.scanPayments=true, autoTopup.enabled=false
 */
export function parseAndApplyPolicySetting(keyVal: string): { ok: boolean; message: string } {
  const eqIdx = keyVal.indexOf("=");
  if (eqIdx === -1) {
    return { ok: false, message: `格式错误，应为 key=value，例如 security.scanPayments=true` };
  }

  const key = keyVal.slice(0, eqIdx).trim();
  const rawVal = keyVal.slice(eqIdx + 1).trim();

  // 解析值类型
  let value: unknown;
  if (rawVal === "true") value = true;
  else if (rawVal === "false") value = false;
  else if (!isNaN(Number(rawVal))) value = Number(rawVal);
  else value = rawVal;

  // 支持点号路径：security.scanPayments → { security: { scanPayments: value } }
  const patch = setNestedValue({}, key, value);
  if (!patch) {
    return { ok: false, message: `不支持的配置项: ${key}` };
  }

  const updated = updatePolicy(patch as Partial<Policy>);
  return {
    ok: true,
    message: `Policy 已更新: ${key} = ${JSON.stringify(value)}\n保存路径: ${POLICY_FILE}`,
  };
}

/**
 * 格式化 policy 为可读文本。
 */
export function formatPolicy(policy: Policy): string {
  const { spendLimits: sl, security: sec, autoTopup: at } = policy;
  return [
    "─── 支出限额 ───────────────────────────",
    `  每请求上限:  $${sl.perRequest ?? "不限"}`,
    `  每小时上限:  $${sl.hourly ?? "不限"}`,
    `  每日上限:    $${sl.daily ?? "不限"}`,
    `  本次会话:    $${sl.session ?? "不限"}`,
    "",
    "─── 安全策略 ───────────────────────────",
    `  支付前扫描:  ${sec.scanPayments ? "✅ 开启" : "❌ 关闭"}`,
    `  扫描失败拦截: ${sec.blockOnScanFailure ? "✅ 开启" : "❌ 关闭"}`,
    `  允许 warn 继续: ${sec.allowWarnLevel ? "✅ 是" : "❌ 否"}`,
    "",
    "─── 自动补仓 ───────────────────────────",
    `  自动换币:    ${at.enabled ? "✅ 开启" : "❌ 关闭"}`,
    `  触发余额:    $${at.triggerBelowUsd}`,
    `  最大补仓:    $${at.maxTopupUsd}`,
    `  换出代币:    ${at.fromToken === "native" ? "OKB（原生）" : "USDT"}`,
    "",
    `保存路径: ${POLICY_FILE}`,
    `更新时间: ${policy.updatedAt}`,
  ].join("\n");
}

// ─── 工具函数 ──────────────────────────────────────────────────

function deepMerge(base: any, override: any): any {
  if (typeof base !== "object" || base === null) return override ?? base;
  if (typeof override !== "object" || override === null) return base;
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      typeof override[key] === "object" &&
      override[key] !== null &&
      typeof base[key] === "object" &&
      base[key] !== null
    ) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

function setNestedValue(obj: any, path: string, value: unknown): any {
  const parts = path.split(".");
  if (parts.length === 1) {
    return { [path]: value };
  }
  const [head, ...rest] = parts;
  return { [head]: setNestedValue({}, rest.join("."), value) };
}
