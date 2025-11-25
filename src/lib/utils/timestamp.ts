/**
 * Timestamp utility for consistent logging across the bot
 * Provides formatted timestamps for terminal output
 */

// Server-side log buffer (Node.js only)
interface ServerLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  component: string;
  message: string;
}

const MAX_SERVER_LOGS = 1000;
const serverLogBuffer: ServerLogEntry[] = [];

export function getServerLogs(limit?: number): ServerLogEntry[] {
  return limit ? serverLogBuffer.slice(-limit) : [...serverLogBuffer];
}

export function clearServerLogs(): void {
  serverLogBuffer.length = 0;
}

function addToServerBuffer(level: 'info' | 'warn' | 'error', args: any[]): void {
  // Only buffer logs on server-side
  if (typeof window !== 'undefined') return;

  const component = extractComponent(args);
  const message = formatMessage(args);

  serverLogBuffer.push({
    timestamp: new Date().toISOString(),
    level,
    component,
    message
  });

  // Keep only last MAX_SERVER_LOGS entries
  if (serverLogBuffer.length > MAX_SERVER_LOGS) {
    serverLogBuffer.shift();
  }
}

/**
 * Extract component name from log message
 * Looks for patterns like "ComponentName: message"
 */
function extractComponent(args: any[]): string {
  const firstArg = String(args[0] || '');
  const match = firstArg.match(/^([A-Za-z]+(?:Manager|Service|Bot)?)\s*:/);
  return match ? match[1] : 'System';
}

/**
 * Format args into a single message string
 */
function formatMessage(args: any[]): string {
  return args
    .map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.message;
      if (typeof arg === 'object') return JSON.stringify(arg);
      return String(arg);
    })
    .join(' ');
}

/**
 * Get current timestamp in ISO 8601 format with milliseconds
 * Example: 2025-10-11 09:05:29.736
 * @returns Formatted timestamp string
 */
export function getTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

/**
 * Get current timestamp in a more compact format (without date)
 * Example: 09:05:29.736
 * @returns Formatted time string
 */
export function getTimeOnly(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

/**
 * Log with timestamp prefix
 * @param args Arguments to log (same as console.log)
 */
export function logWithTimestamp(...args: any[]): void {
  const timestamp = getTimeOnly();
  console.log(`[${timestamp}]`, ...args);
  
  // Store in server-side buffer
  addToServerBuffer('info', args);
}

/**
 * Log error with timestamp prefix
 * @param args Arguments to log (same as console.error)
 */
export function logErrorWithTimestamp(...args: any[]): void {
  const timestamp = getTimeOnly();
  console.error(`[${timestamp}]`, ...args);
  
  // Store in server-side buffer
  addToServerBuffer('error', args);
}

/**
 * Log warning with timestamp prefix
 * @param args Arguments to log (same as console.warn)
 */
export function logWarnWithTimestamp(...args: any[]): void {
  const timestamp = getTimeOnly();
  console.warn(`[${timestamp}]`, ...args);
  
  // Store in server-side buffer
  addToServerBuffer('warn', args);
}
