/* Offline asset renderer: electron tools/slot-assets/render.cjs <jobsModule> <outDir> [onlyName...]
 * Renders PBR scenes with three.js in a hidden Electron window and writes PNGs. Not shipped in the app. */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const [jobsFile, outDir, ...only] = process.argv.slice(-(process.argv.length - process.argv.findIndex((a) => a.endsWith('render.cjs')) - 1));
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('use-angle', 'metal');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 900, show: false, webPreferences: { webSecurity: false, offscreen: false, backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, _l, msg) => console.log('[page]', msg));
  const q = new URLSearchParams({ jobs: path.resolve(jobsFile), only: only.join(',') });
  await win.loadFile(path.join(__dirname, 'scene.html'), { search: q.toString() });
  const results = await win.webContents.executeJavaScript('window.__done');
  fs.mkdirSync(outDir, { recursive: true });
  for (const r of results) {
    const buf = Buffer.from(r.data.split(',')[1], 'base64');
    fs.writeFileSync(path.join(outDir, r.name + '.png'), buf);
    console.log('wrote', r.name + '.png', r.w + 'x' + r.h, buf.length + ' bytes');
  }
  app.quit();
});
