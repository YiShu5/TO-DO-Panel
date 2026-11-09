const test = require('node:test');
const assert = require('node:assert/strict');
const ReportFormat = require('../renderer/report-format.js');

const work = '✅：完成 1 场销售部 AI 培训\n🚶‍♂️：Agent 发布前测试完成 8 / 10 项';

test('Friday draft uses canonical progress, sorts weekly status and keeps plans numbered', () => {
  const draft = ReportFormat.buildFridayDraft('2026-11-06', [
    { key: '2026-11-02', content: '今日艾维利\n🚶 核对数据\n不带标记的工作\n❌ 补交材料' },
    { key: '2026-11-06', content: '今日艾维利\n🏃1、整理培训稿\n✅2、核对数据\n🚶️3、跟进验收\n下周艾维利\n🚶‍♂️1、发布材料' },
  ]);
  assert.equal(draft, [
    '11月6日工作总结', '', '今日艾维利',
    '🚶‍♂️1、整理培训稿', '✅2、核对数据', '🚶‍♂️3、跟进验收',
    '', '本周艾维利', '✅ 1、核对数据', '🚶‍♂️ 2、整理培训稿', '🚶‍♂️ 3、跟进验收',
    '❌ 4、补交材料', '5、不带标记的工作', '',
    '下周艾维利', '1、发布材料', '2、整理培训稿', '3、跟进验收', '4、补交材料',
  ].join('\n'));
});
const plan = '完成 Agent 的发布上线';
const summary = '本周完成 3 场 AI 培训，覆盖 60 人';
function daily(key = '2026-10-15', overrides = {}) {
  return ReportFormat.build({ type: 'daily', key, work, plan, summary, ...overrides });
}

test('daily requires work statuses while tomorrow tasks remain plain text', () => {
  const body = daily();
  assert.equal(body, `10月15日工作总结\n今日艾维利：\n${work}\n\n明日艾维利：\n${plan}`);
  assert.equal(ReportFormat.validate('daily', '2026-10-15', body), '');
  assert.deepEqual(ReportFormat.parse(body), { work, plan, summary: '', heading: '明日艾维利', planHeading: '明日艾维利' });
});

test('Friday and Saturday require this week summary and Monday tasks', () => {
  for (const key of ['2026-10-16', '2026-10-17']) {
    assert.deepEqual(ReportFormat.dailyContext(key), {
      valid: true, requiresSummary: true, planHeading: '下周一艾维利', nextWorkdayKey: '2026-10-19',
    });
    const body = daily(key);
    assert.match(body, /本周工作总结：\n本周完成/);
    assert.match(body, /下周一艾维利：\n完成 Agent 的发布上线$/);
    assert.doesNotMatch(body, /明日艾维利/);
    assert.equal(ReportFormat.parse(body).summary, summary);
    assert.equal(ReportFormat.validate('daily', key, body), '');
  }
});

test('Sunday uses tomorrow tasks without forcing a weekly summary', () => {
  const context = ReportFormat.dailyContext('2026-10-18');
  assert.equal(context.requiresSummary, false);
  assert.equal(context.planHeading, '明日艾维利');
  assert.equal(context.nextWorkdayKey, '2026-10-19');
  assert.equal(ReportFormat.validate('daily', '2026-10-18', daily('2026-10-18')), '');
});

test('selected calendar date handles month/year boundaries and rejects impossible dates', () => {
  assert.equal(ReportFormat.dailyContext('2026-07-31').nextWorkdayKey, '2026-08-03');
  assert.equal(ReportFormat.dailyContext('2021-12-31').nextWorkdayKey, '2022-01-03');
  assert.equal(ReportFormat.dailyContext('2022-01-01').nextWorkdayKey, '2022-01-03');
  assert.equal(ReportFormat.dailyContext('2024-02-28').nextWorkdayKey, '2024-02-29');
  for (const key of ['2026-02-29', '2026-13-01', '', undefined]) {
    assert.equal(ReportFormat.dailyContext(key).valid, false);
    assert.match(ReportFormat.validate('daily', key, ''), /日期/);
  }
});

test('explicit legacy markers normalize only on rebuild and English names remain intact', () => {
  const body = daily('2026-10-15', {
    work: '✔️ 已完成销售培训\n🚶：培训材料整理 ing\n🚶‍♂：修复 spring boot 登录问题\n🚶‍♂️：完成 Planning 模块联调',
    plan: '❌ 完成 Agent 的发布上线',
  });
  assert.match(body, /✅：已完成销售培训/);
  assert.match(body, /🚶‍♂️：培训材料整理 进行中/);
  assert.match(body, /🚶‍♂️：修复 spring boot 登录问题/);
  assert.match(body, /🚶‍♂️：完成 Planning 模块联调/);
  assert.match(body, /明日艾维利：\n完成 Agent 的发布上线$/);
  assert.doesNotMatch(body, /✔/);
  assert.equal(ReportFormat.validate('daily', '2026-10-15', body), '');
});

test('unmarked tasks are not silently classified as completed or in progress', () => {
  const body = daily('2026-10-15', { work: '已完成 1 场销售部 AI 培训' });
  assert.match(body, /今日艾维利：\n已完成/);
  assert.match(ReportFormat.validate('daily', '2026-10-15', body), /今日艾维利.*第 1 条.*不会自动猜测/);
});

test('legacy daily and weekly reports remain parseable without modifying their content', () => {
  const legacy = '9月14日工作总结\r\n✔：完成访谈\r\n🚶：核对页面\r\n\r\n明日计划：\r\n1、完成 Agent 上线\r\n2、核对销售培训签到表';
  const parsed = ReportFormat.parse(legacy);
  assert.equal(parsed.work, '✔：完成访谈\n🚶：核对页面');
  assert.equal(parsed.plan, '完成 Agent 上线\n核对销售培训签到表');
  assert.equal(parsed.summary, '');
  assert.equal(parsed.heading, '明日计划');
  assert.match(legacy, /✔：完成访谈/);
  const weekly = ReportFormat.parse('本周工作进展\n🚶：修复登录错误\n\n下周计划\n1、发布新版本');
  assert.equal(weekly.work, '🚶：修复登录错误');
  assert.equal(weekly.plan, '发布新版本');
  assert.equal(weekly.heading, '下周计划');
});

test('weekly sources include only work, normalize markers and deduplicate', () => {
  const result = ReportFormat.summarizeSources([
    { content: '9月14日工作总结\n✅：完成销售培训\n\n明日计划：\n1、发布新版本' },
    { content: '9月15日工作总结\n🚶：核对页面\n\n明日计划：\n1、等待反馈' },
    { content: daily('2026-10-16', { work: '✅：完成销售培训\n❌：Agent 未通过上线验收' }) },
  ]);
  assert.equal(result, '✅：完成销售培训\n🚶‍♂️：核对页面\n❌：Agent 未通过上线验收');
  assert.doesNotMatch(result, /覆盖 60 人|发布新版本/);
});

test('weekly keeps work status markers but generates plain next-week plans', () => {
  const body = ReportFormat.build({ type: 'weekly', key: '2026-W42', work, plan });
  assert.equal(body, `本周工作进展\n${work}\n\n下周计划\n${plan}`);
  assert.equal(ReportFormat.validate('weekly', '2026-W42', body), '');
  assert.match(ReportFormat.validate('weekly', '2026-W42', body.replace(work, '完成 1 场销售部 AI 培训')), /本周工作进展.*第 1 条.*不会自动猜测/);
});

test('rebuilding strips optional historical statuses only from plans and summaries', () => {
  const oldPlan = '1、❌：完成 Agent 的发布上线\n2、🚶：核对销售培训签到表\n3、✔️：完成 Planning 模块联调';
  const oldSummary = '✅：本周完成 3 场 AI 培训，覆盖 60 人\n🚶‍♂️：Agent 发布前测试完成 8 / 10 项';
  const rebuilt = daily('2026-10-16', { plan: oldPlan, summary: oldSummary });
  const parsed = ReportFormat.parse(rebuilt);
  assert.equal(parsed.work, work);
  assert.equal(parsed.plan, '完成 Agent 的发布上线\n核对销售培训签到表\n完成 Planning 模块联调');
  assert.equal(parsed.summary, '本周完成 3 场 AI 培训，覆盖 60 人\nAgent 发布前测试完成 8 / 10 项');
  assert.doesNotMatch(parsed.plan + parsed.summary, /✅|🚶|❌|✔/u);
  assert.equal(ReportFormat.validate('daily', '2026-10-16', rebuilt), '');
  const weekly = ReportFormat.build({ type: 'weekly', key: '2026-W42', work, plan: oldPlan });
  assert.equal(ReportFormat.parse(weekly).plan, parsed.plan);
  assert.equal(ReportFormat.parse(weekly).work, work);
});

test('manual plans and summaries accept plain or numbered content and optional legacy statuses', () => {
  for (const marker of ['', '1、', '1. ', '✅：', '🚶‍♂️：', '❌：']) {
    const body = daily('2026-10-16').replace(summary, marker + summary).replace(plan, marker + plan);
    assert.equal(ReportFormat.validate('daily', '2026-10-16', body), '', marker);
  }
  const historical = daily('2026-10-16').replace(summary, '✅：' + summary).replace(plan, '❌：' + plan);
  const parsed = ReportFormat.parse(historical);
  assert.equal(parsed.plan, '❌：' + plan, 'parsing an old report must preserve its optional statuses');
  assert.equal(parsed.summary, '✅：' + summary);
});

test('template advice identifies missing work, plan and weekend summary', () => {
  assert.match(ReportFormat.validate('daily', '2026-10-15', daily('2026-10-15', { work: '' })), /今日艾维利.*至少填写/);
  assert.match(ReportFormat.validate('daily', '2026-10-15', daily('2026-10-15', { plan: '' })), /明日艾维利.*至少填写/);
  assert.match(ReportFormat.validate('daily', '2026-10-16', daily('2026-10-16', { summary: '' })), /本周工作总结.*至少填写/);
  assert.match(ReportFormat.validate('daily', '2026-10-16', daily('2026-10-16').replace('下周一艾维利：', '明日艾维利：')), /下周一艾维利/);
  assert.match(ReportFormat.validate('daily', '2026-10-15', daily().replace('今日艾维利：\n', '')), /今日艾维利/);
});

test('template advice identifies nonstandard work markers and numbering', () => {
  for (const marker of ['✔', '✔️', '🚶', '1、']) {
    const body = daily().replace('✅：', marker + '：');
    assert.match(ReportFormat.validate('daily', '2026-10-15', body), /今日艾维利.*第 1 条/);
  }
  for (const suffix of [' ing', 'ING', 'ing（70%）']) {
    const body = daily().replace('Agent 发布前测试完成 8 / 10 项', `Agent 发布前测试${suffix}`);
    assert.match(ReportFormat.validate('daily', '2026-10-15', body), /今日艾维利.*第 2 条.*ing/);
  }
});

test('template advice identifies ing and checkmark variants in plans and summaries', () => {
  for (const content of ['✔ 完成 Agent 的发布上线', 'Agent 发布上线 ing']) {
    assert.match(ReportFormat.validate('daily', '2026-10-15', daily().replace(plan, content)), /明日艾维利.*第 1 条.*ing 或 ✔/);
    assert.match(ReportFormat.validate('daily', '2026-10-16', daily('2026-10-16').replace(summary, content)), /本周工作总结.*第 1 条.*ing 或 ✔/);
  }
});

test('manual preview accepts exact status markers with spaces or optional punctuation', () => {
  for (const separator of [' ', '', ': ', '：']) {
    const body = daily().replaceAll('：', separator);
    // Section headings can omit a colon, but keep their labels independent of item punctuation.
    const content = body.replace(`今日艾维利${separator}`, '今日艾维利：')
      .replace(`明日艾维利${separator}`, '明日艾维利：');
    assert.equal(ReportFormat.validate('daily', '2026-10-15', content), '');
  }
  assert.match(ReportFormat.validate('daily', '2026-10-15', daily().replace(plan, '❌： ')), /明日艾维利.*第 1 条/);
});

test('obviously vague entries are rejected, concrete work need not have numbers', () => {
  for (const vague of ['继续推进', '整理文档', '完成工作', 'AI培训', '暂无计划', '...', '待填写']) {
    assert.match(ReportFormat.validate('daily', '2026-10-15', daily('2026-10-15', { plan: vague })), /明日艾维利.*第 1 条.*过于笼统/);
    assert.match(ReportFormat.validate('daily', '2026-10-16', daily('2026-10-16', { summary: vague })), /本周工作总结.*第 1 条.*过于笼统/);
  }
  for (const concrete of ['修复登录错误', '发布Agent', '完成财务部培训', '提交培训复盘初稿供部门确认', 'Agent 内测完成 80%']) {
    assert.equal(ReportFormat.validate('daily', '2026-10-15', daily('2026-10-15', { plan: concrete })), '');
  }
});

test('markdown, duplicate headings and misplaced entries are rejected', () => {
  assert.match(ReportFormat.validate('daily', '2026-10-15', daily().replace('销售部', '**销售部**')), /Markdown/);
  assert.match(ReportFormat.validate('daily', '2026-10-15', `${daily()}\n明日艾维利：\n❌：发布Agent`), /顺序/);
  assert.match(ReportFormat.validate('daily', '2026-10-15', daily().replace('今日艾维利：', '❌：发布Agent\n今日艾维利：')), /放在/);
});

test('splitItems preserves inline Chinese enumeration and strips only outer list bullets', () => {
  assert.deepEqual(ReportFormat.splitItems('- ✅：完成培训\n1、❌：发布Agent\n一、核对页面；二、收集反馈'), [
    '✅：完成培训', '❌：发布Agent', '一、核对页面；二、收集反馈',
  ]);
});
