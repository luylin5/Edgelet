// 把 assets/icon.svg（大尺寸）和 assets/icon-small.svg（16–32px）渲染成 assets/icon.ico 和 assets/icon.png。
// 用 Electron 自带的 Chromium 渲染 SVG，所以要用 electron 运行：npm run icon

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const assets = path.resolve(__dirname, '..', 'assets');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const SMALL_MAX = 32;

async function render(win, svgFile, size) {
  const svg = fs.readFileSync(path.join(assets, svgFile), 'utf8');
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(url)};
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = ${size};
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, ${size}, ${size});
    return { rgba: Array.from(ctx.getImageData(0, 0, ${size}, ${size}).data), png: c.toDataURL('image/png') };
  })()`);
}

// 小尺寸存成 BMP（兼容性最好），256 存成 PNG
function dibEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = ((size - 1 - y) * size + x) * 4;
      pixels[d] = rgba[s + 2];
      pixels[d + 1] = rgba[s + 1];
      pixels[d + 2] = rgba[s];
      pixels[d + 3] = rgba[s + 3];
    }
  }
  return Buffer.concat([header, pixels, Buffer.alloc(Math.ceil(size / 32) * 4 * size)]);
}

const pngBuffer = (dataURL) => Buffer.from(dataURL.split(',')[1], 'base64');

function buildIco(entries) {
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header[e] = size >= 256 ? 0 : size;
    header[e + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');

  const entries = [];
  for (const size of ICO_SIZES) {
    const { rgba, png } = await render(win, size <= SMALL_MAX ? 'icon-small.svg' : 'icon.svg', size);
    entries.push({ size, data: size >= 256 ? pngBuffer(png) : dibEntry(size, rgba) });
  }
  fs.writeFileSync(path.join(assets, 'icon.ico'), buildIco(entries));

  const { png } = await render(win, 'icon.svg', 512);
  fs.writeFileSync(path.join(assets, 'icon.png'), pngBuffer(png));

  console.log('已生成 assets/icon.ico 和 assets/icon.png');
  app.quit();
});
