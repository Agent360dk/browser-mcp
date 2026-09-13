#!/usr/bin/env node
/**
 * Hvad rendte agenterne ind i? - loekken der goer feedback til rettelser.
 *
 * Laeser ~/.browser-mcp/feedback.jsonl (skrevet af browser_provide_feedback, lokalt,
 * aldrig sendt nogen steder) og grupperer efter fingeraftryk, saa de samme graenser
 * ikke laeses som mange forskellige.
 *
 * Koer:  npm --prefix mcp-server run feedback
 *        npm --prefix mcp-server run feedback -- --issues   # udkast til GitHub-issues
 *
 * --issues skriver KUN udkast til skaermen. Der sendes intet. Rapporten kan baere
 * URL'er og fejltekst fra sider agenten stod paa - laes den foer noget deles.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOG = join(homedir(), '.browser-mcp', 'feedback.jsonl');
const udkast = process.argv.includes('--issues');

if (!existsSync(LOG)) {
  console.log(`Ingen logbog endnu (${LOG}).`);
  console.log('Den skrives automatisk naar en agent kalder browser_provide_feedback.');
  process.exit(0);
}

const poster = readFileSync(LOG, 'utf8').split('\n').filter(Boolean)
  .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

if (!poster.length) { console.log('Logbogen er tom.'); process.exit(0); }

const grupper = new Map();
for (const p of poster) {
  const g = grupper.get(p.fingerprint) || { antal: 0, foerste: p.at, seneste: p.at, eksempel: p, domaener: new Set() };
  g.antal++;
  g.seneste = p.at > g.seneste ? p.at : g.seneste;
  g.foerste = p.at < g.foerste ? p.at : g.foerste;
  if (p.url) { try { g.domaener.add(new URL(p.url).host); } catch {} }
  grupper.set(p.fingerprint, g);
}

const sorteret = [...grupper.values()].sort((a, b) => b.antal - a.antal);
const dato = (s) => String(s).slice(0, 10);

// En graense der blev meldt mens installationen var gammel eller i konflikt siger
// mere om installationen end om vaerktoejet. Den skilles ud.
const aegte = sorteret.filter(g => g.eksempel.verdict === 'current' || g.eksempel.verdict === 'unknown');
const install = sorteret.filter(g => !aegte.includes(g));

console.log(`\n${poster.length} haendelser · ${grupper.size} forskellige graenser · ${dato(poster[0].at)} → ${dato(poster.at(-1).at)}\n`);

const skriv = (liste, overskrift) => {
  if (!liste.length) return;
  console.log(`── ${overskrift} ──`);
  for (const g of liste) {
    const e = g.eksempel;
    const d = g.domaener.size ? ` · ${[...g.domaener].slice(0, 3).join(', ')}` : '';
    console.log(`  ${String(g.antal).padStart(3)}×  ${(e.tool || '-').padEnd(26)} ${e.kind}${d}`);
    console.log(`       ${String(e.what_happened).replace(/\s+/g, ' ').slice(0, 110)}`);
  }
  console.log('');
};

skriv(aegte, 'Aegte graenser - installationen var frisk, saa det her er vaerktoejet');
skriv(install, 'Meldt paa en gammel eller konfliktende installation - tjek at de stadig gaelder');

if (udkast) {
  console.log('── Issue-udkast (intet er sendt) ──\n');
  for (const g of aegte.slice(0, 10)) {
    const e = g.eksempel;
    console.log(`### ${e.tool || 'browser-mcp'}: ${String(e.what_happened).replace(/\s+/g, ' ').slice(0, 80)}`);
    console.log(`Ramt ${g.antal} gang(e), ${dato(g.foerste)} → ${dato(g.seneste)}.`);
    if (e.attempted) console.log(`Allerede proevet: ${e.attempted}`);
    console.log(`Server ${e.server_version} · udvidelse ${e.extension_version || 'ukendt'}\n`);
  }
  console.log('Laes dem igennem foer noget deles - de kan baere URL\'er fra sider agenten stod paa.');
} else if (aegte.length) {
  console.log('Udkast til issues:  npm --prefix mcp-server run feedback -- --issues');
}
