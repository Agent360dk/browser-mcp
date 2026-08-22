#!/usr/bin/env node
/**
 * Livscyklus-test: mange sessioner side om side i ÉN Chrome.
 *
 * Hvorfor den findes (21/8): flowtesten koerer én session. session-isolation-testen
 * koerer én funktion mod stubbe. releaseSession() — den der lukker en sessions faner
 * naar serveren doer — havde NUL tests. Det samme havde terminate-signalet. Altsaa var
 * hele det omkringliggende — at ti chats kan arbejde samtidig, at de ikke ser hinandens
 * faner, og at der ryddes op efter dem — helt udaekket.
 *
 * Det er ikke en detalje. Praecis den slags fejl kostede en hel dag: to udvidelser der
 * delte sessions-tilstand fik alt til at hedde "Claude 1", og kun én ting kunne koere.
 *
 * MAALEMETODEN: hver fane kalder hjem til fixture-serveren hvert 800 ms. Serveren ved
 * derfor hvilke faner der er I LIVE — ikke hvad extensionen PAASTAAR. Lukkes en fane,
 * stopper hjerteslaget. Det er den eneste maade udefra at se om oprydningen faktisk sker.
 *
 * Kan ikke koere i CI (kraever Chrome + udvidelsen). Koer i haanden:
 *   npm --prefix mcp-server run sessions
 */
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ANTAL = Number(process.env.SESSIONER || 10);
const FANE_LOFT = 20;                       // MAX_TABS_PER_SESSION i background.js
const HJERTESLAG_MS = 800;
const DOED_EFTER_MS = 3000;                 // ingen kald i saa lang tid = fanen er lukket

// ── fixture-server der kan se hvilke faner der lever ────────────────────────
const sidstSet = new Map();                 // fane-maerke → tidspunkt
const web = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const id = u.searchParams.get('id') || '?';
  if (u.pathname === '/hb') {
    sidstSet.set(id, Date.now());
    res.writeHead(204); return res.end();
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  const popup = u.searchParams.get('popup');
  res.end(`<!doctype html><meta charset="utf-8"><title>session ${id}</title>
<h1 id="maerke">${id}</h1>
${popup ? '<button id="aabn-popup">Log ind i nyt vindue</button>' : ''}
<script>
  // Kalder hjem saa laenge fanen lever. Stopper kaldene, er fanen lukket.
  setInterval(function () { fetch('/hb?id=' + ${JSON.stringify(id)}); }, ${HJERTESLAG_MS});
  fetch('/hb?id=' + ${JSON.stringify(id)});
  ${popup ? `document.getElementById('aabn-popup').addEventListener('click', function () {
    window.open('/?id=' + ${JSON.stringify(popup)}, '_blank', 'width=460,height=560');
  });` : ''}
</script>`);
});
await new Promise(r => web.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${web.address().port}`;
const lever = (id) => sidstSet.has(id) && Date.now() - sidstSet.get(id) < DOED_EFTER_MS;
const levende = (ider) => ider.filter(lever);

// ── én MCP-server = én chat ─────────────────────────────────────────────────
function startSession(navn) {
  // Hver server faar sin EGEN foraelder-proces. Uden det deler alle servere den
  // samme ppid (harnessen), og extensionens pid-gate kan saa ikke skelne dem ad.
  // Med `sh -c` uden exec bliver sh staaende som foraelder — praecis som en rigtig
  // klient der spawner sin egen server.
  // Servere spawnes med SAMME foraelder med vilje. Det er den haarde situation:
  // foraelder-pid'en er da ens for dem alle, og indtil 21/8 fik det sessionerne til at
  // adoptere hinandens faner — alle hed "Claude 3", de aeldste mistede deres fane.
  // (Vil man se det modsatte, saa tilfoej "; true" i kommandoen: sh forker da og hver
  // server faar sin egen foraelder. Uden det exec-optimerer sh sig selv vaek.)
  const p = spawn('sh', ['-c', `"${process.execPath}" "${join(rod, 'mcp-server/index.js')}"`], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  const s = { navn, p, port: null, klar: false, venter: new Map(), n: 0, buf: '', log: [] };
  p.stdout.on('data', d => {
    s.buf += d;
    let i;
    while ((i = s.buf.indexOf('\n')) >= 0) {
      const l = s.buf.slice(0, i).trim(); s.buf = s.buf.slice(i + 1);
      if (!l) continue;
      let m; try { m = JSON.parse(l); } catch { continue; }
      if (m.id != null && s.venter.has(m.id)) { s.venter.get(m.id)(m); s.venter.delete(m.id); }
    }
  });
  p.stderr.on('data', d => {
    const t = String(d); s.log.push(t);
    const port = t.match(/listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (port) s.port = Number(port[1]);
    if (t.includes('extension connected')) s.klar = true;
    if (/All ports .* in use/.test(t)) s.udenPort = true;
  });
  return s;
}

const rpc = (s, method, params, ms = 40000) => new Promise((res, rej) => {
  const id = ++s.n;
  s.venter.set(id, res);
  setTimeout(() => { if (s.venter.delete(id)) rej(new Error(`timeout: ${method}`)); }, ms);
  s.p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const kald = async (s, navn, args = {}, ms) => {
  const r = await rpc(s, 'tools/call', { name: navn, arguments: args }, ms);
  const tekst = (r.result?.content || []).map(c => c.text ?? `<${c.type}>`).join('\n');
  if (r.result?.isError) throw new Error(tekst.slice(0, 200));
  let data = null; try { data = JSON.parse(tekst); } catch {}
  return { data, tekst };
};

// ── rapportering ────────────────────────────────────────────────────────────
const fejl = [];
async function proev(navn, fn) {
  try { const note = await fn(); console.log(`  ✓ ${navn.padEnd(46)} ${note || ''}`); }
  catch (e) { fejl.push([navn, e.message]); console.log(`  ✗ ${navn.padEnd(46)}\n      → ${e.message.split('\n')[0].slice(0, 190)}`); }
}
const skal = (b, m) => { if (!b) throw new Error(m); };
const vent = (ms) => new Promise(r => setTimeout(r, ms));

const alle = [];
let kode = 0;
try {
  console.log(`\nStarter ${ANTAL} samtidige sessioner mod én Chrome.\n`);
  for (let i = 0; i < ANTAL; i++) alle.push(startSession(`s${i}`));
  for (const s of alle) {
    await rpc(s, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: s.navn, version: '0' } });
    s.p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  }
  const frist = Date.now() + 60000;
  while (alle.some(s => !s.klar) && Date.now() < frist) await vent(700);
  const uklare = alle.filter(s => !s.klar).map(s => s.navn);
  if (uklare.length) {
    console.log(`✗ disse sessioner fik aldrig forbindelse til udvidelsen: ${uklare.join(', ')}`);
    console.log('  (er Chrome aaben og udvidelsen slaaet til?)');
    process.exit(2);
  }

  console.log('── Sameksistens ──');
  await proev('hver session faar sin egen port', () => {
    const porte = alle.map(s => s.port);
    skal(new Set(porte).size === ANTAL, `${new Set(porte).size} distinkte porte af ${ANTAL}: ${porte.join(', ')}`);
    return porte.join(' ');
  });

  for (const s of alle) {
    const r = await kald(s, 'browser_navigate', { url: `${BASE}/?id=${s.navn}` });
    s.fane = r.data?.tab_id ?? null;
    s.label = r.data?.session ?? null;
  }
  await vent(2500);

  await proev('alle sessioners faner er i live samtidig', () => {
    const d = levende(alle.map(s => s.navn));
    if (d.length !== ANTAL) {
      console.log('\n      --- hvad serverne sagde ---');
      for (const s of alle) {
        const linjer = s.log.join('').split('\n')
          .filter(l => /connected|disconnect|ADVARSEL|terminate|Afviser/.test(l));
        console.log(`      ${s.navn} (${lever(s.navn) ? 'LEVER' : 'DOED'}): ${linjer.map(l => l.replace('[MCP] ', '')).join(' | ') || '(intet)'}`);
      }
      console.log('');
    }
    skal(d.length === ANTAL, `kun ${d.length} af ${ANTAL} faner kalder hjem: ${d.join(', ')}`);
    return `${d.length} faner`;
  });

  await proev('sessionerne faar hver sit navn — ikke alle "Claude 1"', () => {
    const navne = alle.map(s => s.label).filter(Boolean);
    skal(navne.length === ANTAL, `kun ${navne.length} sessioner oplyste et navn`);
    skal(new Set(navne).size === ANTAL,
      `${new Set(navne).size} distinkte navne af ${ANTAL} — det er praecis "alt hedder Claude 1"-fejlen: ${[...new Set(navne)].join(', ')}`);
    return [...new Set(navne)].slice(0, 4).join(' · ') + (ANTAL > 4 ? ' …' : '');
  });

  await proev('hver session ser KUN sine egne faner', async () => {
    for (const s of alle) {
      const t = (await kald(s, 'browser_list_tabs', {})).data?.tabs || [];
      const fremmede = t.map(x => x.id).filter(id => id !== s.fane);
      skal(fremmede.length === 0,
        `${s.navn} ser ${fremmede.length} fane(r) der ikke er dens egne — sessionerne laekker ind i hinanden`);
    }
    return 'ingen laekage';
  });

  await proev('en session kan ikke tage en andens fane', async () => {
    const a = alle[0], b = alle[1];
    let afvist = false;
    try {
      const r = await kald(a, 'browser_switch_tab', { tab_id: b.fane });
      afvist = r.data?.ok === false || /not (in|found)|ikke|denied|owned/i.test(r.tekst);
    } catch { afvist = true; }
    skal(afvist, `${a.navn} fik lov at skifte til ${b.navn}s fane — isolationen holder ikke`);
    return 'afvist som den skal';
  });

  console.log('\n── Oprydning ──');
  const offer = alle[2];
  await proev('en doed session lukker SINE faner — og kun dem', async () => {
    const andre = alle.filter(s => s !== offer).map(s => s.navn);
    skal(lever(offer.navn), 'offerets fane levede ikke inden testen');
    offer.p.kill('SIGTERM');
    await vent(5000);
    skal(!lever(offer.navn), 'fanen kalder stadig hjem — den blev ikke lukket, den blev efterladt');
    const stadig = levende(andre);
    skal(stadig.length === andre.length,
      `${andre.length - stadig.length} andre faner blev ogsaa lukket — oprydningen ramte for bredt`);
    return `${offer.navn} lukket, ${stadig.length} uroerte`;
  });

  // ── terminate: serveren skal lukke sig selv naar sidste fane lukkes ────────
  //
  // Nul dækning indtil nu. Fyrer den ikke, bliver hver afsluttet chat til en
  // zombie-server der holder en port besat — og spaendet er kun 20 bredt.
  console.log('\n── Selvafslutning ──');
  await proev('sidste fane lukkes → serveren afslutter sig selv', async () => {
    // Tag den SIDSTE levende — alle[0] bruges af fane-loft-testen bagefter.
    const s = [...alle].reverse().find(x => !x.p.killed && x !== offer && x !== alle[0]);
    skal(!!s, 'ingen levende session at teste med');
    const faner = (await kald(s, 'browser_list_tabs', {})).data?.tabs || [];
    skal(faner.length >= 1, 'sessionen havde ingen faner');
    for (const f of faner) { try { await kald(s, 'browser_close_tab', { tab_id: f.id }); } catch {} }
    // Serveren faar besked via terminate og skal lukke ned af sig selv.
    for (let i = 0; i < 20 && s.p.exitCode === null && !s.p.killed; i++) await vent(500);
    const sagdeOp = s.log.join('').includes('Terminate signal') || s.p.exitCode !== null;
    skal(sagdeOp, 'serveren koerer videre uden faner — porten forbliver besat af en zombie');
    s.doedAfTerminate = true;
    return `${s.navn} lukkede sig selv`;
  });

  // ── popup: en side der aabner et vindue skal fanges af sessionen ───────────
  //
  // Det er OAuth-stien: Google/Microsoft/GitHub aabner et popup-vindue, og agenten
  // skal kunne naa det. Koden fanger nye faner (lastCreatedTabId) — men det var
  // aldrig afproevet.
  console.log('\n── Popup-opfangning ──');
  await proev('en popup fanges af sessionen der aabnede den', async () => {
    const s = [...alle].reverse().find(x => !x.p.killed && !x.doedAfTerminate && x !== offer && x !== alle[0]);
    skal(!!s, 'ingen levende session at teste med');
    const maerke = `${s.navn}-popup`;
    // Popup'en skal aabnes af et AEGTE klik. Chrome blokerer window.open uden en
    // brugerhandling, og det er browserens ret — ikke en fejl i browser-mcp. Sådan
    // sker det ogsaa i virkeligheden: agenten klikker "Log ind med Google".
    const v = await kald(s, 'browser_navigate', { url: `${BASE}/?id=${s.navn}-pop-vaert&popup=${encodeURIComponent(maerke)}` });
    // MAALT 21/8: et museklik i en BAGGRUNDSFANE lander aldrig som aegte klik —
    // fanen komponerer ikke, saa hit-testet fejler, og der falles tilbage til et
    // syntetisk event. Et syntetisk event baerer ingen brugerhandling, og Chrome
    // blokerer derfor window.open. Popup'en aabner altsaa aldrig.
    // Fanen aktiveres foerst, saa det er OAuth-opfangningen der maales — ikke
    // baggrunds-begraensningen.
    await kald(s, 'browser_switch_tab', { tab_id: v.data.tab_id });
    await vent(700);
    const klik = await kald(s, 'browser_click', { selector: '#aabn-popup' });
    skal(klik.data?.landed === true,
      `det aegte klik landede ikke (landed=${klik.data?.landed}) — uden det er der ingen brugerhandling, og popup'en blokeres`);
    await vent(3000);
    skal(lever(maerke), 'popup-fanen blev aldrig aabnet');
    const ny = await kald(s, 'browser_get_new_tab', {});
    skal(ny.data?.id != null, `get_new_tab fandt ingen ny fane: ${ny.tekst.slice(0, 120)}`);
    const faner = (await kald(s, 'browser_list_tabs', {})).data?.tabs || [];
    skal(faner.some(f => f.id === ny.data.id),
      'popup\'en blev fundet, men hoerer ikke til sessionen — den kan ikke styres bagefter');
    return 'fanget og ejet af sessionen';
  });

  console.log('\n── Fane-loft ──');
  const tung = alle.find(x => !x.p.killed && x.p.exitCode === null && !x.doedAfTerminate) || alle[0];
  await proev(`en session holder hoejst ${FANE_LOFT} faner aabne`, async () => {
    const maerker = [];
    for (let i = 0; i < FANE_LOFT + 5; i++) {
      const m = `${tung.navn}-t${i}`;
      maerker.push(m);
      await kald(tung, 'browser_navigate', { url: `${BASE}/?id=${m}`, new_tab: true });
    }
    await vent(4500);
    const d = levende(maerker);
    skal(d.length <= FANE_LOFT,
      `${d.length} faner i live — loftet paa ${FANE_LOFT} holdes ikke, faner hober sig op`);
    skal(d.length >= FANE_LOFT - 3,
      `kun ${d.length} faner tilbage — der blev lukket for mange, arbejdet under dem forsvinder`);
    const nyeste = maerker.slice(-3);
    skal(nyeste.every(lever), 'en af de nyeste faner blev lukket — evictionen rammer den forkerte ende');
    return `${d.length} i live, de nyeste beholdt`;
  });

  console.log('\n── Portspaend ──');
  await proev('spaendet fyldes helt op, og den overskydende siger paent fra', async () => {
    // Maskinen kan i forvejen have rigtige Claude-sessioner koerende. Testen maa maale
    // hvor mange porte der er LEDIGE, ikke antage at alle 20 er frie — ellers fejler den
    // paa brugerens eget arbejde i stedet for paa produktet.
    const iBrugFoer = Number(execSync(
      "lsof -iTCP:9876-9895 -sTCP:LISTEN -n -P 2>/dev/null | grep -c LISTEN || true").toString().trim()) || 0;
    const mine = alle.filter(s => s.port && !s.p.killed).length;
    const fremmede = Math.max(0, iBrugFoer - mine);
    const ledige = 20 - iBrugFoer;
    const ekstra = [];
    for (let i = 0; i <= ledige; i++) ekstra.push(startSession(`x${i}`));   // én mere end der er plads til
    for (const s of ekstra) {
      try { await rpc(s, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: s.navn, version: '0' } }, 15000); } catch {}
    }
    await vent(4500);
    const fikPort = ekstra.filter(s => s.port).length;
    const uden = ekstra.filter(s => s.udenPort).length;
    for (const s of ekstra) { try { s.p.kill('SIGKILL'); } catch {} }
    skal(fikPort === ledige,
      `${fikPort} af ${ledige} ledige porte blev taget — spaendet udnyttes ikke fuldt`);
    skal(uden >= 1,
      'den overskydende server fik ogsaa en port — spaendet er ikke det man tror');
    return `${mine} mine + ${fremmede} fremmede + ${fikPort} nye = 20 · nr. 21 afvist`;
  });

  console.log('\n' + '='.repeat(72));
  console.log(fejl.length ? `${fejl.length} FEJL` : '✅ hele livscyklussen holder');
  for (const [n, m] of fejl) console.log(`  ${n}: ${m.split('\n')[0].slice(0, 160)}`);
  console.log('='.repeat(72));
  kode = fejl.length ? 1 : 0;
} catch (e) {
  console.log('\n✗ harness kastede:', e.message);
  kode = 3;
} finally {
  // Luk alt ned — og se om oprydningen ogsaa virker i flok.
  const tilbage = alle.filter(s => !s.p.killed).map(s => s.navn);
  for (const s of alle) { try { s.p.kill('SIGTERM'); } catch {} }
  await vent(5000);
  const spoegelser = levende(tilbage);
  console.log(spoegelser.length
    ? `\n⚠️  ${spoegelser.length} fane(r) overlevede nedlukningen af alle sessioner: ${spoegelser.join(', ')}`
    : `\nAlle ${tilbage.length} tilbagevaerende faner blev lukket ved nedlukning.`);
  if (spoegelser.length) kode = kode || 1;
  for (const s of alle) { try { s.p.kill('SIGKILL'); } catch {} }
  web.close();
  setTimeout(() => process.exit(kode), 400);
}
