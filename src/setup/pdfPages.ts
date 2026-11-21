/**
 * Turn one page of a PDF into a picture. Used only in setup. The PDF renderer
 * is over a megabyte, so it is loaded the first time a page is asked for and
 * is kept out of what phones store for offline scoring.
 */
export type PageRenderer = (pdf: Uint8Array, pageNumber: number) => Promise<Blob>

/** 150 dots per inch on a letter page. Sharp enough to zoom in on a phone. */
const WIDTH = 1275

async function renderWithPdfJs(pdf: Uint8Array, pageNumber: number): Promise<Blob> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  // The renderer takes the bytes for itself, so hand it a copy.
  const loading = pdfjs.getDocument({ data: pdf.slice() })
  try {
    const doc = await loading.promise
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) {
      throw new Error(`The pattern book has ${doc.numPages} pages. There is no page ${pageNumber}.`)
    }
    const page = await doc.getPage(pageNumber)
    const natural = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: WIDTH / natural.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not draw the page.')
    // A JPEG has no see-through, so start from white paper.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: context, viewport }).promise
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob) throw new Error('This browser could not save the page as a picture.')
    return blob
  } finally {
    void loading.destroy()
  }
}

let renderer: PageRenderer = renderWithPdfJs

/** For tests, which have no canvas: use this instead of the real renderer. Null puts the real one back. */
export function setPageRendererForTests(fake: PageRenderer | null) {
  renderer = fake ?? renderWithPdfJs
}

export function renderPdfPage(pdf: Uint8Array, pageNumber: number): Promise<Blob> {
  return renderer(pdf, pageNumber)
}
