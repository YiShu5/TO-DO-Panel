(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReportFormat = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STATUS = /^(✅|🚶‍♂️|🚶‍♂|🚶|❌)\s*[：:]?\s*(.*)$/u;
  const CANONICAL_STATUS = /^(✅|🚶‍♂️|❌)\s*[：:]?\s*(.*)$/u;
  const ING = /(^|[^a-zA-Z0-9_])ing(?=$|[^a-zA-Z0-9_])/gi;
  const FORBIDDEN_ING = /(^|[^a-zA-Z0-9_])ing(?=$|[^a-zA-Z0-9_])/i;
  const PLAN_HEADINGS = ['明日艾维利', '下周一艾维利', '明日计划', '下周计划'];

  function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function weekKey(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0')}`;
  }
  function calendarDate(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return null;
    const date = new Date(`${key}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? date : null;
  }
  // Use the selected calendar date, not the machine's current day/timezone.
  function dailyContext(key) {
    const date = calendarDate(key);
    if (!date) return { valid: false, requiresSummary: false, planHeading: '明日艾维利', nextWorkdayKey: '' };
    const weekday = date.getUTCDay();
    const requiresSummary = weekday === 5 || weekday === 6;
    date.setUTCDate(date.getUTCDate() + (requiresSummary ? 8 - weekday : 1));
    return { valid: true, requiresSummary, planHeading: requiresSummary ? '下周一艾维利' : '明日艾维利', nextWorkdayKey: date.toISOString().slice(0, 10) };
  }
  // Newlines are item boundaries; keep inline Chinese enumeration verbatim.
  function splitItems(raw) {
    return String(raw || '').replace(/\r\n?/g, '\n')
      .split('\n').map(line => line.trim().replace(/^(?:[-*•]\s+|\d+[、.)]\s*)/, '').trim()).filter(Boolean);
  }
  function normalizeLine(line) {
    const normalized = line.replace(/✔\uFE0F?/gu, '✅').replace(ING, '$1进行中');
    const explicit = normalized.match(STATUS);
    // Do not infer status from verbs, even “完成”. Missing markers are validated
    // at save/copy time rather than inventing completion or progress.
    if (!explicit) return normalized;
    const marker = explicit[1].startsWith('🚶') ? '🚶‍♂️' : explicit[1];
    return `${marker}：${explicit[2].trim()}`;
  }
  function titleFor(type, key) {
    return type === 'weekly' ? '本周工作进展' : `${Number(String(key).slice(5, 7))}月${Number(String(key).slice(8, 10))}日工作总结`;
  }
  function build({ type, key, work, plan, summary }) {
    const workLines = splitItems(work).map(normalizeLine);
    const planLines = splitItems(plan).map(normalizeLine);
    if (type === 'weekly') return ['本周工作进展', ...workLines, '', '下周计划', ...planLines].join('\n');
    const context = dailyContext(key);
    const body = [titleFor(type, key), '今日艾维利：', ...workLines];
    if (context.requiresSummary) body.push('', '本周工作总结：', ...splitItems(summary).map(normalizeLine));
    body.push('', `${context.planHeading}：`, ...planLines);
    return body.join('\n');
  }
  function headingOf(line) { return line.trim().replace(/[：:]\s*$/, ''); }
  function parse(body) {
    const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
    const sections = { work: [], summary: [], plan: [] };
    let section = 'work';
    let heading = '明日艾维利';
    for (let i = 0; i < lines.length; i++) {
      const label = headingOf(lines[i]);
      if (i === 0 && /^(?:\d+月\d+日工作总结|本周工作进展)$/.test(label)) continue;
      if (label === '今日艾维利') { section = 'work'; continue; }
      if (label === '本周工作总结') { section = 'summary'; continue; }
      if (PLAN_HEADINGS.includes(label)) { section = 'plan'; heading = label; continue; }
      sections[section].push(lines[i]);
    }
    // Legacy markers stay editable; only explicit rebuild normalizes them.
    return {
      work: sections.work.filter(line => line.trim()).join('\n').trim(),
      summary: sections.summary.filter(line => line.trim()).join('\n').trim(),
      plan: sections.plan.map(line => line.replace(/^\s*\d+[、.)]\s*/, '')).join('\n').trim(),
      heading,
      planHeading: heading,
    };
  }
  function summarizeSources(items) {
    const seen = new Set();
    const lines = [];
    for (const item of items) {
      for (const line of splitItems(parse(item.content).work)) {
        const normalized = normalizeLine(line);
        if (CANONICAL_STATUS.test(normalized) && !seen.has(normalized)) {
          seen.add(normalized); lines.push(normalized);
        }
      }
    }
    return lines.join('\n');
  }
  function vagueContent(content) {
    const compact = content.trim().replace(/[\s，。！!？?、；;：:,.…]/g, '');
    // Only unmistakably generic entries are rejected, not a semantic classifier.
    // Specific goals need neither a number nor a prescribed verb.
    return !compact || /^(?:无|暂无|待定|待填写|待补充|TODO|TBD|同上|其他|略|继续|跟进|推进|处理|工作|日常工作|完成工作|完成任务|处理任务|待办事项|学习|沟通|开会|培训|完成培训|AI培训|整理|继续整理|整理文档|继续推进|继续跟进|继续优化|继续开发|开展工作|推进工作|处理工作|暂无计划|无计划|开发Agent|Agent开发)$/i.test(compact);
  }
  function validate(type, key, body) {
    if (type !== 'daily' && type !== 'weekly') return '请选择有效的日报或周报类型。';
    const context = dailyContext(key);
    if (type === 'daily' && !context.valid) return '请选择有效的日报日期。';
    const lines = String(body || '').trim().replace(/\r\n?/g, '\n').split('\n');
    if (lines[0] !== titleFor(type, key)) return '正文标题与所选日期/类型不一致，请核对。';
    if (/[`]|\*\*|^#{1,6}\s/m.test(body)) return '请移除 Markdown 标记，正文需要是微信纯文本。';

    const expected = type === 'weekly' ? ['本周工作进展', '下周计划']
      : ['今日艾维利', ...(context.requiresSummary ? ['本周工作总结'] : []), context.planHeading];
    const found = [];
    for (let i = type === 'weekly' ? 0 : 1; i < lines.length; i++) {
      const label = headingOf(lines[i]);
      if (['今日艾维利', '本周工作总结', '本周工作进展', ...PLAN_HEADINGS].includes(label)) found.push({ label, index: i });
    }
    for (const heading of expected) {
      if (!found.some(item => item.label === heading)) return `请保留“${heading}”标题，并至少填写一条具体事项。`;
    }
    if (found.length !== expected.length || found.some((item, i) => item.label !== expected[i])) {
      return `请按“${expected.join(' → ')}”顺序填写，不要重复或增加其他计划标题。`;
    }
    if (type === 'daily' && lines.slice(1, found[0].index).some(line => line.trim())) return '请将工作事项放在“今日艾维利”标题下。';

    for (let i = 0; i < found.length; i++) {
      const { label, index } = found[i];
      const entries = lines.slice(index + 1, found[i + 1]?.index).filter(line => line.trim());
      if (!entries.length) return `“${label}”至少填写一条事项：工作 + 具体目标、结果或进度。`;
      for (let j = 0; j < entries.length; j++) {
        const prefix = `“${label}”第 ${j + 1} 条`;
        const line = entries[j];
        if (/✔/u.test(line) || FORBIDDEN_ING.test(line)) return `${prefix}不能使用 ing 或 ✔；请使用 ✅ / 🚶‍♂️ / ❌ 标注状态。`;
        const match = line.match(CANONICAL_STATUS);
        if (!match || !match[2].trim()) return `${prefix}请以 ✅、🚶‍♂️ 或 ❌ 开头，并填写实际内容；未标记时不会自动猜测进度。`;
        if (vagueContent(match[2])) return `${prefix}过于笼统，请写清工作 + 具体目标、结果或进度，例如“完成 1 场销售部 AI 培训”。`;
      }
    }
    return '';
  }
  return { dateKey, weekKey, dailyContext, splitItems, build, parse, summarizeSources, validate };
});
