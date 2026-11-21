import { builtInShow, classKey, formatDate, getShow } from '../data/fixture'
import { removeShow, useUserShows } from '../data/shows'
import { resultsCsv } from '../results'
import { classState, removeClassStates, useAppState } from '../store'
import { Screen, go } from './bits'
import { download, slug } from './files'
import { showDates } from './Home'

/** One show: its days, and what can be done with the show as a whole. */
export function ShowScreen({ showId }: { showId: string }) {
  const state = useAppState()
  useUserShows()
  const show = getShow(showId)
  if (!show) {
    return (
      <Screen title="Show not found" backTo="/" backLabel="Shows">
        <p className="hint">This show is not on this device. Open its show file from the first screen.</p>
      </Screen>
    )
  }
  const isSample = show.id === builtInShow.id
  const stamp = new Date().toISOString().slice(0, 10)

  return (
    <Screen title={show.name} sub={[show.host, showDates(show)].filter(Boolean).join(', ')} backTo="/" backLabel="Shows">
      <h2>{show.meets.length === 1 ? 'Day' : 'Days'}</h2>
      <ul className="list">
        {show.meets.map((m) => {
          const riders = m.classes.reduce((n, c) => n + classState(state, classKey(m.id, c.id)).runs.length, 0)
          return (
            <li key={m.id}>
              <button className="row row-meet" onClick={() => go(`/m/${m.id}`)}>
                <span className="row-main">
                  <strong>{m.label}</strong>
                  {m.date && <span>{formatDate(m.date)}</span>}
                  {m.judges.length > 0 && <span>Judge {m.judges.join(', ')}</span>}
                </span>
                <span className="row-side">
                  {m.classes.length} classes
                  <br />
                  {riders} rides
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <h2>This show</h2>
      <div className="stack">
        <button className="btn" onClick={() => download(`${slug(show.name)}-results-${stamp}.csv`, resultsCsv(state, show.meets), 'text/csv')}>
          Export results as CSV
        </button>
        <button className="btn" onClick={() => download(`${slug(show.name)}.show.json`, JSON.stringify(show), 'application/json')}>
          Download the show file
        </button>
        {!isSample && (
          <>
            <button className="btn" onClick={() => go(`/s/${show.id}/setup`)}>
              Change the setup
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                if (!window.confirm(`Remove "${show.name}" and every score entered for it from this device? This cannot be undone.`)) return
                removeClassStates(show.meets.flatMap((m) => m.classes.map((c) => classKey(m.id, c.id))))
                removeShow(show.id)
                go('/')
              }}
            >
              Remove this show from this device
            </button>
          </>
        )}
      </div>
      <p className="hint">
        The show file holds the classes, the draw and the patterns. Send it to another phone or tablet and open it
        there from the first screen. It does not carry scores.
      </p>
      {isSample && <p className="hint">This is the sample show that comes with the app. It cannot be changed or removed.</p>}
    </Screen>
  )
}
