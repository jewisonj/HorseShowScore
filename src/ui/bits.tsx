import type { ReactNode } from 'react'

/** Navigate by changing the hash. Works offline and needs no server rewrite rules. */
export function go(path: string) {
  window.location.hash = path
}

/** The white card with a black number that a rider wears on their back. */
export function BackNumber({ value, size = 'md' }: { value: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`backno backno-${size}`} aria-label={`Back number ${value}`}>
      {value}
    </span>
  )
}

const PLACE_NAMES = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth']

/** Place marker in US ribbon colors: blue, red, yellow, white, pink, green. */
export function Ribbon({ place }: { place: number | null }) {
  if (place === null) {
    return (
      <span className="ribbon ribbon-none" aria-label="Not placed">
        –
      </span>
    )
  }
  const cls = place <= 6 ? `ribbon ribbon-${place}` : 'ribbon ribbon-plain'
  return (
    <span className={cls} aria-label={PLACE_NAMES[place - 1] ?? `Place ${place}`}>
      {place}
    </span>
  )
}

/**
 * A maneuver code such as "Rr S" or "LlL CL".
 * In circle codes a capital is a large fast circle and a small letter is a small slow one.
 * A small l looks like a capital I in most typefaces, so small letters are drawn as small capitals.
 */
export function Code({ value }: { value: string }) {
  return (
    <>
      {value.split(' ').map((token, i) => (
        <span key={i}>
          {i > 0 && ' '}
          {/^[RLrl]{2,3}$/.test(token) && /[rl]/.test(token)
            ? Array.from(token).map((ch, n) =>
                ch === ch.toLowerCase() ? (
                  <span key={n} className="code-small">
                    {ch}
                  </span>
                ) : (
                  ch
                ),
              )
            : token}
        </span>
      ))}
    </>
  )
}

/** "1 pt", "5 pts". Empty when there are no points. */
export function pts(points: number): string {
  if (points <= 0) return ''
  return points === 1 ? '1 pt' : `${points} pts`
}

export function Screen(props: {
  title: string
  sub?: string
  backTo?: string
  backLabel?: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="screen">
      <header className="topbar">
        <div className="topbar-row">
          {props.backTo !== undefined && (
            <button className="back" onClick={() => go(props.backTo!)}>
              <span aria-hidden="true">‹</span> {props.backLabel ?? 'Back'}
            </button>
          )}
          <div className="topbar-title">
            <h1>{props.title}</h1>
            {props.sub && <p>{props.sub}</p>}
          </div>
          {props.right}
        </div>
      </header>
      <p className="shadow-note" role="note">
        Unofficial test. Not the official record.
      </p>
      <main className="content">{props.children}</main>
    </div>
  )
}
