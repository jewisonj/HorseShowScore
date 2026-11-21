/**
 * Every score in the app is a whole number of half points.
 * 70½ is stored as 141. No floating point anywhere in scoring.
 * Convert to fractions only for display.
 */
export type Half = number

/** Points to half points. Accepts only multiples of 0.5. */
export function toHalf(points: number): Half {
  const h = points * 2
  if (!Number.isInteger(h)) throw new Error(`${points} is not a multiple of one half`)
  return h
}

const MINUS = '−' // true minus sign, as printed on a score card

/**
 * Format half points the way a scribe writes them: 70½, not 70.5.
 * With `sign`, positive values get a plus: +½, +1, 0, −1½.
 */
export function formatHalf(h: Half, opts: { sign?: boolean } = {}): string {
  if (!Number.isInteger(h)) throw new Error(`${h} is not a whole number of half points`)
  const negative = h < 0
  const abs = Math.abs(h)
  const whole = Math.floor(abs / 2)
  const hasHalf = abs % 2 === 1
  let body: string
  if (hasHalf) body = whole === 0 ? '½' : `${whole}½`
  else body = String(whole)
  if (negative) return MINUS + body
  if (opts.sign && h > 0) return '+' + body
  return body
}
