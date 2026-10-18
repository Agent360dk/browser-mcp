/**
 * Manifestet (1.31.0): kun de tilladelser udvidelsen bruger, og en kort beskrivelse der kun lover det sande.
 * activeTab blev aldrig brugt (R129: 0 traef i koden; sessionens faner naas med tabs, <all_urls> og debugger), og Googles
 * Privacy-fane siger: «If there are permissions listed here that you don't require, remove them from your manifest».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROD } from './hjaelp/udvidelses-sele.mjs';

test('manifestet beder ikke om activeTab, og den korte beskrivelse lover kun det sande (begge kopier byte-ens)', () => {
  const a = readFileSync(join(ROD, 'extension/manifest.json'));
  const b = readFileSync(join(ROD, 'mcp-server/extension/manifest.json'));
  assert.ok(a.equals(b), 'de to manifester er ikke byte-ens');
  const m = JSON.parse(a.toString());
  assert.ok(!m.permissions.includes('activeTab'), 'activeTab bruges ikke og skal fjernes (Googles krav om de snaevreste tilladelser)');
  assert.ok(m.permissions.includes('debugger'));
  assert.ok(m.description.length <= 132, `beskrivelsen er ${m.description.length} tegn (loft 132)`);
  assert.doesNotMatch(m.description, /asks you/, 'det er agenten der kan spoerge - ikke et loefte');
  assert.match(m.description, /can ask you/);
  assert.doesNotMatch(m.description, /any client/, 'kun MCP-klienter der kan koere en lokal server');
  assert.match(m.description, /MCP client/);
});
