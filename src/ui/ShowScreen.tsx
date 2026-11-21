import { useEffect, useState } from 'react'
import { publishShow, sameShow, startCloud, takeOffServer, useCloud } from '../cloud/cloud'
import { useCloudCache } from '../data/cloudShows'
import { classKey, formatDate, getShow, isBuiltIn, isSample as isSampleShow } from '../data/fixture'
import { removeShow, useUserShows } from '../data/shows'
import { resultsCsv } from '../results'
import { loadDraw } from '../seed'
import { problemsIn } from '../setup/draft'
import { classState, judgeName, removeClassStates, useAppState } from '../store'
import { Screen, go } from './bits'
import { download, slug } from './files'
import { showDates } from './Home'
import { publicLink } from './PublicScreens'

/** One show: its days, and what can be done with the show as a whole. */
export function ShowScreen({ showId }: { showId: string }) {
  const state = useAppState()
  const mine = useUserShows()
  const cloud = useCloud()
  const cache = useCloudCache()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  useEffect(() => {
    void startCloud()
  }, [])

  const show = getShow(showId)
  if (!show) {
    return (
      <Screen title="Show not found" backTo="/" backLabel="Shows">
        <p className="hint">
          This show is not on this device. It may have been taken off the server. Check for new shows on the first
          screen, or open its show file there.
        </p>
      </Screen>
    )
  }
  // Still only the sample that ships with the app. Once changed or published it is a show like any other.
  const isSample = isSampleShow(show.id)
  const stamp = new Date().toISOString().slice(0, 10)
  // The copy being worked on here, and the copy every device reads from the server.
  const local = mine.find((s) => s.id === show.id)
  const published = cache.shows.find((s) => s.id === show.id)
  const onServer = cache.onServer.includes(show.id)
  const changed = local !== undefined && published !== undefined && !sameShow(local, published)

  async function publish() {
    if (!show || busy) return
    const stops = problemsIn(show)
    setProblems(stops)
    if (stops.length > 0) return
    setBusy(true)
    setMessage('')
    const said = await publishShow(show)
    setBusy(false)
    setMessage(said ?? 'Published. Phones list it the next time they are online.')
  }

  async function unpublish() {
    if (!show || busy) return
    if (!window.confirm(`Take "${show.name}" off the server? Phones with no scores for it stop listing it. This device keeps the setup.`)) return
    setBusy(true)
    setMessage('')
    const said = await takeOffServer(show)
    setBusy(false)
    setMessage(said ?? 'Taken off the server. This device still has the show.')
  }

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
                  {judgeName(state, m.id).trim() && <span>Judge {judgeName(state, m.id).trim()}</span>}
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

      {!isSample && cloud.configured && (
        <>
          <h2>On the server</h2>
          <p className="hint">
            {changed
              ? 'This device has changes to the setup that are not published. Other devices still see the published show.'
              : published && onServer
                ? 'Published. Every phone that is online lists this show.'
                : published
                  ? 'This show is no longer on the server. This device keeps it because it has scores for it.'
                  : 'This show is on this device only. Other phones do not see it.'}
          </p>
          {cache.held.includes(show.id) && (
            <p className="warning">
              The server has a newer setup that changes the number of maneuvers in a class already scored on this
              device. This device is keeping the setup those rides were scored with.
            </p>
          )}
          <div className="stack">
            {cloud.admin && (local !== undefined || !onServer) && (
              <button className="btn btn-primary" disabled={busy} onClick={() => void publish()}>
                {busy ? 'Working' : changed ? 'Publish the changes' : 'Publish this show'}
              </button>
            )}
            {changed && (
              <button
                className="btn"
                onClick={() => {
                  if (!window.confirm('Drop the changes made on this device and use the published show? Scores are kept.')) return
                  removeShow(show.id)
                  loadDraw()
                  setMessage('This device now uses the published show.')
                }}
              >
                Drop my changes and use the published show
              </button>
            )}
            {cloud.admin && published && onServer && (
              <button className="btn btn-primary" onClick={() => go(`/s/${show.id}/results`)}>
                Publish placings
              </button>
            )}
            {published && onServer && (
              <button
                className="btn"
                onClick={async () => {
                  const link = publicLink(show.id)
                  try {
                    await navigator.clipboard.writeText(link)
                    setMessage('The public link is copied. Anyone who opens it sees the classes, draws and patterns.')
                  } catch {
                    setMessage(`The public link is ${link}`)
                  }
                }}
              >
                Copy the public link
              </button>
            )}
            {cloud.admin && onServer && (
              <button className="btn btn-danger" disabled={busy} onClick={() => void unpublish()}>
                Take it off the server
              </button>
            )}
          </div>
          {cloud.admin && (local !== undefined || !onServer) && (
            <p className="hint">
              A published show can be read by anyone who has the app: its classes, draw and patterns. Judges' names
              and scores are not published.
            </p>
          )}
          {!cloud.admin && !published && (
            <p className="hint">
              {cloud.user ? 'This account is not on the list of people who can publish shows.' : 'Sign in from the first screen to publish it.'}
            </p>
          )}
          {problems.length > 0 && (
            <ul className="warning problems" role="alert">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {message && (
            <p className="hint" role="status">
              {message}
            </p>
          )}
        </>
      )}

      <h2>This show</h2>
      <div className="stack">
        <button className="btn" onClick={() => download(`${slug(show.name)}-results-${stamp}.csv`, resultsCsv(state, show.meets), 'text/csv')}>
          Export results as CSV
        </button>
        <button className="btn" onClick={() => download(`${slug(show.name)}.show.json`, JSON.stringify(show), 'application/json')}>
          Download the show file
        </button>
        {(isSample ? cloud.configured && cloud.admin : cloud.configured ? cloud.admin : local !== undefined) && (
          <button className="btn" onClick={() => go(`/s/${show.id}/setup`)}>
            Change the setup
          </button>
        )}
        {!isBuiltIn(show.id) && local !== undefined && !published && (
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
        )}
      </div>
      <p className="hint">
        The show file holds the classes, the draw and the patterns. It can be opened on another phone or tablet from
        the first screen where there is no signal. It does not carry scores.
      </p>
      {isSample && <p className="hint">This is a sample show that comes with the app. A show admin can change its setup and publish it. The published show then takes its place on every phone, and scores already entered stay with it.</p>}
    </Screen>
  )
}
