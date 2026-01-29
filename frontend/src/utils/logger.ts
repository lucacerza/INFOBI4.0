/**
 * Development Logger Utility
 *
 * Provides conditional logging that only outputs in development mode.
 * In production builds, all logs are silently ignored.
 *
 * Usage:
 *   import { logger } from '../utils/logger';
 *   logger.debug('Debug info', data);
 *   logger.info('Info message');
 *   logger.warn('Warning');
 *   logger.error('Error', error);
 */

// Check if we're in development mode (Vite sets import.meta.env.DEV)
const isDev = import.meta.env.DEV;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  group: (label: string) => void;
  groupEnd: () => void;
  table: (data: unknown) => void;
}

const noop = () => {};

const createLogger = (): Logger => {
  if (!isDev) {
    return {
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
      group: noop,
      groupEnd: noop,
      table: noop,
    };
  }

  return {
    debug: (...args: unknown[]) => console.debug('[DEBUG]', ...args),
    info: (...args: unknown[]) => console.info('[INFO]', ...args),
    warn: (...args: unknown[]) => console.warn('[WARN]', ...args),
    error: (...args: unknown[]) => console.error('[ERROR]', ...args),
    group: (label: string) => console.group(label),
    groupEnd: () => console.groupEnd(),
    table: (data: unknown) => console.table(data),
  };
};

export const logger = createLogger();

// Named export for specific log levels
export const { debug, info, warn, error } = logger;
