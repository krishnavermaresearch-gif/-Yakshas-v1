// ─── Logger ──────────────────────────────────────────────────────────────────
// Structured logging — matches OpenClaw's logger.ts pattern

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

let currentLevel: LogLevel =
    (process.env.LOG_LEVEL?.trim().toLowerCase() as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function timestamp(): string {
    return new Date().toISOString();
}

export function logDebug(msg: string, ...args: unknown[]): void {
    if (shouldLog("debug")) {
        console.debug(`[${timestamp()}] [DEBUG] ${msg}`, ...args);
    }
}

export function logInfo(msg: string, ...args: unknown[]): void {
    if (shouldLog("info")) {
        console.log(`[${timestamp()}] [INFO] ${msg}`, ...args);
    }
}

export function logWarn(msg: string, ...args: unknown[]): void {
    if (shouldLog("warn")) {
        console.warn(`[${timestamp()}] [WARN] ${msg}`, ...args);
    }
}

export function logError(msg: string, ...args: unknown[]): void {
    if (shouldLog("error")) {
        console.error(`[${timestamp()}] [ERROR] ${msg}`, ...args);
    }
}

export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}
