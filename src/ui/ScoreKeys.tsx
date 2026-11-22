import { formatHalf, type Half } from '../engine'

export function scoreClass(h: Half): string {
  return h > 0 ? 'plus' : h < 0 ? 'minus' : 'zero'
}

/** The score keys for whatever is selected: a signed maneuver scale, or a plain 0 to 5. */
export function ScoreKeys(props: { scale: Half[]; signed: boolean; label: string; onPick: (value: Half) => void }) {
  if (!props.signed && props.scale.some((v) => v % 2 !== 0)) {
    // A plain scale with half points, such as F&E from 0 to 5: the whole numbers keep their row and their
    // places, and each half sits in a second row between the two numbers it falls between.
    const wholes = props.scale.filter((v) => v % 2 === 0)
    const halves = props.scale.filter((v) => v % 2 !== 0)
    const lowest = wholes.length ? wholes[0] : 0
    // Twice as many columns as whole numbers, so a half can start one column in.
    const column = (v: Half) => `${v - lowest + 1} / span 2`
    return (
      <div className="pad-plain pad-plain-halves" role="group" aria-label={props.label} style={{ gridTemplateColumns: `repeat(${Math.max(2, wholes.length * 2)}, 1fr)` }}>
        {wholes.map((value) => (
          <button key={value} className="key key-score key-plain" style={{ gridRow: 1, gridColumn: column(value) }} onClick={() => props.onPick(value)}>
            {formatHalf(value)}
          </button>
        ))}
        {halves.map((value) => (
          <button key={value} className="key key-score key-plain key-half" style={{ gridRow: 2, gridColumn: column(value) }} onClick={() => props.onPick(value)}>
            {formatHalf(value)}
          </button>
        ))}
      </div>
    )
  }
  if (!props.signed) {
    return (
      <div className="pad-plain" role="group" aria-label={props.label}>
        {props.scale.map((value) => (
          <button key={value} className="key key-score key-plain" onClick={() => props.onPick(value)}>
            {formatHalf(value)}
          </button>
        ))}
      </div>
    )
  }
  const steps = Math.max(...props.scale.map(Math.abs))
  return (
    <div className={`pad-scores pad-steps-${steps}`} role="group" aria-label={props.label}>
      {props.scale.map((value) => (
        <button
          key={value}
          className={`key key-score ${scoreClass(value)} s${value < 0 ? 'm' : 'p'}${Math.abs(value)}`}
          onClick={() => props.onPick(value)}
        >
          {formatHalf(value, { sign: true })}
        </button>
      ))}
    </div>
  )
}
