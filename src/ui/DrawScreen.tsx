import { useEffect, useRef, useState } from 'react'
import type { RosterRider, StableHorse } from '../cloud/backend'
import { explainServerError, fetchWorkbook, getBackend, startCloud, useCloud } from '../cloud/cloud'
import { useCloudCache } from '../data/cloudShows'
import { allShows, builtInShows, classKey, getShow, type ShowClass, type ShowFile } from '../data/fixture'
import { saveShow, useUserShows } from '../data/shows'
import { ruleSetFor } from '../rules/rulesets'
import { loadDraw } from '../seed'
import { finishShow, mergeSheetRead } from '../setup/draft'
import { addHorses, limitsIn, markOf, saveDrawBook, useDrawBook, type BookHorse, type DrawBook, type RiderMark } from '../setup/drawBook'
import { classForSheet, drawCsv, sheetDraw, takeSheetDraw } from '../setup/drawExport'
import { drawClass, drawPlaces, fits, redrawOne, suggestSet, rideCounts, type DrawRider, type WeightGroup } from '../setup/horseDraw'
import { rememberSheetLink, sheetLinkFor } from '../setup/sheetLink'
import { findStable, stableRow, withListLimits } from '../setup/stable'
import { readDrawTab, readHorses, readRoster } from '../setup/workbook'
import { readXlsx } from '../setup/xlsx'
import { BackNumber, Screen, go } from './bits'
import { download, slug } from './files'

const GROUPS: WeightGroup[] = [1, 2, 3]

/** True for a class that works the rail together, where no horse can go twice. */
function isRailClass(cls: ShowClass): boolean {
  return ruleSetFor(cls.rule_set).extras.some((e) => e.id === 'rail')
}

/** "every section of Level I Horsemanship" for a class with sections, else "this class". Sections of one class share their limits. */
function divisionWords(cls: ShowClass): string {
  return cls.section ? `every section of ${cls.name.replace(/,?\s*sec(tion|\.)?\s*[a-z0-9]\s*$/i, '')}` : 'this class'
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
  // The sheet this show was read from in setup is remembered on this computer, so it need not be pasted again.
  const [link, setLink] = useState(() => sheetLinkFor(showId))
  const remembered = sheetLinkFor(showId) !== ''
  const [busy, setBusy] = useState(false)
  const [horseNote, setHorseNote] = useState('')
  const [ridersNote, setRidersNote] = useState('')
  const [classNote, setClassNote] = useState<Record<string, string>>({})
  // Lines copied for the sheet that the device would not copy by itself, shown to be copied by hand.
  const [toCopy, setToCopy] = useState<Record<string, string>>({})
  const [showRiders, setShowRiders] = useState(false)
  // The classes whose list of per-class limits is open.
  const [showLimits, setShowLimits] = useState<Record<string, boolean>>({})
  // The riders list on the server, by back number. Null where there is no server, or it could not be reached.
  const [roster, setRoster] = useState<Map<string, RosterRider> | null>(null)
  const [rosterNote, setRosterNote] = useState('')
  // The horses list on the server, where each horse's limits are kept from show to show. Null where there is no server, or it could not be reached.
  const [stable, setStable] = useState<StableHorse[] | null>(null)
  const stableStopped = useRef(false)
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
        const list = await b.listHorses()
        if (current) setStable(list)
      } catch (e) {
        if (current) setHorseNote(`Could not reach the horses list, so the limits kept on this computer are used. ${explainServerError(e)}`)
      }
    })()
    return () => {
      current = false
    }
  }, [cloud.configured, cloud.admin])
  // A horse of this show that the list does not have yet is put on it, with the limits set here.
  useEffect(() => {
    if (!stable || stableStopped.current) return
    const missing = book.horses.filter((h) => !findStable(stable, h))
    if (missing.length === 0) return
    const rows = missing.map((h) => stableRow(stable, h))
    stableStopped.current = true
    void (async () => {
      try {
        const b = await getBackend()
        if (!b) return
        await b.putHorses(rows)
        setStable((list) => [...(list ?? []), ...rows])
        stableStopped.current = false
      } catch (e) {
        // Left stopped, so a server that is refusing is not asked again and again. The limits stay on this computer.
        setHorseNote(`The horses could not be saved to the horses list. Their limits are kept on this computer for now. ${explainServerError(e)}`)
      }
    })()
  }, [stable, book.horses])
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

  /** This show's horses, each with the limits the horses list has for it. */
  const horsesNow: BookHorse[] = book.horses.map((h) => withListLimits(stable, h))

  /**
   * Change what a horse carries: its usual limits, or its limits in one class
   * when a class number is given. A class set back to the usual limits stops
   * being a special case. Kept on this computer and, where there is a server,
   * on the horses list.
   */
  async function setLimits(name: string, patch: Partial<Pick<BookHorse, 'takesHeight' | 'maxGroup'>>, classNo?: string) {
    const now = horsesNow.find((h) => h.name === name)
    if (!now) return
    let next: BookHorse
    if (classNo === undefined) next = { ...now, ...patch }
    else {
      const there = limitsIn(now, classNo)
      const own = { takesHeight: patch.takesHeight ?? there.takesHeight, maxGroup: patch.maxGroup ?? there.maxGroup }
      const byClass = { ...(now.byClass ?? {}) }
      if (own.takesHeight === now.takesHeight && own.maxGroup === now.maxGroup) delete byClass[classNo]
      else byClass[classNo] = own
      next = { ...now, byClass }
    }
    setBook({ ...book, horses: book.horses.map((h) => (h.name === name ? { ...h, takesHeight: next.takesHeight, maxGroup: next.maxGroup, byClass: next.byClass ?? {} } : h)) })
    if (!stable) return
    const row = stableRow(stable, next)
    const before = stable
    setStable([...stable.filter((s) => s !== findStable(stable, next)), row])
    try {
      const b = await getBackend()
      if (!b) throw new Error('This copy of the app is not connected to a server.')
      await b.putHorses([row])
      setHorseNote('')
    } catch (e) {
      setStable(before)
      setHorseNote(`${name} was not saved to the horses list. ${explainServerError(e)}`)
    }
  }

  /**
   * A show set up from its patterns alone has classes and nobody in them, so
   * there is nobody to draw for. When the app ships its own copy of this show
   * with the riders of the IHSA program, take that copy's classes and riders.
   * The days keep their details, and each class keeps the pattern chosen here
   * for its division.
   */
  function useAppRiders() {
    const current = getShow(showId)
    const own = builtInShows.find((s) => s.id === showId)
    if (!current || !own) return
    const read = mergeSheetRead(current.meets, own.meets).meets
    const meets = read.map((m) => {
      const mine = current.meets.find((b) => b.id === m.id)
      return mine ? { ...mine, classes: m.classes } : m
    })
    const used = new Set(meets.flatMap((m) => m.classes.map((c) => c.pattern_id)))
    const patterns = [...current.patterns, ...own.patterns.filter((p) => used.has(p.id) && !current.patterns.some((q) => q.id === p.id))]
    if (!saveShow(finishShow({ ...current, meets, patterns }))) {
      setRidersNote('This computer could not store the show. Its storage may be full.')
      return
    }
    loadDraw()
    const rides = meets.reduce((n, m) => n + m.classes.reduce((k, c) => k + c.entries.length, 0), 0)
    const count = meets.reduce((n, m) => n + m.classes.length, 0)
    setRidersNote(`${count} classes and ${rides} rides are in. If you read the horses from the sheet before, read them again so they land on the right classes. Then draw, and publish the changes from the show page.`)
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

  /** The horses set for a class, each with its limits in that class. */
  function horsesOf(key: string, classNo: string): BookHorse[] {
    const set = book.sets[key] ?? []
    return horsesNow.filter((h) => set.includes(h.name)).map((h) => limitsIn(h, classNo))
  }

  function setSet(key: string, cls: ShowClass, set: string[]) {
    setBook({ ...book, sets: { ...book.sets, [key]: set } })
    if (cls.entries.some((e) => e.horse)) changeClass(key, (c) => ({ ...c, alternates: alternatesOf(c, set) }))
  }

  /** The horse in each draw place of a class whose horses came from the sheet, or null when they are picked here. */
  function placesOf(key: string): string[] | null {
    const places = book.places?.[key]
    return places && places.some((p) => p !== '') ? places : null
  }

  function bookHorse(name: string, classNo: string): BookHorse {
    const horse = horsesNow.find((h) => h.name === name)
    return horse ? limitsIn(horse, classNo) : { name, takesHeight: true, maxGroup: 3 }
  }

  function draw(key: string, cls: ShowClass) {
    const places = placesOf(key)
    const horses = horsesOf(key, cls.class_no)
    if (!places && horses.length === 0) {
      note(key, 'Pick the horses for this class first.')
      return
    }
    if (cls.entries.some((e) => e.horse) && !window.confirm(`Draw ${cls.name} again? Every rider in it gets a new horse.`)) return
    if (places) {
      // The sheet has a horse beside each draw place. Every rider draws a place.
      const result = drawPlaces(ridersOf(cls), places.map((name) => (name ? bookHorse(name, cls.class_no) : null)))
      let after = places.length
      changeClass(key, (c) => ({
        ...c,
        entries: c.entries.map((e) => {
          const place = result.placeOf[e.back_no]
          return place === undefined ? { ...e, horse: '', draw: ++after } : { ...e, horse: places[place], draw: place + 1 }
        }),
        alternates: [...new Set([...(book.alts?.[key] ?? []), ...result.free.map((i) => places[i])])],
      }))
      note(
        key,
        result.noHorse.length > 0
          ? `No free horse on the sheet's list fits ${result.noHorse.join(', ')}. Give them a horse by hand.`
          : `Drawn. ${cls.entries.length} riders each drew a place on the sheet's list of horses.`,
      )
      return
    }
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
    const places = placesOf(key)
    if (places) {
      // Only a place nobody holds can be drawn again. Their own place goes back on the list.
      const held = new Set(cls.entries.filter((e) => e.back_no !== backNo && e.horse).map((e) => e.draw - 1))
      const mine = cls.entries.find((e) => e.back_no === backNo)
      const free = places.map((name, i) => ({ name, i })).filter((p) => p.name && !held.has(p.i) && p.i !== (mine?.horse ? mine.draw - 1 : -1) && fits(rider, bookHorse(p.name, cls.class_no)))
      if (free.length === 0) {
        note(key, `There is no free horse on the sheet's list for ${backNo}. Give them a horse by hand.`)
        return
      }
      const pick = free[Math.floor(Math.random() * free.length)]
      changeClass(key, (c) => ({ ...c, entries: c.entries.map((e) => (e.back_no === backNo ? { ...e, horse: pick.name, draw: pick.i + 1 } : e)) }))
      note(key, `${backNo} drew ${pick.name}, place ${pick.i + 1}.`)
      return
    }
    const horseOf = Object.fromEntries(cls.entries.filter((e) => e.horse).map((e) => [e.back_no, e.horse]))
    const horse = redrawOne(rider, horsesOf(key, cls.class_no), horseOf, { reuse: !isRailClass(cls) })
    if (horse === null) {
      note(key, `There is no other horse in this set for ${backNo}.`)
      return
    }
    assign(key, backNo, horse)
    note(key, `${backNo} drew ${horse}.`)
  }

  /** Copy one column of a class's draw for the sheet, and say where it goes. */
  async function copyColumn(key: string, what: 'back numbers' | 'horses' | 'alternates', lines: string[], cell: string | undefined) {
    const text = lines.join('\n')
    const where = cell ? `On the sheet's draw tab, click ${cell} and paste. Paste as values only.` : 'Paste it into that class on the sheet\'s draw tab, as values only.'
    try {
      await navigator.clipboard.writeText(text)
      setToCopy((c) => ({ ...c, [key]: '' }))
      note(key, `The ${what} are copied. ${where}`)
    } catch {
      setToCopy((c) => ({ ...c, [key]: text }))
      note(key, `This device would not copy by itself. Select the lines below and copy them. ${where}`)
    }
  }

  function assign(key: string, backNo: string, horse: string) {
    const set = book.sets[key] ?? []
    const fromSheet = placesOf(key) !== null
    changeClass(key, (c) => {
      const next = { ...c, entries: c.entries.map((e) => (e.back_no === backNo ? { ...e, horse } : e)) }
      // A class on the sheet's list keeps the sheet's alternates. Otherwise the alternates are the set's horses nobody has.
      return fromSheet ? next : { ...next, alternates: alternatesOf(next, set) }
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
      const wb = readXlsx(got.bytes)
      const found = readHorses(wb)
      const perClass = readDrawTab(wb)
      if (found.length === 0 && perClass.length === 0) {
        setHorseNote('That sheet has no horses on its "Horse Points" tab or its draw tab.')
        return
      }
      rememberSheetLink(showId, link.trim())
      // A show with nobody in its classes takes the program's classes and riders first, when the app has them:
      // the sheet's draw table is laid out by those classes, sections and all.
      const ridesIn = (list: ShowFile) => list.meets.reduce((n, m) => n + m.classes.reduce((k, c) => k + c.entries.length, 0), 0)
      const own = builtInShows.find((x) => x.id === showId)
      const before = getShow(showId)
      let broughtIn = ''
      if (own && before && ridesIn(before) === 0 && ridesIn(own) > 0) {
        useAppRiders()
        setRidersNote('')
        broughtIn = `This show had no riders, so the program's ${own.meets.reduce((n, m) => n + m.classes.length, 0)} classes and ${ridesIn(own)} rides were brought in first. `
      }
      const listed = [...found.map((h) => h.name), ...perClass.flatMap((c) => [...c.places, ...c.alternates]).filter(Boolean)]
      // The sheet's own list says who provides each horse. A horse only named on the draw tab has no provider.
      const { book: withHorses, added } = addHorses(book, [...found, ...perClass.flatMap((c) => [...c.places, ...c.alternates]).filter(Boolean)])
      // Each class the sheet has horses for takes them, in the sheet's own order of draw places.
      const places = { ...(withHorses.places ?? {}) }
      const alts = { ...(withHorses.alts ?? {}) }
      const sets = { ...withHorses.sets }
      const current = getShow(showId)
      // The sheet's own list of riders names anyone its draw has whom the class here did not.
      const names = new Map(readRoster(wb).map((r) => [r.backNo, r.rider]))
      const nameOf = (backNo: string) => current?.meets.flatMap((m) => m.classes.flatMap((c) => c.entries)).find((e) => e.back_no === backNo && e.rider)?.rider ?? names.get(backNo) ?? ''
      const matched = new Set<string>()
      const unmatched: string[] = []
      const newRiders: string[] = []
      const notOnSheet: string[] = []
      let drawn = 0
      for (const from of perClass) {
        const meet = (current?.meets ?? []).find((m) => {
          const c = classForSheet(m, from)
          return c !== undefined && !matched.has(classKey(m.id, c.id))
        })
        const cls = meet ? classForSheet(meet, from) : undefined
        if (!meet || !cls) {
          unmatched.push(from.name || `class ${from.classNo}`)
          continue
        }
        const key = classKey(meet.id, cls.id)
        matched.add(key)
        places[key] = from.places
        alts[key] = from.alternates
        sets[key] = [...new Set(from.places.filter(Boolean))]
        if (from.backNos.some(Boolean)) {
          // The riders have drawn and the sheet has it: take that draw as it stands.
          const taken = takeSheetDraw(cls.entries, from, nameOf)
          drawn++
          newRiders.push(...taken.added)
          notOnSheet.push(...taken.missing)
          changeClass(key, (c) => ({ ...c, entries: taken.entries, alternates: from.alternates }))
        } else {
          // The judge's class list shows the sheet's alternates straight away.
          changeClass(key, (c) => ({ ...c, alternates: from.alternates }))
        }
      }
      // A class that took its horses from a sheet before, and is not on this one, goes back to none:
      // an earlier read may have put another class's horses on it.
      for (const key of Object.keys(places)) {
        if (matched.has(key)) continue
        delete places[key]
        delete alts[key]
        delete sets[key]
        changeClass(key, (c) => ({ ...c, alternates: [] }))
      }
      setBook({ ...withHorses, places, alts, sets })
      const some = (list: string[]) => `${list.slice(0, 8).join(', ')}${list.length > 8 ? ` and ${list.length - 8} more` : ''}`
      setHorseNote(
        broughtIn +
          `The sheet lists ${new Set(listed.map((h) => h.toLowerCase())).size} horses. ${added} were added.` +
          (matched.size > 0 ? ` It sets the horses for ${matched.size} ${matched.size === 1 ? 'class' : 'classes'}, which now use the sheet's list.` : ' It has no horses set for a class yet.') +
          (drawn > 0
            ? ` The sheet has the riders' draw for ${drawn} ${drawn === 1 ? 'class' : 'classes'}. It was taken as it stands: each rider is on the horse of their draw place. Publish the changes from the show page to send it to the phones.`
            : matched.size > 0
              ? ' No back numbers are typed on the sheet yet, so no rider has a horse. Read it again after the riders draw.'
              : '') +
          (newRiders.length > 0 ? ` Added from the sheet's draw, not in the class here before: ${some(newRiders)}.` : '') +
          (notOnSheet.length > 0 ? ` Taken out of a class, because the sheet's draw for it does not have them: ${some(notOnSheet)}. If the sheet is still being typed, read it again when it is done.` : '') +
          (unmatched.length > 0 ? ` No class of this show is named as the sheet names ${some(unmatched)}, so those horses were not set.` : '') +
          ' The sheet was only read. Nothing in it was changed.',
      )
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

      {(() => {
        const own = builtInShows.find((s) => s.id === showId)
        const rides = (list: ShowFile) => list.meets.reduce((n, m) => n + m.classes.reduce((k, c) => k + c.entries.length, 0), 0)
        const count = (list: ShowFile) => list.meets.reduce((n, m) => n + m.classes.length, 0)
        if (!own || rides(own) === 0 || rides(show) > 0) return null
        return (
          <section className="panel" aria-label="No riders in this show">
            <p className="warning" role="alert">
              This show has {count(show) === 1 ? '1 class' : `${count(show)} classes`} and no riders, so there is nobody to draw for.
            </p>
            <p className="hint">
              The app has this show from the IHSA program: {count(own)} classes in running order, with sections, and {rides(own)} rides. Using it replaces the
              classes here. Each class keeps the pattern you chose for its division, and the day keeps its times.
            </p>
            <button className="btn btn-primary" onClick={useAppRiders}>
              Use the classes and riders from the program
            </button>
          </section>
        )
      })()}
      {ridersNote && (
        <p className="hint" role="status">
          {ridersNote}
        </p>
      )}
      <h2>Horses</h2>
      <p className="hint">
        These are each horse's usual limits. A height rider cannot draw a horse marked height restricted. A rider cannot
        draw a horse that carries less than their weight group. Each class below can set its own limits for its horses.
        {stable ? ' They are kept on the horses list on the server, so they are here for the next show too. Only show admins see them.' : ''}
      </p>
      {book.horses.length === 0 ? (
        <p className="empty">No horses yet. Add them below.</p>
      ) : (
        <ul className="list draw-horses">
          {horsesNow.map((h) => (
            <li key={h.name} className="draw-horse">
              <span className="draw-horse-name">
                <strong>{h.name}</strong>
                <span className="muted">{used.get(h.name) ?? 0} rides</span>
              </span>
              <label className="draw-check">
                <input type="checkbox" checked={!h.takesHeight} onChange={(e) => void setLimits(h.name, { takesHeight: !e.target.checked })} />
                <span>Height restricted</span>
              </label>
              <label className="draw-group">
                <span>Carries up to group</span>
                <select
                  aria-label={`Heaviest weight group ${h.name} carries`}
                  value={h.maxGroup}
                  onChange={(e) => void setLimits(h.name, { maxGroup: Number(e.target.value) as WeightGroup })}
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
            <span>
              Or read the horse list, and the horses set for each class, from the show's Google Sheet
              {remembered ? '. This is the link the show was read from.' : ''}
            </span>
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
        const horses = horsesOf(key, cls.class_no)
        const fromSheet = placesOf(key)
        // The horses this class can use: the sheet's draw places and alternates, or the ones picked here.
        const inClass = [...new Set(fromSheet ? [...fromSheet.filter(Boolean), ...(book.alts?.[key] ?? [])] : set)]
          .map((name) => horsesNow.find((h) => h.name === name))
          .filter((h): h is BookHorse => h !== undefined)
        const changedHere = inClass.filter((h) => h.byClass?.[cls.class_no] !== undefined).length
        const forSheet = sheetDraw(meet, cls)
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
            {fromSheet ? (
              <>
                <p className="draw-label">The sheet sets this class's horses, one for each draw place:</p>
                <p className="draw-places">{fromSheet.map((name, i) => `${i + 1} ${name || 'none'}`).join(', ')}</p>
                {(book.alts?.[key] ?? []).length > 0 && <p className="draw-places">Alternates on the sheet: {(book.alts?.[key] ?? []).join(', ')}</p>}
                <div className="row-actions">
                  <button className="btn btn-primary" disabled={cls.entries.length === 0} onClick={() => draw(key, cls)}>
                    {drawn ? 'Draw this class again' : 'Draw for this class'}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      const places = { ...(book.places ?? {}) }
                      const alts = { ...(book.alts ?? {}) }
                      delete places[key]
                      delete alts[key]
                      setBook({ ...book, places, alts })
                    }}
                  >
                    Pick the horses here instead
                  </button>
                </div>
              </>
            ) : (
              book.horses.length > 0 && (
                <>
                  <p className="draw-label">Horses for this class: {set.length} picked</p>
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
                      onClick={() => setSet(key, cls, suggestSet(ridersOf(cls), horsesNow.map((h) => limitsIn(h, cls.class_no)), used, rail ? cls.entries.length + 2 : cls.entries.length))}
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
              )
            )}
            {inClass.length > 0 && (
              <>
                <button className="btn" aria-expanded={showLimits[key] === true} onClick={() => setShowLimits({ ...showLimits, [key]: !showLimits[key] })}>
                  {showLimits[key] ? 'Hide the limits for this class' : `Height and weight limits for this class (${changedHere} changed)`}
                </button>
                {showLimits[key] && (
                  <>
                    <p className="hint">
                      Change a horse's limits for {divisionWords(cls)} only. The rest of the show keeps the horse's usual limits.
                    </p>
                    <ul className="list draw-horses">
                      {inClass.map((h) => {
                        const here = limitsIn(h, cls.class_no)
                        const own = h.byClass?.[cls.class_no] !== undefined
                        return (
                          <li key={h.name} className="draw-horse">
                            <span className="draw-horse-name">
                              <strong>{h.name}</strong>
                              <span className="muted">{own ? 'Set for this class' : 'Usual limits'}</span>
                            </span>
                            <label className="draw-check">
                              <input
                                type="checkbox"
                                aria-label={`${h.name} is height restricted in ${cls.name}`}
                                checked={!here.takesHeight}
                                onChange={(e) => void setLimits(h.name, { takesHeight: !e.target.checked }, cls.class_no)}
                              />
                              <span>Height restricted</span>
                            </label>
                            <label className="draw-group">
                              <span>Carries up to group</span>
                              <select
                                aria-label={`Heaviest weight group ${h.name} carries in ${cls.name}`}
                                value={here.maxGroup}
                                onChange={(e) => void setLimits(h.name, { maxGroup: Number(e.target.value) as WeightGroup }, cls.class_no)}
                              >
                                {GROUPS.map((g) => (
                                  <option key={g} value={g}>
                                    {g}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {own && (
                              <button className="textbtn" aria-label={`Use the usual limits for ${h.name} in ${cls.name}`} onClick={() => void setLimits(h.name, { takesHeight: h.takesHeight, maxGroup: h.maxGroup }, cls.class_no)}>
                                Use the usual
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}
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
                    const mine = horsesNow.find((h) => h.name === e.horse)
                    const misfit = mine !== undefined && !fits(markFor(e.back_no), limitsIn(mine, cls.class_no))
                    const options = [...new Set([...horses.map((h) => h.name), ...(fromSheet ? (book.alts?.[key] ?? []) : []), ...(e.horse ? [e.horse] : [])])]
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
                        <button className="btn btn-small" disabled={horses.length === 0 && !fromSheet} aria-label={`Draw again for ${e.back_no}`} onClick={() => redraw(key, cls, e.back_no)}>
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
            {drawn && (
              <>
                <p className="draw-label">For the show's sheet, one line for each draw place:</p>
                <div className="row-actions">
                  <button className="btn" onClick={() => void copyColumn(key, 'back numbers', forSheet.backNos, forSheet.cells?.backCell)}>
                    Copy the back numbers
                  </button>
                  <button className="btn" onClick={() => void copyColumn(key, 'horses', forSheet.horses, forSheet.cells?.horseCell)}>
                    Copy the horses
                  </button>
                  {(cls.alternates ?? []).length > 0 && (
                    <button className="btn" onClick={() => void copyColumn(key, 'alternates', forSheet.alternates, forSheet.cells?.alternateCell)}>
                      Copy the alternates
                    </button>
                  )}
                </div>
                {forSheet.leftOut.length > 0 && <p className="hint">The sheet has twelve draw places. {forSheet.leftOut.join(', ')} did not fit and are not in the copy.</p>}
                {toCopy[key] && <textarea readOnly rows={12} value={toCopy[key]} aria-label={`Lines to paste for ${cls.name}`} onFocus={(e) => e.target.select()} />}
              </>
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
        <button className="btn btn-wide" onClick={() => download(`${slug(show.name)}-draw.csv`, drawCsv(show), 'text/csv')}>
          Download the draw as CSV
        </button>
      </div>
      <p className="hint">
        The CSV has a back number column and a horse column for each class, one row for each draw place, with the cell
        to paste at. Open it beside the sheet and copy a column across. The app never writes to the sheet itself.
      </p>
    </Screen>
  )
}
