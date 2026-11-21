import { useCallback, useEffect, useState } from 'react'
import type { PublishedClass, ReleasedCards, SentScores } from '../cloud/backend'
import { startCloud, useCloud } from '../cloud/cloud'
import { loadCards, loadPlacings, loadSentScores, publishPlacings, releaseCards, takeDownCards, takeDownPlacings } from '../cloud/scores'
import { useSeat } from '../cloud/seat'
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
  const [released, setReleased] = useState<ReleasedCards[]>([])
  const [problem, setProblem] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const seat = useSeat()
  // The show office signs on with its PIN. A show admin is signed in with an account.
  const allowed = cloud.admin || (seat?.role === 'office' && seat.showId === showId)

  const load = useCallback(async () => {
    setProblem('')
    const [scores, placings, cards] = await Promise.all([loadSentScores(showId), loadPlacings(showId), loadCards(showId)])
    if (!scores.ok) setProblem(scores.error)
    else setSent(scores.latest)
    if (placings) setPublished(placings)
    if (cards) setReleased(cards)
  }, [showId])

  useEffect(() => {
    void startCloud()
  }, [])
  useEffect(() => {
    if (allowed) void load()
  }, [allowed, load])

  if (!cloud.configured || !allowed) {
    return (
      <Screen title="Publish placings" backTo={`/s/${showId}`} backLabel="Show">
        <p className="hint">
          {cloud.user
            ? 'This account is not on the list of people who can publish placings.'
            : 'Placings are published by the show office or a show admin. Sign on to carry on.'}
        </p>
        <div className="stack">
          <button className="btn btn-primary btn-wide" onClick={() => go('/')}>
            Sign on
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
        Judging devices send their scores as they are entered. Publishing a class puts its placings, with no scores,
        on the public page. Releasing its score cards puts every rider’s scores, penalties and the judge’s notes
        there too, during the class or after the show.
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
            const cardsOut = released.find((p) => p.classKey === key)
            return (
              <section key={key} className="panel result-class" aria-label={`${cls.id}. ${cls.name}`}>
                <h2>
                  {cls.id}. {cls.name}
                </h2>
                {out && <p className="result-out">Placings published at {whenChecked(out.publishedAt)}.</p>}
                {cardsOut && <p className="result-out">Score cards released at {whenChecked(cardsOut.publishedAt)}.</p>}
                {sends.length === 0 && <p className="muted">No scores sent for this class yet.</p>}
                {sends.map((send) => {
                  const rows = send.rows.filter((r) => r.place !== null || r.rode)
                  return (
                    <div key={send.device} className="result-send">
                      <p className="muted">
                        {send.seatNo === null ? 'Sent by a show admin' : `Sent by judge ${send.seatNo}`}
                        {send.judge ? `, ${send.judge},` : ''} at {whenChecked(send.sentAt)}
                        {sends.filter((x) => x.seatNo === send.seatNo).length > 1 ? `, device ending ${send.device.slice(-4)}` : ''}
                      </p>
                      <p className={send.finished ? 'result-out' : 'muted'}>
                        {send.finished ? 'The judge has marked this class finished.' : 'Not marked finished yet. The scores may still change.'}
                      </p>
                      <ol className="result-rows">
                        {rows.map((r) => (
                          <li key={r.back_no}>
                            <span className="result-place">{r.place === null ? 'No place' : `${r.place}${r.tied ? ' tie' : ''}`}</span>
                            <BackNumber value={r.back_no} size="sm" />
                            <span className="row-main">
                              <strong>{r.rider || 'Rider not named'}</strong>
                              {r.horse && <span className="muted">{r.horse}</span>}
                              {r.note && <span className="result-note">Judge’s note: {r.note}</span>}
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
                      <button
                        className="btn"
                        disabled={busy || rows.length === 0}
                        onClick={() => {
                          if (!window.confirm(`Release the score cards for ${cls.name}? Anyone with the public link will see every rider’s scores, penalties and the judge’s notes.`)) return
                          void act(() => releaseCards(show.id, key, send.rows), `Score cards for ${cls.name} are on the public page.`)
                        }}
                      >
                        {cardsOut ? 'Release this class’s score cards again' : 'Release this class’s score cards'}
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
                {cardsOut && (
                  <button
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Take the score cards for ${cls.name} off the public page?`)) return
                      void act(() => takeDownCards(show.id, key), `Score cards for ${cls.name} are taken down.`)
                    }}
                  >
                    Take these score cards down
                  </button>
                )}
              </section>
            )
          }),
        )}
    </Screen>
  )
}
