import { useRef, useState } from 'react'
import { readPatternBook, useCloud } from '../cloud/cloud'
import type { ShowFile } from '../data/fixture'
import { addReadPatterns, patternsFromReader, type ReadPattern } from '../setup/patternBook'
import { attachPatternPage } from '../setup/patternPages'
import { Code } from './bits'

const KIND_WORDS: Record<string, string> = {
  reining: 'Reining',
  ranch_riding: 'Ranch riding',
  horsemanship: 'Horsemanship',
  other: 'Other',
}

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

/**
 * Setup: hand over the pattern book as a PDF and get its patterns back as
 * boxes with codes. The reading is done on the server. A person ticks what to
 * keep, and still checks each pattern against the book.
 */
export function PatternBookReader({ show, onAdd, onBook }: { show: ShowFile; onAdd: (next: ShowFile) => void; onBook?: (bytes: Uint8Array) => void }) {
  const cloud = useCloud()
  const fileRef = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const [found, setFound] = useState<ReadPattern[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [problem, setProblem] = useState('')
  const [pdf, setPdf] = useState<Uint8Array | null>(null)
  const [saving, setSaving] = useState('')

  if (!cloud.configured) return null
  if (!cloud.admin) {
    return (
      <p className="hint">
        A signed-in show admin can have the pattern book read here. Sign in from the first screen before starting
        setup.
      </p>
    )
  }

  async function onFile(file: File) {
    setReading(true)
    setProblem('')
    setMessage('')
    setFound(null)
    // Keep the book for this visit: the picture of each pattern's page is made from it.
    const bytes = new Uint8Array(await file.arrayBuffer())
    setPdf(bytes)
    onBook?.(bytes)
    const result = await readPatternBook(file)
    setReading(false)
    if (!result.ok) {
      setProblem(result.error)
      return
    }
    const read = patternsFromReader(result.found)
    if (read.patterns.length === 0) {
      setProblem(read.notes || 'No patterns were found in that file.')
      return
    }
    setFound(read.patterns)
    setPicked(new Set(read.patterns.map((p) => p.pattern.id)))
    setMessage(read.notes)
  }

  async function add() {
    if (!found || saving) return
    const chosen: ReadPattern[] = []
    let pictures = 0
    let missed = ''
    for (const item of found.filter((p) => picked.has(p.pattern.id))) {
      let pattern = item.pattern
      if (pdf && pattern.source_page > 0) {
        setSaving(`Saving the picture of page ${pattern.source_page}`)
        const got = await attachPatternPage(pdf, pattern.source_page)
        if (got.ok) {
          pattern = { ...pattern, page_image: got.path }
          pictures++
        } else missed = got.error
      }
      chosen.push({ ...item, pattern })
    }
    setSaving('')
    const done = addReadPatterns(show, chosen)
    onAdd(done.show)
    setFound(null)
    const parts = [
      done.added > 0 ? `Added ${count(done.added, 'pattern', 'patterns')}.` : '',
      pictures > 0 ? `Saved ${count(pictures, 'picture', 'pictures')} of the book's pages.` : '',
      missed ? `Some pictures could not be saved: ${missed}` : '',
      done.replaced > 0 ? `Replaced ${count(done.replaced, 'pattern', 'patterns')} of the same name.` : '',
      done.assigned > 0
        ? `${count(done.assigned, 'class was', 'classes were')} given a pattern.`
        : 'No class was given a pattern: choose them in the class list above.',
      'Check each pattern against the book before the show. The reader can be wrong.',
    ]
    setMessage(parts.filter(Boolean).join(' '))
  }

  return (
    <div className="reader">
      <div className="stack">
        <button className="btn" disabled={reading} onClick={() => fileRef.current?.click()}>
          {reading ? 'Reading the pattern book' : 'Read a pattern book (PDF)'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Pattern book PDF"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void onFile(file)
          }}
        />
      </div>
      {reading && (
        <p className="hint" role="status">
          This takes a minute or two. Keep this page open.
        </p>
      )}
      {!reading && !found && !message && !problem && (
        <p className="hint">
          The book is sent to the server and read there. It comes back as patterns with a short code for each scored
          maneuver, ready to check and correct. The PDF can be up to 8 MB.
        </p>
      )}
      {problem && (
        <p className="warning" role="alert">
          {problem}
        </p>
      )}
      {found && (
        <>
          <h3>Found in the book</h3>
          <ul className="list">
            {found.map((item) => {
              const p = item.pattern
              const already = show.patterns.some((x) => x.name.trim().toLowerCase() === p.name.toLowerCase())
              return (
                <li key={p.id} className="pattern-row">
                  <label className="reader-pick">
                    <input
                      type="checkbox"
                      checked={picked.has(p.id)}
                      onChange={(e) => {
                        const next = new Set(picked)
                        if (e.target.checked) next.add(p.id)
                        else next.delete(p.id)
                        setPicked(next)
                      }}
                    />
                    <span className="row-main">
                      <strong>{p.name}</strong>
                      <span className="muted">
                        {KIND_WORDS[p.kind] ?? 'Other'}, {count(p.boxes.length, 'maneuver', 'maneuvers')}
                      </span>
                      <span className="pattern-codes">
                        {p.boxes.map((b, i) => (
                          <span key={i}>{b.abbr ? <Code value={b.abbr} /> : i + 1}</span>
                        ))}
                      </span>
                      <label className="reader-page" onClick={(e) => e.stopPropagation()}>
                        Page of the book, for its picture
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          aria-label={`Page of the book for ${p.name}`}
                          value={p.source_page}
                          onChange={(e) => {
                            const n = Math.max(0, Math.round(Number(e.target.value) || 0))
                            setFound(found.map((x) => (x === item ? { ...x, pattern: { ...x.pattern, source_page: n } } : x)))
                          }}
                        />
                      </label>
                      {item.classes.length > 0 && <span className="muted">The book gives it to: {item.classes.join(', ')}</span>}
                      {already && <span className="muted">Replaces the pattern of this name already in the show.</span>}
                      {item.unsure && <span className="tag-warn">Check this one: {item.unsure}</span>}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="stack">
            <button className="btn btn-primary" disabled={picked.size === 0 || saving !== ''} onClick={() => void add()}>
              {saving || 'Add the ticked patterns'}
            </button>
            <button className="btn" disabled={saving !== ''} onClick={() => setFound(null)}>
              Add none of them
            </button>
          </div>
        </>
      )}
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
