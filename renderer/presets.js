// 预制图标库：全部用 SVG 现场生成，不依赖外部图片。
// 配置里只保存 id（如 "folder-blue"、"file-pdf"、"app-globe"），渲染时再换成图片。

(() => {
  const C = {
    blue: ['#5AA9FF', '#2F7BEA'],
    sky: ['#67D4FF', '#1FA6DF'],
    teal: ['#4FE0C2', '#12B39B'],
    green: ['#7BDC6B', '#38A846'],
    yellow: ['#FFD95A', '#EFB00C'],
    orange: ['#FFB15C', '#F2761B'],
    red: ['#FF7B7B', '#E1434A'],
    pink: ['#FF8AC8', '#E04A98'],
    purple: ['#B794FF', '#7B4AE8'],
    indigo: ['#8C9BFF', '#4C58E6'],
    gray: ['#BCC3CE', '#7C8695'],
    slate: ['#7F8BA4', '#465269'],
  };

  // 24×24 线条符号
  const G = {
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-9 8"/>',
    music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 12.5h18"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
    cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .3-8 6 6 0 0 0-11.6 1A3.6 3.6 0 0 0 7 18.5z"/>',
    book: '<path d="M4 4.5h5.5a2.5 2.5 0 0 1 2.5 2.5v13a2 2 0 0 0-2-2H4zM20 4.5h-5.5A2.5 2.5 0 0 0 12 7v13a2 2 0 0 1 2-2h6z"/>',
    game: '<rect x="2.5" y="7" width="19" height="11" rx="5.5"/><path d="M7.5 10.5v4M5.5 12.5h4"/><circle cx="15.5" cy="11.5" r=".6"/><circle cx="18" cy="13.8" r=".6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 3.8 5.7 3.8 9s-1.2 6.3-3.8 9c-2.6-2.7-3.8-5.7-3.8-9S9.4 5.7 12 3z"/>',
    terminal: '<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M7 9l3.5 3L7 15M12.5 15.5H17"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    chat: '<path d="M4 5h16v11H10l-6 4.5z"/><path d="M8.5 10.5h7"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>',
    camera: '<path d="M3.5 8h3.5l2-3h6l2 3h3.5v11h-17z"/><circle cx="12" cy="13" r="3.5"/>',
    chart: '<path d="M5 20v-8M10.5 20V5M16 20v-6M21 20.5H3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    edit: '<path d="M4 20h4.5L19.5 9 15 4.5 4 15.5z"/><path d="M13 6.5l4.5 4.5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
    bolt: '<path d="M13.5 2.5L5 13.5h6.5l-1 8 8.5-11h-6.5z"/>',
    home: '<path d="M3 11l9-7.5 9 7.5M5.5 9.5V20h13V9.5M10 20v-6h4v6"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M4.5 9v11h15V9M10 13h4"/>',
  };

  const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;
  const glyph = (name, x, y, scale, stroke = '#fff', width = 2) =>
    `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${G[name]}</g>`;
  const grad = (id, [a, b], vertical = true) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

  function folder(color, g) {
    const [light, dark] = C[color];
    return svg(
      `<defs>${grad('f', [light, dark])}</defs>` +
      `<path d="M6 15a5 5 0 0 1 5-5h12.6a5 5 0 0 1 3.6 1.5l3.9 4h21.9a5 5 0 0 1 5 5V26H6z" fill="${dark}"/>` +
      `<rect x="6" y="19" width="52" height="36" rx="6" fill="url(#f)"/>` +
      `<rect x="6" y="19" width="52" height="2.5" rx="1.25" fill="#fff" opacity=".3"/>` +
      (g ? glyph(g, 21, 26, 0.92, '#fff', 2.3) : ''),
    );
  }

  function file(color, label, g) {
    const [light, dark] = C[color];
    const badge = label
      ? `<rect x="8" y="35" width="${label.length > 3 ? 40 : 34}" height="16" rx="4" fill="url(#b)"/>` +
        `<text x="${8 + (label.length > 3 ? 20 : 17)}" y="47" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="11" font-weight="700" fill="#fff">${label}</text>`
      : glyph(g, 20, 27, 1, dark, 2);
    return svg(
      `<defs>${grad('b', [light, dark], false)}</defs>` +
      `<path d="M17 5h21l14 14v36a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z" fill="#fff" stroke="#D5DAE2" stroke-width="1.5"/>` +
      `<path d="M38 5v10a4 4 0 0 0 4 4h10z" fill="#E4E8EF"/>` +
      (label ? `<rect x="20" y="22" width="14" height="2.5" rx="1.25" fill="${dark}" opacity=".35"/><rect x="20" y="27.5" width="20" height="2.5" rx="1.25" fill="${dark}" opacity=".2"/>` : '') +
      badge,
    );
  }

  function tile(color, g) {
    return svg(
      `<defs>${grad('t', C[color], false)}<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>` +
      `<rect x="5" y="5" width="54" height="54" rx="15" fill="url(#t)"/>` +
      `<rect x="5" y="5" width="54" height="54" rx="15" fill="url(#s)"/>` +
      glyph(g, 15.2, 15.2, 1.4, '#fff', 1.8),
    );
  }

  // 名称都是 [中文, English]，显示时按界面语言取
  const groups = [
    {
      title: ['文件夹', 'Folders'],
      items: ['blue', 'sky', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'gray']
        .map((c) => ({ id: `folder-${c}`, name: ['文件夹', 'Folder'], svg: folder(c) })),
    },
    {
      title: ['带符号的文件夹', 'Folders with symbols'],
      items: [
        ['doc', 'blue', '文档', 'Documents'], ['image', 'pink', '图片', 'Pictures'], ['music', 'purple', '音乐', 'Music'],
        ['video', 'red', '视频', 'Videos'], ['download', 'teal', '下载', 'Downloads'], ['code', 'slate', '代码', 'Code'],
        ['briefcase', 'orange', '工作', 'Work'], ['star', 'yellow', '收藏', 'Favorites'], ['heart', 'red', '喜欢', 'Liked'],
        ['cloud', 'sky', '云盘', 'Cloud drive'], ['book', 'green', '学习', 'Study'], ['game', 'indigo', '游戏', 'Games'],
      ].map(([g, c, zh, en]) => ({ id: `folder-${g}`, name: [zh, en], svg: folder(c, g) })),
    },
    {
      title: ['文件', 'Files'],
      items: [
        ['doc', 'blue', 'DOC', '文档', 'Document'], ['xls', 'green', 'XLS', '表格', 'Spreadsheet'],
        ['ppt', 'orange', 'PPT', '演示', 'Presentation'], ['pdf', 'red', 'PDF', 'PDF', 'PDF'],
        ['txt', 'gray', 'TXT', '文本', 'Text'], ['md', 'slate', 'MD', 'Markdown', 'Markdown'],
        ['zip', 'yellow', 'ZIP', '压缩包', 'Archive'], ['code', 'teal', null, '代码', 'Code', 'code'],
        ['image', 'pink', null, '图片', 'Image', 'image'], ['audio', 'purple', null, '音频', 'Audio', 'music'],
        ['video', 'red', null, '视频', 'Video', 'video'], ['data', 'indigo', 'DATA', '数据', 'Data'],
      ].map(([id, c, label, zh, en, g]) => ({ id: `file-${id}`, name: [zh, en], svg: file(c, label, g) })),
    },
    {
      title: ['应用', 'Apps'],
      items: [
        ['globe', 'blue', '浏览器', 'Browser'], ['terminal', 'slate', '终端', 'Terminal'], ['settings', 'gray', '设置', 'Settings'],
        ['game', 'indigo', '游戏', 'Games'], ['chat', 'green', '聊天', 'Chat'], ['mail', 'sky', '邮件', 'Mail'],
        ['music', 'pink', '音乐', 'Music'], ['camera', 'orange', '相机', 'Camera'], ['chart', 'teal', '数据', 'Data'],
        ['calendar', 'red', '日历', 'Calendar'], ['edit', 'yellow', '笔记', 'Notes'], ['lock', 'purple', '安全', 'Security'],
        ['bolt', 'orange', '工具', 'Tools'], ['home', 'blue', '主页', 'Home'], ['cloud', 'sky', '云', 'Cloud'],
        ['archive', 'gray', '归档', 'Archive'],
      ].map(([g, c, zh, en]) => ({ id: `app-${g}`, name: [zh, en], svg: tile(c, g) })),
    },
  ];

  const urls = new Map();
  for (const group of groups) {
    for (const item of group.items) {
      item.url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(item.svg)}`;
      urls.set(item.id, item.url);
    }
  }

  window.EdgeletPresets = { groups, url: (id) => urls.get(id) || null };
})();
