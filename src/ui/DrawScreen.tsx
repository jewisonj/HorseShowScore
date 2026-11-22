import { useEffect, useState } from 'react'
import type { RosterRider } from '../cloud/backend'
import { explainServerError, fetchWorkbook, getBackend, startCloud, useCloud } from '../cloud/cloud'
import { useCloudCache } from '../data/cloudShows'
import { allShows, classKey, getShow, type ShowClass, type ShowFile } from '../data/fixture'
import { saveShow, useUserShows } from '../data/shows'
import { ruleSetFor } from '../rules/rulesets'
import { loadDraw } from '../seed'
import { finishShow } from '../setup/draft'
import { addHorses, markOf, saveDrawBook, useDrawBook, type BookHorse, type DrawBook, type RiderMark } from '../setup/drawBook'
import { drawClass, fits, redrawOne, suggestSet, rideCounts, type DrawRider, type WeightGroup } from '../setup/horseDraw'
import { rememberSheetLink, sheetLinkFor } from '../setup/sheetLink'
import { readHorseList } from '../setup/workbook'
import { readXlsx } from '../setup/xlsx'
import { BackNumber, Screen, go } from './bits'

const GROUPS: WeightGroup[] = [1, 2, 3]

/** True for a class that works the rail together, where no horse can go twice. */
function isRailClass(cls: ShowClass): boolean {
  return ruleSetFor(cls.rule_set).extras.some((e) => e.id === 'rail')
}

/** The horses of a class's set nobody is riding, keeping the order alternates were already in. */
function alternatesOf(cls: ShowClass, set: string[]): string[] {
  const used = new Set(cls.entries.map((e) => e.horse))
  const free = set.filter((h) => !used.has(h))
  const before = (cls.alternates ?? []).filter((h) => free.includes(h))
  return [...before, ...free.filter((h) => !before.includes(h))]
}

/**
 * The horse draw, in show setup. The horses for a class are set, then
 * "Draw for this class" gives every rider one at random from the horses they
 * fit. A rider can be drawn again alone, or given a horse by hand.
 */
export function DrawScreen({ showId }: { showId: string }) {
  // Re-read the show whenever this computer's copy or the published copy changes.
  useUserShows()
  useCloudCache()
  const cloud = useCloud()
  const book = useDrawBook(showId)
  const [names, setNames] = useState('')
  const [link, setLink] = useState(() => sheetLinkFor(showId))
  const [busy, setBusy] = useState(false)
  const [horseNote, setHorseNote] = useState('')
  const [classNote, setClassNote] = useState<Record<string, string>>({})
  const [showRiders, setShowRiders] = useState(false)
  // The riders list on the server, by back number. Null where there is no server, or it could not be reached.
  const [roster, setRoster] = useState<Map<string, RosterRider> | null>(null)
  const [rosterNote, setRosterNote] = useState('')
  useEffect(() => {
    void startCloud()
  }, [])
  useEffect(() => {
    if (!cloud.configured || !cloud.admin) return
    let current = true
    void (async () => {
      try {
        const b = await getBackend()
        if (!b) return
        const list = await b.listRiders()
        if (current) setRoster(new Map(list.map((r) => [r.backNo, r])))
      } catch (e) {
        if (current) setRosterNote(`Could not reach the riders list, so the marks kept on this computer are used. ${explainServerError(e)}`)
      }
    })()
    return () => {
      current = false
    }
  }, [cloud.configured, cloud.admin])

  if (cloud.configured && !cloud.admin) {
    return (
      <Screen title="Sign in to draw horses" backTo="/" backLabel="Shows">
        <p className="hint">
          {cloud.user ? 'This account is not on the list of people who can set up shows.' : 'The horse draw is made by the people who run the show. Sign in to carry on.'}
        </p>
        <div className="stack">
          <button className="btn btn-primary btn-wide" onClick={() => go('/account')}>
            {cloud.user ? 'Use another account' : 'Sign in'}
          </button>
        </div>
      </Screen>
    )
  }
  const show = getShow(showId)
  if (!show) {
    return (
      <Screen title="Show not found" backTo="/" backLabel="Shows">
        <p className="hint">This show is not on this device.</p>
      </Screen>
    )
  }

  const classes = show.meets.flatMap((m) => m.classes.map((c) => ({ meet: m, cls: c, key: classKey(m.id, c.id) })))
  const used = rideCounts(show.meets.flatMap((m) => m.classes))
  const riders = new Map<string, string>()
  for (const { cls } of classes) for (const e of cls.entries) if (!riders.has(e.back_no)) riders.set(e.back_no, e.rider)
  /** A rider's marks: from the riders list on the server where there is one, else from this computer. */
  const markFor = (backNo: string): RiderMark => {
    const onList = roster?.get(backNo)
    return onList ? { height: onList.height, group: onList.group } : markOf(book, backNo)
  }
  const marked = [...riders.keys()].filter((b) => markFor(b).height || markFor(b).group !== 1).length
  // Marks made on this computer before the riders list existed, for riders the list has nothing on yet.
  const stranded = roster ? Object.entries(book.riders).filter(([b, m]) => (m.height || m.group !== 1) && riders.has(b) && !(roster.get(b)?.height || (roster.get(b)?.group ?? 1) !== 1)) : []

  async function setMark(backNo: string, name: string, next: RiderMark) {
    if (!roster) {
      setBook({ ...book, riders: { ...book.riders, [backNo]: next } })
      return
    }
    const row: RosterRider = { backNo, rider: roster.get(backNo)?.rider || name, team: roster.get(backNo)?.team ?? '', height: next.height, group: next.group }
    const before = roster
    setRoster(new Map(roster).set(backNo, row))
    setRosterNote('')
    try {
      const b = await getBackend()
      if (!b) throw new Error('This copy of the app is not connected to a server.')
      await b.putRiders([row])
    } catch (e) {
      setRoster(before)
      setRosterNote(`${backNo} was not saved. ${explainServerError(e)}`)
    }
  }

  async function moveMarks() {
    if (!roster) return
    const rows: RosterRider[] = stranded.map(([backNo, m]) => ({ backNo, rider: roster.get(backNo)?.rider || riders.get(backNo) || '', team: roster.get(backNo)?.team ?? '', height: m.height, group: m.group }))
    try {
      const b = await getBackend()
      if (!b) throw new Error('This copy of the app is not connected to a server.')
      await b.putRiders(rows)
      const next = new Map(roster)
      for (const r of rows) next.set(r.backNo, r)
      setRoster(next)
      // They live on the riders list now. This computer keeps no copy.
      setBook({ ...book, riders: {} })
      setRosterNote(`${rows.length} ${rows.length === 1 ? 'mark' : 'marks'} moved to the riders list.`)
    } catch (e) {
      setRosterNote(explainServerError(e))
    }
  }
  const others = allShows()
    .filter((s) => s.id !== show.id)
    .map((s) => ({ show: s, horses: [...rideCounts(s.meets.flatMap((m) => m.classes)).keys()] }))
    .filter((o) => o.horses.length > 0)

  function setBook(next: DrawBook) {
    if (!saveDrawBook(showId, next)) setHorseNote('This computer could not store the change. Its storage may be full.')
  }

  /** Change one class of the show. Saved on this computer before the screen shows it. */
  function changeClass(key: string, fn: (c: ShowClass) => ShowClass) {
    const current = getShow(showId)
    if (!current) return
    const next: ShowFile = {
      ...current,
      meets: current.meets.map((m) => ({ ...m, classes: m.classes.map((c) => (classKey(m.id, c.id) === key ? fn(c) : c)) })),
    }
    if (!saveShow(finishShow(next))) {
      setClassNote((n) => ({ ...n, [key]: 'This computer could not store the draw. Its storage may be full.' }))
      return
    }
    // Scores already on this computer follow the new horses.
    loadDraw()
  }

  function note(key: string, text: string) {
    setClassNote((n) => ({ ...n, [key]: text }))
  }

  function ridersOf(cls: ShowClass): DrawRider[] {
    return cls.entries.map((e) => ({ backNo: e.back_no, ...markFor(e.back_no) }))
  }

  function horsesOf(key: string): BookHorse[] {
    const set = book.sets[key] ?? []
    return book.horses.filter((h) => set.includes(h.name))
  }

  function setSet(key: string, cls: ShowClass, set: string[]) {
    setBook({ ...book, sets: { ...book.sets, [key]: set } })
    if (cls.entries.some((e) => e.horse)) changeClass(key, (c) => ({ ...c, alternates: alternatesOf(c, set) }))
  }

  function draw(key: string, cls: ShowClass) {
    const horses = horsesOf(key)
    if (horses.length === 0) {
      note(key, 'Pick the horses for this class first.')
      return
    }
    if (cls.entries.some((e) => e.horse) && !window.confirm(`Draw ${cls.name} again? Every rider in it gets a new horse.`)) return
    const result = drawClass(ridersOf(cls), horses, { reuse: !isRailClass(cls) })
    changeClass(key, (c) => ({
      ...c,
      entries: c.entries.map((e) => ({ ...e, horse: result.horseOf[e.back_no] ?? '' })),
      alternates: result.alternates,
    }))
    note(
      key,
      result.noHorse.length > 0
        ? `No horse in this set fits ${result.noHorse.join(', ')}. Add a horse they fit, or give them one by hand.`
        : `Drawn. ${cls.entries.length} riders have a horse${result.alternates.length > 0 ? `, ${result.alternates.length} left as alternates` : ''}.`,
    )
  }

  function redraw(key: string, cls: ShowClass, backNo: string) {
    const rider = ridersOf(cls).find((r) => r.backNo === backNo)
    if (!rider) return
    const horseOf = Object.fromEntries(cls.entries.filter((e) => e.horse).map((e) => [e.back_no, e.horse]))
    const horse = redrawOne(rider, horsesOf(key), horseOf, { reuse: !isRailClass(cls) })
    if (horse === null) {
      note(key, `There is no other horse in this set for ${backNo}.`)
      return
    }
    assign(key, backNo, horse)
    note(key, `${backNo} drew ${horse}.`)
  }

  function assign(key: string, backNo: string, horse: string) {
    const set = book.sets[key] ?? []
    changeClass(key, (c) => {
      const next = { ...c, entries: c.entries.map((e) => (e.back_no === backNo ? { ...e, horse } : e)) }
      return { ...next, alternates: alternatesOf(next, set) }
    })
  }

  async function readSheetHorses() {
    if (busy) return
    setBusy(true)
    setHorseNote('')
    const got = await fetchWorkbook(link)
    setBusy(false)
    if (!got.ok) {
      setHorseNote(got.error)
      return
    }
    try {
      const found = readHorseList(readXlsx(got.bytes))
      if (found.length === 0) {
        setHorseNote('That sheet has no horses on its "Horse Points" tab.')
        return
      }
      rememberSheetLink(showId, link.trim())
      const { book: next, added } = addHorses(book, found)
      setBook(next)
      setHorseNote(`The sheet lists ${found.length} horses. ${added} were added. The sheet was only read. Nothing in it was changed.`)
    } catch {
      setHorseNote('That file could not be read.')
    }
  }

  return (
    <Screen title="Draw the horses" sub={show.name} backTo={`/s/${show.id}`} backLabel="Show" wide>
      <p className="hint">
        Set the horses for each class, then draw. Every rider gets a horse at random from the ones they fit. A rider can
        be drawn again alone, or given a horse by hand.
      </p>

      <h2>Horses</h2>
      {book.horses.length === 0 ? (
        <p className="empty">No horses yet. Add them below.</p>
      ) : (
        <ul className="list draw-horses">
          {book.horses.map((h) => (
            <li key={h.name} className="draw-horse">
              <span className="draw-horse-name">
                <strong>{h.name}</strong>
                <span className="muted">{used.get(h.name) ?? 0} rides</span>
              </span>
              <label className="draw-check">
                <input
                  type="checkbox"
                  checked={h.takesHeight}
                  onChange={(e) => setBook({ ...book, horses: book.horses.map((x) => (x.name === h.name ? { ...x, takesHeight: e.target.checked } : x)) })}
                />
                <span>Takes height riders</span>
              </label>
              <label className="draw-group">
                <span>Carries up to group</span>
                <select
                  aria-label={`Heaviest weight group ${h.name} carries`}
                  value={h.maxGroup}
                  onChange={(e) => setBook({ ...book, horses: book.horses.map((x) => (x.name === h.name ? { ...x, maxGroup: Number(e.target.value) as WeightGroup } : x)) })}
                >
                  {GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="textbtn"
                aria-label={`Remove ${h.name}`}
                onClick={() =>
                  setBook({
                    ...book,
                    horses: book.horses.filter((x) => x.name !== h.name),
                    sets: Object.fromEntries(Object.entries(book.sets).map(([k, set]) => [k, set.filter((n) => n !== h.name)])),
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="paste"
        onSubmit={(e) => {
          e.preventDefault()
          const { book: next, added } = addHorses(book, names.split(/\n|,/))
          setBook(next)
          setNames('')
          setHorseNote(added === 0 ? 'No new horses in that list.' : `${added} ${added === 1 ? 'horse' : 'horses'} added.`)
        }}
      >
        <label className="field">
          <span>Add horses, one per line</span>
          <textarea rows={3} value={names} onChange={(e) => setNames(e.target.value)} />
        </label>
        <div className="row-actions">
          <button className="btn btn-primary" type="submit">
            Add horses
          </button>
          {others.map((o) => (
            <button
              key={o.show.id}
              className="btn"
              type="button"
              onClick={() => {
                const { book: next, added } = addHorses(book, o.horses)
                setBook(next)
                setHorseNote(`${added} ${added === 1 ? 'horse' : 'horses'} added from ${o.show.name}.`)
              }}
            >
              Add the horses from {o.show.name}
            </button>
          ))}
        </div>
      </form>
      {cloud.configured && cloud.admin && (
        <div className="row-actions">
          <label className="field draw-link">
            <span>Or read the horse list from the show's Google Sheet</span>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste the sheet's link" autoComplete="off" />
          </label>
          <button className="btn" disabled={busy || link.trim() === ''} onClick={() => void readSheetHorses()}>
            {busy ? 'Reading' : 'Read the horses from the sheet'}
          </button>
        </div>
      )}
      {horseNote && (
        <p className="hint" role="status">
          {horseNote}
        </p>
      )}

      <h2>Riders</h2>
      <p className="hint">
        Mark the height riders and each rider's weight group. A rider with nothing marked fits any horse.{' '}
        {roster
          ? 'The marks are kept in the riders list on the server, where only show admins and each team’s coach see them. They are never published.'
          : 'These marks stay on this computer. They are never published, sent or exported.'}
      </p>
      {rosterNote && (
        <p className="hint" role="status">
          {rosterNote}
        </p>
      )}
      {stranded.length > 0 && (
        <div className="row-actions">
          <button className="btn" onClick={() => void moveMarks()}>
            Move the {stranded.length} {stranded.length === 1 ? 'mark' : 'marks'} kept on this computer to the riders list
          </button>
        </div>
      )}
      {roster && (
        <div className="row-actions">
          <button className="btn" onClick={() => go('/riders')}>
            Open the riders list and coach PINs
          </button>
        </div>
      )}
      <button className="btn" aria-expanded={showRiders} onClick={() => setShowRiders(!showRiders)}>
        {showRiders ? 'Hide the riders' : `Show the ${riders.size} riders (${marked} marked)`}
      </button>
      {showRiders && (
        <ul className="list draw-riders">
          {[...riders].map(([backNo, name]) => {
            const mark = markFor(backNo)
            const set = (next: { height: boolean; group: WeightGroup }) => void setMark(backNo, name, next)
            return (
              <li key={backNo} className="draw-rider">
                <BackNumber value={backNo} size="sm" />
                <strong className="rider-name">{name || 'Rider not named'}</strong>
                <label className="draw-check">
                  <input type="checkbox" checked={mark.height} onChange={(e) => set({ ...mark, height: e.target.checked })} />
                  <span>Height rider</span>
                </label>
                <label className="draw-group">
                  <span>Weight group</span>
                  <select aria-label={`Weight group of ${backNo}`} value={mark.group} onChange={(e) => set({ ...mark, group: Number(e.target.value) as WeightGroup })}>
                    {GROUPS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            )
          })}
        </ul>
      )}

      <h2>Classes</h2>
      {classes.map(({ meet, cls, key }) => {
        const set = book.sets[key] ?? []
        const rail = isRailClass(cls)
        const drawn = cls.entries.some((e) => e.horse)
        const horses = horsesOf(key)
        return (
          <section key={key} className="panel draw-class" aria-label={`${cls.name}, ${meet.label}`}>
            <h3>
              {cls.id}. {cls.name}
              <span className="muted">
                {' '}
                {show.meets.length > 1 ? `${meet.label}, ` : ''}
                {cls.entries.length} riders. {rail ? 'No horse goes twice.' : 'A horse may go again.'}
              </span>
            </h3>
            {book.horses.length > 0 && (
              <>
                <p className="draw-label">
                  Horses for this class: {set.length} picked
                </p>
                <div className="chips">
                  {book.horses.map((h) => {
                    const on = set.includes(h.name)
                    return (
                      <button
                        key={h.name}
                        className={on ? 'draw-pick draw-pick-on' : 'draw-pick'}
                        aria-pressed={on}
                        onClick={() => setSet(key, cls, on ? set.filter((n) => n !== h.name) : [...set, h.name])}
                      >
                        {h.name} <span className="draw-pick-n">{used.get(h.name) ?? 0}</span>
                      </button>
                    )
                  })}
                </div>
                <div className="row-actions">
                  <button
                    className="btn"
                    onClick={() => setSet(key, cls, suggestSet(ridersOf(cls), book.horses, used, rail ? cls.entries.length + 2 : cls.entries.length))}
                  >
                    Pick the least used
                  </button>
                  <button className="btn" onClick={() => setSet(key, cls, book.horses.map((h) => h.name))}>
                    Pick all
                  </button>
                  <button className="btn" onClick={() => setSet(key, cls, [])}>
                    Pick none
                  </button>
                  <button className="btn btn-primary" disabled={cls.entries.length === 0} onClick={() => draw(key, cls)}>
                    {drawn ? 'Draw this class again' : 'Draw for this class'}
                  </button>
                </div>
              </>
            )}
            {classNote[key] && (
              <p className="hint" role="status">
                {classNote[key]}
              </p>
            )}
            {cls.entries.length === 0 ? (
              <p className="empty">No riders in this class yet.</p>
            ) : (
              <ul className="list draw-rows">
                {[...cls.entries]
                  .sort((a, b) => a.draw - b.draw)
                  .map((e) => {
                    const mine = book.horses.find((h) => h.name === e.horse)
                    const misfit = mine !== undefined && !fits(markFor(e.back_no), mine)
                    const options = [...new Set([...horses.map((h) => h.name), ...(e.horse ? [e.horse] : [])])]
                    return (
                      <li key={e.back_no} className="draw-row">
                        <span className="draw">{e.draw}</span>
                        <BackNumber value={e.back_no} size="sm" />
                        <strong className="rider-name">{e.rider || 'Rider not named'}</strong>
                        <select aria-label={`Horse for ${e.back_no}`} value={e.horse} onChange={(ev) => assign(key, e.back_no, ev.target.value)}>
                          <option value="">No horse</option>
                          {options.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                        {misfit && <span className="tag tag-warn">Does not fit</span>}
                        <button className="btn btn-small" disabled={horses.length === 0} aria-label={`Draw again for ${e.back_no}`} onClick={() => redraw(key, cls, e.back_no)}>
                          Redraw
                        </button>
                      </li>
                    )
                  })}
              </ul>
            )}
            {(cls.alternates ?? []).length > 0 && (
              <p className="alternates">
                <strong>Alternates:</strong> {(cls.alternates ?? []).join(', ')}
              </p>
            )}
          </section>
        )
      })}

      <p className="hint" role="status">
        The draw is saved on this computer as you go.{' '}
        {cloud.configured ? 'Phones get it when you publish the show.' : 'Phones get it from the show file.'}
      </p>
      <div className="stack">
        <button className="btn btn-primary btn-wide" onClick={() => go(`/s/${show.id}`)}>
          {cloud.configured ? 'Back to the show to publish' : 'Back to the show'}
        </button>
      </div>
    </Screen>
  )
}
