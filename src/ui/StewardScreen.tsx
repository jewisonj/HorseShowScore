import { useEffect, useState } from 'react'
import { startCloud, useCloud } from '../cloud/cloud'
import { askForReride, useRerideAsks } from '../cloud/rerides'
import { useCloudCache } from '../data/cloudShows'
import { classKey } from '../data/fixture'
import { BackNumber, Screen } from './bits'

const STATUS_WORDS = { asked: 'Waiting for the judge', approved: 'Approved', denied: 'Denied' } as const

function clock(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * The steward's screen. For now a steward does one thing: ask the judge for a
 * re-ride for a rider, and see the judge's answer. It works from the published
 * show: classes, back numbers, riders and horses. It shows no scores.
 */
export function StewardScreen({ showId }: { showId: string }) {
  const cloud = useCloud()
  const cache = useCloudCache()
  const show = cache.shows.find((s) => s.id === showId && cache.onServer.includes(s.id))
  const { asks, failed } = useRerideAsks(show?.id)
  const [picked, setPicked] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState('')
  const [said, setSaid] = useState('')
  const [problem, setProblem] = useState('')
  useEffect(() => {
    void startCloud()
  }, [])

  if (!show) {
    return (
      <Screen title="Steward" backTo={cloud.admin ? `/s/${showId}` : undefined} backLabel="Show">
        <p className="empty">{cloud.check === 'failed' ? 'Could not reach the server. A steward needs a connection.' : 'This show is not published. A steward works from the published show.'}</p>
      </Screen>
    )
  }

  const classes = show.meets.flatMap((m) => m.classes.map((c) => ({ meet: m, cls: c, key: classKey(m.id, c.id) })))
  const current = classes.find((c) => c.key === picked)
  const nameOf = (key: string) => {
    const c = classes.find((x) => x.key === key)
    return c ? `${c.cls.id}. ${c.cls.name}` : 'A class no longer in the show'
  }

  async function ask(backNo: string) {
    if (!current || busy) return
    setBusy(backNo)
    setSaid('')
    setProblem('')
    const wrong = await askForReride(show!.id, current.key, backNo, reason)
    setBusy('')
    if (wrong) setProblem(wrong)
    else {
      setSaid(`Asked the judge for a re-ride for ${backNo}. The answer shows below.`)
      setReason('')
    }
  }

  return (
    <Screen title="Steward" sub={show.name} backTo={cloud.admin ? `/s/${show.id}` : undefined} backLabel="Show">
      <p className="hint">Ask the judge for a re-ride. The judge approves or denies it on their own screen.</p>
      <label className="field">
        <span>Class</span>
        <select value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="">Choose the class</option>
          {classes.map((c) => (
            <option key={c.key} value={c.key}>
              {show.meets.length > 1 ? `${c.meet.label}: ` : ''}
              {c.cls.id}. {c.cls.name}
            </option>
          ))}
        </select>
      </label>
      {current && (
        <>
          <label className="field">
            <span>Reason, if you want to give one</span>
            <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Horse went lame" autoComplete="off" />
          </label>
          {current.cls.entries.length === 0 ? (
            <p className="empty">This class has no riders in the published show yet.</p>
          ) : (
            <ul className="list steward-riders">
              {[...current.cls.entries]
                .sort((a, b) => a.draw - b.draw)
                .map((e) => {
                  const open = asks.some((a) => a.classKey === current.key && a.backNo === e.back_no && a.status === 'asked')
                  return (
                    <li key={e.back_no} className="steward-rider">
                      <BackNumber value={e.back_no} size="sm" />
                      <span className="row-main">
                        <strong className="rider-name">{e.rider || 'Rider not named'}</strong>
                        {e.horse && <span className="horse">{e.horse}</span>}
                      </span>
                      <button className="btn btn-small" disabled={open || busy !== ''} aria-label={`Ask for a re-ride for ${e.back_no}`} onClick={() => void ask(e.back_no)}>
                        {open ? 'Asked' : busy === e.back_no ? 'Asking' : 'Ask for a re-ride'}
                      </button>
                    </li>
                  )
                })}
            </ul>
          )}
        </>
      )}
      {problem && (
        <p className="warning" role="alert">
          {problem}
        </p>
      )}
      {said && (
        <p className="hint" role="status">
          {said}
        </p>
      )}

      <h2>Re-rides asked for</h2>
      {failed && <p className="hint">Could not reach the server just now. This list may be out of date.</p>}
      {asks.length === 0 ? (
        <p className="empty">None yet.</p>
      ) : (
        <ul className="list">
          {[...asks].reverse().map((a) => (
            <li key={a.id} className="steward-ask">
              <BackNumber value={a.backNo} size="sm" />
              <span className="row-main">
                <strong>{nameOf(a.classKey)}</strong>
                <span>
                  Asked {clock(a.askedAt)}
                  {a.reason ? `. ${a.reason}` : ''}
                </span>
              </span>
              <span className={a.status === 'asked' ? 'tag' : a.status === 'approved' ? 'tag steward-yes' : 'tag tag-warn'}>{STATUS_WORDS[a.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  )
}
