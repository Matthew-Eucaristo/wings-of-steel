export const STORY_CHAPTERS = [
  {
    id: 'ch1',
    num: 'I',
    title: 'Breach of Halvard',
    arena: 'town',
    weather: 'dusk',
    waves: 3,
    convoy: true,
    boss: false,
    subtitle: 'Hold the inner avenue and rally the vanguard.',
    unlockReward: { type: 'cloak', id: 'crimson', label: 'Garrison Crimson Cloak' },
    loreTitle: 'Year 850 — The Sky Splits Open',
    loreDate: '14th of Autumn, 16:40',
    loreQuote: '“For a hundred years the stones kept watch. Then the thunder came without clouds.”',
    loreBody: 'When the Colossal silhouette rose above the southern masonry of Halvard District, the bells of the central clocktower rang three times before falling silent. Survey Corps Wing 4 scrambled from HQ rooftop with twelve minutes before the first Titans crossed the outer plaza. Your mission: establish aerial superiority along the central avenue and escort the Engineer sealing wagon past the inner market.',
  },
  {
    id: 'ch2',
    num: 'II',
    title: 'Shadow of the Clocktower',
    arena: 'town',
    weather: 'storm',
    waves: 4,
    convoy: true,
    boss: false,
    subtitle: 'Repel Stalker & Abnormal packs through a squall.',
    unlockReward: { type: 'accessory', id: 'goggles', label: 'Aviator Storm Goggles' },
    loreTitle: 'Rain on Cobblestones',
    loreDate: '14th of Autumn, 17:15',
    loreQuote: '“Never drop below the eaves when Abnormals hunt in the rain.”',
    loreBody: 'A sudden squall swept off the northern ridge, turning the half-timbered roofs slick and cloaking the avenues in mist. Fast low-slung Stalkers began vaulting onto the lower terraces while Abnormals ignored the garrison barricades altogether. With visibility dropping, squad discipline and high-anchor pendulum swings were the only things keeping Wing 4 alive.',
  },
  {
    id: 'ch3',
    num: 'III',
    title: 'Canopy of Giants',
    arena: 'forest',
    weather: 'dawn',
    waves: 4,
    convoy: false,
    boss: 'beast',
    subtitle: 'Intercept the Siege Hurler inside the Giant Forest.',
    unlockReward: { type: 'rigFinish', id: 'obsidian', label: 'Night-Forged ODM Rig' },
    loreTitle: 'The Ninety-Meter Redwoods',
    loreDate: '15th of Autumn, 06:05',
    loreQuote: '“Between trunks that thick, a single cable swing can cross a hundred meters.”',
    loreBody: 'At dawn, scouts spotted a secondary Titan column cutting through the Forest of Giant Trees to outflank the district. The ancient redwoods offered unmatched anchor height — and zero room for hesitation. Wing 4 deployed into the upper canopy to hunt Brutes and leaping Sprinters before they could reach the western wall.',
  },
  {
    id: 'ch4',
    num: 'IV',
    title: 'Bastion Under Siege',
    arena: 'ramparts',
    weather: 'moon',
    waves: 4,
    convoy: true,
    boss: 'warhammer',
    subtitle: 'Defend the artillery bastions against the Forge Sentinel.',
    unlockReward: { type: 'bladeAura', id: '#ffcc55', label: 'Solar Gold Alloy' },
    loreTitle: 'Lanterns Along the Breach',
    loreDate: '15th of Autumn, 21:30',
    loreQuote: '“When the cannons reload, the blades hold the line.”',
    loreBody: 'Night fell over the shattered southern wall. Garrison batteries lit the breach with muzzle flashes as an Armored Titan led a relentless midnight push toward the sealing cranes. Every Thunder Spear and squad focus order counted as steel clashed against hardened bone plating under a pale moon.',
  },
  {
    id: 'ch5',
    num: 'V',
    title: 'Seal of Steel',
    arena: 'town',
    weather: 'dusk',
    waves: 5,
    convoy: true,
    boss: 'founder',
    subtitle: 'Final push: seal the South Gate against the Sovereign & Armored siege.',
    unlockReward: { type: 'crest', id: 'wings_gold', label: 'Commander Gold Wing Crest' },
    loreTitle: 'The Final Masonry Block',
    loreDate: '16th of Autumn, 17:50',
    loreQuote: '“Dedicate your momentum. Lock the gate.”',
    loreBody: 'With the Engineer Convoy millimeters from locking the final timber-and-stone tier across the South Gate, the remaining Titans converged in a desperate surge. Capt. Reno, Sgt. Mira, and Cpl. Dax locked formation at your flank for one last run down the burning avenue of Halvard District.',
  },
];

export const ARENAS = [
  { id: 'town', name: 'Halvard Inner District', desc: 'Dense half-timbered avenues, clocktower & destructible rooftops.' },
  { id: 'forest', name: 'Forest of Giant Trees', desc: '90m towering redwoods built for high-altitude pendulum swings.' },
  { id: 'ramparts', name: 'South Gate Ramparts', desc: 'Open wall breach, cannon bastions & heavy siege sightlines.' },
];

export const WEATHERS = [
  { id: 'dusk', name: 'Golden Dusk' },
  { id: 'storm', name: 'Stormfront' },
  { id: 'dawn', name: 'Dawn Mist' },
  { id: 'moon', name: 'Moonlit Siege' },
];

export const UNLOCK_RULES = {
  'cloak:crimson': { req: 'Complete Chapter I (or 8 total kills)', check: (p) => p.chaptersCleared.includes('ch1') || p.totalKills >= 8 },
  'cloak:obsidian': { req: 'Reach 15 total Titan kills', check: (p) => p.totalKills >= 15 },
  'cloak:ivory': { req: 'Reach a 4× kill streak', check: (p) => p.bestStreak >= 4 },
  'accessory:goggles': { req: 'Complete Chapter II (or 12 kills)', check: (p) => p.chaptersCleared.includes('ch2') || p.totalKills >= 12 },
  'accessory:visor': { req: 'Reach 45 m/s peak swing speed', check: (p) => p.peakSpeed >= 45 },
  'rigFinish:obsidian': { req: 'Complete Chapter III (or 20 kills)', check: (p) => p.chaptersCleared.includes('ch3') || p.totalKills >= 20 },
  'rigFinish:gold': { req: 'Earn Rank S on any operation', check: (p) => p.bestRank === 'S' },
  'bladeAura:#ffcc55': { req: 'Complete Chapter IV (or 25 kills)', check: (p) => p.chaptersCleared.includes('ch4') || p.totalKills >= 25 },
  'crest:wings_gold': { req: 'Complete Chapter V (or 35 kills)', check: (p) => p.chaptersCleared.includes('ch5') || p.totalKills >= 35 },
};

export function defaultProgress() {
  return {
    chaptersCleared: [],
    chapterRanks: {},
    totalKills: 0,
    bestStreak: 0,
    peakSpeed: 0,
    bestRank: '',
    unlockAll: false,
  };
}

export function isChapterUnlocked(progress, idx) {
  if (idx <= 0 || progress?.unlockAll) return true;
  const prev = STORY_CHAPTERS[idx - 1];
  return !!(prev && progress?.chaptersCleared?.includes(prev.id));
}

export function isCosmeticUnlocked(progress, key) {
  if (!UNLOCK_RULES[key] || progress?.unlockAll) return true;
  return !!UNLOCK_RULES[key].check(progress || defaultProgress());
}

export function unlockHint(key) {
  return UNLOCK_RULES[key]?.req || '';
}
