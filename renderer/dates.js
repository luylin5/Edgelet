// 备忘日期：从输入里识别「明天」「周五下午3点」「10/15」这类写法，以及列表上的显示格式。
// 日期统一用本地时间的字符串 { date: 'YYYY-MM-DD', time: 'HH:MM' | null }。
window.EdgeletDates = (() => {
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const startOfToday = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  const mondayIdx = (d) => (d.getDay() + 6) % 7; // 周一 = 0 … 周日 = 6
  const dayDiff = (a, b) => Math.round((a - b) / 864e5);
  const WD_NAMES = '一二三四五六日';

  const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  function num(s) {
    if (/^\d+$/.test(s)) return Number(s);
    const m = s.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
    if (m) return (m[1] ? CN[m[1]] : 1) * 10 + (m[2] ? CN[m[2]] : 0);
    return s.length === 1 && s in CN ? CN[s] : NaN;
  }
  const N = '(\\d{1,2}|[一二两三四五六七八九十]{1,3})';

  function valid(y, m, d) {
    const dt = new Date(y, m - 1, d);
    return dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
  }
  // 没写年份的日期如果已经过了，就当作明年
  function upcoming(m, d, today) {
    const dt = valid(today.getFullYear(), m, d);
    return dt && dt < today ? valid(today.getFullYear() + 1, m, d) : dt;
  }

  const RELATIVE = { 今天: 0, 今日: 0, 今早: 0, 今晚: 0, 今夜: 0, 明天: 1, 明日: 1, 明早: 1, 明晚: 1, 后天: 2, 大后天: 3 };
  const WEEKDAY = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6, 末: 5 };

  // 按顺序尝试，第一条能匹配上的规则生效
  const DATE_RULES = [
    [/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?/, (m) => valid(+m[1], +m[2], +m[3])],
    [new RegExp(`${N}月${N}[日号]?`), (m, t) => upcoming(num(m[1]), num(m[2]), t)],
    [/(?<![\d/:.-])(\d{1,2})[/-](\d{1,2})(?![\d/:.-])/, (m, t) => upcoming(+m[1], +m[2], t)],
    [/大后天|后天|明天|明日|明早|明晚|今天|今日|今早|今晚|今夜/, (m, t) => addDays(t, RELATIVE[m[0]])],
    [new RegExp(`${N}\\s*天(?:之后|以后|后)`), (m, t) => addDays(t, num(m[1]))],
    [new RegExp(`${N}\\s*个?(?:周|星期|礼拜)(?:之后|以后|后)`), (m, t) => addDays(t, num(m[1]) * 7)],
    [/(下下|下个?|这个?|本)?(?:周|星期|礼拜)([一二三四五六日天末])/, (m, t) => {
      const pre = m[1] || '';
      const idx = mondayIdx(t);
      if (m[2] === '末' && !pre && idx >= 5) return t; // 周末当天说「周末」就是今天
      let d = addDays(t, WEEKDAY[m[2]] - idx);         // 本周的那一天
      if (pre.startsWith('下下')) d = addDays(d, 14);
      else if (pre.startsWith('下')) d = addDays(d, 7);
      else if (!pre && d < t) d = addDays(d, 7);       // 「周一」已经过了就是下周一
      return d;
    }],
    [/(下下|下个?)(?:周|星期|礼拜)/, (m, t) => addDays(t, 7 - mondayIdx(t) + (m[1] === '下下' ? 7 : 0))],
    [/月底/, (m, t) => new Date(t.getFullYear(), t.getMonth() + 1, 0)],
    [/(?<![\d月/-])(\d{1,2})\s*[日号](?!\d)|(?<![月])([一二三四五六七八九十]{1,3})号/, (m, t) => {
      const d = num(m[1] || m[2]);
      const dt = valid(t.getFullYear(), t.getMonth() + 1, d);
      if (dt && dt >= t) return dt;
      return valid(t.getFullYear(), t.getMonth() + 2, d) || null; // 本月已过就是下个月
    }],
  ];

  const PM = /下午|傍晚|晚上|夜里|夜间|晚/;
  const TIME_RE = new RegExp(
    '(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|夜间)?\\s*(?<![\\d/.:第-])'
    + `(\\d{1,2}|[一二两三四五六七八九十]{1,3})`
    + `(?:[:：](\\d{2})(?!\\d)|\\s*点(?:钟)?(半|一刻|三刻|${N}分?)?)`,
    'g',
  );

  function findTime(text, datePeriod) {
    for (const m of text.matchAll(TIME_RE)) {
      const period = m[1] || '';
      let h = num(m[2]);
      const hasMin = m[3] || m[4];
      // 「快一点」「多一点」不是时间
      if (m[2] === '一' && !period && !hasMin) continue;
      let min = 0;
      if (m[3]) min = +m[3];
      else if (m[4]) min = { 半: 30, 一刻: 15, 三刻: 45 }[m[4]] ?? num(m[5]);
      if (PM.test(period) || (!period && datePeriod === 'pm')) { if (h < 12) h += 12; }
      else if (period === '中午') { if (h <= 3) h += 12; }
      else if (!period && !datePeriod && h >= 1 && h <= 5) h += 12; // 没说上下午时，1~5 点多半是下午
      if (!(h >= 0 && h <= 23 && min >= 0 && min <= 59)) continue;
      return { time: `${pad(h)}:${pad(min)}`, index: m.index, end: m.index + m[0].length };
    }
    return null;
  }

  // 识别出的日期从正文里去掉，连同紧跟的「前 / 之前」（但「前端」「前台」这类词保留）
  const SUFFIX = /^\s*(?:之前|以前|前(?![端台面天后排夕景途]))/;

  function parse(raw) {
    const text = raw.trim();
    if (!text) return null;
    const today = startOfToday();
    const cuts = [];
    let date = null;
    let datePeriod = null;
    for (const [re, get] of DATE_RULES) {
      const m = re.exec(text);
      const d = m && get(m, today);
      if (!d) continue;
      date = d;
      if (/早/.test(m[0])) datePeriod = 'am';
      if (/晚|夜/.test(m[0])) datePeriod = 'pm';
      cuts.push([m.index, m.index + m[0].length]);
      break;
    }
    // 找时间时把日期部分遮住，避免「10/15」里的数字被当成钟点
    const masked = cuts.length ? text.slice(0, cuts[0][0]) + ' '.repeat(cuts[0][1] - cuts[0][0]) + text.slice(cuts[0][1]) : text;
    const t = findTime(masked, datePeriod);
    if (t) cuts.push([t.index, t.end]);
    if (!date && !t) return null;

    if (!date) {
      // 只写了时间：还没到就是今天，已经过了就是明天
      const [h, mi] = t.time.split(':').map(Number);
      const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, mi);
      date = at > new Date() ? today : addDays(today, 1);
    }

    let rest = text;
    for (const [s, e] of cuts.sort((a, b) => b[0] - a[0])) {
      const suffix = rest.slice(e).match(SUFFIX);
      rest = rest.slice(0, s) + ' ' + rest.slice(e + (suffix ? suffix[0].length : 0));
    }
    rest = rest.replace(/\s+/g, ' ').replace(/^[\s,，.。:：;；、-]+|[\s,，:：;；、-]+$/g, '').trim();
    return { due: { date: ymd(date), time: t ? t.time : null }, text: rest || text };
  }

  function at(due) {
    const d = toDate(due.date);
    if (due.time) {
      const [h, m] = due.time.split(':').map(Number);
      d.setHours(h, m);
    } else {
      d.setHours(23, 59, 59);
    }
    return d;
  }

  function dayName(due) {
    const today = startOfToday();
    const d = toDate(due.date);
    const diff = dayDiff(d, today);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '后天';
    if (diff === -1) return '昨天';
    if (diff > 0 && diff < 7) return `周${WD_NAMES[mondayIdx(d)]}`;
    const md = `${d.getMonth() + 1}/${d.getDate()}`;
    return d.getFullYear() === today.getFullYear() ? md : `${d.getFullYear()}/${md}`;
  }

  const label = (due) => (due.time ? `${dayName(due)} ${due.time}` : dayName(due));

  // overdue | today | tomorrow | later
  function status(due) {
    const diff = dayDiff(toDate(due.date), startOfToday());
    if (diff < 0 || at(due) < new Date()) return 'overdue';
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    return 'later';
  }

  function full(due) {
    const d = toDate(due.date);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${WD_NAMES[mondayIdx(d)]}${due.time ? ` ${due.time}` : ''}`;
  }

  // 快捷日期：今天 / 明天 / 周末 / 下周一
  function quick(key) {
    const t = startOfToday();
    const idx = mondayIdx(t);
    const d = {
      today: t,
      tomorrow: addDays(t, 1),
      weekend: idx >= 5 ? t : addDays(t, 5 - idx),
      nextweek: addDays(t, 7 - idx),
    }[key];
    return d ? { date: ymd(d), time: null } : null;
  }

  return { parse, label, status, full, quick, at, ymd, toDate, addDays, startOfToday, mondayIdx, WD_NAMES };
})();
