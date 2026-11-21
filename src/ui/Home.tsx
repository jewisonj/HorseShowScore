import { useRef, useState } from 'react'
import { allShows, classKey, formatDate, type ShowFile } from '../data/fixture'
import { isShowFile, readShowFile, saveShow, useUserShows, userShows } from '../data/shows'
import { loadDraw } from '../seed'
import { classState, clearAll, restoreBackup, useAppState } from '../store'
import { Screen, go } from './bits'
import { download } from './files'

/** "November 21 to 22" style summary of a show's days. */
export function showDates(show: ShowFile): string {
  const dates = show.meets.map((m) => m.date).filter(Boolean).sort()
  if (dates.length === 0) return 'No date set'
  if (dates.length === 1 || dates[0] === dates[dates.length - 1]) return formatDate(dates[0])
  return `${formatDate(dates[0])} to ${formatDate(dates[dates.length - 1])}`
}

/** The first screen: pick a show, create one, or open one from a file. */
export function Home() {
  const state = useAppState()
  useUserShows()
  const showFileRef = useRef<HTMLInputElement>(null)
  const backupRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const shows = allShows()
  const stamp = new Date().toISOString().slice(0, 10)

  return (
    <Screen title="Horse Show Scorer" sub="Pick a show">
      <h2>Shows</h2>
      <ul className="list">
        {shows.map((show) => {
          const classes = show.meets.flatMap((m) => m.classes.map((c) => classKey(m.id, c.id)))
          const rides = classes.reduce((n, key) => n + classState(state, key).runs.length, 0)
          return (
            <li key={show.id}>
              <button className="row row-meet" onClick={() => go(`/s/${show.id}`)}>
                <span className="row-main">
                  <strong>{show.name}</strong>
                  {show.host && <span>{show.host}</span>}
                  <span>{showDates(show)}</span>
                </span>
                <span className="row-side">
                  {classes.length} classes
                  <br />
                  {rides} rides
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="stack">
        <button className="btn btn-primary btn-wide" onClick={() => go('/new')}>
          Create a show
        </button>
        <button className="btn" onClick={() => showFileRef.current?.click()}>
          Open a show file
        </button>
        <input
          ref={showFileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            const show = readShowFile(await file.text())
            if (!show) {
              setMessage('That file is not a show file.')
              return
            }
            if (!saveShow(show)) {
              setMessage('This device could not store the show. Its storage may be full.')
              return
            }
            loadDraw()
            go(`/s/${show.id}`)
          }}
        />
      </div>
      <p className="hint">
        Setting up a show is easiest on a computer. Save it there, send the show file to each phone, and open it here.
      </p>

      <h2>This device</h2>
      <p className="hint">
        Scores are saved on this phone or tablet only. Nothing is sent anywhere yet, so back up before you clear
        anything.
      </p>
      <div className="stack">
        <button
          className="btn"
          onClick={() =>
            download(`show-scorer-backup-${stamp}.json`, JSON.stringify({ ...state, shows: userShows() }), 'application/json')
          }
        >
          Back up this device
        </button>
        <button className="btn" onClick={() => backupRef.current?.click()}>
          Restore from a backup
        </button>
        <input
          ref={backupRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            if (!window.confirm('Restoring replaces every score saved on this device. Continue?')) return
            const text = await file.text()
            if (!restoreBackup(text)) {
              setMessage('That file is not a Show Scorer backup.')
              return
            }
            try {
              const shows: unknown = (JSON.parse(text) as { shows?: unknown }).shows
              if (Array.isArray(shows)) shows.filter(isShowFile).forEach((s) => saveShow(s))
            } catch {
              // The scores are restored. A backup from an older build has no shows in it.
            }
            setMessage('Backup restored.')
          }}
        />
        <button
          className="btn btn-danger"
          onClick={() => {
            if (window.confirm('Clear every score saved on this device and reload the draws? This cannot be undone.')) {
              clearAll()
              const riders = loadDraw()
              setMessage(riders > 0 ? `Scores cleared. The draws are loaded again: ${riders} rides.` : 'All scores cleared.')
            }
          }}
        >
          Clear scores and reload the draws
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
