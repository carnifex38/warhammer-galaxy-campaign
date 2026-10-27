import { usePortrait } from './planetPortrait'
import type { Planet } from './galaxy/data'
import { lookFor, type Era } from './galaxy/planetLooks'

/** A planet's portrait: the real picture once it is drawn, a disc in the planet's colours until then. */
export default function Portrait({ planet, era, size = 64 }: { planet: Planet; era: Era; size?: number }) {
  const url = usePortrait(planet.name, era)
  const look = lookFor(planet.name, era)
  return (
    <span
      className="cal-portrait"
      style={{ width: size, height: size, background: url ? `center / cover url(${url})` : `radial-gradient(circle at 35% 30%, ${look.landB}, ${look.landA} 55%, ${look.deep})` }}
      aria-hidden="true"
    />
  )
}
