import { formatHalf, type Half } from '../engine'

export function scoreClass(h: Half): string {
  return h > 0 ? 'plus' : h < 0 ? 'minus' : 'zero'
}

/** The score keys for whatever is selected: a signed maneuver scale, or a plain 0 to 5. */
export function ScoreKeys(props: { scale: Half[]; signed: boolean; label: string; onPick: (value: Half) => void }) {
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
