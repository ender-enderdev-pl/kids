const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const gradient = {addColorStop() {}};
const canvasContext = new Proxy({}, {
  get(target, key) {
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
    return target[key] ?? (() => {});
  }
});
const elements = new Map();
const documentHandlers = new Map();
const documentClasses = new Set();
function element(id) {
  if (!elements.has(id)) {
    // Only expose APIs supported by Chromium 53; do not stub modern append()
    // or replaceChildren(), so incompatible dialogs fail this regression test.
    const children = [];
    const listeners = new Map();
    elements.set(id, {
      children, listeners,
      style: {}, hidden: false, textContent: '', innerHTML: '',
      get firstChild() { return children.length ? children[0] : null; },
      appendChild(child) { children.push(child); return child; },
      removeChild(child) {
        const index = children.indexOf(child);
        assert.notEqual(index, -1, 'removed node must be a child');
        children.splice(index, 1);
        return child;
      },
      classList: {add() {}, remove() {}, toggle() {}},
      addEventListener(type, listener) { listeners.set(type, listener); },
      click() {
        const listener = listeners.get('click');
        assert.ok(listener, 'click handler is registered');
        listener();
      },
      setAttribute() {}, focus() {},
      getBoundingClientRect() { return {width: 960, height: 540}; },
      getContext() { return canvasContext; }
    });
  }
  return elements.get(id);
}

const window = {matchMedia: () => ({matches: false}), addEventListener() {}};
const document = {
  documentElement: {classList: {toggle(name, active) { if (active) documentClasses.add(name); else documentClasses.delete(name); }}},
  getElementById: element,
  createElement: () => element(Symbol()),
  querySelectorAll: () => [],
  addEventListener(type, listener) { documentHandlers.set(type, listener); }
};
const source = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
// Chromium 53 must parse the complete scripts before any animation can start.
assert.doesNotMatch(source, /Object\.hasOwn\(|\.padStart\(|\?\.(?=[A-Za-z_$\[])/);
assert.doesNotMatch(source, /\?\?(?!\?)/);
assert.doesNotMatch(source, /\basync\s+function\b/);
assert.doesNotMatch(workerSource, /\basync\b|\bawait\b/);
assert.doesNotMatch(source + cssSource, /#[0-9a-fA-F]{8}\b/);
assert.doesNotMatch(source, /\.replaceChildren\(|\.append\(/);
assert.equal(typeof element('modalStats').replaceChildren, 'undefined');
assert.equal(typeof element('modalStats').append, 'undefined');
const legacyContext = vm.createContext({
  window, document, HTMLButtonElement: class HTMLButtonElement {},
  navigator: {maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) webOS.TV-2017'},
  location: {search: '?test', protocol: 'file:'},
  localStorage: {getItem: () => null, setItem() {}},
  URLSearchParams, requestAnimationFrame() {},
  console
});
// Simulate browser implementations without modern built-ins.
vm.runInContext('Object.hasOwn = undefined; String.prototype.padStart = undefined;', legacyContext);
vm.runInContext(source, legacyContext, {filename: 'game.js', timeout: 10000});

const game = window.__forestTest;
assert.ok(game, 'test hook is available');
assert.equal(game.stages.length, 10);
for (const stage of game.stages) {
  for (const [x, kind] of stage.hazards) {
    const width = kind === 'spikes' ? 40 : kind === 'cactus' ? 30 : 32;
    assert.ok(x >= 0 && x + width < stage.length);
    assert.ok(stage.gaps.every(([left, right]) => x + width <= left || x >= right),
      `${stage.name}: ${kind} at ${x} must stand on ground`);
  }
}

// Emulate the numeric key codes supplied by old LG webOS remote controls.
// In particular, remote events may have no usable KeyboardEvent.code.
function sendRemote(type, keyCode, repeat = false) {
  const listener = documentHandlers.get(type);
  assert.ok(listener, type + ' listener is registered');
  let prevented = false;
  listener({
    keyCode, code: 'Unidentified', repeat,
    preventDefault() { prevented = true; }
  });
  return prevented;
}
assert.ok(documentClasses.has('tv-browser'), 'webOS browser uses the TV control legend');

game.start();
assert.ok(sendRemote('keydown', 404), 'green remote key is handled');
game.updatePlayer(1 / 120);
assert.ok(game.player.vx < 0 && game.player.vy < 0, 'green combines left with jump');
sendRemote('keyup', 404);

game.start();
assert.ok(sendRemote('keydown', 405), 'yellow remote key is handled');
game.updatePlayer(1 / 120);
assert.ok(game.player.vx > 0 && game.player.vy < 0, 'yellow combines right with jump');
sendRemote('keyup', 405);

game.start();
game.collectLoot({kind: 'bow', life: 1, x: 120, y: 350});
const ammoBeforeRemoteAttack = game.player.ammo;
assert.ok(sendRemote('keydown', 403), 'red remote key is handled');
// Newly equipped weapons have a short pickup cooldown. Holding red must
// fire as soon as that cooldown elapses, without using the on-screen button.
game.advance(.2, false);
assert.equal(game.player.ammo, ammoBeforeRemoteAttack - 1, 'red fires the current weapon');
sendRemote('keyup', 403);

assert.ok(sendRemote('keydown', 406), 'blue remote key is handled');
assert.equal(game.state, 'paused', 'blue pauses the game');
sendRemote('keydown', 406, true);
assert.equal(game.state, 'paused', 'repeating blue does not instantly unpause');
sendRemote('keyup', 406);
sendRemote('keydown', 406);
assert.equal(game.state, 'playing', 'blue resumes the game');
sendRemote('keyup', 406);

game.start();
// Picking up any of the four offensive power-ups must not freeze the game.
for (const weapon of ['bow', 'fire', 'ice', 'sword']) {
  game.collectLoot({kind: weapon, life: 1, x: 120, y: 350});
  assert.equal(game.player.weapon, weapon);
}
assert.equal(game.player.ammo, 12, 'the bow still provides its initial ammunition');
game.collectLoot({kind: 'cat', life: 1, x: 120, y: 350});
assert.ok(game.companion);
assert.equal(game.catLives, 7);

const cat = game.companion;
cat.invincible = 0;
game.level.hazards.push({x: cat.x - 20, y: cat.y - 20, w: 100, h: 100, kind: 'spikes'});
game.updateCompanion(1 / 120);
assert.equal(game.catLives, 6, 'hazard costs one life');
assert.ok(game.companion, 'Lucek returns after a hit');
game.updateCompanion(1 / 120);
assert.equal(game.catLives, 6, 'one contact does not drain more lives during protection');

game.level.hazards.pop();
game.companion.y = 600;
game.updateCompanion(1 / 120);
assert.equal(game.catLives, 5, 'falling costs one life');

for (let i = 0; i < 5; i++) game.loseCatLife('przepaść');
assert.equal(game.catLives, 0);
assert.equal(game.companion, null, 'Lucek is lost after seven hits');
game.collectLoot({kind: 'cat', life: 1, x: 120, y: 350});
assert.ok(game.companion, 'a later pickup brings Lucek back');
assert.equal(game.catLives, 7, 'a later pickup restores seven lives after losing them all');
game.loseCatLife('przepaść');
assert.equal(game.catLives, 6);
game.collectLoot({kind: 'cat', life: 1, x: 120, y: 350});
assert.equal(game.catLives, 7, 'a pickup restores lives while Lucek is already active');

game.start();
assert.equal(game.catLives, 7, 'new run restores the lives');
const cactus = game.level.hazards.find(h => h.kind === 'cactus');
game.player.x = cactus.x;
game.player.y = cactus.y;
game.player.invincible = 0;
game.updatePlayer(1 / 120);
assert.equal(game.player.health, 2, 'hazards also injure the player');

game.collectLoot({kind: 'cat', life: 1, x: 120, y: 350});
game.loseCatLife('przepaść');
game.load(1);
assert.equal(game.catLives, 6, 'remaining lives carry into the next level');
game.collectLoot({kind: 'cat', life: 1, x: 120, y: 350});
assert.ok(game.companion);
assert.equal(game.catLives, 7, 'finding Lucek again refills lives');

// Pause and game-over dialogs have no stats; completion dialogs show three.
// Exercise all of them without supplying modern DOM APIs in the fixture.
game.start();
const modalStats = element('modalStats');
element('pauseBtn').click();
assert.equal(game.state, 'paused');
assert.equal(element('modalScreen').hidden, false);
assert.equal(modalStats.children.length, 0, 'pause dialog has no stats');
element('modalPrimary').click();
assert.equal(game.state, 'playing', 'resume from pause');

for (let i = 0; i < 3; i++) game.hurtPlayer(true);
assert.equal(game.state, 'gameover');
assert.equal(modalStats.children.length, 0, 'death dialog has no stats');
element('modalPrimary').click();
assert.equal(game.state, 'playing', 'resume after death');

game.finishStage();
assert.equal(game.state, 'stageclear');
assert.equal(modalStats.children.length, 3, 'stage completion renders three stats');
for (const entry of modalStats.children) {
  assert.equal(entry.children.length, 2, 'each stat has a number and a caption');
}
const previousStat = modalStats.firstChild;
element('modalPrimary').click();
assert.equal(game.state, 'playing', 'advance to next stage');
game.finishStage();
assert.equal(modalStats.children.length, 3, 'next stage replaces stats instead of duplicating them');
assert.notEqual(modalStats.firstChild, previousStat, 'previous stats were removed');
game.load(9);
game.finishStage();
assert.equal(game.state, 'win');
assert.equal(modalStats.children.length, 3, 'final results render correctly');

console.log('Elf weapon, hazard, Lucek and legacy modal checks passed');
