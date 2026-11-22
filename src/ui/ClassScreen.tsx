import { useState } from 'react'
import { formatHalf } from '../engine'
import { classKey, getClass, getMeet, getPattern } from '../data/fixture'
import { classResults, placingWarnings, sheetPlacings, totalFor } from '../results'
import { PLACINGS_FIRST_CELL } from '../setup/workbook'
import { ruleSetFor } from '../rules/rulesets'
import { addRiders, classState, parseBackNumbers, setClassFinished, useAppState } from '../store'
import { BackNumber, Code, Ribbon, Screen, go, pts } from './bits'
import { PatternPagePicture } from './PatternPagePicture'

export function ClassScreen({ meetId, classId }: { meetId: string; classId: string }) {
  const state = useAppState()
  const [text, setText] = useState('')
  const [showPattern, setShowPattern] = useState(false)
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState<{ note: string; text: string; show: boolean } | null>(null)

  const meet = getMeet(meetId)
  const cls = getClass(meetId, classId)
  if (!meet || !cls) {
    return (
      <Screen title="Class not found" backTo="/" backLabel="Shows">
        <p className="hint">This class is not in any show on this device.</p>
      </Screen>
    )
  }
  const pattern = getPattern(cls.pattern_id)
  const rules = ruleSetFor(cls.rule_set)
  const key = classKey(meetId, classId)
  const cs = classState(state, key)
  const results = classResults(cs, cls)
  const warnings = cls.card_family === 'placings' ? placingWarnings(cs, cls) : []
  const base = `/m/${meetId}/c/${classId}`
  const hasRail = rules.extras.some((e) => e.id === 'rail')
  const railLeft = cs.runs.filter((r) => (r.extras?.rail ?? null) === null).length

  // The show workbook takes placings one per draw place, so this needs riders that came from a draw.
  const fromDraw = cs.runs.length > 0 && cs.runs.every((r) => r.draw !== undefined)

  async function copyForSheet() {
    const text = sheetPlacings(cs, cls!).join('\n')
    const where = `In the sheet, open the “${cls!.name}” tab, click the first Placings cell (${PLACINGS_FIRST_CELL}) and paste. Paste as values only.`
    try {
      await navigator.clipboard.writeText(text)
      setCopied({ note: `Copied. ${where}`, text, show: false })
    } catch {
      setCopied({ note: `This device would not copy by itself. Select the lines below and copy them. ${where}`, text, show: true })
    }
  }

  function onAdd() {
    const numbers = parseBackNumbers(text)
    if (numbers.length === 0) return
    const added = addRiders(key, numbers, pattern.boxes.length)
    setText('')
    const skipped = numbers.length - added
    setNotice(skipped > 0 ? `${skipped} already in this class, not added again.` : '')
  }

  return (
    <Screen title={cls.name} sub={`Class ${cls.id}, ${meet.label}`} backTo={`/m/${meetId}`} backLabel="Classes">
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
            <ol className="boxlist">
              {pattern.boxes.map((b) => (
                <li key={b.n}>
                  <span className="boxlist-row">
                    <span className="boxlist-code">
                      <Code value={b.abbr} />
                    </span>
                    <span>{b.label}</span>
                  </span>
                </li>
              ))}
            </ol>
            <PatternPagePicture path={pattern.page_image} name={pattern.name} />
            {rules.extras.length > 0 && (
              <p>Then {rules.extras.map((e) => e.label.toLowerCase().replace('form and effectiveness', 'F&E')).join(' and ')}, added to the score.</p>
            )}
            <p className="muted">
              {pattern.source_page > 0
                ? `These boxes follow our reading of the pattern book, page ${pattern.source_page}. `
                : 'These boxes were entered in setup. '}
              They must match the judge’s score sheet, which can group the maneuvers differently.
            </p>
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

      {hasRail && cs.runs.length > 0 && (
        <button className="btn btn-primary btn-wide rail-first" onClick={() => go(`${base}/rail`)}>
          {railLeft === 0 ? 'Change the rail work scores' : 'Score the rail work first'}
        </button>
      )}

      {cs.runs.length === 0 ? (
        <p className="empty">No riders yet. Type the back numbers for this class, with spaces between them.</p>
      ) : (
        <ul className="list">
          {cs.runs.map((run) => {
            const t = totalFor(run, cls)
            // A blank right side means not scored yet. It leaves the name room on a narrow phone.
            let status = ''
            const railScore = run.extras?.rail ?? null
            const patternStarted = run.boxes.some((b) => b !== null) || run.penalties.length > 0 || run.mark !== 'none'
            if (run.scored) status = t.score === null ? 'DQ' : formatHalf(t.score)
            else if (patternStarted || (run.extras?.fe ?? null) !== null) status = 'Started'
            else if (railScore !== null) status = `Rail ${formatHalf(railScore, { sign: true })}`
            return (
              <li key={run.id}>
                <button
                  className="row"
                  aria-label={`Back number ${run.backNo}${run.rider ? `, ${run.rider}` : ''}${run.horse ? `, on ${run.horse}` : ''}. ${status === '' ? 'Not scored' : status}`}
                  onClick={() => go(`${base}/r/${run.id}`)}
                >
                  {run.draw !== undefined && <span className="draw" aria-label={`Draw ${run.draw}`}>{run.draw}</span>}
                  <BackNumber value={run.backNo} />
                  <span className="row-main">
                    {run.rider && <strong className="rider-name">{run.rider}</strong>}
                    {run.horse && <span className="horse">{run.horse}</span>}
                  </span>
                  <span className="row-side row-status">
                    <span className={run.scored ? 'score' : undefined}>{status}</span>
                    {run.mark !== 'none' && run.mark !== 'DQ' && <span className="tag">{run.mark}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {(cls.alternates ?? []).length > 0 && (
        <p className="alternates">
          <strong>Alternate horses:</strong> {(cls.alternates ?? []).join(', ')}
        </p>
      )}

      {hasRail && cs.runs.length > 0 && (
        <button className="btn btn-wide" onClick={() => go(`${base}/rail`)}>
          {railLeft === 0 ? 'Open the rail work scores' : 'Score the rail work'}
        </button>
      )}

      {cls.card_family === 'placings' && cs.runs.length > 0 && (
        <button className="btn btn-primary btn-wide" onClick={() => go(`${base}/place`)}>
          {cs.placings.length > 0 ? 'Change the placings' : 'Place the class'}
        </button>
      )}

      {cs.runs.length > 0 && (
        <>
          <button className={cs.finished ? 'btn btn-wide' : 'btn btn-primary btn-wide'} onClick={() => setClassFinished(key, !cs.finished)}>
            {cs.finished ? 'Reopen this class' : 'Mark this class finished'}
          </button>
          <p className="hint" role="status">
            {cs.finished
              ? 'Marked finished. The show office can publish the placings. Scores can still be corrected.'
              : 'Mark the class finished when every rider is scored. It tells the show office the placings are ready.'}
          </p>
        </>
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
                  {row.run.rider && <span className="result-name">{row.run.rider}</span>}
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
          {fromDraw && (
            <>
              <button className="btn btn-wide" onClick={copyForSheet}>
                Copy placings for the sheet
              </button>
              {copied && (
                <div className="hint" role="status">
                  <p>{copied.note}</p>
                  {copied.show && <textarea readOnly rows={12} value={copied.text} aria-label="Placings to paste" onFocus={(e) => e.target.select()} />}
                </div>
              )}
            </>
          )}
        </>
      )}

      <p className="hint">{rules.note}</p>
    </Screen>
  )
}
