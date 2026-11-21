import { useState } from 'react'
import { formatHalf } from '../engine'
import { classKey, getClass, getMeet, getPattern, hasLabels } from '../data/fixture'
import { classResults, placingWarnings, totalFor } from '../results'
import { ruleSetFor } from '../rules/rulesets'
import { addRiders, classState, parseBackNumbers, useAppState, type Run } from '../store'
import { BackNumber, Ribbon, Screen, go, pts } from './bits'

function inProgress(run: Run): boolean {
  return !run.scored && (run.boxes.some((b) => b !== null) || run.penalties.length > 0 || run.mark !== 'none')
}

export function ClassScreen({ meetId, classNo }: { meetId: string; classNo: string }) {
  const state = useAppState()
  const [text, setText] = useState('')
  const [showPattern, setShowPattern] = useState(false)
  const [notice, setNotice] = useState('')

  const meet = getMeet(meetId)
  const cls = getClass(meetId, classNo)
  if (!meet || !cls) {
    return (
      <Screen title="Class not found" backTo="/" backLabel="Meets">
        <p className="hint">This class is not in the test data.</p>
      </Screen>
    )
  }
  const pattern = getPattern(cls.pattern_id)
  const rules = ruleSetFor(cls.rule_set)
  const key = classKey(meetId, classNo)
  const cs = classState(state, key)
  const results = classResults(cs, cls)
  const warnings = cls.card_family === 'placings' ? placingWarnings(cs, cls) : []
  const base = `/m/${meetId}/c/${classNo}`

  function onAdd() {
    const numbers = parseBackNumbers(text)
    if (numbers.length === 0) return
    const added = addRiders(key, numbers, pattern.boxes.length)
    setText('')
    const skipped = numbers.length - added
    setNotice(skipped > 0 ? `${skipped} already in this class, not added again.` : '')
  }

  return (
    <Screen title={cls.name} sub={`Class ${cls.class_no}, ${meet.label}`} backTo={`/m/${meetId}`} backLabel="Classes">
      <section className="panel">
        <button className="disclosure" aria-expanded={showPattern} onClick={() => setShowPattern(!showPattern)}>
          <span className="disclosure-text">
            <strong>{pattern.name}</strong>
            <span className="muted">{pattern.boxes.length} maneuvers</span>
          </span>
          <span className="disclosure-action">{showPattern ? 'Hide' : 'Show'}</span>
        </button>
        {showPattern && (
          <div className="pattern">
            {cls.notes && <p>{cls.notes}</p>}
            {pattern.start_note && <p className="muted">Start: {pattern.start_note}</p>}
            {hasLabels(pattern) ? (
              <ol>
                {pattern.boxes.map((b) => (
                  <li key={b.n}>{b.label}</li>
                ))}
              </ol>
            ) : (
              <p>
                The card has {pattern.boxes.length} numbered boxes. Maneuver wording is not loaded, so follow the
                show’s pattern sheet.
              </p>
            )}
            {pattern.finish_note && <p className="muted">Finish: {pattern.finish_note}</p>}
            <p className="muted">Diagram: page {pattern.source_page} of the show’s pattern book.</p>
          </div>
        )}
      </section>

      <h2>Riders</h2>
      <form
        className="addform"
        onSubmit={(e) => {
          e.preventDefault()
          onAdd()
        }}
      >
        <label htmlFor="backnos">Add back numbers</label>
        <div className="addform-row">
          <input
            id="backnos"
            value={text}
            onChange={(e) => setText(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            placeholder="214 187 302"
          />
          <button className="btn btn-primary" type="submit">
            Add
          </button>
        </div>
        {notice && (
          <p className="hint" role="status">
            {notice}
          </p>
        )}
      </form>

      {cs.runs.length === 0 ? (
        <p className="empty">No riders yet. Type the back numbers for this class, with spaces between them.</p>
      ) : (
        <ul className="list">
          {cs.runs.map((run) => {
            const t = totalFor(run, cls)
            let status = cls.card_family === 'placings' ? 'Pattern not scored' : 'Not scored'
            if (run.scored) status = t.score === null ? 'DQ' : formatHalf(t.score)
            else if (inProgress(run)) status = 'In progress'
            return (
              <li key={run.id}>
                <button className="row" onClick={() => go(`${base}/r/${run.id}`)}>
                  <BackNumber value={run.backNo} />
                  <span className="row-main">
                    <strong className={run.scored ? 'score' : 'muted'}>{status}</strong>
                    {run.mark !== 'none' && run.mark !== 'DQ' && <span className="tag">{run.mark}</span>}
                  </span>
                  <span className="row-side">{run.scored ? 'Edit' : 'Score'}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {cls.card_family === 'placings' && cs.runs.length > 0 && (
        <button className="btn btn-primary btn-wide" onClick={() => go(`${base}/place`)}>
          {cs.placings.length > 0 ? 'Change the placings' : 'Place the class'}
        </button>
      )}

      {results.length > 0 && (
        <>
          <h2>{cls.card_family === 'placings' ? 'Placings' : 'Results'}</h2>
          <ul className="list results">
            {results.map((row) => (
              <li key={row.run.id} className="result">
                <Ribbon place={row.place} />
                <BackNumber value={row.run.backNo} size="sm" />
                <span className="result-score">
                  {row.score === null ? (row.run.mark === 'DQ' ? 'DQ' : '') : formatHalf(row.score)}
                  {row.run.mark === 'OP' && <span className="tag">OP</span>}
                  {row.tied && <span className="tag tag-warn">Tie, judge breaks it</span>}
                </span>
                <span className="result-points">{row.place !== null ? pts(row.points) : ''}</span>
              </li>
            ))}
          </ul>
          {warnings.map((w) => (
            <p key={w} className="warning" role="alert">
              {w}
            </p>
          ))}
          <p className="hint">Unverified. Points use the IHSA table: 7, 5, 4, 3, 2, 1.</p>
        </>
      )}

      <p className="hint">{rules.note}</p>
    </Screen>
  )
}
