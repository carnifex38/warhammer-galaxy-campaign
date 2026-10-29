import { useRef, useState } from 'react'
import { uploadMedia, ProfileError } from '../api'
import MediaLibrary from './MediaLibrary'
import { IMAGE_ACCEPT as ACCEPT, prepareImage as prepare } from './prepareImage'

/**
 * A battlezone's layout picture. Everyone sees it once there is one (a click opens it full size). The gamemaster uploads, replaces
 * or removes it here; the picture is stored on the server and the event keeps its address.
 */
export default function LayoutImage({ url, gmToken, isGm, onChange }: {
  url?: string
  /** the gamemaster's server login; uploading needs it */
  gmToken?: string
  isGm: boolean
  onChange: (url: string | undefined) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [library, setLibrary] = useState(false)

  const pick = async (file: File | undefined) => {
    if (!file || !gmToken) return
    setBusy(true)
    setError('')
    try {
      onChange(await uploadMedia(gmToken, await prepare(file), '', file.name))
    } catch (e) {
      setError(e instanceof ProfileError ? e.message : 'That picture could not be uploaded.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = '' // choosing the same file again still uploads
    }
  }

  return (
    <div className="layout-image">
      {url
        ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Battlezone layout" /></a>
        : <div className="layout-placeholder">{isGm ? 'No layout image yet' : 'Battlezone layout image goes here'}</div>}
      {isGm && (
        <div className="layout-actions">
          <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => void pick(e.target.files?.[0])} />
          {gmToken ? (
            <>
              <button className="ghost" onClick={() => input.current?.click()} disabled={busy}>{busy ? 'Uploading…' : url ? 'Replace layout image' : 'Upload layout image'}</button>
              <button className="ghost" onClick={() => setLibrary(true)} disabled={busy}>Choose from library</button>
              {url && <button className="ghost" onClick={() => onChange(undefined)} disabled={busy}>Remove</button>}
              {library && <MediaLibrary gmToken={gmToken} onPick={onChange} onClose={() => setLibrary(false)} />}
            </>
          ) : (
            <span className="muted">Uploading needs the gamemaster login on the server.</span>
          )}
        </div>
      )}
      {error && <p className="login-error" role="alert">{error}</p>}
    </div>
  )
}
