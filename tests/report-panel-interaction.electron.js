const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const electron = require('electron');

const { app, BrowserWindow, ipcMain } = electron;
const projectRoot = path.join(__dirname, '..');
const isolatedUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'to-do-report-exit-test-'));
const isolatedVault = path.join(fs.realpathSync(isolatedUserData), 'vault');
fs.mkdirSync(path.join(isolatedVault, '.obsidian'), { recursive: true });
process.env.TODO_PANEL_USER_DATA = isolatedUserData;
process.env.TODO_PANEL_REPORT_PREVIEW = '1';
process.env.TODO_PANEL_REPORT_VAULT = isolatedVault;
app.setPath('userData', isolatedUserData);

let finishDialog;
let finishMedia;
let copiedText = null;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, message) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail(message);
}

// Load the real main process and IPC handlers. Only startup services and OS
// integrations are isolated: no tray, global shortcut, clipboard polling,
// network listener, permission prompt, or real Obsidian data is touched.
function loadProductionMain() {
  const filename = path.join(projectRoot, 'main.js');
  const testModule = new Module(filename, module);
  testModule.filename = filename;
  testModule.paths = Module._nodeModulePaths(projectRoot);
  const originalRequire = testModule.require.bind(testModule);
  const testApp = new Proxy(app, {
    get(target, key) {
      if (key === 'whenReady') return () => new Promise(() => {});
      if (key === 'requestSingleInstanceLock') return () => true;
      if (key === 'getLoginItemSettings') return () => ({ openAtLogin: false });
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  testModule.require = (name) => {
    if (name === 'electron') return {
      ...electron,
      app: testApp,
      globalShortcut: { register: () => false, isRegistered: () => false, unregister() {}, unregisterAll() {} },
      clipboard: { writeText: (value) => { copiedText = value; } },
      dialog: { showOpenDialog: () => new Promise((resolve) => { finishDialog = resolve; }) },
      systemPreferences: {
        getMediaAccessStatus: () => 'not-determined',
        askForMediaAccess: () => new Promise((resolve) => { finishMedia = resolve; }),
      },
    };
    if (name === 'child_process') return {
      execFile: (...args) => queueMicrotask(() => args.at(-1)(new Error('OS automation disabled in report test'), '')),
    };
    return originalRequire(name);
  };
  testModule._compile(`${fs.readFileSync(filename, 'utf8')}\nmodule.exports = {
    createWindow,
    getWindow: () => mainWindow,
    getState: () => ({ currentMode, reportPanelActive, textEntryActive,
      mediaPermissionRequests, transientSystemInteractionRequests }),
  };`, filename);
  // Avoid unrelated home widget probes while retaining every report/window IPC.
  for (const channel of ['music:status', 'usage:snapshot', 'windows:list']) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => channel === 'windows:list' ? [] : { ok: false });
  }
  return testModule.exports;
}

async function main() {
  await app.whenReady();
  const production = loadProductionMain();
  production.createWindow();
  const panel = production.getWindow();
  const outside = new BrowserWindow({ width: 240, height: 160, show: false });
  await outside.loadURL('data:text/html,<title>Report exit test target</title><p>Outside the panel</p>');
  const run = (source) => panel.webContents.executeJavaScript(source);
  const reportVisible = () => run(`!document.getElementById('report-frame').hidden`);
  const expanded = () => run(`document.getElementById('app').classList.contains('expanded') && !document.getElementById('app').classList.contains('closing')`);
  const focusPanel = async () => {
    app.focus({ steal: true });
    panel.show(); panel.focus(); panel.webContents.focus();
    await waitFor(async () => panel.isFocused() && await run(`document.hasFocus()`), '测试面板必须获得真实键盘焦点');
  };
  const focusOutside = async () => {
    outside.show(); outside.focus(); outside.webContents.focus();
    await waitFor(() => !panel.isFocused(), '测试辅助窗口必须让面板实际失焦');
  };
  const openReport = async () => {
    await focusPanel();
    await run(`document.getElementById('report-launcher-button').click();
      document.querySelector('#report-launcher-menu [data-report-type="daily"]').click();`);
    await waitFor(reportVisible, '日报应通过真实入口打开');
    await run(`(async () => {
      const frame = document.getElementById('report-frame');
      while (!frame.contentWindow.ReportPanel) await new Promise(r => setTimeout(r, 10));
      await frame.contentWindow.ReportPanel.ready;
    })()`);
  };
  const expandPanel = async () => {
    await focusPanel();
    await run(`document.getElementById('notch').click()`);
    await waitFor(expanded, '面板应展开');
    await delay(450);
  };

  try {
    await waitFor(async () => !panel.webContents.isLoadingMainFrame()
      && await run(`Boolean(document.getElementById('report-launcher'))`), '主页面应加载');
    await panel.webContents.debugger.attach('1.3');
    await panel.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await expandPanel();
    await openReport();
    for (const report of [
      { type: 'daily', key: '2026-10-15', content: '# 自由日报\n✔ 培训资料整理 ing\n\n先记这一段，计划晚点再补。\n' },
      { type: 'weekly', key: '2026-W42', content: '**本周随记**\n整理资料\n✔ Agent 联调 ing\n' },
    ]) {
      const payload = { ...report, vault: isolatedVault, expectedRevision: null, confirmed: true };
      const saved = await run(`window.reportAPI.save(${JSON.stringify(payload)})`);
      assert.equal(saved.ok, true, `${report.type} 的自定义正文应允许保存：${JSON.stringify(saved)}`);
      assert.equal(fs.readFileSync(saved.path, 'utf8'), report.content, '磁盘文件应原样保留正文');
      const loaded = await run(`window.reportAPI.get(${JSON.stringify({ type: report.type, key: report.key })})`);
      assert.equal(loaded.ok, true);
      assert.equal(loaded.content, report.content, '真实存储读回应保留自定义格式与未完成内容');
      assert.equal((await run(`window.reportAPI.copy(${JSON.stringify(payload)})`)).ok, true);
      assert.equal(copiedText, report.content, '不要求标题、章节或状态标记，复制正文不改写');

      const externalContent = `${report.content}\n外部编辑：保留这句话`;
      fs.writeFileSync(saved.path, externalContent, 'utf8');
      const conflict = await run(`window.reportAPI.save(${JSON.stringify({ ...payload,
        content: `${report.content}\n过期草稿`, expectedRevision: saved.revision })})`);
      assert.equal(conflict.error, 'revision_conflict', '放宽格式不能绕过外部修改冲突保护');
      assert.equal(fs.readFileSync(saved.path, 'utf8'), externalContent, '冲突时不得覆盖外部新内容');
    }
    const lastCopiedText = copiedText;
    const rejectedExports = await run(`(async () => {
      const payload = { type: 'daily', key: '2026-10-15', confirmed: true,
        vault: ${JSON.stringify(isolatedVault)}, expectedRevision: null, content: '随便写一句' };
      const results = [];
      for (const patch of [{ content: '  \\n ' }, { key: '../escape' }, { key: '2026-02-30' },
        { type: 'unknown' }, { content: 'x'.repeat(1024 * 1024 + 1) }]) {
        results.push({ save: await window.reportAPI.save({ ...payload, ...patch }),
          copy: await window.reportAPI.copy({ ...payload, ...patch }) });
      }
      return { results,
        unconfirmed: await window.reportAPI.copy({ ...payload, confirmed: false }),
        wrongVault: await window.reportAPI.save({ ...payload, vault: '' }) };
    })()`);
    for (const result of rejectedExports.results) {
      assert.equal(result.save.error, 'invalid_report', '空正文、非法类型/日期和过大内容仍应拒绝保存');
      assert.equal(result.copy.error, 'invalid_report', '必要输入边界仍应拒绝复制');
    }
    assert.equal(rejectedExports.unconfirmed.error, 'confirmation_required');
    assert.equal(rejectedExports.wrongVault.error, 'vault_changed');
    assert.equal(copiedText, lastCopiedText, '被拒绝的请求不得改动剪贴板');
    const validBody = '10月15日工作总结\n今日艾维利：\n✅：完成 1 场研发部 AI 培训\n\n明日艾维利：\n完成 Agent 发布上线';
    assert.equal((await run(`window.reportAPI.copy({ type: 'daily', key: '2026-10-15', confirmed: true,
      content: ${JSON.stringify(validBody)} })`)).ok, true, '今日有状态、明日无状态的规范日报应允许复制');
    assert.equal(copiedText, validBody);
    await focusPanel();
    await run(`(() => {
      const doc = document.getElementById('report-frame').contentDocument;
      const work = doc.getElementById('work-input');
      work.value = '✅ 完成 1 场研发部 AI 培训，覆盖 20 人';
      work.dispatchEvent(new Event('input', { bubbles: true }));
      const plan = doc.getElementById('plan-input');
      plan.value = '完成 Agent 发布上线，目标覆盖 2 个部门';
      plan.dispatchEvent(new Event('input', { bubbles: true }));
      const preview = doc.getElementById('preview-input');
      preview.focus();
      preview.dataset.auto = 'false';
      // Simulate the final editor value before an input event has been flushed.
      preview.value += '\\n离开前最后一句：保留草稿';
    })()`);
    await waitFor(() => production.getState().textEntryActive, '报告输入焦点应传到主进程');
    await run(`document.getElementById('tab-button-todo').click()`);
    await waitFor(async () => !await reportVisible()
      && await run(`document.getElementById('tab-todo').classList.contains('active')`), '点击待办应直接离开日报');
    await delay(200);
    assert.equal(await run(`document.getElementById('tab-todo').classList.contains('active')`), true,
      '内部隐藏报告的 IPC 不得异步把待办弹回首页');
    assert.equal(production.getState().textEntryActive, false, '隐藏报告必须释放文字输入模式');
    assert.equal(production.getState().reportPanelActive, false);
    const savedDraft = await run(`Object.keys(localStorage).filter(k => k.startsWith('todo-panel-report-draft-v2:'))
      .map(k => JSON.parse(localStorage.getItem(k))).find(d => d.preview.includes('离开前最后一句'))`);
    assert.ok(savedDraft, '离开前必须同步保存最后一笔草稿');

    await openReport();
    await waitFor(() => run(`document.getElementById('report-frame').contentDocument.getElementById('preview-input').value.includes('离开前最后一句')`),
      '重新打开日报应恢复未保存草稿');
    await run(`document.getElementById('report-frame').contentDocument.getElementById('choose-vault').click()`);
    await waitFor(() => production.getState().transientSystemInteractionRequests === 1, '系统对话框应启用失焦保护');
    await focusOutside();
    await delay(500);
    assert.equal(await expanded(), true, '知识库选择对话框期间失焦不得收起面板');
    assert.equal(await reportVisible(), true);
    await focusPanel();
    finishDialog({ canceled: true, filePaths: [] });
    await waitFor(() => production.getState().transientSystemInteractionRequests === 0, '取消对话框后应释放保护');

    if (process.platform === 'darwin') {
      // Start the real media IPC but replace the OS permission sheet with a pending promise.
      await run(`window.__reportTestMedia = window.notchAPI.ensureMicrophone(); void 0`);
      await waitFor(() => production.getState().mediaPermissionRequests === 1, '媒体权限请求应启用失焦保护');
      await focusOutside();
      await delay(500);
      assert.equal(await expanded(), true, '媒体权限对话框期间失焦不得收起面板');
      await focusPanel();
      finishMedia(false);
      await waitFor(() => production.getState().mediaPermissionRequests === 0, '媒体权限返回后应释放保护');
    }

    await focusOutside();
    await waitFor(async () => production.getState().currentMode === 'collapsed'
      && await run(`document.getElementById('app').classList.contains('collapsed')`), '日报打开时点击外部应走正常收起动画');
    assert.equal(await reportVisible(), false, '收起结束后应隐藏报告 iframe');
    assert.equal(production.getState().textEntryActive, false);
    await expandPanel();
    assert.equal(await run(`document.getElementById('tab-home').classList.contains('active')`), true,
      '重新展开遵循原有首页入口逻辑');
    await openReport();
    await waitFor(() => run(`document.getElementById('report-frame').contentDocument.getElementById('preview-input').value.includes('离开前最后一句')`),
      '外部点击收起也必须保留报告草稿');
    await run(`document.getElementById('report-frame').contentDocument.getElementById('back-to-panel').click()`);
    await waitFor(async () => !await reportVisible()
      && await run(`document.getElementById('tab-home').classList.contains('active')`), '明确返回首页仍应恢复首页');
    // Use the real IPC and isolated Obsidian files as the first two sources.
    for (const [key, content] of [
      ['2026-11-02', '11.2 工作总结\n今日艾维利\n🏃1：验证会议提醒\n自由记录保留\n明日艾维利\n1、只排了一个旧计划'],
      ['2026-11-06', '11.6 工作总结\n今日艾维利\n✅1、验证会议提醒\n❌2、整理分享稿\n✅ 9:30 财务验收\n下周艾维利\n1、安排交付验收\n3.5 小时整理反馈'],
    ]) {
      const result = await run(`window.reportAPI.save(${JSON.stringify({
        type: 'daily', key, content, vault: isolatedVault, expectedRevision: null, confirmed: true,
      })})`);
      assert.equal(result.ok, true);
    }
    await openReport();
    const report = (source) => run(`(async () => {
      const frame = document.getElementById('report-frame');
      const doc = frame.contentDocument;
      const field = id => doc.getElementById(id);
      const body = field('preview-input');
      const input = text => { body.value = text; body.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true })); };
      ${source}
    })()`);
    await report(`await frame.contentWindow.setReportType('weekly', '2026-W46');`);
    assert.match(await report('return body.value;'), /今日艾维利[\s\S]*本周艾维利[\s\S]*下周艾维利/, '空白的一周仍可编辑三段');
    await report(`await frame.contentWindow.setReportType('daily', '2026-11-06');
      doc.querySelector('[data-report-switcher][data-report-type="weekly"]').click();`);
    await waitFor(() => report(`return !body.disabled && field('source-status').textContent.includes('2/5');`), '首次打开汇报应从真实日报出稿');
    const original = await report('return body.value;');
    assert.match(original, /今日艾维利\n✅1、验证会议提醒/);
    assert.match(original, /本周艾维利[\s\S]*✅ 1、验证会议提醒[\s\S]*自由记录保留/);
    assert.match(original, /下周艾维利\n1、安排交付验收\n2、3\.5 小时整理反馈\n3、整理分享稿/);
    assert.match(original, /本周艾维利[\s\S]*9:30 财务验收/);
    assert.doesNotMatch(original, /旧计划/);
    assert.equal(await report(`return field('week-sources').querySelectorAll('button').length;`), 5);
    if (process.env.TODO_REPORT_QA_DIR) {
      fs.mkdirSync(process.env.TODO_REPORT_QA_DIR, { recursive: true });
      await run(`document.documentElement.dataset.theme = 'light';
        document.dispatchEvent(new CustomEvent('notch:themechange', { detail: { theme: 'light' } }));`);
      await waitFor(() => report(`return doc.documentElement.dataset.theme === 'light'
        && frame.contentWindow.getComputedStyle(doc.querySelector('[data-report-switcher][data-report-type="weekly"]')).backgroundColor === 'rgb(47, 146, 144)';`), '截图时应已切换为浅色且选中周五汇报');
      await report(`await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));`);
      fs.writeFileSync(path.join(process.env.TODO_REPORT_QA_DIR, 'friday-sources.png'), (await panel.webContents.capturePage()).toPNG());
    }
    const edited = `${original}\n人工补充：保留这一行`;
    await report(`input(${JSON.stringify(edited)});
      doc.querySelector('[data-date="2026-11-02"]').click();`);
    assert.equal(await report(`return field('source-body').textContent.includes('自由记录保留') && body.value === ${JSON.stringify(edited)};`), true);
    await report(`field('reload-report').click();`);
    await waitFor(() => report(`return field('toast').textContent.includes('当前草稿已保留');`), '没有原稿时应提示保留本机草稿');
    assert.equal(await report('return body.value;'), edited);
    await report(`doc.querySelector('[data-date="2026-11-03"]').click(); field('edit-source').click();`);
    await waitFor(() => report(`return !body.disabled && field('daily-date').value === '2026-11-03';`), '缺少的日期可以直接补写');
    await report(`input('今日艾维利\\n✅ 补记测试记录'); doc.querySelector('[data-report-switcher][data-report-type="weekly"]').click();`);
    await waitFor(() => report(`return !body.disabled && !field('review-sources').hidden;`), '补记的本机草稿应提示汇报更新');
    assert.equal(await report('return body.value;'), edited, '补记日报不得覆盖手改的汇报');
    await report(`field('review-sources').click();`);
    assert.equal(await report(`return field('weekly-update').open && field('weekly-update-body').value.includes('补记测试记录');`), true);
    await report(`field('keep-weekly').click(); field('copy-report').click();`);
    await waitFor(() => copiedText === edited, '复制整份应原样包含手改后的三段');
    assert.equal(await report(`
      const storage = frame.contentWindow.Storage.prototype;
      const write = storage.setItem;
      storage.setItem = function (key, value) {
        if (key.startsWith('todo-panel-report-draft-v2:') && !key.includes(':backup:')) throw new Error('test quota');
        return write.call(this, key, value);
      };
      try {
        input(body.value + '\\n尚未写入的最后一句');
        field('review-sources').click(); field('apply-weekly').click();
        return body.value.endsWith('尚未写入的最后一句') && field('toast').textContent.includes('无法备份当前稿');
      } finally { storage.setItem = write; }
    `), true, '备份失败不得拿较旧的副本冒充当前稿');
    await report(`field('review-sources').click(); field('apply-weekly').click();`);
    assert.equal(await report(`return body.value.includes('补记测试记录') && field('review-sources').hidden;`), true);
    if (process.env.TODO_REPORT_QA_DIR) {
      panel.setSize(760, 616);
      await waitFor(() => report(`return frame.contentWindow.innerWidth <= 760;`), '报告应适应窄窗口');
      await report(`doc.querySelector('[data-date="2026-11-02"]').click(); body.scrollTop = 0;`);
      assert.equal(await report(`return doc.documentElement.scrollWidth <= frame.contentWindow.innerWidth
        && field('copy-report').getBoundingClientRect().bottom <= frame.contentWindow.innerHeight;`), true, '窄窗口保持复制按钮可见');
      fs.writeFileSync(path.join(process.env.TODO_REPORT_QA_DIR, 'friday-sources-narrow.png'), (await panel.webContents.capturePage()).toPNG());
    }
    console.log('Report panel interactions passed: Friday draft, source review, update protection, exact copy, free-format storage, and panel routing.');
  } finally {
    if (panel.webContents.debugger.isAttached()) panel.webContents.debugger.detach();
    outside.destroy();
    panel.destroy();
  }
}

main().then(() => app.quit(), (error) => { console.error(error); app.exit(1); });
app.once('will-quit', () => fs.rmSync(isolatedUserData, { recursive: true, force: true }));
