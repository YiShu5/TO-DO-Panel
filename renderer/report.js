const DAILY = 'daily';
const WEEKLY = 'weekly';
const DRAFT_PREFIX = 'todo-panel-report-draft-';

const titleEl = document.getElementById('report-title');
const periodLabelEl = document.getElementById('period-label');
const dailyPeriodEl = document.getElementById('daily-period');
const weeklyPeriodEl = document.getElementById('weekly-period');
const dailyDateEl = document.getElementById('daily-date');
const weeklyDateEl = document.getElementById('weekly-date');
const workLabelEl = document.getElementById('work-label');
const planLabelEl = document.getElementById('plan-label');
const workInput = document.getElementById('work-input');
const planInput = document.getElementById('plan-input');
const previewInput = document.getElementById('preview-input');
const saveButton = document.getElementById('save-report');
const copyButton = document.getElementById('copy-report');
const saveStatusEl = document.getElementById('save-status');
const historyListEl = document.getElementById('history-list');
const vaultPathEl = document.getElementById('vault-path');
const toastEl = document.getElementById('toast');
const openVaultButton = document.getElementById('open-vault');
const chooseVaultButton = document.getElementById('choose-vault');
const backToPanelButton = document.getElementById('back-to-panel');
const switcherButtons = Array.from(document.querySelectorAll('[data-report-switcher]'));

let reportType = new URLSearchParams(location.search).get('type') === WEEKLY ? WEEKLY : DAILY;
let toastTimer = null;
let currentRevision = null;
let vault = '';
let scope = null;
let generation = 0;
let historyGeneration = 0;
let loading = true;
let saving = false;

function reportApi() { return window.reportAPI || window.parent?.PanelReport?.api || {}; }

if (backToPanelButton) {
  const api = reportApi();
  backToPanelButton.hidden = typeof api.returnHome !== 'function';
  backToPanelButton.addEventListener('click', () => api.returnHome?.());
}

function pad2(value) { return String(value).padStart(2, '0'); }

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function isoWeekKey(date = new Date()) {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((copy - yearStart) / 86400000) + 1) / 7);
  return `${copy.getUTCFullYear()}-W${pad2(week)}`;
}

function stripBullet(line) {
  return String(line || '').trim()
    .replace(/^[-*•]\s*/, '')
    .replace(/^\d+[.、)]\s*/, '')
    .trim();
}

function normalizeWorkLines(raw) {
  return String(raw || '').split(/\r?\n/)
    .map(stripBullet)
    .filter(Boolean)
    .map((line) => {
      if (/^✅\s*[：:]/.test(line)) return `✅：${line.replace(/^✅\s*[：:]\s*/, '')}`;
      if (/^🚶\s*[：:]/.test(line)) return `🚶：${line.replace(/^🚶\s*[：:]\s*/, '')}`;
      if (/^✅/.test(line)) return `✅：${line.slice(1).trim()}`;
      if (/^🚶/.test(line)) return `🚶：${line.slice(1).trim()}`;
      return `🚶：${line}`;
    });
}

function normalizePlanLines(raw) {
  return String(raw || '').split(/\r?\n/).map(stripBullet).filter(Boolean);
}

function buildBody(type, key, work, plan) {
  if (window.ReportFormat?.build) return window.ReportFormat.build({ type, key, work, plan });
  const workLines = normalizeWorkLines(work);
  const planLines = normalizePlanLines(plan);
  const body = [];
  if (type === DAILY) {
    const [year, month, day] = key.split('-').map(Number);
    body.push(`${month}月${day}日工作总结`);
  } else {
    body.push('本周工作进展');
  }
  if (workLines.length) body.push(...workLines);
  if (!workLines.length) body.push('🚶：');
  body.push('');
  body.push(type === DAILY ? '明日计划：' : '下周计划');
  planLines.forEach((line, index) => body.push(`${index + 1}、${line}`));
  return body.join('\n');
}

function defaultDraft(type) {
  const key = type === DAILY ? localDateKey() : isoWeekKey();
  return { key, work: '', plan: '', preview: '' };
}

function draftKey(target) {
  return `${DRAFT_PREFIX}v2:${JSON.stringify([target.vault, target.type, target.key])}`;
}

function readDraft(target) {
  try {
    const stored = localStorage.getItem(draftKey(target));
    if (stored) return JSON.parse(stored);
    // Preserve the old single-draft format without reusing it across vaults.
    const legacyKey = `${DRAFT_PREFIX}${target.type}`;
    const legacy = JSON.parse(localStorage.getItem(legacyKey) || 'null');
    const owner = localStorage.getItem(`${legacyKey}:owner`);
    if (legacy?.key === target.key && (!owner || owner === target.vault)) {
      localStorage.setItem(`${legacyKey}:owner`, target.vault);
      return legacy;
    }
  } catch (error) { /* A malformed draft must not block reading the saved report. */ }
  return null;
}

function writeDraft() {
  if (!scope || loading) return;
  const value = { key: scope.key, work: workInput.value, plan: planInput.value,
    preview: previewInput.value, revision: currentRevision, auto: previewInput.dataset.auto === 'true' };
  try { localStorage.setItem(draftKey(scope), JSON.stringify(value)); }
  catch (error) { saveStatusEl.textContent = '本机草稿未能保存，请复制正文备份。'; }
}

function currentKey() { return reportType === DAILY ? dailyDateEl.value : weeklyDateEl.value; }

function showToast(message) {
  if (!toastEl) return;
  if (toastTimer) clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.add('visible');
  toastEl.setAttribute('aria-hidden', 'false');
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('visible');
    toastEl.setAttribute('aria-hidden', 'true');
  }, 2600);
}

function updatePreview(force = false) {
  const key = currentKey();
  const next = buildBody(reportType, key, workInput.value, planInput.value);
  if (force || !previewInput.value.trim() || previewInput.dataset.auto === 'true') {
    previewInput.value = next;
    previewInput.dataset.auto = 'true';
  }
  writeDraft();
}

function updateLabels() {
  const weekly = reportType === WEEKLY;
  titleEl.textContent = weekly ? '周报' : '日报';
  document.title = `${weekly ? '周报' : '日报'} · TO-DO Panel`;
  periodLabelEl.textContent = weekly ? '这一周' : '今天';
  dailyPeriodEl.hidden = weekly;
  weeklyPeriodEl.hidden = !weekly;
  workLabelEl.textContent = weekly ? '这一周做了什么？' : '今天做了什么？';
  planLabelEl.textContent = weekly ? '下周准备做什么？' : '明天准备做什么？';
  workInput.placeholder = weekly
    ? '一行写一件本周工作。明确完成的事项前面写 ✅，正在推进的写 🚶。'
    : '一行写一件事。明确完成的事项前面写 ✅，正在推进的写 🚶。';
  switcherButtons.forEach((button) => button.classList.toggle('active', button.dataset.reportType === reportType));
}

function syncControls() {
  [workInput, planInput, previewInput].forEach((el) => { el.disabled = loading || saving; });
  saveButton.disabled = loading || saving || !vault;
  copyButton.disabled = loading || saving;
  [dailyDateEl, weeklyDateEl, chooseVaultButton, ...switcherButtons].forEach((el) => { el.disabled = saving; });
  document.getElementById('reload-report').disabled = loading || saving || !vault;
  document.getElementById('regenerate-report').disabled = loading || saving;
  historyListEl.inert = saving;
  openVaultButton.disabled = !vault;
}

function setBody(content) {
  const parsed = window.ReportFormat.parse(content);
  workInput.value = parsed.work;
  planInput.value = parsed.plan;
  previewInput.value = content;
  previewInput.dataset.auto = 'false';
}

async function loadReport(key = currentKey(), { fromDisk = false, version } = {}) {
  if (saving || !key) return;
  writeDraft();
  const token = ++generation;
  const target = { vault, type: reportType, key };
  scope = target;
  (reportType === DAILY ? dailyDateEl : weeklyDateEl).value = key;
  loading = true;
  syncControls();
  currentRevision = null;
  workInput.value = planInput.value = previewInput.value = '';
  saveStatusEl.textContent = '';
  updateLabels();
  const draft = fromDisk ? null : readDraft(target);
  const latest = vault ? await reportApi().get({ type: target.type, key }).catch(() => null) : null;
  if (token !== generation) return;
  let historical = null;
  if (version != null) {
    historical = await reportApi().get({ type: target.type, key, version }).catch(() => null);
    if (token !== generation) return;
  }
  if (historical?.ok && historical.exists) {
    setBody(historical.content);
    currentRevision = latest?.revision || null;
  } else if (draft?.preview) {
    workInput.value = draft.work || '';
    planInput.value = draft.plan || '';
    previewInput.value = draft.preview;
    previewInput.dataset.auto = draft.auto ? 'true' : 'false';
    // A draft's base revision must never be replaced with a newer disk revision.
    currentRevision = Object.hasOwn(draft, 'revision') ? draft.revision
      : latest?.content === draft.preview ? latest.revision : null;
    if ((latest?.revision || null) !== currentRevision) {
      saveStatusEl.textContent = 'Obsidian 原稿已变化。已保留本机草稿；复制备份或载入原稿后再编辑。';
    }
  } else if (latest?.ok && latest.exists) {
    setBody(latest.content);
    currentRevision = latest.revision;
  } else {
    previewInput.dataset.auto = 'true';
    if (target.type === WEEKLY && vault && latest?.ok) {
      const sources = await reportApi().weeklySources({ weekKey: key }).catch(() => null);
      if (token !== generation) return;
      if (sources?.ok) workInput.value = window.ReportFormat.summarizeSources(sources.items || []);
    }
    previewInput.value = buildBody(target.type, key, workInput.value, planInput.value);
  }
  if (!vault) saveStatusEl.textContent = '请先选择你的 Obsidian 知识库；未选择时也可写草稿和复制。';
  else if (!latest?.ok) saveStatusEl.textContent = '未能读取原稿，请检查知识库路径后重新载入。';
  if (version != null && !historical?.exists) showToast('这份历史版本暂时读不到');
  loading = false;
  syncControls();
  writeDraft();
}

async function setReportType(nextType) {
  if (saving) return;
  writeDraft();
  reportType = nextType === WEEKLY ? WEEKLY : DAILY;
  const key = (reportType === DAILY ? dailyDateEl : weeklyDateEl).value || defaultDraft(reportType).key;
  await Promise.all([loadReport(key), loadHistory()]);
}

function humanDate(key) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1年$2月$3日');
  return key;
}

async function loadConfig() {
  const result = await reportApi().getConfig?.().catch(() => null);
  vault = result?.vault || '';
  vaultPathEl.textContent = vault || '尚未选择 Obsidian 知识库';
}

async function loadHistory() {
  const token = ++historyGeneration;
  historyListEl.innerHTML = '';
  if (!vault) return;
  const result = await reportApi().list?.({ type: reportType }).catch(() => null);
  if (token !== historyGeneration) return;
  if (!result?.ok) return;
  if (result.vault) vaultPathEl.textContent = result.vault;
  if (!result.rows?.length) {
    historyListEl.innerHTML = '<p class="empty-history">还没有保存记录。第一次保存后，旧版本会自动留在“版本”文件夹。</p>';
    return;
  }
  historyListEl.innerHTML = '';
  result.rows.forEach((row) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.key = row.key;
    if (row.version) button.dataset.version = String(row.version);
    const title = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = humanDate(row.key);
    const small = document.createElement('small');
    small.textContent = row.isVersion ? '历史版本' : '当前版本';
    title.append(strong, small);
    const tag = document.createElement('em');
    tag.textContent = row.isVersion ? `v${row.version || '?'}` : '最新';
    button.append(title, tag);
    historyListEl.append(button);
  });
}

async function openHistoryRow(button) {
  if (saving) return;
  backupDraft();
  await loadReport(button.dataset.key, { fromDisk: true,
    version: button.dataset.version ? Number(button.dataset.version) : undefined });
}

async function saveReport() {
  if (loading || saving || !vault) return;
  const content = previewInput.value.trim() || buildBody(reportType, currentKey(), workInput.value, planInput.value);
  if (!content || !currentKey()) return showToast('请先填写报告内容');
  const formatError = window.ReportFormat?.validate?.(reportType, currentKey(), content);
  if (formatError) {
    saveStatusEl.textContent = formatError;
    return showToast('请先把正文改成日报/周报格式');
  }
  saving = true;
  syncControls();
  const result = await reportApi().save?.({ vault, type: reportType, key: currentKey(), content, expectedRevision: currentRevision, confirmed: true }).catch(() => null);
  saving = false;
  syncControls();
  if (!result?.ok) {
    if (result?.error === 'conflict' || result?.error === 'revision_conflict') {
      saveStatusEl.textContent = 'Obsidian 里的原稿已变化，请重新载入后再保存。';
      return showToast('检测到外部修改，未覆盖原稿');
    }
    saveStatusEl.textContent = '保存失败，请检查 Obsidian 知识库路径。';
    return showToast('保存失败');
  }
  previewInput.value = content;
  previewInput.dataset.auto = 'false';
  currentRevision = result.revision || currentRevision;
  writeDraft();
  saveStatusEl.textContent = result.unchanged ? '正文未变化，无需新增版本'
    : result.archivedVersion ? `已保存当前稿，旧稿保留为 v${result.archivedVersion}` : '已保存首个版本';
  showToast('已写入 Obsidian');
  await loadHistory();
}

async function copyReport() {
  if (loading || saving) return;
  const content = previewInput.value.trim();
  if (!content) return showToast('没有可复制的正文');
  const copied = await reportApi().copy?.({ type: reportType, key: currentKey(), revision: currentRevision, content, confirmed: true }).catch(() => false);
  if (copied?.ok === true || copied === true) return showToast('正文已复制，可直接粘贴到微信');
  showToast('复制失败，请重试');
}

[workInput, planInput].forEach((input) => input.addEventListener('input', () => {
  updatePreview(false);
  if (previewInput.dataset.auto === 'false') saveStatusEl.textContent = '已保留手动正文。如需采用左侧修改，请点击“按左侧重新生成”。';
}));
previewInput.addEventListener('input', () => { previewInput.dataset.auto = 'false'; writeDraft(); });
dailyDateEl.addEventListener('change', () => loadReport(dailyDateEl.value));
weeklyDateEl.addEventListener('change', () => loadReport(weeklyDateEl.value));
saveButton.addEventListener('click', saveReport);
copyButton.addEventListener('click', copyReport);
historyListEl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-key]');
  if (button) void openHistoryRow(button);
});
switcherButtons.forEach((button) => button.addEventListener('click', () => setReportType(button.dataset.reportType)));
openVaultButton.addEventListener('click', () => reportApi().openVault?.());
chooseVaultButton.addEventListener('click', async () => {
  if (saving) return;
  writeDraft();
  ++generation;
  ++historyGeneration;
  loading = true;
  syncControls();
  chooseVaultButton.disabled = true;
  const result = await reportApi().chooseVault?.().catch(() => null);
  if (result?.ok) {
    vault = result.vault;
    vaultPathEl.textContent = vault;
    showToast('知识库路径已更新');
  }
  await Promise.all([loadReport(), loadHistory()]);
});
reportApi().onFocusType?.(setReportType);

function backupDraft() {
  if (loading || !scope) return;
  writeDraft();
  const raw = localStorage.getItem(draftKey(scope));
  if (raw) localStorage.setItem(`${draftKey(scope)}:backup:${Date.now()}`, raw);
}
document.getElementById('reload-report').addEventListener('click', async () => {
  backupDraft();
  await loadReport(currentKey(), { fromDisk: true });
  showToast('已载入原稿，之前的草稿已保留在本机备份中');
});
document.getElementById('regenerate-report').addEventListener('click', () => {
  if (loading || saving) return;
  backupDraft();
  updatePreview(true);
  saveStatusEl.textContent = '已按左侧重新生成，之前的正文已备份';
});
document.addEventListener('focusin', () => window.parent?.PanelReport?.setTextEntryActive(
  document.activeElement?.matches('textarea, input') === true));
document.addEventListener('focusout', () => queueMicrotask(() => window.parent?.PanelReport?.setTextEntryActive(
  document.activeElement?.matches('textarea, input') === true)));
window.addEventListener('beforeunload', writeDraft);
const ready = (async () => {
  await loadConfig();
  await setReportType(reportType);
})();
window.ReportPanel = { setType: async (type) => { await ready; return setReportType(type); }, ready };
