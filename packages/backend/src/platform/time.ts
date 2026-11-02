export function iso(value: unknown) {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}
