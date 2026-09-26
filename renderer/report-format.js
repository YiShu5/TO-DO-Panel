(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReportFormat = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function weekKey(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0')}`;
  }
  // A newline is the safe item boundary. Inline Chinese enumeration is kept
  // verbatim so “一、…；二、…” remains visibly separated in the copied body.
  function splitItems(raw) {
    return String(raw || '').replace(/\r\n?/g, '\n')
      .split('\n').map(line => line.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '').trim()).filter(Boolean);
  }
  function workLine(line) {
    const explicit = line.match(/^(✅|🚶)\s*[：:]?\s*(.*)$/u);
    if (explicit) return `${explicit[1]}：${explicit[2]}`;
    const done = /^(?:已完成|完成了|已提交|已交付|已上线)/.test(line)
      && !/(?:未完成|尚未|还未|正在|仍在|待确认|还在)/.test(line);
    return `${done ? '✅' : '🚶'}：${line}`;
  }
  function build({type, key, work, plan, heading = '明日计划'}) {
    const title = type === 'weekly' ? '本周工作进展' : `${Number(key.slice(5, 7))}月${Number(key.slice(8, 10))}日工作总结`;
    return [title, ...splitItems(work).map(workLine), '', type === 'weekly' ? '下周计划' : `${heading === '下周计划' ? '下周计划' : '明日计划'}：`, ...splitItems(plan).map((line, i) => `${i + 1}、${line}`)].join('\n');
  }
  function parse(body) {
    const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
    const divider = lines.findIndex(line => /^(明日计划|下周计划)[：:]?\s*$/.test(line.trim()));
    const start = /^(?:\d+月\d+日工作总结|本周工作进展)$/.test(lines[0]?.trim()) ? 1 : 0;
    return {
      work: lines.slice(start, divider < 0 ? undefined : divider).filter(line => line.trim()).join('\n'),
      plan: divider < 0 ? '' : lines.slice(divider + 1).map(line => line.replace(/^\s*\d+[、.)]\s*/, '')).join('\n').trim(),
      heading: divider >= 0 && lines[divider].startsWith('下周') ? '下周计划' : '明日计划',
    };
  }
  function summarizeSources(items) {
    const seen = new Set();
    const lines = [];
    for (const item of items) {
      for (const line of parse(item.content).work.split('\n')) {
        const normalized = line.trim();
        if (/^(✅|🚶)[：:]/u.test(normalized) && !seen.has(normalized)) {
          seen.add(normalized); lines.push(normalized);
        }
      }
    }
    return lines.join('\n');
  }
  function validate(type, key, body) {
    const lines = String(body || '').trim().split(/\r?\n/);
    const title = type === 'weekly' ? '本周工作进展' : `${Number(key.slice(5, 7))}月${Number(key.slice(8, 10))}日工作总结`;
    if (lines[0] !== title) return '正文标题与所选日期/类型不一致，请核对。';
    const div = lines.findIndex(line => type === 'weekly' ? line === '下周计划' : /^(明日计划|下周计划)：$/.test(line));
    if (div < 0) return '请保留规定的计划标题。';
    const work = lines.slice(1, div).filter(line => line.trim());
    if (!work.length || work.some(line => !/^(✅|🚶)：\S/u.test(line))) return '每条工作请使用 ✅：或 🚶：开头，并填写实际内容。';
    const plans = lines.slice(div + 1).filter(line => line.trim());
    if (plans.some((line, i) => !line.startsWith(`${i + 1}、`) || !line.slice(String(i + 1).length + 1).trim())) return '计划请按 1、2、3、连续编号。';
    if (/[`]|\*\*|^#{1,6}\s/m.test(body)) return '请移除 Markdown 标记，正文需要是微信纯文本。';
    return '';
  }
  return { dateKey, weekKey, splitItems, build, parse, summarizeSources, validate };
});
