import type { Era } from './planetLooks'

// The text shown in each sector's and planet's information window. These are only starting points:
// the event host can rewrite any of it (and add objectives and rewards) from the Host tab.
//
// The briefings below are written in our own words from what the Warhammer 40,000 wikis say. Where a world's details
// are disputed or thin, the text says so or says less. Worlds with no entry (Seraphina, Taras, Opuscalus Noctis, Hellion,
// Abyss, Quai Jinn, Styggies, Vasalius) could not be found on the wikis, so they show the empty-briefing line until the
// host writes one.

/** One information window: a briefing, some intelligence, and the mission the event sets there. */
export interface InfoContent {
  /** short briefing shown on the Info tab */
  summary: string
  /** bio / intelligence shown on the Intel tab */
  intel: string
  /** what players are asked to do here, one per line */
  objectives: string[]
  /** what is offered for it, one per line */
  rewards: string[]
  /** the host can conceal these from players until they are ready to reveal them */
  infoHidden: boolean
  intelHidden: boolean
  missionHidden: boolean
  /** planets and hulks: the battlezones (and how many) are hidden from players */
  zonesHidden: boolean
}

export const EMPTY_INFO: InfoContent = { summary: '', intel: '', objectives: [], rewards: [], infoHidden: false, intelHidden: false, missionHidden: false, zonesHidden: false }

const NONE = 'No briefing has been filed for this location yet.'

const SECTOR_INFO: Record<string, Partial<InfoContent>> = {
  solar: {
    summary: 'The central region of the Imperium, centred on Terra and the Sol system. Mars, seat of the Mechanicus, lies here.',
    intel: 'The oldest, most crowded and best defended part of human space. Its fleet is commanded from Mars, and its worlds answer first to Terra and the Adeptus Mechanicus.',
  },
  ocularis: {
    summary: 'The Ocularis Malifica: the stormy space around the Eye of Terror, where the warp bleeds into reality.',
    intel: 'The Eye is the main stronghold of the Chaos Space Marines and the launch point of the Black Crusades. Warp storms make travel here unreliable, and the worlds on its rim are fortresses, ruins or daemon worlds.',
  },
  obscurus: {
    summary: 'Segmentum Obscurus, the great northern reach of the Imperium, home to the Gothic Sector and the approaches to the Eye of Terror.',
    intel: 'Its fleet is commanded from Cypra Mundi. Forge worlds such as Lucius and Goth stand beside hive worlds and the homeworlds of several Legions. It is the usual target of the Black Crusades.',
  },
  pacificus: {
    summary: 'Segmentum Pacificus, the western reach of the Imperium, run from its fleet base at Hydraphur.',
    intel: 'A distant region, slow to receive help from Terra. Records on it are thin, and many of its worlds must fend for themselves.',
  },
  tempestus: {
    summary: 'Segmentum Tempestus, the southern reach of the Imperium, with its fleet fortress at Bakka.',
    intel: 'It holds the Belt of Iron, a line of Mechanicus forge worlds along the border with Pacificus. Several of the early campaigns of the Horus Heresy were fought across its worlds.',
  },
  ultima: {
    summary: 'Segmentum Ultima, the eastern reach of the Imperium and its largest segmentum. Ultramar and the blood-red world of Baal lie here.',
    intel: 'A frontier of many wars, with worlds such as Macragge, Baal, Nocturne and Ryza. Threats from the east, and from the Great Rift, fall on it first.',
  },
}

/** Briefings written for the 41st millennium; PLANET_INFO_ERA overrides them for the Horus Heresy where the world was different. */
const PLANET_INFO: Record<string, Partial<InfoContent>> = {
  // ---- Segmentum Solar ----
  Terra: {
    summary: 'Holy Terra, cradle of humanity and seat of the Emperor. The most sacred and most guarded world in the galaxy.',
    intel: 'Continent-sized hive cities and palace complexes cover its surface, and the Imperial Palace holds the Golden Throne. Every pilgrim route and every tithe ends here, and it is the final prize of any invader.',
  },
  Mars: {
    summary: 'The Red Planet: the greatest forge world, seat of the Adeptus Mechanicus and its mighty shipyards.',
    intel: 'A cold desert dotted with manufactorums and tech-archives. Olympus Mons and the canyons of Noctis Labyrinthus hold some of the Mechanicus\'s deepest secrets. It is loyal to Terra, but fiercely self-governing.',
  },
  Chthonia: {
    summary: 'Cthonia, the harsh homeworld of Horus and his Legion.',
    intel: 'A hard world once ruled by warring gangs, where the Emperor found the infant Horus. Sources differ on what became of it, so check before relying on details here.',
  },
  Olmec: {
    summary: 'A long-neglected Imperial world that regained importance when Chaos forces seized it early in the Indomitus Crusade.',
    intel: 'It stood almost empty for thousands of years. Chaos took the planet and the warp nexus in its system, and a Crusade fleet later retook both. The events are told in the novels The Gate of Bones and Throne of Light.',
  },
  Necromunda: {
    summary: 'A vast hive world of towering spires, famous for heavy industry and brutal underhive gang wars.',
    intel: 'Its hive cities stack from gleaming noble spires down to the lawless underhive. Rival houses and gangs fight over scarce resources. It exports manufactured goods and Imperial Guard regiments.',
  },
  Prospero: {
    summary: 'Prospero, the burnt ruin that is now the Planet of the Sorcerers.',
    intel: 'The pyramids of Tizca lie in ashes under a violet haze. The Thousand Sons who survived its burning fled to the Eye of Terror, and Chaos holds what is left.',
  },

  // ---- Ocularis Malifica ----
  Caliban: {
    summary: 'Caliban, broken apart at the end of the Horus Heresy. Its largest remains became the Rock, the Dark Angels\' fortress-monastery.',
    intel: 'Luther\'s despair and the Dark Angels\' bombardment tore the world apart. The Fallen were scattered across space and time, and the loyal survivors were left with a ruined homeworld.',
  },
  Medusa: {
    summary: 'Medusa, a harsh volcanic waste world and homeworld of the Iron Hands.',
    intel: 'Its skies are polluted and its ground unstable. Nomad clans haul their goods on giant mining machines and fight over safe ground. The Gorgon\'s Forge, Ferrus Manus\'s vault, holds many of the Chapter\'s Dreadnoughts.',
  },
  Colchis: {
    summary: 'Colchis, the desert homeworld of Lorgar and the Word Bearers, destroyed in the aftermath of the Heresy.',
    intel: 'A decaying society of rival religions before Lorgar was found. After the Heresy it was bombarded and broke apart. Its former location is said to be an Inquisition secret.',
  },
  'Cypra Mundi': {
    summary: 'A forge world, the administrative and fleet capital of Segmentum Obscurus.',
    intel: 'A segmentum fortress orbits it, and its Collegium Analytica studies the Imperium\'s enemies. It was brought into the Imperium during the Great Crusade.',
  },
  Cadia: {
    summary: 'Cadia, the fortress world that held the Cadian Gate, fell to Abaddon\'s Thirteenth Black Crusade in 999.M41.',
    intel: 'Ancient pylons, which the Mechanicus never understood, held the Eye of Terror\'s stable gate shut. Abaddon\'s strike destabilised them, and the chain reaction ruined the planet. Nearby worlds such as Belis Corona and Agripinaa held out.',
  },
  Rangda: {
    summary: 'Rangda, a forbidden world and once the home of the xenos fought in the Rangdan Xenocides.',
    intel: 'The Xenocides raged through the Great Crusade at huge cost to the Legions and the Army. Accounts of the planet\'s fate and exact place conflict, so records are uncertain.',
  },
  Morox: {
    summary: 'Morox, capital world of its sector and the centre of the Carnage of Morox.',
    intel: 'A long Heresy-era war between loyalist and traitor Imperial Army forces, fought under warp storms that cut the sector off. Both sides committed atrocities, and the dead are counted in billions.',
  },

  // ---- Segmentum Obscurus ----
  Lucius: {
    summary: 'Lucius, a forge world of Segmentum Obscurus and home of the Titan Legion Legio Astorum.',
    intel: 'Named for luciun, a tough alloy used in its war-plate. Its forges turn out Warhound Titans, drop pods and Macharius super-heavy tanks. It came through the Inculcata Schism.',
  },
  Goth: {
    summary: 'Goth, a forge world in the Gothic Sector.',
    intel: 'Traitors held it during the Horus Heresy until it was liberated. Its sector later became the arena of the Gothic War, Abaddon\'s Twelfth Black Crusade, which the Imperium won.',
  },
  Isstvan: {
    summary: 'The Isstvan system, an eight-planet backwater where the Horus Heresy began.',
    intel: 'Isstvan III, a hive world, was purged with virus bombs after it rebelled. At Isstvan V, a desert world, Horus ambushed loyalist Legions in the Dropsite Massacre, crippling the Iron Hands, Raven Guard and Salamanders. Also spelled Istvaan.',
  },
  Fenris: {
    summary: 'Fenris, a frozen death world and homeworld of the Space Wolves.',
    intel: 'Its sun is called the Wolf\'s Eye, and its moon is Valdrmani. The Fang, the Chapter\'s fortress, stands on the peak of Asaheim. The Great Wolf rules as High King of Fenris.',
  },

  // ---- Segmentum Pacificus ----
  Khur: {
    summary: 'Khur, where Lorgar\'s Word Bearers were punished for worshipping the Emperor as a god.',
    intel: 'The city of Monarchia was razed by the Ultramarines at the Emperor\'s command. Details are murky and sources disagree, and its segmentum is not confirmed.',
  },
  Gehenna: {
    summary: 'Gehenna, where in 955.M41 the Blood Angels fought a Necron force until Tyranids arrived.',
    intel: 'The Gehenna Campaign saw the Blood Angels\' Third Company clash with Necrons in the dusty wastes. A Tyranid splinter fleet arrived and forced both sides to fight it.',
  },

  // ---- Segmentum Tempestus ----
  Graia: {
    summary: 'Graia, a Mechanicus forge world in the Belt of Iron and home of the Titan Legion Legio Astraman.',
    intel: 'Its manufactorums can build Titans. In the 41st millennium the Ork Warboss Grimskull invaded, and Ultramarines under Captain Titus defended it, as told in the game Space Marine.',
  },
  Inwit: {
    summary: 'Inwit, an ice world and homeworld of Rogal Dorn and the Imperial Fists.',
    intel: 'The traitors besieged the Inwit Cluster for four hard years before the loyalists won. Its place in Tempestus is not confirmed.',
  },
  Tallarn: {
    summary: 'Tallarn, once a green agri-world, was turned into a poisoned desert in the Horus Heresy.',
    intel: 'Iron Warriors virus bombs ruined it. The Battle of Tallarn is remembered as one of the Heresy\'s biggest tank battles, and the Tallarn Desert Raiders regiments take their name from the survivors.',
  },
  'Luth Tyre': {
    summary: 'Luth Tyre, a desert fortress and industrial world once held by the Iron Warriors.',
    intel: 'A stable warp route and large refineries made it a muster point for the Iron Warriors during the Heresy. In 011.M31 its garrison met a Death Guard fleet that had come from Barbarus.',
  },
  Barbarus: {
    summary: 'Barbarus, homeworld of Mortarion and the Death Guard, wrapped in toxic fog.',
    intel: 'Its people lived in the valleys under poisonous clouds, which made the Death Guard famously resistant to poison and disease. What became of the planet after the Heresy is uncertain.',
  },
  Deliverance: {
    summary: 'Deliverance, a moon of the forge world Kiavahr and site of the Raven Guard\'s fortress-monastery.',
    intel: 'It orbits Kiavahr in the Forsarr Sector. Kiavahr itself is home to a Titan Legion, Legio Vindictus. Little else is recorded, so treat further detail as unverified.',
  },
  Gryphonne: {
    summary: 'Gryphonne IV, forge world of the Titan Legion Legio Gryphonicus, overrun by Hive Fleet Leviathan in 997.M41.',
    intel: 'The Legio stayed loyal in the Heresy, but Horus had scattered it across the galaxy beforehand. The world\'s fall to the Tyranids cost the Imperium many Titans.',
  },
  Galaspar: {
    summary: 'Galaspar, a hive world conquered by the Death Guard in Mortarion\'s first major campaign.',
    intel: 'Its capital hive refused Imperial rule and fired on Explorator ships and envoys. The primary hive fell in a night and a day, and Phosphex bombs were used.',
  },

  // ---- Segmentum Ultima ----
  Baal: {
    summary: 'Baal, the red desert homeworld of the Blood Angels, with two moons, Baal Primus and Baal Secundus.',
    intel: 'Nuclear civil war ravaged the system at the end of the Age of Strife, and Baal Secundus is still radiation-scarred. Sanguinius was found at Angel\'s Fall, where aspirants now face their trials. Hive Fleet Leviathan later infested Baal Secundus.',
  },
  Nostramo: {
    summary: 'Nostramo, the Night Lords\' homeworld, destroyed by Konrad Curze.',
    intel: 'Its core was unstable and its crust had a single weak point. Curze\'s fleet bombarded it and the world exploded. The Nostraman Damnatii were later raised on other worlds.',
  },
  Desperation: {
    summary: 'Desperation, a world known for a Heresy-era battle between the Night Lords and an Ultramarines-led force.',
    intel: 'In 997.M31 an Ultramarines force under Arceas Odinathus fought the Night Lords, with the Ashen Claws joining as a third party. The Night Lords fleet was wiped out and the planet suffered Exterminatus.',
  },
  Olympia: {
    summary: 'Olympia, homeworld of the Iron Warriors and Perturabo, laid waste at the end of the Heresy.',
    intel: 'It held out for about two years against the Imperial Fists and Ultramarines, and the Iron Warriors set off their own missile stockpiles near the end. The wasteland that remained is called Perdita.',
  },
  Chogoris: {
    summary: 'Chogoris, the steppe homeworld of the White Scars, once called Mundus Planus.',
    intel: 'Jaghatai Khan united its nomad tribes into one nation, and its language, Chogoran, lives on in the Chapter. Its current state and segmentum are not confirmed.',
  },
  Chemos: {
    summary: 'Chemos, former homeworld of the Emperor\'s Children, destroyed by the Dark Angels in 012.M31.',
    intel: 'The Dark Angels fleet swept aside its defenders, and their Dreadwing landed and detonated seismic charges at key sites across the surface.',
  },
  Nocturne: {
    summary: 'Nocturne, the hot volcanic homeworld of the Salamanders, dominated by Mount Deathfire.',
    intel: 'Fire-breathing drakes live on Mount Deathfire, where Vulkan and the Emperor hunted them in the Chapter\'s legend. The Salamanders\' fortress-monastery is on its moon, Prometheus. In 975.M41 Chaos Dragon Warriors invaded to reach a vault beneath the volcano.',
  },
  Nuceria: {
    summary: 'Nuceria, where Angron led a slave revolt before he became the World Eaters\' primarch, later purged of life.',
    intel: 'After Angron was taken from the world, his comrades were massacred. During the Heresy he returned with Lorgar of the Word Bearers and ordered all life purged.',
  },
  Macragge: {
    summary: 'Macragge, capital of Ultramar and homeworld of the Ultramarines.',
    intel: 'Temperate seas and green land, guarded by the star-shaped Fortress of Hera. Marneus Calgar fortified it, and Hive Fleet Behemoth was beaten off around 745 to 746.M41 after the defenders were nearly broken.',
  },
  Ryza: {
    summary: 'Ryza, a Mechanicus forge world known for plasma weaponry.',
    intel: 'Its Titan Legion is Legio Crucius, and it has an artificial moon, Ryza Secundus. It is the home of the Stormblade tank and the Ryza-pattern plasma turret. The Defence of Ryza was a Heresy-era battle.',
  },
}

/** Briefings for the Horus Heresy (30K), where a world was different then; otherwise the entry above is used. */
const PLANET_INFO_ERA: Record<Era, Record<string, Partial<InfoContent>>> = {
  '30k': {
    Terra: {
      summary: 'Terra in the Heresy: the Emperor\'s working capital, not yet a shrine-world.',
      intel: 'It becomes the final battlefield when Horus\'s traitor fleets besiege the Imperial Palace.',
    },
    Mars: {
      summary: 'Mars in the Heresy: a forge world split by the Schism of Mars.',
      intel: 'The Mechanicum tore itself apart, loyalists against traitors who sided with Horus, and the forges were left scarred.',
    },
    Chthonia: {
      summary: 'Cthonia in the Great Crusade: the homeworld of the Luna Wolves, who later became the Sons of Horus.',
      intel: 'A hard world once ruled by warring gangs, where the Emperor found the infant Horus. Sources differ on its later fate.',
    },
    Prospero: {
      summary: 'A world of golden cities, homeworld of the Thousand Sons.',
      intel: 'Its capital, Tizca, is a ringed city of libraries and learning. The Space Wolves, on the Emperor\'s orders, will burn it.',
    },
    Caliban: {
      summary: 'A dark, forested world, homeworld of the Dark Angels.',
      intel: 'Great forests hide fortress-monasteries and the monstrous beasts the knightly orders hunt. Civil strife between loyalties is coming.',
    },
    Colchis: {
      summary: 'A living desert world of rival faiths, where Lorgar grew up.',
      intel: 'The road that leads to the Heresy began here.',
    },
    Cadia: {
      summary: 'A frontier world in the shadow of the Eye of Terror, not yet a fortress.',
      intel: 'Kasr forts cover its temperate land, and the great pylons already stand on the surface.',
    },
    Fenris: {
      summary: 'Fenris, the homeland of Leman Russ and the Space Wolves.',
      intel: 'The Space Wolves are one of the twenty Legions, used by the Emperor as punishers. Their fortress is the Fang on Asaheim.',
    },
    Barbarus: {
      summary: 'The living homeworld of Mortarion and the Death Guard, wrapped in toxic fog.',
      intel: 'The Legion swore for Horus here and sent fleets out from this world, including one toward Luth Tyre.',
    },
    Tallarn: {
      summary: 'A prosperous green agri-world, fiercely defended by Imperial armour.',
      intel: 'The Iron Warriors will poison it, and the Battle of Tallarn will be remembered as one of the Heresy\'s biggest tank battles.',
    },
    'Luth Tyre': {
      summary: 'An Iron Warriors fortress and industrial world supplying the traitors with war materiel.',
      intel: 'In 011.M31 its garrison met a Death Guard fleet that came from Barbarus.',
    },
    Graia: {
      summary: 'A loyalist forge world in the Belt of Iron, base of Legio Astraman.',
      intel: 'It fights traitor Mechanicum forge worlds in the Cataclysm of Iron.',
    },
    Nostramo: {
      summary: 'Nostramo, the crime-ridden homeworld of the Night Lords.',
      intel: 'Konrad Curze rules it until its destruction in the early 31st millennium.',
    },
    Olympia: {
      summary: 'A living city-world and the Iron Warriors\' seat of power under Perturabo.',
      intel: 'Perturabo was given rule of Olympia and the Legion\'s base moved there. It is laid waste before the Heresy ends.',
    },
    Chogoris: {
      summary: 'Chogoris, the steppe world where Jaghatai Khan united the tribes.',
      intel: 'The Imperium has found the world and recruits its warriors into the White Scars.',
    },
    Chemos: {
      summary: 'Chemos, the Emperor\'s Children\'s home base.',
      intel: 'The Dark Angels will destroy it in 012.M31.',
    },
    Macragge: {
      summary: 'Macragge, capital of Ultramar and homeworld of the Ultramarines.',
      intel: 'The Word Bearers\' attack on Ultramar falls hardest on Calth, and Macragge itself escapes destruction.',
    },
  },
  '40k': {
    Caliban: {
      summary: 'The Rock: the fortress-monastery of the Dark Angels, built on what is left of Caliban.',
      intel: 'A huge cratered asteroid carrying a monastery, with engines and an escort fleet. Caliban itself is a field of debris.',
    },
    Cadia: {
      summary: 'Cadia, shattered in the Thirteenth Black Crusade.',
      intel: 'Little remains but a ruin and a drifting field of debris.',
    },
    Prospero: {
      summary: 'Prospero, the burnt ruin that is now the Planet of the Sorcerers.',
      intel: 'The city of Tizca lies in ashes beneath a violet haze.',
    },
  },
}

const hulkInfo = (name: string): Partial<InfoContent> => ({
  summary: `The Space Hulk ${name}: a drifting mass of fused starships and asteroid.`,
  intel: 'Hulks appear and vanish from the warp without warning. Their corridors hold relics, wrecks and whatever else made it home.',
})

/** The built-in briefing for a sector. */
export function defaultSectorInfo(sectorId: string): InfoContent {
  return { ...EMPTY_INFO, summary: NONE, ...SECTOR_INFO[sectorId] }
}

/** The built-in briefing for a planet (or the space hulk, by name). */
export function defaultPlanetInfo(planetName: string, era: Era, isHulk: boolean): InfoContent {
  const known = isHulk ? hulkInfo(planetName) : { ...PLANET_INFO[planetName], ...PLANET_INFO_ERA[era][planetName] }
  return { ...EMPTY_INFO, summary: NONE, ...known }
}

/** The built-in text for one battlezone: its terrain note. The host fills in intel and the mission for the event. */
export function defaultZoneInfo(terrainNote: string): InfoContent {
  return { ...EMPTY_INFO, summary: terrainNote }
}
