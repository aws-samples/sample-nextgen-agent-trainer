/**
 * Simple logger utility that adds timestamps to console messages
 */

// Format options for the timestamp
type TimestampFormat = 'short' | 'iso' | 'time';

// Logger configuration
interface LoggerConfig {
  format?: TimestampFormat;
  includeLevel?: boolean;
}

// Default configuration
const defaultConfig: LoggerConfig = {
  format: 'time',
  includeLevel: true
};

/**
 * Formats the current timestamp based on the specified format
 */
function formatTimestamp(format: TimestampFormat = 'time'): string {
  const now = new Date();
  
  switch (format) {
    case 'iso':
      return now.toISOString();
    case 'short':
      return `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    case 'time':
    default:
      return `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
  }
}

// Thread-local storage for session context
let sessionContext: string | null = null;

/**
 * Logger class that adds timestamps to console messages
 */
export class Logger {
  private config: LoggerConfig;

  constructor(config: LoggerConfig = defaultConfig) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Set session context for the current execution context
   */
  setSessionContext(sessionId: string | null): void {
    sessionContext = sessionId;
  }

  /**
   * Get the current session context
   */
  getSessionContext(): string | null {
    return sessionContext;
  }

  /**
   * Format prefix with timestamp, level and session context
   */
  private formatPrefix(level: string): string {
    const timestamp = formatTimestamp(this.config.format);
    const sessionPart = sessionContext ? `[${sessionContext}]` : '';
    return this.config.includeLevel 
      ? `[${timestamp}] [${level}] ${sessionPart}`
      : `[${timestamp}] ${sessionPart}`;
  }

  /**
   * Log an informational message
   */
  log(...args: any[]): void {
    console.log(this.formatPrefix('INFO'), ...args);
  }

  /**
   * Log an error message
   */
  error(...args: any[]): void {
    console.error(this.formatPrefix('ERROR'), ...args);
  }

  /**
   * Log a warning message
   */
  warn(...args: any[]): void {
    console.warn(this.formatPrefix('WARN'), ...args);
  }

  /**
   * Log a debug message
   */
  debug(...args: any[]): void {
    console.debug(this.formatPrefix('DEBUG'), ...args);
  }

  /**
   * Create a session-specific logger
   */
  withSession(sessionId: string): SessionLogger {
    return new SessionLogger(this, sessionId);
  }
}

/**
 * Session-specific logger that automatically includes session ID
 */
export class SessionLogger {
  private logger: Logger;
  private sessionId: string;

  constructor(logger: Logger, sessionId: string) {
    this.logger = logger;
    this.sessionId = sessionId;
  }

  log(...args: any[]): void {
    this.logger.setSessionContext(this.sessionId);
    this.logger.log(...args);
    this.logger.setSessionContext(null);
  }

  error(...args: any[]): void {
    this.logger.setSessionContext(this.sessionId);
    this.logger.error(...args);
    this.logger.setSessionContext(null);
  }

  warn(...args: any[]): void {
    this.logger.setSessionContext(this.sessionId);
    this.logger.warn(...args);
    this.logger.setSessionContext(null);
  }

  debug(...args: any[]): void {
    this.logger.setSessionContext(this.sessionId);
    this.logger.debug(...args);
    this.logger.setSessionContext(null);
  }
}

// Create and export a default logger instance
export const logger = new Logger();

// For direct usage without importing the logger instance
export const log = logger.log.bind(logger);
export const error = logger.error.bind(logger);
export const warn = logger.warn.bind(logger);
export const debug = logger.debug.bind(logger);