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

/** Under this name the list keeps the link used most recently, whichever show it was for. */
const LAST = '(last used)'

export function rememberSheetLink(showId: string, link: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...all(), [showId]: link, [LAST]: link }))
  } catch {
    // Not worth stopping for. The link can be pasted again.
  }
}

/** The sheet link used most recently on this computer, for pages that are not about one show. */
export function lastSheetLink(): string {
  const link = all()[LAST]
  return typeof link === 'string' ? link : ''
}

/** Remember a link used on a page that is not about one show. */
export function rememberLastSheetLink(link: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...all(), [LAST]: link }))
  } catch {
    // Not worth stopping for.
  }
}

/** Every show this computer has a sheet link for. */
export function rememberedSheetLinks(): { showId: string; link: string }[] {
  return Object.entries(all())
    .filter(([showId, link]) => showId !== LAST && typeof link === 'string' && link !== '')
    .map(([showId, link]) => ({ showId, link }))
}
