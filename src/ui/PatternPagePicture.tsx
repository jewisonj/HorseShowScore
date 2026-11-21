import { useState } from 'react'
import { pageImageUrl } from '../cloud/cloud'

/** The pattern's page of the pattern book, as a picture. Shows nothing when the pattern has none. */
export function PatternPagePicture({ path, name }: { path: string | undefined; name: string }) {
  const url = pageImageUrl(path)
  const [failed, setFailed] = useState(false)
  if (!url) return null
  if (failed) {
    return <p className="hint">The picture of this pattern did not load. It needs a connection the first time it is opened.</p>
  }
  return (
    <figure className="pattern-page">
      <a href={url} target="_blank" rel="noreferrer" aria-label={`Open the pattern book page for ${name} full size`}>
        <img src={url} alt={`Pattern book page for ${name}`} loading="lazy" onError={() => setFailed(true)} />
      </a>
      <figcaption className="muted">From the pattern book. Tap it to open it full size.</figcaption>
    </figure>
  )
}
