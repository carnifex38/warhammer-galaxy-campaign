import { useEffect, useState, type FormEvent } from 'react'
import type { AuthApi, Role } from './auth'
import { usePreload } from './preloadGalaxy'
import { DevPanel } from './devTools' // DEV-TOOLS

const CHOICES: { role: Role; title: string; blurb: string; icon: string }[] = [
  { role: 'guest', title: 'Guest', blurb: 'Look around the galaxy. No name needed.', icon: '◇' },
  { role: 'player', title: 'Player', blurb: 'Make a profile, claim battlezones, build armies.', icon: '⚔' },
  { role: 'gm', title: 'Gamemaster', blurb: 'Run the event. Password required.', icon: '♛' },
]

/** A slim bar along the bottom showing the galaxy being prepared in the background. It fades away when ready. */
function PreloadBar() {
  const { done, total, label } = usePreload()
  const finished = done >= total
  const [gone, setGone] = useState(false)
  useEffect(() => {
    if (!finished) return
    const t = window.setTimeout(() => setGone(true), 1800)
    return () => window.clearTimeout(t)
  }, [finished])
  if (gone) return null
  const pct = Math.round((done / total) * 100)
  return (
    <div className={`preload${finished ? ' done' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Preparing the galaxy">
      <div className="preload-text">
        <span>{label}{finished ? '' : '…'}</span>
        <strong>{pct}%</strong>
      </div>
      <div className="preload-bar"><i style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

/** The first screen: choose to enter as a guest, a player or the gamemaster. */
export default function LoginScreen({ auth }: { auth: AuthApi }) {
  const [role, setRole] = useState<Role | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [signUp, setSignUp] = useState(false) // players: make a new profile instead of signing in
  const [busy, setBusy] = useState(false)

  const choose = (r: Role) => {
    setError('')
    if (r === 'guest') { auth.loginGuest(); return }
    setRole(r)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (role === 'player') {
      if (!name.trim()) { setError('Enter your profile name.'); return }
      if (!password) { setError('Enter your password.'); return }
      setBusy(true)
      try {
        await (signUp ? auth.signUpPlayer(name, password) : auth.loginPlayer(name, password))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
        setPassword('')
      } finally {
        setBusy(false)
      }
    } else if (role === 'gm') {
      try {
        if (!(await auth.loginGm(password))) { setError('Wrong password.'); setPassword('') }
      } catch {
        setError('Cannot reach the server.')
      }
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <h1>Galaxy Campaign</h1>
        <p className="login-sub">Choose how you enter the galaxy</p>

        <div className="login-choices" role="group" aria-label="Enter as">
          {CHOICES.map((c) => (
            <button key={c.role} className={`login-choice${role === c.role ? ' on' : ''}`} onClick={() => choose(c.role)} aria-pressed={role === c.role}>
              <span className="login-icon" aria-hidden="true">{c.icon}</span>
              <span className="login-title">{c.title}</span>
              <span className="login-blurb">{c.blurb}</span>
            </button>
          ))}
        </div>

        {role && (
          <form className="login-form" onSubmit={submit}>
            {role === 'player' ? (
              <>
                <div className="login-mode" role="group" aria-label="Profile">
                  <button type="button" className={!signUp ? 'on' : ''} aria-pressed={!signUp} onClick={() => { setSignUp(false); setError('') }}>Sign in</button>
                  <button type="button" className={signUp ? 'on' : ''} aria-pressed={signUp} onClick={() => { setSignUp(true); setError('') }}>New profile</button>
                </div>
                <label>
                  <span>Profile name</span>
                  <input autoFocus value={name} maxLength={24} onChange={(e) => { setName(e.target.value); setError('') }} placeholder="e.g. Captain Varro" autoComplete="username" />
                </label>
                <label>
                  <span>{signUp ? 'Choose a password' : 'Password'}</span>
                  <input type="password" value={password} maxLength={64} onChange={(e) => { setPassword(e.target.value); setError('') }} autoComplete={signUp ? 'new-password' : 'current-password'} />
                </label>
                {signUp && <p className="login-hint">No email needed. Remember this name and password: they are the only way back into your profile and your armies.</p>}
              </>
            ) : (
              <label>
                <span>Gamemaster password</span>
                <input autoFocus type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError('') }} autoComplete="current-password" />
              </label>
            )}
            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="primary" type="submit" disabled={busy}>{role === 'player' ? (signUp ? 'Create profile' : 'Sign in') : 'Enter as gamemaster'}</button>
          </form>
        )}
      </div>
      <PreloadBar />
      <DevPanel auth={auth} /> {/* DEV-TOOLS */}
    </div>
  )
}
