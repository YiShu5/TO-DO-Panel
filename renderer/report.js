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
const summaryInput = document.getElementById('summary-input');
const summaryField = document.getElementById('summary-field');
const weekendNote = document.getElementById('weekend-note');
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
const weekSourcesEl = document.getElementById('week-sources');
const sourceDetail = document.getElementById('source-detail');
const sourceStatus = document.getElementById('source-status');
const reviewSources = document.getElementById('review-sources');
const weeklyUpdate = document.getElementById('weekly-update');
const weeklyUpdateBody = document.getElementById('weekly-update-body');

let reportType = new URLSearchParams(location.search).get('type') === WEEKLY ? WEEKLY : DAILY;
let toastTimer = null;
let currentRevision = null;
let vault = '';
let scope = null;
let generation = 0;
let historyGeneration = 0;
let loading = true;
let saving = false;
let weekSources = { days: [], items: [], signature: '', failed: false };
let draftSourceSignature = null;
let selectedSource = '';

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

function buildBody(type, key, work, plan, summary = summaryInput.value) {
  return window.ReportFormat.build({ type, key, work, plan, summary });
}

function defaultDraft(type) {
  const key = type === DAILY ? localDateKey() : isoWeekKey();
  return { key, work: '', plan: '', summary: '', preview: '' };
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
  if (!scope || loading) return false;
  const value = { key: scope.key, work: workInput.value, plan: planInput.value,
    summary: summaryInput.value, formatVersion: 3,
    preview: previewInput.value, revision: currentRevision, auto: previewInput.dataset.auto === 'true',
    ...(scope.type === WEEKLY ? { sourceSignature: draftSourceSignature } : {}) };
  try {
    localStorage.setItem(draftKey(scope), JSON.stringify(value));
    return true;
  } catch (error) {
    saveStatusEl.textContent = '本机草稿未能保存，请复制正文备份。';
    return false;
  }
}

function currentKey() { return reportType === DAILY ? dailyDateEl.value : weeklyDateEl.value; }

function weekForDate(key) {
  return window.ReportFormat.weekKey(new Date(`${key}T12:00:00`));
}

async function readWeekSources(target) {
  const week = target.type === WEEKLY ? target.key : weekForDate(target.key);
  const days = window.ReportFormat.weekdays(week);
  const saved = target.vault && days.length
    ? await reportApi().weeklySources?.({ weekKey: week }).catch(() => null) : null;
  const byDate = new Map((saved?.items || []).map(item => [item.key, item]));
  const items = [];
  let hash = 2166136261;
  for (const key of days) {
    const file = byDate.get(key);
    const local = readDraft({ vault: target.vault, type: DAILY, key });
    const localUsable = (!file || local?.revision === file.revision)
      && window.ReportFormat.hasReportContent(local?.preview);
    const content = localUsable ? local.preview : file?.content;
    if (!window.ReportFormat.hasReportContent(content)) continue;
    items.push({ key, content, local: localUsable && content !== file?.content });
    // Keep only a lightweight change detector in the weekly draft, not another
    // copy of all five daily bodies. This is not used for revision checks.
    for (const character of `${key}\0${content}\0`) {
      hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
    }
  }
  return { days, items, signature: String(hash >>> 0), failed: Boolean(target.vault && days.length && !saved?.ok) };
}

function dateLabel(key) {
  return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
}

function renderWeekSources() {
  const { days, items, failed, signature } = weekSources;
  const weekdays = ['周一', '周二', '周三', '周四', '周五'];
  const byDate = new Map(items.map(item => [item.key, item]));
  const activeDate = reportType === DAILY ? currentKey() : selectedSource;
  weekSourcesEl.replaceChildren(...days.map((key, index) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    const label = document.createElement('strong');
    const state = document.createElement('span');
    button.type = 'button';
    button.className = 'quiet-button week-source';
    button.dataset.date = key;
    if (key === activeDate) button.setAttribute('aria-current', 'true');
    label.className = 'week-source-date';
    label.textContent = `${weekdays[index]} · ${dateLabel(key)}`;
    state.className = 'week-source-state';
    state.textContent = byDate.get(key)?.local ? '本机草稿' : byDate.has(key) ? '已记录' : failed ? '待核对' : '未记录';
    button.append(label, state);
    li.append(button);
    return li;
  }));
  periodLabelEl.textContent = days.length ? `${dateLabel(days[0])} – ${dateLabel(days[4])}` : '';
  const detailKey = reportType === WEEKLY && days.includes(selectedSource) ? selectedSource : '';
  sourceDetail.hidden = !detailKey;
  if (detailKey) {
    document.getElementById('source-title').textContent = `${dateLabel(detailKey)} 日报`;
    document.getElementById('source-body').textContent = byDate.get(detailKey)?.content || (failed ? '暂时读不到这天的日报。' : '这天还没有记录。');
  }
  const changed = reportType === WEEKLY && !failed && draftSourceSignature !== null && draftSourceSignature !== signature;
  reviewSources.hidden = reportType !== WEEKLY || failed || !items.length || (draftSourceSignature !== null && !changed);
  sourceStatus.textContent = reportType === DAILY ? `${dateLabel(currentKey())} · 正文可自由书写`
    : changed ? `日报来源有变化 · 当前有 ${items.length}/5 天 · 已保留你的草稿`
      : items.length ? `${draftSourceSignature === null ? '可用' : '草稿来源'} ${items.length}/5 篇日报 · ${items.map(item => dateLabel(item.key)).join('、')}`
        : '本周还没有可汇总的日报，可以先写草稿';
  if (failed) sourceStatus.textContent += ' · Obsidian 来源暂时读不到';
}

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
  const context = window.ReportFormat.dailyContext(dailyDateEl.value);
  titleEl.textContent = weekly ? '周五汇报' : '日报';
  document.title = `${weekly ? '周报' : '日报'} · TO-DO Panel`;
  document.getElementById('preview-title').textContent = weekly ? '周五汇报正文' : '日报正文';
  document.getElementById('daily-template').hidden = weekly;
  copyButton.textContent = weekly ? '复制整份' : '复制正文';
  dailyPeriodEl.hidden = weekly;
  weeklyPeriodEl.hidden = !weekly;
  workLabelEl.textContent = weekly ? '本周工作进展' : '今日艾维利';
  planLabelEl.textContent = weekly ? '下周计划' : context.planHeading;
  summaryField.hidden = weekly || !context.requiresSummary;
  weekendNote.hidden = weekly || !context.requiresSummary;
  weekendNote.textContent = `明天是周末：可补充本周总结和下周一（${context.nextWorkdayKey}）计划，也可以先留空。`;
  workInput.placeholder = weekly
    ? '✅ 完成2场AI培训，覆盖销售和运营部门\n🚶‍♂️ Agent发布上线：已完成联调，待验收'
    : '✅ 完成1场销售部门的AI培训\n🚶‍♂️ Agent发布上线：已完成联调，待验收';
  document.getElementById('report-rules').textContent = weekly
    ? '格式建议：本周工作可用 ✅ / 🚶‍♂️ / ❌ 标注进度，下周计划直接写内容。各项可留空，也可在右侧自由书写；不影响保存或复制。'
    : '格式建议：今日事项可用 ✅ / 🚶‍♂️ / ❌ 标注进度，明日、下周一计划和本周总结直接写内容。各项可留空，也可在右侧自由书写；不影响保存或复制。';
  switcherButtons.forEach((button) => {
    const active = button.dataset.reportType === reportType;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function syncControls() {
  [workInput, planInput, summaryInput, previewInput].forEach((el) => { el.disabled = loading || saving; });
  saveButton.disabled = loading || saving || !vault;
  copyButton.disabled = loading || saving;
  [dailyDateEl, weeklyDateEl, chooseVaultButton, ...switcherButtons].forEach((el) => { el.disabled = saving; });
  document.getElementById('reload-report').disabled = loading || saving || !vault;
  document.getElementById('regenerate-report').disabled = loading || saving;
  historyListEl.inert = saving;
  weekSourcesEl.inert = loading || saving;
  reviewSources.disabled = loading || saving;
  document.getElementById('edit-source').disabled = loading || saving;
  openVaultButton.disabled = !vault;
}

function setBody(content) {
  const parsed = window.ReportFormat.parse(content);
  workInput.value = parsed.work;
  planInput.value = parsed.plan;
  summaryInput.value = parsed.summary || '';
  previewInput.value = content;
  previewInput.dataset.auto = 'false';
}

async function loadReport(key = currentKey(), { fromDisk = false, version } = {}) {
  if (saving || !key || (fromDisk && loading)) return false;
  if (weeklyUpdate.open) weeklyUpdate.close();
  writeDraft();
  const token = ++generation;
  const target = { vault, type: reportType, key };
  let original = null;
  if (fromDisk) {
    original = await reportApi().get?.({ type: target.type, key, version }).catch(() => null);
    if (token !== generation || saving) return false;
    if (!original?.ok || !original.exists) {
      showToast(original?.ok ? '还没有 Obsidian 原稿，当前草稿已保留' : '读取原稿失败，当前草稿已保留');
      return false;
    }
    try {
      backupDraft();
      if (scope && draftKey(target) !== draftKey(scope)) backupDraft(target);
    } catch (error) {
      showToast('无法备份当前稿，请先复制正文');
      return false;
    }
  }
  scope = target;
  (reportType === DAILY ? dailyDateEl : weeklyDateEl).value = key;
  loading = true;
  syncControls();
  currentRevision = null;
  draftSourceSignature = null;
  selectedSource = '';
  weekSourcesEl.replaceChildren();
  sourceDetail.hidden = reviewSources.hidden = true;
  sourceStatus.textContent = '正在读取本周日报…';
  workInput.value = planInput.value = summaryInput.value = previewInput.value = '';
  previewInput.dataset.auto = 'false';
  previewInput.removeAttribute('aria-invalid');
  saveStatusEl.textContent = '';
  updateLabels();
  const draft = fromDisk ? null : readDraft(target);
  const [latest, sources] = await Promise.all([
    fromDisk && version == null ? original : vault ? reportApi().get({ type: target.type, key }).catch(() => null) : null,
    readWeekSources(target),
  ]);
  if (token !== generation) return;
  weekSources = sources;
  const historical = version != null ? original : null;
  if (historical?.ok && historical.exists) {
    setBody(historical.content);
    currentRevision = latest?.revision || null;
  } else if (draft && (draft.preview || draft.auto === false || typeof draft.sourceSignature === 'string')
    && !(target.type === WEEKLY && draft.auto && !window.ReportFormat.hasReportContent(draft.preview) && !latest?.exists)) {
    workInput.value = draft.work || '';
    planInput.value = draft.plan || '';
    summaryInput.value = draft.summary || '';
    previewInput.value = draft.preview;
    draftSourceSignature = typeof draft.sourceSignature === 'string' ? draft.sourceSignature : null;
    previewInput.dataset.auto = draft.auto && draft.formatVersion === 3 ? 'true' : 'false';
    if (draft.formatVersion !== 3) {
      saveStatusEl.textContent = '已保留旧格式草稿，可直接保存或复制。';
    }
    // A draft's base revision must never be replaced with a newer disk revision.
    currentRevision = Object.hasOwn(draft, 'revision') ? draft.revision
      : latest?.content === draft.preview ? latest.revision : null;
    if ((latest?.revision || null) !== currentRevision) {
      saveStatusEl.textContent = 'Obsidian 原稿已变化。已保留本机草稿；复制备份或载入原稿后再编辑。';
    }
    if (target.type === DAILY && draft.auto && draft.formatVersion === 3 && !latest?.exists) {
      const activity = await reportApi().getActivitySnapshot?.({ type: target.type, key });
      if (token !== generation) return;
      if (activity?.ok && activity.work) {
        const existing = workInput.value.trim();
        const existingLines = new Set(existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
        const additions = activity.work.split(/\r?\n/).map((line) => line.trim())
          .filter((line) => line && !existingLines.has(line));
        if (additions.length) {
          workInput.value = existing ? `${existing}\n${additions.join('\n')}` : additions.join('\n');
          previewInput.value = buildBody(target.type, key, workInput.value, planInput.value);
          previewInput.dataset.auto = 'true';
          saveStatusEl.textContent = `已自动带出 ${additions.length} 条新增工作素材，可直接修改后保存。`;
        }
      }
    }
  } else if (latest?.ok && latest.exists) {
    setBody(latest.content);
    currentRevision = latest.revision;
  } else if (target.type === WEEKLY) {
    const friday = sources.days[4];
    if (friday) {
      setBody(window.ReportFormat.buildFridayDraft(friday, sources.items));
      draftSourceSignature = sources.signature;
      if (!sources.items.length) previewInput.dataset.auto = 'true';
    }
  } else {
    previewInput.dataset.auto = 'true';
    const activity = await reportApi().getActivitySnapshot?.({ type: target.type, key });
    if (token !== generation) return;
    if (activity?.ok && activity.work) {
      const existing = workInput.value.trim();
      const existingLines = new Set(existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
      const additions = activity.work.split(/\r?\n/).map((line) => line.trim())
        .filter((line) => line && !existingLines.has(line));
      if (additions.length) {
        workInput.value = existing ? `${existing}\n${additions.join('\n')}` : additions.join('\n');
        saveStatusEl.textContent = `已自动带出 ${additions.length} 条工作素材，可直接修改后保存。`;
      }
    }
    previewInput.value = buildBody(target.type, key, workInput.value, planInput.value);
  }
  if (!vault) saveStatusEl.textContent = '请先选择你的 Obsidian 知识库；未选择时也可写草稿和复制。';
  else if (!latest?.ok) saveStatusEl.textContent = '未能读取原稿，请检查知识库路径后重新载入。';
  loading = false;
  syncControls();
  renderWeekSources();
  writeDraft();
  return true;
}

async function setReportType(nextType, requestedKey) {
  if (saving) return;
  writeDraft();
  const previous = scope;
  reportType = nextType === WEEKLY ? WEEKLY : DAILY;
  let key = requestedKey || currentKey() || defaultDraft(reportType).key;
  if (!requestedKey && previous?.type === DAILY && reportType === WEEKLY) key = weekForDate(previous.key);
  if (!requestedKey && previous?.type === WEEKLY && reportType === DAILY
    && weekForDate(key) !== previous.key) key = window.ReportFormat.weekdays(previous.key)[4] || key;
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
  await loadReport(button.dataset.key, { fromDisk: true,
    version: button.dataset.version ? Number(button.dataset.version) : undefined });
}

async function saveReport() {
  if (loading || saving || !vault) return;
  // The editable body is authoritative; never replace an intentionally cleared
  // body with a generated template during save.
  const content = previewInput.value;
  if (!content.trim() || !currentKey()) return showToast('请先填写报告内容');
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
  if (reportType === DAILY) {
    const state = weekSourcesEl.querySelector('[aria-current="true"] .week-source-state');
    if (state) state.textContent = '已记录';
  }
  showExportStatus(result.unchanged ? '正文未变化，无需新增版本'
    : result.archivedVersion ? `已保存当前稿，旧稿保留为 v${result.archivedVersion}` : '已保存首个版本', content);
  showToast('已写入 Obsidian');
  await loadHistory();
}

async function copyReport() {
  if (loading || saving) return;
  const content = previewInput.value;
  if (!content.trim()) return showToast('没有可复制的正文');
  const target = scope;
  const copied = await reportApi().copy?.({ type: reportType, key: currentKey(), revision: currentRevision, content, confirmed: true }).catch(() => false);
  if (scope !== target) return;
  if (copied?.ok === true || copied === true) {
    showExportStatus(reportType === WEEKLY ? '今日、本周、下周已复制' : '正文已复制', content);
    return;
  }
  showToast('复制失败，请重试');
}

function showExportStatus(message, content) {
  // Writing conventions are advisory, never a submission gate or focus trap.
  const suggestion = reportType === DAILY ? window.ReportFormat?.validate?.(reportType, currentKey(), content) : '';
  saveStatusEl.textContent = suggestion
    ? `${message}。格式参考（可忽略）：${suggestion}` : message;
}

[workInput, planInput, summaryInput].forEach((input) => input.addEventListener('input', () => {
  previewInput.removeAttribute('aria-invalid');
  updatePreview(false);
  if (previewInput.dataset.auto === 'false') saveStatusEl.textContent = '正文已保留。要使用模板里的内容，请点“应用到正文”。';
}));
previewInput.addEventListener('input', () => {
  previewInput.removeAttribute('aria-invalid');
  previewInput.dataset.auto = 'false';
  writeDraft();
  if (reportType === DAILY) {
    const state = weekSourcesEl.querySelector('[aria-current="true"] .week-source-state');
    if (state && window.ReportFormat.hasReportContent(previewInput.value)) state.textContent = '本机草稿';
  }
});
dailyDateEl.addEventListener('change', () => loadReport(dailyDateEl.value));
weeklyDateEl.addEventListener('change', () => loadReport(weeklyDateEl.value));
saveButton.addEventListener('click', saveReport);
copyButton.addEventListener('click', copyReport);
historyListEl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-key]');
  if (button) void openHistoryRow(button);
});
switcherButtons.forEach((button) => button.addEventListener('click', () => setReportType(button.dataset.reportType)));
weekSourcesEl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-date]');
  if (!button || loading || saving) return;
  const key = button.dataset.date;
  if (reportType === DAILY) {
    if (key !== currentKey()) void loadReport(key);
    return;
  }
  selectedSource = key;
  renderWeekSources();
  weekSourcesEl.querySelector('[aria-current="true"]')?.focus({ preventScroll: true });
});
document.getElementById('edit-source').addEventListener('click', () => {
  if (selectedSource) void setReportType(DAILY, selectedSource);
});
reviewSources.addEventListener('click', () => {
  if (loading || saving || !weekSources.items.length) return;
  weeklyUpdateBody.value = window.ReportFormat.buildFridayDraft(weekSources.days[4], weekSources.items);
  weeklyUpdate.showModal();
});
document.getElementById('keep-weekly').addEventListener('click', () => weeklyUpdate.close());
document.getElementById('apply-weekly').addEventListener('click', () => {
  try { backupDraft(); }
  catch (error) { weeklyUpdate.close(); showToast('无法备份当前稿，请先复制正文'); return; }
  setBody(weeklyUpdateBody.value);
  draftSourceSignature = weekSources.signature;
  const stored = writeDraft();
  renderWeekSources();
  if (stored) saveStatusEl.textContent = '已采用新草稿，上一版已备份';
  weeklyUpdate.close();
  previewInput.focus();
});
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

function backupDraft(target = scope) {
  if (loading || !target) return;
  if (!writeDraft()) throw new Error('Could not persist current draft before backup');
  const key = draftKey(target);
  const raw = localStorage.getItem(key);
  if (raw) localStorage.setItem(`${key}:backup:${Date.now()}`, raw);
}
document.getElementById('reload-report').addEventListener('click', async () => {
  if (await loadReport(currentKey(), { fromDisk: true })) {
    showToast('已载入原稿，之前的草稿已保留在本机备份中');
  }
});
document.getElementById('regenerate-report').addEventListener('click', () => {
  if (loading || saving) return;
  try { backupDraft(); }
  catch (error) { showToast('无法备份当前稿，请先复制正文'); return; }
  updatePreview(true);
  saveStatusEl.textContent = '已应用模板，之前的正文已备份';
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
window.ReportPanel = {
  setType: async (type) => { await ready; return setReportType(type, defaultDraft(type).key); },
  flushDraft: writeDraft,
  ready,
};
