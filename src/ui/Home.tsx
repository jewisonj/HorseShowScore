import { useRef, useState } from 'react'
import { event, formatDate, meets, classKey } from '../data/fixture'
import { resultsCsv } from '../results'
import { loadDraw } from '../seed'
import { classState, clearAll, restoreBackup, useAppState } from '../store'
import { Screen, go } from './bits'

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function Home() {
  const state = useAppState()
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')

  const stamp = new Date().toISOString().slice(0, 10)

  return (
    <Screen title="Horse Show Scorer" sub={`${event.name}, ${event.host}`}>
      <h2>Pick a meet</h2>
      <ul className="list">
        {meets.map((m) => {
          const riders = m.classes.reduce(
            (n, c) => n + classState(state, classKey(m.id, c.id)).runs.length,
            0,
          )
          return (
            <li key={m.id}>
              <button className="row row-meet" onClick={() => go(`/m/${m.id}`)}>
                <span className="row-main">
                  <strong>{m.label}</strong>
                  <span>{formatDate(m.date)}</span>
                  {m.judges.length > 0 && <span>Judge {m.judges.join(', ')}</span>}
                </span>
                <span className="row-side">{riders === 0 ? 'No riders yet' : `${riders} riders`}</span>
              </button>
            </li>
          )
        })}
      </ul>

      <h2>This device</h2>
      <p className="hint">
        Scores are saved on this phone or tablet only. Nothing is sent anywhere yet, so export before you clear
        anything.
      </p>
      <div className="stack">
        <button
          className="btn"
          onClick={() => download(`show-scorer-results-${stamp}.csv`, resultsCsv(state), 'text/csv')}
        >
          Export results as CSV
        </button>
        <button
          className="btn"
          onClick={() => download(`show-scorer-backup-${stamp}.json`, JSON.stringify(state), 'application/json')}
        >
          Back up this device
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Restore from a backup
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            if (!window.confirm('Restoring replaces everything saved on this device. Continue?')) return
            setMessage(restoreBackup(await file.text()) ? 'Backup restored.' : 'That file is not a Show Scorer backup.')
          }}
        />
        <button
          className="btn btn-danger"
          onClick={() => {
            if (window.confirm('Clear every score saved on this device and reload the draw? This cannot be undone.')) {
              clearAll()
              const riders = loadDraw()
              setMessage(riders > 0 ? `Scores cleared. The draw is loaded again: ${riders} rides.` : 'All test data cleared.')
            }
          }}
        >
          Clear scores and reload the draw
        </button>
      </div>
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
    </Screen>
  )
}
