const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FOLDER = 'TO-DO Panel 提示词';
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');

function discoverVaults(configPath) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return Object.values(config.vaults || {}).filter((v) => typeof v.path === 'string'
      && path.isAbsolute(v.path) && fs.existsSync(path.join(v.path, '.obsidian')));
  } catch { return []; }
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return { entries: {} };
    throw new Error('同步记录无法读取，请保留现有文件后检查配置');
  }
}

function atomicWrite(file, text) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}

function normalizeCommands(commands) {
  if (!Array.isArray(commands) || commands.length > 2000) throw new Error('提示词数据无效');
  const ids = new Set();
  return commands.map((c) => {
    if (!c || typeof c.id !== 'string' || !c.id || c.id.length > 200 || ids.has(c.id)
      || typeof c.text !== 'string' || c.text.length > 100000 || typeof c.title !== 'string') {
      throw new Error('提示词数据无效');
    }
    ids.add(c.id);
    return { id: c.id, title: c.title.slice(0, 200), text: c.text };
  });
}

function syncPrompts(vault, commands, stateFile) {
  const rows = normalizeCommands(commands);
  if (!path.isAbsolute(vault) || !fs.existsSync(path.join(vault, '.obsidian'))) {
    throw new Error('Obsidian 笔记库不可用，请重新选择');
  }
  const root = fs.realpathSync(vault);
  const directory = path.join(root, FOLDER);
  fs.mkdirSync(directory, { recursive: true });
  if (fs.realpathSync(directory) !== directory) throw new Error('同步目录不能是符号链接');
  const state = readState(stateFile);
  if (state.vault && state.vault !== root) throw new Error('同步记录与笔记库不一致');
  state.vault = root;
  state.entries ||= {};
  const files = {};
  const conflicts = [];
  for (const command of rows) {
    const key = hash(command.id);
    const previous = state.entries[key];
    const slug = command.title.replace(/[\x00-\x1f/\\:*?"<>|#^[\]]/g, '-').trim().slice(0, 60) || '未命名提示词';
    const name = previous?.name || `${slug}--${key.slice(0, 16)}.md`;
    if (path.basename(name) !== name || !name.endsWith('.md')) throw new Error('同步文件路径无效');
    const file = path.join(directory, name);
    const content = `---\ntitle: ${JSON.stringify(command.title)}\ntodo_panel_id: ${JSON.stringify(command.id)}\nsource: TO-DO Panel\n---\n\n# ${command.title.replace(/[\r\n]/g, ' ')}\n\n${command.text}\n`;
    const digest = hash(content);
    let existing;
    if (fs.existsSync(file)) {
      if (!fs.lstatSync(file).isFile()) throw new Error('同步目标不是普通文件');
      existing = fs.readFileSync(file, 'utf8');
      if (existing !== content && (!previous || hash(existing) !== previous.hash)) {
        conflicts.push(command.id);
        if (previous) files[command.id] = file;
        continue;
      }
    }
    if (existing !== content) atomicWrite(file, content);
    state.entries[key] = { name, hash: digest };
    files[command.id] = file;
    // Record each completed file, so a later failure cannot lose ownership metadata.
    atomicWrite(stateFile, JSON.stringify(state, null, 2));
  }
  // Removing a panel shortcut intentionally keeps its Obsidian note.
  return { ok: true, count: rows.length - conflicts.length, conflicts, files, vault: root };
}

function noteUri(vault, file) {
  const root = fs.realpathSync(vault);
  const relative = path.relative(root, file).split(path.sep).join('/');
  return `obsidian://open?vault=${encodeURIComponent(path.basename(root))}&file=${encodeURIComponent(relative)}`;
}

module.exports = { discoverVaults, syncPrompts, noteUri, FOLDER };
