// 创建「Edgelet」快捷方式（项目目录、桌面、开始菜单）。
// 快捷方式直接启动 electron.exe，不会弹出命令行窗口。
// 用法：npm run launcher

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const icoPath = path.join(root, 'assets', 'icon.ico');

if (!fs.existsSync(electronExe)) {
  console.error('找不到 electron.exe，请先运行 npm install');
  process.exit(1);
}
if (!fs.existsSync(icoPath)) {
  console.error('找不到 assets/icon.ico，请先运行 npm run icon');
  process.exit(1);
}

const ps = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path $env:ROOT 'Edgelet.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Edgelet.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Edgelet.lnk')
)
foreach ($t in $targets) {
  $s = $shell.CreateShortcut($t)
  $s.TargetPath = $env:EXE
  $s.Arguments = '"' + $env:ROOT + '"'
  $s.WorkingDirectory = $env:ROOT
  $s.IconLocation = $env:ICO + ',0'
  $s.Description = 'Edgelet 贴边启动器'
  $s.Save()
  Write-Output $t
}
# 刷新图标缓存，让新图标立刻生效
try { ie4uinit.exe -show } catch {}
`;

const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
  env: { ...process.env, ROOT: root, EXE: electronExe, ICO: icoPath },
  encoding: 'utf8',
});
console.log('已创建快捷方式：\n' + out.trim());
