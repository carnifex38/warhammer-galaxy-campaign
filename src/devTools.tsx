import { useState } from 'react'
import { DEV_TOOLS, type AuthApi, type Role } from './auth'
import { setStutterWindow, useStutterWindow } from './perf'

// DEV TOOLS: a shortcut for building and testing. It lets the team step in as the gamemaster, a dummy player or a guest
// without a password, from the top-right corner of the login screen, and flip between them from the top bar.
//
// It is for LOCAL testing only: a dev gamemaster has no server token, so it can look at and change this browser's own
// settings but can never change the shared event on a live server. On the published site the DEV button is hidden unless
// the address ends in `?dev` (see DEV_TOOLS in src/auth.ts), so a tester opens that link once and his browser remembers it.
//
// TO REMOVE IT LATER: delete this file, then delete the lines marked DEV-TOOLS in src/auth.ts, src/LoginScreen.tsx,
// src/App.tsx and the "Dev tools" block at the end of src/index.css.

const CHOICES: { role: Role; label: string; hint: string; name: string }[] = [
  { role: 'gm', label: 'Gamemaster', hint: 'every tab, no password, local settings only', name: 'Dev Gamemaster' },
  { role: 'player', label: 'Dummy player', hint: 'a test player account', name: 'Dummy Player' },
  { role: 'guest', label: 'Guest', hint: 'read-only visitor', name: 'Guest' },
]

/** The DEV button in the corner of the login screen. */
export function DevPanel({ auth }: { auth: AuthApi }) {
  const [open, setOpen] = useState(false)
  if (!DEV_TOOLS) return null
  return (
    <div className="dev-corner">
      <button className="dev-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Developer tools">DEV</button>
      {open && (
        <div className="dev-menu" role="menu">
          <p>Developer access (testing only)</p>
          {CHOICES.map((c) => (
            <button key={c.role} role="menuitem" onClick={() => auth.loginDev(c.role, c.name)}>
              <b>{c.label}</b>
              <small>{c.hint}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A small switch in the top bar, shown only while signed in through the dev tools: flip roles without logging out. */
export function DevSwitch({ auth }: { auth: AuthApi }) {
  const stutter = useStutterWindow()
  if (!DEV_TOOLS || !auth.session?.dev) return null
  return (
    <div className="dev-switch" role="group" aria-label="Switch developer role">
      <span>DEV</span>
      {CHOICES.map((c) => (
        <button key={c.role} className={auth.session?.role === c.role ? 'on' : ''} aria-pressed={auth.session?.role === c.role} onClick={() => auth.loginDev(c.role, c.name)}>
          {c.role === 'gm' ? 'GM' : c.role === 'player' ? 'Player' : 'Guest'}
        </button>
      ))}
      <button className={stutter ? 'on' : ''} aria-pressed={stutter} onClick={() => setStutterWindow(!stutter)} title="Show or hide the stutter window">Stutter</button>
    </div>
  )
}
