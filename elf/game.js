(() => {
'use strict';
document.documentElement.classList.toggle('has-touch', navigator.maxTouchPoints>0 || 'ontouchstart' in window);
// Elf v3 — self-contained offline browser platformer.
// Campaign: 10 fixed levels. Movement: left/right; camera: forward only.
// Damage: lose the active weapon, ammunition and temporary protection.
// Companion: independent of equipment, retained until the current level ends.


// ========================================================================
// Configuration and DOM references
// Physics use world pixels and seconds. Rendering adapts to the screen while
// the world height stays fixed, so portrait phones retain a readable hero.
// ========================================================================
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const frame = document.getElementById('gameFrame');
const $ = id => document.getElementById(id);
const WORLD_HEIGHT = 540;
const TILE = 40;
const GROUND = 432;
const GRAVITY = 1650;
const SPEED = 232;
const JUMP_SPEED = 660;
const FIXED_STEP = 1 / 120;
const MAX_HEALTH = 3;
const MAX_CAT_LIVES = 7;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let viewWidth = 960;
let camera = 0;
let state = 'title';
let stageIndex = 0;
let level;
let player;
let checkpoint = 100;
let worldTime = 0;
let runTime = 0;
let toastTime = 0;
let shakeTime = 0;
let stageStartCoins = 0;
let stageStartKills = 0;
let hudClock = 0;
let bgCache = null;
let bgCacheKey = '';
let primaryAction = null;
let secondaryAction = null;
let best = 0;
let stats = {coins:0,score:0,kills:0,shots:0,falls:0,catKills:0,catFinds:0};
let particles = [];
let floatingTexts = [];
let projectiles = [];
let attacks = [];
let companion = null;
let catLives = MAX_CAT_LIVES;
let stageExitTime = 0;
let loot = [];
let checkpointFlags = [];
const keys = new Set();
const touch = { left: false, right: false, jump: false, shoot: false };
const pointerControls = new Map();
let jumpBuffer = 0;
let jumpWasHeld = false;

// ========================================================================
// Inventory, weapons and companion configuration
// Exactly one offensive power-up is equipped. Arrow bundles are ammunition,
// not weapons: they never auto-equip a bow or replace the current attack.
// ========================================================================
const ARROWS_PER_BOW = 12;
const ARROWS_PER_BUNDLE = 8;
const MAX_ARROWS = 99;
const WEAPONS = {
  bow:   {label:'Łuk',short:'ŁUK',color:'#f2d087',cooldown:.32},
  fire:  {label:'Kula ognia',short:'OGIEŃ',color:'#ffaf72',cooldown:.46},
  sword: {label:'Miecz',short:'MIECZ',color:'#e6ece3',cooldown:.42},
  ice:   {label:'Lodowy podmuch',short:'LÓD',color:'#b6ecfa',cooldown:.82}
};
const ITEM_LABELS = {bow:'Łuk',fire:'Kula ognia',sword:'Miecz',ice:'Lodowy podmuch',ammo:'Strzały +8',cat:'Lucek',heart:'Serce',shield:'Ochrona',gem:'Kryształ'};
const WEAPON_ICONS = {
  bow:'<path d="M8 3c19 3 19 19 0 22M8 3l5 11-5 11M3 14h22m-4-4 4 4-4 4"/>',
  fire:'<path d="M15 2c2 8 10 9 8 17-2 8-17 8-19-1-1-5 3-9 6-11-1 5 1 7 3 8 3-4 1-8 2-13Z"/><path d="M14 15c6 6 3 9 0 10-5-1-5-5 0-10Z"/>',
  sword:'<path d="m5 23 13-13M13 6l8-4 4 4-4 8-4-4-4-4ZM4 15l9 9M3 25l3-3"/>',
  ice:'<path d="M14 2v24M4 8l20 12M4 20 24 8M10 4l4 4 4-4M10 24l4-4 4 4M3 12l6-1-1-6M20 23l-1-6 6-1"/>',
  none:'<path d="M6 14h16M14 6v16" opacity=".55"/>'
};
let lastHudKey='';

// Storage can be unavailable in private mode or for local file URLs.
try { best = Number(localStorage.getItem('forest-bow-best-v3')) || 0; } catch (_) { /* Keep the game playable without storage. */ }
if (best) $('recordLabel').textContent = `Twój rekord: ${best.toLocaleString('pl-PL')} pkt`;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const distance = (a, b) => Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2);

// Seeded randomness keeps every decorative detail stable between frames.
function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// ========================================================================
// Procedural audio
// A quiet pentatonic melody and short effects are synthesized locally.
// Web Audio is created only after a user gesture, including touch input.
// ========================================================================
let audio = null;
let audioMaster = null;
let soundEnabled = true;
let musicClock = 0;
let musicStep = 0;
const melody = [76,0,79,0,81,79,76,0,74,0,72,0,74,76,79,0,76,0,79,81,84,0,81,0,79,76,74,0,72,0,0,0];

function unlockAudio() {
  if (!soundEnabled) return;
  try {
    if (!audio) {
      const AudioClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioClass) return;
      audio = new AudioClass();
      audioMaster = audio.createGain();
      audioMaster.gain.value = 0.5;
      audioMaster.connect(audio.destination);
    }
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch (_) { /* Audio is optional; rendering and input must still work. */ }
}

function tone(frequency, duration, type = 'square', volume = 0.08, endFrequency = 0, delay = 0) {
  if (!audio || !soundEnabled || audio.state !== 'running') return;
  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const envelope = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(envelope);
  envelope.connect(audioMaster);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.025);
  oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
}

function sfx(name) {
  if (name === 'fire') {tone(170,.19,'sawtooth',.055,65);tone(410,.08,'triangle',.065,130);}
  if (name === 'sword') tone(840,.14,'sawtooth',.04,105);
  if (name === 'ice') {tone(1450,.24,'triangle',.08,440);tone(960,.18,'sine',.06,330,.04);}
  if (name === 'freeze') tone(1700,.13,'sine',.055,2250);
  if (name === 'shatter') {tone(1600,.12,'triangle',.07,290);tone(2250,.09,'square',.025,700,.03);}
  if (name === 'empty') tone(130,.065,'triangle',.08,85);
  if (name === 'meow') {tone(650,.13,'triangle',.1,890);tone(890,.21,'triangle',.08,440,.12);}
  if (name === 'jump') tone(260, .13, 'square', .055, 650);
  if (name === 'coin') { tone(1046, .09, 'square', .045); tone(1568, .16, 'triangle', .1, 0, .055); }
  if (name === 'break') { tone(130, .12, 'sawtooth', .07, 42); tone(250, .055, 'triangle', .07); }
  if (name === 'bump') tone(180, .085, 'triangle', .16, 80);
  if (name === 'stomp') tone(390, .12, 'square', .07, 90);
  if (name === 'shoot') tone(880, .1, 'triangle', .14, 160);
  if (name === 'hurt') { tone(180, .18, 'sawtooth', .08, 70); tone(140, .2, 'square', .045, 60, .1); }
  if (name === 'power') [72,76,79,84].forEach((n,i) => tone(440 * 2 ** ((n - 69) / 12), .18, 'triangle', .17, 0, i * .08));
  if (name === 'flag') [79,84,88].forEach((n,i) => tone(440 * 2 ** ((n - 69) / 12), .25, 'triangle', .12, 0, i * .1));
  if (name === 'win') [72,76,79,84,79,84,88].forEach((n,i) => tone(440 * 2 ** ((n - 69) / 12), .25, 'triangle', .16, 0, i * .11));
}

function updateMusic(dt) {
  if (!soundEnabled || !audio || state !== 'playing') return;
  musicClock -= dt;
  if (musicClock > 0) return;
  musicClock = .225;
  const note = melody[musicStep % melody.length];
  const shift = [0,2,-3,4,-2,0,2,-3,-2,4][stageIndex];
  if (note) tone(440 * 2 ** ((note + shift - 69) / 12), .22, 'triangle', .034);
  if (musicStep % 4 === 0) {
    const bass = [48, 48, 53, 55][Math.floor(musicStep / 8) % 4] + shift;
    tone(440 * 2 ** ((bass - 69) / 12), .38, 'triangle', .035);
  }
  musicStep++;
}

// ========================================================================
// Original handcrafted stages, followed by seven additional routes
// Gaps stay within the distance of a full jump. Optional upper routes hold
// extra coins and spare equipment. Weapons are optional: stomping keeps
// every route playable after losing an offensive power-up. Solid platforms are distinct from breakable and reward blocks.
// ========================================================================
const STAGES = [
  {
    name: 'Paprociowy szlak', length: 4120, seed: 41,
    palette: { sky:'#b9dbca', top:'#a5ccbd', sun:'#fff0b7', far:'#94bbac', mountain:'#80a897', mid:'#669485', tree:'#426f60', leaf:'#63935f', leafLight:'#8ca66b', grass:'#88b45f', grassTop:'#c2d480', earth:'#785b43', earthDark:'#624d3c', stone:'#96a27a', glow:'#f3dd91' },
    gaps: [[1220,1300],[2280,2380],[3100,3200]],
    hazards: [[1840,'cactus'],[2830,'spikes'],[3530,'fire']],
    platforms: [[1710,352,160],[2760,352,160],[3400,352,160]],
    blocks: [[360,312,'coin'],[400,312,'brick'],[440,312,'bow'],[480,312,'brick'],[840,312,'heart'],[1000,312,'brick'],[1040,312,'coin'],[1080,312,'brick'],[1790,232,'gem'],[1950,312,'brick'],[1990,312,'coin'],[2030,312,'brick'],[2520,312,'bow'],[2920,272,'shield'],[3480,232,'gem'],[3690,312,'coin']],
    enemies: [[700,'mushroom'],[1110,'mushroom'],[1600,'mushroom'],[2060,'mushroom'],[2490,'mushroom'],[3040,'beetle'],[3350,'mushroom'],[3760,'mushroom']],
    flags: [1460,2650],
    coinRuns: [[580,362,4],[905,348,3],[1718,299,4],[2130,351,3],[2400,365,3],[2780,300,4],[3410,300,4],[3790,354,4]],
    signs: [[200,'↔','RUCH W OBIE STRONY'],[585,'↓','SKOCZ NA GŁOWĘ'],[1100,'↗','PRZYTRZYMAJ SKOK'],[1540,'✦','PUNKT KONTROLNY']],
    mushrooms: [80,570,920,1360,2150,2600,2960,3360,3700]
  },
  {
    name: 'Bursztynowy zagajnik', length: 4680, seed: 99,
    palette: { sky:'#e3d9ac', top:'#d1d5b3', sun:'#fff2bf', far:'#b9bc93', mountain:'#a7b18b', mid:'#8e9c78', tree:'#657d58', leaf:'#acaa60', leafLight:'#c9bc72', grass:'#a0af62', grassTop:'#d6d08b', earth:'#846045', earthDark:'#6e503e', stone:'#a6a17c', glow:'#fbe495' },
    gaps: [[980,1080],[1810,1910],[2700,2820],[3770,3880]],
    hazards: [[1240,'fire'],[2200,'cactus'],[3190,'spikes'],[4200,'fire']],
    platforms: [[1190,352,120],[1390,272,160],[2110,352,120],[2300,272,160],[3080,352,120],[3270,272,160]],
    blocks: [[340,312,'bow'],[380,312,'brick'],[640,312,'coin'],[680,312,'brick'],[1440,152,'gem'],[1600,272,'shield'],[2010,312,'heart'],[2340,152,'gem'],[2540,272,'brick'],[2580,272,'coin'],[2950,312,'bow'],[3340,152,'gem'],[3560,312,'heart'],[4060,312,'coin'],[4100,312,'brick'],[4140,312,'coin']],
    enemies: [[620,'beetle'],[880,'mushroom'],[1150,'mushroom'],[1670,'beetle'],[2060,'mushroom'],[2450,'mushroom'],[2620,'beetle'],[2970,'beetle'],[3490,'mushroom'],[3660,'beetle'],[4040,'mushroom'],[4320,'beetle']],
    flags: [1330,2890,3930],
    coinRuns: [[490,350,3],[1198,300,3],[1405,220,4],[1680,354,3],[2120,300,3],[2310,220,4],[3085,300,3],[3280,220,4],[3980,353,3],[4350,350,4]],
    signs: [[190,'→','ZŁOTA GODZINA'],[1120,'↗','WYŻEJ = WIĘCEJ ZNAJDŹEK'],[2910,'✦','DALEKO JUŻ ZA TOBĄ']],
    mushrooms: [70,780,1130,1970,2460,2960,3420,3990,4430]
  },
  {
    name: 'Świetlikowe ruiny', length: 5080, seed: 167,
    palette: { sky:'#687e85', top:'#4d6c75', sun:'#ecedc0', far:'#688789', mountain:'#597c7c', mid:'#416c6d', tree:'#2b5558', leaf:'#45755e', leafLight:'#6a9171', grass:'#79a475', grassTop:'#b6ce8e', earth:'#5b5949', earthDark:'#494b43', stone:'#819a87', glow:'#dbf5a7' },
    gaps: [[1010,1110],[2040,2160],[2960,3080],[3950,4070]],
    hazards: [[1370,'spikes'],[2340,'fire'],[3630,'cactus'],[4380,'spikes']],
    platforms: [[1270,352,120],[1470,272,160],[2390,352,120],[2590,272,160],[3290,352,120],[3490,272,160],[4280,352,160]],
    blocks: [[340,312,'bow'],[380,312,'brick'],[420,312,'coin'],[740,312,'shield'],[1510,152,'gem'],[1750,312,'brick'],[1790,312,'heart'],[1830,312,'brick'],[2260,312,'bow'],[2630,152,'gem'],[2810,272,'coin'],[2850,272,'brick'],[3130,312,'heart'],[3540,152,'gem'],[3740,312,'shield'],[4310,232,'gem'],[4630,312,'brick'],[4670,312,'coin'],[4710,312,'brick']],
    enemies: [[620,'beetle'],[920,'mushroom'],[1220,'beetle'],[1690,'mushroom'],[1940,'beetle'],[2260,'beetle'],[2540,'mushroom'],[2860,'beetle'],[3200,'beetle'],[3420,'mushroom'],[3800,'beetle'],[4180,'mushroom'],[4500,'beetle'],[4740,'mushroom']],
    flags: [1180,2220,4140],
    coinRuns: [[490,350,3],[790,346,3],[1280,300,3],[1480,220,4],[1870,350,3],[2400,300,3],[2600,220,4],[3300,300,3],[3500,220,4],[4290,300,4],[4790,345,4]],
    signs: [[190,'→','ŚWIETLIKI ZNAJĄ DROGĘ'],[3120,'✦','JUŻ NIEDALEKO'],[4580,'→','SERCE LASU']],
    mushrooms: [70,790,1150,1720,2310,2780,3180,3740,4130,4640]
  }
];

// ========================================================================
// Seven additional routes, built from explicitly authored terrain sections.
// These are fixed layouts, not random generation: every required jump has
// a safe landing. Wide ravines always contain a traversable stepping bridge.
// Weapons remain optional; every enemy can still be defeated by a stomp.
// ========================================================================
const ROUTE_PARTS = {
  grove: {
    gaps:[[505,620]], platforms:[[155,352,160]],
    hazards:[[335,'cactus']],
    blocks:[[210,232,'gem'],[365,312,'weapon'],[405,312,'brick'],[675,312,'ammo']],
    enemies:[[95,'mushroom'],[440,'beetle'],[705,'mushroom']],
    coinRuns:[[165,299,4],[635,358,3]]
  },
  terraces: {
    gaps:[[585,710]], platforms:[[85,352,120],[278,272,140],[468,352,100]],
    hazards:[[535,'spikes']],
    blocks:[[315,152,'gem'],[200,312,'weapon'],[520,232,'ammo']],
    enemies:[[55,'beetle'],[400,'mushroom'],[735,'beetle']],
    coinRuns:[[90,298,3],[290,220,4],[480,300,3]]
  },
  ravine: {
    gaps:[[205,330],[550,680]], platforms:[[367,352,122]],
    hazards:[[365,'fire']],
    blocks:[[70,312,'weapon'],[110,312,'brick'],[410,232,'ammo'],[710,312,'heart']],
    enemies:[[140,'beetle'],[430,'beetle'],[710,'mushroom']],
    coinRuns:[[375,300,3]]
  },
  bridge: {
    gaps:[[250,600]], platforms:[[280,368,100],[448,328,110]],
    hazards:[],
    blocks:[[65,312,'weapon'],[105,312,'brick'],[468,208,'gem'],[650,312,'ammo']],
    enemies:[[155,'beetle'],[705,'mushroom']],
    coinRuns:[[282,316,3],[450,276,3],[625,356,3]]
  },
  ruins: {
    gaps:[[565,690]], platforms:[[132,352,140],[312,272,158]],
    hazards:[[390,'cactus']],
    blocks:[[65,312,'weapon'],[354,152,'gem'],[490,232,'brick'],[530,232,'ammo']],
    enemies:[[175,'beetle'],[478,'beetle'],[720,'mushroom']],
    coinRuns:[[143,300,3],[320,220,4]]
  },
  hollow: {
    gaps:[], platforms:[[233,352,198]],
    hazards:[[335,'spikes']],
    blocks:[[65,312,'heart'],[105,312,'brick'],[155,312,'weapon'],[285,232,'gem'],[535,312,'ammo'],[575,312,'brick']],
    enemies:[[470,'mushroom'],[685,'beetle']],
    coinRuns:[[242,300,5],[635,350,3]]
  }
};

// Each biome overrides the complete set of colors that define its mood.
// Small weather accents change the scenery, never visibility or physics.
const EXTRA_BIOMES = [
  {name:'Kwitnący sad',seed:223,night:false,weather:'petals',
    palette:{...STAGES[0].palette,top:'#d6c3c0',sky:'#f2ddcb',far:'#c4b4aa',mountain:'#b1b49a',mid:'#9aab87',tree:'#647e63',leaf:'#bf9ca3',leafLight:'#ebc0bc',grass:'#94b674',grassTop:'#d5dca2'},
    route:['grove','terraces','hollow','bridge','grove']},
  {name:'Deszczowe mokradła',seed:301,night:false,weather:'rain',
    palette:{...STAGES[2].palette,top:'#627e82',sky:'#b4c6ba',far:'#8fa8a1',mountain:'#759b94',mid:'#5e8780',tree:'#3d6b60',leaf:'#72977b',leafLight:'#93af86',grass:'#739e70',grassTop:'#b2c797'},
    route:['hollow','bridge','grove','bridge','ravine']},
  {name:'Miedziane urwiska',seed:389,night:false,weather:'leaves',
    palette:{...STAGES[1].palette,top:'#d1b69d',sky:'#f0d6b1',far:'#c4a38d',mountain:'#b39681',mid:'#a48866',tree:'#785f47',leaf:'#ba8957',leafLight:'#d8a365',grass:'#a09b61',grassTop:'#d6c487',earth:'#957150',earthDark:'#71533f'},
    route:['terraces','ravine','ruins','hollow','bridge','terraces']},
  {name:'Śnieżny przesmyk',seed:457,night:false,weather:'snow',
    palette:{...STAGES[2].palette,top:'#90acbd',sky:'#d2e0dc',sun:'#fff7dc',far:'#afc6ca',mountain:'#9fb7bd',mid:'#829fa7',tree:'#567d83',leaf:'#9dbfc0',leafLight:'#d4e2dd',grass:'#bcd2cb',grassTop:'#f2f3e3',earth:'#777f79',earthDark:'#576b68',stone:'#b2c9c2'},
    route:['grove','bridge','terraces','hollow','ravine','ruins']},
  {name:'Kryształowa grota',seed:541,night:true,weather:'crystals',
    palette:{...STAGES[2].palette,top:'#43415f',sky:'#827f9c',far:'#777793',mountain:'#626880',mid:'#4d5c71',tree:'#334a61',leaf:'#60708d',leafLight:'#9ea0bc',grass:'#789da1',grassTop:'#b6d3d0',earth:'#686473',earthDark:'#4c4a60',stone:'#9facca',glow:'#d6cffa'},
    route:['ruins','bridge','ravine','terraces','hollow','ruins']},
  {name:'Popielny las',seed:619,night:true,weather:'embers',
    palette:{...STAGES[2].palette,top:'#5c424b',sky:'#ae8274',sun:'#f9d295',far:'#9a786e',mountain:'#83675e',mid:'#705b54',tree:'#4a4841',leaf:'#877258',leafLight:'#ad9366',grass:'#8e9469',grassTop:'#c7b981',earth:'#866953',earthDark:'#5e4c43',glow:'#ffd3a0'},
    route:['ravine','ruins','bridge','hollow','terraces','ravine','grove']},
  {name:'Serce pradawnego lasu',seed:733,night:true,weather:'magic',
    palette:{...STAGES[2].palette,top:'#355967',sky:'#8cb7ad',far:'#709e97',mountain:'#548b83',mid:'#3c756c',tree:'#255a50',leaf:'#639b78',leafLight:'#9ec194',grass:'#90b879',grassTop:'#d9df97',stone:'#9cbaa0',glow:'#edf6af'},
    route:['grove','terraces','bridge','ruins','hollow','ravine','bridge']}
];

function buildExtraStage(biome, index) {
  const weaponCycle = ['bow','fire','sword','ice'];
  const firstWeapon = weaponCycle[index % weaponCycle.length];
  const config = {
    ...biome, length:800 + biome.route.length*760 + 450,
    gaps:[], platforms:[], hazards:[],
    blocks:[[340,312,firstWeapon],[380,312,'brick'],[420,312,'coin'],[530,312,'ammo'],[645,312,'cat']],
    enemies:[[730,'mushroom']], flags:[], coinRuns:[[470,356,3]],
    signs:[[190,'→',biome.name.toLocaleUpperCase('pl-PL')]], mushrooms:[75,580]
  };
  biome.route.forEach((partName, sectionIndex) => {
    const part = ROUTE_PARTS[partName];
    const offset = 800 + sectionIndex*760;
    for (const [left,right] of part.gaps) config.gaps.push([offset+left,offset+right]);
    for (const [x,y,w] of part.platforms) config.platforms.push([offset+x,y,w]);
    for (const [x,kind] of part.hazards) config.hazards.push([offset+x,kind]);
    for (const [x,y,kind] of part.blocks) {
      config.blocks.push([offset+x,y,kind==='weapon'?weaponCycle[(index+sectionIndex+1)%4]:kind]);
    }
    for (const [x,kind] of part.enemies) config.enemies.push([offset+x,kind]);
    for (const [x,y,count] of part.coinRuns) config.coinRuns.push([offset+x,y,count]);
    if (sectionIndex>0 && sectionIndex%2===1) config.flags.push(offset+12);
    if (sectionIndex===2) config.blocks.push([offset+5,312,'cat']);
    config.mushrooms.push(offset+25);
  });
  config.blocks.push([config.length-360,312,'heart']);
  config.coinRuns.push([config.length-390,355,4]);
  return config;
}

// The original three levels stay recognizable while introducing the new
// inventory gradually. Reward positions and platform colliders are retained.
STAGES[0].night=false;
STAGES[1].night=false;
STAGES[2].night=true;
STAGES[2].weather='magic';
const rewardChanges = [
  {840:'cat',1040:'heart',1990:'fire',2520:'sword',3480:'ice',3690:'ammo'},
  {340:'fire',640:'cat',1600:'ice',2540:'sword',4060:'ammo'},
  {340:'ice',740:'cat',1750:'fire',2810:'ammo',3740:'sword',4670:'ammo'}
];
STAGES.slice(0,3).forEach((config,index) => {
  config.blocks=config.blocks.map(([x,y,kind])=>[x,y,rewardChanges[index][x]||kind]);
  config.blocks.push([index===0?770:800,312,'ammo']);
});
STAGES[0].signs[1]=[585,'↓','SKOK LUB ATAK'];
STAGES[2].signs[2]=[4580,'→','DALEJ W LAS'];
EXTRA_BIOMES.forEach((biome,index)=>STAGES.push(buildExtraStage(biome,index+3)));

function loadStage(index, preserveEquipment = true) {
  if (!Number.isInteger(index) || index<0 || index>=STAGES.length) return;
  const config = STAGES[index];
  const weapon = preserveEquipment && player ? player.weapon : null;
  const ammo = preserveEquipment && player ? player.ammo : 0;
  const health = preserveEquipment && player ? Math.max(2, player.health) : MAX_HEALTH;
  stageIndex = index;
  checkpoint = 100;
  stageStartCoins = stats.coins;
  stageStartKills = stats.kills;
  camera = 0;
  particles = [];
  floatingTexts = [];
  projectiles = [];
  attacks = [];
  loot = [];
  companion = null;
  stageExitTime = 0;
  level = { ...config, solids: [], blocks: [], enemies: [], coins: [], hazards: [], decorations: [] };

  // Holes are real. Large ravines are crossed using the authored platforms,
  // not by widening the heroine's jump or adding an invisible ground plane.
  let groundStart = 0;
  for (const [left, right] of config.gaps) {
    level.solids.push({x:groundStart,y:GROUND,w:left-groundStart,h:160,type:'ground'});
    groundStart = right;
  }
  level.solids.push({x:groundStart,y:GROUND,w:config.length-groundStart,h:160,type:'ground'});
  for (const [x,y,w] of config.platforms) level.solids.push({x,y,w,h:30,type:'platform'});
  for (const [x,kind] of config.hazards) {
    const size=kind==='spikes'?{w:40,h:20}:kind==='cactus'?{w:30,h:38}:{w:32,h:29};
    level.hazards.push({x,y:GROUND-size.h,...size,kind});
  }
  for (const [x,y,content] of config.blocks) {
    const block={x,y,w:TILE,h:TILE,type:'block',content,used:false,broken:false,bump:0};
    level.blocks.push(block);
    level.solids.push(block);
  }
  for (const [x,kind] of config.enemies) {
    const speed=(kind==='beetle'?43:33)*(1+index*.025);
    level.enemies.push({x,y:GROUND-28,w:32,h:28,vx:-speed,vy:0,kind,alive:true,squash:0,phase:x*.1,frozen:0});
  }
  for (const [x,y,count] of config.coinRuns) {
    for (let i=0;i<count;i++) level.coins.push({x:x+i*34,y:y-Math.sin(i/Math.max(1,count-1)*Math.PI)*12,w:17,h:23,collected:false,phase:i*.6});
  }
  for (const [left,right] of config.gaps) {
    // A coin arc is a jump hint, so never draw an impossible single arc
    // across a wide bridge section. Its coins follow individual platforms.
    if (right-left>160) continue;
    for (let i=0;i<5;i++) level.coins.push({x:left-28+i*(right-left+50)/4,y:GROUND-79-Math.sin(i/4*Math.PI)*39,w:17,h:23,collected:false,phase:i*.5});
  }
  checkpointFlags = config.flags.map(x=>({x,y:GROUND,active:false}));
  player = {x:100,y:GROUND-44,w:26,h:44,vx:0,vy:0,facing:1,onGround:true,coyote:.12,health,weapon,ammo,
    shield:0,invincible:0,shootCooldown:0,shootPose:0,emptyNotice:0,walk:0,blink:0,landSquash:0,dying:0};
  clearControls();
  bgCache = null;
  bgCacheKey = '';
  updateHUD();
}

// ========================================================================
// Input
// Movement is bidirectional inside the visible area; only the camera is
// forward-only. Releasing movement brakes quickly. Jumping has an input
// buffer, coyote time and variable height, independently of facing.
// ========================================================================
const isLeft = () => keys.has('ArrowLeft') || keys.has('KeyA') || touch.left;
const isRight = () => keys.has('ArrowRight') || keys.has('KeyD') || touch.right;
const isJump = () => keys.has('Space') || keys.has('ArrowUp') || keys.has('KeyW') || touch.jump;
const isShoot = () => keys.has('KeyX') || keys.has('KeyJ') || touch.shoot;

function clearControls() {
  keys.clear();
  touch.left = touch.right = touch.jump = touch.shoot = false;
  pointerControls.clear();
  jumpBuffer = 0;
  jumpWasHeld = false;
  document.querySelectorAll('.touch-btn').forEach(button => button.classList.remove('pressed'));
}

document.addEventListener('keydown', event => {
  const relevant = ['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','Space','KeyA','KeyD','KeyW','KeyX','KeyJ','KeyP','Escape','KeyM','KeyF','Enter'];
  if (!relevant.includes(event.code)) return;
  // Do not hijack native Enter/Space activation when an actual button is
  // focused. Gameplay itself focuses the surrounding canvas frame.
  if (document.activeElement instanceof HTMLButtonElement && ['Enter','Space'].includes(event.code) && state !== 'playing') return;
  event.preventDefault();
  if (!event.repeat) {
    if (event.code==='KeyM') { toggleSound(); return; }
    if (event.code==='KeyF') { toggleFullscreen(); return; }
    if (event.code==='KeyP' || event.code==='Escape') { togglePause(); return; }
    if (state==='title' && ['Enter','Space'].includes(event.code)) { startRun(); return; }
    if (['stageclear','win','gameover','paused'].includes(state) && event.code==='Enter') { if(primaryAction) primaryAction(); return; }
  }
  if (state!=='playing') return;
  if (!keys.has(event.code) && ['Space','ArrowUp','KeyW'].includes(event.code)) jumpBuffer=.14;
  keys.add(event.code);
});
document.addEventListener('keyup', event => keys.delete(event.code));

document.querySelectorAll('[data-control]').forEach(button => {
  const control = button.dataset.control;
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    if (state!=='playing') return;
    unlockAudio();
    try { button.setPointerCapture(event.pointerId); } catch (_) { /* Touch still works in embedded browsers without pointer capture. */ }
    pointerControls.set(event.pointerId,control);
    touch[control]=true;
    if(control==='jump') jumpBuffer=.14;
    button.classList.add('pressed');
  });
  const release = event => {
    pointerControls.delete(event.pointerId);
    touch[control] = [...pointerControls.values()].includes(control);
    button.classList.toggle('pressed',touch[control]);
  };
  button.addEventListener('pointerup',release);
  button.addEventListener('pointercancel',release);
  button.addEventListener('lostpointercapture',release);
  button.addEventListener('contextmenu', event => event.preventDefault());
});
window.addEventListener('blur', () => { clearControls(); if(state==='playing') pauseGame(); });
document.addEventListener('visibilitychange', () => { if(document.hidden && state==='playing') pauseGame(); });
frame.addEventListener('contextmenu', event => event.preventDefault());
$('startBtn').addEventListener('click',startRun);
$('pauseBtn').addEventListener('click',togglePause);
$('touchPause').addEventListener('click',togglePause);
$('soundBtn').addEventListener('click',toggleSound);
$('fullBtn').addEventListener('click',toggleFullscreen);
$('modalPrimary').addEventListener('click', () => { if(primaryAction) primaryAction(); });
$('modalSecondary').addEventListener('click', () => { if(secondaryAction) secondaryAction(); });

function toggleSound() {
  soundEnabled=!soundEnabled;
  $('soundBtn').setAttribute('aria-pressed',String(soundEnabled));
  if(soundEnabled) unlockAudio();
  if(audioMaster && audio) audioMaster.gain.setTargetAtTime(soundEnabled?.5:0,audio.currentTime,.02);
  if(state==='playing') frame.focus({preventScroll:true});
}

async function toggleFullscreen() {
  try {
    if(document.fullscreenElement) await document.exitFullscreen();
    // An installed PWA already owns the screen. Requesting the Fullscreen API
    // again makes Chrome cover the touch controls with its exit hint.
    else if(window.matchMedia('(display-mode: fullscreen)').matches ||
      ((window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) &&
        (navigator.maxTouchPoints > 0 || 'ontouchstart' in window))) return;
    else if(frame.requestFullscreen) await frame.requestFullscreen();
    else showToast('Obróć telefon poziomo, aby powiększyć widok.');
  } catch (_) { showToast('Pełny ekran jest niedostępny w tej przeglądarce.'); }
}

function startRun() {
  unlockAudio();
  stats = {coins:0,score:0,kills:0,shots:0,falls:0,catKills:0,catFinds:0};
  catLives = MAX_CAT_LIVES;
  runTime = 0;
  loadStage(0,false);
  state='playing';
  $('introScreen').hidden=true;
  $('modalScreen').hidden=true;
  frame.focus({preventScroll:true});
  showToast('A / D lub ← / → — ruch   ·   SPACJA — skok',3.5,true);
}

function showModal(kicker,title,text,primary,action,secondary='',secondaryCallback=null,values=[]) {
  $('modalKicker').textContent=kicker;
  $('modalTitle').textContent=title;
  $('modalText').textContent=text;
  $('modalPrimary').textContent=primary;
  $('modalSecondary').textContent=secondary;
  $('modalSecondary').hidden=!secondary;
  $('modalStats').replaceChildren();
  for(const [value,label] of values) {
    const wrap=document.createElement('div');
    const number=document.createElement('span');
    const caption=document.createElement('span');
    number.className='stat-number'; number.textContent=value;
    caption.className='stat-label'; caption.textContent=label;
    wrap.append(number,caption); $('modalStats').append(wrap);
  }
  $('modalStats').hidden=!values.length;
  primaryAction=action;
  secondaryAction=secondaryCallback;
  $('modalScreen').hidden=false;
  clearControls();
  // Focus makes keyboard use possible without requiring a mouse click.
  $('modalPrimary').focus({preventScroll:true});
}

function pauseGame() {
  if(state!=='playing') return;
  state='paused';
  showModal('Chwila pod paprocią','Las może poczekać.','A / D lub ← / → — ruch · SPACJA / W / ↑ — skok\nX / J — atak aktualną bronią. Na telefonie: przyciski.\nKamera przewija tylko w prawo. Skucha odbiera broń.\nŁuk: 12 strzał; kołczan: +8. Nowa broń zastępuje starą.\nLód: pierwszy podmuch zamraża, drugi pokonuje.\nLucek traci życie w przepaści i na przeszkodach. Każda jego znajdźka przywraca mu 7 żyć.','Wracaj na szlak →',resumeGame,'Rozpocznij od nowa',startRun);
}
function resumeGame() {
  state='playing';
  clearControls();
  $('modalScreen').hidden=true;
  unlockAudio();
  frame.focus({preventScroll:true});
}
function togglePause() { if(state==='playing') pauseGame(); else if(state==='paused') resumeGame(); }

function showToast(text,duration=2.8,adaptTouch=false) {
  if(adaptTouch && window.matchMedia('(pointer:coarse)').matches) text='Przyciski ← / → — ruch   ·   ↑ — skok';
  $('toast').textContent=text;
  $('toast').classList.add('show');
  toastTime=duration;
}

function finishStage() {
  if (state!=='playing') return;
  clearControls();
  player.vx=0;
  attacks=[];
  stats.score+=1000+player.health*100;
  sfx('win');
  if (companion) {
    // Give the companion a visible farewell instead of silently removing it
    // behind a results dialog. The camera remains fixed during this exit.
    state='stageexit';
    stageExitTime=1.5;
    companion.leaving=true;
    companion.facing=1;
    companion.vx=Math.max(430,(camera+viewWidth+85-companion.x)/1.15);
    companion.vy=-200;
    showToast('Do zobaczenia! Lucek ucieka z końcem poziomu.',2.2);
  } else completeStage();
}

function completeStage() {
  companion=null;
  if (stageIndex===STAGES.length-1) {
    state='win';
    if (stats.score>best) {
      best=stats.score;
      try {localStorage.setItem('forest-bow-best-v3',String(best));} catch (_) { /* Storage is optional for local files. */ }
      $('recordLabel').textContent=`Twój rekord: ${best.toLocaleString('pl-PL')} pkt`;
    }
    showModal('Serce lasu odnalezione','Dziesięć razy: naprzód!',
      `Wszystkie 10 poziomów za Tobą!\nLucek pomaga pokonać ${stats.catKills} potworków i zbiera ${stats.catFinds} znajdziek.`,
      'Jeszcze jedna wyprawa →',startRun,'',null,[[stats.coins,'monety'],[stats.kills,'potworki'],[stats.score,'punkty']]);
    for(let i=0;i<70;i++) particles.push({x:player.x-130+Math.random()*330,y:100+Math.random()*120,vx:(Math.random()-.5)*140,vy:-50-Math.random()*120,life:2+Math.random()*2,maxLife:4,size:3+Math.random()*4,color:['#f2d182','#bcd88b','#e99684'][i%3],gravity:65});
  } else {
    state='stageclear';
    showModal(`Poziom ${stageIndex+1} z ${STAGES.length} ukończony`,'Dobra droga.',
      'Następny przystanek: '+STAGES[stageIndex+1].name+'.\nBroń, strzały, monety i życia Lucka zostają. Kolejna znajdźka kotka odnowi mu 7 żyć.',
      'Dalej w las →',()=>{loadStage(stageIndex+1,true);resumeGame();showToast(STAGES[stageIndex].name);},'',null,
      [[stats.coins-stageStartCoins,'monety'],[stats.kills-stageStartKills,'potworki'],[`${stageIndex+1} / ${STAGES.length}`,'poziomy']]);
  }
  updateHUD();
}

// ========================================================================
// Physics and interactions
// Each axis is resolved separately at a fixed 120 Hz. Collision checks use
// the previous position, so thin blocks cannot be tunneled through by a
// high jump. Broken bricks stop being solid immediately.
// ========================================================================
const solidActive = solid => !solid.broken;
function nearSolids(entity,padding=70) {
  return level.solids.filter(s => solidActive(s) && s.x+s.w>entity.x-padding && s.x<entity.x+entity.w+padding);
}
function solidAt(x,y) { return level.solids.some(s => solidActive(s) && x>=s.x && x<s.x+s.w && y>=s.y && y<s.y+s.h); }

function moveBody(body,dt,isPlayer=false) {
  const solids=nearSolids(body);
  const oldX=body.x;
  const oldY=body.y;
  body.x+=body.vx*dt;
  for(const solid of solids) {
    if(!overlaps(body,solid)) continue;
    if(body.vx>0 && oldX+body.w<=solid.x+1) {body.x=solid.x-body.w;body.vx=0;}
    else if(body.vx<0 && oldX>=solid.x+solid.w-1) {body.x=solid.x+solid.w;body.vx=0;}
  }
  if(isPlayer) {
    // The visible left edge acts as a wall: walking left never reveals an
    // earlier part of the map. World coordinates remain unchanged.
    const leftEdge=camera;
    const rightEdge=level.length-body.w;
    body.x=clamp(body.x,leftEdge,rightEdge);
    if((body.x<=leftEdge && body.vx<0) || (body.x>=rightEdge && body.vx>0)) body.vx=0;
  }
  const oldBottom=oldY+body.h;
  body.y+=body.vy*dt;
  body.onGround=false;
  const headHits=[];
  for(const solid of solids) {
    if(!solidActive(solid) || !overlaps(body,solid)) continue;
    if(body.vy>=0 && oldBottom<=solid.y+2) {
      body.y=solid.y-body.h;
      if(isPlayer && body.vy>260) body.landSquash=.11;
      body.vy=0;
      body.onGround=true;
    } else if(body.vy<0 && oldY>=solid.y+solid.h-2) {
      headHits.push(solid);
    }
  }
  if(headHits.length) {
    // At a seam, hit the block nearest the hero's center, not two rewards.
    headHits.sort((a,b)=>Math.abs(a.x+a.w/2-body.x-body.w/2)-Math.abs(b.x+b.w/2-body.x-body.w/2));
    const solid=headHits[0];
    body.y=solid.y+solid.h;
    body.vy=25;
    if(isPlayer) hitBlock(solid);
  }
}

function addBurst(x,y,color,count=10,speed=95) {
  for(let i=0;i<count;i++) {
    const angle=Math.random()*Math.PI*2;
    const velocity=25+Math.random()*speed;
    const life=.3+Math.random()*.45;
    particles.push({x,y,vx:Math.cos(angle)*velocity,vy:Math.sin(angle)*velocity-45,life,maxLife:life,size:2+Math.random()*3,color,gravity:230});
  }
}
function floatText(text,x,y,color='#fff4c5') {floatingTexts.push({text,x,y,color,life:1,maxLife:1});}

// ========================================================================
// Rewards and mutually exclusive offensive power-ups
// The contents of a used box never change into a different reward just
// because a matching weapon is already equipped. A second bow adds arrows.
// ========================================================================
function spawnLoot(kind,x,y) {
  const item={x,y,w:25,h:27,vx:90,vy:-150,kind,life:36,age:0,onGround:false};
  loot.push(item);
  return item;
}

function hitBlock(block) {
  if (block.type!=='block') {sfx('bump');return;}
  if (block.broken) return;
  if (block.content==='brick') {
    block.broken=true;
    stats.score+=25;
    sfx('break');
    shakeTime=REDUCED_MOTION?0:.1;
    for(let i=0;i<9;i++) particles.push({x:block.x+5+Math.random()*30,y:block.y+Math.random()*35,vx:(Math.random()-.5)*180,vy:-90-Math.random()*160,life:.7,maxLife:.7,size:5+Math.random()*6,color:i%2?'#c69461':'#e0b67a',gravity:650});
    floatText('+25',block.x+20,block.y);
  } else if (!block.used) {
    block.used=true;
    block.bump=.2;
    sfx('bump');
    if (block.content==='coin') {
      collectCoin(block.x+TILE/2,block.y,3);
      floatText('+3',block.x+20,block.y-12,'#ffe5a0');
    } else {
      spawnLoot(block.content,block.x+10,block.y-28);
      addBurst(block.x+20,block.y-8,'#ffe0a0',8);
      showToast(`${ITEM_LABELS[block.content] || 'Znajdźka'}! Złap nad skrzynką lub obok niej.`,2);
    }
  } else {block.bump=.1;sfx('bump');}
  // A breaking brick and a reward box both defeat an enemy standing on top.
  for (const enemy of level.enemies) {
    if (enemy.alive && Math.abs(enemy.y+enemy.h-block.y)<5 && enemy.x+enemy.w>block.x && enemy.x<block.x+block.w) defeatEnemy(enemy,'bump');
  }
  updateHUD();
}

function collectCoin(x,y,amount=1,byCat=false) {
  stats.coins+=amount;
  stats.score+=100*amount;
  if (byCat) stats.catFinds++;
  sfx('coin');
  addBurst(x,y,byCat?'#c9edbf':'#ffe3a0',6,65);
  updateHUD();
}

function collectLoot(item,byCat=false) {
  // Mark the item first. This prevents a player and a companion overlapping
  // the same reward in one fixed step from collecting it twice.
  if (!item || item.life<=0) return;
  item.life=0;
  if (byCat) stats.catFinds++;
  const prefix=byCat?'Lucek przynosi: ':'';
  if (Object.hasOwn(WEAPONS,item.kind)) {
    const previous=player.weapon;
    player.weapon=item.kind;
    if (item.kind==='bow') player.ammo=Math.min(MAX_ARROWS,player.ammo+ARROWS_PER_BOW);
    // Cancel an unfinished melee/cone attack when its weapon is replaced.
    attacks=[];
    player.shootCooldown=.12;
    player.shootPose=0;
    stats.score+=250;
    const tips={
      bow:`${player.ammo} strzał w kołczanie. X / J — atak.`,
      fire:'Kule odbijają się od ziemi. X / J — atak.',
      sword:'Szerokie cięcie z bliska. X / J — atak.',
      ice:'Zamraża. Drugi podmuch rozbija lód. X / J — atak.'
    };
    let tip=tips[item.kind];
    if (window.matchMedia('(pointer:coarse)').matches) tip=tip.replace('X / J — atak.','Użyj przycisku ataku.');
    const replacement=previous && previous!==item.kind ? ` Zastępuje: ${WEAPONS[previous].label.toLowerCase()}.` : '';
    showToast(`${prefix}${WEAPONS[item.kind].label}! ${tip}${replacement}`,3.2);
    floatText(WEAPONS[item.kind].short+'!',player.x+15,player.y-15,WEAPONS[item.kind].color);
  } else if (item.kind==='ammo') {
    const added=Math.min(ARROWS_PER_BUNDLE,MAX_ARROWS-player.ammo);
    player.ammo+=added;
    stats.score+=50;
    showToast(prefix+(added?`Strzały +${added}. ${player.weapon==='bow'?'Kołczan uzupełniony.':'Czekają w kołczanie na zdobycie łuku.'}`:'Kołczan jest pełny — 99 strzał.'));
    floatText(added?`+${added} STRZAŁ`:'PEŁNY KOŁCZAN',item.x,item.y-12,'#f5dc9f');
  } else if (item.kind==='cat') {
    stats.score+=200;
    catLives=MAX_CAT_LIVES;
    if (!companion) {
      spawnCompanion();
      sfx('meow');
      showToast('Lucek dołącza! Odzyskał 7 żyć, łapie znajdźki i atakuje.',3.6);
    } else showToast('Lucek odzyskał 7 żyć! Dodatkowo +200 punktów.');
    floatText('MIAU!',item.x,item.y-15,'#ecdfb3');
  } else if (item.kind==='heart') {
    if (player.health>=MAX_HEALTH) {stats.score+=200;floatText('+200',player.x+15,player.y-15);showToast(prefix+'Pełne zdrowie — +200 punktów.');}
    else {player.health++;floatText('+1 ♥',player.x+15,player.y-15,'#ffc1ae');showToast(prefix+'Leśne serce — zdrowie odzyskane.');}
  } else if (item.kind==='shield') {
    player.shield=12;
    stats.score+=150;
    showToast(prefix+'Moc świetlików! 12 sekund ochrony przed potworkami.');
    floatText('OCHRONA',player.x+15,player.y-18,'#d5f9c8');
  } else {
    collectCoin(item.x,item.y,5);
    floatText('+5',item.x,item.y-8,'#e4efd1');
  }
  sfx('power');
  addBurst(item.x+12,item.y+13,byCat?'#c4ebc8':'#eef4ba',15,130);
  updateHUD();
}

function defeatEnemy(enemy,method='stomp') {
  if (!enemy.alive) return;
  enemy.alive=false;
  enemy.squash=.4;
  stats.kills++;
  if (method==='cat') stats.catKills++;
  stats.score+=150;
  const color=enemy.frozen>0?'#c1f2ff':method==='fire'?'#ffba76':method==='cat'?'#bee6b0':'#e4e5b1';
  sfx(enemy.frozen>0?'shatter':'stomp');
  addBurst(enemy.x+16,enemy.y+12,color,enemy.frozen>0?16:8,120);
  floatText(method==='cat'?'LUCEK +150':'+150',enemy.x+16,enemy.y-8,color);
  updateHUD();
}

// All four weapons share the attack button. Only bows consume ammunition;
// an empty bow remains equipped until replaced or refilled, with no fallback
// weapon silently restored from a previously collected power-up.
function shoot() {
  if (!player.weapon || player.shootCooldown>0 || player.dying>0 || state!=='playing') return;
  const kind=player.weapon;
  if (kind==='bow' && player.ammo<=0) {
    if (player.emptyNotice<=0) {
      showToast('Brak strzał! Znajdź kołczan (+8), nowy łuk lub inną broń.',2);
      sfx('empty');
      player.emptyNotice=1.8;
    }
    return;
  }
  const direction=player.facing;
  player.shootCooldown=WEAPONS[kind].cooldown;
  player.shootPose=kind==='ice'?.3:.22;
  stats.shots++;
  if (kind==='bow') {
    player.ammo--;
    const width=30;
    projectiles.push({kind:'arrow',x:direction>0?player.x+player.w+3:player.x-width-3,y:player.y+23,w:width,h:5,vx:640*direction,vy:0,life:1.65});
    sfx('shoot');
  } else if (kind==='fire') {
    // Fireballs bounce at a low height, making them useful for clearing the
    // ground without becoming a substitute for a long, straight arrow shot.
    projectiles.push({kind:'fire',x:direction>0?player.x+player.w+4:player.x-20,y:player.y+22,w:15,h:15,vx:380*direction,vy:55,life:2.2,bounces:0});
    sfx('fire');
  } else {
    attacks.push({kind,direction,age:0,life:kind==='ice'?.32:.23,duration:kind==='ice'?.32:.23,hit:new Set()});
    sfx(kind==='sword'?'sword':'ice');
  }
  updateHUD();
}

function loseEquipment() {
  const lost=player.weapon;
  player.weapon=null;
  player.ammo=0;
  player.shield=0;
  player.shootPose=0;
  player.shootCooldown=0;
  attacks=[];
  return lost;
}

function hurtPlayer(pit=false) {
  if (player.dying>0 || state!=='playing') return;
  if (!pit && (player.invincible>0 || player.shield>0)) return;
  const lost=loseEquipment();
  player.health--;
  player.invincible=1.65;
  sfx('hurt');
  shakeTime=REDUCED_MOTION?0:.16;
  addBurst(player.x+13,player.y+20,'#f7bb9b',10,120);
  if (lost) floatText('BROŃ UTRACONA',player.x+13,player.y-12,'#ffc1a5');
  if (pit) stats.falls++;
  if (player.health<=0) {
    player.health=0;
    state='gameover';
    showModal('Nie każdy skok jest idealny','Jeszcze raz, śmiało.',
        'Broń, strzały i ochrona przepadają. Monety zostają.\nWróć do ostatniej flagi z kompletem serc.'+(companion?' Lucek nadal czeka na tym poziomie.':''),
      'Wróć do punktu kontrolnego →',()=>{player.health=MAX_HEALTH;respawn();resumeGame();},'Zacznij nową wyprawę',startRun);
  } else if (pit) {
    respawn();
    showToast('Powrót do flagi. Broń i strzały przepadają; monety zostają.');
  } else {
    player.vy=-230;
    player.vx=0;
    player.onGround=false;
    showToast(lost?'Skucha! Broń i strzały przepadają. Zdobywaj kolejne znajdźki.':'Bokiem boli! Skacz na głowy albo zdobądź broń.',2.6);
  }
  updateHUD();
}

function respawn() {
  player.x=checkpoint;
  player.y=GROUND-player.h;
  player.vx=player.vy=0;
  player.onGround=true;
  player.coyote=.12;
  player.invincible=2.5;
  player.dying=0;
  player.facing=1;
  // Returning to a checkpoint starts a new attempt. This is the only
  // in-level event allowed to move the camera back; ordinary walking cannot.
  camera=clamp(player.x-viewWidth*.24,0,Math.max(0,level.length-viewWidth));
  projectiles=[];
  attacks=[];
  clearControls();
  if (companion) recallCompanion();
  for (const enemy of level.enemies) {
    if (enemy.alive && Math.abs(enemy.x-checkpoint)<110) {
      enemy.x=checkpoint+150;
      enemy.y=GROUND-enemy.h;
      enemy.vy=0;
    }
  }
  updateHUD();
}

function updatePlayer(dt) {
  player.invincible=Math.max(0,player.invincible-dt);
  player.shield=Math.max(0,player.shield-dt);
  player.shootCooldown=Math.max(0,player.shootCooldown-dt);
  player.shootPose=Math.max(0,player.shootPose-dt);
  player.emptyNotice=Math.max(0,player.emptyNotice-dt);
  player.landSquash=Math.max(0,player.landSquash-dt);
  const held=isJump();
  jumpBuffer=Math.max(0,jumpBuffer-dt);
  if (player.onGround) player.coyote=.11;
  else player.coyote=Math.max(0,player.coyote-dt);
  if (jumpBuffer>0 && player.coyote>0) {
    player.vy=-JUMP_SPEED;
    player.onGround=false;
    player.coyote=0;
    jumpBuffer=0;
    sfx('jump');
    addBurst(player.x+10,player.y+player.h,'#d7e3ad',5,45);
  }
  if (!held && jumpWasHeld && player.vy<-230) player.vy*=.49;
  jumpWasHeld=held;
  const direction=Number(isRight())-Number(isLeft());
  if (direction!==0) player.facing=direction;
  const target=direction*SPEED;
  const accel=direction!==0?1650:2300;
  if (player.vx<target) player.vx=Math.min(target,player.vx+accel*dt);
  else player.vx=Math.max(target,player.vx-accel*dt);
  player.vy=Math.min(850,player.vy+GRAVITY*dt);
  const previousBottom=player.y+player.h;
  moveBody(player,dt,true);
  if (player.onGround && Math.abs(player.vx)>10) player.walk+=dt*11;
  else if (player.onGround) player.walk=0;
  if (isShoot()) shoot();
  // Resolve a freshly started sword/ice attack before checking body damage:
  // a successful close-range strike should protect the heroine immediately.
  updateAttacks(dt);

  for (const coin of level.coins) {
    if (!coin.collected && overlaps(player,coin)) {coin.collected=true;collectCoin(coin.x+8,coin.y+10);}
  }
  for (const enemy of level.enemies) {
    if (!enemy.alive || !overlaps(player,enemy)) continue;
    if (player.shield>0) {defeatEnemy(enemy,'shield');continue;}
    if (player.vy>0 && previousBottom<=enemy.y+13) {
      player.y=enemy.y-player.h;
      player.vy=held?-535:-395;
      player.onGround=false;
      player.coyote=0;
      defeatEnemy(enemy);
    } else if (enemy.frozen<=0) hurtPlayer();
    if (state!=='playing') return;
  }
  for (const hazard of level.hazards) {
    if (overlaps(player,hazard)) {
      hurtPlayer();
      if (state!=='playing') return;
      break;
    }
  }
  if (player.y>WORLD_HEIGHT+70) {hurtPlayer(true);return;}
  for (const flag of checkpointFlags) {
    if (!flag.active && player.x+player.w>flag.x && player.y+player.h<=GROUND+4) {
      flag.active=true;
      checkpoint=flag.x+13;
      player.health=Math.min(MAX_HEALTH,player.health+1);
      stats.score+=100;
      sfx('flag');
      addBurst(flag.x+20,GROUND-76,'#dcecaf',18,145);
      showToast('Punkt kontrolny! +1 serce.');
      updateHUD();
    }
  }
  if (player.x>=level.length-205) finishStage();
  updateCamera();
}

function updateCamera() {
  // Preserve the furthest camera position even on phone rotation. The hero
  // can move left only as far as this fixed screen edge, never scroll back.
  const target=clamp(player.x-viewWidth*.26,0,Math.max(0,level.length-viewWidth));
  camera=Math.max(camera,target);
}

function updateEnemies(dt) {
  for (const enemy of level.enemies) {
    if (!enemy.alive) {enemy.squash=Math.max(0,enemy.squash-dt);continue;}
    enemy.frozen=Math.max(0,enemy.frozen-dt);
    if (enemy.x<camera-220 || enemy.x>camera+viewWidth+320) continue;
    if (enemy.frozen>0) continue;
    enemy.phase+=dt*7;
    const direction=enemy.vx>=0?1:-1;
    const ahead=direction>0?enemy.x+enemy.w+3:enemy.x-3;
    if (!solidAt(ahead,enemy.y+enemy.h+5) || solidAt(ahead,enemy.y+enemy.h-5)) enemy.vx=-enemy.vx;
    const savedVx=enemy.vx;
    enemy.vy=Math.min(800,enemy.vy+GRAVITY*dt);
    moveBody(enemy,dt,false);
    if (enemy.vx===0) enemy.vx=-savedVx;
    if (enemy.y>WORLD_HEIGHT+100) enemy.alive=false;
  }
}

// ========================================================================
// Attack resolution
// Melee arcs are locked to the facing at attack start. A Set records victims
// so the same ice burst cannot freeze and instantly shatter one enemy.
// Solid tiles block ranged attacks and the reach of a sword or icy breath.
// ========================================================================
function attackOrigin(attack) {
  return {x:attack.direction>0?player.x+player.w:player.x,y:player.y+25};
}

function clearAttackPath(x1,y1,x2,y2) {
  const steps=Math.max(1,Math.ceil(Math.hypot(x2-x1,y2-y1)/9));
  for (let i=1;i<steps;i++) {
    if (solidAt(x1+(x2-x1)*i/steps,y1+(y2-y1)*i/steps)) return false;
  }
  return true;
}

function updateAttacks(dt) {
  for (const attack of attacks) {
    attack.age+=dt;
    attack.life-=dt;
    if (attack.life<=0) continue;
    const origin=attackOrigin(attack);
    const reach=attack.kind==='sword'?73:150;
    for (const enemy of level.enemies) {
      if (!enemy.alive || attack.hit.has(enemy)) continue;
      const cx=enemy.x+enemy.w/2;
      const cy=enemy.y+enemy.h/2;
      const forward=(cx-origin.x)*attack.direction;
      const halfHeight=attack.kind==='sword'?35:15+Math.max(0,forward)*.3;
      if (forward<-8 || forward>reach+enemy.w/2 || Math.abs(cy-origin.y)>halfHeight+enemy.h/2) continue;
      if (!clearAttackPath(origin.x,origin.y,cx,cy)) continue;
      attack.hit.add(enemy);
      if (attack.kind==='ice' && enemy.frozen<=0) {
        enemy.frozen=3.6;
        addBurst(cx,cy,'#c5f1ff',12,85);
        floatText('ZAMROŻONY',cx,enemy.y-10,'#d5f7ff');
        sfx('freeze');
      } else defeatEnemy(enemy,attack.kind);
    }
  }
  attacks=attacks.filter(attack=>attack.life>0);
}

function updateProjectiles(dt) {
  for (const shot of projectiles) {
    shot.life-=dt;
    if (shot.life<=0) continue;
    const direction=shot.vx>0?1:-1;
    if (shot.kind==='fire') {
      const oldBottom=shot.y+shot.h;
      const oldX=shot.x;
      shot.vy=Math.min(600,shot.vy+850*dt);
      shot.x+=shot.vx*dt;
      let collided=false;
      for (const solid of nearSolids(shot,8)) {
        if (overlaps(shot,solid)) {collided=true;break;}
      }
      if (collided) {shot.x=oldX;shot.life=0;}
      else {
        shot.y+=shot.vy*dt;
        for (const solid of nearSolids(shot,8)) {
          if (!overlaps(shot,solid)) continue;
          if (shot.vy>0 && oldBottom<=solid.y+3) {
            shot.y=solid.y-shot.h;
            shot.vy=-225;
            shot.bounces++;
            addBurst(shot.x+7,shot.y+12,'#f0c77d',3,25);
          } else shot.life=0;
          break;
        }
      }
      if (shot.life<=0) addBurst(shot.x+7,shot.y+7,'#f9b374',6,75);
    } else {
      shot.x+=shot.vx*dt;
      for (const solid of nearSolids(shot,6)) {
        if (overlaps(shot,solid)) {shot.life=0;addBurst(shot.x+(direction>0?shot.w:0),shot.y,'#d5c59c',3,40);break;}
      }
    }
    if (shot.life<=0) continue;
    for (const enemy of level.enemies) {
      if (enemy.alive && overlaps(shot,enemy)) {defeatEnemy(enemy,shot.kind);shot.life=0;break;}
    }
  }
  projectiles=projectiles.filter(shot=>shot.life>0 && shot.x+shot.w>camera-100 && shot.x<level.length+30 && shot.y<WORLD_HEIGHT+40);
}

function updateItems(dt) {
  for (const block of level.blocks) block.bump=Math.max(0,block.bump-dt);
  for (const item of loot) {
    item.life-=dt;
    item.age+=dt;
    if (item.life<=0) continue;
    item.vy=Math.min(600,item.vy+780*dt);
    const oldVx=item.vx;
    moveBody(item,dt,false);
    if (item.vx===0) item.vx=oldVx*.5;
    if (item.onGround) item.vx=Math.max(0,item.vx-40*dt);
    if (item.y>WORLD_HEIGHT+50) {
      // Rescue pit-bound rewards onto the next ground island, not an
      // invisible support in the hole. Its original item type is retained.
      const landing=level.solids.find(s=>s.type==='ground' && s.x+s.w>item.x+20 && s.x>=item.x-30);
      if (landing) {item.x=landing.x+18;item.y=GROUND-item.h;item.vy=0;item.vx=0;}
      else item.life=0;
    }
    if (item.life>0 && item.age>.2 && (overlaps(player,item) || distance(player,item)<38)) collectLoot(item);
  }
  loot=loot.filter(item=>item.life>0);
  updateProjectiles(dt);
}

// ========================================================================
// Black-cat companion
// The cat has its own physics body and autonomous targets. It runs ahead,
// jumps ledges/gaps, pounces only on cooldown, and applies collected items
// to the heroine's inventory. It never opens boxes without a head bump.
// A safety recall prevents pathfinding failures from permanently losing a
// companion; genuine collection/attacks always require local contact.
// ========================================================================
function spawnCompanion() {
  companion={x:player.x+58,y:player.y+20,w:30,h:22,vx:0,vy:0,onGround:false,facing:1,
    walk:0,cooldown:1.1,pounce:0,target:null,leaving:false,stuck:0,teleportGlow:.45,invincible:1};
  recallCompanion();
}

function loseCatLife(reason) {
  if (!companion || (reason!=='przepaść' && companion.invincible>0)) return;
  catLives=Math.max(0,catLives-1);
  addBurst(companion.x+15,companion.y+11,'#f2c493',14,105);
  sfx('hurt');
  if (catLives===0) {
    companion=null;
    showToast(`Lucek stracił siódme życie (${reason}) i znika. Znajdź go ponownie!`,3.5);
  } else {
    recallCompanion();
    companion.invincible=2;
    const word=catLives===1?'życie':catLives<5?'życia':'żyć';
    showToast(`Lucek traci życie (${reason}). Zostało mu ${catLives} ${word}.`,2.8);
  }
  updateHUD();
}

function recallCompanion() {
  if (!companion) return;
  const desired=clamp(player.x+52,camera+4,level.length-40);
  const ground=level.solids.filter(s=>s.type==='ground' && s.x+s.w-companion.w>=Math.max(s.x,camera+4));
  const nearest=ground.map(s=>clamp(desired,Math.max(s.x,camera+4),s.x+s.w-companion.w))
    .sort((a,b)=>Math.abs(a-desired)-Math.abs(b-desired))[0];
  companion.x=nearest ?? desired;
  companion.y=GROUND-companion.h-12;
  companion.vx=companion.vy=0;
  companion.pounce=0;
  companion.target=null;
  companion.stuck=0;
  companion.onGround=false;
  companion.teleportGlow=.45;
  addBurst(companion.x+15,companion.y+10,'#c5e4ba',10,60);
}

function updateCompanion(dt) {
  const cat=companion;
  if (!cat) return;
  cat.teleportGlow=Math.max(0,cat.teleportGlow-dt);
  if (cat.leaving) {
    cat.x+=cat.vx*dt;
    cat.vy+=700*dt;
    cat.y=Math.min(GROUND-cat.h,cat.y+cat.vy*dt);
    cat.walk+=dt*18;
    return;
  }
  cat.cooldown=Math.max(0,cat.cooldown-dt);
  cat.pounce=Math.max(0,cat.pounce-dt);
  cat.invincible=Math.max(0,cat.invincible-dt);
  let targetX=clamp(player.x+98,camera+25,Math.min(level.length-40,camera+viewWidth-42));
  let targetY=player.y+player.h;
  if (cat.pounce>0 && cat.target && cat.target.alive) {
    targetX=cat.target.x+cat.target.w/2;
    targetY=cat.target.y;
  } else {
    cat.target=null;
    if (cat.cooldown<=0) {
      const enemy=level.enemies.filter(e=>e.alive && e.x>=camera && e.x<camera+viewWidth-20 && e.x>player.x-30 && e.x<player.x+240 && distance(cat,e)<156)
        .sort((a,b)=>distance(cat,a)-distance(cat,b))[0];
      if (enemy) {
        cat.target=enemy;
        cat.pounce=.8;
        cat.cooldown=3.1;
        targetX=enemy.x+enemy.w/2;
        targetY=enemy.y;
        if (cat.onGround) cat.vy=-310;
      }
    }
    if (!cat.target) {
      // Only pursue nearby reachable items in the visible part of the map.
      // A high optional platform is left for the heroine instead of making
      // the cat jump forever against an inaccessible reward above its head.
      const candidates=[...loot.filter(i=>i.life>0 && i.age>.2),...level.coins.filter(c=>!c.collected)]
        .filter(i=>i.x>=camera+4 && i.x<camera+viewWidth-25 && i.x>player.x-35 && i.x<player.x+190 && Math.abs(i.x-cat.x)<150 && i.y>cat.y-125 && i.y<cat.y+85);
      candidates.sort((a,b)=>distance(cat,a)-distance(cat,b));
      if (candidates.length) {targetX=candidates[0].x+12;targetY=candidates[0].y;}
    }
  }
  const delta=targetX-(cat.x+cat.w/2);
  const direction=Math.abs(delta)>9?Math.sign(delta):0;
  if (direction) cat.facing=direction;
  const speed=cat.pounce>0?355:Math.abs(delta)>135?320:270;
  cat.vx=direction*speed;
  const ahead=direction>0?cat.x+cat.w+24:cat.x-24;
  const missingFloor=direction!==0 && !solidAt(ahead,cat.y+cat.h+8);
  const wall=direction!==0 && solidAt(ahead,cat.y+cat.h-9);
  const hazardAhead=direction!==0 && level.hazards.some(h =>
    h.x<Math.max(ahead,cat.x+cat.w)+12 && h.x+h.w>Math.min(ahead,cat.x) && h.y<cat.y+cat.h+8);
  const highReward=targetY<cat.y-18 && Math.abs(delta)<85;
  if (cat.onGround && (missingFloor || wall || highReward || hazardAhead)) {
    cat.vy=missingFloor?-535:highReward?-565:-570;
    cat.onGround=false;
  }
  const oldX=cat.x;
  cat.vy=Math.min(850,cat.vy+GRAVITY*dt);
  moveBody(cat,dt,false);
  cat.x=Math.max(camera+3,cat.x);
  if (cat.onGround && Math.abs(cat.vx)>0) cat.walk+=dt*13;
  if (direction && Math.abs(cat.x-oldX)<.05) cat.stuck+=dt;
  else cat.stuck=0;
  if (cat.y>WORLD_HEIGHT+45) {
    loseCatLife('przepaść');
    return;
  }
  if (cat.invincible===0 && level.hazards.some(h=>overlaps(cat,h))) {
    loseCatLife('raniąca przeszkoda');
    return;
  }
  if (cat.x<camera-40 || Math.abs(cat.x-player.x)>430 || cat.stuck>1.3) {
    recallCompanion();
    return;
  }
  for (const enemy of level.enemies) {
    if (cat.pounce>0 && enemy.alive && overlaps(cat,enemy)) {
      defeatEnemy(enemy,'cat');
      cat.pounce=0;
      cat.target=null;
      cat.vy=-200;
      addBurst(cat.x+15,cat.y,'#e6dab1',8,80);
      break;
    }
  }
  for (const coin of level.coins) {
    if (!coin.collected && (overlaps(cat,coin) || distance(cat,coin)<25)) {
      coin.collected=true;
      collectCoin(coin.x+8,coin.y+10,1,true);
    }
  }
  for (const item of loot) {
    if (item.life>0 && item.age>.2 && (overlaps(cat,item) || distance(cat,item)<27)) collectLoot(item,true);
  }
}

function updateEffects(dt) {
  for(const particle of particles) {
    particle.life-=dt;
    particle.x+=particle.vx*dt;
    particle.y+=particle.vy*dt;
    particle.vy+=particle.gravity*dt;
  }
  particles=particles.filter(p=>p.life>0);
  for(const text of floatingTexts) {text.life-=dt;text.y-=30*dt;}
  floatingTexts=floatingTexts.filter(t=>t.life>0);
  if(toastTime>0) {toastTime-=dt;if(toastTime<=0)$('toast').classList.remove('show');}
  shakeTime=Math.max(0,shakeTime-dt);
}

function update(dt) {
  worldTime+=dt;
  updateEffects(dt);
  if(state==='stageexit') {
    updateCompanion(dt);
    stageExitTime-=dt;
    if(stageExitTime<=0) completeStage();
    return;
  }
  if(state!=='playing') return;
  runTime+=dt;
  updateEnemies(dt);
  updatePlayer(dt);
  if(state!=='playing') return;
  updateItems(dt);
  updateCompanion(dt);
  updateMusic(dt);
  hudClock+=dt;
  if(hudClock>.1) {hudClock=0;updateHUD();}
}

function updateHUD() {
  if (!player || !level) return;
  $('progressFill').style.width=`${clamp(player.x/(level.length-205)*100,0,100)}%`;
  // DOM strings and inline SVG are refreshed only when inventory changes,
  // rather than rebuilding all icons at the 120 Hz physics rate.
  const key=[stageIndex,stats.coins,player.health,player.weapon,player.ammo,!!companion,catLives].join('|');
  if (key===lastHudKey) return;
  lastHudKey=key;
  $('stageNum').textContent=String(stageIndex+1).padStart(2,'0');
  $('stageName').textContent=STAGES[stageIndex].name;
  $('stageTotal').textContent=`/ ${STAGES.length}`;
  $('coinCount').textContent=String(stats.coins);
  const heartPath='M1 4h2V2h4v2h2V2h4v2h2v6h-2v2h-2v2H9v2H7v-2H5v-2H3v-2H1Z';
  $('hearts').innerHTML=Array.from({length:MAX_HEALTH},(_,i)=>`<svg viewBox="0 0 16 18" aria-hidden="true" class="${i<player.health?'':'empty'}"><path d="${heartPath}"/></svg>`).join('');
  $('hearts').setAttribute('aria-label',`Zdrowie: ${player.health} z ${MAX_HEALTH}`);
  const weapon=WEAPONS[player.weapon];
  const available=!!weapon && (player.weapon!=='bow' || player.ammo>0);
  $('weaponHud').classList.toggle('locked',!weapon);
  $('weaponHud').classList.toggle('empty-ammo',player.weapon==='bow' && !player.ammo);
  const label=weapon?`${weapon.label}${player.weapon==='bow'?' — '+player.ammo+' strzał':''}`:'Brak broni — zdobądź znajdźkę';
  $('weaponHud').setAttribute('aria-label',label);
  $('weaponHud').title=label;
  $('weaponName').textContent=weapon?weapon.short:'BROŃ';
  $('weaponAmmo').textContent=weapon?(player.weapon==='bow'?String(player.ammo):'∞'):'—';
  $('weaponIcon').innerHTML=WEAPON_ICONS[player.weapon || 'none'];
  $('weaponHud').style.color=weapon?.color || '#d9e1bf';
  $('shootTouch').classList.toggle('unavailable',!available);
  $('shootTouch').setAttribute('aria-label',weapon?'Atak: '+weapon.label:'Atak — najpierw zdobądź broń');
  $('attackTouchIcon').innerHTML=WEAPON_ICONS[player.weapon || 'sword'];
  $('catHud').classList.toggle('locked',!companion);
  $('catLives').textContent=`×${catLives}`;
  $('catHud').title=catLives===0?'Lucek stracił wszystkie życia — znajdź go ponownie':companion?`Lucek — pozostało ${catLives} żyć`:`Znajdź Lucka — pozostało ${catLives} żyć`;
  $('catHud').setAttribute('aria-label',$('catHud').title);
}

// ========================================================================
// Pixel-art renderer
// The sprites, terrain, foliage and background layers are drawn by code.
// No downloaded art, font, texture, audio file or network request is needed.
// ========================================================================
function rect(g,x,y,w,h,color) {
  g.fillStyle=color;
  g.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));
}
function polygon(g,points,color) {
  g.fillStyle=color;
  g.beginPath();
  points.forEach(([x,y],i)=>i?g.lineTo(Math.round(x),Math.round(y)):g.moveTo(Math.round(x),Math.round(y)));
  g.closePath();g.fill();
}

// Rounded silhouettes with squared corners preserve a low-resolution,
// handcrafted look without relying on raster images.
function pixelBlob(g,x,y,w,h,color) {
  const step=Math.max(3,Math.round(Math.min(w,h)*.17));
  rect(g,x+step,y,w-step*2,h,color);
  rect(g,x,y+step,w,h-step*2,color);
  rect(g,x+step*.45,y+step*.45,w-step*.9,h-step*.9,color);
}

function drawCloud(g,x,y,scale,alpha=1) {
  g.save();g.globalAlpha=alpha;
  const c=level.night?'#b4c3b3':'#f1f0d8';
  const shade=level.night?'#9eafaa':'#dce5d2';
  pixelBlob(g,x,y+16*scale,98*scale,24*scale,shade);
  pixelBlob(g,x+7*scale,y+11*scale,95*scale,24*scale,c);
  pixelBlob(g,x+24*scale,y-4*scale,35*scale,37*scale,c);
  pixelBlob(g,x+48*scale,y+3*scale,33*scale,30*scale,c);
  g.restore();
}

function tree(g,x,base,height,spread,colors,random) {
  const [trunk,dark,light]=colors;
  const tx=Math.round(x);
  const top=base-height;
  const trunkWidth=Math.max(5,Math.round(height*.064));
  polygon(g,[[tx-trunkWidth,base],[tx-trunkWidth*.6,top+height*.24],[tx+trunkWidth*.6,top+height*.24],[tx+trunkWidth,base]],trunk);
  rect(g,tx-trunkWidth*.2,top+height*.35,trunkWidth*.36,height*.6,light);
  polygon(g,[[tx,base-height*.35],[tx-spread*.3,base-height*.62],[tx-spread*.24,base-height*.65],[tx+trunkWidth,base-height*.43]],trunk);
  polygon(g,[[tx,base-height*.43],[tx+spread*.33,base-height*.71],[tx+spread*.36,base-height*.65],[tx+trunkWidth*.5,base-height*.32]],trunk);
  for(let i=0;i<7;i++) {
    const angle=i/7*Math.PI*2;
    const px=x+Math.cos(angle)*spread*.31;
    const py=top+height*.22+Math.sin(angle)*height*.13;
    const width=spread*(.52+random()*.15);
    const hh=height*(.25+random()*.08);
    pixelBlob(g,px-width/2,py-hh/2,width,hh,dark);
    pixelBlob(g,px-width*.43,py-hh*.48,width*.76,hh*.67,light);
  }
  pixelBlob(g,x-spread*.33,top,spread*.66,height*.24,light);
}

function makeLayer(kind) {
  const layer=document.createElement('canvas');
  layer.width=1920;layer.height=WORLD_HEIGHT;
  const g=layer.getContext('2d');
  const p=level.palette;
  const random=seeded(level.seed+kind*319);
  if(kind===0) {
    // Quiet stepped hills, with an occasional ruined tower on the horizon.
    for(let k=0;k<2;k++) {
      const points=[[0,540]];
      for(let x=-80;x<=2040;x+=40) {
        const y=245+k*30+Math.sin(x*.0048+k*1.7)*39+Math.sin(x*.011+1)*16;
        points.push([x,y],[x+22,y]);
      }
      points.push([2040,540]);polygon(g,points,k?p.mountain:p.far);
    }
    rect(g,1370,219,36,75,p.far);
    rect(g,1366,213,44,9,p.far);
    for(let i=0;i<4;i++) rect(g,1367+i*11,205,6,12,p.far);
    rect(g,1382,236,9,17,p.mountain);
    for(let x=20;x<1940;x+=42+random()*45) {
      const h=38+random()*78;
      polygon(g,[[x-24,320],[x-18,290],[x-28,290],[x-12,265],[x-19,265],[x,320-h],[x+20,265],[x+12,265],[x+28,290],[x+18,290],[x+27,320]],p.mountain);
    }
  } else if(kind===1) {
    for(let x=0;x<2000;x+=85+random()*70) {
      const h=105+random()*130;
      tree(g,x,408,h,90+random()*70,[p.mid,p.mid,p.mid],random);
    }
    for(let x=-10;x<1990;x+=38) pixelBlob(g,x,362+random()*25,72,70,p.mid);
  } else {
    const locations=[180,765,1260,1780];
    for(const x of locations) {
      const h=170+random()*65;
      tree(g,x,429,h,155+random()*45,[p.tree,p.tree,p.leaf],random);
      // Small patches of bark and ground roots make the near layer tactile.
      for(let i=0;i<7;i++) rect(g,x-5+random()*10,340+i*11,3,7,p.tree);
    }
    for(let x=-30;x<1970;x+=70) {
      const h=26+random()*25;
      pixelBlob(g,x,428-h,88,h,p.tree);
      pixelBlob(g,x+8,431-h,65,h*.5,p.leaf);
    }
  }
  return layer;
}

function ensureBackground() {
  const key=`${stageIndex}`;
  if(bgCache && bgCacheKey===key) return;
  bgCache=[makeLayer(0),makeLayer(1),makeLayer(2)];
  bgCacheKey=key;
}

function drawBackground() {
  const p=level.palette;
  const gradient=ctx.createLinearGradient(0,0,0,450);
  gradient.addColorStop(0,p.top);gradient.addColorStop(1,p.sky);
  ctx.fillStyle=gradient;ctx.fillRect(0,0,viewWidth,WORLD_HEIGHT);

  // The sun/moon belongs to the sky, so it drifts only a little with camera.
  const sunX=viewWidth*.73-camera*.012;
  ctx.globalAlpha=.13;
  pixelBlob(ctx,sunX-57,53,114,114,p.sun);
  ctx.globalAlpha=.3;pixelBlob(ctx,sunX-44,66,88,88,p.sun);
  ctx.globalAlpha=1;pixelBlob(ctx,sunX-34,76,68,68,p.sun);
  if(level.night) pixelBlob(ctx,sunX-17,72,56,52,p.top);
  for(let i=0;i<7;i++) {
    let x=(i*257+65-camera*.06+worldTime*(REDUCED_MOTION?0:1.5))%(viewWidth+320);
    if(x<0)x+=viewWidth+320;
    drawCloud(ctx,x-130,76+(i%3)*38,.68+(i%3)*.19,level.night?.2:.7);
  }
  ensureBackground();
  const factors=[.13,.29,.46];
  bgCache.forEach((layer,i)=>{
    const offset=(camera*factors[i])%layer.width;
    ctx.globalAlpha=i===2?.75:1;
    for(let x=-offset;x<viewWidth;x+=layer.width) ctx.drawImage(layer,Math.round(x),0);
  });
  ctx.globalAlpha=1;

  // Light shafts are deliberately subtle. Reduced-motion mode freezes
  // ambient movement and disables impact shake, not gameplay mechanics.
  if(!level.night) {
    ctx.globalAlpha=.035;
    polygon(ctx,[[sunX-15,120],[sunX+10,120],[sunX+310,430],[sunX+140,430]],'#fffbd1');
    polygon(ctx,[[sunX-25,120],[sunX-13,120],[sunX+45,430],[sunX-60,430]],'#fffbd1');
    ctx.globalAlpha=1;
  }
  const ambientTime=REDUCED_MOTION?0:worldTime;
  for(let i=0;i<20;i++) {
    let x=(i*113.7+Math.sin(ambientTime*.27+i)*23-camera*.63)%(viewWidth+100);
    if(x<0)x+=viewWidth+100;
    const y=190+(i*41)%205+Math.sin(ambientTime*.55+i*1.4)*11;
    if(level.night) {
      const a=.4+.4*Math.sin(ambientTime*1.5+i);
      ctx.globalAlpha=a*.13;pixelBlob(ctx,x-5,y-5,13,13,p.glow);
      ctx.globalAlpha=a;rect(ctx,x,y,3,3,p.glow);
    } else {
      ctx.globalAlpha=.36;
      rect(ctx,x,y,3+(i%2)*2,2,i%3?'#e3e6b1':'#f8e4a2');
    }
  }
  ctx.globalAlpha=1;
  if(!level.night) {
    ctx.strokeStyle=p.tree;ctx.globalAlpha=.32;ctx.lineWidth=1.4;
    for(let i=0;i<3;i++) {
      const x=viewWidth*.47+i*15-camera*.025;
      const y=149+i%2*8;
      ctx.beginPath();ctx.moveTo(x-4,y);ctx.lineTo(x,y+2);ctx.lineTo(x+4,y);ctx.stroke();
    }
    ctx.globalAlpha=1;
  }
}

function drawFern(x,y,size=1,color=level.palette.grass) {
  const s=size;
  rect(ctx,x,y-23*s,2*s,24*s,color);
  for(let i=0;i<4;i++) {
    const reach=(11-i*1.8)*s;
    const yy=y-(6+i*5)*s;
    polygon(ctx,[[x,yy+3*s],[x-reach,yy-4*s],[x-reach-3*s,yy-10*s],[x-3*s,yy-4*s]],color);
    polygon(ctx,[[x+1,yy+3*s],[x+reach,yy-4*s],[x+reach+3*s,yy-9*s],[x+3*s,yy-4*s]],color);
  }
}

function drawTerrain(solid) {
  const p=level.palette;
  const x=solid.x-camera;
  if(x+solid.w<-20 || x>viewWidth+20) return;
  const y=solid.y;
  const platform=solid.type==='platform';
  // Clip terrain details so that dirt and roots never create fake ledges
  // over the collision holes at the sides of each ground rectangle.
  ctx.save();ctx.beginPath();ctx.rect(x,y,solid.w,solid.h);ctx.clip();
  rect(ctx,x,y,solid.w,solid.h,p.earthDark);
  rect(ctx,x+3,y+7,solid.w-6,solid.h-7,p.earth);
  const random=seeded(Math.round(solid.x*3+solid.y)+level.seed);
  const startColumn=Math.max(0,Math.floor((camera-solid.x-48)/40));
  // Consume no global RNG here: each soil cell gets its own stable seed.
  for(let row=0;row<(platform?1:4);row++) {
    for(let col=startColumn;col<Math.min(solid.w/40+1,startColumn+viewWidth/40+3);col++) {
      const r=seeded(col*199+row*877+Math.round(solid.x));
      const xx=x+col*40+(row%2)*15;
      const yy=y+21+row*34;
      const ww=16+r()*17;
      const hh=9+r()*13;
      pixelBlob(ctx,xx,yy,ww,hh,r()>.55?p.earthDark:'#92704d');
      rect(ctx,xx+4,yy+2,ww-8,2,'#b796653b');
      if(r()>.65) rect(ctx,xx+23,yy+20,4,3,p.earthDark);
    }
  }
  rect(ctx,x,y,solid.w,5,p.grassTop);
  rect(ctx,x,y+5,solid.w,8,p.grass);
  rect(ctx,x,y+13,solid.w,4,'#4d754c');
  for(let i=0;i<solid.w;i+=13) {
    const r=seeded(i+Math.round(solid.x)*31);
    const drop=3+r()*9;
    rect(ctx,x+i,y+11,5,drop,p.grass);
    if(i%39===0) rect(ctx,x+i+1,y+1,5,2,'#e0e3a1');
  }
  if(!platform) {
    rect(ctx,x,y+17,4,solid.h-17,p.earthDark);
    rect(ctx,x+solid.w-4,y+17,4,solid.h-17,p.earthDark);
    for(let i=0;i<solid.w;i+=143) {
      const xx=x+i+32;
      rect(ctx,xx,y+16,3,15,'#b28c58');rect(ctx,xx+3,y+28,6,3,'#b28c58');rect(ctx,xx+7,y+29,2,12,'#b28c58');
    }
  }
  ctx.restore();
  if(platform) {
    for(let i=0;i<solid.w;i+=36) {
      const length=9+random()*16;
      rect(ctx,x+i+10,y+solid.h,3,length,p.tree);
      rect(ctx,x+i+7,y+solid.h+4,5,4,p.grass);
    }
  } else {
    // Ground-level flowers are sparse so that gameplay objects stand out.
    for(let i=26;i<solid.w-15;i+=73) {
      const xx=x+i;
      if(xx<-25||xx>viewWidth+25)continue;
      const r=seeded(Math.round(solid.x+i)*17+level.seed);
      rect(ctx,xx,y-7-r()*5,2,10,p.tree);
      polygon(ctx,[[xx,y-1],[xx-6,y-6],[xx-4,y-7],[xx+1,y-3]],p.grass);
      if(r()>.47) {
        const color=r()>.5?'#efd694':'#e6aa89';
        rect(ctx,xx-2,y-12,6,3,color);rect(ctx,xx,y-14,2,7,color);rect(ctx,xx,y-12,2,2,'#fff4c1');
      }
    }
  }
}

function drawHazard(hazard) {
  const x=Math.round(hazard.x-camera);
  if (x+hazard.w<0 || x>viewWidth) return;
  const y=hazard.y;
  if (hazard.kind==='spikes') {
    rect(ctx,x,y+16,40,4,'#576e67');
    for(let i=0;i<4;i++) {
      polygon(ctx,[[x+i*10,y+18],[x+i*10+5,y],[x+i*10+10,y+18]],'#dbe7d0');
      rect(ctx,x+i*10+4,y+7,2,7,'#f8f4db');
    }
  } else if (hazard.kind==='cactus') {
    rect(ctx,x+10,y+5,11,33,'#315f4a');
    rect(ctx,x+13,y+3,6,30,'#61966a');
    rect(ctx,x+3,y+16,8,6,'#315f4a');
    rect(ctx,x+3,y+10,5,9,'#61966a');
    rect(ctx,x+20,y+21,7,6,'#315f4a');
    rect(ctx,x+24,y+12,5,13,'#61966a');
    for(const [dx,dy] of [[11,9],[20,8],[8,19],[25,19],[11,28],[20,29]]) rect(ctx,x+dx,y+dy,3,3,'#e8d49a');
  } else {
    rect(ctx,x,y+24,32,5,'#7b503b');
    for(let i=0;i<3;i++) {
      const sway=REDUCED_MOTION?0:Math.round(Math.sin(worldTime*9+i*2)*3);
      polygon(ctx,[[x+i*10,y+25],[x+i*10+5+sway,y-2-i%2*5],[x+i*10+11,y+25]],'#ef8654');
      polygon(ctx,[[x+i*10+3,y+24],[x+i*10+5+sway,y+10],[x+i*10+8,y+24]],'#f9d17a');
    }
  }
}

function drawBlock(block) {
  if(block.broken) return;
  const x=Math.round(block.x-camera);
  if(x<-TILE||x>viewWidth+TILE)return;
  const bump=block.bump>0?Math.sin(block.bump/.2*Math.PI)*6:0;
  const y=Math.round(block.y-bump);
  if(block.content==='brick') {
    rect(ctx,x,y,40,40,'#674d3e');
    rect(ctx,x+2,y+2,36,35,'#b78352');
    rect(ctx,x+3,y+3,34,3,'#e2b477');
    rect(ctx,x+3,y+19,34,3,'#75543f');
    rect(ctx,x+19,y+3,3,16,'#75543f');
    rect(ctx,x+9,y+22,3,15,'#75543f');
    rect(ctx,x+29,y+22,3,15,'#75543f');
    rect(ctx,x+3,y+23,6,2,'#dca773');
    rect(ctx,x+13,y+23,15,2,'#dca773');
    rect(ctx,x+23,y+6,9,3,'#c8955d');
    rect(ctx,x+4,y+10,8,3,'#c8955d');
  } else if(block.used) {
    rect(ctx,x,y,40,40,'#5c6754');
    rect(ctx,x+2,y+2,36,36,'#8b9070');
    rect(ctx,x+4,y+4,32,3,'#b6b78c');
    rect(ctx,x+4,y+32,32,4,'#727d5e');
    rect(ctx,x+6,y+9,3,3,'#a5aa83');rect(ctx,x+31,y+28,3,3,'#566a53');
  } else {
    const special=!!WEAPONS[block.content] || block.content==='cat' || block.content==='ammo';
    rect(ctx,x,y,40,40,'#866332');
    rect(ctx,x+2,y+2,36,36,'#d59b43');
    rect(ctx,x+4,y+4,32,29,'#efc364');
    rect(ctx,x+4,y+4,32,4,'#ffe5a0');
    rect(ctx,x+4,y+8,3,23,'#f8d786');
    rect(ctx,x+4,y+33,32,3,'#b7863b');
    for(const [dx,dy] of [[5,5],[32,5],[5,32],[32,32]]) rect(ctx,x+dx,y+dy,3,3,'#a57836');
    // A hand-pixelled question mark is independent of installed fonts.
    const mark=['01110','11011','00011','00110','01100','00000','01100'];
    for(let row=0;row<mark.length;row++)for(let col=0;col<5;col++)if(mark[row][col]==='1') {
      rect(ctx,x+12+col*3,y+9+row*3,3,3,'#8f642e');
      rect(ctx,x+11+col*3,y+8+row*3,3,3,'#fff0ba');
    }
    if(special) {
      rect(ctx,x+11,y+34,18,2,WEAPONS[block.content]?.color || (block.content==='cat'?'#35443d':'#e5dfbd'));
      const glint=REDUCED_MOTION?1:Math.sin(worldTime*4)*.3+.7;
      ctx.globalAlpha=glint;
      drawSpark(x+36,y-7,4,WEAPONS[block.content]?.color || '#fff3bf');
      ctx.globalAlpha=1;
    }
  }
}

function drawSpark(x,y,size,color) {
  rect(ctx,x-size,y-1,size*2+1,2,color);
  rect(ctx,x-1,y-size,2,size*2+1,color);
}

function drawCoin(x,y,phase=0,scale=1) {
  const pulse=REDUCED_MOTION?1:Math.abs(Math.cos(worldTime*2.7+phase));
  const width=(5+pulse*10)*scale;
  const xx=Math.round(x+8*scale-width/2);
  pixelBlob(ctx,xx,y,width,22*scale,'#bb8537');
  pixelBlob(ctx,xx+scale,y+scale,width-2*scale,18*scale,'#f2ca60');
  rect(ctx,xx+2*scale,y+4*scale,Math.max(2,width*.25),11*scale,'#ffedaf');
  if(width>9*scale)rect(ctx,xx+width*.58,y+5*scale,2*scale,10*scale,'#d8a046');
  rect(ctx,xx+3*scale,y+19*scale,Math.max(2,width-6*scale),2*scale,'#956d37');
}

function drawBow(x,y,scale=1,drawArrow=false) {
  ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.scale(scale,scale);
  ctx.lineCap='square';ctx.lineJoin='miter';
  ctx.strokeStyle='#5b422c';ctx.lineWidth=4;
  ctx.beginPath();ctx.moveTo(1,-15);ctx.quadraticCurveTo(23,0,1,15);ctx.stroke();
  ctx.strokeStyle='#e7c16f';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(1,-15);ctx.quadraticCurveTo(21,0,1,15);ctx.stroke();
  ctx.strokeStyle='#ece7bc';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(1,-15);ctx.lineTo(drawArrow?-4:1,0);ctx.lineTo(1,15);ctx.stroke();
  rect(ctx,11,-3,4,6,'#86583b');
  if(drawArrow) {
    rect(ctx,-7,-1,27,2,'#f8e9b4');
    polygon(ctx,[[20,-4],[26,0],[20,4]],'#d7e4c8');
    rect(ctx,-7,-3,4,2,'#e4b580');rect(ctx,-7,1,4,2,'#e4b580');
  }
  ctx.restore();
}

// ========================================================================
// New pixel-art equipment and companion sprites, authored locally.
// Shared drawing helpers keep pickup icons and held weapons consistent.
// ========================================================================
function drawSword(x,y,scale=1,angle=.55) {
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.rotate(angle);
  polygon(ctx,[[-4,-24],[0,-32],[4,-24],[4,-2],[-4,-2]],'#344b47');
  polygon(ctx,[[-2,-23],[0,-28],[2,-23],[2,-2],[-2,-2]],'#dceae7');
  rect(ctx,-2,-22,2,20,'#ffffff');rect(ctx,0,-21,2,19,'#94b2b4');
  rect(ctx,-8,-3,16,4,'#8a6a3d');rect(ctx,-7,-3,14,2,'#f5d894');
  rect(ctx,-2,1,4,9,'#7c513b');rect(ctx,-3,8,6,4,'#e8c272');
  ctx.restore();
}

function drawFlame(x,y,scale=1) {
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
  polygon(ctx,[[0,-16],[6,-5],[10,-9],[15,2],[14,11],[8,16],[-3,15],[-10,9],[-11,1],[-7,-8],[-5,0]],'#915047');
  polygon(ctx,[[0,-15],[4,-4],[9,-6],[12,3],[10,11],[5,14],[-3,12],[-8,7],[-7,-3],[-3,3]],'#f99c5b');
  polygon(ctx,[[1,-4],[7,5],[5,11],[-2,11],[-4,6]],'#fbe39a');
  rect(ctx,-1,5,4,5,'#fff8c9');
  ctx.restore();
}

function drawIce(x,y,scale=1) {
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
  ctx.lineWidth=3;ctx.strokeStyle='#548697';
  for(let i=0;i<3;i++) {
    ctx.save();ctx.rotate(i*Math.PI/3);
    ctx.beginPath();ctx.moveTo(0,-14);ctx.lineTo(0,14);ctx.stroke();ctx.restore();
  }
  ctx.lineWidth=1.5;ctx.strokeStyle='#d7f5ff';
  for(let i=0;i<6;i++) {
    ctx.save();ctx.rotate(i*Math.PI/3);
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-14);ctx.moveTo(-4,-10);ctx.lineTo(0,-6);ctx.lineTo(4,-10);ctx.stroke();ctx.restore();
  }
  rect(ctx,-3,-3,6,6,'#a8e9ef');rect(ctx,-1,-2,2,3,'#fffef4');
  ctx.restore();
}

function drawQuiver(x,y,scale=1) {
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
  for(let i=0;i<3;i++) {
    const xx=-6+i*6;
    rect(ctx,xx,-15-(i%2)*3,2,22,'#ecd8a0');
    polygon(ctx,[[xx-3,-15-(i%2)*3],[xx+1,-20-(i%2)*3],[xx+4,-15-(i%2)*3]],'#d8e4d1');
  }
  pixelBlob(ctx,-10,-1,23,20,'#503f32');
  rect(ctx,-8,1,19,16,'#967049');rect(ctx,-8,1,19,3,'#e5c477');
  rect(ctx,-5,6,3,9,'#c39a5d');rect(ctx,5,4,4,13,'#775133');
  ctx.restore();
}

function drawCatShape(x,y,scale=1,facing=1,walk=0,inAir=false) {
  ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.scale(scale*facing,scale);
  const stride=Math.sin(walk*2);
  const bob=inAir?0:Math.abs(stride)>.65?-1:0;
  const fur='#20252c',shade='#131c23',light='#444950';
  // The high, curved tail and triangular ears read as a cat at tiny sizes.
  rect(ctx,-18,-18+bob,4,11,shade);rect(ctx,-21,-24+bob,4,9,shade);
  rect(ctx,-19,-26+bob,6,4,fur);rect(ctx,-18,-22+bob,2,8,light);
  pixelBlob(ctx,-16,-15+bob,25,13,shade);
  pixelBlob(ctx,-14,-15+bob,22,10,fur);rect(ctx,-10,-14+bob,12,2,light);
  const rear=inAir?-3:Math.round(stride*2);
  const front=inAir?3:-Math.round(stride*2);
  rect(ctx,-13+rear,-5,5,6,shade);rect(ctx,-14+rear,0,7,2,shade);
  rect(ctx,3+front,-5,5,6,shade);rect(ctx,3+front,0,7,2,shade);
  rect(ctx,6,-20+bob,12,13,shade);rect(ctx,8,-19+bob,9,10,fur);
  polygon(ctx,[[5,-18+bob],[5,-27+bob],[12,-20+bob]],shade);
  polygon(ctx,[[12,-20+bob],[18,-27+bob],[19,-16+bob]],shade);
  rect(ctx,7,-23+bob,2,4,'#986e79');rect(ctx,15,-23+bob,2,4,'#986e79');
  rect(ctx,9,-17+bob,3,3,'#dfd68c');rect(ctx,15,-17+bob,3,3,'#dfd68c');
  rect(ctx,10,-17+bob,1,3,'#1b2826');rect(ctx,16,-17+bob,1,3,'#1b2826');
  rect(ctx,16,-11+bob,3,2,'#ac9aa2');rect(ctx,18,-12+bob,5,1,'#a3aaa9');
  rect(ctx,8,-8+bob,9,2,'#b8b674');rect(ctx,13,-6+bob,2,3,'#f3db98');
  ctx.restore();
}

function drawCompanion() {
  if (!companion) return;
  const cat=companion;
  if (cat.x<camera-60 || cat.x>camera+viewWidth+60) return;
  const cx=cat.x+cat.w/2-camera;
  if (cat.onGround || cat.leaving) {
    ctx.globalAlpha=.16;pixelBlob(ctx,cx-20,cat.y+cat.h-2,39,6,'#193c30');ctx.globalAlpha=1;
  }
  if (cat.teleportGlow>0) {
    ctx.globalAlpha=cat.teleportGlow*.4;pixelBlob(ctx,cx-25,cat.y-11,50,39,'#d1eac1');ctx.globalAlpha=1;
  }
  drawCatShape(cx,cat.y+cat.h,1.12,cat.facing,cat.walk,!cat.onGround);
  if (cat.pounce>0) drawSpark(cx-18*cat.facing,cat.y+5,3,'#f6e7b2');
}

function drawLoot(item) {
  if (item.life<4 && Math.floor(worldTime*8)%2===0) return;
  const x=item.x-camera;
  if (x<-60 || x>viewWidth+60) return;
  const y=item.y+(REDUCED_MOTION?0:Math.sin(worldTime*5)*2);
  const color=WEAPONS[item.kind]?.color || (item.kind==='cat'?'#f1deb1':'#e7f0b4');
  ctx.globalAlpha=.19;pixelBlob(ctx,x-8,y-7,43,42,color);ctx.globalAlpha=1;
  if (item.kind==='bow') drawBow(x+5,y+14,1.1,true);
  else if (item.kind==='fire') drawFlame(x+12,y+13,.93);
  else if (item.kind==='sword') drawSword(x+12,y+24,.9,.6);
  else if (item.kind==='ice') drawIce(x+12,y+13,1);
  else if (item.kind==='ammo') drawQuiver(x+12,y+14,.82);
  else if (item.kind==='cat') drawCatShape(x+12,y+24,.83,1,0,false);
  else if (item.kind==='heart') {
    const rows=['0110110','1111111','1111111','0111110','0011100','0001000'];
    rows.forEach((row,yy)=>[...row].forEach((v,xx)=>{if(v==='1')rect(ctx,x+xx*3,y+yy*3,3,3,yy<2?'#fac2a0':'#ee957e');}));
    rect(ctx,x+5,y+3,3,3,'#fff0cf');
  } else if (item.kind==='shield') {
    polygon(ctx,[[x+12,y],[x+25,y+6],[x+21,y+20],[x+12,y+28],[x+3,y+20],[x,y+6]],'#cde7aa');
    polygon(ctx,[[x+12,y+4],[x+20,y+8],[x+17,y+18],[x+12,y+23],[x+6,y+18],[x+4,y+8]],'#6ea67e');
    drawSpark(x+12,y+12,5,'#e7efb5');
  } else {
    polygon(ctx,[[x+6,y],[x+20,y],[x+27,y+9],[x+13,y+26],[x,y+9]],'#436b64');
    polygon(ctx,[[x+7,y+2],[x+19,y+2],[x+23,y+9],[x+13,y+22],[x+3,y+9]],'#b7e1b3');
    polygon(ctx,[[x+7,y+2],[x+13,y+2],[x+10,y+10],[x+3,y+9]],'#edf2c5');
    polygon(ctx,[[x+10,y+10],[x+23,y+9],[x+13,y+22]],'#71b59c');
  }
  if (WEAPONS[item.kind] || item.kind==='cat' || item.kind==='ammo') {
    const caption=item.kind==='cat'?'LUCEK':item.kind==='ammo'?'+8 STRZAŁ':WEAPONS[item.kind].short;
    ctx.font='bold 8px monospace';ctx.textAlign='center';
    ctx.fillStyle='#1d3932';ctx.fillText(caption,x+13,y-12);
    ctx.fillStyle='#fff2ce';ctx.fillText(caption,x+12,y-13);
  }
  if (!REDUCED_MOTION && Math.sin(worldTime*6+item.x)>.5) drawSpark(x-3,y-5,3,'#fff1bc');
}

function drawFireball(shot) {
  const x=shot.x-camera+7,y=shot.y+7;
  const direction=shot.vx>0?1:-1;
  ctx.save();ctx.translate(x,y);ctx.scale(direction,1);
  ctx.globalAlpha=.23;pixelBlob(ctx,-14,-13,31,27,'#ffc483');ctx.globalAlpha=1;
  polygon(ctx,[[-8,-5],[-23,-9],[-18,-1],[-28,3],[-12,4],[-17,9],[-5,7]],'#f4c074');
  pixelBlob(ctx,-7,-7,15,15,'#d66e42');pixelBlob(ctx,-5,-5,12,11,'#ffa962');
  pixelBlob(ctx,-2,-4,7,8,'#ffedb4');rect(ctx,1,-3,3,4,'#fff9db');
  ctx.restore();
}

function drawAttack(attack) {
  const origin=attackOrigin(attack);
  const progress=attack.age/attack.duration;
  ctx.save();ctx.translate(origin.x-camera,origin.y);ctx.scale(attack.direction,1);
  if (attack.kind==='sword') {
    // The visible slash covers the same reach as the melee collider.
    ctx.globalAlpha=Math.max(.15,1-progress);
    ctx.strokeStyle='#ffefb9';ctx.lineWidth=9;
    ctx.beginPath();ctx.arc(0,0,60,-1.2+progress*.5,.65+progress*.65);ctx.stroke();
    ctx.strokeStyle='#ffffe6';ctx.lineWidth=3;
    ctx.beginPath();ctx.arc(0,0,67,-1.15+progress*.5,.6+progress*.65);ctx.stroke();
  } else {
    const reach=150;
    ctx.globalAlpha=.15*(1-progress);
    polygon(ctx,[[0,-6],[reach,-55],[reach+6,0],[reach,55],[0,6]],'#d2f8ff');
    for(let i=0;i<17;i++) {
      const t=(progress+i*.063)%1;
      const xx=6+t*reach;
      const yy=Math.sin(i*3.1+progress*5)*(8+t*43);
      ctx.globalAlpha=(1-progress)*(.3+t*.65);
      if(i%4===0) drawIce(xx,yy,.15+t*.15);
      else rect(ctx,xx,yy,3+t*2,2,'#daf6ff');
    }
  }
  ctx.restore();
}

function drawWeather() {
  if (!level.weather) return;
  const t=REDUCED_MOTION?0:worldTime;
  const weather=level.weather;
  // Ambient particles stay behind the interactive layer and use predictable
  // positions, making the background stable and inexpensive to redraw.
  const count=weather==='rain'?52:weather==='snow'?40:24;
  ctx.save();
  for(let i=0;i<count;i++) {
    const wind=weather==='rain'?t*90:Math.sin(t*.7+i)*20;
    let x=(i*137.31+wind-camera*.38)%(viewWidth+80);
    if (x<0) x+=viewWidth+80;
    const y=(i*89.17+t*(weather==='rain'?245:weather==='snow'?24:weather==='embers'?-18:12)+5400)%440;
    if (weather==='rain') {
      ctx.globalAlpha=.2;ctx.strokeStyle='#deeee4';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-5,y+12);ctx.stroke();
    } else if (weather==='snow') {
      ctx.globalAlpha=.35+(i%3)*.15;rect(ctx,x,y,2+i%3,2+i%3,'#f3f6ed');
    } else if (weather==='petals' || weather==='leaves') {
      ctx.globalAlpha=.55;rect(ctx,x,y,5,3,weather==='petals'?'#f7d1cb':'#e7b778');
      rect(ctx,x+2,y-1,3,2,weather==='petals'?'#ffe7d5':'#f4ca90');
    } else if (weather==='embers') {
      ctx.globalAlpha=.3+Math.sin(t*2+i)*.18;drawSpark(x,y,2,'#f4c18d');
    } else {
      ctx.globalAlpha=.25+Math.sin(t+i)*.18;drawSpark(x,y,2,level.palette.glow);
    }
  }
  ctx.restore();
}

function drawEnemy(enemy) {
  if(!enemy.alive && enemy.squash<=0)return;
  const x=Math.round(enemy.x-camera-4);
  if(x<-50||x>viewWidth+50)return;
  const y=Math.round(enemy.y);
  ctx.save();ctx.translate(x,y+enemy.h);
  if(!enemy.alive)ctx.scale(1,.28);
  ctx.translate(0,-enemy.h);
  const bob=enemy.alive?Math.round(Math.sin(enemy.phase)*1):0;
  const leg=Math.sin(enemy.phase)>0?1:0;
  rect(ctx,5,25,28,4,'#243d353b');
  if(enemy.kind==='mushroom') {
    rect(ctx,8,20,9,7+leg,'#3b4c34');rect(ctx,24,20,9,8-leg,'#3b4c34');
    pixelBlob(ctx,9,9+bob,24,15,'#ddd7a7');
    rect(ctx,12,13+bob,17,9,'#f2e5b6');
    pixelBlob(ctx,2,4+bob,36,13,'#783e36');
    pixelBlob(ctx,5,0+bob,30,13,'#c87555');
    rect(ctx,10,1+bob,18,3,'#e5a274');
    rect(ctx,8,6+bob,6,4,'#f4dbaf');rect(ctx,22,3+bob,7,4,'#f4dbaf');rect(ctx,27,10+bob,5,3,'#f4dbaf');
    rect(ctx,15,17+bob,3,5,'#343f33');rect(ctx,26,17+bob,3,5,'#343f33');
    rect(ctx,16,17+bob,1,1,'#fff2c1');rect(ctx,27,17+bob,1,1,'#fff2c1');
  } else {
    for(let i=0;i<3;i++) {
      rect(ctx,6+i*10,22+(i%2===leg?2:0),6,5,'#364f3d');
    }
    pixelBlob(ctx,3,5+bob,33,19,'#345344');
    pixelBlob(ctx,5,3+bob,27,18,'#688850');
    pixelBlob(ctx,8,2+bob,18,8,'#a3b370');
    rect(ctx,18,5+bob,2,15,'#496e43');
    rect(ctx,6,14+bob,5,3,'#e0be70');rect(ctx,27,14+bob,5,3,'#e0be70');
    const faceX=enemy.vx<0?1:24;
    rect(ctx,faceX,15+bob,13,8,'#b2bd82');
    rect(ctx,faceX+2,15+bob,3,4,'#263c32');rect(ctx,faceX+9,15+bob,3,4,'#263c32');
    rect(ctx,faceX+1,11+bob,2,5,'#3e5841');rect(ctx,faceX+11,11+bob,2,5,'#3e5841');
  }
  if(enemy.alive && enemy.frozen>0) {
    ctx.globalAlpha=.42;pixelBlob(ctx,0,-2,40,33,'#a7e6f5');ctx.globalAlpha=1;
    ctx.strokeStyle='#d6f5ff';ctx.lineWidth=1.5;ctx.strokeRect(2,-1,35,29);
    polygon(ctx,[[5,0],[10,0],[4,20],[2,20]],'#e2fbff');
    rect(ctx,28,4,2,11,'#e2fbff');
    if(enemy.frozen>1 || Math.floor(worldTime*9)%2===0) drawSpark(31,-4,4,'#e8fcff');
  }
  ctx.restore();
}

function drawHero(hero,preview=false) {
  const x=preview?Math.max(viewWidth*.7,viewWidth-260):hero.x-camera+hero.w/2;
  const bottom=hero.y+hero.h;
  if(hero.invincible>0 && Math.floor(worldTime*14)%2===0 && !preview)return;
  ctx.save();
  // A small shadow anchors the sprite without suggesting a landing surface
  // underneath a real pit.
  if(solidAt(hero.x+hero.w/2,GROUND+2) || preview) {
    ctx.globalAlpha=.18;
    pixelBlob(ctx,x-18,GROUND-3,37,6,'#263e2b');
    ctx.globalAlpha=1;
  }
  if(hero.shield>0 && (hero.shield>2 || Math.floor(worldTime*8)%2===0)) {
    ctx.strokeStyle='#e1f2b8';ctx.lineWidth=2;ctx.globalAlpha=.5;
    ctx.beginPath();ctx.ellipse(x,bottom-28,29+Math.sin(worldTime*5)*2,36,0,0,Math.PI*2);ctx.stroke();
    ctx.globalAlpha=.08;ctx.fillStyle='#d7f4b3';ctx.fill();ctx.globalAlpha=1;
    for(let i=0;i<3;i++)drawSpark(x+Math.cos(worldTime*3+i*2.1)*27,bottom-29+Math.sin(worldTime*3+i*2.1)*31,2,'#e3f7b7');
  }
  const facing=preview?1:hero.facing;
  ctx.translate(Math.round(x),Math.round(bottom-56));
  ctx.scale(2*facing,2);
  ctx.translate(-12,0);
  const moving=hero.onGround && Math.abs(hero.vx)>10 && !preview;
  const stride=moving?Math.sin(hero.walk*2):0;
  const airborne=!hero.onGround&&!preview;
  const bob=moving?Math.abs(stride)>.5?-1:0:Math.sin(worldTime*2.2)>.85?-1:0;
  const frontFoot=airborne?2:Math.round(stride*2);
  const backFoot=airborne?-2:-Math.round(stride*2);
  const r=(x,y,w,h,c)=>rect(ctx,x,y,w,h,c);
  const outline='#2b4737';
  const hairDark='#ac7d32',hair='#e6bc58',hairLight='#ffe296';

  // Long blonde ponytail and loose strands remain visible behind the green
  // tunic, even while the heroine runs or holds her bow out front.
  r(5,3+bob,9,11,outline);
  r(3,5+bob,5,12,outline);
  r(2+(moving?Math.round(stride):0),12+bob,5,8,hairDark);
  r(3,6+bob,4,10,hair);
  r(3,14+bob,3,5,hairLight);
  r(4,5+bob,2,8,hairLight);
  r(3,6+bob,4,2,'#588750');

  // Boots and two independently animated legs.
  r(8+backFoot,19,5,7,outline);
  r(9+backFoot,20,3,5,'#d4bc87');
  r(7+backFoot,25,7,3,outline);
  r(8+backFoot,25,6,2,'#80583b');
  r(13+frontFoot,19,5,7,outline);
  r(14+frontFoot,20,3,5,'#efd2a1');
  r(13+frontFoot,25,8,3,outline);
  r(14+frontFoot,25,6,2,'#9b6840');
  r(14+frontFoot,25,2,1,'#c69957');

  // The skirt silhouette, belt and cream collar make the outfit legible at
  // the game's native resolution rather than just a single green rectangle.
  r(8,12+bob,10,9,outline);
  r(7,19+bob,12,3,outline);
  r(9,13+bob,8,6,'#499254');
  r(9,14+bob,3,4,'#79b56b');
  r(8,19+bob,10,2,'#4c9451');
  r(10,19+bob,2,2,'#90bd6d');
  r(8,17+bob,10,2,'#704c31');
  r(13,17+bob,3,2,'#f5d583');
  r(10,12+bob,5,2,'#eef0c4');
  r(11,14+bob,3,1,'#28543a');

  // Face and blonde fringe are authored facing right. The transform
  // above mirrors the complete sprite, including the ponytail and bow.
  r(8,1+bob,10,11,outline);
  r(9,4+bob,9,7,'#f1cd9d');
  r(10,9+bob,7,3,'#f1cd9d');
  r(17,7+bob,2,3,'#f1cd9d');
  r(8,1+bob,10,4,hairDark);
  r(8,1+bob,9,3,hair);
  r(9,1+bob,7,1,hairLight);
  r(8,4+bob,3,4,hair);
  r(11,3+bob,6,2,hair);
  r(14,4+bob,3,2,hairLight);
  r(15,6+bob,2,3,outline);
  r(15,6+bob,1,1,'#f8f4dd');
  r(14,9+bob,3,1,'#df9b79');
  r(17,10+bob,1,1,'#9e614c');
  r(10,6+bob,1,2,'#edb687');

  // Rear arm swings, while the forward arm aims when firing.
  r(6,13+bob,3,5,outline);r(7,13+bob,2,3,'#65a860');
  r(6+Math.round(stride),17+bob,3,3,'#e9c08d');
  const weapon=preview?'bow':hero.weapon;
  if(weapon) {
    r(17,13+bob,3,3,'#4d9253');
    r(18,15+bob,6,3,'#f1cd9d');
    r(21,15+bob,3,1,'#ffe0ac');
    if(weapon==='bow') {
      // Spare shafts disappear from the quiver when ammunition runs out.
      r(4,13+bob,3,8,'#775338');r(4,12+bob,4,2,'#b99353');
      if(hero.ammo>0 || preview) {
        r(3,9+bob,1,5,'#ddd7b0');r(5,8+bob,1,5,'#ddd7b0');
        r(2,8+bob,2,2,'#9ab98a');r(4,7+bob,2,2,'#9ab98a');
      }
      drawBow(25,16+bob,.7,(hero.ammo>0 && hero.shootPose>0)||preview);
    } else if(weapon==='sword') {
      const angle=hero.shootPose>0?-.2+(1-hero.shootPose/.22)*1.8:.5;
      drawSword(24,17+bob,.74,angle);
    } else if(weapon==='fire') {
      drawFlame(27,13+bob,hero.shootPose>0?.49:.35);
    } else drawIce(28,14+bob,hero.shootPose>0?.49:.38);
  } else {
    r(17,13+bob,3,5,outline);r(17,13+bob,2,3,'#69a861');
    r(17-Math.round(stride),17+bob,3,3,'#f2cc98');
  }
  ctx.restore();
}

function drawMushroomDecoration(x,y,variant=0) {
  const scale=variant?1.2:.75;
  rect(ctx,x-2,y-13*scale,5*scale,14*scale,'#d7cb9c');
  pixelBlob(ctx,x-12*scale,y-20*scale,26*scale,12*scale,level.night?'#a4cbb3':'#d2a774');
  pixelBlob(ctx,x-8*scale,y-23*scale,18*scale,8*scale,level.night?'#cae4c0':'#e6c992');
  rect(ctx,x-5*scale,y-20*scale,4*scale,3*scale,'#f2e4b8');
  rect(ctx,x+5*scale,y-17*scale,3*scale,3*scale,'#f2e4b8');
  if(level.night) {
    ctx.globalAlpha=.1;pixelBlob(ctx,x-23,y-35,48,37,'#c6edb2');ctx.globalAlpha=1;
  }
}

function drawSign(sign) {
  const [worldX,symbol,text]=sign;
  const x=worldX-camera;
  if(x<-150||x>viewWidth+80)return;
  rect(ctx,x+4,GROUND-56,6,57,'#6c6142');
  rect(ctx,x+7,GROUND-56,2,57,'#a99662');
  pixelBlob(ctx,x-27,GROUND-71,72,33,'#5a6044');
  pixelBlob(ctx,x-25,GROUND-70,67,28,'#ac9b68');
  rect(ctx,x-21,GROUND-68,56,2,'#d1bd83');
  ctx.textAlign='center';ctx.fillStyle='#3c5840';ctx.font='bold 24px monospace';ctx.fillText(symbol,x+7,GROUND-47);
  // Small captions are environmental flavor, never the only source of an
  // instruction: keyboard/touch controls are also present in the HTML UI.
  ctx.font='bold 7px monospace';ctx.fillStyle=level.night?'#d8e3bc':'#35583f';
  ctx.fillText(text,x+7,GROUND-79);
  drawFern(x-18,GROUND,.5,level.palette.grass);
}

function drawFlag(flag) {
  const x=Math.round(flag.x-camera);
  if(x<-70||x>viewWidth+70)return;
  const top=GROUND-94;
  rect(ctx,x-3,top,5,95,'#4d5e43');rect(ctx,x-2,top,2,93,'#ede4b2');
  pixelBlob(ctx,x-5,top-6,9,9,'#f5d793');
  const wave=REDUCED_MOTION?0:Math.sin(worldTime*3+flag.x)*3;
  polygon(ctx,[[x+2,top+4],[x+33,top+7+wave],[x+29,top+20+wave],[x+38,top+33+wave],[x+2,top+28]],flag.active?'#e9c674':'#66845b');
  polygon(ctx,[[x+4,top+8],[x+27,top+10+wave],[x+4,top+23]],flag.active?'#ffe2a1':'#9db77b');
  if(flag.active)drawSpark(x+17,top+17,4,'#fff3c5');
  pixelBlob(ctx,x-11,GROUND-8,23,9,'#73816a');
  rect(ctx,x-8,GROUND-8,17,3,'#b9c18d');
  if(!flag.active) {
    ctx.fillStyle=level.night?'#dcebc2':'#e9ebc3';ctx.font='bold 8px monospace';ctx.textAlign='center';
    ctx.fillText('ZAPIS',x+17,top-15);
  }
}

function drawGate() {
  const x=level.length-265-camera;
  if(x>viewWidth+150||x<-150)return;
  const y=GROUND-128;
  const p=level.palette;
  // Warm stone arch and a luminous, leaf-shaped portal form the finish line.
  ctx.globalAlpha=.12;
  pixelBlob(ctx,x-14,y-18,128,158,p.glow);
  ctx.globalAlpha=1;
  pixelBlob(ctx,x+20,y+12,60,116,'#345d51');
  const gateGradient=ctx.createLinearGradient(x,y,x+80,y+130);
  gateGradient.addColorStop(0,'#bdd6a0');gateGradient.addColorStop(.5,'#86ac86');gateGradient.addColorStop(1,'#497b6b');
  ctx.fillStyle=gateGradient;ctx.fillRect(x+27,y+34,46,94);
  pixelBlob(ctx,x+28,y+20,45,30,'#b9d3a2');
  rect(ctx,x+15,y+41,15,87,'#4e6654');rect(ctx,x+73,y+41,15,87,'#4e6654');
  for(let i=0;i<4;i++) {
    rect(ctx,x+10-(i%2)*2,y+36+i*23,20,22,p.stone);
    rect(ctx,x+73,y+36+i*23,20+(i%2)*2,22,p.stone);
    rect(ctx,x+12,y+37+i*23,16,3,'#c5cca3');
    rect(ctx,x+75,y+37+i*23,16,3,'#c5cca3');
  }
  rect(ctx,x+16,y+18,18,21,p.stone);rect(ctx,x+67,y+18,19,21,p.stone);
  rect(ctx,x+29,y+5,45,19,p.stone);rect(ctx,x+24,y+11,56,12,p.stone);
  rect(ctx,x+31,y+5,41,3,'#d0d5ab');
  rect(ctx,x+41,y-1,21,23,'#a7b58d');
  polygon(ctx,[[x+51,y+3],[x+59,y+10],[x+51,y+18],[x+44,y+10]],'#e7d799');
  for(let i=0;i<4;i++) {
    rect(ctx,x+10+i*5,y+41+(i%2)*3,4,10,level.palette.grass);
    rect(ctx,x+77+i*4,y+80+(i%2)*4,4,10,level.palette.grass);
  }
  ctx.globalAlpha=.25;
  for(let i=0;i<4;i++) rect(ctx,x+33+i*9,y+38,2,79,'#d9ecc2');
  ctx.globalAlpha=1;
  const pulse=REDUCED_MOTION?0:Math.sin(worldTime*2)*3;
  polygon(ctx,[[x+52,y+50+pulse],[x+63,y+65+pulse],[x+52,y+87+pulse],[x+41,y+65+pulse]],'#dfedbb');
  polygon(ctx,[[x+52,y+53+pulse],[x+52,y+84+pulse],[x+44,y+65+pulse]],'#91bd8e');
  rect(ctx,x+50,y+68+pulse,2,20,'#eaf1be');
  rect(ctx,x+4,GROUND-5,94,8,'#b9bf94');rect(ctx,x,GROUND+1,102,6,'#74876d');
  ctx.textAlign='center';ctx.font='bold 9px monospace';ctx.fillStyle=level.night?'#e6efc3':'#ecedc7';
  ctx.fillText(stageIndex===STAGES.length-1?'SERCE LASU':'DALEJ W LAS',x+51,y-19);
  drawFern(x-9,GROUND,1,p.grass);drawFern(x+103,GROUND,.7,p.grass);
}

function drawArrow(arrow) {
  const direction=arrow.vx<0?-1:1;
  ctx.save();
  // A left-facing arrow is mirrored within its own world-space collider.
  ctx.translate(arrow.x-camera+(direction<0?arrow.w:0),arrow.y);
  ctx.scale(direction,1);
  const x=0;
  const y=0;
  ctx.globalAlpha=.22;
  rect(ctx,x-20,y+1,19,1,'#f0deb0');
  ctx.globalAlpha=1;
  rect(ctx,x,y+1,23,2,'#e5d2a0');
  rect(ctx,x+3,y,16,1,'#f9f0c8');
  polygon(ctx,[[x+22,y-3],[x+30,y+2],[x+22,y+6]],'#dfeacd');
  polygon(ctx,[[x,y-3],[x+7,y+1],[x+2,y+1]],'#dcc68c');
  polygon(ctx,[[x,y+7],[x+7,y+3],[x+2,y+3]],'#dcc68c');
  ctx.restore();
}

function render() {
  ctx.imageSmoothingEnabled=false;
  ctx.save();
  if(shakeTime>0)ctx.translate(Math.round(Math.sin(worldTime*95)*2),Math.round(Math.cos(worldTime*71)*2));
  drawBackground();
  drawWeather();
  for(const sign of level.signs)drawSign(sign);
  for(const solid of level.solids)if(solid.type!=='block')drawTerrain(solid);
  for(const x of level.mushrooms) {
    const sx=x-camera;
    if(sx>-50&&sx<viewWidth+50) {
      drawMushroomDecoration(sx,GROUND,0);
      drawMushroomDecoration(sx+16,GROUND,1);
      drawFern(sx+35,GROUND,.65,level.palette.tree);
    }
  }
  for(const hazard of level.hazards)drawHazard(hazard);
  drawGate();
  for(const flag of checkpointFlags)drawFlag(flag);
  for(const block of level.blocks)drawBlock(block);
  for(const coin of level.coins) {
    if(!coin.collected && coin.x>camera-30 && coin.x<camera+viewWidth+30)drawCoin(coin.x-camera,coin.y+(REDUCED_MOTION?0:Math.sin(worldTime*3+coin.phase)*2),coin.phase);
  }
  for(const item of loot)if(item.life>0)drawLoot(item);
  for(const enemy of level.enemies)drawEnemy(enemy);
  for(const shot of projectiles)if(shot.kind==='fire')drawFireball(shot);else drawArrow(shot);
  drawCompanion();
  drawHero(player,state==='title');
  for(const attack of attacks)drawAttack(attack);
  for(const particle of particles) {
    ctx.globalAlpha=Math.min(1,particle.life/Math.min(.3,particle.maxLife));
    rect(ctx,particle.x-camera,particle.y,particle.size,particle.size,particle.color);
  }
  ctx.globalAlpha=1;
  for(const text of floatingTexts) {
    ctx.globalAlpha=Math.min(1,text.life*2);
    ctx.textAlign='center';ctx.font='bold 13px monospace';
    ctx.fillStyle='#214b37';ctx.fillText(text.text,text.x-camera+1,text.y+1);
    ctx.fillStyle=text.color;ctx.fillText(text.text,text.x-camera,text.y);
  }
  ctx.globalAlpha=1;
  // The bottom edge gets a subtle vignette, while the collision surface
  // remains crisp and readable above it.
  const shade=ctx.createLinearGradient(0,475,0,540);
  shade.addColorStop(0,'#16362900');shade.addColorStop(1,'#1636293b');
  ctx.fillStyle=shade;ctx.fillRect(0,475,viewWidth,65);
  ctx.restore();
}

// ========================================================================
// Responsive viewport and fixed-timestep loop
// Limiting accumulated time prevents a tab switch or slow device from
// causing a huge physics step. The logical canvas stays sharp on HiDPI.
// ========================================================================
function resize() {
  const bounds=frame.getBoundingClientRect();
  const ratio=bounds.width/Math.max(1,bounds.height);
  viewWidth=Math.round(clamp(WORLD_HEIGHT*ratio,360,1440));
  canvas.width=viewWidth;
  canvas.height=WORLD_HEIGHT;
  ctx.imageSmoothingEnabled=false;
  // Reuse the monotonic follow rule instead of recentering backwards.
  if(player && level) updateCamera();
  render();
}
let lastTimestamp=0;
let accumulator=0;
let manualClock=false;
function loop(timestamp) {
  const dt=lastTimestamp?Math.min((timestamp-lastTimestamp)/1000,.1):0;
  lastTimestamp=timestamp;
  if(!manualClock) {
    accumulator+=dt;
    let steps=0;
    while(accumulator>=FIXED_STEP && steps<12) {update(FIXED_STEP);accumulator-=FIXED_STEP;steps++;}
    if(steps>=12)accumulator=0;
  }
  render();
  requestAnimationFrame(loop);
}

loadStage(0,false);
resize();
if(typeof ResizeObserver!=='undefined')new ResizeObserver(resize).observe(frame);
else window.addEventListener('resize',resize);
requestAnimationFrame(loop);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // The game remains playable if offline caching is unavailable.
    });
  });
}

// An opt-in inspection hook supports deterministic local regression tests.
// Ordinary play exposes no debug API and requires no query parameters.
if(new URLSearchParams(location.search).has('test')) {
  window.__forestTest={
    get state(){return state;},get player(){return player;},get level(){return level;},
    get stages(){return STAGES;},get stats(){return stats;},get loot(){return loot;},
    get projectiles(){return projectiles;},get attacks(){return attacks;},get companion(){return companion;},
    get flags(){return checkpointFlags;},get checkpoint(){return checkpoint;},get camera(){return camera;},get viewWidth(){return viewWidth;},get catLives(){return catLives;},
    start:startRun,load:(index,preserve=false)=>{loadStage(index,preserve);resumeGame();},
    advance(seconds,draw=true){for(let i=0;i<Math.round(seconds/FIXED_STEP);i++)update(FIXED_STEP);if(draw)render();},
    input(control,down){if(control==='jump'&&down&&!touch.jump)jumpBuffer=.14;touch[control]=down;},
    freeze(value=true){manualClock=value;},render,shoot,hitBlock,hurtPlayer,respawn,finishStage,
    collectLoot,spawnLoot,clearControls,updateHUD,updateCompanion,updateItems,updatePlayer,updateProjectiles,updateAttacks,loseCatLife,
    solidAt,moveBody,resumeGame
  };
}
})();
