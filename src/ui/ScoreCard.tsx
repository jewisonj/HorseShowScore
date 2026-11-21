import { useEffect, useState } from 'react'
import { formatHalf, type Half, type Mark } from '../engine'
import { boxLabel, classKey, getClass, getPattern } from '../data/fixture'
import { totalFor } from '../results'
import { ruleSetFor } from '../rules/rulesets'
import { classState, removeRun, saveRun, useAppState, type Run } from '../store'
import { BackNumber, go } from './bits'

const MARK_LABEL: Record<Mark, string> = {
  none: '',
  OP: 'Off pattern',
  ZERO: 'Score 0',
  DQ: 'DQ',
}

/** Keep the screen on while a card is open. Fails quietly where unsupported. */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    async function acquire() {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          const l = await navigator.wakeLock.request('screen')
          if (cancelled) void l.release()
          else lock = l
        }
      } catch {
        // Not supported, or the browser said no. The card still works.
      }
    }
    void acquire()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
    }
  }, [])
}

function firstOpenBox(run: Run | undefined): number {
  if (!run) return 0
  const i = run.boxes.findIndex((b) => b === null)
  return i === -1 ? run.boxes.length - 1 : i
}

function scoreClass(h: Half): string {
  return h > 0 ? 'plus' : h < 0 ? 'minus' : 'zero'
}

export function ScoreCard({ meetId, classNo, runId }: { meetId: string; classNo: string; runId: string }) {
  const state = useAppState()
  useWakeLock()

  const cls = getClass(meetId, classNo)
  const key = classKey(meetId, classNo)
  const run = cls ? classState(state, key).runs.find((r) => r.id === runId) : undefined

  const [sel, setSel] = useState(() => firstOpenBox(run))
  const [history, setHistory] = useState<{ run: Run; sel: number }[]>([])

  // Long patterns wrap to several rows. Keep the box being scored in view.
  useEffect(() => {
    document.querySelector('.box-sel')?.scrollIntoView?.({ block: 'nearest' })
  }, [sel])

  const base = `/m/${meetId}/c/${classNo}`

  if (!cls || !run) {
    return (
      <div className="screen">
        <header className="topbar">
          <div className="topbar-row">
            <button className="back" onClick={() => go(base)}>
              <span aria-hidden="true">‹</span> Class
            </button>
            <div className="topbar-title">
              <h1>Rider not found</h1>
            </div>
          </div>
        </header>
        <main className="content">
          <p className="hint">This rider is no longer in the class.</p>
        </main>
      </div>
    )
  }

  const pattern = getPattern(cls.pattern_id)
  const rules = ruleSetFor(cls.rule_set)
  const total = totalFor(run, cls)
  const current = pattern.boxes[sel]
  const blank = run.boxes.filter((b) => b === null).length

  /** Every change goes to storage right away. The previous state is kept for Undo. */
  function change(next: Run, nextSel = sel) {
    setHistory((h) => [...h.slice(-49), { run: run!, sel }])
    saveRun(key, next)
    setSel(nextSel)
  }

  function score(value: Half) {
    const boxes = run!.boxes.slice()
    boxes[sel] = value
    change({ ...run!, boxes }, Math.min(sel + 1, boxes.length - 1))
  }

  function addPenalty(value: Half) {
    change({ ...run!, penalties: [...run!.penalties, { half: value, box: sel }] })
  }

  function removePenalty(index: number) {
    change({ ...run!, penalties: run!.penalties.filter((_, i) => i !== index) })
  }

  function toggleMark(mark: Mark) {
    change({ ...run!, mark: run!.mark === mark ? 'none' : mark })
  }

  function undo() {
    const last = history[history.length - 1]
    if (!last) return
    setHistory((h) => h.slice(0, -1))
    saveRun(key, last.run)
    setSel(last.sel)
  }

  function finish() {
    if (blank > 0 && run!.mark === 'none') {
      const what = blank === 1 ? '1 maneuver has no score' : `${blank} maneuvers have no score`
      if (!window.confirm(`${what}. Save the run anyway?`)) return
    }
    saveRun(key, { ...run!, scored: true })
    go(base)
  }

  function remove() {
    if (!window.confirm(`Remove #${run!.backNo} and their scores from this class?`)) return
    removeRun(key, run!.id)
    go(base)
  }

  let totalText = formatHalf(total.arithmetic)
  if (run.mark === 'ZERO') totalText = '0'
  if (run.mark === 'DQ') totalText = 'DQ'

  return (
    <div className="screen card-screen">
      <header className="topbar">
        <div className="topbar-row">
          <button className="back" onClick={() => go(base)}>
            <span aria-hidden="true">‹</span> Class
          </button>
          <div className="topbar-title">
            <h1>{cls.name}</h1>
            <p>{pattern.name}</p>
          </div>
        </div>
        <div className="card-head">
          <BackNumber value={run.backNo} size="lg" />
          <div className="total" aria-live="polite">
            <span className="total-value">
              {totalText}
              {run.mark === 'OP' && <span className="total-mark">OP</span>}
            </span>
            <span className="total-parts">
              Maneuvers {formatHalf(total.boxSum, { sign: true })}, penalties {formatHalf(total.penaltySum)}
            </span>
          </div>
        </div>
      </header>
      <p className="shadow-note" role="note">
        Unofficial test. Not the official record.
      </p>

      <main className="content card-content">
        <div className="boxes" role="group" aria-label="Maneuvers">
          {pattern.boxes.map((box, i) => {
            const value = run.boxes[i]
            const pens = run.penalties.filter((p) => p.box === i)
            return (
              <button
                key={box.n}
                className={`box${i === sel ? ' box-sel' : ''}`}
                aria-pressed={i === sel}
                aria-label={`Maneuver ${box.n}${box.label ? `, ${box.label}` : ''}${value === null ? ', not scored' : `, ${formatHalf(value, { sign: true })}`}`}
                onClick={() => setSel(i)}
              >
                <span className="box-n">{box.n}</span>
                <span className={`box-pen${pens.length ? ' has-pen' : ''}`}>
                  {pens.map((p) => formatHalf(p.half)).join(' ')}
                </span>
                <span className={`box-score ${value === null ? '' : scoreClass(value)}`}>
                  {value === null ? '' : formatHalf(value, { sign: true })}
                </span>
              </button>
            )
          })}
        </div>

        <p className="hint">{rules.note}</p>
        <button className="textbtn" onClick={remove}>
          Remove this rider from the class
        </button>
      </main>

      <div className="pad">
        <div className="current">
          <p className="current-label">
            <strong>{boxLabel(current)}</strong>
          </p>
          {run.penalties.some((p) => p.box === sel) && (
            <p className="current-pens">
              Penalties here:
              {run.penalties.map((p, index) =>
                p.box === sel ? (
                  <button key={index} className="chip" onClick={() => removePenalty(index)}>
                    {formatHalf(p.half)} <span aria-hidden="true">×</span>
                    <span className="sr-only"> remove</span>
                  </button>
                ) : null,
              )}
            </p>
          )}
        </div>
        <div className="pad-scores" role="group" aria-label="Maneuver score">
          {rules.boxScale.map((value) => (
            <button
              key={value}
              className={`key key-score ${scoreClass(value)} s${value < 0 ? 'm' : 'p'}${Math.abs(value)}`}
              onClick={() => score(value)}
            >
              {formatHalf(value, { sign: true })}
            </button>
          ))}
        </div>
        <div className="pad-row" role="group" aria-label="Penalty">
          <span className="pad-label">Penalty</span>
          {rules.penaltyValues.map((value) => (
            <button key={value} className="key key-pen" onClick={() => addPenalty(value)}>
              {formatHalf(value)}
            </button>
          ))}
          <button className="key key-undo" onClick={undo} disabled={history.length === 0}>
            Undo
          </button>
        </div>
        <div className="pad-row">
          {rules.marks.map((mark) => (
            <button
              key={mark}
              className={`key key-mark${run.mark === mark ? ' is-on' : ''}`}
              aria-pressed={run.mark === mark}
              onClick={() => toggleMark(mark)}
            >
              {MARK_LABEL[mark]}
            </button>
          ))}
          <button className="key key-save" onClick={finish}>
            Save run
          </button>
        </div>
      </div>
    </div>
  )
}
