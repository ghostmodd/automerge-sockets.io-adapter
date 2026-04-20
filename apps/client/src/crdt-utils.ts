export const resolveSocketIoUrl = (
  rawUrl: string,
  baseOrigin = "http://localhost",
): string => {
  let normalized = rawUrl
  if (normalized.startsWith("ws://")) {
    normalized = `http://${normalized.slice("ws://".length)}`
  } else if (normalized.startsWith("wss://")) {
    normalized = `https://${normalized.slice("wss://".length)}`
  }

  const url = new URL(normalized, baseOrigin)
  return url.origin
}

export const toDocumentEndpointUrl = (socketIoUrl: string): string =>
  new URL("/document", socketIoUrl).toString()
