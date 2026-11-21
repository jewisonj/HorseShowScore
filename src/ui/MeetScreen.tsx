import { classKey, formatDate, getMeet, getPattern } from '../data/fixture'
import { classState, useAppState } from '../store'
import { Screen, go } from './bits'

export function MeetScreen({ meetId }: { meetId: string }) {
  const state = useAppState()
  const meet = getMeet(meetId)
  if (!meet) {
    return (
      <Screen title="Meet not found" backTo="/" backLabel="Meets">
        <p className="hint">This meet is not in the test data.</p>
      </Screen>
    )
  }
  return (
    <Screen title={meet.label} sub={meet.judges.length > 0 ? `${formatDate(meet.date)}, judge ${meet.judges.join(', ')}` : formatDate(meet.date)} backTo="/" backLabel="Meets">
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
                  <span>{getPattern(c.pattern_id).name}</span>
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
