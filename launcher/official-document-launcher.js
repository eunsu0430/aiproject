const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const appUrl = 'http://127.0.0.1:3000/dashboard.html';

function fail(message) {
  spawn('cmd.exe', ['/c', 'msg', '*', message], { windowsHide: true });
  process.exit(1);
}

if (!fs.existsSync(path.join(root, 'server.js'))) {
  fail(`server.js was not found: ${root}`);
}

if (!fs.existsSync(path.join(root, 'node_modules'))) {
  fail('node_modules was not found. Run npm install first.');
}

spawnSync('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  'Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }'
], {
  windowsHide: true,
  stdio: 'ignore'
});

spawn('cmd.exe', ['/c', 'npm.cmd', 'start'], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  windowsHide: true
}).unref();

waitForServer(3000)
  .catch(() => undefined)
  .finally(openAppWindow);

function waitForServer(retries) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get('http://127.0.0.1:3000/health', (response) => {
        response.resume();
        resolve();
      });
      request.on('error', () => {
        if (retries <= 0) {
          reject(new Error('server timeout'));
          return;
        }
        retries -= 1;
        setTimeout(attempt, 100);
      });
      request.setTimeout(500, () => request.destroy());
    };

    attempt();
  });
}

function openAppWindow() {
  const edge = spawn('cmd.exe', ['/c', 'start', '""', 'msedge.exe', `--app=${appUrl}`], {
    windowsHide: true,
    detached: true,
    stdio: 'ignore'
  });

  edge.on('error', () => {
    spawn('cmd.exe', ['/c', 'start', '""', appUrl], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    }).unref();
  });

  edge.unref();
}
