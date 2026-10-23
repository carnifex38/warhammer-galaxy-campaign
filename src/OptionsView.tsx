import { useState } from 'react'
import { setOption, useOptions, type HoverHighlight, type PlanetDisplay, type SectorHighlight } from './options'

type Category = 'graphics' | 'ui' | 'display'

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'graphics', label: 'Graphics' },
  { id: 'ui', label: 'UI' },
  { id: 'display', label: 'Display' },
]

const PLANET_CHOICES: { id: PlanetDisplay; label: string; note: string }[] = [
  { id: 'dots', label: 'Simple', note: 'Planets are plain coloured dots on the map. The lightest on your device.' },
  { id: 'close', label: 'Detailed when close', note: 'Dots, but each planet shows its surface as you zoom in toward it.' },
  { id: 'all', label: 'Detailed everywhere', note: 'Every planet shows its surface, even from far away. The most demanding.' },
]

const HIGHLIGHT_CHOICES: { id: SectorHighlight; label: string; note: string }[] = [
  { id: 'full', label: 'Full', note: 'Sectors are coloured and outlined clearly.' },
  { id: 'reduced', label: 'Reduced', note: 'Softer colour and thinner outlines.' },
  { id: 'minimal', label: 'Minimal', note: 'Only a faint outline; the colour appears when you point at a sector.' },
]

const HOVER_CHOICES: { id: HoverHighlight; label: string; note: string }[] = [
  { id: 'strong', label: 'Strong', note: 'A sector lights up brightly when you point at it.' },
  { id: 'soft', label: 'Soft', note: 'A gentle glow when you point at a sector.' },
  { id: 'off', label: 'Off', note: 'Sectors do not light up when you point at them.' },
]

export default function OptionsView() {
  const [cat, setCat] = useState<Category>('graphics')
  const o = useOptions()
  return (
    <div className="options">
      <h2>Options</h2>
      <div className="options-body">
        <nav className="options-cats" aria-label="Option categories">
          {CATEGORIES.map((c) => (
            <button key={c.id} className={c.id === cat ? 'active' : ''} aria-current={c.id === cat ? 'true' : undefined} onClick={() => setCat(c.id)}>{c.label}</button>
          ))}
        </nav>
        <section className="options-panel">
          {cat === 'graphics' ? (
            <>
              <h3>Planets on the galaxy map</h3>
              <div className="options-choices" role="radiogroup" aria-label="Planet display">
                {PLANET_CHOICES.map((c) => (
                  <button key={c.id} role="radio" aria-checked={o.planetDisplay === c.id} className={o.planetDisplay === c.id ? 'on' : ''} onClick={() => setOption('planetDisplay', c.id)}>
                    <strong>{c.label}</strong>
                    <span>{c.note}</span>
                  </button>
                ))}
              </div>
              <h3>Sector highlighting</h3>
              <div className="options-choices" role="radiogroup" aria-label="Sector highlighting">
                {HIGHLIGHT_CHOICES.map((c) => (
                  <button key={c.id} role="radio" aria-checked={o.sectorHighlight === c.id} className={o.sectorHighlight === c.id ? 'on' : ''} onClick={() => setOption('sectorHighlight', c.id)}>
                    <strong>{c.label}</strong>
                    <span>{c.note}</span>
                  </button>
                ))}
              </div>
              <h3>Highlight when pointing at a sector</h3>
              <div className="options-choices" role="radiogroup" aria-label="Highlight when pointing">
                {HOVER_CHOICES.map((c) => (
                  <button key={c.id} role="radio" aria-checked={o.hoverHighlight === c.id} className={o.hoverHighlight === c.id ? 'on' : ''} onClick={() => setOption('hoverHighlight', c.id)}>
                    <strong>{c.label}</strong>
                    <span>{c.note}</span>
                  </button>
                ))}
              </div>
              <h3>Space combat</h3>
              <label className="options-check">
                <input type="checkbox" checked={o.spaceCombat} onChange={(e) => setOption('spaceCombat', e.target.checked)} />
                <span>
                  <strong>Fleets fight over a planet in play</strong>
                  <em>Ships trade fire above a planet while its battlezones are in play. Turn it off to save a little performance.</em>
                </span>
              </label>
              <h3>Selecting a planet</h3>
              <label className="options-check">
                <input type="checkbox" checked={o.hideStarfield} onChange={(e) => setOption('hideStarfield', e.target.checked)} />
                <span>
                  <strong>Keep the galaxy in view</strong>
                  <em>Don't replace the map with black space and a starfield when a planet is selected.</em>
                </span>
              </label>
            </>
          ) : (
            <p className="muted">Nothing to adjust here yet.</p>
          )}
        </section>
      </div>
    </div>
  )
}
