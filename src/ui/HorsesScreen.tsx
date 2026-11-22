import { useEffect, useState } from 'react'
import type { StableHorse } from '../cloud/backend'
import { explainServerError, getBackend, startCloud, useCloud } from '../cloud/cloud'
import { Screen, go } from './bits'

const GROUPS = [1, 2, 3] as const
const NO_PROVIDER = 'No provider given'

/**
 * For show admins: every horse the draws have used, by provider, with what it
 * carries. The list is kept on the server so a horse's limits are there for
 * the next show. Horses get onto it from a show's draw page.
 */
export function HorsesScreen() {
  const cloud = useCloud()
  const [horses, setHorses] = useState<StableHorse[] | null>(null)
  const [problem, setProblem] = useState('')
  const [saved, setSaved] = useState('')
  useEffect(() => {
    void startCloud()
  }, [])
  useEffect(() => {
    if (!cloud.admin) return
    let current = true
    void (async () => {
      try {
        const b = await getBackend()
        if (!b) return
        const list = await b.listHorses()
        if (current) setHorses(list)
      } catch (e) {
        if (current) setProblem(explainServerError(e))
      }
    })()
    return () => {
      current = false
    }
  }, [cloud.admin])

  if (!cloud.configured || !cloud.admin) {
    return (
      <Screen title="Horses" backTo="/" backLabel="Back">
        <p className="hint">{cloud.configured ? 'Only a show admin sees the horses list. Sign in as an admin to carry on.' : 'The horses list is kept on the server. This copy of the app has none.'}</p>
        {cloud.configured && (
          <div className="stack">
            <button className="btn btn-primary btn-wide" onClick={() => go('/account')}>
              Sign in
            </button>
          </div>
        )}
      </Screen>
    )
  }

  async function change(horse: StableHorse, patch: Partial<Pick<StableHorse, 'takesHeight' | 'maxGroup'>>) {
    const next = { ...horse, ...patch }
    const before = horses
    setHorses((list) => (list ?? []).map((h) => (h === horse ? next : h)))
    setProblem('')
    setSaved('')
    try {
      const b = await getBackend()
      if (!b) throw new Error('This copy of the app is not connected to a server.')
      await b.putHorses([next])
      setSaved(`Saved for ${horse.name}.`)
    } catch (e) {
      setHorses(before)
      setProblem(`${horse.name} was not saved. ${explainServerError(e)}`)
    }
  }

  const groups = new Map<string, StableHorse[]>()
  for (const h of horses ?? []) groups.set(h.provider || NO_PROVIDER, [...(groups.get(h.provider || NO_PROVIDER) ?? []), h])
  const names = [...groups.keys()].sort((a, b) => (a === NO_PROVIDER ? 1 : b === NO_PROVIDER ? -1 : a.localeCompare(b)))

  return (
    <Screen title="Horses" sub={horses ? `${horses.length} horses` : undefined} backTo="/" backLabel="Shows" wide>
      <p className="hint">
        Each horse's usual limits. A height rider cannot draw a horse marked height restricted, and a rider cannot draw a
        horse that carries less than their weight group. Limits for one class are set on a show's draw page. A horse is
        added here the first time it is listed on a show's draw page. Only show admins see this list.
      </p>
      {problem && (
        <p className="warning" role="alert">
          {problem}
        </p>
      )}
      {saved && (
        <p className="hint" role="status">
          {saved}
        </p>
      )}
      {horses === null && !problem && <p className="empty">Looking for the horses.</p>}
      {horses !== null && horses.length === 0 && <p className="empty">No horses yet. Add them on a show's draw page.</p>}
      {names.map((provider) => (
        <section key={provider} className="panel draw-class" aria-label={provider}>
          <h3>
            {provider}
            <span className="muted"> {groups.get(provider)!.length} horses</span>
          </h3>
          <ul className="list draw-horses">
            {groups
              .get(provider)!
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((h) => (
                <li key={`${h.name}|${h.provider}`} className="draw-horse">
                  <span className="draw-horse-name">
                    <strong>{h.name}</strong>
                    {Object.keys(h.byClass ?? {}).length > 0 && <span className="muted">Different limits in {Object.keys(h.byClass ?? {}).length === 1 ? '1 class' : `${Object.keys(h.byClass ?? {}).length} classes`}</span>}
                  </span>
                  <label className="draw-check">
                    <input type="checkbox" checked={!h.takesHeight} onChange={(e) => void change(h, { takesHeight: !e.target.checked })} />
                    <span>Height restricted</span>
                  </label>
                  <label className="draw-group">
                    <span>Carries up to group</span>
                    <select aria-label={`Heaviest weight group ${h.name} carries`} value={h.maxGroup} onChange={(e) => void change(h, { maxGroup: Number(e.target.value) as 1 | 2 | 3 })}>
                      {GROUPS.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </Screen>
  )
}
