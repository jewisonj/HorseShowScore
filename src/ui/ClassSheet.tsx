import { useEffect, useState } from 'react'
import type { PublicCard, ReleasedCards } from '../cloud/backend'
import { startCloud, useCloud } from '../cloud/cloud'
import { loadCoachRiders, useCoach } from '../cloud/roster'
import { loadCards } from '../cloud/scores'
import { classKey, type Pattern, type ShowClass } from '../data/fixture'
import { formatHalf } from '../engine/half'
import { reasonById, ruleSetFor } from '../rules/rulesets'
import { Code, Screen } from './bits'
import { showDates } from './Home'
import { MARK_WORDS } from './PublicCard'
import { usePublishedShows } from './PublicScreens'

/**
 * A class's released score cards on one sheet, the way the IHSA score sheet
 * and the show programs lay a class out (owner, 2026-11-22): a row for each
 * rider, a column for each maneuver with the penalty over the score, then the
 * boxes outside the maneuvers, the penalty total and the score.
 *
 * Only what the show office has released, which anyone may see. No school, no
 * judge, nothing of a class that has not been released.
 */
export function ClassSheetTable({ cls, pattern, cards, mine }: { cls: ShowClass; pattern: Pattern | undefined; cards: PublicCard[]; mine: Set<string> }) {
  const rules = ruleSetFor(cls.rule_set)
  const columns = Math.max(pattern?.boxes.length ?? 0, ...cards.map((c) => c.boxes.length))
  // First place first. Riders with no place follow, best score first.
  const rows = [...cards].sort((a, b) => (a.place ?? 9999) - (b.place ?? 9999) || (b.score ?? -1) - (a.score ?? -1))
  const span = 3 + columns + rules.extras.length + 2
  return (
    <div className="class-sheet-scroll">
      <table className="class-sheet">
        <caption>
          {cls.id}. {cls.name}
          {pattern ? <span className="class-sheet-pattern">, {pattern.name}</span> : null}
        </caption>
        <thead>
          <tr>
            <th scope="col">Place</th>
            <th scope="col">Back #</th>
            <th scope="col" className="class-sheet-who">
              Rider and horse
            </th>
            {Array.from({ length: columns }, (_, i) => {
              const box = pattern?.boxes[i]
              return (
                <th key={i} scope="col" title={box?.label} aria-label={`Maneuver ${i + 1}${box?.label ? `, ${box.label}` : ''}`}>
                  <span className="class-sheet-no">{i + 1}</span>
                  {box?.abbr && (
                    <span className="class-sheet-code">
                      <Code value={box.abbr} />
                    </span>
                  )}
                </th>
              )
            })}
            {rules.extras.map((extra) => (
              <th key={extra.id} scope="col" title={extra.label} aria-label={extra.label}>
                {extra.abbr}
              </th>
            ))}
            <th scope="col" title="Penalties counted">
              Pen.
            </th>
            <th scope="col">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((card) => {
            const yours = mine.has(card.back_no)
            const counted = card.penalties.filter((p) => !p.circled).reduce((n, p) => n + p.half, 0)
            // A disqualified rider has no score. A score of 0 is a 0. An off pattern ride keeps its score, with OP beside it.
            const total = card.mark === 'DQ' ? 'DQ' : card.mark === 'ZERO' ? '0' : card.score !== null ? formatHalf(card.score) : 'No score'
            // What the numbers do not say by themselves: the mark, each penalty's reason, and the judge's note.
            const notes: string[] = []
            if (card.mark !== 'none' && MARK_WORDS[card.mark]) notes.push(`${MARK_WORDS[card.mark]}.`)
            for (const p of card.penalties) {
              const reason = reasonById(rules, p.half, p.reason)
              const where = p.box >= 0 && p.box < columns ? `Maneuver ${p.box + 1}` : 'Penalty'
              if (reason || p.circled || where === 'Penalty') notes.push(`${where}: ${formatHalf(p.half)}${reason ? ` ${reason.short}` : ''}${p.circled ? ' (circled, not counted)' : ''}.`)
            }
            if (card.note) notes.push(`Judge’s note: ${card.note}`)
            return [
              <tr key={card.back_no} className={yours ? 'class-sheet-mine' : undefined}>
                <td>{card.place === null ? '' : `${card.place}${card.tied ? ' tie' : ''}`}</td>
                <td className="class-sheet-back">{card.back_no}</td>
                <td className="class-sheet-who">
                  <strong>{card.rider || 'Rider not named'}</strong>
                  {yours && <span className="sr-only"> (your rider)</span>}
                  {card.horse && <span className="class-sheet-horse">{card.horse}</span>}
                </td>
                {Array.from({ length: columns }, (_, i) => {
                  const value = card.boxes[i] ?? null
                  const here = card.penalties.filter((p) => p.box === i)
                  return (
                    <td key={i}>
                      <span className="class-sheet-pen">{here.map((p) => (p.circled ? `(${formatHalf(p.half)})` : formatHalf(p.half))).join(' ')}</span>
                      <span className="class-sheet-score">{value === null ? '' : formatHalf(value, { sign: true })}</span>
                    </td>
                  )
                })}
                {rules.extras.map((extra) => {
                  const value = card.extras[extra.id] ?? null
                  return (
                    <td key={extra.id}>
                      <span className="class-sheet-pen" />
                      <span className="class-sheet-score">{value === null ? '' : formatHalf(value, { sign: extra.signed })}</span>
                    </td>
                  )
                })}
                <td className={counted > 0 ? 'class-sheet-pentotal' : undefined}>{formatHalf(counted)}</td>
                <td className="class-sheet-total">
                  {total}
                  {card.mark === 'OP' && <span className="class-sheet-mark"> OP</span>}
                </td>
              </tr>,
              notes.length > 0 && (
                <tr key={`${card.back_no}:notes`} className={yours ? 'class-sheet-notes class-sheet-mine' : 'class-sheet-notes'}>
                  <td colSpan={span}>
                    {card.back_no}: {notes.join(' ')}
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
      {(pattern?.boxes.length ?? 0) > 0 && (
        <ol className="class-sheet-key">
          {pattern!.boxes.map((box, i) => (
            <li key={i}>{box.label || box.abbr}</li>
          ))}
        </ol>
      )}
      <p className="class-sheet-foot">
        The penalty is over the score in each box. Score = 70 + maneuvers{rules.extras.length > 0 ? ` + ${rules.extras.map((e) => e.abbr).join(' + ')}` : ''} − penalties.
        {rules.extras.some((e) => e.id === 'fe') ? ' F&E: 5 excellent, 4 very good, 3 good, 0 to 2 average.' : ''}
      </p>
    </div>
  )
}

/** The page for one class's sheet, from the public pages or from a coach's screen. It prints on one landscape page. */
export function ClassSheetScreen({ showId, meetId, classId, backTo, backLabel }: { showId: string; meetId: string; classId: string; backTo: string; backLabel: string }) {
  const cloud = useCloud()
  const { shows } = usePublishedShows()
  const [released, setReleased] = useState<ReleasedCards[] | null>(null)
  // A coach signed on to this device has their own riders marked. Nobody else sees that.
  const coach = useCoach()
  const [mine, setMine] = useState<Set<string>>(new Set())
  useEffect(() => {
    let current = true
    void startCloud()
      .then(() => loadCards(showId))
      .then((got) => {
        if (current) setReleased(got ?? [])
      })
    return () => {
      current = false
    }
  }, [showId])
  useEffect(() => {
    if (!coach) return
    let current = true
    void loadCoachRiders().then((got) => {
      if (current && got.ok) setMine(new Set(got.riders.map((r) => r.backNo)))
    })
    return () => {
      current = false
    }
  }, [coach?.team, coach?.pin])

  const show = shows.find((s) => s.id === showId)
  const meet = show?.meets.find((m) => m.id === meetId)
  const cls = meet?.classes.find((c) => c.id === classId)
  if (!show || !meet || !cls) {
    return (
      <Screen title="Score sheet" backTo={backTo} backLabel={backLabel}>
        <p className="empty">{cloud.check === 'failed' ? 'Could not reach the server. Check the connection and try again.' : cloud.check === 'ok' ? 'That class is not in a published show.' : 'Looking for the class.'}</p>
      </Screen>
    )
  }
  const pattern = show.patterns.find((p) => p.id === cls.pattern_id)
  const cards = released?.find((c) => c.classKey === classKey(meet.id, cls.id))?.cards ?? []
  return (
    <Screen title="Score sheet" sub={`${cls.id}. ${cls.name}`} backTo={backTo} backLabel={backLabel} wide>
      <p className="class-sheet-show">
        {show.name}, {showDates(show)}
      </p>
      {released === null && <p className="empty">Looking for the score cards.</p>}
      {released !== null && cards.length === 0 && <p className="empty">The show office has not released this class's score cards.</p>}
      {cards.length > 0 && (
        <>
          <p className="hint no-print">
            Every rider's card for this class on one sheet, as the show office released it. On a phone, turn it sideways or slide the sheet across.
            {mine.size > 0 ? ' Your riders are marked.' : ''}
          </p>
          <button className="btn no-print" onClick={() => window.print()}>
            Print this sheet
          </button>
          <ClassSheetTable cls={cls} pattern={pattern} cards={cards} mine={mine} />
        </>
      )}
    </Screen>
  )
}
