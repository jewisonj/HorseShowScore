import { savePatternPage, type PageResult } from '../cloud/cloud'
import { renderPdfPage } from './pdfPages'

/** Make a picture of one page of the pattern book and store it on the server. */
export async function attachPatternPage(pdf: Uint8Array, pageNumber: number): Promise<PageResult> {
  let picture: Blob
  try {
    picture = await renderPdfPage(pdf, pageNumber)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'That page could not be turned into a picture.' }
  }
  return savePatternPage(picture)
}
