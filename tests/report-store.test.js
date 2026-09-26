const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReportStore } = require('../report-store');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'todo-report-store-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true });
  return { root, vault, store: createReportStore(vault) };
}

function save(store, type, key, content, expectedRevision = null, extra = {}) {
  return store.save({ type, key, content, expectedRevision, confirmed: true, ...extra });
}

test('read-only calls never create report directories', (t) => {
  const { vault, store } = fixture(t);
  const report = store.get('daily', '2026-09-18');
  assert.equal(report.ok, true);
  assert.equal(report.exists, false);
  assert.equal(report.revision, null);
  assert.deepEqual(store.list('daily').rows, []);
  assert.deepEqual(store.weeklySources('2026-W38').items, []);
  assert.deepEqual(fs.readdirSync(vault), ['.obsidian']);
});

test('only an existing Obsidian vault is accepted without creating it', (t) => {
  const { root } = fixture(t);
  const missing = path.join(root, 'missing');
  assert.equal(createReportStore(missing).get('daily', '2026-09-18').error, 'vault_not_found');
  assert.equal(fs.existsSync(missing), false);
  const plain = path.join(root, 'plain');
  fs.mkdirSync(plain);
  assert.equal(createReportStore(plain).list('daily').error, 'invalid_vault');
  assert.equal(createReportStore('../relative').list('daily').error, 'invalid_vault');
});

test('types, actual dates, ISO weeks and numeric versions are validated', (t) => {
  const { store } = fixture(t);
  for (const key of ['2026-02-29', '2026-13-01', '2026-09-00', '2026-9-18', '../outside', '0000-01-01']) {
    assert.equal(store.get('daily', key).error, 'invalid_key', key);
  }
  assert.equal(store.get('daily', '2024-02-29').ok, true);
  for (const key of ['2021-W53', '2026-W00', '2026-W54', '2026-W1', '0000-W01']) {
    assert.equal(store.get('weekly', key).error, 'invalid_key', key);
  }
  assert.equal(store.get('weekly', '2020-W53').ok, true);
  assert.equal(store.get('other', '2026-09-18').error, 'invalid_type');
  for (const version of [0, -1, 1.5, '1', '../outside']) assert.equal(store.get('daily', '2026-09-18', version).error, 'invalid_version');
});

test('saving requires explicit confirmation and exact expected revision', (t) => {
  const { vault, store } = fixture(t);
  const payload = { type: 'daily', key: '2026-09-18', content: '正文', expectedRevision: null };
  assert.equal(store.save(payload).error, 'confirmation_required');
  assert.equal(store.save({ ...payload, confirmed: 'true' }).error, 'confirmation_required');
  assert.equal(store.save({ type: payload.type, key: payload.key, content: payload.content, confirmed: true }).error, 'revision_required');
  assert.equal(store.save({ ...payload, confirmed: true, expectedRevision: '' }).error, 'invalid_revision');
  assert.deepEqual(fs.readdirSync(vault), ['.obsidian']);
});

test('first save uses the requested nested path and preserves body exactly', (t) => {
  const { vault, store } = fixture(t);
  const content = '9月18日工作总结\n✅：已完成访谈\n🚶：页面设计\n\n明日计划：\n1、继续设计\n';
  const saved = save(store, 'daily', '2026-09-18', content);
  assert.equal(saved.ok, true);
  assert.equal(saved.path, path.join(vault, '日报周报/日报/2026/09/2026-09-18.md'));
  assert.equal(saved.archivedVersion, null);
  assert.equal(saved.revision, crypto.createHash('sha256').update(content).digest('hex'));
  assert.equal(fs.readFileSync(saved.path, 'utf8'), content);
  assert.equal(store.get('daily', '2026-09-18').content, content);
  assert.equal(fs.existsSync(path.join(path.dirname(saved.path), '版本')), false);
  const weekly = save(store, 'weekly', '2026-W38', '本周工作进展\n🚶：设计\n\n下周计划\n1、继续');
  assert.equal(weekly.path, path.join(vault, '日报周报/周报/2026-W38.md'));
});

test('revisions preserve exclusive snapshots and unchanged saves add none', (t) => {
  const { store } = fixture(t);
  const first = save(store, 'daily', '2026-09-18', '第一稿');
  const same = save(store, 'daily', '2026-09-18', '第一稿', first.revision);
  assert.equal(same.unchanged, true);
  assert.equal(store.list('daily').rows.length, 1);
  const second = save(store, 'daily', '2026-09-18', '第二稿', first.revision);
  assert.equal(second.archivedVersion, 1);
  assert.equal(store.get('daily', '2026-09-18', 1).content, '第一稿');
  const third = save(store, 'daily', '2026-09-18', '第三稿', second.revision);
  assert.equal(third.archivedVersion, 2);
  assert.equal(store.get('daily', '2026-09-18', 1).content, '第一稿');
  assert.equal(store.get('daily', '2026-09-18', 2).content, '第二稿');
  assert.deepEqual(store.list('daily').rows.map((row) => row.version), [null, 2, 1]);
});

test('stale and externally changed reports are never overwritten', (t) => {
  const { store } = fixture(t);
  const first = save(store, 'daily', '2026-09-18', 'first');
  const stale = save(store, 'daily', '2026-09-18', 'stale', null);
  assert.equal(stale.error, 'revision_conflict');
  assert.equal(stale.currentRevision, first.revision);
  fs.writeFileSync(first.path, 'Obsidian 外部修改', 'utf8');
  const conflict = save(store, 'daily', '2026-09-18', 'overwrite', first.revision);
  assert.equal(conflict.error, 'revision_conflict');
  assert.equal(fs.readFileSync(first.path, 'utf8'), 'Obsidian 外部修改');
  assert.equal(store.list('daily').rows.length, 1);
});

test('weekly sources only read seven current notes including cross-year days', (t) => {
  const { store } = fixture(t);
  save(store, 'daily', '2020-12-27', 'previous week');
  const old = save(store, 'daily', '2020-12-28', 'old Monday');
  save(store, 'daily', '2020-12-28', 'latest Monday', old.revision);
  save(store, 'daily', '2021-01-03', 'Sunday');
  save(store, 'daily', '2021-01-04', 'next week');
  const sources = store.weeklySources('2020-W53');
  assert.equal(sources.ok, true);
  assert.deepEqual(sources.items.map(({ key, content }) => ({ key, content })), [
    { key: '2020-12-28', content: 'latest Monday' }, { key: '2021-01-03', content: 'Sunday' },
  ]);
});

test('list ignores invalid or misplaced files and accepts only proper report locations', (t) => {
  const { vault, store } = fixture(t);
  save(store, 'daily', '2026-09-18', 'correct');
  const folder = path.join(vault, '日报周报/日报/2026/09');
  for (const name of ['2026-09-99.md', '2026-10-01.md', '2026-09-18-v7.md', 'other.md']) fs.writeFileSync(path.join(folder, name), 'ignore');
  const rows = store.list('daily').rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, '2026-09-18');
  assert.equal(rows[0].version, null);
});

test('symlink vaults, parents, report files and version directories are refused', (t) => {
  const { root, vault, store } = fixture(t);
  const alias = path.join(root, 'alias');
  fs.symlinkSync(vault, alias);
  assert.equal(createReportStore(alias).list('daily').error, 'symlink_not_allowed');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(vault, '日报周报'));
  assert.equal(store.get('daily', '2026-09-18').error, 'symlink_not_allowed');
  assert.equal(save(store, 'daily', '2026-09-18', 'no').error, 'symlink_not_allowed');
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(path.join(vault, '日报周报'));
  const saved = save(store, 'daily', '2026-09-18', 'first');
  const source = path.join(outside, 'source.md');
  fs.writeFileSync(source, 'outside');
  fs.unlinkSync(saved.path);
  fs.symlinkSync(source, saved.path);
  assert.equal(store.get('daily', '2026-09-18').error, 'symlink_not_allowed');
  assert.equal(store.list('daily').error, 'symlink_not_allowed');
  fs.unlinkSync(saved.path);
  fs.writeFileSync(saved.path, 'first');
  fs.symlinkSync(outside, path.join(path.dirname(saved.path), '版本'));
  assert.equal(save(store, 'daily', '2026-09-18', 'second', saved.revision).error, 'symlink_not_allowed');
  assert.equal(fs.readFileSync(saved.path, 'utf8'), 'first');
});

test('a missing or symlink Obsidian marker is rejected', (t) => {
  const { root, vault, store } = fixture(t);
  fs.rmdirSync(path.join(vault, '.obsidian'));
  fs.mkdirSync(path.join(root, 'settings'));
  fs.symlinkSync(path.join(root, 'settings'), path.join(vault, '.obsidian'));
  assert.equal(store.list('weekly').error, 'symlink_not_allowed');
});

test('pre-existing version numbers are not overwritten', (t) => {
  const { store } = fixture(t);
  const first = save(store, 'weekly', '2026-W38', 'first');
  const versions = path.join(path.dirname(first.path), '版本');
  fs.mkdirSync(versions);
  fs.writeFileSync(path.join(versions, '2026-W38-v4.md'), 'preserved');
  const second = save(store, 'weekly', '2026-W38', 'second', first.revision);
  assert.equal(second.archivedVersion, 5);
  assert.equal(store.get('weekly', '2026-W38', 4).content, 'preserved');
});

test('empty reports, oversized content, and a busy store do not overwrite a note', (t) => {
  const { vault, store } = fixture(t);
  assert.equal(save(store, 'daily', '2026-09-18', '   ').error, 'invalid_content');
  assert.equal(save(store, 'daily', '2026-09-18', 'x'.repeat(1024 * 1024 + 1)).error, 'report_too_large');
  const first = save(store, 'daily', '2026-09-18', 'first');
  fs.mkdirSync(path.join(vault, '日报周报/.report-store.lock'));
  assert.equal(save(store, 'daily', '2026-09-18', 'second', first.revision).error, 'store_busy');
  assert.equal(store.get('daily', '2026-09-18').content, 'first');
});
