import { useState } from 'react'
import { showOfMeet, type ShowClass } from '../data/fixture'
import { rerideHorses } from '../reride'
import { startReride, type ClassState } from '../store'

const SAME = '\u0000same'

/**
 * Pick the horse for a re-ride. The class's next alternate is offered first,
 * then every other horse in the show, then the horse the rider is already on.
 */
export function RerideHorsePicker(props: { meetId: string; cls: ShowClass; cs: ClassState; value: string; onChange: (horse: string) => void; label?: string }) {
  const { alternates, others } = rerideHorses(showOfMeet(props.meetId), props.cls, props.cs)
  return (
    <label className="field">
      <span>{props.label ?? 'Horse for the re-ride'}</span>
      <select aria-label={props.label ?? 'Horse for the re-ride'} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">Pick the horse</option>
        {alternates.length > 0 && (
          <optgroup label="Alternates for this class">
            {alternates.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label="Other horses">
            {others.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </optgroup>
        )}
        <option value={SAME}>The same horse</option>
      </select>
    </label>
  )
}

/** The horse a re-ride gets when nobody has picked one: the class's next alternate, or none. */
export function firstRerideHorse(meetId: string, cls: ShowClass, cs: ClassState): string {
  return rerideHorses(showOfMeet(meetId), cls, cs).alternates[0] ?? ''
}

/** Start the re-ride with what the picker holds. "The same horse" keeps the one the rider is on. */
export function beginReride(key: string, cs: ClassState, runId: string, picked: string): { backNo: string; horse: string } | null {
  const run = cs.runs.find((r) => r.id === runId)
  if (!run) return null
  const horse = picked === SAME ? run.horse ?? '' : picked
  if (!startReride(key, runId, horse)) return null
  return { backNo: run.backNo, horse }
}

/**
 * The judge calls a re-ride from the class list: which rider, on which horse.
 * The first ride stays in the history and stops counting. The rider goes to
 * the end of the class with a clear card.
 */
export function CallReride({ meetId, classKeyOf, cls, cs }: { meetId: string; classKeyOf: string; cls: ShowClass; cs: ClassState }) {
  const [open, setOpen] = useState(false)
  const [runId, setRunId] = useState('')
  const [horse, setHorse] = useState('')
  const [said, setSaid] = useState('')
  if (cs.runs.length === 0) return null

  function start() {
    const done = beginReride(classKeyOf, cs, runId, horse)
    if (!done) return
    setSaid(`Re-ride set for ${done.backNo}${done.horse ? ` on ${done.horse}` : ''}. They ride last, on a clear card. The first ride is kept and no longer counts.`)
    setOpen(false)
    setRunId('')
    setHorse('')
  }

  return (
    <div className="reride">
      <button
        className="btn btn-wide"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
          setSaid('')
          if (!open) setHorse(firstRerideHorse(meetId, cls, cs))
        }}
      >
        {open ? 'Close the re-ride' : 'Call a re-ride'}
      </button>
      {open && (
        <div className="reride-form">
          <label className="field">
            <span>Rider</span>
            <select aria-label="Rider for the re-ride" value={runId} onChange={(e) => setRunId(e.target.value)}>
              <option value="">Pick the rider</option>
              {cs.runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.backNo}
                  {run.rider ? ` ${run.rider}` : ''}
                  {run.horse ? `, on ${run.horse}` : ''}
                </option>
              ))}
            </select>
          </label>
          <RerideHorsePicker meetId={meetId} cls={cls} cs={cs} value={horse} onChange={setHorse} />
          <p className="hint">The rider's score is cleared and they go to the end of the class. The first ride is kept in the history and no longer counts.</p>
          <button className="btn btn-primary btn-wide" disabled={runId === '' || horse === ''} onClick={start}>
            Start the re-ride
          </button>
        </div>
      )}
      {said && (
        <p className="hint" role="status">
          {said}
        </p>
      )}
    </div>
  )
}
