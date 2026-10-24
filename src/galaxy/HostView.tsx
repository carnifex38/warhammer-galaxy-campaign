import { useState } from 'react'
import { MAX_HULKS, isHulkId } from './data'
import InfoEditor from './InfoEditor'
import { MARS_SAMPLE } from './sampleMissions'
import { defaultPlanetInfo, defaultSectorInfo, defaultZoneInfo } from './infoDefaults'
import type { Era } from './planetLooks'
import type { ClaimsApi } from '../claims'
import { MAX_TABLES, MIN_TABLES, type EventApi, type RevealPreset } from './eventConfig'

/** The era the galaxy view is currently set to (the host edits starting from that era's built-in text). */
function savedEra(): Era {
  try { return localStorage.getItem('galaxy-era') === '30k' ? '30k' : '40k' } catch { return '40k' }
}

const PRESETS: { id: RevealPreset; label: string; hint: string }[] = [
  { id: 'hidden', label: 'Hidden', hint: 'removed from the sector map' },
  { id: 'rumour', label: 'Rumour', hint: 'seen, briefing only' },
  { id: 'scouted', label: 'Scouted', hint: 'briefing and intel' },
  { id: 'open', label: 'Open', hint: 'in play, everything revealed' },
]

/** Event host controls: what is shown in each sector, what is in play, what players may read, and which sectors are locked. */
export default function HostView({ events, claims }: { events: EventApi; claims: ClaimsApi }) {
  // which information window is open for editing (a sector, planet or hulk id)
  const [editing, setEditing] = useState<string | null>(null)
  // which battlezone is open for editing inside a planet
  const [editing2, setEditing2] = useState<string | null>(null)
  // which sectors are expanded (all start folded, so the page stays short)
  const [openSectors, setOpenSectors] = useState<string[]>([])
  const toggleSector = (id: string) => setOpenSectors((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]))
  const toggleEdit = (id: string) => { setEditing((e) => (e === id ? null : id)); setEditing2(null) }
  const era = savedEra()

  return (
    <div className="host">
      <h2>Event host controls</h2>
      <p className="muted">
        Choose what is shown in each sector, what is in play, and what players are allowed to read. Changes show up on the galaxy straight away.
        They are saved on the live-event server, so players' phones follow them live; hidden planets and sections are never sent to players.
      </p>
      <div className="host-top">
        <button className="ghost" onClick={() => { if (window.confirm('Reset everything to defaults? Planets shown or hidden, battlezone counts, locks, space hulks and every information text you have written will be put back.')) events.reset() }}>Reset everything to defaults</button>
        <button className="ghost" onClick={() => setOpenSectors(events.sectors.map((x) => x.id))}>Expand all</button>
        <button className="ghost" onClick={() => setOpenSectors([])}>Collapse all</button>
      </div>

      <section className="host-sector">
        <div className="hulk-controls">
          <label className="switch">
            <input type="checkbox" checked={events.hostPreview} onChange={(e) => events.setHostPreview(e.target.checked)} aria-label="Host preview" />
            <span aria-hidden="true" />
          </label>
          <span className="pname">
            Host preview: see everything on the galaxy map
            <small className="muted" style={{ display: 'block' }}>Shows locked sectors, hidden planets and hidden sections, so you can check your setup. Turn it off to see what players see.</small>
          </span>
        </div>
      </section>

      <section className="host-sector">
        {([['extra', 'Extra map planets', 'The planets from the Horus Heresy map that are not in the original set.'], ['forge', 'Added forge worlds', 'The forge worlds added from the map (Voss, Phaeton, Anvillus, Sarum, Tigrus, Accatran).']] as const).map(([g, label, note]) => (
          <div className="hulk-controls" key={g}>
            <label className="switch">
              <input type="checkbox" checked={events.groupVisible(g)} onChange={(e) => events.setGroupVisible(g, e.target.checked)} aria-label={label} />
              <span aria-hidden="true" />
            </label>
            <span className="pname">
              {label}
              <small className="muted" style={{ display: 'block' }}>{note}</small>
            </span>
          </div>
        ))}
      </section>

      <section className="host-sector">
        <div className="hulk-controls">
          <span className="pname">
            Battlezone results
            <small className="muted" style={{ display: 'block' }}>{claims.resultCount() === 0 ? 'No battlezone has a declared winner.' : `${claims.resultCount()} battlezone${claims.resultCount() === 1 ? ' has' : 's have'} a declared winner (each raises a void shield).`}</small>
          </span>
          <button className="ghost" disabled={claims.resultCount() === 0} onClick={() => { if (window.confirm('Clear the results of every battlezone? The void shields come down.')) void claims.clearResults() }}>Clear all results</button>
        </div>
      </section>

      <section className="host-sector">
        <div className="hulk-controls">
          <span className="pname">
            Sample mission: {MARS_SAMPLE.title}
            <small className="muted" style={{ display: 'block' }}>{MARS_SAMPLE.blurb}</small>
          </span>
          {Object.keys(MARS_SAMPLE.content).some((id) => events.infoEdited(id)) && <span className="swcap">Loaded</span>}
          <button className="ghost" onClick={() => events.setInfoMany(MARS_SAMPLE.content)}>Load sample</button>
          <button className="ghost" onClick={() => events.resetInfoMany(Object.keys(MARS_SAMPLE.content))}>Clear sample</button>
        </div>
      </section>

      {events.sectors.map((s) => {
        const views = s.planets.map((p) => ({ p, v: events.planetView(p) }))
        const shown = views.filter(({ v }) => v.visible)
        const inPlay = shown.filter(({ v }) => v.enabled)
        const zoneTotal = inPlay.reduce((n, { v }) => n + v.tables.length, 0)
        const hulkCount = events.hulks[s.id] ?? 0
        const isOpen = openSectors.includes(s.id)
        const locked = events.isLocked(s.id)
        return (
          <section key={s.id} className={`host-sector${isOpen ? ' open' : ''}${locked ? ' locked' : ''}`}>
            <header>
              <button className="sector-toggle" onClick={() => toggleSector(s.id)} aria-expanded={isOpen} aria-label={`${s.name}: ${isOpen ? 'collapse' : 'expand'}`}>
                <span className="chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                <span>
                  <h3 style={{ color: s.color }}>{s.name}</h3>
                  <small>{shown.length} of {s.planets.length} shown · {inPlay.length} in play · {zoneTotal} battlezones{hulkCount > 0 ? ` · ${hulkCount} hulk${hulkCount > 1 ? 's' : ''}` : ''}</small>
                </span>
              </button>
              <div className="host-bulk">
                <label className="lock-switch">
                  <span className="swcap">Locked</span>
                  <span className="switch">
                    <input type="checkbox" checked={locked} onChange={(e) => events.setLocked(s.id, e.target.checked)} aria-label={`Lock ${s.name}`} />
                    <span aria-hidden="true" />
                  </span>
                </label>
                {isOpen && (
                  <button className={`ghost${editing === s.id ? ' active' : ''}`} onClick={() => toggleEdit(s.id)}>Edit info</button>
                )}
              </div>
            </header>

            {isOpen && editing === s.id && (
              <InfoEditor
                content={events.infoFor(s.id, defaultSectorInfo(s.id))}
                edited={events.infoEdited(s.id)}
                reveal={['info', 'intel', 'mission']}
                onChange={(c) => events.setInfo(s.id, c)}
                onReset={() => events.resetInfo(s.id)}
              />
            )}

            {isOpen && (
              <div className="sector-tools">
                <div className="tool-row">
                  <span className="pname">Space hulks in this sector</span>
                  <div className="stepper" role="group" aria-label={`${s.name} space hulks`}>
                    <button onClick={() => events.setHulkCount(s.id, hulkCount - 1)} disabled={hulkCount <= 0} aria-label="Fewer space hulks">−</button>
                    <output>{hulkCount}</output>
                    <button onClick={() => events.setHulkCount(s.id, hulkCount + 1)} disabled={hulkCount >= MAX_HULKS} aria-label="More space hulks">+</button>
                  </div>
                </div>
                <div className="tool-row bulk">
                  <button className="ghost" onClick={() => events.setSectorVisible(s, true)}>Show all</button>
                  <button className="ghost" onClick={() => events.setSectorVisible(s, false)}>Hide all</button>
                  <button className="ghost" onClick={() => events.setSectorEnabled(s, true)}>All in play</button>
                  <button className="ghost" onClick={() => events.setSectorEnabled(s, false)}>All restricted</button>
                </div>
              </div>
            )}

            {isOpen && <ul>
              {views.map(({ p, v }) => {
                const hulk = isHulkId(p.id)
                return (
                  <li key={p.id} className={`${v.visible ? '' : 'off'}${v.enabled ? '' : ' restricted'}${editing === p.id ? ' editing' : ''}`}>
                    <label className="switch">
                      <input type="checkbox" checked={v.visible} onChange={(e) => events.setVisible(p.id, e.target.checked)} aria-label={`${p.name} shown on the map`} />
                      <span aria-hidden="true" />
                    </label>
                    <span className="swcap">Shown</span>
                    <span className="pname">{hulk ? 'Space Hulk · ' : ''}{p.name}{p.forge ? ' ⚙' : ''}</span>
                    <label className="switch">
                      <input type="checkbox" checked={v.enabled} onChange={(e) => events.setEnabled(p.id, e.target.checked)} aria-label={`${p.name} in play`} />
                      <span aria-hidden="true" />
                    </label>
                    <span className="swcap">In play</span>
                    <div className="stepper" role="group" aria-label={`${p.name} battlezones`}>
                      <button
                        onClick={() => events.setTables(p.id, v.tables.length - 1)}
                        disabled={!v.enabled || v.tables.length <= MIN_TABLES}
                        aria-label="Fewer battlezones"
                      >−</button>
                      <output>{v.tables.length}</output>
                      <button
                        onClick={() => events.setTables(p.id, v.tables.length + 1)}
                        disabled={!v.enabled || v.tables.length >= MAX_TABLES}
                        aria-label="More battlezones"
                      >+</button>
                    </div>
                    <button className={`ghost info-toggle${editing === p.id ? ' active' : ''}`} onClick={() => toggleEdit(p.id)} aria-label={`Edit ${p.name} info`}>Info</button>
                    {editing === p.id && (
                      <>
                        <div className="preset-row">
                          <span className="preset-title">Quick reveal</span>
                          {PRESETS.map((pr) => (
                            <button key={pr.id} className="ghost" onClick={() => events.applyPreset(p.id, pr.id)} title={pr.hint}>{pr.label}</button>
                          ))}
                          <small className="muted">Hidden: off the map · Rumour: briefing only · Scouted: briefing + intel · Open: in play, all revealed</small>
                        </div>
                        <InfoEditor
                          content={events.infoFor(p.id, defaultPlanetInfo(p.name, era, hulk))}
                          edited={events.infoEdited(p.id)}
                          reveal={['info', 'intel', 'mission', 'zones']}
                          onChange={(c) => events.setInfo(p.id, c)}
                          onReset={() => events.resetInfo(p.id)}
                        />
                        <div className="zone-edit">
                          <h4>Battlezones on {p.name}</h4>
                          {v.tables.map((t) => {
                            const zi = events.infoFor(t.id, defaultZoneInfo(t.note))
                            return (
                              <div key={t.id} className="zone-row">
                                <div className="zone-head">
                                  <span className="pname">
                                    {t.name}
                                    {(zi.infoHidden || zi.intelHidden || zi.missionHidden) && <em className="hidden-tag" title="Some sections are hidden from players">🔒</em>}
                                  </span>
                                  <button className={`ghost${editing2 === t.id ? ' active' : ''}`} onClick={() => setEditing2((e) => (e === t.id ? null : t.id))}>Edit</button>
                                </div>
                                {editing2 === t.id && (
                                  <InfoEditor
                                    content={zi}
                                    edited={events.infoEdited(t.id)}
                                    reveal={['info', 'intel', 'mission']}
                                    onChange={(c) => events.setInfo(t.id, c)}
                                    onReset={() => events.resetInfo(t.id)}
                                  />
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>}
          </section>
        )
      })}
    </div>
  )
}
