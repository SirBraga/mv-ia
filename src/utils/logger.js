export function logInfo(message, data = undefined) {
  console.log(`[INFO] ${new Date().toISOString()} - ${message}`, data || '');
}

export function logError(message, error = undefined) {
  console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, error || '');
}
