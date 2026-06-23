import { Application, Assets, AnimatedSprite } from 'pixi.js';

const app = new Application();

await app.init({
  resizeTo: window,
  backgroundAlpha: 0,
  antialias: true,
});

document.body.appendChild(app.canvas);

await Assets.load([
  { alias: 'ready', src: '/assets/knight-ready-spritesheet.json' },
  { alias: 'attack', src: '/assets/knight-attack-spritesheet.json' },
  { alias: 'attack-reverse', src: '/assets/knight-attack-reverse-spritesheet.json' },
  { alias: 'engage', src: '/assets/knight-engage-spritesheet.json' },
  { alias: 'disengage', src: '/assets/knight-disengage-spritesheet.json' },
  { alias: 'spell-cast', src: '/assets/spell-cast-spritesheet.json' },
  { alias: 'skeleton-soldier-ready', src: '/assets/skeleton-soldier-ready-spritesheet.json' },
  { alias: 'skeleton-soldier-attack', src: '/assets/skeleton-soldier-attack-spritesheet.json' },
  { alias: 'skeleton-soldier-engage', src: '/assets/skeleton-soldier-engage-spritesheet.json' },
  { alias: 'skeleton-soldier-disengage', src: '/assets/skeleton-soldier-disengage-spritesheet.json' },
  { alias: 'heavy-attack', src: '/assets/heavy-attack-spritesheet.json' },
  { alias: 'stab', src: '/assets/stab-spritesheet.json' },
  { alias: 'run', src: '/assets/run-spritesheet.json' },
]);

const readySheet = Assets.get('ready');
const attackSheet = Assets.get('attack');
const attackReverseSheet = Assets.get('attack-reverse');
const engageSheet = Assets.get('engage');
const disengageSheet = Assets.get('disengage');
const spellCastSheet = Assets.get('spell-cast');
const skeletonSoldierReadySheet = Assets.get('skeleton-soldier-ready');
const skeletonSoldierAttackSheet = Assets.get('skeleton-soldier-attack');
const skeletonSoldierEngageSheet = Assets.get('skeleton-soldier-engage');
const skeletonSoldierDisengageSheet = Assets.get('skeleton-soldier-disengage');
const heavyAttackSheet = Assets.get('heavy-attack');
const stabSheet = Assets.get('stab');
const runSheet = Assets.get('run');

const animations = [
  { label: 'Ready',             configKey: 'ready',             frames: Object.keys(readySheet.data.frames).map(n => readySheet.textures[n]) },
  { label: 'Attack',            configKey: 'attack',            frames: Object.keys(attackSheet.data.frames).map(n => attackSheet.textures[n]) },
  { label: 'Attack Reverse',    configKey: 'attack-reverse',    frames: Object.keys(attackReverseSheet.data.frames).map(n => attackReverseSheet.textures[n]) },
  { label: 'Engage',            configKey: 'engage',            frames: Object.keys(engageSheet.data.frames).map(n => engageSheet.textures[n]) },
  { label: 'Disengage',         configKey: 'disengage',         frames: Object.keys(disengageSheet.data.frames).map(n => disengageSheet.textures[n]) },
  { label: 'Spell Cast',        configKey: 'spell-cast',        frames: Object.keys(spellCastSheet.data.frames).map(n => spellCastSheet.textures[n]) },
  { label: 'Spell Cast Reverse',configKey: 'spell-cast-reverse',frames: Object.keys(spellCastSheet.data.frames).map(n => spellCastSheet.textures[n]).reverse() },
  { label: 'Skeleton Soldier Ready', configKey: 'skeleton-soldier-ready', frames: Object.keys(skeletonSoldierReadySheet.data.frames).map(n => skeletonSoldierReadySheet.textures[n]) },
  { label: 'Skeleton Soldier Attack', configKey: 'skeleton-soldier-attack', frames: Object.keys(skeletonSoldierAttackSheet.data.frames).map(n => skeletonSoldierAttackSheet.textures[n]) },
  { label: 'Skeleton Soldier Attack Reverse', configKey: 'skeleton-soldier-attack-reverse', frames: Object.keys(skeletonSoldierAttackSheet.data.frames).map(n => skeletonSoldierAttackSheet.textures[n]).reverse() },
  { label: 'Skeleton Soldier Engage', configKey: 'skeleton-soldier-engage', frames: Object.keys(skeletonSoldierEngageSheet.data.frames).map(n => skeletonSoldierEngageSheet.textures[n]) },
  { label: 'Skeleton Soldier Disengage', configKey: 'skeleton-soldier-disengage', frames: Object.keys(skeletonSoldierDisengageSheet.data.frames).map(n => skeletonSoldierDisengageSheet.textures[n]) },
  { label: 'Heavy Attack', configKey: 'heavy-attack', frames: Object.keys(heavyAttackSheet.data.frames).map(n => heavyAttackSheet.textures[n]) },
  { label: 'Stab', configKey: 'stab', frames: Object.keys(stabSheet.data.frames).map(n => stabSheet.textures[n]) },
  { label: 'Run', configKey: 'run', frames: Object.keys(runSheet.data.frames).map(n => runSheet.textures[n]) },
];

// --- Character management ---

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
}

function loadCharacters() {
  try { return JSON.parse(localStorage.getItem('animation-preview:characters') || 'null'); }
  catch { return null; }
}

function saveCharacters(chars) {
  localStorage.setItem('animation-preview:characters', JSON.stringify(chars));
}

let allFileConfigs = {};
try {
  const res = await fetch('/character-configs.json');
  allFileConfigs = await res.json();
} catch { /* fall back to computed defaults */ }

let characters = loadCharacters();
if (!characters) {
  characters = [{ id: 'knight', name: 'Knight' }];
}
// Merge any characters from character-configs.json not yet in the saved list
const existingIds = new Set(characters.map(c => c.id));
Object.keys(allFileConfigs).forEach(id => {
  if (!existingIds.has(id)) {
    const name = id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    characters.push({ id, name });
  }
});
saveCharacters(characters);

let activeCharacterId = localStorage.getItem('animation-preview:active-character');
if (!activeCharacterId || !characters.find(c => c.id === activeCharacterId)) {
  activeCharacterId = characters[0].id;
  localStorage.setItem('animation-preview:active-character', activeCharacterId);
}

let CHARACTER = activeCharacterId;
let STORAGE_KEY = `animation-preview:${CHARACTER}`;
let fileDefaults = allFileConfigs[CHARACTER]?.animations ?? {};

let savedConfigs = {};
try {
  savedConfigs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
} catch { /* ignore */ }

function persistConfigs() {
  const out = {};
  animations.forEach(def => {
    out[def.configKey] = { duration: def.config.duration, loop: def.config.loop };
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
}

animations.forEach(def => {
  const fd = fileDefaults[def.configKey] ?? {};
  const sv = savedConfigs[def.configKey] ?? {};
  def.config = {
    duration: sv.duration ?? fd.duration ?? def.frames.length / 24,
    loop: sv.loop ?? fd.loop ?? true,
  };
});

let currentIndex = 0;
let durationInput, durationValue, toggleInput;

const anim = new AnimatedSprite(animations[0].frames);
anim.animationSpeed = anim.totalFrames / (animations[0].config.duration * 60);
anim.loop = animations[0].config.loop;
anim.anchor.set(0.5);
anim.position.set(app.screen.width / 2, app.screen.height / 2);

app.stage.addChild(anim);
anim.play();


function switchTo(index) {
  const d = parseFloat(durationInput.value);
  if (!isNaN(d) && d > 0) animations[currentIndex].config.duration = d;
  animations[currentIndex].config.loop = toggleInput.checked;
  persistConfigs();

  currentIndex = index;
  const cfg = animations[index].config;

  anim.stop();
  anim.textures = animations[index].frames;
  anim.animationSpeed = anim.totalFrames / (cfg.duration * 60);
  anim.loop = cfg.loop;
  anim.position.set(app.screen.width / 2, app.screen.height / 2);
  anim.play();

  durationInput.value = cfg.duration.toFixed(2);
  durationValue.textContent = cfg.duration.toFixed(2) + ' s';
  toggleInput.checked = cfg.loop;
  renderAnimList();
}


window.addEventListener('resize', () => {
  anim.position.set(app.screen.width / 2, app.screen.height / 2);
});

// --- Styles ---

const styleTag = document.createElement('style');
styleTag.textContent = `
  .config-panel {
    position: fixed;
    top: 0;
    right: 0;
    width: 280px;
    height: 100%;
    background: rgba(15,15,20,0.82);
    border-left: 1px solid rgba(255,255,255,0.07);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    z-index: 20;
    display: flex;
    flex-direction: column;
    padding: 28px 22px;
    box-sizing: border-box;
    transform: translateX(100%);
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    font-family: system-ui, sans-serif;
    color: #e8e8f0;
    overflow: hidden;
  }
  .config-panel.open {
    transform: translateX(0);
  }
  .config-panel-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.28);
    margin-bottom: 26px;
    padding-bottom: 14px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .config-section {
    margin-bottom: 30px;
  }
  .config-label-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  .config-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.4);
  }
  .config-value {
    font-size: 12px;
    font-weight: 500;
    color: rgba(255,255,255,0.7);
    font-variant-numeric: tabular-nums;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  }
  .config-number-input {
    width: 100%;
    box-sizing: border-box;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    color: #e8e8f0;
    font-size: 13px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-variant-numeric: tabular-nums;
    padding: 8px 10px;
    outline: none;
    transition: border-color 0.15s, background 0.15s;
  }
  .config-number-input:focus {
    border-color: rgba(255,255,255,0.3);
    background: rgba(255,255,255,0.08);
  }
  .config-number-input::-webkit-inner-spin-button,
  .config-number-input::-webkit-outer-spin-button {
    opacity: 0.3;
  }
  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 42px;
    height: 23px;
    flex-shrink: 0;
    cursor: pointer;
  }
  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  }
  .toggle-track {
    position: absolute;
    inset: 0;
    background: rgba(255,255,255,0.1);
    border-radius: 12px;
    transition: background 0.22s;
  }
  .toggle-track::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 17px;
    height: 17px;
    background: rgba(255,255,255,0.45);
    border-radius: 50%;
    transition: transform 0.22s, background 0.22s;
  }
  .toggle-switch input:checked + .toggle-track {
    background: rgba(100,210,120,0.5);
  }
  .toggle-switch input:checked + .toggle-track::after {
    transform: translateX(19px);
    background: #ffffff;
  }
  .gear-btn {
    position: fixed;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 36px;
    height: 50px;
    background: rgba(15,15,20,0.82);
    border: 1px solid rgba(255,255,255,0.07);
    border-right: none;
    border-radius: 8px 0 0 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 21;
    color: rgba(255,255,255,0.45);
    font-size: 17px;
    transition: color 0.15s, background 0.15s, right 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    outline: none;
    user-select: none;
    padding: 0;
  }
  .gear-btn:hover {
    color: rgba(255,255,255,0.88);
    background: rgba(35,35,45,0.92);
  }
  .gear-btn.panel-open {
    right: 280px;
  }
  .char-panel {
    position: fixed;
    top: 0;
    left: 0;
    width: 280px;
    height: 100%;
    background: rgba(15,15,20,0.82);
    border-right: 1px solid rgba(255,255,255,0.07);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    z-index: 20;
    display: flex;
    flex-direction: column;
    padding: 28px 22px;
    box-sizing: border-box;
    transform: translateX(-100%);
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    font-family: system-ui, sans-serif;
    color: #e8e8f0;
    overflow: hidden;
  }
  .char-panel.open {
    transform: translateX(0);
  }
  .char-btn {
    position: fixed;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 36px;
    height: 50px;
    background: rgba(15,15,20,0.82);
    border: 1px solid rgba(255,255,255,0.07);
    border-left: none;
    border-radius: 0 8px 8px 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 21;
    color: rgba(255,255,255,0.45);
    font-size: 17px;
    transition: color 0.15s, background 0.15s, left 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    outline: none;
    user-select: none;
    padding: 0;
  }
  .char-btn:hover {
    color: rgba(255,255,255,0.88);
    background: rgba(35,35,45,0.92);
  }
  .char-btn.panel-open {
    left: 280px;
  }
  .char-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    margin: 0 -22px;
  }
  .char-list::-webkit-scrollbar {
    width: 4px;
  }
  .char-list::-webkit-scrollbar-track {
    background: transparent;
  }
  .char-list::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.1);
    border-radius: 2px;
  }
  .char-row {
    display: flex;
    align-items: center;
    height: 44px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    cursor: pointer;
    padding: 0 22px;
    transition: background 0.12s;
    gap: 8px;
  }
  .char-row:hover {
    background: rgba(255,255,255,0.05);
  }
  .char-row.active {
    background: rgba(255,255,255,0.10);
  }
  .char-row-name {
    flex: 1;
    font-size: 13px;
    color: rgba(255,255,255,0.45);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .char-row.active .char-row-name {
    color: #ffffff;
  }
  .char-row-actions {
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.12s;
    flex-shrink: 0;
  }
  .char-row:hover .char-row-actions {
    opacity: 1;
  }
  .char-action-btn {
    background: none;
    border: none;
    color: rgba(255,255,255,0.3);
    font-size: 14px;
    cursor: pointer;
    padding: 3px 5px;
    line-height: 1;
    transition: color 0.12s;
    outline: none;
    border-radius: 3px;
  }
  .char-action-btn:hover {
    color: rgba(255,255,255,0.85);
  }
  .char-action-btn:disabled {
    opacity: 0.2;
    cursor: default;
  }
  .char-rename-input {
    flex: 1;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 4px;
    color: #e8e8f0;
    font-size: 13px;
    font-family: system-ui, sans-serif;
    padding: 4px 8px;
    outline: none;
    min-width: 0;
  }
  .char-rename-input:focus {
    border-color: rgba(255,255,255,0.4);
  }
  .char-new-form {
    display: flex;
    gap: 8px;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
  }
  .char-new-input {
    flex: 1;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    color: #e8e8f0;
    font-size: 13px;
    font-family: system-ui, sans-serif;
    padding: 7px 10px;
    outline: none;
    transition: border-color 0.15s, background 0.15s;
    min-width: 0;
  }
  .char-new-input:focus {
    border-color: rgba(255,255,255,0.3);
    background: rgba(255,255,255,0.08);
  }
  .char-add-btn {
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    color: rgba(255,255,255,0.65);
    font-size: 13px;
    font-family: system-ui, sans-serif;
    padding: 7px 12px;
    cursor: pointer;
    outline: none;
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .char-add-btn:hover {
    background: rgba(255,255,255,0.13);
    color: #ffffff;
  }
  .char-btn.anim-open {
    left: 560px;
  }
  .anim-panel {
    position: fixed;
    top: 0;
    left: 280px;
    width: 280px;
    height: 100%;
    background: rgba(15,15,20,0.82);
    border-right: 1px solid rgba(255,255,255,0.07);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    z-index: 20;
    display: flex;
    flex-direction: column;
    padding: 28px 22px;
    box-sizing: border-box;
    transform: translateX(calc(-100% - 280px));
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    font-family: system-ui, sans-serif;
    color: #e8e8f0;
    overflow: hidden;
  }
  .anim-panel.open {
    transform: translateX(0);
  }
  .anim-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    margin: 0 -22px;
  }
  .anim-list::-webkit-scrollbar {
    width: 4px;
  }
  .anim-list::-webkit-scrollbar-track {
    background: transparent;
  }
  .anim-list::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.1);
    border-radius: 2px;
  }
  .anim-row {
    display: flex;
    align-items: center;
    height: 44px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    cursor: pointer;
    padding: 0 22px;
    transition: background 0.12s;
  }
  .anim-row:hover {
    background: rgba(255,255,255,0.05);
  }
  .anim-row.active {
    background: rgba(255,255,255,0.10);
  }
  .anim-row-name {
    flex: 1;
    font-size: 13px;
    color: rgba(255,255,255,0.45);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .anim-row.active .anim-row-name {
    color: #ffffff;
  }
`;
document.head.appendChild(styleTag);

// --- Config panel DOM ---

const panel = document.createElement('div');
panel.className = 'config-panel';

const panelTitle = document.createElement('div');
panelTitle.className = 'config-panel-title';
panelTitle.textContent = 'Playback Settings';
panel.appendChild(panelTitle);

const durationSection = document.createElement('div');
durationSection.className = 'config-section';

const durationLabelRow = document.createElement('div');
durationLabelRow.className = 'config-label-row';

const durationLabel = document.createElement('span');
durationLabel.className = 'config-label';
durationLabel.textContent = 'Duration';

durationValue = document.createElement('span');
durationValue.className = 'config-value';
const initialDuration = animations[0].config.duration;
durationValue.textContent = initialDuration.toFixed(2) + ' s';

durationLabelRow.appendChild(durationLabel);
durationLabelRow.appendChild(durationValue);

durationInput = document.createElement('input');
durationInput.type = 'number';
durationInput.className = 'config-number-input';
durationInput.min = '0.1';
durationInput.max = '30';
durationInput.step = '0.05';
durationInput.value = initialDuration.toFixed(2);

durationInput.addEventListener('input', () => {
  const d = parseFloat(durationInput.value);
  if (!isNaN(d) && d > 0) {
    animations[currentIndex].config.duration = d;
    anim.animationSpeed = anim.totalFrames / (d * 60);
    durationValue.textContent = d.toFixed(2) + ' s';
    persistConfigs();
  }
});

durationSection.appendChild(durationLabelRow);
durationSection.appendChild(durationInput);
panel.appendChild(durationSection);

const loopSection = document.createElement('div');
loopSection.className = 'config-section';

const loopLabelRow = document.createElement('div');
loopLabelRow.className = 'config-label-row';

const loopLabel = document.createElement('span');
loopLabel.className = 'config-label';
loopLabel.textContent = 'Loop';

const toggleSwitch = document.createElement('label');
toggleSwitch.className = 'toggle-switch';

toggleInput = document.createElement('input');
toggleInput.type = 'checkbox';
toggleInput.checked = animations[0].config.loop;

const toggleTrack = document.createElement('span');
toggleTrack.className = 'toggle-track';

toggleSwitch.appendChild(toggleInput);
toggleSwitch.appendChild(toggleTrack);

toggleInput.addEventListener('change', () => {
  animations[currentIndex].config.loop = toggleInput.checked;
  anim.loop = toggleInput.checked;
  persistConfigs();
});

loopLabelRow.appendChild(loopLabel);
loopLabelRow.appendChild(toggleSwitch);
loopSection.appendChild(loopLabelRow);
panel.appendChild(loopSection);

document.body.appendChild(panel);

const gearBtn = document.createElement('button');
gearBtn.className = 'gear-btn';
gearBtn.textContent = '⚙';
gearBtn.setAttribute('aria-label', 'Toggle settings panel');
document.body.appendChild(gearBtn);

let panelOpen = true;
panel.classList.add('open');
gearBtn.classList.add('panel-open');
gearBtn.addEventListener('click', () => {
  panelOpen = !panelOpen;
  panel.classList.toggle('open', panelOpen);
  gearBtn.classList.toggle('panel-open', panelOpen);
});

// --- Character panel DOM ---

const charPanel = document.createElement('div');
charPanel.className = 'char-panel';

const charPanelTitle = document.createElement('div');
charPanelTitle.className = 'config-panel-title';
charPanelTitle.textContent = 'Characters';
charPanel.appendChild(charPanelTitle);

const charList = document.createElement('div');
charList.className = 'char-list';
charPanel.appendChild(charList);

const charNewForm = document.createElement('div');
charNewForm.className = 'char-new-form';

const charNewInput = document.createElement('input');
charNewInput.type = 'text';
charNewInput.className = 'char-new-input';
charNewInput.placeholder = 'Character name';
charNewInput.setAttribute('aria-label', 'New character name');

const charAddBtn = document.createElement('button');
charAddBtn.className = 'char-add-btn';
charAddBtn.textContent = 'Add';

charNewForm.appendChild(charNewInput);
charNewForm.appendChild(charAddBtn);
charPanel.appendChild(charNewForm);

document.body.appendChild(charPanel);

const charBtn = document.createElement('button');
charBtn.className = 'char-btn';
charBtn.textContent = '☰';
charBtn.setAttribute('aria-label', 'Toggle character panel');
document.body.appendChild(charBtn);

// --- Animation panel DOM ---

const animPanel = document.createElement('div');
animPanel.className = 'anim-panel';

const animPanelTitle = document.createElement('div');
animPanelTitle.className = 'config-panel-title';
animPanelTitle.textContent = characters.find(c => c.id === CHARACTER)?.name ?? CHARACTER;
animPanel.appendChild(animPanelTitle);

const animList = document.createElement('div');
animList.className = 'anim-list';
animPanel.appendChild(animList);

document.body.appendChild(animPanel);

function renderAnimList() {
  const fileAnims = allFileConfigs[CHARACTER]?.animations ?? {};
  const charKeys = Object.keys(fileAnims);
  animPanelTitle.textContent = characters.find(c => c.id === CHARACTER)?.name ?? CHARACTER;
  animList.innerHTML = '';
  animations.forEach((def, i) => {
    if (charKeys.length > 0 && !fileAnims[def.configKey]) return;
    const row = document.createElement('div');
    row.className = 'anim-row' + (i === currentIndex ? ' active' : '');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'anim-row-name';
    nameSpan.textContent = def.label;
    row.appendChild(nameSpan);
    animList.appendChild(row);
    row.addEventListener('click', () => switchTo(i));
  });
}

let charPanelOpen = true;
charPanel.classList.add('open');
charBtn.classList.add('panel-open');
animPanel.classList.add('open');
charBtn.classList.add('anim-open');
charBtn.addEventListener('click', () => {
  charPanelOpen = !charPanelOpen;
  charPanel.classList.toggle('open', charPanelOpen);
  charBtn.classList.toggle('panel-open', charPanelOpen);
  animPanel.classList.toggle('open', charPanelOpen);
  charBtn.classList.toggle('anim-open', charPanelOpen);
});

// --- Character list ---

function renderCharacterList() {
  charList.innerHTML = '';
  characters.forEach(char => {
    const row = document.createElement('div');
    row.className = 'char-row' + (char.id === CHARACTER ? ' active' : '');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'char-row-name';
    nameSpan.textContent = char.name;

    const actions = document.createElement('div');
    actions.className = 'char-row-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'char-action-btn';
    editBtn.textContent = '✎';
    editBtn.title = 'Rename';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'char-action-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Delete';
    deleteBtn.disabled = characters.length <= 1;

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    row.appendChild(nameSpan);
    row.appendChild(actions);
    charList.appendChild(row);

    row.addEventListener('click', (e) => {
      if (actions.contains(e.target)) return;
      if (row.querySelector('.char-rename-input')) return;
      if (char.id !== CHARACTER) switchCharacter(char.id);
    });

    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const renameInput = document.createElement('input');
      renameInput.type = 'text';
      renameInput.className = 'char-rename-input';
      renameInput.value = char.name;
      row.replaceChild(renameInput, nameSpan);
      renameInput.focus();
      renameInput.select();

      let committed = false;
      function commit() {
        if (committed) return;
        committed = true;
        const newName = renameInput.value.trim();
        if (newName && newName !== char.name) {
          char.name = newName;
          saveCharacters(characters);
        }
        renderCharacterList();
      }

      renameInput.addEventListener('blur', commit);
      renameInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') commit();
        if (ev.key === 'Escape') { committed = true; renderCharacterList(); }
      });
    });

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (characters.length <= 1) return;
      const idx = characters.findIndex(c => c.id === char.id);
      characters.splice(idx, 1);
      saveCharacters(characters);
      if (CHARACTER === char.id) {
        switchCharacter(characters[Math.max(0, idx - 1)].id);
      } else {
        renderCharacterList();
      }
    });
  });
}

function switchCharacter(id) {
  const d = parseFloat(durationInput.value);
  if (!isNaN(d) && d > 0) animations[currentIndex].config.duration = d;
  animations[currentIndex].config.loop = toggleInput.checked;
  persistConfigs();

  CHARACTER = id;
  STORAGE_KEY = `animation-preview:${CHARACTER}`;
  localStorage.setItem('animation-preview:active-character', id);

  fileDefaults = allFileConfigs[CHARACTER]?.animations ?? {};
  let newSaved = {};
  try { newSaved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { /* ignore */ }

  animations.forEach(def => {
    const fd = fileDefaults[def.configKey] ?? {};
    const sv = newSaved[def.configKey] ?? {};
    def.config = {
      duration: sv.duration ?? fd.duration ?? def.frames.length / 24,
      loop: sv.loop ?? fd.loop ?? true,
    };
  });

  // Jump to the first animation that belongs to this character
  const charKeys = new Set(Object.keys(fileDefaults));
  if (charKeys.size > 0) {
    const idx = animations.findIndex(def => charKeys.has(def.configKey));
    if (idx !== -1) {
      currentIndex = idx;
    }
  }

  const cfg = animations[currentIndex].config;
  durationInput.value = cfg.duration.toFixed(2);
  durationValue.textContent = cfg.duration.toFixed(2) + ' s';
  toggleInput.checked = cfg.loop;

  anim.stop();
  anim.textures = animations[currentIndex].frames;
  anim.animationSpeed = anim.totalFrames / (cfg.duration * 60);
  anim.loop = cfg.loop;
  anim.play();

  renderCharacterList();
  animPanel.classList.add('open');
  charBtn.classList.add('anim-open');
  renderAnimList();
}

function uniqueId(base) {
  if (!characters.find(c => c.id === base)) return base;
  let n = 2;
  while (characters.find(c => c.id === `${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function addCharacter() {
  const name = charNewInput.value.trim();
  if (!name) return;
  const id = uniqueId(slugify(name));
  characters.push({ id, name });
  saveCharacters(characters);
  charNewInput.value = '';
  switchCharacter(id);
}

charAddBtn.addEventListener('click', addCharacter);
charNewInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addCharacter();
});

renderCharacterList();
renderAnimList();

// On startup, jump to the first animation that belongs to the active character
const startCharKeys = new Set(Object.keys(fileDefaults));
if (startCharKeys.size > 0) {
  const startIdx = animations.findIndex(def => startCharKeys.has(def.configKey));
  if (startIdx !== -1 && startIdx !== currentIndex) {
    currentIndex = startIdx;
    const cfg = animations[startIdx].config;
    anim.stop();
    anim.textures = animations[startIdx].frames;
    anim.animationSpeed = anim.totalFrames / (cfg.duration * 60);
    anim.loop = cfg.loop;
    anim.play();
    durationInput.value = cfg.duration.toFixed(2);
    durationValue.textContent = cfg.duration.toFixed(2) + ' s';
    toggleInput.checked = cfg.loop;

    renderAnimList();
  }
}
