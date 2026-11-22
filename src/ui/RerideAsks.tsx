import { useState } from 'react'
import { answerRerideAsk, useRerideAsks } from '../cloud/rerides'
import { classKey, getClass, getMeet, showOfMeet } from '../data/fixture'
import { classState, useAppState } from '../store'
import { beginReride, firstRerideHorse, RerideHorsePicker } from './CallReride'
import { go } from './bits'

/**
 * On the judge's class list: the re-rides a steward has asked for in this
 * class. The judge approves, with the horse, or denies. Approving starts the
 * re-ride on this device exactly as calling one does.
 */
export function ClassRerideAsks({ meetId, classId }: { meetId: string; classId: string }) {
  const state = useAppState()
  const show = showOfMeet(meetId)
  const { asks } = useRerideAsks(show?.id)
  const [horses, setHorses] = useState<Record<string, string>>({})
  const [said, setSaid] = useState('')
  const cls = getClass(meetId, classId)
  if (!show || !cls) return null
  const key = classKey(meetId, classId)
  const cs = classState(state, key)
  const waiting = asks.filter((a) => a.classKey === key && a.status === 'asked')

  return (
    <>
      {waiting.map((ask) => {
        const run = cs.runs.find((r) => r.backNo === ask.backNo)
        const horse = horses[ask.id] ?? firstRerideHorse(meetId, cls, cs)
        return (
          <div key={ask.id} className="reride-ask" role="group" aria-label={`Re-ride asked for ${ask.backNo}`}>
            <p>
              <strong>
                The steward asks for a re-ride for {ask.backNo}
                {run?.rider ? `, ${run.rider}` : ''}.
              </strong>
              {ask.reason ? ` ${ask.reason}` : ''}
            </p>
            {run ? (
              <RerideHorsePicker meetId={meetId} cls={cls} cs={cs} value={horse} onChange={(h) => setHorses({ ...horses, [ask.id]: h })} />
            ) : (
              <p>That back number is not in this class on this device.</p>
            )}
            <div className="row-actions">
              <button
                className="btn btn-primary"
                disabled={!run || horse === ''}
                onClick={() => {
                  if (!run) return
                  const done = beginReride(key, cs, run.id, horse)
                  if (!done) return
                  setSaid(`Re-ride approved for ${done.backNo}${done.horse ? ` on ${done.horse}` : ''}. They ride last, on a clear card.`)
                  void answerRerideAsk(show.id, ask.id, true)
                }}
              >
                Approve the re-ride
              </button>
              <button
                className="btn"
                onClick={() => {
                  setSaid(`Re-ride denied for ${ask.backNo}.`)
                  void answerRerideAsk(show.id, ask.id, false)
                }}
              >
                Deny
              </button>
            </div>
          </div>
        )
      })}
      {said && (
        <p className="hint" role="status">
          {said}
        </p>
      )}
    </>
  )
}

/** On the judge's day screen: which classes have a re-ride waiting for an answer. */
export function DayRerideAsks({ meetId }: { meetId: string }) {
  const show = showOfMeet(meetId)
  const meet = getMeet(meetId)
  const { asks } = useRerideAsks(show?.id)
  if (!show || !meet) return null
  const waiting = asks.filter((a) => a.status === 'asked' && a.classKey.startsWith(`${meetId}:`))
  if (waiting.length === 0) return null
  return (
    <div className="reride-ask" role="group" aria-label="Re-rides asked for">
      <p>
        <strong>{waiting.length === 1 ? 'The steward asks for a re-ride.' : `The steward asks for ${waiting.length} re-rides.`}</strong>
      </p>
      <div className="stack">
        {waiting.map((ask) => {
          const cls = meet.classes.find((c) => classKey(meetId, c.id) === ask.classKey)
          return (
            <button key={ask.id} className="btn" onClick={() => go(`/m/${meetId}/c/${cls?.id ?? ''}`)} disabled={!cls}>
              {ask.backNo} in {cls ? `${cls.id}. ${cls.name}` : 'a class this device does not have'}
            </button>
          )
        })}
      </div>
    </div>
  )
}
