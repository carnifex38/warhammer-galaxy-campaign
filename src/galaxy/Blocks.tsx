import { useRef, useState } from 'react'
import { uploadMedia, ProfileError } from '../api'
import { addBlocks, changeBlock, moveBlock, removeBlock, sortedBlocks, type BlockMap } from './blockModel'
import MediaLibrary from './MediaLibrary'
import { IMAGE_ACCEPT, prepareImage } from './prepareImage'

/** Paragraphs from a block of text: blank lines split them. */
const paragraphs = (text: string) => text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

/** The text and pictures added after an information tab's first text, in order, as players see them. A picture opens full size in a new tab. */
export function BlockView({ blocks }: { blocks: BlockMap | undefined }) {
  const list = sortedBlocks(blocks)
  if (list.length === 0) return null
  return (
    <>
      {list.map((b) => b.t === 'text'
        ? paragraphs(b.text ?? '').map((p, i) => <p key={`${b.id}-${i}`}>{p}</p>)
        : (
          <figure key={b.id} className="info-pic">
            <a href={b.url} target="_blank" rel="noreferrer"><img src={b.url} alt={b.caption ?? ''} loading="lazy" /></a>
            {b.caption?.trim() && <figcaption>{b.caption}</figcaption>}
          </figure>
        ))}
    </>
  )
}

/**
 * The gamemaster's controls for what follows an information tab's first text: add text and pictures (upload, or choose from the media
 * library), give a picture a caption, put the blocks in order and take them off. Taking a picture off only removes it from this page;
 * it stays in the media library.
 */
export function BlockEditor({ blocks, token, onChange }: { blocks: BlockMap | undefined; token?: string; onChange: (blocks: BlockMap) => void }) {
  const latest = useRef(blocks)
  latest.current = blocks // (an upload takes a while: add to what is there when it finishes, not to what was there when it began)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [library, setLibrary] = useState(false)
  const list = sortedBlocks(blocks)

  const addPictures = (urls: string[]) => onChange(addBlocks(latest.current, urls.map((url) => ({ t: 'pic' as const, url }))))
  const upload = async (files: FileList | null) => {
    if (!files?.length || !token) return
    const chosen = [...files]
    setBusy(true)
    setError('')
    try {
      const got: string[] = []
      for (const f of chosen) got.push(await uploadMedia(token, await prepareImage(f), '', f.name))
      addPictures(got)
    } catch (e) {
      setError(e instanceof ProfileError ? e.message : 'A picture could not be uploaded.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="block-editor">
      <span className="block-title">Then more text and pictures, in the order shown</span>
      {list.length > 0 && (
        <ol className="block-list">
          {list.map((b, i) => (
            <li key={b.id} className={`block block-${b.t}`}>
              {b.t === 'text' ? (
                <textarea rows={3} value={b.text ?? ''} aria-label="Text" placeholder="Write the next part here…" onChange={(e) => onChange(changeBlock(latest.current, b.id, { text: e.target.value }))} />
              ) : (
                <div className="block-pic">
                  <a href={b.url} target="_blank" rel="noreferrer"><img src={b.url} alt="" loading="lazy" /></a>
                  <input value={b.caption ?? ''} maxLength={200} placeholder="Caption (optional)" aria-label="Caption" onChange={(e) => onChange(changeBlock(latest.current, b.id, { caption: e.target.value }))} />
                </div>
              )}
              <div className="block-tools">
                <button className="ghost" onClick={() => onChange(moveBlock(latest.current, b.id, -1))} disabled={i === 0} aria-label="Move up">▲</button>
                <button className="ghost" onClick={() => onChange(moveBlock(latest.current, b.id, 1))} disabled={i === list.length - 1} aria-label="Move down">▼</button>
                <button className="ghost danger" onClick={() => onChange(removeBlock(latest.current, b.id))} title={b.t === 'pic' ? 'Takes it off this page. It stays in the media library.' : undefined}>Remove</button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="block-add">
        <button className="ghost" onClick={() => onChange(addBlocks(latest.current, [{ t: 'text', text: '' }]))}>Add text</button>
        {token ? (
          <>
            <input ref={input} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(e) => void upload(e.target.files)} />
            <button className="ghost" onClick={() => input.current?.click()} disabled={busy}>{busy ? 'Uploading…' : 'Upload pictures'}</button>
            <button className="ghost" onClick={() => setLibrary(true)} disabled={busy}>Choose from library</button>
          </>
        ) : (
          <span className="muted">Adding pictures needs the gamemaster login on the server.</span>
        )}
      </div>
      {error && <p className="login-error" role="alert">{error}</p>}
      {library && token && <MediaLibrary gmToken={token} onPick={(u) => addPictures([u])} onClose={() => setLibrary(false)} />}
    </div>
  )
}
