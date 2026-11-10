// Strips proxies, functions and undefined fields so a value can cross IPC.
// undefined passes through: JSON.stringify(undefined) is undefined, and
// JSON.parse(undefined) throws `"undefined" is not valid JSON`.
export const toPlainJson = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
