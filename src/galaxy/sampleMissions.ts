import type { InfoContent } from './infoDefaults'

// A ready-made example of an event mission, so a host can see how the information windows read before writing their own.
// It is loaded (and cleared) from the Host tab. Keys are the planet id and its battlezone ids.

export interface SampleMission {
  id: string
  title: string
  /** what the Host tab says about it */
  blurb: string
  content: Record<string, Partial<InfoContent>>
}

const zone = (info: string, intel: string, objective: string, hidden = false): Partial<InfoContent> => ({
  summary: info,
  intel,
  objectives: [objective],
  rewards: [],
  // the last zone is left classified, to show what players see before a reveal
  intelHidden: hidden,
  missionHidden: hidden,
})

export const MARS_SAMPLE: SampleMission = {
  id: 'mars',
  title: 'Mars: "The Silent Forge"',
  blurb: 'A mission on Mars with four battlezones. Battlezone Delta is left classified so you can see a hidden section.',
  content: {
    mars: {
      summary:
        'Mars, the Red Planet, seat of the Adeptus Mechanicus. For three days the forge-district of Tharsis Deep has been silent: no smoke, no vox, no tithe of weapons. The Fabricator-General requests aid in "restoring a functioning state" and will say no more.',
      intel:
        'Skitarii patrols report the sealed forge doors are cooling from the inside. Servo-skulls sent through the vents never returned. The Mechanicus suspects a corrupted engine-spirit, or something dug up from below Noctis Labyrinthus. Treat every machine here as hostile.',
      objectives: [
        'Reach the central Cogitator Vault before the other warbands',
        'Recover the Silent STC fragment intact',
        'Keep your command squad alive until the vault is sealed',
      ],
      rewards: [
        '+3 campaign points for the warband that recovers the fragment',
        'Relic: "Tharsis Deep Auspex", a one-use re-roll for the winner',
        '+1 campaign point for every battlezone you win on Mars',
      ],
      infoHidden: false,
      intelHidden: false,
      missionHidden: false,
      zonesHidden: false,
    },
    'mars-t1': zone(
      'Collapsed hab-blocks and foundry ruins, with plenty of cover.',
      'Skitarii pickets hold the outer ring.',
      'Hold the central objective for 4 turns.',
    ),
    'mars-t2': zone(
      'An open ash plain crossed by rusted rail-lines.',
      'Enemy tanks are rumoured to be dug in.',
      'Destroy the signal pylon on turn 3, or lose the vox for the rest of the game.',
    ),
    'mars-t3': zone(
      'A sprawling manufactorum of gantries and furnace-halls.',
      'The forge-spirit here fights back.',
      'Take 3 data-nodes: one at each end and one in the middle.',
    ),
    'mars-t4': zone(
      'The vault approach: narrow causeways over a molten channel.',
      'Nobody who has entered Delta has come out.',
      'Reach the vault doors with at least one model.',
      true,
    ),
  },
}
