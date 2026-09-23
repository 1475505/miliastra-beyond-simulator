export function filterLogs(logs) {
  return Array.isArray(logs) ? logs.slice() : []
}
