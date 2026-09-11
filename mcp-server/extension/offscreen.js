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
let kodeAftrykCache = null;
async function kodeAftryk() {
  if (kodeAftrykCache) return kodeAftrykCache;
  try {
    const svar = await fetch(chrome.runtime.getURL('background.js'));
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await svar.arrayBuffer()));
    kodeAftrykCache = Array.from(bytes.slice(0, 6)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    console.warn('[Offscreen] kunne ikke beregne kode-aftrykket:', e?.message || e);
  }
  return kodeAftrykCache;
}

function minVersion() {
  try { return new URLSearchParams(location.search).get('v') || null; } catch { return null; }
}

const BASE_PORT = 9876;
const MAX_PORT = 9895;
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

async function scanPorts() {
  if (skanner) return;            // skanningen er nu asynkron; undgaa overlap
  skanner = true;
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

    // Probes koeres parallelt — de er gratis i bremsens regnskab.
    const levende = await Promise.all(
      kandidater.map(async (port) => (await harServer(port)) ? port : null),
    );
    for (const port of levende) {
      if (port !== null) tryConnect(port);
    }
  } finally {
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
    const kode = await Promise.race([kodeAftryk(), new Promise((ok) => setTimeout(() => ok(null), 1000))]);
    let hilsen = { type: 'hello', extensionId: null, version: minVersion(), name: null, kode };
    try {
      hilsen = { type: 'hello', extensionId: chrome.runtime.id, version: minVersion(), name: null, kode };
    } catch (e) {
      console.warn('[Offscreen] kunne ikke bygge haandtrykket:', e?.message || e);
    }
    try {
      ws.send(JSON.stringify(hilsen));
    } catch (e) {
      console.warn('[Offscreen] kunne ikke sende haandtrykket:', e?.message || e);
    }

    console.log(`[Offscreen] Connected to MCP server on port ${port} (${connections.size} total)`);
    updateStatus();
  };

  ws.onmessage = async (event) => {
    let cmd;
    try { cmd = JSON.parse(event.data); } catch { return; }
    const { id, method, params, pid } = cmd;

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
