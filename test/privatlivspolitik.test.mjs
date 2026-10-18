/**
 * Privatlivspolitikken (docs/privacy.html) skal sige det samme som koden - R129 (Astra + Opus) og R129b.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROD } from './hjaelp/udvidelses-sele.mjs';

// ── Privatlivspolitikken (docs/privacy.html) skal sige det samme som koden ────

test('privatlivspolitikken: historik, tilladelser, agentens JavaScript, dialogen og Limited Use', () => {
  const html = readFileSync(join(ROD, 'docs/privacy.html'), 'utf8');
  const tekst = html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  // R129 (Astra + Opus): list_tabs sender sessionens fanes adresser og titler til AI-klienten (background.js, case 'list_tabs').
  assert.doesNotMatch(tekst, /No browsing history is collected or sent anywhere/);
  assert.match(tekst, /does not read Chrome's history/);
  assert.match(tekst, /browser_list_tabs[^.]*addresses and titles/);
  // activeTab er fjernet fra manifestet og maa ikke staa i listen.
  assert.doesNotMatch(tekst, /activeTab/);
  // Agentens JavaScript: kun gennem Debugger API, i sessionens faner.
  assert.match(tekst, /browser_execute_script[^.]*browser_select_frame[^.]*Debugger API/);
  assert.match(tekst, /JavaScript your agent sends/);
  // Dialogen: sidens egne lyttere kan se tastetryk.
  assert.match(tekst, /browser_ask_user/);
  assert.match(tekst, /keystrokes/);
  // Googles Limited Use-erklaering, ordret.
  assert.ok(tekst.includes("Browser MCP's use and transfer of user data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements."),
    'Limited Use-erklaeringen mangler eller er omformuleret');
  assert.match(tekst, /Last updated: October 19, 2026/);
  // Ingen tilladelse paa listen, som manifestet ikke har - og ingen fra manifestet mangler.
  const m = JSON.parse(readFileSync(join(ROD, 'extension/manifest.json'), 'utf8'));
  const afsnit = html.slice(html.indexOf('<h2>Permissions</h2>'), html.indexOf('<h2>Open Source</h2>'));
  const naevnt = new Set([...afsnit.matchAll(/<strong>([^<]+)<\/strong>/g)].flatMap((x) => x[1].split(/,\s*/)).map((s) => s.replace(/&lt;|&gt;/g, (e) => (e === '&lt;' ? '<' : '>')).replace(/ \(host permission\)/, '').trim()));
  for (const p of [...m.permissions, ...m.host_permissions]) assert.ok(naevnt.has(p), `politikken naevner ikke ${p}`);
  for (const p of naevnt) assert.ok([...m.permissions, ...m.host_permissions].includes(p), `politikken naevner ${p}, som manifestet ikke har`);
});
