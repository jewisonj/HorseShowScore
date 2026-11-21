import { useRef, useState } from 'react'
import { classKey, getShow, type Meet, type Pattern, type ShowClass, type ShowFile } from '../data/fixture'
import { saveShow } from '../data/shows'
import { loadDraw } from '../seed'
import { DIVISIONS, divisionFor, type Division } from '../setup/build'
import {
  blankClass,
  blankMeet,
  blankPattern,
  blankShow,
  boxesFromLines,
  copyPattern,
  finishShow,
  patternLibrary,
  problemsIn,
} from '../setup/draft'
import { readShowWorkbook } from '../setup/workbook'
import { readXlsx } from '../setup/xlsx'
import { classState, getState, hasWork, resizeRuns } from '../store'
import { Code, Screen, go } from './bits'
import { PatternBookReader } from './PatternBookReader'

const KINDS: { value: Division['kind']; label: string }[] = [
  { value: 'reining', label: 'Reining' },
  { value: 'ranch_riding', label: 'Ranch riding' },
  { value: 'horsemanship', label: 'Horsemanship' },
]

function PatternEditor(props: { pattern: Pattern; onChange: (p: Pattern) => void; onClose: () => void }) {
  const { pattern, onChange } = props
  const [pasted, setPasted] = useState('')
  const setBox = (i: number, patch: Partial<Pattern['boxes'][number]>) =>
    onChange({ ...pattern, boxes: pattern.boxes.map((b, n) => (n === i ? { ...b, ...patch } : b)) })
  const move = (i: number, by: number) => {
    const boxes = pattern.boxes.slice()
    const j = i + by
    if (j < 0 || j >= boxes.length) return
    ;[boxes[i], boxes[j]] = [boxes[j], boxes[i]]
    onChange({ ...pattern, boxes })
  }

  return (
    <div className="panel-edit">
      <div className="fields">
        <label className="field">
          <span>Pattern name</span>
          <input value={pattern.name} onChange={(e) => onChange({ ...pattern, name: e.target.value })} placeholder="Level I T" />
        </label>
        <label className="field">
          <span>Used for</span>
          <select value={pattern.kind} onChange={(e) => onChange({ ...pattern, kind: e.target.value })}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="hint">
        One row for each box on the judge’s score sheet, in order. The code shows above the box on a phone, so keep it
        short. The words show on a tablet and beside the keys.
      </p>
      <ol className="box-rows">
        {pattern.boxes.map((box, i) => (
          <li key={i}>
            <span className="box-rows-n">{i + 1}</span>
            <input
              className="box-rows-code"
              aria-label={`Maneuver ${i + 1} code`}
              value={box.abbr}
              maxLength={9}
              placeholder="Rr S"
              onChange={(e) => setBox(i, { abbr: e.target.value })}
            />
            <input
              aria-label={`Maneuver ${i + 1} words`}
              value={box.label}
              placeholder="LF right, SS right, stop"
              onChange={(e) => setBox(i, { label: e.target.value })}
            />
            <button className="btn btn-small" aria-label={`Move maneuver ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              Up
            </button>
            <button
              className="btn btn-small"
              aria-label={`Move maneuver ${i + 1} down`}
              disabled={i === pattern.boxes.length - 1}
              onClick={() => move(i, 1)}
            >
              Down
            </button>
            <button
              className="btn btn-small btn-danger"
              aria-label={`Remove maneuver ${i + 1}`}
              onClick={() => onChange({ ...pattern, boxes: pattern.boxes.filter((_, n) => n !== i) })}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>
      <div className="row-actions">
        <button
          className="btn"
          onClick={() => onChange({ ...pattern, boxes: [...pattern.boxes, { n: pattern.boxes.length + 1, abbr: '', label: '', tags: [] }] })}
        >
          Add a maneuver
        </button>
        <button className="btn btn-primary" onClick={props.onClose}>
          Done with this pattern
        </button>
      </div>

      <details className="paste">
        <summary>Paste a list instead</summary>
        <p className="hint">
          One maneuver per line. Put a bar between a code and its words, like <code>S&amp;B | Stop, back</code>. Lines
          with no bar become the words. Numbers at the start of a line are dropped.
        </p>
        <textarea
          aria-label="Maneuvers, one per line"
          rows={6}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder={'W | Walk\nEx T | Extended trot\nS&B | Stop, back'}
        />
        <button
          className="btn"
          disabled={boxesFromLines(pasted).length === 0}
          onClick={() => {
            onChange({ ...pattern, boxes: boxesFromLines(pasted) })
            setPasted('')
          }}
        >
          Replace the maneuvers with these lines
        </button>
      </details>
    </div>
  )
}

/** Create a show, or change one already on this device. Built for a computer, usable on a phone. */
export function SetupScreen({ showId }: { showId?: string }) {
  const existing = showId ? getShow(showId) : undefined
  const [draft, setDraft] = useState<ShowFile>(() => (existing ? (JSON.parse(JSON.stringify(existing)) as ShowFile) : blankShow()))
  const [editing, setEditing] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  // Patterns from other shows, leaving out any this show already has a copy of.
  const have = new Set(draft.patterns.map((p) => p.name.trim().toLowerCase()))
  const library = patternLibrary(draft.id).filter((p) => !have.has(p.name.trim().toLowerCase()))

  if (showId && !existing) {
    return (
      <Screen title="Show not found" backTo="/" backLabel="Shows">
        <p className="hint">This show is not on this device.</p>
      </Screen>
    )
  }

  const setMeet = (meetId: string, fn: (m: Meet) => Meet) =>
    setDraft((d) => ({ ...d, meets: d.meets.map((m) => (m.id === meetId ? fn(m) : m)) }))
  const setClass = (meetId: string, classId: string, fn: (c: ShowClass) => ShowClass) =>
    setMeet(meetId, (m) => ({ ...m, classes: m.classes.map((c) => (c.id === classId ? fn(c) : c)) }))
  const setPattern = (p: Pattern) => setDraft((d) => ({ ...d, patterns: d.patterns.map((x) => (x.id === p.id ? p : x)) }))

  /** Use a pattern for a class, and for the day's other classes of the same division that have none yet. */
  function choosePattern(meetId: string, cls: ShowClass, patternId: string) {
    setMeet(meetId, (m) => ({
      ...m,
      classes: m.classes.map((c) =>
        c.id === cls.id || (c.class_no === cls.class_no && c.pattern_id === '') ? { ...c, pattern_id: patternId } : c,
      ),
    }))
  }

  function onPatternPick(meetId: string, cls: ShowClass, value: string) {
    if (value === 'new') {
      const p = blankPattern(divisionFor(cls.class_no).kind)
      setDraft((d) => ({ ...d, patterns: [...d.patterns, p] }))
      choosePattern(meetId, cls, p.id)
      setEditing(p.id)
    } else if (value.startsWith('lib:')) {
      const source = library.find((p) => p.id === value.slice(4))
      if (!source) return
      const already = draft.patterns.find((p) => p.name.trim().toLowerCase() === source.name.trim().toLowerCase())
      const p = already ?? copyPattern(source)
      if (!already) setDraft((d) => ({ ...d, patterns: [...d.patterns, p] }))
      choosePattern(meetId, cls, p.id)
    } else if (value === '') {
      setClass(meetId, cls.id, (c) => ({ ...c, pattern_id: '' }))
    } else {
      choosePattern(meetId, cls, value)
    }
  }

  async function onWorkbook(file: File) {
    try {
      const wb = readXlsx(new Uint8Array(await file.arrayBuffer()))
      const read = readShowWorkbook(wb, draft.id)
      // Keep pattern choices already made, by class name and then by division.
      const before = draft.meets.flatMap((m) => m.classes)
      const meets = read.meets.map((m) => ({
        ...m,
        classes: m.classes.map((c) => {
          const same = before.find((b) => b.name === c.name && b.pattern_id) ?? before.find((b) => b.class_no === c.class_no && b.pattern_id)
          return same ? { ...c, pattern_id: same.pattern_id } : c
        }),
      }))
      setDraft((d) => ({ ...d, name: d.name.trim() === '' ? read.title : d.name, meets }))
      const classes = meets.reduce((n, m) => n + m.classes.length, 0)
      setNotes([
        `Read ${classes} classes and ${read.rides} rides over ${meets.length === 1 ? '1 day' : `${meets.length} days`}. The workbook was only read. Nothing in it was changed.`,
        ...read.notes,
      ])
      setProblems([])
    } catch (err) {
      setNotes([err instanceof Error ? err.message : 'That file could not be read.'])
    }
  }

  function save() {
    const found = problemsIn(draft)
    const show = finishShow(draft)
    // A class that already has scores keeps its number of boxes.
    for (const meet of show.meets) {
      for (const c of meet.classes) {
        const boxes = show.patterns.find((p) => p.id === c.pattern_id)?.boxes.length
        const runs = classState(getState(), classKey(meet.id, c.id)).runs
        if (boxes !== undefined && runs.some((r) => r.boxes.length !== boxes && hasWork(r))) {
          found.push(`${c.name} already has scores on a card with ${runs[0].boxes.length} boxes. Keep that many maneuvers in its pattern.`)
        }
      }
    }
    setProblems(found)
    if (found.length > 0) return
    if (!saveShow(show)) {
      setProblems(['This device could not store the show. Its storage may be full.'])
      return
    }
    for (const meet of show.meets) {
      for (const c of meet.classes) {
        const boxes = show.patterns.find((p) => p.id === c.pattern_id)?.boxes.length
        if (boxes !== undefined) resizeRuns(classKey(meet.id, c.id), boxes)
      }
    }
    loadDraw()
    go(`/s/${show.id}`)
  }

  const open = draft.patterns.find((p) => p.id === editing)

  return (
    <Screen title={existing ? 'Change the setup' : 'Create a show'} sub={draft.name || undefined} backTo={existing ? `/s/${draft.id}` : '/'} backLabel={existing ? 'Show' : 'Shows'} wide>
      <h2>The show</h2>
      <div className="fields">
        <label className="field">
          <span>Show name</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="IHSA Western Show" />
        </label>
        <label className="field">
          <span>Host</span>
          <input value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} placeholder="Black Hawk College" />
        </label>
      </div>

      <h2>Bring in the show workbook</h2>
      <p className="hint">
        If the show is kept in the Google Sheets workbook, download it as an Excel file (File, Download, Microsoft
        Excel) and choose it here. It fills in the classes, the running order and the draw. The file is read on this
        computer. Nothing is sent anywhere and the sheet itself is never touched.
      </p>
      <div className="row-actions">
        <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
          Choose the workbook
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          aria-label="Show workbook"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void onWorkbook(file)
          }}
        />
      </div>
      {notes.map((n) => (
        <p key={n} className="hint" role="status">
          {n}
        </p>
      ))}

      {draft.meets.map((meet, mi) => (
        <section key={meet.id} className="setup-day">
          <h2>Day {mi + 1}</h2>
          <div className="fields">
            <label className="field">
              <span>Name</span>
              <input value={meet.label} onChange={(e) => setMeet(meet.id, (m) => ({ ...m, label: e.target.value }))} placeholder="Saturday" />
            </label>
            <label className="field">
              <span>Date</span>
              <input type="date" value={meet.date} onChange={(e) => setMeet(meet.id, (m) => ({ ...m, date: e.target.value }))} />
            </label>
          </div>

          {meet.classes.length === 0 ? (
            <p className="empty">No classes yet. Bring in the workbook, or add classes by hand.</p>
          ) : (
            <ul className="class-rows" aria-label={`Classes on day ${mi + 1}`}>
              {meet.classes.map((c) => (
                <li key={c.id}>
                  <span className="classno">{c.id}</span>
                  <label className="field">
                    <span>Class</span>
                    <input value={c.name} onChange={(e) => setClass(meet.id, c.id, (x) => ({ ...x, name: e.target.value }))} />
                  </label>
                  <label className="field">
                    <span>Division</span>
                    <select
                      value={c.class_no}
                      onChange={(e) => {
                        const d = divisionFor(e.target.value)
                        setClass(meet.id, c.id, (x) => ({ ...x, class_no: d.class_no, rule_set: d.rule_set, card_family: d.card_family }))
                      }}
                    >
                      {DIVISIONS.map((d) => (
                        <option key={d.class_no} value={d.class_no}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Pattern</span>
                    <select value={c.pattern_id} onChange={(e) => onPatternPick(meet.id, c, e.target.value)}>
                      <option value="">Choose a pattern</option>
                      {draft.patterns.length > 0 && (
                        <optgroup label="In this show">
                          {draft.patterns.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name.trim() || 'New pattern'} ({p.boxes.length})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {library.length > 0 && (
                        <optgroup label="From other shows">
                          {library.map((p) => (
                            <option key={p.id} value={`lib:${p.id}`}>
                              {p.name} ({p.boxes.length})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <option value="new">New pattern…</option>
                    </select>
                  </label>
                  <span className="class-rows-riders">{c.entries.length === 1 ? '1 rider' : `${c.entries.length} riders`}</span>
                  <button
                    className="btn btn-small btn-danger"
                    aria-label={`Remove ${c.name || `class ${c.id}`}`}
                    onClick={() => setMeet(meet.id, (m) => ({ ...m, classes: m.classes.filter((x) => x.id !== c.id) }))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="row-actions">
            <button className="btn" onClick={() => setMeet(meet.id, (m) => ({ ...m, classes: [...m.classes, blankClass(m, DIVISIONS[0])] }))}>
              Add a class
            </button>
            {draft.meets.length > 1 && (
              <button
                className="btn btn-danger"
                onClick={() => {
                  if (meet.classes.length === 0 || window.confirm(`Remove ${meet.label || 'this day'} and its ${meet.classes.length} classes?`))
                    setDraft((d) => ({ ...d, meets: d.meets.filter((m) => m.id !== meet.id) }))
                }}
              >
                Remove this day
              </button>
            )}
          </div>
        </section>
      ))}
      <div className="row-actions">
        <button
          className="btn"
          onClick={() =>
            setDraft((d) => {
              const used = new Set(d.meets.map((m) => m.id))
              let n = d.meets.length + 1
              while (used.has(`${d.id}-m${n}`)) n += 1
              return { ...d, meets: [...d.meets, blankMeet(d.id, n, d.meets.length === 1 ? 'Sunday' : `Day ${d.meets.length + 1}`)] }
            })
          }
        >
          Add a day
        </button>
      </div>

      <h2>Patterns</h2>
      <PatternBookReader show={draft} onAdd={setDraft} />
      {draft.patterns.length === 0 ? (
        <p className="empty">No patterns yet. Choose one for a class above, or start a new one there.</p>
      ) : (
        <ul className="list">
          {draft.patterns.map((p) => {
            const uses = draft.meets.reduce((n, m) => n + m.classes.filter((c) => c.pattern_id === p.id).length, 0)
            return (
              <li key={p.id} className="pattern-row">
                <div className="pattern-row-head">
                  <span className="row-main">
                    <strong>{p.name.trim() || 'New pattern'}</strong>
                    <span className="muted">
                      {p.boxes.length} maneuvers, used by {uses === 1 ? '1 class' : `${uses} classes`}
                    </span>
                    <span className="pattern-codes">
                      {p.boxes.map((b, i) => (
                        <span key={i}>{b.abbr ? <Code value={b.abbr} /> : i + 1}</span>
                      ))}
                    </span>
                  </span>
                  <button className="btn btn-small" onClick={() => setEditing(editing === p.id ? null : p.id)}>
                    {editing === p.id ? 'Close' : 'Edit'}
                  </button>
                  {uses === 0 && (
                    <button
                      className="btn btn-small btn-danger"
                      onClick={() => setDraft((d) => ({ ...d, patterns: d.patterns.filter((x) => x.id !== p.id) }))}
                    >
                      Remove
                    </button>
                  )}
                </div>
                {open && open.id === p.id && <PatternEditor pattern={open} onChange={setPattern} onClose={() => setEditing(null)} />}
              </li>
            )
          })}
        </ul>
      )}
      <p className="hint">
        The boxes must match the judge’s score sheet, which can group a pattern’s numbered steps differently from the
        pattern book.
      </p>

      <h2>Save</h2>
      {problems.length > 0 && (
        <ul className="warning problems" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="row-actions">
        <button className="btn btn-primary btn-wide" onClick={save}>
          Save the show
        </button>
      </div>
      <p className="hint">
        Saving keeps the show on this computer. From the show’s screen you can then download its show file and send it
        to each phone or tablet that will score.
      </p>
    </Screen>
  )
}
