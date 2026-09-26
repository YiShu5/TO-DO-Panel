const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const domain = require('../renderer/domain');

// Run the renderer's actual preference loaders, including initial persistence.
const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const loaders = source.slice(source.indexOf('const HOME_ORDER_KEY'), source.indexOf('function resolveValidatedHomeLayout'));
const orderKey = 'notch-home-order-v3';
const sizesKey = 'notch-home-widget-sizes-v2';
const hiddenKey = 'notch-home-hidden-modules-v1';
function boot(storage = new Map()) {
  const context = vm.createContext({
    window: { NotchDomain: domain },
    document: { getElementById: () => null },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  vm.runInContext(loaders, context);
  const read = (code) => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context));
  return {
    context, storage,
    order: read('homeOrder'), sizes: read('homeSizes'), hidden: read('hiddenHomeModules'),
    layout: read('window.NotchDomain.resolveHomeWidgetLayout(homeOrder, homeSizes, hiddenHomeModules, 12, 4)'),
  };
}

test('first boot and restart use the screenshot arrangement through the real preference loaders', () => {
  const first = boot();
  const expected = {
    commands: { column: 0, row: 0, width: 4, height: 4 },
    usage: { column: 4, row: 0, width: 4, height: 2 },
    note: { column: 8, row: 0, width: 4, height: 2 },
    mirror: { column: 4, row: 2, width: 4, height: 2 },
    pomodoro: { column: 8, row: 2, width: 4, height: 2 },
  };
  assert.deepEqual(first.layout.placements, expected);
  assert.deepEqual(JSON.parse(first.storage.get(hiddenKey)), first.hidden);
  vm.runInContext('saveHomeLayout()', first.context);
  assert.deepEqual(boot(first.storage).layout.placements, expected);
});

test('saved custom order, sizes and visibility survive an upgrade and restart', () => {
  const first = boot();
  const customOrder = [...first.order];
  [customOrder[1], customOrder[2]] = [customOrder[2], customOrder[1]];
  first.storage.set(orderKey, JSON.stringify(customOrder));
  first.storage.set(sizesKey, JSON.stringify(first.sizes));
  const restarted = boot(first.storage);
  assert.deepEqual(restarted.order, customOrder);
  assert.deepEqual(restarted.sizes, first.sizes);
  assert.deepEqual(restarted.hidden, first.hidden);
  assert.deepEqual(restarted.layout.placements.note, { column: 4, row: 0, width: 4, height: 2 });
});

test('legacy layouts and explicitly showing all modules do not inherit default hidden modules', () => {
  const legacy = new Map([[orderKey, JSON.stringify(['music', 'usage', 'pomodoro', 'windows', 'recorder', 'mirror', 'note', 'commands'])]]);
  assert.deepEqual(boot(legacy).hidden, []);
  const explicit = boot(new Map([[hiddenKey, '[]']]));
  assert.deepEqual(explicit.hidden, []);
  assert.equal(Object.keys(explicit.layout.placements).length, 8);
});
