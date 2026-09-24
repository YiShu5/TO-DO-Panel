const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { syncPrompts, noteUri, FOLDER } = require('../obsidian-prompts');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-panel-obsidian-'));
  fs.mkdirSync(path.join(root, '.obsidian'));
  return root;
}

test('syncPrompts writes prompt notes and records stable ownership', () => {
  const vault = fixture();
  const state = path.join(vault, 'state.json');
  const command = { id: 'command-1', title: '写周报', text: '请整理本周工作' };
  const result = syncPrompts(vault, [command], state);
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  const file = result.files[command.id];
  assert.match(file, new RegExp(`${FOLDER}/写周报--`));
  assert.match(fs.readFileSync(file, 'utf8'), /todo_panel_id: "command-1"/);
  assert.equal(syncPrompts(vault, [command], state).conflicts.length, 0);
  assert.match(noteUri(vault, file), /^obsidian:\/\/open\?vault=/);
});

test('syncPrompts preserves an Obsidian edit as a conflict', () => {
  const vault = fixture();
  const state = path.join(vault, 'state.json');
  const command = { id: 'command-1', title: '提示词', text: '原文' };
  const first = syncPrompts(vault, [command], state);
  fs.appendFileSync(first.files[command.id], '\nObsidian 修改\n');
  const result = syncPrompts(vault, [{ ...command, text: '面板新内容' }], state);
  assert.deepEqual(result.conflicts, ['command-1']);
  assert.match(fs.readFileSync(first.files[command.id], 'utf8'), /Obsidian 修改/);
});
