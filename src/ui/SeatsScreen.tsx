import { useEffect, useState } from 'react'
import type { SeatPin } from '../cloud/backend'
import { explainServerError, getBackend, startCloud, useCloud } from '../cloud/cloud'
import { useCloudCache } from '../data/cloudShows'
import { Screen, go } from './bits'

/** A six-digit PIN that is not one of these. */
function newPin(taken: string[]): string {
  for (;;) {
    const n = new Uint32Array(1)
    globalThis.crypto.getRandomValues(n)
    const pin = String(n[0] % 1_000_000).padStart(6, '0')
    if (!taken.includes(pin)) return pin
  }
}

/**
 * For show admins: how many judges a show has, and the PIN each judge, the
 * show office and the steward signs on with. The PINs are shown here so they can be handed out.
 */
export function SeatsScreen({ showId }: { showId: string }) {
  const cloud = useCloud()
  const cache = useCloudCache()
  const [judges, setJudges] = useState<string[] | null>(null)
  const [office, setOffice] = useState('')
  const [steward, setSteward] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [message, setMessage] = useState('')
  const show = cache.shows.find((s) => s.id === showId && cache.onServer.includes(s.id))

  useEffect(() => {
    void startCloud()
  }, [])
  useEffect(() => {
    if (!cloud.admin) return
    let current = true
    void (async () => {
      const b = await getBackend()
      if (!b) return
      try {
        const seats = await b.listSeats(showId)
        if (!current) return
        const j = seats.filter((s) => s.role === 'judge').sort((a, b2) => a.seatNo - b2.seatNo).map((s) => s.pin)
        const o = seats.find((s) => s.role === 'office')?.pin ?? ''
        // A show with no PINs yet starts with one judge and the office, each with a fresh PIN.
        const first = j.length > 0 ? j : [newPin([o])]
        const officePin = o || newPin(first)
        setJudges(first)
        setOffice(officePin)
        // A show whose PINs were set before stewards existed gets a steward PIN, saved with the next save.
        setSteward(seats.find((s) => s.role === 'steward')?.pin ?? newPin([...first, officePin]))
      } catch (e) {
        if (current) setProblem(explainServerError(e))
      }
    })()
    return () => {
      current = false
    }
  }, [cloud.admin, showId])

  if (!cloud.configured || !cloud.admin) {
    return (
      <Screen title="Judges and PINs" backTo="/" backLabel="Back">
        <p className="hint">Only a show admin sets the PINs. Sign in as an admin to carry on.</p>
        <div className="stack">
          <button className="btn btn-primary btn-wide" onClick={() => go('/account')}>
            Sign in
          </button>
        </div>
      </Screen>
    )
  }
  if (!show) {
    return (
      <Screen title="Judges and PINs" backTo={`/s/${showId}`} backLabel="Show">
        <p className="hint">Publish the show first. PINs are for signing on to a published show.</p>
      </Screen>
    )
  }

  async function save() {
    if (!judges || busy) return
    const all = [...judges, office, steward]
    if (all.some((p) => !/^[0-9]{4,8}$/.test(p))) {
      setProblem('Every PIN must be 4 to 8 digits.')
      return
    }
    if (new Set(all).size !== all.length) {
      setProblem('Two seats have the same PIN. Each one needs its own, so the server can tell who is signing on.')
      return
    }
    const seats: SeatPin[] = [
      ...judges.map((pin, i): SeatPin => ({ role: 'judge', seatNo: i + 1, pin })),
      { role: 'office', seatNo: 1, pin: office },
      { role: 'steward', seatNo: 1, pin: steward },
    ]
    setBusy(true)
    setProblem('')
    setMessage('')
    try {
      const b = await getBackend()
      if (!b) throw new Error('This copy of the app is not connected to a server.')
      await b.replaceSeats(showId, seats)
      setMessage('Saved. A device signed on with a PIN that changed has to sign on again.')
    } catch (e) {
      setProblem(explainServerError(e))
    }
    setBusy(false)
  }

  return (
    <Screen title="Judges and PINs" sub={show.name} backTo={`/s/${show.id}`} backLabel="Show">
      <p className="hint">
        A judge or scribe signs on with their PIN to enter scores. The show office signs on with its PIN to publish
        placings. A steward signs on with theirs to ask the judge for a re-ride. Hand each PIN only to the person it is
        for.
      </p>
      {judges === null && !problem && <p className="empty">Looking for the PINs.</p>}
      {judges !== null && (
        <>
          <label className="field">
            <span>Number of judges</span>
            <select
              value={judges.length}
              onChange={(e) => {
                const n = Number(e.target.value)
                const next = judges.slice(0, n)
                while (next.length < n) next.push(newPin([...next, office, steward]))
                setJudges(next)
              }}
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {judges.map((pin, i) => (
            <div key={i} className="row-actions">
              <label className="field">
                <span>Judge {i + 1} PIN</span>
                <input inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setJudges(judges.map((p, n) => (n === i ? e.target.value.replace(/\D/g, '') : p)))} />
              </label>
              <button className="btn" aria-label={`Make a new PIN for judge ${i + 1}`} onClick={() => setJudges(judges.map((p, n) => (n === i ? newPin([...judges, office, steward]) : p)))}>
                New PIN
              </button>
            </div>
          ))}
          <div className="row-actions">
            <label className="field">
              <span>Show office PIN</span>
              <input inputMode="numeric" maxLength={8} value={office} onChange={(e) => setOffice(e.target.value.replace(/\D/g, ''))} />
            </label>
            <button className="btn" aria-label="Make a new PIN for the show office" onClick={() => setOffice(newPin([...judges, office, steward]))}>
              New PIN
            </button>
          </div>
          <div className="row-actions">
            <label className="field">
              <span>Steward PIN</span>
              <input inputMode="numeric" maxLength={8} value={steward} onChange={(e) => setSteward(e.target.value.replace(/\D/g, ''))} />
            </label>
            <button className="btn" aria-label="Make a new PIN for the steward" onClick={() => setSteward(newPin([...judges, office, steward]))}>
              New PIN
            </button>
          </div>
          <div className="stack">
            <button className="btn btn-primary btn-wide" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving' : 'Save the PINs'}
            </button>
          </div>
        </>
      )}
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
    </Screen>
  )
}
