import type { InfoContent } from './infoDefaults'

/** The sections a host can hide from players. */
export type RevealField = 'info' | 'intel' | 'mission' | 'zones'

const REVEAL: Record<RevealField, { key: 'infoHidden' | 'intelHidden' | 'missionHidden' | 'zonesHidden'; name: string }> = {
  info: { key: 'infoHidden', name: 'Info' },
  intel: { key: 'intelHidden', name: 'Intel' },
  mission: { key: 'missionHidden', name: 'Mission' },
  zones: { key: 'zonesHidden', name: 'Battlezones' },
}

/** Host-side form for rewriting one information window, and choosing which sections players may see. */
export default function InfoEditor({ content, edited, reveal, onChange, onReset }: {
  content: InfoContent
  /** true when the host has changed it from the built-in text */
  edited: boolean
  /** which reveal switches to offer here */
  reveal: RevealField[]
  onChange: (change: Partial<InfoContent>) => void
  onReset: () => void
}) {
  const lines = (v: string) => v.split('\n')
  return (
    <div className="info-editor">
      {reveal.map((f) => {
        const { key, name } = REVEAL[f]
        const hidden = content[key]
        return (
          <div className="reveal-row" key={f}>
            <label className="switch">
              <input type="checkbox" checked={!hidden} onChange={(e) => onChange({ [key]: !e.target.checked })} aria-label={`Reveal ${name.toLowerCase()} to players`} />
              <span aria-hidden="true" />
            </label>
            <span>{name} {hidden ? 'is hidden from players' : 'is revealed'}</span>
          </div>
        )
      })}
      <label>
        <span>Info (briefing)</span>
        <textarea rows={3} value={content.summary} onChange={(e) => onChange({ summary: e.target.value })} />
      </label>
      <label>
        <span>Intel (bio / intelligence)</span>
        <textarea rows={4} value={content.intel} onChange={(e) => onChange({ intel: e.target.value })} />
      </label>
      <label>
        <span>Mission objectives (one per line)</span>
        <textarea rows={3} value={content.objectives.join('\n')} onChange={(e) => onChange({ objectives: lines(e.target.value) })} placeholder="e.g. Hold the bridge for five turns" />
      </label>
      <label>
        <span>Rewards (one per line)</span>
        <textarea rows={2} value={content.rewards.join('\n')} onChange={(e) => onChange({ rewards: lines(e.target.value) })} placeholder="e.g. +2 campaign points" />
      </label>
      <button className="ghost" onClick={onReset} disabled={!edited}>Reset to default text</button>
    </div>
  )
}
