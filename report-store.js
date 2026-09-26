const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = '日报周报';
const MAX_BYTES = 1024 * 1024;
const DAY_MS = 86400000;

function fail(code, detail = {}) {
  throw Object.assign(new Error(code), { code, detail });
}

function utcDate(year, month, day) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function dateKey(date) {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function weekMonday(year, week) {
  const jan4 = utcDate(year, 1, 4);
  return new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY_MS + (week - 1) * 7 * DAY_MS);
}

function validateKey(type, key) {
  if (type !== 'daily' && type !== 'weekly') fail('invalid_type');
  if (typeof key !== 'string') fail('invalid_key');
  if (type === 'daily') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!match || Number(match[1]) < 1) fail('invalid_key');
    const date = utcDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (dateKey(date) !== key) fail('invalid_key');
    return;
  }
  const match = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!match || Number(match[1]) < 1) fail('invalid_key');
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53 || weekMonday(year, week) >= weekMonday(year + 1, 1)) fail('invalid_key');
}

function revision(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function statOrNull(target) {
  try { return fs.lstatSync(target); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertDirectory(target) {
  const stat = statOrNull(target);
  if (!stat) return false;
  if (stat.isSymbolicLink()) fail('symlink_not_allowed');
  if (!stat.isDirectory()) fail('invalid_directory');
  return true;
}

function resultOf(operation) {
  try { return operation(); } catch (error) {
    const allowed = new Set([
      'invalid_type', 'invalid_key', 'invalid_version', 'invalid_vault', 'vault_not_found',
      'symlink_not_allowed', 'invalid_directory', 'invalid_file', 'report_too_large',
      'invalid_content', 'confirmation_required', 'revision_required', 'invalid_revision',
      'revision_conflict', 'store_busy', 'invalid_path',
    ]);
    return { ok: false, error: allowed.has(error.code) ? error.code : 'storage_error', ...(error.detail || {}) };
  }
}

/** Plain-text report storage. Reads never create directories or files. */
function createReportStore(vaultRoot) {
  const vault = typeof vaultRoot === 'string' && path.isAbsolute(vaultRoot) ? path.resolve(vaultRoot) : null;

  function assertVault() {
    if (!vault) fail('invalid_vault');
    const parsed = path.parse(vault);
    let ancestor = parsed.root;
    for (const segment of vault.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      ancestor = path.join(ancestor, segment);
      if (!assertDirectory(ancestor)) fail('vault_not_found');
    }
    if (!assertDirectory(path.join(vault, '.obsidian'))) fail('invalid_vault');
  }

  function contained(relative) {
    const target = path.resolve(vault, relative);
    const difference = path.relative(vault, target);
    if (!difference || difference === '..' || difference.startsWith(`..${path.sep}`) || path.isAbsolute(difference)) fail('invalid_path');
    return target;
  }

  function directory(relative, create = false) {
    const target = contained(relative);
    let current = vault;
    for (const segment of path.relative(vault, target).split(path.sep)) {
      current = path.join(current, segment);
      if (assertDirectory(current)) continue;
      if (!create) return false;
      try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      if (!assertDirectory(current)) fail('invalid_directory');
    }
    return true;
  }

  function locations(type, key, version = null) {
    validateKey(type, key);
    if (version !== null && (!Number.isSafeInteger(version) || version < 1)) fail('invalid_version');
    const folder = type === 'daily'
      ? path.join(ROOT, '日报', key.slice(0, 4), key.slice(5, 7))
      : path.join(ROOT, '周报');
    const relative = path.join(folder, version === null ? '' : '版本', `${key}${version === null ? '' : `-v${version}`}.md`);
    return { type, key, version, folder, relative, path: contained(relative) };
  }

  function readLocation(location) {
    if (!directory(path.dirname(location.relative))) return { ...location, exists: false, content: '', revision: null, updatedAt: null };
    const stat = statOrNull(location.path);
    if (!stat) return { ...location, exists: false, content: '', revision: null, updatedAt: null };
    if (stat.isSymbolicLink()) fail('symlink_not_allowed');
    if (!stat.isFile()) fail('invalid_file');
    if (stat.size > MAX_BYTES) fail('report_too_large');
    const descriptor = fs.openSync(location.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const opened = fs.fstatSync(descriptor);
      if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) fail('invalid_file');
      if (opened.size > MAX_BYTES) fail('report_too_large');
      const content = fs.readFileSync(descriptor, 'utf8');
      if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) fail('report_too_large');
      return { ...location, exists: true, content, revision: revision(content), updatedAt: opened.mtimeMs };
    } finally { fs.closeSync(descriptor); }
  }

  function publicRow(row) {
    const { folder, relative, ...publicFields } = row;
    return { ...publicFields, isVersion: row.version !== null };
  }

  function get(type, key, version = null) {
    return resultOf(() => {
      assertVault();
      return { ok: true, ...publicRow(readLocation(locations(type, key, version))) };
    });
  }

  function checkRevision(current, expected) {
    if (current.revision !== expected) fail('revision_conflict', { currentRevision: current.revision, expectedRevision: expected });
  }

  function snapshot(current) {
    const relativeFolder = path.join(current.folder, '版本');
    directory(relativeFolder, true);
    const versionFolder = contained(relativeFolder);
    let next = 1;
    for (const entry of fs.readdirSync(versionFolder, { withFileTypes: true })) {
      const match = new RegExp(`^${current.key}-v([1-9]\\d*)\\.md$`).exec(entry.name);
      if (!match) continue;
      if (entry.isSymbolicLink()) fail('symlink_not_allowed');
      const number = Number(match[1]);
      if (Number.isSafeInteger(number)) next = Math.max(next, number + 1);
    }
    for (let attempt = 0; attempt < 100; attempt += 1, next += 1) {
      if (!Number.isSafeInteger(next)) fail('invalid_version');
      const destination = locations(current.type, current.key, next).path;
      try {
        fs.writeFileSync(destination, current.content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        return { version: next, path: destination };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (statOrNull(destination)?.isSymbolicLink()) fail('symlink_not_allowed');
      }
    }
    fail('store_busy');
  }

  function save(payload) {
    return resultOf(() => {
      assertVault();
      if (!payload || payload.confirmed !== true) fail('confirmation_required');
      if (!Object.prototype.hasOwnProperty.call(payload, 'expectedRevision')) fail('revision_required');
      if (payload.expectedRevision !== null && !/^[a-f0-9]{64}$/.test(payload.expectedRevision)) fail('invalid_revision');
      if (typeof payload.content !== 'string' || !payload.content.trim()) fail('invalid_content');
      if (Buffer.byteLength(payload.content, 'utf8') > MAX_BYTES) fail('report_too_large');
      const location = locations(payload.type, payload.key);
      let current = readLocation(location);
      checkRevision(current, payload.expectedRevision);
      if (current.exists && current.content === payload.content) {
        return { ok: true, ...publicRow(current), unchanged: true, archivedVersion: null };
      }
      directory(ROOT, true);
      const lock = contained(path.join(ROOT, '.report-store.lock'));
      if (statOrNull(lock)?.isSymbolicLink()) fail('symlink_not_allowed');
      try { fs.mkdirSync(lock, { mode: 0o700 }); } catch (error) {
        if (error.code === 'EEXIST') fail('store_busy');
        throw error;
      }
      let temporary = null;
      try {
        assertVault();
        current = readLocation(location);
        checkRevision(current, payload.expectedRevision);
        directory(location.folder, true);
        temporary = contained(path.join(location.folder, `.${payload.key}-${crypto.randomUUID()}.tmp`));
        const descriptor = fs.openSync(temporary, 'wx', 0o600);
        try {
          fs.writeFileSync(descriptor, payload.content, 'utf8');
          fs.fsyncSync(descriptor);
        } finally { fs.closeSync(descriptor); }
        assertVault();
        checkRevision(readLocation(location), payload.expectedRevision);
        const archived = current.exists ? snapshot(current) : null;
        checkRevision(readLocation(location), payload.expectedRevision);
        fs.renameSync(temporary, location.path);
        temporary = null;
        return { ok: true, ...publicRow(readLocation(location)), unchanged: false, archivedVersion: archived?.version || null };
      } finally {
        if (temporary) { try { fs.unlinkSync(temporary); } catch (error) {} }
        try { fs.rmdirSync(lock); } catch (error) {}
      }
    });
  }

  function list(type) {
    return resultOf(() => {
      assertVault();
      if (type !== 'daily' && type !== 'weekly') fail('invalid_type');
      const root = path.join(ROOT, type === 'daily' ? '日报' : '周报');
      const rows = [];
      const scan = (folder, versions = false) => {
        if (!directory(folder)) return;
        for (const entry of fs.readdirSync(contained(folder), { withFileTypes: true })) {
          if (!versions && entry.name === '版本') { scan(path.join(folder, '版本'), true); continue; }
          const pattern = type === 'daily'
            ? /^(\d{4}-\d{2}-\d{2})(?:-v([1-9]\d*))?\.md$/
            : /^(\d{4}-W\d{2})(?:-v([1-9]\d*))?\.md$/;
          const match = pattern.exec(entry.name);
          if (!match || Boolean(match[2]) !== versions) continue;
          let location;
          try { location = locations(type, match[1], versions ? Number(match[2]) : null); } catch (error) {
            if (error.code === 'invalid_key' || error.code === 'invalid_version') continue;
            throw error;
          }
          if (location.path !== contained(path.join(folder, entry.name))) continue;
          if (entry.isSymbolicLink()) fail('symlink_not_allowed');
          if (!entry.isFile()) continue;
          rows.push(publicRow(readLocation(location)));
        }
      };
      if (type === 'weekly') scan(root);
      else if (directory(root)) {
        for (const year of fs.readdirSync(contained(root), { withFileTypes: true })) {
          if (!/^\d{4}$/.test(year.name) || Number(year.name) < 1) continue;
          const yearPath = path.join(root, year.name);
          if (!directory(yearPath)) continue;
          for (const month of fs.readdirSync(contained(yearPath), { withFileTypes: true })) {
            if (!/^(0[1-9]|1[0-2])$/.test(month.name)) continue;
            scan(path.join(yearPath, month.name));
          }
        }
      }
      rows.sort((a, b) => b.key.localeCompare(a.key) || (a.version === null ? -1 : b.version === null ? 1 : b.version - a.version));
      return { ok: true, type, vault, rows };
    });
  }

  function weeklySources(weekKey) {
    return resultOf(() => {
      assertVault();
      validateKey('weekly', weekKey);
      const monday = weekMonday(Number(weekKey.slice(0, 4)), Number(weekKey.slice(6)));
      const items = [];
      for (let day = 0; day < 7; day += 1) {
        const key = dateKey(new Date(monday.getTime() + day * DAY_MS));
        const row = readLocation(locations('daily', key));
        if (row.exists) items.push({ key, content: row.content, revision: row.revision });
      }
      return { ok: true, weekKey, items };
    });
  }

  return { get, save, list, weeklySources };
}

module.exports = { createReportStore };
