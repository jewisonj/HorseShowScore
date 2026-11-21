import { useState } from 'react'
import { formatHalf, type Half } from '../engine'
import { classKey, getClass, getMeet } from '../data/fixture'
import { ruleSetFor } from '../rules/rulesets'
import { classState, saveRun, useAppState, type Run } from '../store'
import { BackNumber, Screen, go } from './bits'
import { ScoreKeys, scoreClass } from './ScoreKeys'

function railOf(run: Run): Half | null {
  return run.extras?.rail ?? null
}

/**
 * Rail work for a whole class on one screen.
 * The rail goes first, with every rider in the ring, so the judge gives these
 * scores together before anyone rides a pattern.
 */
export function RailScreen({ meetId, classId }: { meetId: string; classId: string }) {
  const state = useAppState()
  const meet = getMeet(meetId)
  const cls = getClass(meetId, classId)
  const key = classKey(meetId, classId)
  const runs = cls ? classState(state, key).runs : []
  const rail = cls ? ruleSetFor(cls.rule_set).extras.find((e) => e.id === 'rail') : undefined

  const [selId, setSelId] = useState<string | null>(() => runs.find((r) => railOf(r) === null)?.id ?? runs[0]?.id ?? null)
  const base = `/m/${meetId}/c/${classId}`

  if (!meet || !cls || !rail) {
    return (
      <Screen title="Rail work" backTo={base} backLabel="Class">
        <p className="hint">This class has no rail work score.</p>
      </Screen>
    )
  }

  const sel = runs.find((r) => r.id === selId) ?? null
  const left = runs.filter((r) => railOf(r) === null).length

  function give(value: Half | null) {
    if (!sel) return
    saveRun(key, { ...sel, extras: { ...sel.extras, rail: value } })
    if (value === null) return
    // Move on to the next rider in the list who has no rail score yet.
    const at = runs.findIndex((r) => r.id === sel.id)
    const rest = [...runs.slice(at + 1), ...runs.slice(0, at)]
    const next = rest.find((r) => railOf(r) === null)
    if (next) setSelId(next.id)
  }

  return (
    <div className="screen card-screen">
      <header className="topbar">
        <div className="topbar-row">
          <button className="back" onClick={() => go(base)}>
            <span aria-hidden="true">‹</span> Class
          </button>
          <div className="topbar-title">
            <h1>Rail work</h1>
            <p>
              {cls.name}, {meet.label}
            </p>
          </div>
        </div>
      </header>
      <p className="shadow-note" role="note">
        Unofficial test. Not the official record.
      </p>

      <main className="content card-content">
        {runs.length === 0 ? (
          <p className="empty">No riders in this class yet.</p>
        ) : (
          <ul className="list" aria-label="Riders">
            {runs.map((run) => {
              const value = railOf(run)
              return (
                <li key={run.id}>
                  <button
                    className={`row rail-row${run.id === selId ? ' is-sel' : ''}`}
                    aria-pressed={run.id === selId}
                    aria-label={`Back number ${run.backNo}${run.rider ? `, ${run.rider}` : ''}. Rail work ${value === null ? 'not scored' : formatHalf(value, { sign: true })}`}
                    onClick={() => setSelId(run.id)}
                  >
                    {run.draw !== undefined && <span className="draw">{run.draw}</span>}
                    <BackNumber value={run.backNo} />
                    <span className="row-main">
                      {run.rider && <strong className="rider-name">{run.rider}</strong>}
                      {run.horse && <span className="horse">{run.horse}</span>}
                    </span>
                    <span className={`rail-value ${value === null ? '' : scoreClass(value)}`}>
                      {value === null ? '' : formatHalf(value, { sign: true })}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <p className="hint">{rail.hint} It is added to each rider’s pattern score.</p>
      </main>

      <div className="pad">
        <div className="current">
          <p className="current-label">
            <strong>{sel ? `#${sel.backNo}${sel.rider ? ` ${sel.rider}` : ''}` : 'Pick a rider'}</strong>
          </p>
          <p className="current-hint">
            {left === 0 ? 'Every rider has a rail score.' : left === 1 ? '1 rider left.' : `${left} riders left.`}
          </p>
        </div>
        <ScoreKeys scale={rail.scale} signed={rail.signed} label="Rail work" onPick={give} />
        <div className="pad-row">
          <button className="key key-undo" disabled={!sel || railOf(sel) === null} onClick={() => give(null)}>
            Clear this one
          </button>
          <button className="key key-save" onClick={() => go(base)}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
