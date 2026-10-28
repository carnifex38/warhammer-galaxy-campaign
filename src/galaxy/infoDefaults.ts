import type { Era } from './planetLooks'

// The text shown in each sector's and planet's information window. These are only starting points:
// the event host can rewrite any of it (and add objectives and rewards) from the Host tab.
//
// The briefings are written in our own words from the Warhammer 40,000 Fandom wiki (read through its data interface; the
// Lexicanum wiki blocks automated reading). Where a world's details are disputed or thin the text says so or says less.
// Worlds with no entry (Taras, Opuscalus Noctis, Hellion, Abyss, Quai Jinn, Vasalius) have no page on either wiki under
// those names (the wiki's Hellion is a Drukhari unit, not a planet), so they show the empty-briefing line until the host
// writes one.

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
  /** battlezones: the layout picture the gamemaster uploaded (its /media/ address). Not part of the text: resetting keeps it. */
  layout?: string
}

export const EMPTY_INFO: InfoContent = { summary: '', intel: '', objectives: [], rewards: [], infoHidden: false, intelHidden: false, missionHidden: false, zonesHidden: false }

const NONE = 'No briefing has been filed for this location yet.'

const SECTOR_INFO: Record<string, Partial<InfoContent>> = {
  solar: {
    summary: 'The central region of the Imperium, centred on Terra and the Sol system: the oldest and most densely settled part of human space.',
    intel: 'Its fleet is based in the Ring of Iron above Mars, which serves as the segmentum fortress, and its orbital shipyards sit above Luna. The other four segmentae guard it on every side.',
  },
  ocularis: {
    summary: 'The Ocularis Malifica: the stormy space around the Eye of Terror, the great warp rift where Chaos gathers.',
    intel: 'The Eye is a permanent warp storm some twenty thousand light years across, and the main base of Chaos in the galaxy. Worlds on its rim are fortresses, ruins and the homeworlds of fallen Legions.',
  },
  obscurus: {
    summary: 'Segmentum Obscurus, the Imperium\'s northern reach and the home of the Eye of Terror.',
    intel: 'Its fleet headquarters is the Cypra Mundi system. It is the region most often attacked from the Eye and the site of every one of Abaddon\'s Black Crusades, so it holds most of the Imperium\'s armed forces.',
  },
  pacificus: {
    summary: 'Segmentum Pacificus, the Imperium\'s western reach, with its fleet fortress at Hydraphur.',
    intel: 'Famous for Lord Commander Macharius\'s conquest of a thousand worlds at the galaxy\'s edge. It also saw the Plague of Unbelief and the Sabbat Worlds Crusade.',
  },
  tempestus: {
    summary: 'Segmentum Tempestus, the Imperium\'s southern reach, with its fleet headquarters and fortress at Bakka.',
    intel: 'It lies south of Segmentum Solar. Its far borders form the Dark Marches, some of the oldest star systems in the galaxy, absorbed late into the Imperium. Forge worlds such as Graia stand here.',
  },
  ultima: {
    summary: 'Segmentum Ultima, the Imperium\'s eastern reach and its largest, home to the Ultramarines\' realm of Ultramar.',
    intel: 'It holds more worlds than any other segmentum and the galaxy\'s core, marked by a supermassive black hole. Tyranid hive fleets Behemoth and Kraken have both struck it.',
  },
}

/** Briefings written for the 41st millennium; PLANET_INFO_ERA overrides them for the Horus Heresy where the world was different. */
const PLANET_INFO: Record<string, Partial<InfoContent>> = {
  // ---- Segmentum Solar ----
  Terra: {
    summary: 'Holy Terra, the Throneworld of the Imperium, original homeworld of humanity and seat of the Emperor.',
    intel: 'Billions of pilgrims come to its sacred, poisoned soil, and the planet is in effect a globe-spanning temple to the Emperor. The headquarters of the Imperium\'s main governing bodies are here.',
  },
  Mars: {
    summary: 'Mars, the first and greatest Forge World, homeworld of the Adeptus Mechanicus and birthplace of the Cult Mechanicus.',
    intel: 'It makes vast numbers of weapons, vehicles and other technology for the Imperium, and travel there is restricted to those who share the Mechanicus\'s faith. Its Ring of Iron is the Segmentum Solar\'s fortress and fleet base.',
  },
  Cthonia: {
    summary: 'Cthonia, a barren mining world where Horus was raised and the homeworld of the Luna Wolves.',
    intel: 'Horus\'s pod crashed here after he was stolen from the Emperor\'s laboratory on Terra. The Dark Angels destroyed Cthonia in 014.M31 during the Horus Heresy, so little or nothing of it remains.',
  },
  Olmec: {
    summary: 'A long-neglected Imperial world that regained importance when Chaos forces seized it early in the Indomitus Crusade.',
    intel: 'It stood almost empty for thousands of years. Chaos took the planet and the warp nexus in its system, and a Crusade fleet later retook both. The events are told in the novels The Gate of Bones and Throne of Light.',
  },
  Seraphina: {
    summary: 'Seraphina, an Ork world cleansed by the Space Wolves in the Wheel of Fire Campaign during the Great Crusade.',
    intel: 'Leman Russ was given the Dionysian Spear here when his Legion finished the campaign. The Lexicanum wiki places it in Segmentum Ultima, in the Wheel of Fire subsector.',
  },
  Necromunda: {
    summary: 'Necromunda, originally Araneus Prime: a hive world of Segmentum Solar and a major arms producer.',
    intel: 'Its hive-city manufactoria turn out lasguns, autoguns and bolters, and it supplies huge numbers of Necromundan Guard troops. The Imperial Fists recruit neophytes here, often from the underhive gangs.',
  },
  Prospero: {
    summary: 'Prospero, the original homeworld of the Thousand Sons and Magnus the Red, scoured by the Space Wolves in 004.M31.',
    intel: 'A centre of learning, above all about sorcery and the warp, until the Burning of Prospero. Horus engineered the attack, helped by Magnus\'s own arrogance. The ruin is now the Planet of the Sorcerers.',
  },

  // ---- Ocularis Malifica ----
  Caliban: {
    summary: 'Caliban, a death world and feudal world north of the Eye of Terror, homeworld of the Dark Angels, destroyed after the Heresy.',
    intel: 'Luther\'s Fallen and the Lion\'s loyalists fought a conflagration that destroyed it. What remained was the land around Aldurakh, the Dark Angels\' fortress-monastery, which became the mobile star fortress called the Rock.',
  },
  Medusa: {
    summary: 'Medusa IV, a feral waste world of perpetual gloom close to the Eye of Terror, homeworld of the Iron Hands and Ferrus Manus.',
    intel: 'The sun rarely pierces its polluted sky. Tectonic shifts keep raising and drowning mountains and seas, among frozen ranges, volcanoes and boiling geysers.',
  },
  Colchis: {
    summary: 'Colchis, a feudal world of Segmentum Pacificus, homeworld of Lorgar and the Word Bearers, destroyed by Exterminatus in 032.M31.',
    intel: 'Its theocracy, the Covenant, worshipped the Chaos Gods in the Old Faith until Lorgar sparked a civil war to found a new faith around the Emperor.',
  },
  'Cypra Mundi': {
    summary: 'Cypra Mundi, a Mechanicus forge world and the segmentum fortress of Segmentum Obscurus.',
    intel: 'On the northern fringe of the galaxy, it is the segmentum\'s naval and military headquarters and the home of the Collegium Analytica. Many of the Navy\'s officers come from its aristocracy.',
  },
  Cadia: {
    summary: 'Cadia, the fortress world that guarded the Cadian Gate, consumed by the warp in 999.M41.',
    intel: 'Its land ranged from frozen tundra to temperate plains and axel-tree forests. It guarded the only known navigable route out of the Eye of Terror, until Abaddon\'s Thirteenth Black Crusade destroyed it.',
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
    summary: 'Lucius, the Hollow Forge: a forge world of Segmentum Obscurus and home of the Titan Legion Legio Astorum.',
    intel: 'Its forges make everything from infantry weapons to Space Marine tanks and battle Titans, and it pays no tithe to the Imperium. The Legio Astorum are known as the Warp Runners.',
  },
  Goth: {
    summary: 'Goth, a forge world in the Gothic Sector of Segmentum Obscurus, and probably the origin of the sector\'s name.',
    intel: 'It was a hive world in the Coronid Deeps during the Great Crusade. Traitors occupied it in the Manachean War until the Disciples of the Flames liberated it. Its sector later became the arena of the Gothic War, Abaddon\'s Twelfth Black Crusade.',
  },
  Isstvan: {
    summary: 'The Isstvan system, an eight-planet backwater near Segmentum Obscurus where the Horus Heresy began.',
    intel: 'Isstvan III, a civilised world, was destroyed by virus bombs in 005.M31 when Horus turned on his own forces. At Isstvan V, a desert world, he ambushed loyalist Legions in the Dropsite Massacre. Also spelled Istvaan.',
  },
  Fenris: {
    summary: 'Fenris, a death world of Segmentum Obscurus and homeworld of Leman Russ and the Space Wolves.',
    intel: 'Its sun is called the Wolf\'s Eye, and its moon is Valdrmani. The Fang, the Chapter\'s fortress-monastery, is thought by many scholars the greatest bastion of the Imperium outside the Imperial Palace.',
  },

  // ---- Segmentum Pacificus ----
  Khur: {
    summary: 'Khur, a civilised world brought into the Imperium by the Word Bearers in 903.M30, famed for its capital Monarchia.',
    intel: 'Monarchia, the Perfect City, was built at the Word Bearers\' urging to show the people\'s faith. The Ultramarines later razed it on the Emperor\'s orders. The wiki places Khur in Segmentum Pacificus.',
  },
  'Stygies VIII': {
    summary: 'Stygies VIII, the Ever-Staring Cyclops: a forge moon of a gas giant in the Vulcanis system of Segmentum Pacificus.',
    intel: 'Home to the loyalist Titan Legion Legio Honorum, the Death Bolts. Its earlier Titan Legions, Vulcanum I and II, turned traitor during the Horus Heresy.',
  },
  Gehenna: {
    summary: 'Gehenna, where in 955.M41 the Blood Angels fought a Necron force until Tyranids arrived.',
    intel: 'The Gehenna Campaign saw the Blood Angels\' Third Company clash with Necrons in the dusty wastes. A Tyranid splinter fleet arrived and forced both sides to fight it. Its segmentum is not recorded.',
  },

  // ---- Segmentum Tempestus ----
  Graia: {
    summary: 'Graia, the Crown of Miracles: a forge world of Segmentum Tempestus and home of Legio Astraman.',
    intel: 'A ring of void stations, the Graian Crown, circles the planet like a diadem and is said to cross interstellar distances. The Ork Warboss Grimskull invaded in the 41st millennium, and Ultramarines under Captain Titus defended it, as told in the game Space Marine.',
  },
  Inwit: {
    summary: 'Inwit, an ice world and capital of the Inwit Cluster in Segmentum Tempestus, homeworld of Rogal Dorn.',
    intel: 'A fleet base for the Imperial Navy and an assembly ground for local Imperial Guard regiments. Dorn grew up among its ice tribes until the Emperor found him in 835.M31, and Horus\'s traitors later besieged the cluster.',
  },
  Tallarn: {
    summary: 'Tallarn, a desert world in a binary system of Segmentum Tempestus, home of the Tallarn Desert Raiders.',
    intel: 'Settlers found a green agri-world here in the 29th millennium. The Iron Warriors virus-bombed it during the Horus Heresy, destroying its biosphere, and only then landed. The few survivors adapted to the desert.',
  },
  'Luth Tyre': {
    summary: 'Luth Tyre, a desert fortress and industrial world once held by the Iron Warriors.',
    intel: 'Its refineries and a stable warp route made it a prize: the traitors invaded in 008.M31, and the Iron Warriors held it by 011.M31. In 012.M31 the Dark Angels bombarded it and took it intact. Sources place it in Tempestus or southern Ultima.',
  },
  Barbarus: {
    summary: 'Barbarus, feral homeworld of Mortarion and the Death Guard in Segmentum Tempestus, destroyed by the Dark Angels near the end of the Heresy.',
    intel: 'A dim yellow sun and a thick toxic fog made it one of the most terrible of the primarchs\' worlds. The Dark Angels destroyed it with cyclonic torpedoes because of the Chaos corruption on its surface.',
  },
  Deliverance: {
    summary: 'Deliverance, once Lycaeus, a barren moon of the hive world Kiavahr and homeworld of Corvus Corax and the Raven Guard.',
    intel: 'An airless moon in Segmentum Tempestus, home to the Raven Guard\'s fortress-monastery, the Ravenspire. The Emperor found Corax here during the Great Crusade.',
  },
  Gryphonne: {
    summary: 'Gryphonne IV, the Lost Forge: a dead world that was the forge world of Legio Gryphonicus in the Alduin Sector of Segmentum Tempestus.',
    intel: 'One of the best-defended worlds in the segmentum, home to some of the fiercest Skitarii legions. Hive Fleet Leviathan overran it, which made its fall all the more shocking.',
  },
  Galaspar: {
    summary: 'Galaspar, a hive world that Mortarion and the Death Guard conquered in the Great Crusade, and that Horus later seized.',
    intel: 'Its ruling junta, the Order, fired on Imperial Explorator ships, and the Death Guard destroyed it. In the Heresy the traitors took the world, and the Raven Guard sent a battlegroup to win it back. Its segmentum is not recorded.',
  },

  // ---- Segmentum Ultima ----
  Baal: {
    summary: 'Baal, a desert world and nominal homeworld of the Blood Angels in Segmentum Ultima, with two moons, Baal Prime and Baal Secundus.',
    intel: 'The planet holds few but mutants and feral beasts, while its moons hold notable human settlements and are now feral worlds. Sanguinius was found on Baal Secundus, and Hive Fleet Leviathan later infested it.',
  },
  Nostramo: {
    summary: 'Nostramo, a hive world wrapped in perpetual darkness and homeworld of the Night Lords, destroyed by Konrad Curze.',
    intel: 'A polluted atmosphere and a slowly dying star kept it dark. When its people betrayed his ideals of strict order, Curze\'s fleet bombarded the world and destabilised its core in the early 31st millennium.',
  },
  Desperation: {
    summary: 'Desperation, a world known for a Heresy-era battle between the Night Lords and an Ultramarines-led force.',
    intel: 'In 997.M31 an Ultramarines force under Arceas Odinathus fought the Night Lords in the Thramas Sector, with the Ashen Claws joining as a third party. The Night Lords fleet was wiped out and the planet suffered Exterminatus.',
  },
  Olympia: {
    summary: 'Olympia, a civilised world of city-states and original homeworld of Perturabo and the Iron Warriors, left a dead world after the Heresy.',
    intel: 'The Iron Warriors made it uninhabitable themselves before fleeing the Imperial assault in the Great Scouring. The Imperium judged it irreversibly tainted and left it barren.',
  },
  Chogoris: {
    summary: 'Chogoris, called Mundus Planus by the Imperium: the feral steppe homeworld of the White Scars, in the Yasan Sector of Segmentum Ultima.',
    intel: 'The White Scars raise their neophytes from its horse-nomad tribes, whose language is Khorchin. Jaghatai Khan united the tribes before the Imperium found the world.',
  },
  Chemos: {
    summary: 'Chemos, once a mining world and later a civilised world, homeworld of the Emperor\'s Children, now a dead world.',
    intel: 'Fulgrim was found here. After the Heresy loyalist forces scoured the world of all life; one account credits the Dark Angels with destroying it in 012.M31.',
  },
  Nocturne: {
    summary: 'Nocturne, the volcanic homeworld of the Salamanders in Segmentum Ultima, a feudal world and death world.',
    intel: 'Tidal stress from its overlarge moon Prometheus raises vast chains of volcanoes and frequent quakes, so people build their holds underground, beneath a constant cloak of dust. Fire-breathing drakes live on Mount Deathfire.',
  },
  Nuceria: {
    summary: 'Nuceria, the brutal homeworld of Angron, found by the Emperor in 899.M30; once a technologically advanced civilised world.',
    intel: 'Angron led a slave revolt here before the Emperor found him. Imperial records after the Heresy generally leave out its name, probably because of an Edict of Obliteration, and the world was later purged of life.',
  },
  Macragge: {
    summary: 'Macragge, capital of Ultramar and homeworld of the Ultramarines, in the southern Eastern Fringe side of Segmentum Ultima.',
    intel: 'Mostly bleak and rocky, with three quarters of its land mountainous and almost lifeless. The Fortress of Hera stands on a peak among impenetrable mountains. Hive Fleet Behemoth was beaten off after the space defences were nearly destroyed.',
  },
  Ryza: {
    summary: 'Ryza, the Furnace of Shackled Stars: a forge world of Segmentum Ultima and home of the Titan Legion Legio Crucius.',
    intel: 'In the Defence of Ryza during the Horus Heresy, loyalist Titans and servants of the Omnissiah drove back traitor Titan Legions and their Chaos Knight allies, at the cost of countless Titans and Knights.',
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
    Cthonia: {
      summary: 'Cthonia in the Great Crusade: the homeworld of the Luna Wolves, who later became the Sons of Horus.',
      intel: 'A barren feral and mining world where Horus was raised. It will be destroyed by the Dark Angels in 014.M31.',
    },
    Prospero: {
      summary: 'A world of golden cities, homeworld of the Thousand Sons.',
      intel: 'Its capital, Tizca, is a centre of learning and the warp arts. The Space Wolves, on the Emperor\'s orders, will burn it in 004.M31.',
    },
    Caliban: {
      summary: 'A dark, forested death world and feudal world, homeworld of the Dark Angels.',
      intel: 'Great forests hide fortress-monasteries and the monstrous beasts the knightly orders hunt. Aldurakh, the Dark Angels\' fortress-monastery, stands here. Civil strife is coming.',
    },
    Colchis: {
      summary: 'A feudal world ruled by the Covenant, where Lorgar grew up.',
      intel: 'The Covenant worships the Chaos Gods in the Old Faith. Lorgar will turn the world to a new faith around the Emperor, and the road to the Heresy begins here.',
    },
    Cadia: {
      summary: 'A frontier world in the shadow of the Eye of Terror, not yet a fortress.',
      intel: 'Its land ranges from frozen tundra to temperate plains and axel-tree forests, and the great pylons already stand on the surface.',
    },
    Fenris: {
      summary: 'Fenris, the homeland of Leman Russ and the Space Wolves.',
      intel: 'The Space Wolves are one of the twenty Legions, used by the Emperor as punishers. Their fortress is the Fang.',
    },
    Barbarus: {
      summary: 'The living homeworld of Mortarion and the Death Guard, wrapped in toxic fog.',
      intel: 'The Legion swore for Horus here and sent fleets out from this world, including one toward Luth Tyre. It will be destroyed by the Dark Angels near the end of the Heresy.',
    },
    Tallarn: {
      summary: 'A prosperous green agri-world, fiercely defended by Imperial armour.',
      intel: 'The Iron Warriors will virus-bomb it into a desert, and the Battle of Tallarn will be remembered as one of the Heresy\'s biggest tank battles.',
    },
    'Luth Tyre': {
      summary: 'An Iron Warriors fortress and industrial world supplying the traitors with war materiel.',
      intel: 'In 011.M31 its garrison met a Death Guard fleet that came from Barbarus.',
    },
    Graia: {
      summary: 'A loyalist forge world and base of Legio Astraman.',
      intel: 'It fights traitor Mechanicum forge worlds in the Cataclysm of Iron.',
    },
    Nostramo: {
      summary: 'Nostramo, the dark hive world and homeworld of the Night Lords.',
      intel: 'Konrad Curze rules it until its destruction in the early 31st millennium.',
    },
    Olympia: {
      summary: 'A living world of city-states and the Iron Warriors\' seat of power under Perturabo.',
      intel: 'Perturabo ruled here and the Legion\'s base moved to Olympia. It is laid waste after the Heresy.',
    },
    Chogoris: {
      summary: 'Chogoris, the steppe world where Jaghatai Khan united the tribes.',
      intel: 'The Imperium has found the world and recruits its warriors into the White Scars.',
    },
    Chemos: {
      summary: 'Chemos, the Emperor\'s Children\'s home base.',
      intel: 'Fulgrim was found here. One account has the Dark Angels destroying it in 012.M31.',
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
