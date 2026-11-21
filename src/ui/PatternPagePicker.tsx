import { useRef, useState } from 'react'
import { useCloud } from '../cloud/cloud'
import type { Pattern } from '../data/fixture'
import { attachPatternPage } from '../setup/patternPages'
import { PatternPagePicture } from './PatternPagePicture'

/**
 * Setup: give a pattern the picture of its page of the pattern book, change
 * which page it is, or take the picture away. The book is chosen once and
 * kept for the rest of the visit.
 */
export function PatternPagePicker(props: {
  pattern: Pattern
  onChange: (p: Pattern) => void
  book: Uint8Array | null
  onBook: (bytes: Uint8Array) => void
}) {
  const { pattern, onChange, book } = props
  const cloud = useCloud()
  const fileRef = useRef<HTMLInputElement>(null)
  const [page, setPage] = useState(String(pattern.source_page > 0 ? pattern.source_page : 1))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  if (!cloud.configured || !cloud.admin) return null

  async function use(bytes: Uint8Array) {
    const n = Number(page)
    if (!Number.isInteger(n) || n < 1) {
      setProblem('Type the page number as a whole number, counting the cover as page 1.')
      return
    }
    setBusy(true)
    setProblem('')
    const got = await attachPatternPage(bytes, n)
    setBusy(false)
    if (!got.ok) {
      setProblem(got.error)
      return
    }
    onChange({ ...pattern, source_page: n, page_image: got.path })
  }

  return (
    <div className="page-picker">
      <h4>Picture from the pattern book</h4>
      {pattern.page_image ? (
        <PatternPagePicture path={pattern.page_image} name={pattern.name || 'this pattern'} />
      ) : (
        <p className="hint">No picture yet. Judges see it under the written maneuvers on the class screen.</p>
      )}
      <div className="row-actions">
        <label className="field">
          <span>Page of the book</span>
          <input type="number" min={1} inputMode="numeric" value={page} onChange={(e) => setPage(e.target.value)} />
        </label>
        <button className="btn" disabled={busy} onClick={() => (book ? void use(book) : fileRef.current?.click())}>
          {busy ? 'Saving the picture' : book ? 'Use this page' : 'Choose the pattern book and use this page'}
        </button>
        {pattern.page_image && (
          <button
            className="btn btn-danger"
            onClick={() => {
              const { page_image: _gone, ...rest } = pattern
              onChange(rest)
            }}
          >
            Remove the picture
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Pattern book for the picture"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            const bytes = new Uint8Array(await file.arrayBuffer())
            props.onBook(bytes)
            void use(bytes)
          }}
        />
      </div>
      {problem && (
        <p className="warning" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}
