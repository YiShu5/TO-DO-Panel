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

function reportApi() { return window.reportAPI || window.notchAPI || {}; }

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

function readDraft(type) {
  const fallback = defaultDraft(type);
  try {
    const parsed = JSON.parse(localStorage.getItem(`${DRAFT_PREFIX}${type}`) || 'null');
    if (!parsed || typeof parsed !== 'object') return fallback;
    return { ...fallback, ...parsed, key: String(parsed.key || fallback.key) };
  } catch (error) { return fallback; }
}

function writeDraft() {
  const value = { key: currentKey(), work: workInput.value, plan: planInput.value, preview: previewInput.value };
  try { localStorage.setItem(`${DRAFT_PREFIX}${reportType}`, JSON.stringify(value)); } catch (error) {}
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

async function loadDraftForType() {
  const draft = readDraft(reportType);
  if (reportType === DAILY) dailyDateEl.value = /^\d{4}-\d{2}-\d{2}$/.test(draft.key) ? draft.key : localDateKey();
  else weeklyDateEl.value = /^\d{4}-W\d{2}$/.test(draft.key) ? draft.key : isoWeekKey();
  workInput.value = draft.work || '';
  planInput.value = draft.plan || '';
  previewInput.value = draft.preview || '';
  previewInput.dataset.auto = previewInput.value ? 'false' : 'true';
  updateLabels();
  updatePreview(false);
  currentRevision = null;
  const latest = await reportApi().get?.({ type: reportType, key: currentKey() }).catch(() => null);
  if (latest?.exists && !draft.preview) {
    const parsed = window.ReportFormat?.parse ? window.ReportFormat.parse(latest.content) : { work: '', plan: '' };
    workInput.value = parsed.work || workInput.value;
    planInput.value = parsed.plan || planInput.value;
    previewInput.value = latest.content || previewInput.value;
    previewInput.dataset.auto = 'false';
  }
  if (latest?.exists) currentRevision = latest.revision || null;
  if (reportType === WEEKLY && !workInput.value.trim()) await prefillWeeklyFromDaily();
}

async function prefillWeeklyFromDaily() {
  const result = await reportApi().weeklySources?.({ weekKey: currentKey() }).catch(() => null);
  if (!result?.ok || !result.items?.length) return;
  const summary = window.ReportFormat?.summarizeSources
    ? window.ReportFormat.summarizeSources(result.items)
    : result.items.map((item) => item.content).join('\n');
  if (!summary.trim()) return;
  workInput.value = summary;
  updatePreview(true);
  showToast('已从本周日报带入工作进展，请核对后保存');
}

function setReportType(nextType) {
  reportType = nextType === WEEKLY ? WEEKLY : DAILY;
  void loadDraftForType();
  void loadHistory();
}

function humanDate(key) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1年$2月$3日');
  return key;
}

async function loadConfig() {
  const result = await reportApi().getConfig?.().catch(() => null);
  if (result?.vault) vaultPathEl.textContent = result.vault;
}

async function loadHistory() {
  const result = await reportApi().list?.({ type: reportType }).catch(() => null);
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
  const result = await reportApi().get?.({ type: reportType, key: button.dataset.key, version: button.dataset.version ? Number(button.dataset.version) : undefined }).catch(() => null);
  if (!result?.ok) return showToast('这份历史记录暂时读不到');
  previewInput.value = result.content || '';
  previewInput.dataset.auto = 'false';
  showToast('已载入历史版本，可以继续修改后另存');
}

async function saveReport() {
  const content = previewInput.value.trim() || buildBody(reportType, currentKey(), workInput.value, planInput.value);
  if (!content || !currentKey()) return showToast('请先填写报告内容');
  const formatError = window.ReportFormat?.validate?.(reportType, currentKey(), content);
  if (formatError) {
    saveStatusEl.textContent = formatError;
    return showToast('请先把正文改成日报/周报格式');
  }
  saveButton.disabled = true;
  const result = await reportApi().save?.({ type: reportType, key: currentKey(), content, expectedRevision: currentRevision, confirmed: true }).catch(() => null);
  saveButton.disabled = false;
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
  saveStatusEl.textContent = result.version ? `已保存当前稿，旧稿保留为 v${result.version}` : '已保存首个版本';
  showToast('已写入 Obsidian');
  await loadHistory();
}

async function copyReport() {
  const content = previewInput.value.trim();
  if (!content) return showToast('没有可复制的正文');
  const copied = await reportApi().copy?.({ type: reportType, key: currentKey(), revision: currentRevision, content, confirmed: true }).catch(() => false);
  if (copied?.ok === true || copied === true) return showToast('正文已复制，可直接粘贴到微信');
  showToast('请先保存并确认正文，再复制');
}

[workInput, planInput].forEach((input) => input.addEventListener('input', () => updatePreview(true)));
previewInput.addEventListener('input', () => { previewInput.dataset.auto = 'false'; writeDraft(); });
dailyDateEl.addEventListener('change', () => updatePreview(true));
weeklyDateEl.addEventListener('change', () => updatePreview(true));
saveButton.addEventListener('click', saveReport);
copyButton.addEventListener('click', copyReport);
historyListEl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-key]');
  if (button) void openHistoryRow(button);
});
switcherButtons.forEach((button) => button.addEventListener('click', () => setReportType(button.dataset.reportType)));
openVaultButton.addEventListener('click', () => reportApi().openVault?.());
chooseVaultButton.addEventListener('click', async () => {
  const result = await reportApi().chooseVault?.().catch(() => null);
  if (result?.ok) { vaultPathEl.textContent = result.vault; showToast('知识库路径已更新'); }
});
reportApi().onFocusType?.(setReportType);

loadDraftForType();
void loadConfig();
void loadHistory();
