const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-report-editor-'));
app.setPath('userData', profile);
const screenshotDirectory = process.env.TODO_REPORT_QA_DIR;
let stage = 'app ready';
const watchdog = setTimeout(() => { console.error(`Report editor test timed out: ${stage}`); app.exit(1); }, 30000);

async function run() {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1240, height: 760, show: false,
    webPreferences: { backgroundThrottling: false } });
  try {
    stage = 'initialize test browser';
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Page.enable');
    await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.fixture = { saves: 0, copies: 0, failSave: false, saved: null };
      window.reportAPI = {
        getConfig: async () => ({ vault: '/test-vault' }),
        get: async ({ key, type }) => fixture.saved?.key === key && fixture.saved?.type === type
          ? { ok: true, exists: true, content: fixture.saved.content, revision: 'r1' }
          : { ok: true, exists: false, revision: null },
        list: async () => ({ ok: true, rows: [] }),
        weeklySources: async () => ({ ok: true, items: [] }),
        save: async (value) => {
          fixture.saves++;
          if (fixture.failSave) return { ok: false, error: 'unavailable' };
          fixture.saved = value;
          return { ok: true, revision: 'r1' };
        },
        copy: async () => { fixture.copies++; return { ok: true }; },
        returnHome: async () => true,
      };
    ` });
    stage = 'load report page';
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'report.html'));
    stage = 'report ready';
    await win.webContents.executeJavaScript('window.ReportPanel.ready');
    stage = 'editing and saving';
    const result = await win.webContents.executeJavaScript(`(async () => {
      const field = (id) => document.getElementById(id);
      const fill = (id, value) => { field(id).value = value; field(id).dispatchEvent(new Event('input', { bubbles: true })); };
      const tick = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };
      await loadReport('2026-10-15');
      fill('work-input', '✅ 完成1场销售部门的AI培训');
      await copyReport();
      const blockedMissingPlan = fixture.copies === 0 && field('save-status').textContent.length > 0;
      fill('plan-input', '❌ 完成Agent的发布上线');
      await copyReport();
      const normal = { copied: fixture.copies === 1, summaryHidden: field('summary-field').hidden,
        todayHeading: field('preview-input').value.includes('今日艾维利'),
        planHeading: field('plan-label').textContent };
      await loadReport('2026-10-16');
      fill('work-input', '✅ 完成1场运营部门的AI培训');
      fill('plan-input', '❌ 完成Agent的发布上线');
      await saveReport();
      const blockedMissingSummary = fixture.saves === 0;
      fill('summary-input', '✅ 完成2场AI培训，覆盖销售和运营部门');
      const friday = { summaryVisible: !field('summary-field').hidden,
        planHeading: field('plan-label').textContent, note: field('weekend-note').textContent };
      fixture.failSave = true;
      const beforeFailure = field('preview-input').value;
      await saveReport();
      const failureRetainsInput = field('preview-input').value === beforeFailure &&
        field('summary-input').value.includes('2场') && !field('save-report').disabled;
      fixture.failSave = false;
      await saveReport();
      const saved = fixture.saved?.content === beforeFailure;
      await loadReport('2026-10-16', { fromDisk: true });
      const readBack = field('preview-input').value === beforeFailure && field('summary-input').value.includes('2场');
      fill('preview-input', beforeFailure.replace('✅', '✔'));
      const previousCopies = fixture.copies;
      await copyReport();
      const invalidCopyBlocked = fixture.copies === previousCopies;
      fill('preview-input', beforeFailure);
      window.ReportPanel.flushDraft();
      await loadReport('2026-10-18');
      const sunday = { summaryHidden: field('summary-field').hidden, planHeading: field('plan-label').textContent };
      await loadReport('2026-10-16');
      const restored = field('preview-input').value === beforeFailure && field('summary-input').value.includes('2场');
      await tick();
      return { blockedMissingPlan, normal, blockedMissingSummary, friday, failureRetainsInput, saved, readBack, invalidCopyBlocked, sunday, restored };
    })()`);
    assert.equal(result.blockedMissingPlan, true);
    assert.deepEqual(result.normal, { copied: true, summaryHidden: true, todayHeading: true, planHeading: '明日艾维利' });
    assert.equal(result.blockedMissingSummary, true);
    assert.equal(result.friday.summaryVisible, true);
    assert.equal(result.friday.planHeading, '下周一艾维利');
    assert.match(result.friday.note, /2026-10-19/);
    for (const key of ['failureRetainsInput', 'saved', 'readBack', 'invalidCopyBlocked', 'restored']) assert.equal(result[key], true, key);
    assert.deepEqual(result.sunday, { summaryHidden: true, planHeading: '明日艾维利' });

    stage = 'reload draft';
    await new Promise((resolve) => {
      win.webContents.once('did-finish-load', resolve);
      win.webContents.reload();
    });
    const reloaded = await win.webContents.executeJavaScript(`(async () => {
      await ReportPanel.ready;
      await loadReport('2026-10-16');
      return { summary: document.getElementById('summary-input').value,
        preview: document.getElementById('preview-input').value };
    })()`);
    assert.match(reloaded.summary, /2场AI培训/);
    assert.match(reloaded.preview, /下周一艾维利/);
    if (screenshotDirectory) {
      stage = 'capture light and dark screenshots';
      fs.mkdirSync(screenshotDirectory, { recursive: true });
      for (const theme of ['light', 'dark']) {
        const colors = await win.webContents.executeJavaScript(`(async () => {
          document.dispatchEvent(new CustomEvent('notch:themechange', { detail: { theme: '${theme}' } }));
          await new Promise(resolve => setTimeout(resolve, 180));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return { background: getComputedStyle(document.body).backgroundColor,
            scheme: document.documentElement.style.colorScheme };
        })()`);
        assert.equal(colors.scheme, theme);
        assert.equal(colors.background, theme === 'light' ? 'rgb(243, 247, 247)' : 'rgb(14, 23, 26)');
        fs.writeFileSync(path.join(screenshotDirectory, `report-friday-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      }
      const actionsReachable = await win.webContents.executeJavaScript(`(async () => {
        const editor = document.querySelector('.report-editor');
        editor.scrollTop = editor.scrollHeight;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const frame = editor.getBoundingClientRect();
        return ['save-report', 'copy-report'].every(id => {
          const rect = document.getElementById(id).getBoundingClientRect();
          return rect.top >= frame.top && rect.bottom <= frame.bottom;
        });
      })()`);
      assert.equal(actionsReachable, true, 'weekend inputs must not make save/copy actions unreachable');
      fs.writeFileSync(path.join(screenshotDirectory, 'report-friday-actions.png'), (await win.webContents.capturePage()).toPNG());
    }
    console.log('PASS: report editor weekday/weekend, validation, save failure, read-back and reload draft preservation');
  } finally {
    win.destroy();
  }
}

run().then(() => { clearTimeout(watchdog); app.quit(); }, (error) => { clearTimeout(watchdog); console.error(error); app.exit(1); });
