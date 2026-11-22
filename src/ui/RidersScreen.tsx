import { useEffect, useState } from 'react'
import { STARTING_PIN, type RosterRider, type TeamPin } from '../cloud/backend'
import { explainServerError, fetchWorkbook, getBackend, startCloud, useCloud } from '../cloud/cloud'
import { mergeRoster } from '../cloud/roster'
import { getShow } from '../data/fixture'
import { lastSheetLink, rememberLastSheetLink, rememberedSheetLinks } from '../setup/sheetLink'
import { readRoster } from '../setup/workbook'
import { readXlsx } from '../setup/xlsx'
import { BackNumber, Screen, go } from './bits'

const GROUPS = [1, 2, 3] as const
const NO_TEAM = 'No team given'

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
  // The teams whose riders are showing. Height and weight for every rider takes a lot of room, so a team starts closed.
  const [open, setOpen] = useState<Record<string, boolean>>({})
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
      // Every team named in the sheet gets a row, so its coach can be let in.
      const have = new Set(teams.map((t) => t.team))
      for (const team of new Set(read.map((r) => r.team.replace(/\s+/g, ' ').trim()).filter(Boolean))) {
        if (!have.has(team)) await b.putTeam(team, 'off')
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

  /** Let a team's coach sign on, starting on the starting PIN, or turn their sign-on off. Either way a PIN the coach chose is gone. */
  async function setCoach(team: string, coach: 'off' | 'start', said: string) {
    setProblem('')
    try {
      const b = await getBackend()
      if (!b) throw new Error('This copy of the app is not connected to a server.')
      await b.putTeam(team, coach)
      setTeams((list) => [...list.filter((t) => t.team !== team), { team, coach }])
      setMessage(said)
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
        const coach = teams.find((t) => t.team === team)?.coach ?? 'off'
        return (
          <section key={team} className="panel draw-class" aria-label={team}>
            <h3>
              {team}
              <span className="muted"> {groups.get(team)!.length} riders</span>
            </h3>
            {team !== NO_TEAM && (
              <div className="row-actions">
                <p className="coach-pin">
                  <strong>Coach sign-on:</strong>{' '}
                  {coach === 'off' ? 'off' : coach === 'start' ? `on. The PIN is ${STARTING_PIN} until the coach chooses their own.` : 'on. The coach has chosen their own PIN.'}
                </p>
                {coach === 'off' && (
                  <button
                    className="btn"
                    aria-label={`Let the coach of ${team} sign on`}
                    onClick={() => void setCoach(team, 'start', `The coach of ${team} signs on with ${STARTING_PIN}, then chooses their own PIN.`)}
                  >
                    Let the coach sign on
                  </button>
                )}
                {coach === 'set' && (
                  <button
                    className="btn"
                    aria-label={`Put the coach PIN of ${team} back to ${STARTING_PIN}`}
                    onClick={() => void setCoach(team, 'start', `${team} is back on ${STARTING_PIN}. The PIN the coach chose no longer works.`)}
                  >
                    Put the PIN back to {STARTING_PIN}
                  </button>
                )}
                {coach !== 'off' && (
                  <button className="btn" aria-label={`Turn off coach sign-on for ${team}`} onClick={() => void setCoach(team, 'off', `Coach sign-on is off for ${team}.`)}>
                    Turn off
                  </button>
                )}
              </div>
            )}
            <button className="btn" aria-expanded={open[team] === true} onClick={() => setOpen({ ...open, [team]: !open[team] })}>
              {open[team]
                ? 'Hide height and weight'
                : `Height and weight for the ${groups.get(team)!.length} riders (${groups.get(team)!.filter((r) => r.height || r.group !== 1).length} marked)`}
            </button>
            {open[team] && (
              <ul className="list draw-riders">
                {groups.get(team)!.map((r) => (
                  <li key={r.backNo} className="draw-rider">
                    <BackNumber value={r.backNo} size="sm" />
                    <strong className="rider-name">{r.rider || 'Rider not named'}</strong>
                    <RiderMarks rider={r} onChange={(height, group) => void mark(r, height, group)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </Screen>
  )
}
