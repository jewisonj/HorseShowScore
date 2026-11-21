import type { PublicCard } from '../cloud/backend'
import type { Pattern, ShowClass } from '../data/fixture'
import { formatHalf } from '../engine/half'
import { reasonById, ruleSetFor } from '../rules/rulesets'
import { BackNumber, Code } from './bits'

const MARK_WORDS: Record<string, string> = { OP: 'Off pattern', ZERO: 'Score 0', DQ: 'Disqualified' }

/**
 * One rider's score card, as the show office released it: each maneuver's
 * score with its penalties, the boxes outside the maneuvers, the total and the
 * judge's note. Read only.
 */
export function PublicCardView({ card, cls, pattern }: { card: PublicCard; cls: ShowClass; pattern: Pattern | undefined }) {
  const rules = ruleSetFor(cls.rule_set)
  const total = card.mark !== 'none' && MARK_WORDS[card.mark] ? MARK_WORDS[card.mark] : card.score !== null ? formatHalf(card.score) : 'No score'
  return (
    <details className="public-card">
      <summary>
        <span className="public-place">{card.place === null ? 'No place' : `${card.place}${card.tied ? ' tie' : ''}`}</span>
        <BackNumber value={card.back_no} size="sm" />
        <span className="row-main">
          <strong>{card.rider || 'Rider not named'}</strong>
          {card.horse && <span className="muted">{card.horse}</span>}
        </span>
        <span className="result-score">{total}</span>
      </summary>
      <ol className="public-card-rows">
        {card.boxes.map((value, i) => {
          const box = pattern?.boxes[i]
          const penalties = card.penalties.filter((p) => p.box === i)
          return (
            <li key={i}>
              <span className="public-card-box">
                <span className="public-card-name">
                  {i + 1}. {box?.abbr ? <Code value={box.abbr} /> : (box?.label ?? 'Maneuver')}
                </span>
                <strong>{value === null ? 'Not scored' : formatHalf(value, { sign: true })}</strong>
              </span>
              {penalties.map((p, n) => {
                const reason = reasonById(rules, p.half, p.reason)
                return (
                  <span key={n} className="public-card-penalty">
                    Penalty {formatHalf(p.half)}
                    {reason ? `: ${reason.short}` : ''}
                    {p.circled ? ' (circled, not counted)' : ''}
                  </span>
                )
              })}
            </li>
          )
        })}
        {rules.extras.map((extra) => {
          const value = card.extras[extra.id] ?? null
          return (
            <li key={extra.id}>
              <span className="public-card-box">
                <span className="public-card-name">{extra.label}</span>
                <strong>{value === null ? 'Not scored' : formatHalf(value, { sign: extra.signed })}</strong>
              </span>
            </li>
          )
        })}
        <li className="public-card-total">
          <span className="public-card-box">
            <span className="public-card-name">Score</span>
            <strong>{total}</strong>
          </span>
        </li>
      </ol>
      {card.note && <p className="public-card-note">Judge’s note: {card.note}</p>}
    </details>
  )
}
