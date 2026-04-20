const DEFAULT_PORT = 3000

export const resolvePort = (
  rawPort: string | undefined,
  fallback = DEFAULT_PORT,
): number => {
  if (!rawPort) return fallback
  const parsed = Number.parseInt(rawPort, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}
