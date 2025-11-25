/**
 * Conditional logger utility that respects debug mode from config
 * In production (debugMode: false), only errors and warnings are logged
 * In debug mode (debugMode: true), all logs including debug info are shown
 */

let debugMode = false;

// Initialize debug mode from config (can be called by providers)
export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

export function getDebugMode(): boolean {
  return debugMode;
}

// Logger functions
export const logger = {
  // Always log errors
  error: (...args: any[]) => {
    console.error(...args);
  },

  // Always log warnings
  warn: (...args: any[]) => {
    console.warn(...args);
  },

  // Only log in debug mode
  info: (...args: any[]) => {
    if (debugMode) {
      console.log(...args);
    }
  },

  // Only log in debug mode
  debug: (...args: any[]) => {
    if (debugMode) {
      console.log(...args);
    }
  },

  // Always log (for important production info)
  log: (...args: any[]) => {
    console.log(...args);
  },
};

// Export as default for easier imports
export default logger;
