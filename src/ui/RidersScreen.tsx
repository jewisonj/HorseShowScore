import { useEffect, useState } from 'react'
import type { RosterRider, TeamPin } from '../cloud/backend'
import { explainServerError, fetchWorkbook, getBackend, startCloud, useCloud } from '../cloud/cloud'
import { mergeRoster } from '../cloud/roster'
import { getShow } from '../data/fixture'
import { lastSheetLink, rememberLastSheetLink, rememberedSheetLinks } from '../setup/sheetLink'
import { readRoster } from '../setup/workbook'
import { readXlsx } from '../setup/xlsx'
import { BackNumber, Screen, go } from './bits'

const GROUPS = [1, 2, 3] as const
const NO_TEAM = 'No team given'

/** A six-digit PIN that is not one of these. */
function newPin(taken: (string | null)[]): string {
  for (;;) {
    const n = new Uint32Array(1)
    globalThis.crypto.getRandomValues(n)
    const pin = String(n[0] % 1_000_000).padStart(6, '0')
    if (!taken.includes(pin)) return pin
  }
}

/** One rider's marks: a tick for a height rider and a weight group of 1, 2 or 3. */
export function RiderMarks(props: { rider: RosterRider; onChange: (height: boolean, group: 1 | 2 | 3) => void }) {
  const r = props.rider
  return (
    <>
      <label className="draw-check">
        <input type="checkbox" checked={r.height} onChange={(e) => props.onChange(e.target.checked, r.group)} />
        <span>Height rider</span>
      </label>
      <label className="draw-group">
        <span>Weight group</span>
        <select aria-label={`Weight group of ${r.backNo}`} value={r.group} onChange={(e) => props.onChange(r.height, Number(e.target.value) as 1 | 2 | 3)}>
          {GROUPS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
    </>
  )
}

/**
 * For show admins: every rider, by team, with the two marks the horse draw
 * works from, and each team's coach PIN. The list is filled from a show's
 * sheet, which is only read.
 */
export function RidersScreen() {
  const cloud = useCloud()
  const [riders, setRiders] = useState<RosterRider[] | null>(null)
  const [teams, setTeams] = useState<TeamPin[]>([])
  // The sheet a show was read from is remembered on this computer, so it need not be pasted again.
  const [link, setLink] = useState(() => lastSheetLink())
  const sheets = rememberedSheetLinks()
    .map((s) => ({ ...s, name: getShow(s.showId)?.name ?? '' }))
    .filter((s) => s.name !== '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [problem, setProblem] = useState('')
  useEffect(() => {
    void startCloud()
  }, [])

  async function load() {
    const b = await getBackend()
    if (!b) return
    try {
      const [r, t] = await Promise.all([b.listRiders(), b.listTeams()])
      setRiders(r)
      setTeams(t)
    } catch (e) {
      setProblem(explainServerError(e))
    }
  }
  useEffect(() => {
    if (cloud.admin) void load()
  }, [cloud.admin])

  if (!cloud.configured || !cloud.admin) {
    return (
      <Screen title="Riders and coaches" backTo="/" backLabel="Back">
        <p className="hint">{cloud.configured ? 'Only a show admin sees the riders list. Sign in as an admin to carry on.' : 'The riders list is kept on the server. This copy of the app has none.'}</p>
        {cloud.configured && (
          <div className="stack">
            <button className="btn btn-primary btn-wide" onClick={() => go('/account')}>
              Sign in
            </button>
          </div>
        )}
      </Screen>
    )
  }

  async function readSheet() {
    if (busy || riders === null) return
    setBusy(true)
    setMessage('')
    setProblem('')
    const got = await fetchWorkbook(link)
    if (!got.ok) {
      setBusy(false)
      setProblem(got.error)
      return
    }
    try {
      const read = readRoster(readXlsx(got.bytes))
      if (read.length === 0) {
        setProblem('That sheet has no riders on its "Exhibitors" tab.')
        setBusy(false)
        return
      }
      const b = await getBackend()
      if (!b) throw new Error('This copy of the app is not connected to a server.')
      const merged = mergeRoster(riders, read)
      await b.putRiders(merged.rows)
      rememberLastSheetLink(link.trim())
      // Every team named in the sheet gets a row, so it can be given a coach PIN.
      const have = new Set(teams.map((t) => t.team))
      for (const team of new Set(read.map((r) => r.team.replace(/\s+/g, ' ').trim()).filter(Boolean))) {
        if (!have.has(team)) await b.putTeam(team, null)
      }
      await load()
      setMessage(
        `The sheet lists ${read.length} riders. ${merged.added} added, ${merged.changed} changed.` +
          (merged.reset > 0 ? ` ${merged.reset} had marks cleared because the back number now belongs to a different name.` : '') +
          ' The sheet was only read. Nothing in it was changed.',
      )
    } catch (e) {
      setProblem(e instanceof Error && /zip|xml|sheet/i.test(e.message) ? 'That file could not be read.' : explainServerError(e))
    }
    setBusy(false)
  }

  async function mark(rider: RosterRider, height: boolean, group: 1 | 2 | 3) {
    const next = { ...rider, height, group }
    setRiders((list) => (list ?? []).map((r) => (r.backNo === rider.backNo ? next : r)))
    setProblem('')
    try {
      const b = await getBackend()
      if (!b) throw new Error('This copy of the app is not connected to a server.')
      await b.putRiders([next])
    } catch (e) {
      setProblem(`${rider.backNo} was not saved. ${explainServerError(e)}`)
      void load()
    }
  }

  async function givePin(team: string) {
    const pin = newPin(teams.map((t) => t.pin))
    setProblem('')
    try {
      const b = await getBackend()
      if (!b) throw new Error('This copy of the app is not connected to a server.')
      await b.putTeam(team, pin)
      setTeams((list) => [...list.filter((t) => t.team !== team), { team, pin }])
      setMessage(`${team} has a new coach PIN. A coach signed on with the old one has to sign on again.`)
    } catch (e) {
      setProblem(explainServerError(e))
    }
  }

  const groups = new Map<string, RosterRider[]>()
  for (const r of riders ?? []) groups.set(r.team || NO_TEAM, [...(groups.get(r.team || NO_TEAM) ?? []), r])
  const names = [...groups.keys()].sort((a, b) => (a === NO_TEAM ? 1 : b === NO_TEAM ? -1 : a.localeCompare(b)))
  const marked = (riders ?? []).filter((r) => r.height || r.group !== 1).length

  return (
    <Screen title="Riders and coaches" sub={riders ? `${riders.length} riders, ${marked} marked` : undefined} backTo="/" backLabel="Shows" wide>
      <p className="hint">
        A rider's marks are a yes or no for height rider and a weight group of 1, 2 or 3. Never a height or a weight. Only
        show admins see this list, and a coach sees their own team. It is never published. The horse draw uses it for
        every show.
      </p>

      <div className="row-actions">
        <label className="field draw-link">
          <span>Read the riders from a show's Google Sheet</span>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste the sheet's link" autoComplete="off" />
        </label>
        <button className="btn btn-primary" disabled={busy || link.trim() === '' || riders === null} onClick={() => void readSheet()}>
          {busy ? 'Reading' : 'Read the riders from the sheet'}
        </button>
      </div>
      {sheets.length > 0 && (
        <div className="row-actions">
          {sheets.map((sheet) => (
            <button key={sheet.showId} className={sheet.link === link.trim() ? 'btn draw-pick-on' : 'btn'} aria-pressed={sheet.link === link.trim()} onClick={() => setLink(sheet.link)}>
              Use the sheet of {sheet.name}
            </button>
          ))}
        </div>
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

      {riders === null && !problem && <p className="empty">Looking for the riders.</p>}
      {riders !== null && riders.length === 0 && <p className="empty">No riders yet. Read them from a show's sheet.</p>}
      {names.map((team) => {
        const pin = teams.find((t) => t.team === team)?.pin ?? null
        return (
          <section key={team} className="panel draw-class" aria-label={team}>
            <h3>
              {team}
              <span className="muted"> {groups.get(team)!.length} riders</span>
            </h3>
            {team !== NO_TEAM && (
              <div className="row-actions">
                <p className="coach-pin">
                  <strong>Coach PIN:</strong> {pin ?? 'none yet'}
                </p>
                <button className="btn" aria-label={`Make a new coach PIN for ${team}`} onClick={() => void givePin(team)}>
                  {pin ? 'New PIN' : 'Make a coach PIN'}
                </button>
              </div>
            )}
            <ul className="list draw-riders">
              {groups.get(team)!.map((r) => (
                <li key={r.backNo} className="draw-rider">
                  <BackNumber value={r.backNo} size="sm" />
                  <strong className="rider-name">{r.rider || 'Rider not named'}</strong>
                  <RiderMarks rider={r} onChange={(height, group) => void mark(r, height, group)} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </Screen>
  )
}
