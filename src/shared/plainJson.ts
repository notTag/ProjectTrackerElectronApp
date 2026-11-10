// Strips proxies, functions and undefined fields so a value can cross IPC.
// JSON.stringify returns undefined (not a string) for undefined, a function, a
// symbol, or a toJSON() that returns undefined, and JSON.parse(undefined)
// throws `"undefined" is not valid JSON`, so those pass through as undefined.
export const toPlainJson = <T>(value: T): T => {
  const serialized = JSON.stringify(value)
  return serialized === undefined ? (undefined as T) : (JSON.parse(serialized) as T)
}
