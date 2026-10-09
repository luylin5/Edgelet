// 备忘日期：从输入里识别「明天」「周五下午3点」「10/15」「tomorrow 3pm」这类写法，以及列表上的显示格式。
// 日期统一用本地时间的字符串 { date: 'YYYY-MM-DD', time: 'HH:MM' | null }。
// 识别时中英文写法都认；显示格式跟随界面语言（setLang）。
window.EdgeletDates = (() => {
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const startOfToday = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  const mondayIdx = (d) => (d.getDay() + 6) % 7; // 周一 = 0 … 周日 = 6
  const dayDiff = (a, b) => Math.round((a - b) / 864e5);

  let lang = 'zh';
  const setLang = (l) => { lang = l === 'en' ? 'en' : 'zh'; };

  const WD_ZH = '一二三四五六日';
  const WD_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WD_EN_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MON_EN_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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
  // 星期几：pre 为 'next' / 'nextnext' / 'this' / ''；不带前缀时已经过去的就算下周
  function weekday(t, idx, pre) {
    let d = addDays(t, idx - mondayIdx(t));
    if (pre === 'nextnext') d = addDays(d, 14);
    else if (pre === 'next') d = addDays(d, 7);
    else if (!pre && d < t) d = addDays(d, 7);
    return d;
  }
  const weekend = (t) => (mondayIdx(t) >= 5 ? t : addDays(t, 5 - mondayIdx(t)));

  const RELATIVE = { 今天: 0, 今日: 0, 今早: 0, 今晚: 0, 今夜: 0, 明天: 1, 明日: 1, 明早: 1, 明晚: 1, 后天: 2, 大后天: 3 };
  const WEEKDAY = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6, 末: 5 };
  const EN_DAY = {
    monday: 0, mon: 0, tuesday: 1, tues: 1, tue: 1, wednesday: 2, wed: 2, thursday: 3, thurs: 3, thur: 3, thu: 3,
    friday: 4, fri: 4, saturday: 5, sat: 5, sunday: 6, sun: 6,
  };
  const EN_MONTH = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec';
  const monthIdx = (s) => MON_EN.findIndex((m) => s.toLowerCase().startsWith(m.toLowerCase())) + 1;

  // 按顺序尝试，第一条能匹配上的规则生效
  const DATE_RULES = [
    [/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?/, (m) => valid(+m[1], +m[2], +m[3])],
    [new RegExp(`${N}月${N}[日号]?`), (m, t) => upcoming(num(m[1]), num(m[2]), t)],
    // 「I may 5 …」里的 may 不是五月
    [new RegExp(`(?<!\\b(?:i|you|we|he|she|they|it)\\s+)\\b(${EN_MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'), (m, t) => upcoming(monthIdx(m[1]), +m[2], t)],
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${EN_MONTH})\\b`, 'i'), (m, t) => upcoming(monthIdx(m[2]), +m[1], t)],
    [/(?<![\d/:.-])(\d{1,2})[/-](\d{1,2})(?![\d/:.-])/, (m, t) => upcoming(+m[1], +m[2], t)],
    [/大后天|后天|明天|明日|明早|明晚|今天|今日|今早|今晚|今夜/, (m, t) => addDays(t, RELATIVE[m[0]])],
    [/\b(?:the\s+)?day\s+after\s+tomorrow\b/i, (m, t) => addDays(t, 2)],
    [/\b(today|tonight|tomorrow|tmrw|tmr)\b/i, (m, t) => addDays(t, /^to(day|night)$/i.test(m[1]) ? 0 : 1)],
    [new RegExp(`${N}\\s*天(?:之后|以后|后)`), (m, t) => addDays(t, num(m[1]))],
    [new RegExp(`${N}\\s*个?(?:周|星期|礼拜)(?:之后|以后|后)`), (m, t) => addDays(t, num(m[1]) * 7)],
    [/\bin\s+(\d{1,2})\s+(day|week)s?\b/i, (m, t) => addDays(t, +m[1] * (/^w/i.test(m[2]) ? 7 : 1))],
    [/(下下|下个?|这个?|本)?(?:周|星期|礼拜)([一二三四五六日天末])/, (m, t) => {
      const pre = m[1] || '';
      if (m[2] === '末' && !pre) return weekend(t); // 周末当天说「周末」就是今天
      return weekday(t, WEEKDAY[m[2]], pre.startsWith('下下') ? 'nextnext' : pre.startsWith('下') ? 'next' : pre ? 'this' : '');
    }],
    // 英文星期：sat / sun 太容易和普通单词撞，只认全称或带 next / this 的缩写
    [/\b(?:(next|this)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thur|thu|fri)\b|\b(next|this)\s+(sat|sun)\b/i, (m, t) => {
      const pre = (m[1] || m[3] || '').toLowerCase();
      return weekday(t, EN_DAY[(m[2] || m[4]).toLowerCase()], pre);
    }],
    [/\b(?:this\s+)?weekend\b/i, (m, t) => weekend(t)],
    [/(下下|下个?)(?:周|星期|礼拜)/, (m, t) => addDays(t, 7 - mondayIdx(t) + (m[1] === '下下' ? 7 : 0))],
    [/\bnext\s+week\b/i, (m, t) => addDays(t, 7 - mondayIdx(t))],
    [/月底|\bend\s+of\s+(?:the\s+)?month\b/i, (m, t) => new Date(t.getFullYear(), t.getMonth() + 1, 0)],
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
  // 英文：3pm、3:30 pm、at 9、at 9:15、noon
  const EN_TIME = [
    /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/gi,
    /\bat\s+(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:am|pm|%|\/|-|\d))/gi,
    /\b(?:at\s+)?(noon)\b/gi,
  ];

  // 没说上下午时，1~5 点多半是下午
  function adjust(h, period, datePeriod) {
    if (period === 'pm' || PM.test(period) || (!period && datePeriod === 'pm')) return h < 12 ? h + 12 : h;
    if (period === 'am') return h === 12 ? 0 : h;
    if (period === '中午') return h <= 3 ? h + 12 : h;
    if (!period && !datePeriod && h >= 1 && h <= 5) return h + 12;
    return h;
  }

  function findTime(text, datePeriod) {
    for (const re of EN_TIME) {
      for (const m of text.matchAll(re)) {
        let h;
        let min = 0;
        if (m[1].toLowerCase() === 'noon') h = 12;
        else {
          h = +m[1];
          min = m[2] ? +m[2] : 0;
          const ap = (m[3] || '').toLowerCase().replace(/\./g, '');
          if (ap && (h < 1 || h > 12)) continue;
          h = adjust(h, ap, datePeriod);
        }
        if (h > 23 || min > 59) continue;
        return { time: `${pad(h)}:${pad(min)}`, index: m.index, end: m.index + m[0].length };
      }
    }
    for (const m of text.matchAll(TIME_RE)) {
      const period = m[1] || '';
      let h = num(m[2]);
      const hasMin = m[3] || m[4];
      // 「快一点」「多一点」不是时间
      if (m[2] === '一' && !period && !hasMin) continue;
      let min = 0;
      if (m[3]) min = +m[3];
      else if (m[4]) min = { 半: 30, 一刻: 15, 三刻: 45 }[m[4]] ?? num(m[5]);
      h = adjust(h, period, datePeriod);
      if (!(h >= 0 && h <= 23 && min >= 0 && min <= 59)) continue;
      return { time: `${pad(h)}:${pad(min)}`, index: m.index, end: m.index + m[0].length };
    }
    return null;
  }

  // 识别出的日期从正文里去掉，连同紧跟的「前 / 之前」（但「前端」「前台」这类词保留）、
  // 以及英文里前面的 on / at / by / before / due
  const SUFFIX = /^\s*(?:之前|以前|前(?![端台面天后排夕景途]))/;
  const PREFIX_EN = /\b(?:on|at|by|before|due)\s+$/i;

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
      if (/晚|夜|tonight/i.test(m[0])) datePeriod = 'pm';
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
    for (const [s0, e] of cuts.sort((a, b) => b[0] - a[0])) {
      const suffix = rest.slice(e).match(SUFFIX);
      const prefix = rest.slice(0, s0).match(PREFIX_EN);
      const s = prefix ? s0 - prefix[0].length : s0;
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

  // 月/日的简短写法：中文 10/15，英文 Oct 15；不是今年再带上年份
  function shortDate(d, today) {
    const sameYear = d.getFullYear() === today.getFullYear();
    if (lang === 'en') return `${MON_EN[d.getMonth()]} ${d.getDate()}${sameYear ? '' : `, ${d.getFullYear()}`}`;
    const md = `${d.getMonth() + 1}/${d.getDate()}`;
    return sameYear ? md : `${d.getFullYear()}/${md}`;
  }

  function dayName(due) {
    const today = startOfToday();
    const d = toDate(due.date);
    const diff = dayDiff(d, today);
    const en = lang === 'en';
    if (diff === 0) return en ? 'Today' : '今天';
    if (diff === 1) return en ? 'Tomorrow' : '明天';
    if (diff === 2 && !en) return '后天';
    if (diff === -1) return en ? 'Yesterday' : '昨天';
    if (diff > 0 && diff < 7) return en ? WD_EN[mondayIdx(d)] : `周${WD_ZH[mondayIdx(d)]}`;
    return shortDate(d, today);
  }

  const label = (due) => (due.time ? `${dayName(due)} ${due.time}` : dayName(due));

  // 完成时间等时间戳的简短日期：今天 / 昨天 / 10/9
  function stampLabel(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return dayName({ date: ymd(d), time: null });
  }

  // overdue | today | tomorrow | later
  function status(due) {
    const diff = dayDiff(toDate(due.date), startOfToday());
    if (diff < 0 || at(due) < new Date()) return 'overdue';
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    return 'later';
  }

  // 提示里的完整日期：2026年10月15日 周四 08:30 / Thu, Oct 15, 2026 08:30
  function full(due) {
    const d = toDate(due.date);
    const time = due.time ? ` ${due.time}` : '';
    if (lang === 'en') return `${WD_EN[mondayIdx(d)]}, ${MON_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}${time}`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${WD_ZH[mondayIdx(d)]}${time}`;
  }

  // 日历里时间滚轮上方的日期行：2026年10月15日 星期四 / Thursday, October 15, 2026
  function long(date) {
    const d = toDate(date);
    if (lang === 'en') return `${WD_EN_LONG[mondayIdx(d)]}, ${MON_EN_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${WD_ZH[mondayIdx(d)]}`;
  }

  const monthTitle = (d) => (lang === 'en' ? `${MON_EN_LONG[d.getMonth()]} ${d.getFullYear()}` : `${d.getFullYear()}年${d.getMonth() + 1}月`);
  const weekHeads = () => (lang === 'en' ? ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] : [...WD_ZH]);
  const timestamp = (ts) => new Date(ts).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN', {
    month: lang === 'en' ? 'short' : 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });

  // 快捷日期：今天 / 明天 / 周末 / 下周一
  function quick(key) {
    const t = startOfToday();
    const d = {
      today: t,
      tomorrow: addDays(t, 1),
      weekend: weekend(t),
      nextweek: addDays(t, 7 - mondayIdx(t)),
    }[key];
    return d ? { date: ymd(d), time: null } : null;
  }

  return {
    parse, label, status, full, long, quick, at, stampLabel, monthTitle, weekHeads, timestamp, setLang,
    ymd, toDate, addDays, startOfToday, mondayIdx,
  };
})();
