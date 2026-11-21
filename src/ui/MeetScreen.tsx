import { classKey, findPattern, formatDate, getMeet, showOfMeet } from '../data/fixture'
import { classState, useAppState } from '../store'
import { Screen, go } from './bits'

export function MeetScreen({ meetId }: { meetId: string }) {
  const state = useAppState()
  const meet = getMeet(meetId)
  const show = showOfMeet(meetId)
  if (!meet) {
    return (
      <Screen title="Day not found" backTo="/" backLabel="Shows">
        <p className="hint">This day is not in any show on this device.</p>
      </Screen>
    )
  }
  return (
    <Screen
      title={meet.label}
      sub={[meet.date ? formatDate(meet.date) : '', meet.judges.length > 0 ? `judge ${meet.judges.join(', ')}` : ''].filter(Boolean).join(', ')}
      backTo={show ? `/s/${show.id}` : '/'}
      backLabel="Show"
    >
      <h2>Classes</h2>
      <ul className="list">
        {meet.classes.map((c) => {
          const cs = classState(state, classKey(meet.id, c.id))
          const scored = cs.runs.filter((r) => r.scored).length
          let status = 'No riders yet'
          if (cs.runs.length > 0) {
            status =
              c.card_family === 'placings'
                ? `${cs.placings.length} placed of ${cs.runs.length}`
                : `${scored} scored of ${cs.runs.length}`
          }
          return (
            <li key={c.id}>
              <button className="row" onClick={() => go(`/m/${meet.id}/c/${c.id}`)}>
                <span className="classno">{c.id}</span>
                <span className="row-main">
                  <strong>{c.name}</strong>
                  <span>{findPattern(c.pattern_id)?.name ?? 'No pattern chosen'}</span>
                </span>
                <span className="row-side">{status}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </Screen>
  )
}
