import { useState, type FormEvent } from 'react'
import type { AuthApi, Role } from './auth'

const CHOICES: { role: Role; title: string; blurb: string; icon: string }[] = [
  { role: 'guest', title: 'Guest', blurb: 'Look around the galaxy. No name needed.', icon: '◇' },
  { role: 'player', title: 'Player', blurb: 'Pick a callsign, claim battlezones, build armies.', icon: '⚔' },
  { role: 'gm', title: 'Gamemaster', blurb: 'Run the event. Password required.', icon: '♛' },
]

/** The first screen: choose to enter as a guest, a player or the gamemaster. */
export default function LoginScreen({ auth }: { auth: AuthApi }) {
  const [role, setRole] = useState<Role | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const choose = (r: Role) => {
    setError('')
    if (r === 'guest') { auth.loginGuest(); return }
    setRole(r)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (role === 'player') {
      if (!name.trim()) { setError('Choose a callsign to enter.'); return }
      auth.loginPlayer(name)
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
              <label>
                <span>Callsign</span>
                <input autoFocus value={name} maxLength={24} onChange={(e) => { setName(e.target.value); setError('') }} placeholder="e.g. Captain Varro" autoComplete="nickname" />
              </label>
            ) : (
              <label>
                <span>Gamemaster password</span>
                <input autoFocus type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError('') }} autoComplete="current-password" />
              </label>
            )}
            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="primary" type="submit">{role === 'player' ? 'Enter as player' : 'Enter as gamemaster'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
