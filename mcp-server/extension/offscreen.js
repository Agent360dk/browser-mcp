/**
 * Offscreen Document — Persistent WebSocket bridge (multi-session)
 *
 * Scans port range 9876-9895 and maintains connections to ALL active
 * MCP servers. Each Claude Code session gets its own port automatically.
 * Passes port ID with every command so background.js can track tab ownership.
 *
 * Flow: MCP Server(s) ←(WS)→ this ←(chrome.runtime.sendMessage)→ Service Worker → Chrome APIs
 */

// Et offscreen-dokument har IKKE chrome.runtime.getManifest() — kaldet kaster
// "chrome.runtime.getManifest is not a function". Versionen kommer derfor med i
// dokumentets egen URL, sat af background.js da dokumentet blev oprettet. Det er
// samtidig den rigtige semantik: et dokument oprettet af en aeldre udgave baerer
// den aeldre version, saa `offscreenSvarer()` kan se forskel paa "svarer" og
// "er den udgave vi koerer nu".
// Plan 1.10 / R2 (Astra): versionsnummeret beviser ikke hvilken KODE der koerer - to kopier med samme nummer kan vaere
// forskellige, og udgivelsens flowtest kunne derfor godkendes mod gammel kode. Udvidelsen sender derfor et fingeraftryk af
// sin egen background.js. Kun et hash, og kun til 127.0.0.1: ingen kode forlader maskinen.
// MAALT 12/9: aftrykket daekkede kun background.js. Samme dag aendrede offscreen.js sig, og den aendring var USYNLIG for
// udgivelsens spaerre - en gammel kopi af broen kunne passere som kandidaten. Begge kodefiler taeller nu med, i fast
// raekkefoelge. Det er stadig en byggekontrol: filerne laeses fra den indlaeste udvidelses egen mappe, saa aftrykket
// beviser hvilke FILER der er indlaest - ikke hvilken kode der koerer i et gammelt offscreen-dokument.
const KODEFILER = ['background.js', 'offscreen.js'];

// ── Parringsnoegle (issue #10) ────────────────────────────────────────────────
// Uden noegle: nul konfiguration, praecis som i dag. Med noegle: udvidelsen taler KUN
// med en server der kender den samme, og serveren svarer kun den udvidelse der kan den.
//
// Det loeser to ting paa én gang. Det oenskede - at parre én Chrome-profil med én server,
// saa Arbejde og Privat ikke tager hinandens kommandoer - og et hul vi selv har skrevet
// ned: broen er lokal og uautentificeret, saa ethvert program paa maskinen kan forbinde
// til den. En delt hemmelighed lukker begge, og den koster intet for dem der ikke vil have den.
//
// Noeglen laeses ved opstart og caches, fordi haandtrykket bygges synkront naar soklen
// aabner - samme grund som aftrykket eftersendes i stedet for at blokere hilsenen.
let parringsnoegle = null;
const parrede = new WeakSet();
// ⛔ MAALT 21/9: her stod `chrome.storage.local.get(...)`, og det kan ALDRIG virke.
// Et offscreen-dokument har kun `chrome.runtime` - Chromes egen dokumentation siger det
// ordret, og opslaget kaster en TypeError som try'et ovenfor slugte. Noeglen forblev null,
// haandtrykket sendte en tom noegle, og serveren afviste. Enhver der satte den samme noegle
// begge steder, som popup'en beder om, var laast ude for altid. Fejlen laa i den udgivne
// 1.30.0.
//
// Og filen VIDSTE det: kommentaren laengere nede siger selv at portomraadet sendes via
// dokumentets adresse fordi background.js har lageret, og at getManifest ikke findes her.
// Opslaget blev skrevet tolv linjer under den viden.
//
// Baggrunden har lageret. Den svarer paa en besked, og skubber aendringer hertil. Det er
// Chromium-udviklernes egen anviste loesning.
// ⛔ TRE tilstande, ikke to. Foerste udgave havde kun `parringsnoegle = null`, og gaten
// nedenfor lyder `if (parringsnoegle && ...)`. Kunne noeglen ikke hentes - servicearbejderen
// sov, lageret fejlede - blev den staaende null, gaten sprang HELT over, og udvidelsen
// udfoerte kommandoer fra enhver server. Altsaa fail-open i selve adgangskontrollen.
// Fundet af et modstander-review 21/9, som koerte den aegte fil i en vm hvor begge
// hentninger fejlede: en uparret server fik `browser_get_cookies` besvaret.
//
//   'ukendt' = vi VED det ikke endnu  -> udfoer intet
//   'ingen'  = lageret svarede: ingen noegle sat -> nul opsaetning, alt som foer
//   'sat'    = der er en noegle -> kraev kvittering
let noegleTilstand = 'ukendt';

function saetNoegle(vaerdi) {
  const ny = (typeof vaerdi === 'string' && vaerdi.trim()) || null;
  const skiftet = ny !== parringsnoegle;
  parringsnoegle = ny;
  noegleTilstand = ny ? 'sat' : 'ingen';
  return skiftet;
}

// Bliver ved til vi VED det. En enkelt fejlet hentning maa ikke kunne blive permanent,
// og den maa slet ikke kunne aabne broen imens.
let forsoeg = 0;
function hentNoegle() {
  chrome.runtime.sendMessage({ type: 'bmcp_hent_parringsnoegle' })
    .then((svar) => {
      if (!svar || svar.ok !== true) throw new Error(svar && svar.fejl || 'no answer');
      saetNoegle(svar.noegle);
    })
    .catch((e) => {
      forsoeg += 1;
      if (forsoeg <= 12) {
        // 1s, 2s, 4s ... op til 30s. Tilstanden bliver 'ukendt' imens, saa broen er lukket.
        setTimeout(hentNoegle, Math.min(1000 * 2 ** (forsoeg - 1), 30000));
      } else {
        console.warn('[Offscreen] giving up on the pairing key; commands stay refused:', e?.message || e);
      }
    });
}
hentNoegle();

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'bmcp_parringsnoegle_aendret') return;
  if (!saetNoegle(msg.noegle)) return;
  // Skift af noegle skal tage effekt med det samme, ikke naeste gang browseren starter.
  for (const [, sokkel] of connections) { try { sokkel.close(); } catch (e) { /* lukket */ } }
  connections.clear();
});
let kodeAftrykCache = null;
async function kodeAftryk() {
  if (kodeAftrykCache) return kodeAftrykCache;
  try {
    const dele = [];
    for (const fil of KODEFILER) {
      const svar = await fetch(chrome.runtime.getURL(fil));
      dele.push(new Uint8Array(await svar.arrayBuffer()));
    }
    const samlet = new Uint8Array(dele.reduce((n, d) => n + d.length, 0));
    let i = 0;
    for (const d of dele) { samlet.set(d, i); i += d.length; }
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', samlet));
    kodeAftrykCache = Array.from(bytes.slice(0, 6)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    console.warn('[Offscreen] kunne ikke beregne kode-aftrykket:', e?.message || e);
  }
  return kodeAftrykCache;
}

function minVersion() {
  try { return new URLSearchParams(location.search).get('v') || null; } catch { return null; }
}

// Portomraadet kommer fra dokumentets egen adresse, sat af background.js ud fra chrome.storage.local.
// Standarden er 9876-9895. En isoleret testbrowser kan flytte den UDEN at repoets filer aendrer sig, saa
// kode-aftrykket - og dermed udgivelsens spaerre - er uroert. Vagten staar begge steder: en vaerdi er kun gyldig
// hvis den er to tal i et fornuftigt spaend. (Astra 12/9.)
function portOmraade() {
  try {
    const v = new URLSearchParams(location.search).get('porte');
    const m = /^(\d{4,5})-(\d{4,5})$/.exec(v || '');
    if (m) {
      const fra = Number(m[1]), til = Number(m[2]);
      if (fra >= 1024 && til <= 65535 && til >= fra && til - fra < 200) return [fra, til];
    }
  } catch {}
  return [9876, 9895];
}
const [BASE_PORT, MAX_PORT] = portOmraade();
const connections = new Map(); // port → WebSocket

// ── Hvorfor porte foerst PROBES med fetch, og ikke bare aabnes (MAALT 22/8) ──────
//
// Chrome bremser nye WebSocket-haandtryk. Formlen staar i Chromiums egen kilde
// (services/network/websocket_throttler.cc):
//
//     forsinkelse = rand(1000..5000) ms × 2^min(p + f/(s+1), 16) / 65536
//
// p = haandtryk i luften lige nu · f = mislykkede · s = lykkedes. Bremsen er
// PER RENDERER-PROCES, ikke per adresse — at sprede sig over 20 porte hjaelper
// altsaa ingenting. Og den her funktion aabnede foer 20 WebSockets i ét smaek
// hvert 2. sekund, hvoraf de fleste var mod doede porte. Det satte baade p og f
// i vejret og laaste eksponenten paa loftet, saa HVER forbindelse betalte den
// maksimale straf paa op til 5 sekunder.
//
// Dertil kom vores egen faelde: connectTimeout stod paa 2000 ms — UNDER bremsens
// maksimum. Vi draebte altsaa systematisk forbindelser der bare stod og ventede,
// og Chromiums header siger det rent ud: at destruere en PendingConnection uden
// at haandtrykket er fuldfoert TAELLER SOM EN FEJL. Hvert drab gjorde bremsen
// haardere, hvilket draebte flere. En spiral vi selv drev.
//
// Maalt effekt: den 10. chat var 15,5 sekunder om at komme op, og 5 af 19 kom
// aldrig inden for 22 sekunder.
//
// Rettelsen er to ting:
//   1. Find levende porte med et almindeligt HTTP-kald. En ws-server svarer
//      "426 Upgrade Required" paa et GET; en doed port afviser. HTTP-kald taeller
//      IKKE med i WebSocket-bremsen — maalt: 100 fejlede HTTP-probes kostede nul,
//      400 fejlede WS-forsoeg kostede 14 sekunder. Vi aabner nu kun WebSockets
//      mod porte vi VED der sidder en server paa, saa f falder til ~0.
//   2. connectTimeout haevet over bremsens 5-sekunders loft, saa vi ikke laengere
//      draeber vores egne ventende forbindelser.
//
// Sidegevinst: det er sikrere. Foer aabnede udvidelsen blindt en WebSocket mod
// hvad der nu maatte lytte paa 9876-9895.
const PROBE_TIMEOUT_MS = 400;
let skanner = false;

async function harServer(port) {
  try {
    const svar = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: 'no-store',
    });
    return svar.status === 426;   // ws-serverens svar paa et almindeligt GET
  } catch {
    return false;                 // afvist, timeout eller ingen der lytter
  }
}

// ⛔ MAALT 23/9: laasen kunne blive staaende for evigt.
//
// `skanner` frigives i `finally`, og det daekker exceptions - men IKKE et loefte der aldrig
// afgoeres. Haenger én probe, afgoeres `Promise.all` aldrig, `finally` naas aldrig, og saa
// returnerer HVER senere skanning med det samme. Broen er doed indtil udvidelsen genstartes.
//
// Maalt i en isoleret browser: `skanner: true`, `forbindelser: 0`, og en probe der ikke
// svarede. Og det rammer ikke kun proever - et offscreen-dokument er aldrig synligt, saa
// Chrome kan fryse det, og et frosset dokument fyrer heller ikke sin egen afbryder-timer.
// Én haengning ville altsaa vaere nok til at en bruger holdt op med at finde servere.
//
// Sikkerhedsventilen frigiver laasen efter et stykke tid uanset hvad. Er dokumentet frosset,
// fyrer den foerst naar det taes op igen - og saa genoptager skanningen, i stedet for at
// vaere doed. Det er hele forskellen paa «en daarlig periode» og «vaek til genstart».
const SCAN_MAX_MS = 15000;
// Porte med en probe i luften. Uden den kan ventilen fordoble antallet af haengende kald.
const iLuften = new Set();

async function scanPorts() {
  if (skanner) return;            // skanningen er nu asynkron; undgaa overlap
  skanner = true;
  const ventil = setTimeout(() => { skanner = false; }, SCAN_MAX_MS);
  try {
    const kandidater = [];
    for (let port = BASE_PORT; port <= MAX_PORT; port++) {
      const existing = connections.get(port);
      if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
        continue;
      }
      kandidater.push(port);
    }
    if (!kandidater.length) return;

    // ⛔ MAALT 23/9: sikkerhedsventilen alene gjorde det VAERRE. Den slipper laasen efter 15 s,
    // en ny skanning starter - og haenger proberne, hober de sig op. Chrome tillader kun et
    // lille antal samtidige forbindelser per vaert, saa de haengende kald aeder pladserne og
    // INTET kommer igennem derefter. 0 af 12 koersler efter at ventilen kom ind, mod groen
    // foer den.
    //
    // Derfor: en port der allerede har en probe i luften, probes ikke igen. Ventilen maa gerne
    // slippe laasen - men den maa ikke kunne fordoble antallet af haengende kald.
    const nye = kandidater.filter((p) => !iLuften.has(p));
    for (const p of nye) iLuften.add(p);
    const levende = await Promise.all(
      nye.map(async (port) => {
        try { return (await harServer(port)) ? port : null; }
        finally { iLuften.delete(port); }
      }),
    );
    for (const port of levende) {
      if (port !== null) tryConnect(port);
    }
  } finally {
    clearTimeout(ventil);
    skanner = false;
  }
}

function tryConnect(port) {
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
  } catch {
    return;
  }

  // MAALT 21/8: en og samme udvidelse stod med TO aabne forbindelser til den samme
  // server. Aarsagen laa her: forbindelsen blev foerst skrevet i kortet i onopen.
  // scanPorts koerer hvert 2. sekund og springer kun over hvis kortet allerede har
  // en forbindelse der er OPEN eller CONNECTING — men i vinduet mellem `new WebSocket`
  // og onopen stod der intet i kortet. Naeste scan lavede derfor endnu en. Den foerste
  // blev forældreloes: aldrig lukket, aldrig i kortet, men fuldt aaben.
  // Registrering med det samme lukker vinduet.
  connections.set(port, ws);

  // 8000, ikke 2000: Chromes bremse kan lovligt holde et haandtryk i op til 5000 ms,
  // og at lukke ned foer det taeller som en fejl der goer bremsen haardere. Se blokken
  // over scanPorts. En haengende port koster nu en plads i 8 sekunder — scanPorts
  // springer allerede CONNECTING over, saa det blokerer intet.
  const connectTimeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) ws.close();
  }, 8000);

  ws.onopen = async () => {
    clearTimeout(connectTimeout);
    connections.set(port, ws);   // stadig vores? scanPorts har ikke lavet en nyere

    // ── Identitets-haandtryk (MAALT 21/8) ──────────────────────────────────
    // To udgaver af udvidelsen kan vaere indlaest i den samme Chrome samtidig —
    // fx en "load unpacked"-kopi ved siden af en anden. Begge scanner de samme
    // porte, saa BEGGE forbinder til hver eneste MCP-server. Serveren havde kun
    // én socket-variabel, som hver ny forbindelse overskrev, saa kommandoerne
    // landede hos den der forbandt sidst — vilkaarligt hvilken af de to. Den
    // anden fortsatte med sit eget sessions-kort og sine egne fane-grupper.
    // Haandtrykket giver serveren det den mangler for at kunne se at der er to,
    // vaelge den nyeste, og sige det hoejt i stedet for at gaette i tavshed.
    // MAALT 22/8 mod en aegte Chrome: haandtrykket ankom ALDRIG, selv om fetch-probet
    // — som ligger i samme fil og samme dokument — virkede fint. Den tomme `catch {}`
    // slugte aarsagen i tavshed, saa fejlen var usynlig baade for serveren og for os.
    // To rettelser: haandtrykket sendes nu UANSET om manifest-opslaget lykkes (det er
    // selve beskeden serveren har brug for, ikke felterne i den), og en fejl bliver
    // logget i stedet for at forsvinde.
    // MAALT 11/9 af Astra (e2e runde 2): haenger hentningen af background.js, blev haandtrykket ALDRIG sendt - og
    // serveren saa en forbindelse uden version. Aftrykket er en bekvemmelighed for udgivelsens gate; hilsenen er ikke.
    // MAALT 12/9 af Astra (efterproevning): fristen paa 1 s var et kaploeb. Tog hentningen 1,3 s, sendte vi `kode: null`,
    // og udgivelsens gate afviste sin EGEN kandidat - et langsomt svar er ikke et forkert svar. Hilsenen sendes derfor
    // med det aftryk der allerede ER beregnet (som regel intet ved foerste forbindelse), og aftrykket EFTERSENDES.
    const kode = kodeAftrykCache;
    let hilsen = { type: 'hello', extensionId: null, version: minVersion(), name: null, kode, noegle: parringsnoegle };
    try {
      hilsen = { type: 'hello', extensionId: chrome.runtime.id, version: minVersion(), name: null, kode, noegle: parringsnoegle };
    } catch (e) {
      console.warn('[Offscreen] could not build the handshake:', e?.message || e);
    }
    try {
      ws.send(JSON.stringify(hilsen));
    } catch (e) {
      console.warn('[Offscreen] kunne ikke sende haandtrykket:', e?.message || e);
    }

    // Eftersendelsen: naar aftrykket er beregnet, faar serveren det - uanset hvor lang tid hentningen tog.
    if (!kode) {
      kodeAftryk().then((k) => {
        if (!k || ws.readyState !== WebSocket.OPEN) return;
        try { ws.send(JSON.stringify({ type: 'kode', kode: k })); }
        catch (e) { console.warn('[Offscreen] kunne ikke eftersende kode-aftrykket:', e?.message || e); }
      });
    }

    console.log(`[Offscreen] Connected to MCP server on port ${port} (${connections.size} total)`);
    updateStatus();
  };

  ws.onmessage = async (event) => {
    let cmd;
    try { cmd = JSON.parse(event.data); } catch { return; }

    // Parringen gaar begge veje. Serveren kvitterer med den noegle den selv kender, saa
    // udvidelsen kan se at den taler med SIN server - ikke med et vilkaarligt program der
    // naaede at lytte paa porten foerst. Uden noegle findes beskeden slet ikke.
    if (cmd && cmd.type === 'parring') {
      if (cmd.ok === true && parringsnoegle && cmd.noegle === parringsnoegle) {
        parrede.add(ws);
      } else {
        console.warn('[Offscreen] The server on port ' + port + ' does not know the pairing key - closing.');
        try { ws.close(); } catch (e) { /* lukket */ }
      }
      return;
    }

    const { id, method, params, pid } = cmd;

    // Er der sat en noegle, udfoeres INTET foer serveren har kvitteret med den. En server
    // uden noegle kvitterer aldrig, og kan derfor ikke styre en parret browser.
    // ⛔ 'ukendt' behandles som 'sat': vi udfoerer intet foer vi VED om der er en noegle.
    // Den anden vej rundt er fail-open, og det var praecis fejlen.
    if (noegleTilstand === 'ukendt') {
      try { ws.send(JSON.stringify({ id, error: 'The extension has not read its pairing state yet - refusing until it knows. Retrying in the background.' })); } catch (e) { /* lukket */ }
      return;
    }
    if (parringsnoegle && !parrede.has(ws)) {
      try { ws.send(JSON.stringify({ id, error: 'This extension is paired with a different server (pairing key).' })); } catch (e) { /* lukket */ }
      return;
    }

    try {
      // Include port so background.js knows which session owns this command
      const result = await chrome.runtime.sendMessage({
        type: 'mcp_command',
        port,
        pid,
        method,
        params: params || {},
      });

      if (result && result.__error) {
        ws.send(JSON.stringify({ id, error: result.__error }));
      } else {
        ws.send(JSON.stringify({ id, result }));
      }
    } catch (err) {
      ws.send(JSON.stringify({ id, error: err.message || String(err) }));
    }
  };

  ws.onclose = () => {
    clearTimeout(connectTimeout);
    if (connections.get(port) === ws) {
      connections.delete(port);
      console.log(`[Offscreen] Disconnected from port ${port} (${connections.size} remaining)`);
      updateStatus();
      // Notify background to release tabs for this session
      chrome.runtime.sendMessage({ type: 'session_disconnect', port }).catch(() => {});
    }
  };

  ws.onerror = () => {
    clearTimeout(connectTimeout);
    ws.close();
  };
}

function updateStatus() {
  const count = connections.size;
  chrome.runtime.sendMessage({
    type: 'ws_status',
    connected: count > 0,
    count,
    ports: [...connections.keys()],
  }).catch(() => {});
}

// Svar paa hjerteslaget. Uden dette svar kan background.js ikke skelne et levende
// dokument fra et der findes men aldrig fik sit script indlaest — og saa bliver et
// doedt dokument aldrig erstattet.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'bmcp_ping') return;
  // MAALT 22/8: svaret var bare { ok: true }. Det fortalte om broen var I LIVE, ikke
  // om den var OPDATERET — og det er to forskellige spoergsmaal. En bro fra en aeldre
  // udgave svarer lige saa villigt paa ping, saa ensureOffscreen regnede den for rask
  // og udskiftede den aldrig. Resultatet: kode-aendringer slog aldrig igennem uden en
  // fuld genstart af Chrome, heller ikke efter "Genindlaes" paa chrome://extensions.
  // Versionen med i svaret goer forskellen synlig.
  sendResponse({ ok: true, version: minVersion() });
  return true;
});

// Listen for terminate signals from background.js (sent when last tab in a session closes)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'terminate_mcp_session' || typeof msg.port !== 'number') return;
  const ws = connections.get(msg.port);
  if (!ws) return;
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'terminate' }));
    }
  } catch {}
  try { ws.close(); } catch {}
  // ws.onclose handler removes from connections + notifies background
});

// Initial scan + frequent rescan for new servers
scanPorts();
setInterval(scanPorts, 2000);
