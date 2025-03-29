/**
 * Debug utilities for consistent logging across the application
 */

// Set to true to enable debug logging, false to disable
export const isDebugMode = true;

/**
 * Log a debug message if debug mode is enabled
 * @param context - The context/component where the log originates
 * @param message - The message to log
 * @param data - Optional data to include in the log
 */
export function debugLog(context: string, message: string, data?: any): void {
  if (!isDebugMode) return;
  
  const timestamp = new Date().toISOString();
  const contextPrefix = `[${timestamp}][${context}]`;
  
  if (data !== undefined) {
    try {
      // Try to stringify the data, handle circular references
      const dataStr = typeof data === 'object' 
        ? JSON.stringify(data, getCircularReplacer())
        : data;
      console.log(`${contextPrefix} ${message}:`, dataStr);
    } catch (error) {
      console.log(`${contextPrefix} ${message}: [Could not stringify data]`, data);
    }
  } else {
    console.log(`${contextPrefix} ${message}`);
  }
}

/**
 * Log an error message if debug mode is enabled
 * @param context - The context/component where the error originates
 * @param message - The error message
 * @param error - Optional error object or data
 */
export function debugError(context: string, message: string, error?: any): void {
  if (!isDebugMode) return;
  
  const timestamp = new Date().toISOString();
  const contextPrefix = `[${timestamp}][${context}][ERROR]`;
  
  if (error) {
    if (error instanceof Error) {
      console.error(`${contextPrefix} ${message}:`, error.message);
      if (error.stack) {
        console.error(`${contextPrefix} Stack trace:`, error.stack);
      }
    } else {
      try {
        const errorStr = typeof error === 'object' 
          ? JSON.stringify(error, getCircularReplacer())
          : error;
        console.error(`${contextPrefix} ${message}:`, errorStr);
      } catch (e) {
        console.error(`${contextPrefix} ${message}: [Could not stringify error]`, error);
      }
    }
  } else {
    console.error(`${contextPrefix} ${message}`);
  }
}

/**
 * Helper function to handle circular references in JSON.stringify
 */
function getCircularReplacer() {
  const seen = new WeakSet();
  return (key: string, value: any) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular Reference]';
      }
      seen.add(value);
    }
    return value;
  };
} 