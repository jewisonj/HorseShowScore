import { useCallback, useEffect, useState } from 'react'
import type { PublishedClass, SentScores } from '../cloud/backend'
import { startCloud, useCloud } from '../cloud/cloud'
import { loadPlacings, loadSentScores, publishPlacings, takeDownPlacings } from '../cloud/scores'
import { useCloudCache } from '../data/cloudShows'
import { classKey } from '../data/fixture'
import { formatHalf } from '../engine/half'
import { BackNumber, Screen, go } from './bits'
import { whenChecked } from './Home'

/**
 * For show admins: the scores judging devices have sent for a published show,
 * class by class, and the button that puts a class's placings on the public
 * page. Scores are shown here and nowhere else.
 */
export function ResultsAdminScreen({ showId }: { showId: string }) {
  const cloud = useCloud()
  const cache = useCloudCache()
  const [sent, setSent] = useState<SentScores[] | null>(null)
  const [published, setPublished] = useState<PublishedClass[]>([])
  const [problem, setProblem] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setProblem('')
    const [scores, placings] = await Promise.all([loadSentScores(showId), loadPlacings(showId)])
    if (!scores.ok) setProblem(scores.error)
    else setSent(scores.latest)
    if (placings) setPublished(placings)
  }, [showId])

  useEffect(() => {
    void startCloud()
  }, [])
  useEffect(() => {
    if (cloud.admin) void load()
  }, [cloud.admin, load])

  if (!cloud.configured || !cloud.admin) {
    return (
      <Screen title="Publish placings" backTo={`/s/${showId}`} backLabel="Show">
        <p className="hint">
          {cloud.user
            ? 'This account is not on the list of people who can publish placings.'
            : 'Placings are published by the people who run the show. Sign in to carry on.'}
        </p>
        <div className="stack">
          <button className="btn btn-primary btn-wide" onClick={() => go('/account')}>
            Sign in
          </button>
        </div>
      </Screen>
    )
  }
  const show = cache.shows.find((s) => s.id === showId && cache.onServer.includes(s.id))
  if (!show) {
    return (
      <Screen title="Publish placings" backTo={`/s/${showId}`} backLabel="Show">
        <p className="hint">Publish the show first. Judging devices send scores only for a published show.</p>
      </Screen>
    )
  }

  async function act(what: () => Promise<string | null>, done: string) {
    if (busy) return
    setBusy(true)
    setMessage('')
    const said = await what()
    setBusy(false)
    if (said) setProblem(said)
    else {
      setMessage(done)
      await load()
    }
  }

  return (
    <Screen title="Publish placings" sub={show.name} backTo={`/s/${show.id}`} backLabel="Show">
      <p className="hint">
        Judging devices send their scores as they are entered. Scores are shown on this page only. Publishing a class
        puts its placings, with no scores, on the public page.
      </p>
      <div className="stack">
        <button className="btn" disabled={busy} onClick={() => void load()}>
          Check for new scores
        </button>
      </div>
      {problem && (
        <p className="warning" role="alert">
          {problem}
        </p>
      )}
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
      {sent === null && !problem && <p className="empty">Looking for scores.</p>}
      {sent !== null &&
        show.meets.map((meet) =>
          meet.classes.map((cls) => {
            const key = classKey(meet.id, cls.id)
            const sends = sent.filter((s) => s.classKey === key)
            const out = published.find((p) => p.classKey === key)
            return (
              <section key={key} className="panel result-class" aria-label={`${cls.id}. ${cls.name}`}>
                <h2>
                  {cls.id}. {cls.name}
                </h2>
                {out && <p className="result-out">Placings published at {whenChecked(out.publishedAt)}.</p>}
                {sends.length === 0 && <p className="muted">No scores sent for this class yet.</p>}
                {sends.map((send) => {
                  const rows = send.rows.filter((r) => r.place !== null || r.rode)
                  return (
                    <div key={send.device} className="result-send">
                      <p className="muted">
                        Sent by {send.judge || 'a judge who gave no name'} at {whenChecked(send.sentAt)}
                        {sends.length > 1 ? `, device ending ${send.device.slice(-4)}` : ''}
                      </p>
                      <ol className="result-rows">
                        {rows.map((r) => (
                          <li key={r.back_no}>
                            <span className="result-place">{r.place === null ? 'No place' : `${r.place}${r.tied ? ' tie' : ''}`}</span>
                            <BackNumber value={r.back_no} size="sm" />
                            <span className="row-main">
                              <strong>{r.rider || 'Rider not named'}</strong>
                              {r.horse && <span className="muted">{r.horse}</span>}
                            </span>
                            <span className="result-score">{r.mark !== 'none' ? r.mark : r.score !== null ? formatHalf(r.score) : ''}</span>
                          </li>
                        ))}
                      </ol>
                      <button
                        className="btn btn-primary"
                        disabled={busy || rows.length === 0}
                        onClick={() => void act(() => publishPlacings(show.id, key, send.rows), `Placings for ${cls.name} are on the public page.`)}
                      >
                        {out ? 'Publish this class’s placings again' : 'Publish this class’s placings'}
                      </button>
                    </div>
                  )
                })}
                {out && (
                  <button
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Take the placings for ${cls.name} off the public page?`)) return
                      void act(() => takeDownPlacings(show.id, key), `Placings for ${cls.name} are taken down.`)
                    }}
                  >
                    Take these placings down
                  </button>
                )}
              </section>
            )
          }),
        )}
    </Screen>
  )
}
