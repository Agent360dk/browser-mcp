/**
 * Svartids-vagten (scripts/svartid.py) koerer sin egen selvtest foer et tal maa bruges. Den proeve koeres her, saa en
 * aendring i vagten kan blive roed i suiten. 1.30.2 skive 14: en bot-PR (Dependabot) maa ikke goere vagten roed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROD } from './hjaelp/udvidelses-sele.mjs';

test('svartids-vagtens selvtest er groen, ogsaa for en 9 dage gammel bot-PR', () => {
  const ud = execFileSync('python3', ['-c', 'import sys, json; sys.path.insert(0, "scripts"); import svartid; print(json.dumps(svartid.selvtest()))'],
    { cwd: ROD, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(ud), [], `selvtesten fejlede: ${ud}`);
});

test('en bot genkendes paa is_bot, «[bot]» og «app/», men ikke et almindeligt login', () => {
  const kode = 'import sys, json; sys.path.insert(0, "scripts"); import svartid; print(json.dumps([svartid.er_bot(f) for f in ' +
    '[{"login": "app/dependabot"}, {"login": "dependabot[bot]"}, {"login": "x", "is_bot": True}, {"login": "John-H"}, None]]))';
  assert.deepEqual(JSON.parse(execFileSync('python3', ['-c', kode], { cwd: ROD, encoding: 'utf8' })), [true, true, true, false, false]);
});
