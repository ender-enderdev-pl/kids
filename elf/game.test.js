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
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    style: {}, hidden: false, textContent: '', innerHTML: '',
    classList: {add() {}, remove() {}, toggle() {}},
    addEventListener() {}, setAttribute() {}, replaceChildren() {}, append() {}, focus() {},
    getBoundingClientRect() { return {width: 960, height: 540}; },
    getContext() { return canvasContext; }
  });
  return elements.get(id);
}

const window = {matchMedia: () => ({matches: false}), addEventListener() {}};
const document = {
  documentElement: {classList: {toggle() {}}},
  getElementById: element,
  createElement: () => element(Symbol()),
  querySelectorAll: () => [],
  addEventListener() {}
};
const source = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');
vm.runInNewContext(source, {
  window, document, navigator: {maxTouchPoints: 0},
  location: {search: '?test', protocol: 'file:'},
  localStorage: {getItem: () => null, setItem() {}},
  URLSearchParams, requestAnimationFrame() {},
  console
}, {filename: 'game.js', timeout: 10000});

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

game.start();
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

console.log('Elf hazard and Lucek life checks passed');
