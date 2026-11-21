import { useState } from 'react'
import { formatHalf, pointsForPlace } from '../engine'
import { classKey, getClass, getMeet } from '../data/fixture'
import { placingWarnings, totalFor } from '../results'
import { classState, saveRun, setPlacings, useAppState, type Run } from '../store'
import { BackNumber, Ribbon, Screen, go, pts } from './bits'

type Mode = 'place' | 'op'

function byBackNumber(a: Run, b: Run): number {
  return a.backNo.localeCompare(b.backNo, undefined, { numeric: true })
}

export function PlacingsScreen({ meetId, classId }: { meetId: string; classId: string }) {
  const state = useAppState()
  const [mode, setMode] = useState<Mode>('place')

  const meet = getMeet(meetId)
  const cls = getClass(meetId, classId)
  const base = `/m/${meetId}/c/${classId}`
  if (!meet || !cls) {
    return (
      <Screen title="Class not found" backTo="/" backLabel="Shows">
        <p className="hint">This class is not in any show on this device.</p>
      </Screen>
    )
  }

  const key = classKey(meetId, classId)
  const cs = classState(state, key)
  const byId = new Map(cs.runs.map((r) => [r.id, r]))
  const placed = cs.placings.map((id) => byId.get(id)).filter((r): r is Run => r !== undefined)
  const scoreOf = (r: Run) => (r.scored ? totalFor(r, cls).score : null)

  // Suggest an order: riders with a pattern score first, best score first.
  const unplaced = cs.runs
    .filter((r) => !cs.placings.includes(r.id))
    .sort((a, b) => {
      const sa = scoreOf(a)
      const sb = scoreOf(b)
      if (sa !== null && sb !== null && sa !== sb) return sb - sa
      if (sa !== null && sb === null) return -1
      if (sa === null && sb !== null) return 1
      return (a.draw ?? 999) - (b.draw ?? 999) || byBackNumber(a, b)
    })

  const warnings = placingWarnings(cs, cls)

  function toggleOp(run: Run) {
    saveRun(key, { ...run, mark: run.mark === 'OP' ? 'none' : 'OP' })
  }

  function tapUnplaced(run: Run) {
    if (mode === 'op') toggleOp(run)
    else setPlacings(key, [...cs.placings, run.id])
  }

  function tapPlaced(run: Run) {
    if (mode === 'op') toggleOp(run)
    else setPlacings(key, cs.placings.filter((id) => id !== run.id))
  }

  return (
    <Screen title="Place the class" sub={`${cls.name}, ${meet.label}`} backTo={base} backLabel="Class">
      <div className="segmented" role="group" aria-label="What a tap does">
        <button className={mode === 'place' ? 'is-on' : ''} aria-pressed={mode === 'place'} onClick={() => setMode('place')}>
          Tap to place
        </button>
        <button className={mode === 'op' ? 'is-on' : ''} aria-pressed={mode === 'op'} onClick={() => setMode('op')}>
          Tap to mark OP
        </button>
      </div>

      <h2>Placed</h2>
      {placed.length === 0 ? (
        <p className="empty">Nobody placed yet. Tap riders below in the judge’s order, first place first.</p>
      ) : (
        <ol className="list placed">
          {placed.map((run, i) => {
            const s = scoreOf(run)
            return (
              <li key={run.id}>
                <button className="row" onClick={() => tapPlaced(run)}>
                  <Ribbon place={i + 1} />
                  <BackNumber value={run.backNo} />
                  <span className="row-main">
                    {run.rider && <strong className="rider-name">{run.rider}</strong>}
                    {s !== null && <span className="score">{formatHalf(s)}</span>}
                    {run.mark === 'OP' && <span className="tag">OP</span>}
                  </span>
                  <span className="row-side">{pts(pointsForPlace(i + 1))}</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
      {placed.length > 0 && mode === 'place' && <p className="hint">Tap a placed rider to take them back out.</p>}

      {warnings.map((w) => (
        <p key={w} className="warning" role="alert">
          {w}
        </p>
      ))}

      <h2>Not placed</h2>
      {unplaced.length === 0 ? (
        <p className="empty">Every rider in the class is placed.</p>
      ) : (
        <div className="chips">
          {unplaced.map((run) => {
            const s = scoreOf(run)
            return (
              <button key={run.id} className="pick" onClick={() => tapUnplaced(run)}>
                <BackNumber value={run.backNo} />
                <span className="pick-text">
                  {run.rider && <span className="rider-name">{run.rider}</span>}
                  {s !== null && <span className="score">{formatHalf(s)}</span>}
                </span>
                {run.mark === 'OP' && <span className="tag">OP</span>}
              </button>
            )
          })}
        </div>
      )}

      <div className="stack">
        <button className="btn btn-primary btn-wide" onClick={() => go(base)}>
          Done
        </button>
        {placed.length > 0 && (
          <button
            className="btn"
            onClick={() => {
              if (window.confirm('Clear the placings for this class?')) setPlacings(key, [])
            }}
          >
            Clear the placings
          </button>
        )}
      </div>
    </Screen>
  )
}
