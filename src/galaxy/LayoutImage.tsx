import { useRef, useState } from 'react'
import { uploadMedia, ProfileError } from '../api'

/** Larger pictures (a phone photo of a table, say) are scaled down to this many pixels on the long side before uploading. */
const MAX_SIDE = 2560
/** A picture smaller than this, and no larger than MAX_SIDE, is uploaded as it is. */
const KEEP_BYTES = 2_500_000
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

/** The picture to upload: as chosen when it is small enough (and always for a GIF, which may move), otherwise scaled down. */
async function prepare(file: File): Promise<Blob> {
  if (file.type === 'image/gif') return file
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size <= KEEP_BYTES) { bitmap.close(); return file }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const encode = (type: string) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.85))
  // WebP keeps transparency; a browser that cannot write it (it hands back a PNG instead) gets JPEG
  const webp = await encode('image/webp')
  return webp?.type === 'image/webp' ? webp : ((await encode('image/jpeg')) ?? file)
}

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

  const pick = async (file: File | undefined) => {
    if (!file || !gmToken) return
    setBusy(true)
    setError('')
    try {
      onChange(await uploadMedia(gmToken, await prepare(file)))
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
              {url && <button className="ghost" onClick={() => onChange(undefined)} disabled={busy}>Remove</button>}
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
