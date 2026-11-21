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

/**
 * Setup: make the picture for every pattern that has a page number and no
 * picture yet, in one go. The patterns of a show set up from the pattern book
 * already know their pages.
 */
export function PatternPicturesButton(props: {
  patterns: Pattern[]
  onPattern: (p: Pattern) => void
  book: Uint8Array | null
  onBook: (bytes: Uint8Array) => void
}) {
  const cloud = useCloud()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const waiting = props.patterns.filter((p) => p.source_page > 0 && !p.page_image)

  if (!cloud.configured || !cloud.admin) return null
  if (waiting.length === 0 && !message) return null

  async function run(bytes: Uint8Array) {
    let saved = 0
    let missed = ''
    for (const pattern of waiting) {
      setBusy(`Saving the picture of page ${pattern.source_page}`)
      const got = await attachPatternPage(bytes, pattern.source_page)
      if (got.ok) {
        props.onPattern({ ...pattern, page_image: got.path })
        saved++
      } else missed = got.error
    }
    setBusy('')
    setMessage(
      [
        saved > 0 ? `Saved ${saved === 1 ? '1 picture' : `${saved} pictures`}. Open a pattern to check its picture, then save the show.` : '',
        missed ? `Some pictures could not be saved: ${missed}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }

  return (
    <div className="reader">
      {waiting.length > 0 && (
        <div className="stack">
          <button className="btn" disabled={busy !== ''} onClick={() => (props.book ? void run(props.book) : fileRef.current?.click())}>
            {busy || `Add the pattern book pictures (${waiting.length === 1 ? '1 pattern' : `${waiting.length} patterns`})`}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            aria-label="Pattern book for the pictures"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              const bytes = new Uint8Array(await file.arrayBuffer())
              props.onBook(bytes)
              void run(bytes)
            }}
          />
        </div>
      )}
      {waiting.length > 0 && !busy && !message && (
        <p className="hint">
          These patterns know which page of the pattern book they are on. Choose the book and a picture of each page is
          saved for the judges.
        </p>
      )}
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
