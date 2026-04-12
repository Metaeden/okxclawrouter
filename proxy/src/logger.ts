type Level = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: Level = (process.env.LOG_LEVEL as Level) || "info";

function shouldLog(level: Level): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

export const log = {
  debug: (...args: unknown[]) => {
    if (shouldLog("debug")) console.debug(`[${timestamp()}] [DEBUG]`, ...args);
  },
  info: (...args: unknown[]) => {
    if (shouldLog("info")) console.log(`[${timestamp()}] [INFO]`, ...args);
  },
  warn: (...args: unknown[]) => {
    if (shouldLog("warn")) console.warn(`[${timestamp()}] [WARN]`, ...args);
  },
  error: (...args: unknown[]) => {
    if (shouldLog("error")) console.error(`[${timestamp()}] [ERROR]`, ...args);
  },
};
