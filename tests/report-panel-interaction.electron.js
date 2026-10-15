const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const electron = require('electron');

const { app, BrowserWindow, ipcMain } = electron;
const projectRoot = path.join(__dirname, '..');
const isolatedUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'to-do-report-exit-test-'));
process.env.TODO_PANEL_USER_DATA = isolatedUserData;
process.env.TODO_PANEL_REPORT_PREVIEW = '1';
delete process.env.TODO_PANEL_REPORT_VAULT;
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
    const rejectedExports = await run(`(async () => {
      const payload = { type: 'daily', key: '2026-10-15', confirmed: true,
        content: '10月15日工作总结\\n今日艾维利：\\n✅：完成 1 场研发部 AI 培训\\n\\n明日艾维利：' };
      return {
        save: await window.reportAPI.save({ ...payload, vault: '', expectedRevision: null }),
        copy: await window.reportAPI.copy({ ...payload, content: '10月15日工作总结\\n今日艾维利：\\n✔ 研发部培训 ing\\n明日艾维利：\\n❌：完成 Agent 发布上线' }),
      };
    })()`);
    assert.equal(rejectedExports.save.error, 'invalid_format', '主进程应拒绝缺少明日计划的保存请求');
    assert.match(rejectedExports.save.message, /明日艾维利.*至少填写一条/);
    assert.equal(rejectedExports.copy.error, 'invalid_format', '主进程应拒绝非标准状态标记的复制请求');
    assert.match(rejectedExports.copy.message, /不能使用 ing 或 ✔/);
    assert.equal(copiedText, null, '不合规正文不得写入剪贴板');
    const validBody = '10月15日工作总结\n今日艾维利：\n✅：完成 1 场研发部 AI 培训\n\n明日艾维利：\n❌：完成 Agent 发布上线';
    assert.equal((await run(`window.reportAPI.copy({ type: 'daily', key: '2026-10-15', confirmed: true,
      content: ${JSON.stringify(validBody)} })`)).ok, true, '规范日报应允许复制');
    assert.equal(copiedText, validBody);
    await focusPanel();
    await run(`(() => {
      const doc = document.getElementById('report-frame').contentDocument;
      const work = doc.getElementById('work-input');
      work.value = '✅ 完成 1 场研发部 AI 培训，覆盖 20 人';
      work.dispatchEvent(new Event('input', { bubbles: true }));
      const plan = doc.getElementById('plan-input');
      plan.value = '❌ 完成 Agent 发布上线，目标覆盖 2 个部门';
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
    console.log('Report panel interactions passed: tab routing, draft flush/restore, outside blur, dialog guards, return home.');
  } finally {
    if (panel.webContents.debugger.isAttached()) panel.webContents.debugger.detach();
    outside.destroy();
    panel.destroy();
  }
}

main().then(() => app.quit(), (error) => { console.error(error); app.exit(1); });
app.once('will-quit', () => fs.rmSync(isolatedUserData, { recursive: true, force: true }));
