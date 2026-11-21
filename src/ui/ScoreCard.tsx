import { useEffect, useState } from 'react'
import { formatHalf, type Half, type Mark } from '../engine'
import { boxLabel, classKey, getClass, getPattern, type PatternBox } from '../data/fixture'
import { totalFor } from '../results'
import { reasonById, reasonsFor, ruleSetFor, type ExtraBox, type PenaltyReason } from '../rules/rulesets'
import { classState, removeRun, saveRun, useAppState, type Penalty, type Run } from '../store'
import { BackNumber, Code, go } from './bits'

const MARK_LABEL: Record<Mark, string> = {
  none: '',
  OP: 'Off pattern',
  ZERO: 'Score 0',
  DQ: 'DQ',
}

/** A place on the card that takes a score: a maneuver box, or an extra such as rail work or F&E. */
type Slot = { kind: 'box'; box: PatternBox; index: number } | { kind: 'extra'; extra: ExtraBox }

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

function slotValue(run: Run, slot: Slot): Half | null {
  return slot.kind === 'box' ? run.boxes[slot.index] : (run.extras?.[slot.extra.id] ?? null)
}

/** Where to start: the first maneuver without a score, then the first empty extra. */
function firstOpenSlot(run: Run | undefined, slots: Slot[]): number {
  if (!run) return 0
  const open = slots.findIndex((s) => slotValue(run, s) === null)
  if (open !== -1) return open
  let lastBox = 0
  slots.forEach((s, i) => {
    if (s.kind === 'box') lastBox = i
  })
  return lastBox
}

function scoreClass(h: Half): string {
  return h > 0 ? 'plus' : h < 0 ? 'minus' : 'zero'
}

/** "½ point", "1 point", "3 point" */
function pointWord(half: Half): string {
  return `${formatHalf(half)} point`
}

function PenaltySheet(props: {
  title: string
  where: string
  reasons: PenaltyReason[]
  /** The reason already on the penalty, when changing one */
  current?: string
  circled: boolean
  editing: boolean
  onPick: (reasonId: string | undefined) => void
  onToggleCircle: () => void
  onRemove?: () => void
  onClose: () => void
}) {
  const { onClose } = props
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet-back" onClick={props.onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <h2>{props.title}</h2>
            <p>{props.where}</p>
          </div>
          <button className="btn sheet-close" onClick={props.onClose}>
            Cancel
          </button>
        </div>

        <button className={`circle-toggle${props.circled ? ' is-on' : ''}`} aria-pressed={props.circled} onClick={props.onToggleCircle}>
          <span className="circle-mark" aria-hidden="true" />
          <span>
            <strong>Circled</strong>: the horse’s fault. Not counted.
          </span>
        </button>

        <div className="reasons">
          {props.reasons.map((r) => (
            <button
              key={r.id}
              className={`reason${props.current === r.id ? ' is-current' : ''}`}
              aria-pressed={props.editing ? props.current === r.id : undefined}
              onClick={() => props.onPick(r.id)}
            >
              {r.text}
            </button>
          ))}
          <button
            className={`reason reason-plain${props.editing && props.current === undefined ? ' is-current' : ''}`}
            onClick={() => props.onPick(undefined)}
          >
            Just the number
          </button>
        </div>

        {props.onRemove && (
          <button className="btn btn-danger btn-wide" onClick={props.onRemove}>
            Remove this penalty
          </button>
        )}
      </div>
    </div>
  )
}

/** The score keys for whatever is selected: a signed maneuver scale, or a plain 0 to 5. */
function ScoreKeys(props: { scale: Half[]; signed: boolean; label: string; onPick: (value: Half) => void }) {
  if (!props.signed) {
    return (
      <div className="pad-plain" role="group" aria-label={props.label}>
        {props.scale.map((value) => (
          <button key={value} className="key key-score key-plain" onClick={() => props.onPick(value)}>
            {formatHalf(value)}
          </button>
        ))}
      </div>
    )
  }
  const steps = Math.max(...props.scale.map(Math.abs))
  return (
    <div className={`pad-scores pad-steps-${steps}`} role="group" aria-label={props.label}>
      {props.scale.map((value) => (
        <button
          key={value}
          className={`key key-score ${scoreClass(value)} s${value < 0 ? 'm' : 'p'}${Math.abs(value)}`}
          onClick={() => props.onPick(value)}
        >
          {formatHalf(value, { sign: true })}
        </button>
      ))}
    </div>
  )
}

export function ScoreCard({ meetId, classId, runId }: { meetId: string; classId: string; runId: string }) {
  const state = useAppState()
  useWakeLock()

  const cls = getClass(meetId, classId)
  const key = classKey(meetId, classId)
  const run = cls ? classState(state, key).runs.find((r) => r.id === runId) : undefined
  const pattern = cls ? getPattern(cls.pattern_id) : undefined
  const rules = cls ? ruleSetFor(cls.rule_set) : undefined
  const slots: Slot[] =
    pattern && rules
      ? [
          ...pattern.boxes.map((box, index): Slot => ({ kind: 'box', box, index })),
          ...rules.extras.map((extra): Slot => ({ kind: 'extra', extra })),
        ]
      : []

  const [sel, setSel] = useState(() => firstOpenSlot(run, slots))
  const [history, setHistory] = useState<{ run: Run; sel: number }[]>([])
  /** The open penalty question: a new penalty of this value, or a change to the one at `edit`. */
  const [ask, setAsk] = useState<{ half: Half; edit?: number } | null>(null)
  const [circleNew, setCircleNew] = useState(false)

  // Long patterns wrap to several rows. Keep the box being scored in view.
  useEffect(() => {
    document.querySelector('.box-sel')?.scrollIntoView?.({ block: 'nearest' })
  }, [sel])

  const base = `/m/${meetId}/c/${classId}`

  if (!cls || !run || !pattern || !rules) {
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

  const total = totalFor(run, cls)
  const current = slots[sel]
  const currentBox = current.kind === 'box' ? current : null
  const blankBoxes = run.boxes.filter((b) => b === null).length
  const blankExtras = rules.extras.filter((e) => (run.extras?.[e.id] ?? null) === null)

  /** Every change goes to storage right away. The previous state is kept for Undo. */
  function change(next: Run, nextSel = sel) {
    setHistory((h) => [...h.slice(-49), { run: run!, sel }])
    saveRun(key, next)
    setSel(nextSel)
  }

  function score(value: Half) {
    if (current.kind === 'extra') {
      change({ ...run!, extras: { ...run!.extras, [current.extra.id]: value } })
      return
    }
    const boxes = run!.boxes.slice()
    boxes[current.index] = value
    let next = sel
    if (current.index + 1 < boxes.length) {
      next = sel + 1
    } else {
      // After the last maneuver the judge gives F&E. Rail work is given on its own time.
      const fe = slots.findIndex((s) => s.kind === 'extra' && s.extra.id === 'fe')
      if (fe !== -1 && (run!.extras?.fe ?? null) === null) next = fe
    }
    change({ ...run!, boxes }, next)
  }

  function addPenalty(half: Half, reason: string | undefined, circled: boolean) {
    if (!currentBox) return
    const penalty: Penalty = { half, box: currentBox.index }
    if (reason) penalty.reason = reason
    if (circled) penalty.circled = true
    change({ ...run!, penalties: [...run!.penalties, penalty] })
  }

  /** A penalty key was tapped. Ask which penalty when the rule set lists more than one. */
  function tapPenalty(half: Half) {
    if (!currentBox) return
    const reasons = reasonsFor(rules!, half, currentBox.box.tags)
    if (reasons.length === 0) addPenalty(half, undefined, false)
    else if (reasons.length === 1) addPenalty(half, reasons[0].id, false)
    else {
      setCircleNew(false)
      setAsk({ half })
    }
  }

  function updatePenalty(index: number, fn: (p: Penalty) => Penalty) {
    change({ ...run!, penalties: run!.penalties.map((p, i) => (i === index ? fn(p) : p)) })
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
    if ((blankBoxes > 0 || blankExtras.length > 0) && run!.mark === 'none') {
      const missing = [
        ...(blankBoxes === 0 ? [] : [blankBoxes === 1 ? '1 maneuver' : `${blankBoxes} maneuvers`]),
        ...blankExtras.map((e) => e.label.toLowerCase().replace('form and effectiveness', 'F&E')),
      ]
      const many = missing.length > 1 || blankBoxes > 1
      const list = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}` : missing[0]
      const sentence = `${list.charAt(0).toUpperCase()}${list.slice(1)} ${many ? 'have' : 'has'} no score.`
      if (!window.confirm(`${sentence} Save the run anyway?`)) return
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

  const parts = [`Maneuvers ${formatHalf(total.boxSum, { sign: true })}`]
  for (const extra of rules.extras) {
    const v = run.extras?.[extra.id] ?? null
    if (v !== null) parts.push(`${extra.abbr.toLowerCase() === 'rail' ? 'rail' : extra.abbr} ${formatHalf(v, { sign: extra.signed })}`)
  }
  parts.push(`penalties ${formatHalf(total.penaltySum)}`)

  const editing = ask?.edit !== undefined ? run.penalties[ask.edit] : undefined
  const askBox = editing ? pattern.boxes[editing.box] : currentBox?.box

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
          <div className="rider">
            <BackNumber value={run.backNo} size="lg" />
            {run.horse && <span className="rider-horse">{run.horse}</span>}
          </div>
          <div className="total" aria-live="polite">
            <span className="total-value">
              {totalText}
              {run.mark === 'OP' && <span className="total-mark">OP</span>}
            </span>
            <span className="total-parts">
              {parts.map((part, i) => (
                <span key={part}>
                  {part}
                  {i < parts.length - 1 ? ', ' : ''}
                </span>
              ))}
            </span>
          </div>
        </div>
      </header>
      <p className="shadow-note" role="note">
        Unofficial test. Not the official record.
      </p>

      <main className="content card-content">
        <div className="boxes" role="group" aria-label="Maneuvers">
          {slots.map((slot, i) => {
            const value = slotValue(run, slot)
            if (slot.kind === 'extra') {
              const { extra } = slot
              return (
                <button
                  key={extra.id}
                  className={`box box-extra${i === sel ? ' box-sel' : ''}`}
                  aria-pressed={i === sel}
                  aria-label={`${extra.label}${value === null ? ', not scored' : `, ${formatHalf(value, { sign: extra.signed })}`}`}
                  onClick={() => setSel(i)}
                >
                  <span className="box-label">
                    <span className="box-abbr">{extra.abbr}</span>
                    <span className="box-text">{extra.id === 'fe' ? 'F&E' : extra.label}</span>
                  </span>
                  <span className="box-head" />
                  <span className={`box-score ${value === null || !extra.signed ? '' : scoreClass(value)}`}>
                    {value === null ? '' : formatHalf(value, { sign: extra.signed })}
                  </span>
                </button>
              )
            }
            const { box } = slot
            const pens = run.penalties.filter((p) => p.box === slot.index)
            return (
              <button
                key={box.n}
                className={`box${i === sel ? ' box-sel' : ''}`}
                aria-pressed={i === sel}
                aria-label={`Maneuver ${box.n}${box.label ? `, ${box.label}` : ''}${value === null ? ', not scored' : `, ${formatHalf(value, { sign: true })}`}`}
                onClick={() => setSel(i)}
              >
                <span className="box-label">
                  <span className="box-abbr">{box.abbr ? <Code value={box.abbr} /> : box.n}</span>
                  <span className="box-text">{box.label || `Maneuver ${box.n}`}</span>
                </span>
                <span className={`box-head${pens.length ? ' has-pen' : ''}`}>
                  <span className="box-n">{box.n}</span>
                  <span className="box-pen">
                    {pens.map((p, n) => (
                      <span key={n} className={p.circled ? 'pen pen-circled' : 'pen'}>
                        {formatHalf(p.half)}
                      </span>
                    ))}
                  </span>
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
          {currentBox ? (
            <>
              <p className="current-label">
                <strong>{boxLabel(currentBox.box)}</strong>
              </p>
              {run.penalties.some((p) => p.box === currentBox.index) && (
                <p className="current-pens">
                  Penalties here:
                  {run.penalties.map((p, index) => {
                    if (p.box !== currentBox.index) return null
                    const reason = reasonById(rules, p.half, p.reason)
                    return (
                      <button
                        key={index}
                        className={`chip${p.circled ? ' chip-circled' : ''}`}
                        aria-label={`Penalty ${formatHalf(p.half)}${reason ? `, ${reason.short}` : ''}${p.circled ? ', circled, not counted' : ''}. Change or remove`}
                        onClick={() => setAsk({ half: p.half, edit: index })}
                      >
                        <span className={p.circled ? 'pen pen-circled' : 'pen'}>{formatHalf(p.half)}</span>
                        {reason && <span className="chip-why">{reason.short}</span>}
                      </button>
                    )
                  })}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="current-label">
                <strong>{current.kind === 'extra' ? current.extra.label : ''}</strong>
              </p>
              <p className="current-hint">{current.kind === 'extra' ? current.extra.hint : ''}</p>
            </>
          )}
        </div>

        {current.kind === 'box' ? (
          <ScoreKeys scale={rules.boxScale} signed label="Maneuver score" onPick={score} />
        ) : (
          <ScoreKeys scale={current.extra.scale} signed={current.extra.signed} label={current.extra.label} onPick={score} />
        )}

        <div className="pad-row" role="group" aria-label="Penalty">
          <span className="pad-label">Penalty</span>
          {rules.penalties.map(({ half }) => (
            <button key={half} className="key key-pen" disabled={!currentBox} onClick={() => tapPenalty(half)}>
              {formatHalf(half)}
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

      {ask && askBox && (
        <PenaltySheet
          title={editing ? `${pointWord(ask.half)} penalty` : `Which ${pointWord(ask.half)} penalty?`}
          where={boxLabel(askBox)}
          reasons={reasonsFor(rules, ask.half, askBox.tags)}
          current={editing?.reason}
          circled={editing ? editing.circled === true : circleNew}
          editing={editing !== undefined}
          onPick={(reasonId) => {
            if (editing && ask.edit !== undefined) {
              updatePenalty(ask.edit, (p) => {
                const { reason: _old, ...rest } = p
                return reasonId ? { ...rest, reason: reasonId } : rest
              })
            } else {
              addPenalty(ask.half, reasonId, circleNew)
            }
            setAsk(null)
          }}
          onToggleCircle={() => {
            if (editing && ask.edit !== undefined) {
              updatePenalty(ask.edit, (p) => {
                const { circled: was, ...rest } = p
                return was ? rest : { ...rest, circled: true }
              })
            } else {
              setCircleNew((c) => !c)
            }
          }}
          onRemove={
            editing && ask.edit !== undefined
              ? () => {
                  removePenalty(ask.edit!)
                  setAsk(null)
                }
              : undefined
          }
          onClose={() => setAsk(null)}
        />
      )}
    </div>
  )
}
