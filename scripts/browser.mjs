// Development only. A private preview and a fresh browser profile for each run.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const root = fileURLToPath(new URL('../', import.meta.url));

// CLEANFRAME_BROWSER_CHANNEL=chrome uses the installed Chrome instead of Playwright's Chromium.
// CLEANFRAME_BROWSER_PATH runs another browser, such as an old Chromium close to a TV's engine. It stays off the network.
export function launchOptions(args = []) {
  const path = process.env.CLEANFRAME_BROWSER_PATH;
  if (!path) return { headless: true, channel: process.env.CLEANFRAME_BROWSER_CHANNEL || undefined, args };
  return { headless: true, executablePath: path, args: [...args, '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-default-apps'] };
}

// Playwright's networkidle has hung with no request open while the CPU is throttled.
// The page's own resource list going quiet answers the same question without that signal.
export async function networkQuiet(page, quietMs = 500) {
  await page.waitForLoadState('load');
  await page.evaluate(ms => new Promise(resolve => {
    let count = -1, since = 0;
    (function poll() {
      const seen = performance.getEntriesByType('resource').length;
      if (seen !== count) { count = seen; since = performance.now(); }
      if (performance.now() - since >= ms) resolve();
      else setTimeout(poll, 50);
    })();
  }), quietMs);
}

export async function openPreview({ publicFonts = false, duo = false } = {}) {
  const args = ['scripts/preview.py', '--port', '0'];
  // The Duo checks need the private files, whatever the rest of the run asks for.
  if (!duo && (publicFonts || process.env.CLEANFRAME_PUBLIC_FONTS === '1')) args.push('--public-fonts');
  const server = spawn('python3', args, {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe']
  });
  let browser;
  let diagnostics = '';
  server.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000); });
  try {
    const baseURL = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(Error('Preview startup timed out')), 10000);
      server.once('error', error => { clearTimeout(timeout); reject(error); });
      server.once('exit', code => { clearTimeout(timeout); reject(Error('Preview exited: ' + code + ' ' + diagnostics)); });
      server.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timeout); resolve(match[0]); }
      });
    });
    browser = await chromium.launch(launchOptions());
    return { browser, baseURL, close: async () => {
      try { await browser.close(); }
      finally { server.kill(); await once(server, 'exit'); }
    } };
  } catch (error) {
    server.kill();
    if (browser) await browser.close();
    throw error;
  }
}
