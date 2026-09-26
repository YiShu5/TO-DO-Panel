const test = require('node:test');
const assert = require('node:assert/strict');
const ReportFormat = require('../renderer/report-format.js');

test('formats daily body with exact plain-text headings and status markers', () => {
  const body = ReportFormat.build({
    type: 'daily',
    key: '2026-09-18',
    work: '一、已完成访谈；二、正在核对页面\n✅：已经发出初稿',
    plan: '继续整理\n补一版计划',
  });
  assert.match(body, /^9月18日工作总结\n🚶：一、已完成访谈；二、正在核对页面/);
  assert.match(body, /✅：已经发出初稿/);
  assert.match(body, /明日计划：\n1、继续整理\n2、补一版计划$/);
  assert.equal(ReportFormat.validate('daily', '2026-09-18', body), '');
});

test('weekly sources are summarized without carrying their plans', () => {
  const summary = ReportFormat.summarizeSources([
    { key: '2026-09-14', content: '9月14日工作总结\n✅：完成访谈\n\n明日计划：\n1、继续' },
    { key: '2026-09-15', content: '9月15日工作总结\n🚶：核对页面\n\n明日计划：\n1、等待反馈' },
  ]);
  assert.equal(summary, '✅：完成访谈\n🚶：核对页面');
});

test('markdown markers are rejected from copyable report text', () => {
  const body = '9月18日工作总结\n✅：完成访谈\n\n明日计划：\n1、继续';
  assert.match(ReportFormat.validate('daily', '2026-09-18', body.replace('完成访谈', '**完成访谈**')), /Markdown/);
});
