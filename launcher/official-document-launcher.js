const { spawn, spawnSync } = require('child_process');
const http = require('http');

const appUrl = 'http://127.0.0.1:3000/dashboard.html';

function fail(message) {
  spawn('cmd.exe', ['/c', 'msg', '*', message], { windowsHide: true });
  process.exit(1);
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

try {
  require('../server');
} catch (error) {
  fail(`The app failed to start: ${error.message}`);
}

waitForServer(3000)
  .catch(() => undefined)
  .finally(() => {
    if (process.env.OFFICIAL_DOCUMENT_MANAGER_NO_BROWSER !== '1') {
      openAppWindow();
    }
  });

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
