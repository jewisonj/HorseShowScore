import { useEffect, useState } from 'react'
import { useSaveFailed } from './store'
import { AccountScreen } from './ui/AccountScreen'
import { ClassScreen } from './ui/ClassScreen'
import { Home } from './ui/Home'
import { MeetScreen } from './ui/MeetScreen'
import { PlacingsScreen } from './ui/PlacingsScreen'
import { RailScreen } from './ui/RailScreen'
import { ScoreCard } from './ui/ScoreCard'
import { SetupScreen } from './ui/SetupScreen'
import { ShowScreen } from './ui/ShowScreen'

function useHashParts(): string[] {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)
}

function Route() {
  const p = useHashParts()
  if (p[0] === 'm' && p[1]) {
    const meetId = p[1]
    if (p[2] === 'c' && p[3]) {
      const classId = p[3]
      if (p[4] === 'r' && p[5]) return <ScoreCard key={p[5]} meetId={meetId} classId={classId} runId={p[5]} />
      if (p[4] === 'place') return <PlacingsScreen meetId={meetId} classId={classId} />
      if (p[4] === 'rail') return <RailScreen key={`rail:${meetId}:${classId}`} meetId={meetId} classId={classId} />
      return <ClassScreen key={`${meetId}:${classId}`} meetId={meetId} classId={classId} />
    }
    return <MeetScreen meetId={meetId} />
  }
  if (p[0] === 's' && p[1]) {
    if (p[2] === 'setup') return <SetupScreen key={`setup:${p[1]}`} showId={p[1]} />
    return <ShowScreen showId={p[1]} />
  }
  if (p[0] === 'new') return <SetupScreen key="new" />
  if (p[0] === 'account') return <AccountScreen />
  return <Home />
}

export default function App() {
  const saveFailed = useSaveFailed()
  return (
    <>
      {saveFailed && (
        <p className="save-failed" role="alert">
          This device could not save the last change. Its storage may be full or blocked. Write the score down on
          paper.
        </p>
      )}
      <Route />
    </>
  )
}
