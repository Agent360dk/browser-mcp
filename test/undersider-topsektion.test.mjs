// Topsektionen paa de genererede undersider (6/10-2026, 3c). Figuren bygges af sidens eget indhold
// (scripts/generate-docs.py: subhero). Proeverne her holder den bundet til siden og til koden, saa den
// aldrig kan vise en kommando, et vaerktoejstal, en boks eller en fanegruppe, der ikke findes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rod = join(dirname(fileURLToPath(import.meta.url)), '..');
const sider = [];
for (const top of ['docs/docs', 'docs/compare', 'docs/use-cases', 'docs/learn', 'docs/migrate']) {
  for (const d of readdirSync(join(rod, top))) {
    const f = join(rod, top, d, 'index.html');
    try { statSync(f); sider.push([`${top}/${d}`, readFileSync(f, 'utf8')]); } catch {}
  }
}
const tekst = (s) => s.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const bg = readFileSync(join(rod, 'extension/background.js'), 'utf8');

test('alle genererede undersider aabner med en topsektion og en figur', () => {
  // 8/10-2026: 42 (to nye use case-sider). Tallet skal foelge PAGES i generate-docs.py.
  assert.equal(sider.length, 42);
  const uden = sider.filter(([, h]) => !/<header class="subhero">[\s\S]*?<figure class="viz">/.test(h)).map(([s]) => s);
  assert.deepEqual(uden, []);
});

test('installationsfigurens kommando staar ordret i en af sidens egne kodeblokke', () => {
  for (const [s, h] of sider.filter(([s]) => s.includes('/install-'))) {
    const term = tekst(h.match(/<pre class="term"[^>]*>([\s\S]*?)<\/pre>/)[1]).replace(/\n…$/, '');
    const blokke = [...h.matchAll(/<div class="code"><pre[^>]*>([\s\S]*?)<\/pre>/g)].map((m) => tekst(m[1]));
    assert.ok(blokke.some((b) => b.startsWith(term)), `${s}: figurens kommando findes ikke paa siden`);
  }
});

test('vaerktoejsfigurens tal = antallet af vaerktoejer i tools.js', () => {
  const n = new Set(readFileSync(join(rod, 'mcp-server/tools.js'), 'utf8').match(/name:\s*['"]browser_[a-z0-9_]+['"]/g)).size;
  const [, h] = sider.find(([s]) => s === 'docs/docs/tools');
  assert.equal(Number(h.match(/<div class="big"><b>(\d+)<\/b>/)[1]), n);
  const sum = [...h.matchAll(/<span><em>(\d+)<\/em>/g)].reduce((a, m) => a + Number(m[1]), 0);
  assert.equal(sum, n, 'grupperne summer ikke til vaerktoejstallet');
});

test('spoergeboksen bruger udvidelsens egen titel og et sessionsnavn som i koden', () => {
  const titel = bg.match(/textContent = title \|\| '([^']+)'/)[1];
  const med = sider.filter(([, h]) => h.includes('class="askcard"'));
  assert.ok(med.length >= 1, 'ingen side har spoergeboksen - proeven ville bestaa tomt (R25)');
  for (const [s, h] of med) {
    assert.equal(h.match(/<div class="askcard"><div class="ti">([^<]+)</)[1], titel, s);
    assert.match(h.match(/<div class="bd">([^<]+)</)[1], /^Claude \d+$/, s);
  }
});

test('fanegruppernes farver foelger sessionsnummeret som i udvidelsen', () => {
  const farver = JSON.parse(bg.match(/const SESSION_COLORS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  assert.ok(sider.some(([, h]) => /--c:var\(--g-\w+\)[^>]*>Claude \d+</.test(h)), 'ingen side har gruppechips - proeven ville bestaa tomt (R25)');
  for (const [s, h] of sider) {
    for (const m of h.matchAll(/--c:var\(--g-(\w+)\)[^>]*>Claude (\d+)</g)) {
      assert.equal(m[1], farver[(Number(m[2]) - 1) % farver.length], `${s}: Claude ${m[2]} er ${m[1]}`);
    }
  }
});

test('indholdslistens links peger paa overskrifter der findes paa siden', () => {
  for (const [s, h] of sider) {
    for (const m of h.matchAll(/<(?:ol class="toc"|div class="sym")>([\s\S]*?)<\/(?:ol|div)>/g)) {
      for (const a of m[1].matchAll(/href="#([^"]+)"/g)) assert.ok(h.includes(`id="${a[1]}"`), `${s}: #${a[1]}`);
    }
  }
});

test('installationsfiguren viser aldrig `npx … install` som klientens kommando (R25: den tilmelder ikke ZCode)', () => {
  for (const [s, h] of sider.filter(([s]) => s.includes('/install-'))) {
    assert.doesNotMatch(tekst(h.match(/<pre class="term"[^>]*>([\s\S]*?)<\/pre>/)[1]), /@agent360\/browser-mcp(?:@latest)?\s+install\b/, s);
  }
});

test('et samtale-eksempel flyttet op i figuren mister ingen ture (R25: det blev afkortet til fire og slettet nedenfor)', () => {
  // Kør generatorens egen _samtale paa et eksempel med seks ture.
  const py = [
    'import re, html',
    "src = open('scripts/generate-docs.py', encoding='utf-8').read()",
    "ns = {'re': re, 'html': html}",
    "exec(src[src.index('_TALER='):src.index('def _gruppeliste')], ns)",
    "print(len(ns['_samtale']('You: a\\nClaude: b\\nYou: c\\nClaude: d\\nYou: e\\nClaude: f')))",
  ].join('\n');
  assert.equal(Number(execFileSync('python3', ['-c', py], { cwd: rod, encoding: 'utf8' }).trim()), 6);
});
