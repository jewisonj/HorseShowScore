import { useEffect, useState } from 'react'
import type { PublishedClass, ReleasedCards } from '../cloud/backend'
import { refreshShows, refreshShowsIfStale, startCloud, useCloud } from '../cloud/cloud'
import { loadCards, loadPlacings } from '../cloud/scores'
import { useCloudCache } from '../data/cloudShows'
import { classKey, formatDate, type ShowFile } from '../data/fixture'
import { BackNumber, Code, Screen, go } from './bits'
import { showDates, whenChecked } from './Home'
import { PatternPagePicture } from './PatternPagePicture'
import { PublicCardView } from './PublicCard'

/**
 * The public side: what anyone may see of a published show.
 *
 * Read only. No scoring, no setup, nothing from this device's own scores. It
 * shows exactly what is on the server: classes, the draw and the patterns. A
 * copy of a show being worked on here, and the samples that come with the app,
 * are not listed.
 */
function usePublishedShows(): { shows: ShowFile[]; checkedAt: string | null } {
  const cache = useCloudCache()
  useEffect(() => {
    void startCloud().then(refreshShowsIfStale)
  }, [])
  return { shows: cache.shows.filter((s) => cache.onServer.includes(s.id)), checkedAt: cache.checkedAt }
}

/** The address to hand out for a show's public page. */
export function publicLink(showId: string): string {
  return `${window.location.origin}${window.location.pathname}#/public/${encodeURIComponent(showId)}`
}

export function PublicHome() {
  const cloud = useCloud()
  const { shows, checkedAt } = usePublishedShows()
  return (
    <Screen title="Horse shows" sub="Classes, draws and patterns">
      {shows.length === 0 ? (
        <p className="empty">
          {!cloud.configured
            ? 'This copy of the app is not connected to a server, so it has no shows to list.'
            : cloud.check === 'failed'
              ? 'Could not reach the server. Check the connection and try again.'
              : cloud.check === 'ok'
                ? 'No shows are published yet.'
                : 'Looking for shows.'}
        </p>
      ) : (
        <ul className="list">
          {shows.map((show) => (
            <li key={show.id}>
              <button className="row row-meet" onClick={() => go(`/public/${show.id}`)}>
                <span className="row-main">
                  <strong>{show.name}</strong>
                  {show.host && <span>{show.host}</span>}
                  <span>{showDates(show)}</span>
                </span>
                <span className="row-side">{show.meets.reduce((n, m) => n + m.classes.length, 0)} classes</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {cloud.configured && (
        <div className="stack">
          <button className="btn" disabled={cloud.check === 'checking'} onClick={() => void refreshShows()}>
            Check for changes
          </button>
        </div>
      )}
      {checkedAt && <p className="hint">Read from the server at {whenChecked(checkedAt)}.</p>}
      <p className="hint">Placings appear under a class when the show publishes them.</p>
      <div className="stack">
        <button className="btn" onClick={() => go('/')}>
          For judges and show staff
        </button>
      </div>
    </Screen>
  )
}

export function PublicShow({ showId }: { showId: string }) {
  const cloud = useCloud()
  const { shows, checkedAt } = usePublishedShows()
  const show = shows.find((s) => s.id === showId)
  // Placings a show admin has published. Read each time the page opens: they arrive class by class.
  const [results, setResults] = useState<PublishedClass[]>([])
  // Score cards the show office has released, class by class.
  const [released, setReleased] = useState<ReleasedCards[]>([])
  useEffect(() => {
    let current = true
    void startCloud()
      .then(() => Promise.all([loadPlacings(showId), loadCards(showId)]))
      .then(([got, cards]) => {
        if (current && got) setResults(got)
        if (current && cards) setReleased(cards)
      })
    return () => {
      current = false
    }
  }, [showId])
  if (!show) {
    return (
      <Screen title="Horse shows" backTo="/public" backLabel="Shows">
        <p className="empty">
          {cloud.check === 'ok' || !cloud.configured
            ? 'This show is not published. It may have been taken down, or the link may be wrong.'
            : cloud.check === 'failed'
              ? 'Could not reach the server. Check the connection and try again.'
              : 'Looking for the show.'}
        </p>
      </Screen>
    )
  }
  return (
    <Screen title={show.name} sub={[show.host, showDates(show)].filter(Boolean).join(', ')} backTo="/public" backLabel="Shows">
      {show.meets.map((meet) => (
        <section key={meet.id}>
          <h2>{show.meets.length > 1 ? `${meet.label}${meet.date ? `, ${formatDate(meet.date)}` : ''}` : 'Classes, in running order'}</h2>
          {meet.classes.length === 0 && <p className="empty">No classes yet.</p>}
          {meet.classes.map((cls) => {
            const pattern = show.patterns.find((p) => p.id === cls.pattern_id)
            const riders = [...cls.entries].sort((a, b) => a.draw - b.draw)
            const placings = results.find((r) => r.classKey === classKey(meet.id, cls.id))?.placings ?? []
            const cards = released.find((r) => r.classKey === classKey(meet.id, cls.id))?.cards ?? []
            return (
              <details key={cls.id} className="public-class">
                <summary>
                  <span className="public-class-name">
                    <strong>
                      {cls.id}. {cls.name}
                    </strong>
                    <span className="muted">
                      {riders.length === 0 ? 'Draw not posted yet' : riders.length === 1 ? '1 rider' : `${riders.length} riders`}
                      {pattern ? `, ${pattern.name}` : ''}
                    </span>
                    {placings.length > 0 && <span className="public-posted">Placings posted</span>}
                    {cards.length > 0 && <span className="public-posted">Score cards released</span>}
                  </span>
                </summary>
                {placings.length > 0 && (
                  <>
                    <h3>Placings</h3>
                    <ol className="public-draw">
                      {placings.map((r) => (
                        <li key={r.back_no}>
                          <span className="public-place">{r.place === null ? 'No place' : `${r.place}${r.tied ? ' tie' : ''}`}</span>
                          <BackNumber value={r.back_no} size="sm" />
                          <span className="row-main">
                            <strong>{r.rider || 'Rider not named'}</strong>
                            {r.horse && <span className="muted">{r.horse}</span>}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
                {cards.length > 0 && (
                  <>
                    <h3>Score cards</h3>
                    {cards.map((card) => (
                      <PublicCardView key={card.back_no} card={card} cls={cls} pattern={pattern} />
                    ))}
                  </>
                )}
                {riders.length > 0 && (
                  <>
                    <h3>Draw</h3>
                    <ol className="public-draw">
                      {riders.map((r) => (
                        <li key={`${r.draw}:${r.back_no}`}>
                          <span className="public-draw-order">{r.draw}</span>
                          <BackNumber value={r.back_no} size="sm" />
                          <span className="row-main">
                            <strong>{r.rider || 'Rider to be named'}</strong>
                            {r.horse && <span className="muted">{r.horse}</span>}
                          </span>
                        </li>
                      ))}
                    </ol>
                    {(cls.alternates ?? []).length > 0 && (
                      <p className="alternates">
                        <strong>Alternate horses:</strong> {(cls.alternates ?? []).join(', ')}
                      </p>
                    )}
                  </>
                )}
                {pattern && (
                  <>
                    <h3>Pattern: {pattern.name}</h3>
                    {cls.notes && <p>{cls.notes}</p>}
                    <ol className="boxlist">
                      {pattern.boxes.map((b) => (
                        <li key={b.n}>
                          <span className="boxlist-row">
                            <span className="boxlist-code">
                              <Code value={b.abbr} />
                            </span>
                            <span>{b.label}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                    <PatternPagePicture path={pattern.page_image} name={pattern.name} />
                  </>
                )}
              </details>
            )
          })}
        </section>
      ))}
      {checkedAt && <p className="hint">Read from the server at {whenChecked(checkedAt)}. The draw can change up to the start of a class.</p>}
      <p className="hint">Placings and score cards appear under a class when the show office releases them. They are unofficial.</p>
    </Screen>
  )
}
