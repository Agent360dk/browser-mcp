// #100: en baggrundsfanes script-klik kan vente paa confirm(), mens koordinatoren allerede ser boksen.
// Hver proeve har en ny dialog som positiv kontrol; ingen/gammel boks maa ikke afkorte ventetiden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { indlaesUdvidelse, medVagt } from './hjaelp/udvidelses-sele.mjs';

const vent = (ms) => new Promise((r) => setTimeout(r, ms));
const udskudt = () => {
  let ok, fejl;
  const loefte = new Promise((r, f) => { ok = r; fejl = f; });
  return { loefte, ok, fejl };
};
async function inden(loefte, ms = 2000) {
  let ur;
  try {
    return await Promise.race([loefte, new Promise((_, f) => {
      ur = setTimeout(() => f(new Error(`Intet klik-svar inden ${ms} ms`)), ms);
    })]);
  } finally { clearTimeout(ur); }
}

function sele(kilde, rigtigFrist = false) {
  const fane = { id: 1, url: 'https://x.example', windowId: 1, active: false };
  let script;
  const u = indlaesUdvidelse({ kilde, svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane, 'tabs.query': [fane],
    'debugger.sendCommand': medVagt((_, metode) => {
      if (metode === 'Input.dispatchMouseEvent') {
        if (rigtigFrist) return new Promise(() => {}); // den rigtige 1500 ms-CDP-frist
        throw u.hent('cdpFristFejl')('CDP did not respond within 1500 ms: Input.dispatchMouseEvent');
      }
      return { result: { value: null } };
    }),
    'scripting.executeScript': (o) => {
      if (o.func.name === 'klikMaal') return [{ result: { tag: 'BUTTON', x: 10, y: 10 } }];
      script.start.ok();
      return script.svar.loefte;
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.resolveElement = async () => ({ x: 10, y: 10, tag: 'BUTTON', text: 'Ask confirm' });
  return {
    u,
    aabn(message = 'Testbench confirm?') {
      u.hent('dialogKoordinator')({ tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'confirm', message });
      return u.hent('dialogFaner').get(1).boks;
    },
    klik() {
      script = { start: udskudt(), svar: udskudt() };
      const nu = script;
      return { ...nu, kald: u.hent('dispatch')(9876, 'click', { selector: '#cfBtn' }),
        slut: (result = { ok: true, tag: 'BUTTON', landed: true }) => nu.svar.ok([{ result }]) };
    },
  };
}

function dialogSvar(r, message = 'Testbench confirm?') {
  assert.equal(r.ok, false);
  assert.equal(r.method, 'scripting-fallback');
  assert.equal(r.fallbackFired, true, 'script-reserven er sendt');
  assert.equal(r.landed, null);
  assert.equal(r.maybe_landed, true);
  assert.equal(r.dialog_open?.type, 'confirm');
  assert.equal(r.dialog_open?.message, message);
  assert.match(r.note, /browser_handle_dialog/);
}
function etKlik(s, antal = 1) {
  const { u } = s;
  const mus = u.optager.til('debugger.sendCommand').filter((k) => k.args[1] === 'Input.dispatchMouseEvent');
  assert.equal(mus.length, antal);
  assert.ok(mus.every((k) => k.args[2].type === 'mouseMoved'), 'ingen CDP-tryk foer reserven');
  assert.equal(u.optager.til('scripting.executeScript').filter((k) => k.args[0].func.name !== 'klikMaal').length, antal);
  assert.equal(u.optager.antal('tabs.update'), 0, 'fanen maa blive i baggrunden');
}
async function nyDialog(s) {
  const k = s.klik();
  try {
    await inden(k.start.loefte);
    s.aabn();
    dialogSvar(await inden(k.kald));
  } finally { k.slut(); await k.kald.catch(() => {}); }
}

for (const kilde of ['extension/background.js', 'mcp-server/extension/background.js']) {
  test(`${kilde}: CDP udloeber, script haenger, ny confirm giver svar inden 2 s; sent svar klikker ikke igen`, async () => {
    const s = sele(kilde, true);
    const t0 = performance.now();
    const k = s.klik();
    try {
      const svar = inden(k.kald); // loftet omfatter ogsaa den rigtige CDP-frist
      await inden(k.start.loefte);
      s.aabn();
      dialogSvar(await svar);
      assert.ok(performance.now() - t0 <= 2000);
      k.slut();
      await vent(60);
      etKlik(s);
    } finally { k.slut(); await k.kald.catch(() => {}); }
  });

  test(`${kilde}: ingen boks bevarer ventetid, succes og uvist udfald; en ny boks afbryder`, async () => {
    const s = sele(kilde);
    for (const landed of [true, false]) {
      const k = s.klik();
      try {
        await inden(k.start.loefte);
        assert.equal(await Promise.race([k.kald.then(() => 'svar'), vent(90).then(() => 'venter')]), 'venter');
        k.slut({ ok: true, tag: 'BUTTON', landed });
        const r = await inden(k.kald);
        assert.equal(r.ok, landed);
        assert.equal(r.landed, landed);
        assert.equal(r.dialog_open, undefined);
        assert.equal(r.maybe_landed, landed ? undefined : true);
      } finally { k.slut(); await k.kald.catch(() => {}); }
    }
    await nyDialog(s);
    etKlik(s, 3);
  });

  test(`${kilde}: boks fra FOER klikket er ikke ny; den naeste boks er`, async () => {
    const s = sele(kilde);
    const gammel = s.aabn('Old dialog');
    const k = s.klik();
    try {
      await inden(k.start.loefte);
      assert.equal(await Promise.race([k.kald.then(() => 'svar'), vent(90).then(() => 'venter')]), 'venter');
      assert.equal(gammel.lukket, null);
      s.aabn('New dialog');
      dialogSvar(await inden(k.kald), 'New dialog');
      etKlik(s);
    } finally { k.slut(); await k.kald.catch(() => {}); }
  });

  test(`${kilde}: scriptingClick afvises efter dialogsvar uden ubehandlet afvisning eller nyt klik`, async () => {
    const s = sele(kilde);
    const oprindelig = s.u.hent('scriptingClick');
    s.u.ctx.scriptingClick = async (...args) => {
      await oprindelig(...args);
      throw new Error('sen script-fejl');
    };
    const k = s.klik();
    try {
      await inden(k.start.loefte);
      s.aabn();
      dialogSvar(await inden(k.kald));
      k.slut();
      await vent(60); // node:test fejler selv paa en unhandledRejection
      etKlik(s);
    } finally { k.slut(); await k.kald.catch(() => {}); }
  });

  for (const tilstand of ['lukket', 'udskiftet', 'svar-ubekraeftet', 'debugger-detached']) {
    test(`${kilde}: ${tilstand} mellem opdagelse og svar vurderes paa ny`, async () => {
      const s = sele(kilde);
      const opdag = s.u.hent('nyUbesvaretBoks');
      s.u.ctx.nyUbesvaretBoks = (...args) => {
        const b = opdag(...args);
        if (b) {
          if (tilstand === 'lukket') b.lukket = { accept: false };
          if (tilstand === 'udskiftet') { b.lukket = { accept: false }; s.aabn('Replacement'); }
          if (tilstand === 'svar-ubekraeftet') b.besvaretAf = 'handle_dialog';
          if (tilstand === 'debugger-detached') { b.mistet = tilstand; s.u.hent('dialogFaner').get(1).boks = null; }
        }
        return b;
      };
      const k = s.klik();
      try {
        await inden(k.start.loefte);
        s.aabn();
        const r = await inden(k.kald);
        assert.equal(r.ok, false);
        assert.equal(r.maybe_landed, true);
        if (tilstand === 'udskiftet') dialogSvar(r, 'Replacement');
        else {
          assert.equal(r.dialog_open, undefined);
          if (tilstand === 'lukket') {
            assert.match(r.note, /It is gone/);
            assert.doesNotMatch(r.note, /browser_handle_dialog/);
          } else {
            assert.match(r.note, /browser_ask_user/);
            assert.doesNotMatch(r.note, /It is gone/);
          }
        }
        etKlik(s);
      } finally { k.slut(); await k.kald.catch(() => {}); }
    });
  }
}
