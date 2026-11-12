// #100: en baggrundsfanes script-klik kan vente paa confirm(), mens koordinatoren allerede ser boksen.
// Hver proeve har en ny dialog som positiv kontrol; ingen/gammel boks maa ikke afkorte ventetiden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
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

function sele(kilde, rigtigFrist = false, holdOpslag = false) {
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
      if (o.func.name === 'klikMaal') {
        script.opslagStart.ok();
        return holdOpslag ? script.opslagSvar.loefte : [{ result: { tag: 'BUTTON', x: 10, y: 10 } }];
      }
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
    klik(modtaget) {
      script = { start: udskudt(), svar: udskudt(), opslagStart: udskudt(), opslagSvar: udskudt() };
      const nu = script;
      return { ...nu, kald: u.hent('dispatch')(9876, 'click', { selector: '#cfBtn' }, modtaget),
        opslaa: () => nu.opslagSvar.ok([{ result: { tag: 'BUTTON', x: 10, y: 10 } }]),
        slut: (result = { ok: true, tag: 'BUTTON', landed: true }) => nu.svar.ok([{ result }]) };
    },
  };
}

// R8: maal alle worker-timere i reserveforloebet, inklusive resttimere ved hurtige udfald.
// CDP-fejlen gives direkte, saa tidligere CDP-polling ikke taelles som reservens oprydning.
function reserveSele(kilde, holdOpslag = false) {
  const s = sele(kilde, false, holdOpslag);
  s.u.ctx.debuggerClick = async () => { throw s.u.hent('cdpFristFejl')('CDP did not respond within 1500 ms: Input.dispatchMouseEvent'); };
  const aktive = new Set();
  let oprettet = 0;
  const reaktioner = new WeakMap();
  let flestReaktioner = 0;
  s.u.ctx.maalReaktion = (p) => {
    const antal = (reaktioner.get(p) || 0) + 1;
    reaktioner.set(p, antal);
    flestReaktioner = Math.max(flestReaktioner, antal);
  };
  vm.runInContext(`{
    const then = Promise.prototype.then;
    Promise.prototype.then = function (...args) { maalReaktion(this); return then.apply(this, args); };
  }`, s.u.ctx);
  s.u.ctx.setTimeout = (fn, ms, ...args) => {
    oprettet++;
    const ur = setTimeout(() => { aktive.delete(ur); fn(...args); }, ms);
    aktive.add(ur);
    return ur;
  };
  s.u.ctx.clearTimeout = (ur) => { aktive.delete(ur); clearTimeout(ur); };
  const lyttereFoer = [...s.u.lyttere].map(([sti, fns]) => [sti, fns.length]);
  return Object.assign(s, {
    antalKlik: () => s.u.optager.til('scripting.executeScript').filter((k) => k.args[0].func.name !== 'klikMaal').length,
    flestReaktioner: () => flestReaktioner,
    async ryddet() {
      assert.equal(aktive.size, 0, 'timer-taelling skal vaere 0 straks ved kaldets afslutning');
      assert.deepEqual([...s.u.lyttere].map(([sti, fns]) => [sti, fns.length]), lyttereFoer, 'ingen ekstra lyttere efter svar');
      const foer = oprettet;
      await vent(95);
      assert.equal(oprettet, foer, 'ingen nye timere efter afslutning');
      assert.equal(aktive.size, 0, 'timer-taelling skal stadig vaere 0');
    },
    rydProeve() { for (const ur of aktive) clearTimeout(ur); aktive.clear(); },
  });
}

async function reserveProeve(kilde, options, proeve) {
  const s = reserveSele(kilde, options.holdOpslag);
  const k = s.klik(options.modtaget);
  // Ogsaa en tidlig afvisning er observeret, mens proeven venter paa scriptstart.
  k.kald.catch(() => {});
  try { await proeve(s, k); }
  finally { k.opslaa(); k.slut(); await inden(k.kald).catch(() => {}); s.rydProeve(); }
}

for (const kilde of ['extension/background.js', 'mcp-server/extension/background.js']) {
  for (const felt of ['armering', 'besvaretAf']) {
    test(`${kilde}: R8 ${felt} FOER opdagelse ignoreres; timer-taelling 0 ved succes`, async () => {
      await reserveProeve(kilde, {}, async (s, k) => {
        await inden(k.start.loefte);
        const b = s.aabn();
        b[felt] = felt === 'armering' ? {} : 'handle_dialog';
        assert.equal(await Promise.race([k.kald.then(() => 'svar'), vent(95).then(() => 'venter')]), 'venter');
        k.slut();
        const r = await inden(k.kald);
        assert.equal(r.ok, true);
        assert.equal(r.dialog_open, undefined);
        assert.equal(s.antalKlik(), 1);
        await s.ryddet();
      });
    });
  }

  test(`${kilde}: R8 dialog under elementopslag stopper klikket og siger ikke sendt`, async () => {
    await reserveProeve(kilde, { holdOpslag: true }, async (s, k) => {
      await inden(k.opslagStart.loefte);
      s.aabn('Independent dialog');
      const r = await inden(k.kald, 500);
      assert.equal(r.fallbackFired, false);
      assert.equal(r.landed, false);
      assert.equal(r.maybe_landed, false);
      assert.equal(r.dialog_open?.message, 'Independent dialog');
      assert.match(r.note, /click was not sent/i);
      assert.doesNotMatch(r.note, /opened from the click/i);
      assert.equal(s.antalKlik(), 0);
      await s.ryddet();
      s.u.hent('dialogKoordinator')({ tabId: 1 }, 'Page.javascriptDialogClosed', { result: false });
      k.opslaa();
      await vent(60);
      assert.equal(s.antalKlik(), 0, 'intet klik efter kaldets svar, heller ikke efter dialoglukning');
      await s.ryddet();
    });
  });

  test(`${kilde}: R8 dialog og opslagsresultat i samme tur sender intet klik`, async () => {
    await reserveProeve(kilde, { holdOpslag: true }, async (s, k) => {
      await inden(k.opslagStart.loefte);
      s.aabn();
      k.opslaa(); // microtasken kommer foer naeste 40 ms-poll
      const r = await inden(k.kald, 500);
      assert.equal(s.antalKlik(), 0);
      assert.equal(r.fallbackFired, false);
      assert.match(r.note, /click was not sent/i);
      await s.ryddet();
    });
  });

  for (const udfald of ['succes', 'afvisning', 'dialog']) {
    test(`${kilde}: R8 ${udfald} rydder alle timere straks og gentager intet`, async () => {
      await reserveProeve(kilde, {}, async (s, k) => {
        await inden(k.start.loefte);
        if (udfald === 'dialog') {
          await vent(180);
          assert.ok(s.flestReaktioner() <= 2, 'ventetiden maa ikke samle reaktioner paa samme loefte');
        }
        if (udfald === 'succes') k.slut();
        if (udfald === 'afvisning') k.svar.fejl(new Error('script rejected'));
        if (udfald === 'dialog') s.aabn();
        if (udfald === 'afvisning') await assert.rejects(inden(k.kald), /CDP did not respond/);
        else {
          const r = await inden(k.kald);
          if (udfald === 'dialog') dialogSvar(r);
          else assert.equal(r.ok, true);
        }
        await s.ryddet();
        if (udfald === 'dialog') k.svar.fejl(new Error('late rejection'));
        await vent(60);
        assert.equal(s.antalKlik(), 1);
        await s.ryddet();
      });
    });
  }

  for (const holdOpslag of [false, true]) {
    for (const udfald of ['tab-closed', 'tab-closing', 'debugger-detached', 'timeout']) {
      test(`${kilde}: R8 ${udfald} ${holdOpslag ? 'foer' : 'efter'} afsendelse stopper polling og rydder timere`, async () => {
        // Fristen traekker tidligere arbejde fra: her er kun 70 ms af de 25 s tilbage.
        await reserveProeve(kilde, { holdOpslag, modtaget: udfald === 'timeout' ? Date.now() - 24930 : undefined }, async (s, k) => {
          await inden(holdOpslag ? k.opslagStart.loefte : k.start.loefte);
          // En anden fanes haendelser maa ikke afslutte dette kald.
          await s.u.fyr('tabs.onRemoved', 2);
          await s.u.fyr('debugger.onDetach', { tabId: 2 }, 'canceled_by_user');
          if (udfald === 'tab-closed') await s.u.fyr('tabs.onRemoved', 1);
          if (udfald === 'tab-closing') vm.runInContext('fanerUnderLukning.add(1)', s.u.ctx);
          if (udfald === 'debugger-detached') await s.u.fyr('debugger.onDetach', { tabId: 1 }, 'canceled_by_user');
          const r = await inden(k.kald, 500);
          assert.equal(r.ok, false);
          assert.equal(r.error, udfald);
          assert.equal(r.fallbackFired, !holdOpslag);
          assert.equal(r.maybe_landed, !holdOpslag);
          assert.equal(r.landed, holdOpslag ? false : null);
          assert.match(r.note, holdOpslag ? /click was not sent/i : /may have landed/i);
          await s.ryddet();
          k.opslaa(); k.slut();
          await vent(60);
          assert.equal(s.antalKlik(), holdOpslag ? 0 : 1, 'ingen afsendelse efter svaret');
          await s.ryddet();
        });
      });
    }
  }
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
