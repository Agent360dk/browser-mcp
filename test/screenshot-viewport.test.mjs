/**
 * A screenshot must say how its pixels map to the CSS pixels browser_click_xy takes.
 *
 * MEASURED 2026-10-04 (Windows, display scaling 150 %, page zoom 110 %, devicePixelRatio 1.65):
 * Page.captureScreenshot returns DEVICE pixels (3840 wide for a 2327 px wide CSS viewport).
 * click_xy takes CSS pixels, and its description says "take a screenshot, read the button's
 * position, click its center". Reading the position off the image and clicking it missed a
 * checkbox by ~450 px - and click_xy answered ok:true, landed:true. Nothing in the screenshot
 * answer told the agent that a conversion was needed, or by how much.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';
import { ledigtSpaend } from './hjaelp/ledigt-spaend.mjs';

// ── extension: the answer carries the CSS viewport and the device pixel ratio ──────────

function udvidelse(layoutMetrics) {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', active: true, windowId: 9 },
    'tabs.query': [{ id: 1, url: 'https://x.example', active: true, windowId: 9 }],
    'debugger.sendCommand': (_m, metode) => {
      if (metode === 'Page.captureScreenshot') return { data: 'PNGDATA' };
      if (metode === 'Page.getLayoutMetrics') {
        if (layoutMetrics instanceof Error) throw layoutMetrics;
        return layoutMetrics;
      }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return u;
}

test('the screenshot answer carries the CSS viewport and devicePixelRatio', async () => {
  const u = udvidelse({
    cssVisualViewport: { clientWidth: 2327.27, clientHeight: 1104.85, pageX: 0, pageY: 0, scale: 1 },
    visualViewport: { clientWidth: 3840, clientHeight: 1823, pageX: 0, pageY: 0, scale: 1 },
  });
  const svar = await u.hent('dispatch')(9876, 'screenshot', {});
  assert.match(String(svar.image), /PNGDATA/);
  assert.ok(svar.viewport, `no viewport in the answer: ${JSON.stringify(svar).slice(0, 200)}`);
  assert.equal(svar.viewport.css_width, 2327);
  assert.equal(svar.viewport.css_height, 1105);
  assert.equal(svar.viewport.device_pixel_ratio, 1.65);
});

test('a screenshot still arrives when the layout metrics cannot be read', async () => {
  const u = udvidelse(new Error('Page.getLayoutMetrics failed'));
  const svar = await u.hent('dispatch')(9876, 'screenshot', {});
  assert.match(String(svar.image), /PNGDATA/, 'the image must not depend on the metrics');
  assert.equal(svar.viewport, undefined);
});

// ── server: the agent is told, next to the image, how to convert ────────────────────────

const SRV = fileURLToPath(new URL('../mcp-server/index.js', import.meta.url));
const { WebSocket } = createRequire(new URL('../mcp-server/package.json', import.meta.url))('ws');
const BASE = await ledigtSpaend(5), MAX = BASE + 4;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const boern = [], sokler = [];
after(() => {
  for (const s of sokler) try { s.terminate(); } catch {}
  for (const b of boern) try { b.kill('SIGKILL'); } catch {}
});

function falskUdvidelse(result) {
  let stop = false;
  const proev = () => {
    if (stop) return;
    for (let p = BASE; p <= MAX; p++) {
      const ws = new WebSocket(`ws://127.0.0.1:${p}`, { origin: 'chrome-extension://' + 'a'.repeat(32) });
      ws.on('error', () => {});
      ws.on('open', () => {
        sokler.push(ws);
        ws.send(JSON.stringify({ type: 'hello', extensionId: 'a'.repeat(32), version: '1.30.1', name: 'fake' }));
      });
      ws.on('message', (d) => {
        let m; try { m = JSON.parse(d); } catch { return; }
        if (m.id === undefined) return;
        ws.send(JSON.stringify({ id: m.id, result: m.method === 'screenshot' ? result : {} }));
      });
    }
    setTimeout(proev, 400);
  };
  proev();
  return () => { stop = true; };
}

function skaermbillede(result) {
  const p = spawn(process.execPath, [SRV], { stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER_MCP_BASE_PORT: String(BASE), BROWSER_MCP_MAX_PORT: String(MAX) } });
  boern.push(p); p.stderr.on('data', () => {});
  const stopUdvidelse = falskUdvidelse(result);
  let buf = '';
  return new Promise((res) => {
    const ur = setTimeout(() => { stopUdvidelse(); p.kill('SIGKILL'); res(null); }, 40000);
    p.stdout.on('data', (d) => {
      buf += d;
      for (const l of buf.split('\n')) {
        let m; try { m = JSON.parse(l); } catch { continue; }
        if (m.id === 2) { clearTimeout(ur); stopUdvidelse(); p.kill('SIGKILL'); res(m.result); }
      }
    });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'browser_screenshot', arguments: {} } }) + '\n');
  });
}

test('the server puts the conversion to click_xy coordinates next to the image', { timeout: 45000 }, async () => {
  const svar = await skaermbillede({ image: 'data:image/png;base64,' + PNG,
    viewport: { css_width: 2327, css_height: 1105, device_pixel_ratio: 1.65 } });
  assert.ok(svar, 'no answer from the server');
  assert.ok(svar.content.some((c) => c.type === 'image'), 'the image is gone');
  const tekst = svar.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  assert.match(tekst, /2327\s*[x×]\s*1105/, `CSS viewport not stated: ${tekst}`);
  assert.match(tekst, /1\.65/, `devicePixelRatio not stated: ${tekst}`);
  assert.match(tekst, /browser_click_xy/, `the agent is not told what the numbers are for: ${tekst}`);
});

test('without viewport data the server answers with the image alone, as before', { timeout: 45000 }, async () => {
  const svar = await skaermbillede({ image: 'data:image/png;base64,' + PNG });
  assert.ok(svar, 'no answer from the server');
  assert.deepEqual(svar.content.map((c) => c.type), ['image']);
});

// ── R50: rigtig PNG, klassisk rullebjaelke, tidsbudget og formlen i teksterne ──────────

// Et PNG-hoved med en given bredde og hoejde - pngSize laeser kun de foerste 33 bytes.
function pngHoved(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b, 0);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return 'data:image/png;base64,' + b.toString('base64');
}

test('with a classic scrollbar the ratio still comes out right (R50, Opus: 2.033 instead of 2)', async () => {
  const u = indlaesUdvidelse();
  // Chrome 154, measured: 2000 px image (incl. a 16 CSS px scrollbar), visualViewport 1968, cssVisualViewport 984.
  u.ctx.cdpSend = async () => ({ visualViewport: { clientWidth: 1968, clientHeight: 1200 }, cssVisualViewport: { clientWidth: 984, clientHeight: 600 } });
  const vp = await u.hent('screenshotViewport')(1, pngHoved(2000, 1200));
  assert.equal(vp.device_pixel_ratio, 2, 'the ratio included the scrollbar');
  assert.equal(vp.css_width, 1000, 'the CSS width of the IMAGE is image width / ratio, scrollbar included');
  assert.equal(vp.css_height, 600);
  assert.equal(vp.image_width, 2000, 'the PNG header was not read');
  assert.equal(vp.image_height, 1200);
});

test('the layout measurement only gets what is left of the screenshot budget (R50, Astra)', async () => {
  const u = indlaesUdvidelse();
  let kald = 0;
  u.ctx.cdpSend = () => { kald++; return new Promise(() => {}); };
  assert.equal(await u.hent('screenshotViewport')(1, pngHoved(10, 10), 0), undefined);
  assert.equal(kald, 0, 'with no time left the measurement must not start');
  const t0 = Date.now();
  assert.equal(await u.hent('screenshotViewport')(1, pngHoved(10, 10), 40), undefined);
  assert.ok(Date.now() - t0 < 400, `the measurement waited ${Date.now() - t0} ms past its budget`);
  const kilde = (await import('node:fs')).readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.match(kilde, /screenshotViewport\(tab\.id, shot\?\.image, budgetSlut - Date\.now\(\)\)/, 'the screenshot passes its remaining budget');
});

test('click_xy and the screenshot note give the same conversion, by the width the image is shown at', async () => {
  const { TOOLS } = await import('../mcp-server/tools.js');
  const d = TOOLS.find((t) => t.name === 'browser_click_xy').description;
  assert.doesNotMatch(d, /x_in_image \/ image_width/, 'tools.js used the image width; a client that scales the image down misses by the scale factor');
  assert.match(d, /x_css = x \/ W \* css_width and y_css = y \/ W \* css_width, where \(x, y\) is the point in the image and W is the width the image is shown to you at/);
  const index = (await import('node:fs')).readFileSync(new URL('../mcp-server/index.js', import.meta.url), 'utf8');
  assert.match(index, /for a point at \(x, y\) in an image shown W pixels wide, ` \+\s*`click \(x \/ W × \$\{vp\.css_width\}, y \/ W × \$\{vp\.css_width\}\)/);
  const s = TOOLS.find((t) => t.name === 'browser_screenshot').description;
  assert.match(s, /when Chrome reports them in time/, 'the screenshot description promised the viewport line unconditionally');
});
