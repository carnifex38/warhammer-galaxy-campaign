import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteMediaFile, deleteMediaFolder, listMedia, makeMediaFolder, uploadMedia, ProfileError, Unauthorized, type MediaListing } from '../api'
import { IMAGE_ACCEPT, prepareImage } from './prepareImage'

const size = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The pictures stored on the server, as folders the gamemaster can browse: upload into the folder being shown, make folders, delete
 * pictures for good (to free room) and, when opened from a place that needs a picture, choose one. It only ever reaches the media
 * folder on the server: the server refuses any other path.
 */
export default function MediaLibrary({ gmToken, onPick, onClose }: {
  gmToken: string
  /** given when a picture is being chosen: each picture then has a Use button */
  onPick?: (url: string) => void
  onClose: () => void
}) {
  const [folder, setFolder] = useState('')
  const [listing, setListing] = useState<MediaListing | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [naming, setNaming] = useState<string | null>(null) // the new folder's name while it is being typed
  // what the gamemaster has asked to delete and has not yet confirmed
  const [asking, setAsking] = useState<{ kind: 'picture'; url: string; name: string; used: boolean } | { kind: 'folder'; path: string; name: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const fail = (e: unknown) => setError(e instanceof Unauthorized ? 'The gamemaster login has ended. Sign in again.' : e instanceof ProfileError ? e.message : 'The server could not be reached.')

  const load = useCallback(async (where: string) => {
    try {
      setListing(await listMedia(gmToken, where))
      setError('')
    } catch (e) {
      fail(e)
      if (where !== '') setFolder('') // a folder that is gone: back to the top
    }
  }, [gmToken])

  useEffect(() => { void load(folder) }, [folder, load])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (asking) setAsking(null); else onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, asking])

  const confirmDelete = () => {
    const a = asking
    setAsking(null)
    if (!a) return
    void run('Deleting…', () => (a.kind === 'picture' ? deleteMediaFile(gmToken, a.url) : deleteMediaFolder(gmToken, a.path)))
  }

  const run = async (what: string, job: () => Promise<unknown>) => {
    setBusy(what)
    setError('')
    try { await job() } catch (e) { fail(e) } finally { setBusy('') }
    await load(folder)
  }

  const upload = (files: FileList | null) => {
    if (!files?.length) return
    const chosen = [...files]
    void run('Uploading…', async () => {
      for (const f of chosen) await uploadMedia(gmToken, await prepareImage(f), folder, f.name)
    }).finally(() => { if (input.current) input.current.value = '' })
  }

  const makeFolder = () => {
    const name = (naming ?? '').trim()
    if (!name) { setNaming(null); return }
    void run('Making folder…', async () => { await makeMediaFolder(gmToken, folder, name); setNaming(null) })
  }

  const crumbs = folder ? folder.split('/') : []
  const open = (name: string) => setFolder(folder ? `${folder}/${name}` : name)

  return (
    <div className="bld-modal" role="dialog" aria-modal="true" aria-label="Media library" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bld-modal-card media-card">
        <header>
          <div>
            <h3>Media library</h3>
            <p>{listing ? `${plural(listing.total.pictures, 'picture')} stored · ${size(listing.total.bytes)} in all` : 'Loading…'}</p>
          </div>
          <button className="bld-x" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="bld-modal-body">
          <nav className="media-crumbs" aria-label="Folder">
            <button className="ghost" onClick={() => setFolder('')} disabled={folder === ''}>Library</button>
            {crumbs.map((c, i) => (
              <span key={i}>
                <span aria-hidden="true"> / </span>
                <button className="ghost" onClick={() => setFolder(crumbs.slice(0, i + 1).join('/'))} disabled={i === crumbs.length - 1}>{c}</button>
              </span>
            ))}
          </nav>

          <div className="media-bar">
            <input ref={input} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(e) => upload(e.target.files)} />
            <button className="ghost" onClick={() => input.current?.click()} disabled={busy !== ''}>{busy === 'Uploading…' ? busy : 'Upload pictures here'}</button>
            {naming === null
              ? <button className="ghost" onClick={() => setNaming('')} disabled={busy !== ''}>New folder</button>
              : (
                <form className="media-newfolder" onSubmit={(e) => { e.preventDefault(); makeFolder() }}>
                  <input autoFocus value={naming} maxLength={40} placeholder="Folder name" aria-label="New folder name" onChange={(e) => setNaming(e.target.value)} />
                  <button className="ghost" type="submit">Create</button>
                  <button className="ghost" type="button" onClick={() => setNaming(null)}>Cancel</button>
                </form>
              )}
          </div>

          {error && <p className="login-error" role="alert">{error}</p>}

          {listing && listing.folders.length === 0 && listing.files.length === 0 && <p className="muted">This folder is empty. Upload a picture or make a folder.</p>}

          {listing && listing.folders.length > 0 && (
            <ul className="media-grid">
              {listing.folders.map((f) => (
                <li key={f.name} className="media-item media-folder">
                  <button className="media-open" onClick={() => open(f.name)}>
                    <span className="media-icon" aria-hidden="true">📁</span>
                    <strong>{f.name}</strong>
                    <small className="muted">{plural(f.pictures, 'picture')}{f.pictures ? ` · ${size(f.bytes)}` : ''}</small>
                  </button>
                  {f.pictures === 0 && (
                    <button className="ghost danger" onClick={() => setAsking({ kind: 'folder', path: folder ? `${folder}/${f.name}` : f.name, name: f.name })}>Delete folder</button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {listing && listing.files.length > 0 && (
            <ul className="media-grid">
              {listing.files.map((f) => (
                <li key={f.url} className="media-item">
                  <a href={f.url} target="_blank" rel="noreferrer" className="media-thumb"><img src={f.url} alt={f.name} loading="lazy" /></a>
                  <small className="media-name" title={f.name}>{f.name}</small>
                  <small className="muted">{size(f.size)}{f.used && <span className="media-used"> · in use</span>}</small>
                  <div className="media-actions">
                    {onPick && <button className="ghost" onClick={() => { onPick(f.url); onClose() }}>Use this</button>}
                    <button className="ghost danger" disabled={busy !== ''} onClick={() => setAsking({ kind: 'picture', url: f.url, name: f.name, used: f.used })}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {asking && (
          <div className="media-confirm-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setAsking(null) }}>
            <div className="media-confirm" role="alertdialog" aria-modal="true" aria-label="Confirm delete">
              {asking.kind === 'picture' && <img src={asking.url} alt="" />}
              <h4>{asking.kind === 'picture' ? 'Delete this picture?' : 'Delete this folder?'}</h4>
              <p className="media-confirm-name">{asking.name}</p>
              <p className="muted">
                {asking.kind === 'picture' ? 'It is removed from the server for good and cannot be brought back.' : 'The folder is empty. It will be removed.'}
              </p>
              {asking.kind === 'picture' && asking.used && <p className="login-error">This picture is shown in the event right now. It will show as missing.</p>}
              <div className="media-confirm-actions">
                <button className="ghost" autoFocus onClick={() => setAsking(null)}>Cancel</button>
                <button className="danger" onClick={confirmDelete}>Yes, delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
