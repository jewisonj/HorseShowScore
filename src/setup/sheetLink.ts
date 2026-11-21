/**
 * The Google Sheets link last used for each show, kept on this computer only.
 * It is never put in the show itself: a published show can be read by anyone,
 * and the link opens the whole workbook.
 */
const STORAGE_KEY = 'hss.sheetlinks.v1'

function all(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function sheetLinkFor(showId: string): string {
  const link = all()[showId]
  return typeof link === 'string' ? link : ''
}

export function rememberSheetLink(showId: string, link: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...all(), [showId]: link }))
  } catch {
    // Not worth stopping for. The link can be pasted again.
  }
}
