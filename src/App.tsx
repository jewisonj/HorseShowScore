import { useEffect, useState } from 'react'
import { useCloud } from './cloud/cloud'
import { seatName, signOff, useSeat } from './cloud/seat'
import { useCloudCache } from './data/cloudShows'
import { showOfMeet } from './data/fixture'
import { useSaveFailed } from './store'
import { go } from './ui/bits'
import { AccountScreen } from './ui/AccountScreen'
import { ClassScreen } from './ui/ClassScreen'
import { Home } from './ui/Home'
import { MeetScreen } from './ui/MeetScreen'
import { PlacingsScreen } from './ui/PlacingsScreen'
import { RailScreen } from './ui/RailScreen'
import { PublicHome, PublicShow } from './ui/PublicScreens'
import { ResultsAdminScreen } from './ui/ResultsAdminScreen'
import { ScoreCard } from './ui/ScoreCard'
import { SeatsScreen } from './ui/SeatsScreen'
import { SetupScreen } from './ui/SetupScreen'
import { ShowScreen } from './ui/ShowScreen'
import { SignOnScreen } from './ui/SignOnScreen'

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

/** Says who is signed on with a PIN, on every screen, with the way to sign off. */
function SeatBar() {
  const seat = useSeat()
  const cache = useCloudCache()
  if (!seat) return null
  const show = cache.shows.find((s) => s.id === seat.showId)
  return (
    <p className={seat.rejected ? 'seat-bar seat-bar-warn' : 'seat-bar'} role="status">
      <span>
        {seat.rejected
          ? `This PIN is no longer accepted. Scores stay on this device. Sign on again as ${seatName(seat)}.`
          : `Signed on as ${seatName(seat)}${show ? `, ${show.name}` : ''}`}
      </span>
      <button
        className="btn btn-small"
        onClick={() => {
          signOff()
          go('/')
        }}
      >
        Sign off
      </button>
    </p>
  )
}

function Route() {
  const p = useHashParts()
  const cloud = useCloud()
  const seat = useSeat()
  // Where the app has a server, each part is open only to the role it is for.
  // The server checks again whenever something is sent or published.
  const everything = !cloud.configured || cloud.admin
  const judgeOf = (showId: string | undefined) => everything || (seat?.role === 'judge' && seat.showId === showId)
  const officeOf = (showId: string | undefined) => everything || (seat?.role === 'office' && seat.showId === showId)

  if (p[0] === 'public') return p[1] ? <PublicShow key={p[1]} showId={p[1]} /> : <PublicHome />
  if (p[0] === 'account') return <AccountScreen />
  if (p[0] === 'm' && p[1]) {
    const meetId = p[1]
    if (!judgeOf(showOfMeet(meetId)?.id)) return <SignOnScreen />
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
    if (p[2] === 'seats') return <SeatsScreen key={`seats:${p[1]}`} showId={p[1]} />
    if (p[2] === 'results') return officeOf(p[1]) ? <ResultsAdminScreen key={`results:${p[1]}`} showId={p[1]} /> : <SignOnScreen />
    if (judgeOf(p[1])) return <ShowScreen showId={p[1]} />
    if (officeOf(p[1])) return <ResultsAdminScreen key={`results:${p[1]}`} showId={p[1]} />
    return <SignOnScreen />
  }
  if (p[0] === 'new') return <SetupScreen key="new" />
  // The first screen.
  if (everything) return <Home />
  if (seat?.role === 'judge') return <ShowScreen showId={seat.showId} />
  if (seat?.role === 'office') return <ResultsAdminScreen key={`results:${seat.showId}`} showId={seat.showId} />
  return <SignOnScreen />
}

export default function App() {
  const saveFailed = useSaveFailed()
  const parts = useHashParts()
  // The score card and the rail work screen fill the phone, keys at the bottom. Nothing goes above them.
  const onCard = parts[0] === 'm' && (parts[4] === 'r' || parts[4] === 'rail')
  return (
    <>
      {saveFailed && (
        <p className="save-failed" role="alert">
          This device could not save the last change. Its storage may be full or blocked. Write the score down on
          paper.
        </p>
      )}
      {!onCard && <SeatBar />}
      <Route />
    </>
  )
}
