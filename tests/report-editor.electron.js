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
        copy: async (value) => { fixture.copies++; fixture.copied = value.content; return { ok: true }; },
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
      const missingPlanCopied = fixture.copies === 1;
      fill('plan-input', '完成Agent的发布上线');
      await copyReport();
      const normal = { copied: fixture.copies === 2, summaryHidden: field('summary-field').hidden,
        todayHeading: field('preview-input').value.includes('今日艾维利'),
        planHeading: field('plan-label').textContent,
        plainPlan: field('preview-input').value.endsWith('明日艾维利：\\n完成Agent的发布上线') };
      fill('work-input', '完成1场销售部门的AI培训');
      await copyReport();
      const missingWorkStatusCopied = fixture.copies === 3;
      fill('work-input', '✅ 完成1场销售部门的AI培训');
      await loadReport('2026-10-16');
      fill('work-input', '✅ 完成1场运营部门的AI培训');
      fill('plan-input', '完成Agent的发布上线');
      await saveReport();
      const missingSummarySaved = fixture.saves === 1;
      fill('summary-input', '完成2场AI培训，覆盖销售和运营部门');
      field('regenerate-report').click();
      const friday = { summaryVisible: !field('summary-field').hidden,
        planHeading: field('plan-label').textContent, note: field('weekend-note').textContent,
        plainSummary: field('preview-input').value.includes('本周工作总结：\\n完成2场AI培训，覆盖销售和运营部门'),
        plainPlan: field('preview-input').value.endsWith('下周一艾维利：\\n完成Agent的发布上线') };
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
      const customMarkerCopied = fixture.copies === previousCopies + 1;
      fill('preview-input', beforeFailure);
      window.ReportPanel.flushDraft();
      await loadReport('2026-10-18');
      const sunday = { summaryHidden: field('summary-field').hidden, planHeading: field('plan-label').textContent };
      await loadReport('2026-10-16');
      const restored = field('preview-input').value === beforeFailure && field('summary-input').value.includes('2场');
      await tick();
      return { missingPlanCopied, normal, missingWorkStatusCopied, missingSummarySaved, friday, failureRetainsInput, saved, readBack, customMarkerCopied, sunday, restored };
    })()`);
    assert.equal(result.missingPlanCopied, true, '未填写明日计划也应允许复制正文');
    assert.deepEqual(result.normal, { copied: true, summaryHidden: true, todayHeading: true, planHeading: '明日艾维利', plainPlan: true });
    assert.equal(result.missingWorkStatusCopied, true, '未写状态标记也应允许复制');
    assert.equal(result.missingSummarySaved, true, '未填本周总结也应允许保存');
    assert.equal(result.friday.summaryVisible, true);
    assert.equal(result.friday.planHeading, '下周一艾维利');
    assert.equal(result.friday.plainPlan, true);
    assert.equal(result.friday.plainSummary, true);
    assert.match(result.friday.note, /2026-10-19/);
    for (const key of ['failureRetainsInput', 'saved', 'readBack', 'customMarkerCopied', 'restored']) assert.equal(result[key], true, key);
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

    stage = 'free-form daily and weekly actions';
    const freeform = await win.webContents.executeJavaScript(`(async () => {
      const field = (id) => document.getElementById(id);
      const fillBody = (value) => {
        field('preview-input').value = value;
        field('preview-input').dispatchEvent(new Event('input', { bubbles: true }));
      };
      const waitFor = async (check) => {
        const deadline = performance.now() + 3000;
        while (!check()) {
          if (performance.now() >= deadline) throw new Error('Report action did not complete');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      };
      const results = [];
      for (const type of ['weekly', 'daily']) {
        await setReportType(type);
        await loadReport(type === 'weekly' ? '2026-W43' : '2026-10-16');
        const body = '\\n## 自己的工作记录\\n✔ 联调 ing\\n\\n计划还没想好，先存下来。  \\n';
        fillBody(body);
        const saveCount = fixture.saves;
        field('save-report').click();
        await waitFor(() => fixture.saves === saveCount + 1 && !field('save-report').disabled);
        const savedExactly = fixture.saved?.content === body;
        await loadReport(currentKey(), { fromDisk: true });
        const readExactly = field('preview-input').value === body;
        field('copy-report').focus();
        const copyCount = fixture.copies;
        field('copy-report').click();
        await waitFor(() => fixture.copies === copyCount + 1);
        const copiedExactly = fixture.copied === body;
        const notForcedBack = document.activeElement === field('copy-report') &&
          field('preview-input').getAttribute('aria-invalid') !== 'true';
        const beforeClear = fixture.saves;
        fillBody('   ');
        await saveReport();
        const emptyDidNotOverwrite = fixture.saves === beforeClear && fixture.saved?.content === body;
        fillBody(body);
        results.push({ type, savedExactly, readExactly, copiedExactly, notForcedBack, emptyDidNotOverwrite });
      }
      return results;
    })()`);
    for (const row of freeform) {
      for (const key of ['savedExactly', 'readExactly', 'copiedExactly', 'notForcedBack', 'emptyDidNotOverwrite']) {
        assert.equal(row[key], true, row.type + ': ' + key);
      }
    }
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
        fs.writeFileSync(path.join(screenshotDirectory, `report-flexible-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      }
      const actionsReachable = await win.webContents.executeJavaScript(`(async () => {
        const editor = document.querySelector('.report-preview');
        const body = document.getElementById('preview-input');
        body.scrollTop = body.scrollHeight;
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
    console.log('PASS: report editor optional templates, daily/weekly free-form actions, save failure, exact read-back and draft preservation');
  } finally {
    win.destroy();
  }
}

run().then(() => { clearTimeout(watchdog); app.quit(); }, (error) => { clearTimeout(watchdog); console.error(error); app.exit(1); });
