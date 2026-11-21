import { useEffect, useState } from 'react'
import { signIn, signOut, startCloud, useCloud } from '../cloud/cloud'
import { Screen } from './bits'

/** Sign in, for the people who set up and publish shows. Scoring needs no account. */
export function AccountScreen() {
  const cloud = useCloud()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    void startCloud()
  }, [])

  if (!cloud.configured) {
    return (
      <Screen title="Sign in" backTo="/" backLabel="Shows">
        <p className="hint">This copy of the app is not connected to a server, so there is nothing to sign in to.</p>
      </Screen>
    )
  }

  if (cloud.user) {
    return (
      <Screen title="Signed in" sub={cloud.user.email} backTo="/" backLabel="Shows">
        {cloud.admin ? (
          <p className="hint">
            This account can set up shows and publish them. Open a show and choose Publish, and every phone that is
            online will list it.
          </p>
        ) : (
          <p className="warning">
            This account is signed in, but it is not on the list of people who can publish shows. The owner adds
            accounts to that list by hand.
          </p>
        )}
        <div className="stack">
          <button className="btn" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </Screen>
    )
  }

  return (
    <Screen title="Sign in" sub="For setting up shows" backTo="/" backLabel="Shows">
      <p className="hint">Scoring needs no account. Sign in only to publish shows or have a pattern book read.</p>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault()
          if (busy) return
          setBusy(true)
          setProblem('')
          const said = await signIn(email, password)
          setBusy(false)
          if (said) setProblem(said)
          else setPassword('')
        }}
      >
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="btn btn-primary btn-wide" type="submit" disabled={busy}>
          {busy ? 'Signing in' : 'Sign in'}
        </button>
      </form>
      {problem && (
        <p className="warning" role="alert">
          {problem}
        </p>
      )}
      <p className="hint">Accounts are made by the owner. There is no sign-up here.</p>
    </Screen>
  )
}
