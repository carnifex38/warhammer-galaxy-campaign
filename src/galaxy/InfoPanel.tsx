import { useEffect, useState } from 'react'
import type { InfoContent } from './infoDefaults'
import InfoEditor, { type RevealField } from './InfoEditor'
import { BlockView } from './Blocks'
import { sortedBlocks } from './blockModel'

type Tab = 'info' | 'intel' | 'mission'

const TABS: { id: Tab; label: string }[] = [
  { id: 'info', label: 'Info' },
  { id: 'intel', label: 'Intel' },
  { id: 'mission', label: 'Mission' },
]

export interface InfoPanelProps {
  /** SECTOR / PLANET / SPACE HULK */
  kind: string
  title: string
  subtitle: string
  /** the sector's colour, used as the accent */
  color: string
  content: InfoContent
  /** a line of live facts shown along the bottom, e.g. "3 of 4 tables open" */
  status: string
  onClose: () => void
  /** given to gamemasters: shows an Edit button that changes this window's text and pictures right here (the same as in the Host tab) */
  gm?: {
    token?: string
    /** everything, hidden sections included (what `content` leaves out for players) */
    full: InfoContent
    edited: boolean
    reveal: RevealField[]
    onChange: (change: Partial<InfoContent>) => void
    onReset: () => void
  }
}

/** What players see when the host has not revealed a section yet. */
function Classified({ what }: { what: string }) {
  return (
    <div className="info-classified">
      <strong>◆ Classified ◆</strong>
      <p>The event host has not yet revealed the {what}.</p>
    </div>
  )
}

/** Paragraphs from a block of text: blank lines split them. */
const paragraphs = (text: string) => text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

/**
 * The information window for a sector, planet or space hulk: a briefing, intelligence and the mission the event
 * sets there. A side panel on desktop; on tablets and phones it floats over a darkened map.
 */
export default function InfoPanel({ kind, title, subtitle, color, content, status, onClose, gm }: InfoPanelProps) {
  const [tab, setTab] = useState<Tab>('info')
  const [editing, setEditing] = useState(false)

  // start on the first page whenever a different place is shown
  useEffect(() => { setTab('info'); setEditing(false) }, [title])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const objectives = content.objectives.filter((o) => o.trim())
  const rewards = content.rewards.filter((o) => o.trim())
  const hasMission = (objectives.length > 0 || rewards.length > 0 || sortedBlocks(content.missionBlocks).length > 0) && !content.missionHidden
  const editor = gm && editing ? gm : null

  return (
    <>
      <div className="info-backdrop" onClick={onClose} aria-hidden="true" />
      <section className="info" role="dialog" aria-label={`${title} information`} style={{ ['--accent' as string]: color }}>
        <header className="info-head">
          <span className="info-kind">◆ {kind}</span>
          <span className="info-head-tools">
            {gm && <button className={`info-edit${editing ? ' on' : ''}`} onClick={() => setEditing((e) => !e)}>{editing ? '✓ Done' : '✎ Edit'}</button>}
            <button className="info-close" onClick={onClose} aria-label="Close information">✕</button>
          </span>
        </header>

        <div className="info-title">
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>

        <div className="info-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'info' && content.infoHidden && <i className="lock" aria-label="classified">🔒</i>}
              {t.id === 'intel' && content.intelHidden && <i className="lock" aria-label="classified">🔒</i>}
              {t.id === 'mission' && content.missionHidden && <i className="lock" aria-label="classified">🔒</i>}
              {t.id === 'mission' && hasMission && <i className="dot" aria-label="has objectives" />}
            </button>
          ))}
        </div>

        <div className="info-body">
          {editor && (
            <InfoEditor content={editor.full} edited={editor.edited} reveal={editor.reveal} only={tab} token={editor.token} onChange={editor.onChange} onReset={editor.onReset} />
          )}

          {!editor && tab === 'info' && content.infoHidden && <Classified what="briefing notes" />}
          {!editor && tab === 'info' && !content.infoHidden && (
            <>
              {paragraphs(content.summary).map((p, i) => <p key={i}>{p}</p>)}
              <BlockView blocks={content.infoBlocks} />
            </>
          )}

          {!editor && tab === 'intel' && content.intelHidden && <Classified what="intelligence" />}
          {!editor && tab === 'intel' && !content.intelHidden && (
            <>
              {content.intel.trim()
                ? paragraphs(content.intel).map((p, i) => <p key={i}>{p}</p>)
                : sortedBlocks(content.intelBlocks).length === 0 && <p className="info-empty">No intelligence has been gathered yet.</p>}
              <BlockView blocks={content.intelBlocks} />
            </>
          )}

          {!editor && tab === 'mission' && content.missionHidden && <Classified what="orders" />}
          {!editor && tab === 'mission' && !content.missionHidden && (
            hasMission ? (
              <>
                {objectives.length > 0 && (
                  <>
                    <h4>Mission objectives</h4>
                    <ul className="info-list">
                      {objectives.map((o, i) => <li key={i}>{o}</li>)}
                    </ul>
                  </>
                )}
                {rewards.length > 0 && (
                  <>
                    <h4>Rewards</h4>
                    <ul className="info-list reward">
                      {rewards.map((o, i) => <li key={i}>{o}</li>)}
                    </ul>
                  </>
                )}
                <BlockView blocks={content.missionBlocks} />
              </>
            ) : (
              <p className="info-empty">The event host has not set a mission here.</p>
            )
          )}
        </div>

        <footer className="info-foot">{status}</footer>
      </section>
    </>
  )
}
