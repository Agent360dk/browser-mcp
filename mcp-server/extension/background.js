/**
 * Agent360 Browser MCP — Background Service Worker
 *
 * Handles Chrome API calls relayed from the offscreen document.
 * Each MCP session (port) gets its own Chrome Tab Group with color coding.
 * Tabs are isolated per session — no cross-session interference.
 */

// ── Session Tab Management ─────────────────────────────────────────────────

const SESSION_COLORS = ['blue', 'green', 'yellow', 'red', 'pink', 'purple', 'cyan', 'orange'];
// Select-all modifier is platform-dependent: Cmd (meta=4) on macOS, Ctrl (2) elsewhere.
// Get this wrong and the field isn't selected — Backspace no-ops and new text concatenates onto the old.
const SELECT_ALL_MODS = /Mac/i.test(navigator.userAgent) ? 4 : 2;
const sessions = new Map(); // port → { tabIds: Set, groupId: number|null, color: string, label: string }
// FIX-2: promise-cache latch (not a boolean). The old `if(sessionsLoaded) return`
// flipped the flag BEFORE awaiting storage, so a second concurrent caller on a freshly
// woken service worker proceeded against an EMPTY sessions Map. Caching the promise makes
// every concurrent caller await the SAME populated completion. Resets to null on SW
// eviction (module re-init) and on error, so the next wake retries.
let restorePromise = null;

// Restore sessions from storage (service workers lose in-memory state on suspend)
function restoreSessions() {
  if (restorePromise) return restorePromise;
  restorePromise = (async () => {
    const { sessions: saved } = await chrome.storage.local.get({ sessions: {} });
    for (const [port, data] of Object.entries(saved)) {
      // Verify tabs still exist
      const validTabIds = new Set();
      for (const tabId of (data.tabIds || [])) {
        try {
          await chrome.tabs.get(tabId);
          validTabIds.add(tabId);
        } catch {} // tab no longer exists
      }
      if (validTabIds.size > 0) {
        const activeTabId = data.activeTabId && validTabIds.has(data.activeTabId) ? data.activeTabId : null;
        // Samme kollisionsfejl som i getSession, og derfor samme rettelse: `size + 1`
        // genbruger et nummer der allerede er i brug. Her betyder det at to gendannede
        // sessioner kan komme op med samme navn efter en genstart af service-workeren.
        const brugte = new Set([...sessions.values()].map((x) => x.nummer).filter((n) => typeof n === 'number'));
        let nummer = typeof data.nummer === 'number' ? data.nummer : 1;
        while (brugte.has(nummer)) nummer++;
        sessions.set(Number(port), {
          tabIds: validTabIds,
          activeTabId,
          groupId: data.groupId || null,
          nummer,
          // MAALT 22/8: her stod `data.color || …` og `data.label || …`. Bumpede
          // kollisionsloekken nummeret, fulgte navn og farve IKKE med — de blev
          // gendannet ordret fra lageret. To sessioner kunne saa have hvert sit
          // nummer og stadig begge hedde "Claude 1" i samme farve. Og navnet er
          // praecis dét brugeren ser paa fanegruppen.
          color: SESSION_COLORS[(nummer - 1) % SESSION_COLORS.length],
          label: `Claude ${nummer}`,
          pid: typeof data.pid === 'number' ? data.pid : null,
        });
      }
    }
  })().catch(err => { restorePromise = null; throw err; });
  return restorePromise;
}

function getSession(port, pid) {
  if (!sessions.has(port)) {
    // ── Hvorfor det laveste LEDIGE nummer, og ikke sessions.size + 1 (MAALT 22/8) ──
    // Med `size + 1` genbruges et nummer der allerede er i brug, saa snart en chat
    // lukker: tre chats hedder 1, 2, 3 · chat 1 lukker · size er nu 2 · naeste chat
    // faar "Claude 3" — som chat 3 stadig hedder. To chats deler navn OG farve, og
    // brugeren kan ikke se hvilken fanegruppe der hoerer til hvad.
    //
    // Det er en TREDJE mekanisme bag "alt hedder Claude 1", uafhaengig af de to andre
    // (to udvidelser om samme socket, og adoption uden live-port-gate). Den her
    // rammer ogsaa naar alt andet er rigtigt — man skal bare lukke en chat.
    //
    // Laveste ledige nummer genbruger frigivne pladser uden at kollidere, saa numrene
    // bliver ved med at vaere smaa og laesbare. Farven foelger nummeret, saa to
    // samtidige sessioner heller ikke kan faa samme farve.
    const brugte = new Set([...sessions.values()].map((s) => s.nummer).filter((n) => typeof n === 'number'));
    let nummer = 1;
    // Havde denne chat en plads foer den slap sin port, og er den stadig ledig, saa faar
    // den sin egen tilbage — se pladsPrPid. Ellers laveste ledige, som foer.
    const husket = typeof pid === 'number' ? pladsPrPid.get(pid) : undefined;
    if (typeof husket === 'number' && !brugte.has(husket)) {
      nummer = husket;
    } else {
      while (brugte.has(nummer)) nummer++;
    }
    husketPlads(pid, nummer);

    sessions.set(port, {
      tabIds: new Set(),
      activeTabId: null,
      groupId: null,
      nummer,
      color: SESSION_COLORS[(nummer - 1) % SESSION_COLORS.length],
      label: `Claude ${nummer}`,
      pid: typeof pid === 'number' ? pid : null,
    });
  }
  const s = sessions.get(port);
  // Foerste kald fra en genstartet server kan baere pid'en foer sessionen har den.
  if (s.pid == null && typeof pid === 'number') { s.pid = pid; husketPlads(pid, s.nummer); }
  return s;
}

// Adopt tabs from a session whose MCP connection is gone (FIX-18: reconnect orphaning).
//
// Sessions are keyed on the MCP port. A clean shutdown sends session_disconnect and the
// tabs are closed. But an UNCLEAN drop (server restart, network blip, laptop sleep) leaves
// the session in storage while the client reconnects on a NEW port — so getSession() hands
// back an empty session. Observed damage: navigate() returns tab X while click() fails on
// tab Y, list_tabs() comes back empty, a fresh about:blank spawns per call, and the session
// label walks Claude 1 → 2 → 3 → 4. Every navigate→click pair breaks.
//
// Fix: before serving an unknown port, hand over the tabs of the largest session whose port
// is no longer in mcpPorts (the live-connection list the offscreen bridge keeps in storage).
// Keeps label/color so the user sees continuity instead of a renumbered session.
async function adoptOrphanedSession(port, pid) {
  // Only ever fires for a session that OWNS NOTHING — a session with tabs is left alone.
  if (sessions.has(port) && sessions.get(port).tabIds.size) return null;

  // ── Hvorfor pid'en er afgoerende (regression fundet 16/8) ────────────────────
  // Den oprindelige version adopterede den STOERSTE session uanset hvem den tilhoerte,
  // med den begrundelse at Claude Code spreder kald over flere forbindelser. Men en
  // helt NY chat ejer ogsaa ingenting — saa hver ny chat stjal den aktive chats faner
  // OG dens identitet (linje: sessions.delete(best.port)). Donorens port forsvandt fra
  // kortet, saa dens naeste kald adopterede tilbage. To chats byttede den samme ene
  // session frem og tilbage: alt hed "Claude 1", og kun én ting kunne koere ad gangen.
  //
  // Det aegte behov er smallere: naar EN chats MCP-server genstarter, faar den en ny
  // port og skal genfinde sine egne faner. Den situation kan skelnes praecist, fordi
  // begge porte hoerer til den samme Claude Code-proces. Derfor: adoptér kun fra en
  // session med samme pid. Mangler pid'en (gammel server mod ny udvidelse), adopteres
  // slet ikke — hellere en frisk session end en stjaalet.
  if (typeof pid !== 'number') return null;

  // ── Anden halvdel af gaten (MAALT 21/8) ─────────────────────────────────────
  // Pid'en alene raekker ikke. Foraelder-processen er IKKE en unik identitet: starter
  // en klient flere MCP-servere fra den samme proces, har de alle samme pid — og saa
  // adopterede de hinandens faner paa stribe. Maalt med fire samtidige sessioner:
  // alle fik navnet "Claude 3", de tre aeldste mistede deres fane, og en session
  // kunne skifte til en andens. Altsaa "alt hedder Claude 1", i sin rene form, med
  // kun én udvidelse indlaest.
  //
  // Det manglende tjek staar allerede beskrevet oeverst i denne funktion: adoptér kun
  // fra en session hvis port IKKE laengere er forbundet. Er donorens port stadig i
  // live, er det en anden chat der arbejder lige nu — ikke en genstartet server.
  // Listen vedligeholdes af broen (ws_status → mcpPorts) ved hver til- og frakobling.
  const { mcpPorts = [] } = await chrome.storage.local.get({ mcpPorts: [] });
  const levendePorte = new Set(mcpPorts.map(Number));

  let best = null;
  for (const [p, session] of sessions) {
    if (p === port || !session.tabIds.size) continue;
    if (session.pid !== pid) continue;        // en anden chat — lad den vaere
    if (levendePorte.has(Number(p))) continue; // donoren arbejder stadig — hænderne væk
    if (!best || session.tabIds.size > best.session.tabIds.size) best = { port: p, session };
  }
  if (!best) return null;

  // Verify at least one tab survives — an orphan whose tabs the user already closed is
  // worthless, and adopting it would mask a genuinely fresh start.
  const alive = new Set();
  for (const tabId of best.session.tabIds) {
    try { await chrome.tabs.get(tabId); alive.add(tabId); } catch {}
  }
  if (!alive.size) {
    sessions.delete(best.port);
    persistSessions();
    return null;
  }

  best.session.tabIds = alive;
  if (!alive.has(best.session.activeTabId)) best.session.activeTabId = null;
  sessions.delete(best.port);
  sessions.set(port, best.session);
  persistSessions();
  return best.session;
}

// LRU eviction cap: hver session må højst have N åbne tabs samtidigt.
// Når en ny tab tilføjes ud over cap'en, lukkes den ÆLDSTE tab i sessionen
// (insertion-order via Set) — bortset fra session.activeTabId (current tab).
// Begrundelse: Claude Code-flows kan åbne 20+ navigate(new_tab=true) per session
// over en længere conversation. Uden eviction akkumulerer disse i Chrome som
// orphan-tabs der spiser RAM + giver "extension localhost 19+" tab-noise.
//
// Hævet 10 → 20 (21/8). Ti var for lavt til reelle flows: en jagt der åbner en
// fane pr. udbyder ramte loftet midtvejs, og evictionen lukkede de faner arbejdet
// stadig byggede på — tavst, for eviction rapporterer ikke noget. Tyve matcher
// portspændet (9876-9895), så en session kan holde lige så mange faner som der
// kan køre samtidige sessioner.
const MAX_TABS_PER_SESSION = 20;

async function evictOldestTabs(session, justAddedTabId) {
  // Drop dead tab-ids først (user manually closed dem)
  for (const id of [...session.tabIds]) {
    try {
      await chrome.tabs.get(id);
    } catch {
      session.tabIds.delete(id);
    }
  }
  // Evict oldest indtil ≤ cap. Skip activeTabId og just-added tab.
  const ordered = [...session.tabIds];
  for (const oldId of ordered) {
    if (session.tabIds.size <= MAX_TABS_PER_SESSION) break;
    if (oldId === session.activeTabId) continue;
    if (oldId === justAddedTabId) continue;
    try {
      await chrome.tabs.remove(oldId);
    } catch {} // tab may already be closed
    session.tabIds.delete(oldId);
  }
}

async function addTabToSession(port, tabId) {
  const session = getSession(port);
  session.tabIds.add(tabId);
  // Sessionen lever igen — aflys en eventuel port-frigivelse (se tabs.onRemoved).
  chrome.alarms.clear(`frigiv-${port}`).catch(() => {});

  // LRU eviction: når sessionen overstiger cap, luk de ældste tabs.
  if (session.tabIds.size > MAX_TABS_PER_SESSION) {
    await evictOldestTabs(session, tabId);
  }

  try {
    if (session.groupId !== null) {
      try {
        await chrome.tabs.group({ tabIds: [tabId], groupId: session.groupId });
      } catch {
        // Group no longer valid — will create new one below
        session.groupId = null;
      }
    }

    if (session.groupId === null) {
      const groupId = await chrome.tabs.group({ tabIds: [...session.tabIds] });
      session.groupId = groupId;
      await chrome.tabGroups.update(groupId, {
        title: session.label,
        color: session.color,
        collapsed: false,
      });
    }
  } catch (e) {
    console.warn('[MCP] Tab group error:', e.message);
  }

  persistSessions();
}

async function releaseSession(port) {
  const session = sessions.get(port);
  if (!session) return;

  // ── Bad vi selv om frigivelsen? (FUNDET AF REVIEW 7/9) ────────────────────
  //
  // Vejen fra "sessionen er tom" til denne funktion gaar over mindst tre hop:
  // sendMessage -> offscreen sender terminate og lukker WS -> ws.onclose ->
  // session_disconnect. Aabner agenten en fane i de ~50 ms undervejs, lukkede
  // oprydningen herunder DEN fane — paa grundlag af en beslutning der blev truffet
  // foer fanen fandtes. Det er praecis "agenten holder pause og genoptager"-
  // scenariet frigivelsen er bygget til at understoette.
  //
  // En UVENTET afbrydelse (chatten er vaek) skal stadig lukke fanerne — derfor
  // skelnes der, i stedet for bare at tjekke om sessionen er tom.
  // #12: sessionen forsvinder her — dens frist skal med, uanset hvilken vej vi gaar ud.
  chrome.alarms.clear(`frigiv-${port}`).catch(() => {});

  if (frivilligtFrigivet.delete(port)) {
    if (session.tabIds.size) {
      // Sessionen arbejder igen. Behold den, saa naeste binding kan adoptere den
      // (adoptOrphanedSession finder donorer med samme pid OG faner).
      persistSessions();
      return;
    }
    sessions.delete(port);
    persistSessions();
    return;
  }

  // Detach debugger + close all session tabs
  //
  // #13: fejlene blev slugt her, og `sessions.delete(port)` koerte alligevel. En fane der
  // ikke KUNNE lukkes blev dermed foraeldreloes: stadig aaben, stadig i en farvet gruppe,
  // men uden for enhver session — usynlig for list_tabs og aldrig ryddet op. Praeeksisterende,
  // men v1.29 slipper porte langt oftere, saa stien koeres langt hyppigere end foer.
  const stadigAabne = new Set();
  for (const tabId of [...session.tabIds]) {
    debuggerForceDetach(tabId);
    try {
      await chrome.tabs.remove(tabId);
      session.tabIds.delete(tabId);
    } catch {
      // Fanen kan vaere lukket i forvejen — saa er den vaek, og det er fint. Findes den
      // stadig, beholder vi den: bedre en session der lever lidt for laenge end en fane
      // ingen ejer.
      try {
        await chrome.tabs.get(tabId);
        stadigAabne.add(tabId);
      } catch {
        session.tabIds.delete(tabId);
      }
    }
  }

  if (stadigAabne.size) {
    console.warn('[BG] kunne ikke lukke', [...stadigAabne], '— sessionen beholdes saa fanerne ikke strander');
    session.tabIds = stadigAabne;
    persistSessions();
    return;
  }

  sessions.delete(port);
  persistSessions();
}

function persistSessions() {
  const data = {};
  for (const [port, session] of sessions) {
    data[port] = {
      tabIds: [...session.tabIds],
      activeTabId: session.activeTabId,
      groupId: session.groupId,
      color: session.color,
      label: session.label,
      nummer: session.nummer ?? null,   // uden denne mister en gendannet session sin plads og kan kollidere
      pid: session.pid ?? null,   // uden denne adopterer en genstartet service worker paa tvaers af chats igen
    };
  }
  chrome.storage.local.set({ sessions: data });
}

// Get the active tab for this session (last navigated), or create one.
// activate=false (default): runs in background — no focus stealing.
// activate=true: only for commands that NEED visible tab (screenshot, ask_user, navigate, execute_script).
async function getSessionTab(port, activate = false) {
  const session = getSession(port);
  let target = null;
  // Remember our OWN about:blank placeholder so we reuse it instead of spawning another
  // on every read-only call before the first navigate (FIX-4: about:blank proliferation).
  let blankFallback = null;
  const consider = (tab) => {
    if (!tab) return false;
    if (tab.url.startsWith('chrome://')) return false;
    if (tab.url.startsWith('about:')) { if (!blankFallback) blankFallback = tab; return false; }
    return true;
  };

  // Prefer the active (last navigated) tab
  if (session.activeTabId) {
    try {
      const tab = await chrome.tabs.get(session.activeTabId);
      if (consider(tab)) target = tab;
    } catch {
      const dead = session.activeTabId;   // FIX-17: capture id BEFORE nulling (was deleting null)
      session.activeTabId = null;
      session.tabIds.delete(dead);
    }
  }

  // Fallback: any usable session tab
  if (!target) {
    for (const tabId of session.tabIds) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (consider(tab)) { session.activeTabId = tabId; target = tab; break; }
      } catch {
        session.tabIds.delete(tabId);
      }
    }
  }

  // Reuse our own blank placeholder rather than spawning yet another one (FIX-4).
  if (!target && blankFallback) {
    target = blankFallback;
    session.activeTabId = target.id;
    persistSessions();
  }

  // No usable tab at all — create ONE placeholder and pin it as the active tab so the
  // NEXT call reuses it (FIX-4) instead of creating a fresh about:blank every time.
  if (!target) {
    target = await chrome.tabs.create({ url: 'about:blank', active: false });
    await addTabToSession(port, target.id);
    session.activeTabId = target.id;
    persistSessions();
    // fall through to the activate branch (SC-3: previously returned early, skipping it)
  }

  // Activate the tab WITHOUT stealing the user's focus (FIX-1). This is a BACKGROUND tool:
  // screenshot/press_key run constantly, so we must NOT chrome.windows.update({focused:true})
  // here — that yanked Chrome to the foreground on every action. We only (a) un-minimize a
  // minimized window (needed so it can composite) and (b) make the tab active within its
  // window. The truly-occluded (covered) case is handled as a bounded last-resort
  // raise-and-restore inside the screenshot handler only.
  if (activate) {
    try {
      if (target.windowId != null) {
        const win = await chrome.windows.get(target.windowId).catch(() => null);
        if (win && win.state === 'minimized') {
          await chrome.windows.update(target.windowId, { state: 'normal' }); // no focused:true
        }
      }
      if (!target.active) await chrome.tabs.update(target.id, { active: true });
      await new Promise(r => setTimeout(r, 150));
      target = await chrome.tabs.get(target.id);
    } catch { /* best-effort; capture path surfaces the real error */ }
  }

  return target;
}

// ── Chrome Debugger API Helpers (CSP-bypass for Google, Stripe, Slack) ─────

// Track which tabs have debugger attached to avoid repeated attach/detach
const debuggerAttached = new Set();

// Verify Chrome's actual debugger-truth before trusting local cache.
// Fixes "ghost-attached" state where Set says attached but Chrome side is gone
// (happens on SW lifecycle events, user-canceled banners, anti-automation evictions).
async function verifyAttachedWithChrome(tabId) {
  try {
    const targets = await chrome.debugger.getTargets();
    const t = targets.find(x => x.tabId === tabId);
    return !!t?.attached;
  } catch {
    return false; // assume not-attached on API error
  }
}

async function debuggerAttach(tabId) {
  // First check local cache — fast path
  if (debuggerAttached.has(tabId)) {
    // Verify with Chrome before trusting cache (cheap, ~1ms)
    if (await verifyAttachedWithChrome(tabId)) return;
    // Cache was stale — Chrome doesn't actually have us attached
    debuggerAttached.delete(tabId);
  }

  // Up to 3 attempts. A "ghost attach" (attach resolves but getTargets shows the tab
  // NOT attached) is usually TRANSIENT: the page is mid-navigation/reload — e.g. the
  // Metro dev-server rebuilding localhost:8081 auto-detaches the debugger. Retrying
  // after a short delay lets the reload settle. Only a ghost that survives all retries
  // is a real user-canceled banner. (Previously we threw on the first ghost, which made
  // dev-server URLs unusable during their initial bundle.)
  let lastMsg = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      if (await verifyAttachedWithChrome(tabId)) {
        debuggerAttached.add(tabId);
        return;
      }
      // Ghost — detach cleanly so the next attempt starts fresh, then retry.
      lastMsg = 'attach resolved but Chrome shows tab not attached (ghost — page likely mid-reload)';
      try { await chrome.debugger.detach({ tabId }); } catch {}
    } catch (e) {
      // MAALT 31/8 af den nye udvidelses-test: her stod `includes('Already attached')`
      // med stort A. Chromes faktiske besked er "Another debugger is already attached
      // to the tab with id: N" — med lille. Tjekket ramte ALDRIG. Resultat: naar en
      // anden debugger havde fanen (DevTools aabent, en anden udvidelse), blev det
      // behandlet som en fejl, proevet tre gange, og kastet — i stedet for bare at
      // bruge den session der allerede fandtes.
      if (/already attached/i.test(e.message || '')) {
        // Chrome side has session — sync local cache
        debuggerAttached.add(tabId);
        return;
      }
      // "Cannot attach"/"canceled" can also be transient during navigation — retry too.
      lastMsg = e.message || String(e);
    }
    if (attempt < 2) await new Promise(r => setTimeout(r, 250 + attempt * 250));
  }
  throw new Error(
    `Debugger attach failed after 3 attempts (tab ${tabId}). Last: ${lastMsg}. ` +
    `If persistent: the page may be continuously reloading (dev-server mid-build — wait, then retry), ` +
    `or the user canceled Chrome's debugger banner — reload Browser MCP (chrome://extensions/ → ↻) or restart Chrome.`
  );
}

async function debuggerDetach(tabId) {
  // Don't detach immediately — keep attached for subsequent commands.
  // Will be cleaned up when tab closes or session ends.
}

function debuggerForceDetach(tabId) {
  if (!debuggerAttached.has(tabId)) return;
  debuggerAttached.delete(tabId);
  try {
    chrome.debugger.detach({ tabId });
  } catch {}
}

// Sync local Set when Chrome auto-detaches (navigation, idle, devtools opened, etc.)
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId) {
    debuggerAttached.delete(source.tabId);
    if (reason && reason !== 'target_closed') {
      console.log(`[MCP] Debugger auto-detached from tab ${source.tabId} (reason: ${reason})`);
    }
  }
});

// Methods that are safe to retry without double-effect.
// Side-effectful methods (Input.*, DOM.setFileInputFiles) must NEVER auto-retry:
// Chrome may detach AFTER processing the input (e.g., keystroke triggered navigation),
// and a blind retry would double-type or double-click.
// MAALT 9/9-2026 (fundet af Astra, reproduceret her): `Runtime.evaluate` stod paa listen,
// fordi de fleste kald er laesninger. Men vi kan ikke afgoere paa metodenavnet om et
// udtryk MUTERER — og flere af dem goer:
//   * settle-udtrykket i debuggerClick FYRER reserveloesnings-klikket
//   * scroll'ens reserveloesning kalder window.scrollBy
//   * fill skriver i feltet gennem evalAttached
// Reproduktion: cdpSend(1,'Runtime.evaluate',{expression:'window.tael++'}) med en
// detach-fejl koerte udtrykket FIRE gange. Paa en SPA hvor debuggeren falder af, kunne
// det altsaa lande fire klik — paa en knap der maaske bestiller noget.
//
// Vi kan ikke skelne, saa standarden skal vaere sikker. Falder debuggeren af midt i en
// evaluering, faar kalderen fejlen og kan selv beslutte om det er forsvarligt at gentage.
// Prisen er en tabt gentagelse paa anti-automatiserings-sider; alternativet er et
// dobbeltklik, og de to ting er ikke lige slemme.
const RETRYABLE_CDP_METHODS = new Set([
  'DOM.getDocument',
  'DOM.querySelector',
  'DOM.querySelectorAll',
  'DOM.focus',
  'DOM.describeNode',
  'Runtime.enable',
  'Page.captureScreenshot',
  'Page.enable',
  'Network.enable',
  'Network.disable',
  'Network.getResponseBody',
]);

// CDP wrapper with auto-recovery: re-attaches on detach errors.
// For read-only methods (whitelist above), retries once after re-attach.
// For side-effectful methods, only re-attaches and throws — caller must decide.
// MAALT 8/9-2026: `Input.dispatchMouseEvent` med mouseWheel indfrier ALDRIG sit loefte.
// `browser_scroll` med pixels ramte derfor serverens 30-sekunders-loft 6 kald ud af 6,
// paa baade en kort og en lang side — og den `window.scrollBy` der er skrevet til netop
// det tilfaelde, ligger i et `catch` og kunne aldrig naas. En haenger er ikke en exception.
// Fristen findes for at reserveloesningen kan naas. Alt der HAR en reserveloesning skal
// kunne naas via en frist, ikke kun via en fejl.
// Foerste udgave satte 1.500 ms paa ALT. Astra fandt 9/9 at det indfoerte en ny fejlklasse:
// dialog-ventetider bruger 3.000 ms, og et Page.captureScreenshot paa en tung side kan
// lovligt tage laengere. Fristen skar dem over, og skaermbilledets reserveloesning blev
// dermed naaet i almindelig drift — se rettelse B nedenfor.
//
// Den hang der blev MAALT var Input.dispatchMouseEvent med mouseWheel, som aldrig indfrier
// sit loefte. Laesekald har i forvejen deres egne ydre frister (evaluerTaalmodigt).
// Derfor: kort frist paa input-kald, og en rundhaandet bagstopper paa resten — stadig under
// serverens 30 s, saa kalderens reserveloesning kan naas.
const CDP_FRIST_INPUT_MS = 1500;
const CDP_FRIST_MS = 8000;
// MAALT 9/9 af reviewet: ét loft paa alt braekker tre ting. Et skaermbillede paa en tung
// side bruger lovligt mere end 8 s; `execute_script` med awaitPromise venter paa BRUGERENS
// egen kode, som serveren giver 30 s; og et enkelt tastetryk paa en side med validering
// pr. anslag kan lovligt overskride input-fristen. Fristen skal derfor kende kaldet.
const CDP_FRIST_TUNG_MS = 20000;   // under serverens 30 s, men over alt lovligt

function cdpFrist(method, params) {
  const m = String(method);
  // Brugerens egen kode maa vente: awaitPromise betyder "vent paa dette loefte".
  if (m === 'Runtime.evaluate' && params && params.awaitPromise) return CDP_FRIST_TUNG_MS;
  if (m === 'Page.captureScreenshot' || m === 'Network.getResponseBody') return CDP_FRIST_TUNG_MS;
  return m.startsWith('Input.') ? CDP_FRIST_INPUT_MS : CDP_FRIST_MS;
}

// Skaermbilledet har et budget for HELE kaeden, ikke kun pr. kald.
// MAALT 11/9 af Astra (sign-off, R5 F8): standardoptagelsen hang og koblede foerst fra efter 19 s. cdpSend gentog den,
// fordi den staar som sikker at gentage, og billedet kom efter ca. 38 s - serveren havde opgivet ved 30 s. I 1.29.0
// sendte en frist paa 8 s kaldet videre til fromSurface:false, som svarede paa et halvt sekund.
// Standardoptagelsen faar derfor 10 s. Reserven faar resten op til 26 s, saa svaret naar frem foer serverens 30 s.
function skaermbilledeFrister() {
  return { foersteMs: 10000, samletMs: 26000 };
}

// wait_for_network har samme loft hos serveren (30 s). MAALT 11/9 af Astra (e2e-review): svaret kom efter 13 s, body-kaldet
// fik CDP_FRIST_TUNG_MS (20 s) oveni, og serveren opgav ved 30 s, hvor 1.29.0 svarede efter 21 s med body:null.
// Hele vaerktoejet har derfor ét budget, og body-kaldet faar kun det der er tilbage.
// Astra (efterproevning af c826f63): budgettet skar en body over der kom efter 27 s + 2 s, som 1.29.0 leverede efter 29 s.
// Body-kaldet faar derfor aldrig kortere tid end 1.29.0's frist (CDP_FRIST_MS) og aldrig mere end CDP_FRIST_TUNG_MS.
function netvaerkFrister() {
  return { budgetMs: 28000, bodyMinMs: CDP_FRIST_MS, bodyMaxMs: CDP_FRIST_TUNG_MS };
}

function cdpMedFrist(tabId, method, params) {
  let ur;
  const frist = cdpFrist(method, params);
  return Promise.race([
    chrome.debugger.sendCommand({ tabId }, method, params),
    new Promise((_, afvis) => {
      // MAALT 11/9 (raa CDP-proeve i Chrome for Testing): Chrome leverer ikke Input.* til en fane i baggrunden.
      // Kaldet haenger, og efter aktivering svarer det paa millisekunder. Fejlen siger det, saa agenten ved hvad den goer.
      const hint = String(method).startsWith('Input.')
        ? ' (fanen er sandsynligvis i baggrunden - Chrome leverer ikke mus og taster til en fane der ikke er aktiv; kald browser_switch_tab og proev igen)'
        : '';
      ur = setTimeout(() => afvis(new Error(`CDP svarede ikke inden ${frist} ms: ${method}${hint}`)), frist);
    }),
  ]).finally(() => clearTimeout(ur));
}

async function cdpSend(tabId, method, params = {}) {
  await debuggerAttach(tabId);
  let lastMsg = '';
  // 4 total attempts (initial + 3 retries) for read-only methods; backoff 100/300/500ms.
  // Handles aggressive auto-detach on anti-automation sites (Apple ASC, Salesforce, etc.)
  // where Chrome re-detaches between attach and command execution.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await cdpMedFrist(tabId, method, params);
    } catch (e) {
      const msg = e?.message || String(e);
      const isDetachError =
        msg.includes('not attached') ||
        msg.includes('Detached') ||
        msg.includes('detached') ||
        msg.includes('Debugger is gone') ||
        msg.includes('No tab with given id');
      if (!isDetachError) throw e;
      lastMsg = msg;
      debuggerAttached.delete(tabId);
      if (!RETRYABLE_CDP_METHODS.has(method)) {
        // Side-effectful methods (Input.*) — re-attach for next caller but signal
        // to handler so it can fall back to chrome.scripting (e.g., synthetic click).
        try { await debuggerAttach(tabId); } catch {}
        throw new Error(`Debugger detached during ${method} — not auto-retried (side-effect risk). Original: ${msg}`);
      }
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 100 + attempt * 200));
        try { await debuggerAttach(tabId); } catch (attachErr) {
          throw new Error(`Re-attach failed during ${method}: ${attachErr.message}`);
        }
      }
    }
  }
  throw new Error(`Debugger detached repeatedly during ${method} (4 attempts). Last: ${lastMsg}`);
}

// Clean up debugger + session refs when tabs close
// Faner agenten selv lukkede via close_tab. En tom session betyder kun "arbejdet er slut"
// hvis det var BRUGEREN der lukkede den sidste fane.
const agentLukkedeFaner = new Set();
// Porte hvor VI selv har bedt serveren slippe porten, fordi sessionen var tom.
// Skelnen betyder alt i releaseSession: en frivillig frigivelse maa aldrig lukke
// faner, mens en uventet afbrydelse (chatten er vaek) netop skal rydde op.
const frivilligtFrigivet = new Set();
// Hvilken plads en chat sidst havde, husket paa dens pid — ikke paa porten.
//
// MAALT 8/9 (#17): siden porten slippes naar en session er faerdig, slettes sessionen.
// Kommer chatten tilbage, faar den det laveste LEDIGE nummer — saa en chat der var
// "Claude 3" vender tilbage som "Claude 1" i en anden farve, og brugeren kan ikke
// genkende sin egen fanegruppe. Identiteten hoerer til chatten, ikke til porten.
//
// Garantien er praecis "dit gamle nummer HVIS det er ledigt". Er det taget, vinder den
// nulevende session — ellers ville vi genindfoere den navnekollision som lavest-ledige-
// nummer blev indfoert for at loese.
const pladsPrPid = new Map();
function husketPlads(pid, nummer) {
  if (typeof pid !== 'number') return;
  pladsPrPid.set(pid, nummer);
  // Kortet maa ikke vokse i det uendelige paa en langtlevende worker.
  if (pladsPrPid.size > 60) pladsPrPid.delete(pladsPrPid.keys().next().value);
}

// ── Armerede dialog-haandterere, pr. fane ──────────────────────────────────────
// MAALT 22/8 af flowtesten: handle_dialog var ubrugelig som den var skrevet. Den
// BLOKEREDE i op til 10 sekunder mens den ventede paa en dialog — men en alert(),
// confirm() eller prompt() dukker foerst op naar man klikker paa noget, og klikket
// kan ikke ske mens kaldet blokerer. Man kunne altsaa hverken arme den foerst eller
// kalde den bagefter: naar dialogen foerst staar der, er hele fanen laast, og
// klik-vaerktoejet naar ikke frem. Vaerktoejet kunne kun lykkes hvis en ANDEN aabnede
// dialogen paa praecis det rigtige tidspunkt.
//
// Nu armerer den og vender tilbage med det samme. Lytteren bliver siddende og tager
// den naeste dialog paa fanen. `wait: true` giver den gamle blokerende adfaerd for
// de tilfaelde hvor dialogen allerede er undervejs.
const armeredeDialoger = new Map();
// Loeftet for den senest armerede dialog pr. fane. Ligger UDEN for armeredeDialoger,
// fordi lytteren afvaebner i samme oejeblik dialogen aabner — og klikket skal kunne
// vente paa svaret BAGEFTER.
const dialogLoefter = new Map();   // tabId -> Promise   // tabId → { listener, timer, action }

function afvaebnDialog(tabId, grund) {
  const a = armeredeDialoger.get(tabId);
  if (!a) return;
  try { chrome.debugger.onEvent.removeListener(a.listener); } catch {}
  clearTimeout(a.timer);
  armeredeDialoger.delete(tabId);
  // MAALT 22/8: her stoppede funktionen. Loeftet blev ALDRIG opfyldt, saa en kalder
  // med `wait: true` haengte for evigt ad to helt almindelige veje — fanen blev
  // lukket, eller et andet handle_dialog armerede paa samme fane. Ingen fejl, intet
  // svar, bare stilhed. Nu faar kalderen altid et svar.
  if (grund && a.opfyld) a.opfyld({ ok: false, error: grund });
}

// Fylder sessions-kortet fra lageret UDEN at filtrere paa om fanerne stadig findes.
//
// `restoreSessions()` dropper sessioner uden GYLDIGE faner (`validTabIds.size > 0`), og i
// `tabs.onRemoved` er den fane vi lige har mistet netop den der ville goere sessionen
// ugyldig. Bruger man restoreSessions dér, forsvinder praecis den session man skal handle
// paa. Samme faelde som i alarm-lytteren, og derfor samme svar: laes lageret raat.
async function hydrerSessionerRaat() {
  if (sessions.size) return;
  const { sessions: gemte } = await chrome.storage.local.get({ sessions: {} });
  for (const [port, d] of Object.entries(gemte)) {
    const p = Number(port);
    if (sessions.has(p)) continue;
    sessions.set(p, {
      tabIds: new Set(d.tabIds || []),
      activeTabId: d.activeTabId ?? null,
      groupId: d.groupId ?? null,
      color: d.color,
      label: d.label,
      nummer: d.nummer ?? null,
      pid: d.pid ?? null,
    });
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  afvaebnDialog(tabId, 'fanen blev lukket foer der kom en dialog');
  const lukketAfAgenten = agentLukkedeFaner.delete(tabId);
  debuggerAttached.delete(tabId);
  // MAALT 8/9 (#15): loekken herunder loeb SYNKRONT paa `sessions`. Vaekker eventet en
  // suspenderet service-worker, er kortet tomt, loekken koerer nul gange, og hverken
  // nedlukningen eller fristen bliver sat — porten holdes saa til 4-timers-tomgangen.
  // Agentens egen close_tab ramte det ikke (den kommer som mcp_command, der vaekker og
  // gendanner foerst). Det var specifikt MENNESKET der lukkede den sidste fane, senere.
  (async () => {
  await hydrerSessionerRaat();
  for (const [port, session] of sessions) {
    if (!session.tabIds.has(tabId)) continue;
    session.tabIds.delete(tabId);
    if (session.tabIds.size === 0 && !lukketAfAgenten) {
      // Last tab closed — tell offscreen to terminate the MCP server.
      // Resulting WS-close triggers the existing session_disconnect → releaseSession path.
      frivilligtFrigivet.add(port);
      chrome.runtime.sendMessage({ type: 'terminate_mcp_session', port }).catch(() => {});
    } else if (session.tabIds.size === 0) {
      // ── Agenten lukkede selv sin sidste fane (MAALT 7/9-2026) ────────────────
      // Her stod der intet, og det var med vilje: en agent der lukker en fane midt i
      // et forloeb skal ikke miste browseren. Men serverens EGEN instruks siger til
      // hver eneste agent: "ALWAYS close tabs when done". Hver velopdragen chat endte
      // altsaa med at holde sin port til 4-timers-tomgangen udloeb — den dokumenterede
      // god-praksis slog oprydningen ihjel, og 20 porte kunne staa optaget af chats
      // der for laengst var faerdige.
      //
      // Nu: fem minutters henstand. Kommer der en ny fane inden da, aflyses den
      // (se getSessionTab). Sker der intet, bedes serveren slippe porten — den DOER
      // ikke, saa chatten kan hente browseren tilbage naar som helst.
      //
      // chrome.alarms og ikke setTimeout: en MV3-service-worker suspenderes, og en
      // timer ville forsvinde med den.
      chrome.alarms.create(`frigiv-${port}`, { delayInMinutes: 5 });
      persistSessions();
    } else {
      persistSessions();
    }
  }
  })().catch(() => {});
});

// Physical-key `code` for a character, US layout. We used to build this as
// `Key${char.toUpperCase()}`, which is only correct for letters: "1" became "Key1",
// "@" became "Key@", " " became "Key ". Frameworks that branch on event.code —
// masked inputs, shortcut handlers, several React form libraries — see an unknown
// code and drop the keystroke, so typing an email or URL misbehaved on strict SPAs.
// Shifted symbols report the code of the physical key they sit on ("@" is Digit2).
const CDP_CHAR_CODES = {
  ' ': 'Space', '\n': 'Enter', '\t': 'Tab',
  '-': 'Minus', '_': 'Minus', '=': 'Equal', '+': 'Equal',
  '[': 'BracketLeft', '{': 'BracketLeft', ']': 'BracketRight', '}': 'BracketRight',
  '\\': 'Backslash', '|': 'Backslash', ';': 'Semicolon', ':': 'Semicolon',
  "'": 'Quote', '"': 'Quote', ',': 'Comma', '<': 'Comma',
  '.': 'Period', '>': 'Period', '/': 'Slash', '?': 'Slash',
  '`': 'Backquote', '~': 'Backquote',
  '!': 'Digit1', '@': 'Digit2', '#': 'Digit3', '$': 'Digit4', '%': 'Digit5',
  '^': 'Digit6', '&': 'Digit7', '*': 'Digit8', '(': 'Digit9', ')': 'Digit0',
};
function cdpCodeForChar(ch) {
  if (ch >= 'a' && ch <= 'z') return `Key${ch.toUpperCase()}`;
  if (ch >= 'A' && ch <= 'Z') return `Key${ch}`;
  if (ch >= '0' && ch <= '9') return `Digit${ch}`;
  // Unknown (accented letters, CJK, emoji): omit it. CDP accepts a missing code,
  // and an omitted code is honest where a fabricated one is actively misleading.
  return CDP_CHAR_CODES[ch] || '';
}

// Types text as individual key events. Assumes the debugger is already attached —
// debuggerType() is the public wrapper that manages attach/detach.
async function typeCharsAttached(tabId, text) {
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const code = cdpCodeForChar(char);
    await tastParAttached(tabId,
      { text: char, key: char, ...(code ? { code } : {}), unmodifiedText: char },
      { key: char, ...(code ? { code } : {}) });
    // Human-like typing: random 30-120ms, occasional longer pause
    const pause = (i > 0 && i % (7 + Math.floor(Math.random() * 5)) === 0)
      ? 150 + Math.random() * 200  // thinking pause every ~10 chars
      : 30 + Math.random() * 90;   // normal keystroke
    await new Promise(r => setTimeout(r, pause));
  }
}

async function debuggerType(tabId, text) {
  await debuggerAttach(tabId);
  try {
    await typeCharsAttached(tabId, text);
  } finally {
    await debuggerDetach(tabId);
  }
}

// ── Naar en dialog kan aabne midt i klikket (MAALT 24/8) ─────────────────────
//
// Et confirm() fryser rendereren, og Chrome svarer ALDRIG paa den CDP-kommando der
// udloeste det. Maalt: browser_click haengte i 25,9 sekunder og gav aldrig svar —
// mens dialogen faktisk BLEV besvaret af den armerede haandtering (siden rapporterede
// window.__svar === true). Klikket var altsaa leveret; kun svaret var vaek.
//
// Er der armeret en dialog paa fanen, venter vi derfor kun kort. Kommer der intet
// svar, ER klikket leveret — det er jo netop dét der aabnede dialogen.
async function dispatchTaalmodigt(tabId, params) {
  if (!armeredeDialoger.has(tabId)) {
    return cdpSend(tabId, 'Input.dispatchMouseEvent', params);
  }
  let faerdig = false;
  const kald = cdpSend(tabId, 'Input.dispatchMouseEvent', params)
    .then((r) => { faerdig = true; return r; })
    .catch(() => { faerdig = true; });
  await Promise.race([kald, new Promise((r) => setTimeout(r, 1200))]);
  return faerdig ? kald : { __dialogBlokerede: true };
}

// MAALT 28/8: `dispatchTaalmodigt` ovenfor lukkede deadlocken paa museklikket, men
// settle-opslaget i step 3 er OGSAA et renderer-kald — og maalingen viste at det er
// PRAECIS der klikket haenger (HAENGER@step3-settle). Deadlocken var kun lukket paa
// hovedstien.
//
// Foerste forsoeg gjorde kuren betinget af at vi kunne SE en dialog (armeret, eller en
// dispatch der blokerede). Den betingelse holder ikke: dispatchen kan naa at blive
// kvitteret, og lytteren kan naa at afvaebne, FOER rendereren gaar i staa. Saa faldt vi
// tilbage i det ubeskyttede kald og hang alligevel — maalt.
//
// Derfor er fristen nu betingelsesloes. Opslaget er et par linjers synkron JS: svarer
// rendereren, er den tilbage paa millisekunder. Bruger den over tre sekunder, er den
// blokeret — ikke langsom. Saa svarer vi aerligt i stedet for at vente i 30.
// Et klik der aabnede en dialog ER landet, saa framework-fallbacken skal ikke fyre oveni.
async function evaluerTaalmodigt(tabId, params, ms = 3000) {
  let faerdig = false;
  const kald = cdpSend(tabId, 'Runtime.evaluate', params)
    .then((r) => { faerdig = true; return r; })
    .catch((e) => { faerdig = true; return { __fejl: String(e?.message || e) }; });
  await Promise.race([kald, new Promise((r) => setTimeout(r, ms))]);
  if (faerdig) return kald;
  return { result: { value: { landed: true, fallbackFired: false, rendererSvarede: false, observeret: false } } };
}

// Én regel for om et klik landede - brugt af click, click_xy og select_option. Astra, tredje runde:
// select_option havde stadig den gamle ("ikke falsk" = landet), saa et uvist klik blev til ok:true.
function klikLandede(r) {
  return r?.landed === true || r?.detached === true;
}

// MAALT 10/9 af Astra (anden runde): et settle-opslag der FEJLEDE gav null, og null blev til ok:true.
// Men den hyppigste grund til at opslaget fejler er at klikket navigerede - det er en virkning, og agenten
// maa ikke faa at vide at den skal klikke igen.
// Tredje runde: "detached", "closed" og "Cannot find" er IKKE bevis for navigation - afkobling sker ogsaa
// naar nogen aabner DevTools. Bevis er nu: fanen er lukket, adressen er skiftet, eller JavaScript-konteksten
// blev revet ned (det sker kun naar dokumentet blev udskiftet). Alt andet er uvist og siges som uvist.
async function tolkManglendeSettle(tabId, settle, urlFoer) {
  const fejl = settle?.__fejl || 'settle-opslaget gav intet svar';
  const fane = await chrome.tabs.get(tabId).catch(() => null);
  const urlEfter = fane?.url ?? null;
  const kontekstVaek = /Execution context was destroyed|Cannot find context with specified id|Inspected target navigated/i.test(fejl);
  if (!fane || (urlFoer && urlEfter && urlEfter !== urlFoer) || kontekstVaek) {
    return { landed: false, fallbackFired: false, detached: true, navigerede: true };
  }
  return { landed: null, fallbackFired: false, uverificeret: true, fejl };
}

async function debuggerClick(tabId, x, y) {
  await debuggerAttach(tabId);
  // Er museknappen sendt ned, kan klikket vaere landet - saa maa en fejl bagefter ikke fore til et klik til.
  let trykSendt = false;
  try {
    // Adressen foer klikket - et skift bagefter er bevis for en virkning (se tolkManglendeSettle).
    const urlFoer = (await chrome.tabs.get(tabId).catch(() => null))?.url ?? null;
    // 0. Capture the DEEPEST target element under the point BEFORE dispatching.
    //    Web-components (Google Ads <button-panel>, Material Web) keep their real
    //    <button> inside an (open) shadow root, so we pierce shadow roots to reach
    //    it. We stash it on window so the framework fallback (step 3) can verify it
    //    is still connected — if the trusted click already navigated/re-rendered,
    //    the ref is detached and we must NOT re-fire (avoids mis-clicks on the new
    //    view / double-submits).
    await cdpSend(tabId, 'Runtime.evaluate', {
      expression: `(() => {
        let el = document.elementFromPoint(${x}, ${y});
        let host = el;
        for (let i = 0; i < 20 && host && host.shadowRoot; i++) {
          const inner = host.shadowRoot.elementFromPoint(${x}, ${y});
          if (!inner || inner === host) break;
          el = inner; host = inner;
        }
        window.__bmcpClickTarget = el || null;
        // FIX-13: watch whether the trusted click (step 2) actually lands on the target,
        // so step 3's framework-fallback does NOT double-fire on elements that stay
        // connected (toggles, checkboxes, add-to-cart, form fields).
        window.__bmcpClicked = false;
        try { window.__bmcpClickListener && document.removeEventListener('click', window.__bmcpClickListener, true); } catch (e) {}
        window.__bmcpClickListener = (ev) => {
          try {
            const t = ev.target;
            if (el && (t === el || el.contains(t) || (ev.composedPath && ev.composedPath().includes(el)))) {
              window.__bmcpClicked = true;
            }
          } catch (e) {}
        };
        document.addEventListener('click', window.__bmcpClickListener, true);
      })()`,
    });
    // 1. mouseMoved first (triggers hover state, required by some frameworks)
    await dispatchTaalmodigt(tabId, {
      type: 'mouseMoved', x, y,
    });
    await new Promise(r => setTimeout(r, 30));
    // 2. mousePressed + mouseReleased. The `buttons` bitmask (1 while pressed,
    //    0 on release) plus a small press→release gap are REQUIRED for Chrome to
    //    synthesize a *trusted* 'click' from the pair. Without them, web-components
    //    that gate on the trusted click event (Google Ads, Material Web) never fire.
    trykSendt = true;
    // Astra, tredje runde: fejlede mousePressed EFTER at vaere leveret, blev mouseReleased aldrig sendt,
    // og siden stod tilbage med knappen nede (drag-tilstand). Knappen slippes nu altid.
    let trykFejl = null;
    try {
      await dispatchTaalmodigt(tabId, {
        type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
      });
      await new Promise(r => setTimeout(r, 30));
    } catch (e) { trykFejl = e; }
    try {
      await dispatchTaalmodigt(tabId, {
        type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1,
      });
    } catch (e) { trykFejl = trykFejl || e; }
    if (trykFejl) throw trykFejl;
    // 3. Framework fallback — only if the captured target is STILL connected (i.e.
    //    the trusted click in step 2 did not already handle it). Settle delay lets
    //    SPA re-renders (Google Ads) detach the element first. Fires a full pointer
    //    + mouse sequence on the shadow-pierced target, then React/Angular handlers.
    await new Promise(r => setTimeout(r, 120));
    // MAALT 9/9-2026: oprydningen (removeEventListener + delete) laa FOER reserveloesningen
    // fyrede. Derfor kunne intet observere om det syntetiske klik virkede, og udtrykket
    // svarede landed:false som et GAET. Paa en div-baseret dropdown betoed det
    // {ok:true, landed:false} og en menu der aldrig aabnede — issue #19.
    // Nu staar lytteren stadig paa document mens reserveloesningen fyrer, og laeses bagefter:
    // det er forskellen paa en maaling og en antagelse. Der ryddes op paa hver udgang.
    // NB: ingen backticks i udtrykket herunder — det ER et template literal.
    const settle = await evaluerTaalmodigt(tabId, {
      returnByValue: true,
      expression: `(() => {
        const el = window.__bmcpClickTarget;
        const landed = window.__bmcpClicked === true;
        const ryd = () => {
          try { window.__bmcpClickListener && document.removeEventListener('click', window.__bmcpClickListener, true); } catch (e) {}
          try { delete window.__bmcpClickTarget; delete window.__bmcpClicked; delete window.__bmcpClickListener; } catch (e) {}
        };
        // Et billigt fingeraftryk af det et klik plejer at aendre: antal noder, synlig tekst,
        // adressen, og om noget er aabnet/valgt. Bevidst groft — det skal kunne tages to gange
        // paa faa millisekunder, ikke beskrive siden.
        // MAALT 11/9 af Astra (R5 F6): tekst og feltvaerdier blev talt i LAENGDE, saa AAAA -> BBBB var
        // usynlig, og et klik der virkede blev meldt som fejl. Nu hashes indholdet (FNV-1a, 32 bit).
        const hash = (s) => {
          let x = 2166136261;
          for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
          return (x >>> 0).toString(36);
        };
        const aftryk = () => {
          try {
            return document.querySelectorAll('*').length + '|' +
                   hash(document.body ? String(document.body.innerText) : '') + '|' +
                   location.href + '|' +
                   document.querySelectorAll('[aria-expanded="true"],[aria-selected="true"],[open],.open,.active').length + '|' +
                   // Astra, anden runde: en afkrydsning eller en feltvaerdi aendrer hverken noder, tekst eller
                   // adresse - saa et klik der VIRKEDE blev meldt som fejl, og et nyt klik ville fortryde det.
                   document.querySelectorAll('input:checked,option:checked').length + '|' +
                   hash(Array.from(document.querySelectorAll('input,textarea,select')).map((e) => String(e.value || '')).join(' '));
          } catch (e) { return 'aftryk-fejlede'; }
        };
        if (landed) { ryd(); return { landed: true, fallbackFired: false }; }   // FIX-13: trusted click already landed — do NOT double-fire
        if (el === null) { ryd(); return { landed: false, fallbackFired: false, intetMaal: true }; }   // intet element under punktet (fx uden for vinduet) - ingen virkning
        if (!el || !el.isConnected) { ryd(); return { landed: false, fallbackFired: false, detached: true }; }   // already navigated/handled — don't double-fire
        const foerAftryk = aftryk();
        const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: ${x}, clientY: ${y} };
        // Samme moenster som script-klikket (Astra 11/9): en PointerEvent uden pointerType er ikke en mus.
        const mus = { ...opts, pointerType: 'mouse', isPrimary: true, pointerId: 1, button: 0 };
        try { el.dispatchEvent(new PointerEvent('pointerdown', { ...mus, buttons: 1 })); } catch (e) {}
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        try { el.dispatchEvent(new PointerEvent('pointerup', { ...mus, buttons: 0 })); } catch (e) {}
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        // MAALT 10/9 i en rigtig browser: her stod BEGGE — dispatchEvent('click') OG el.click().
        // Det er to klik-haendelser. Paa alt hvad der skifter tilstand (dropdowns, faneblade,
        // afkrydsningsfelter, harmonikaer) aabner det foerste og det andet lukker igen, saa
        // resultatet er intet. Det er aarsagen til at issue #19's div-dropdown "aldrig aabnede":
        // den aabnede og lukkede inde i den samme reserveloesning.
        //   ét klik:  aftryk 11|53|…|0 -> 11|69|…|1   (menuen aaben)
        //   to klik:  aftryk 11|53|…|0 -> 11|53|…|0   (tilbage ved start)
        // el.click() foretraekkes, fordi den ogsaa udloeser elementets aktiverings-adfaerd
        // (foelg link, skift afkrydsning) — det goer en syntetisk MouseEvent ikke paalideligt.
        // MAALT 11/9 af Astra (R5 F5): aftrykket til afgoerelsen herunder var foerAftryk fra FOER mousedown.
        // En ripple-node fra mousedown lignede derfor en virkning af el.click(), React blev sprunget over,
        // og svaret blev landed:true med nul handling. Afgoerelsen maaler nu kun hvad el.click() gjorde.
        const foerKlik = aftryk();
        if (typeof el.click === 'function') el.click();
        else el.dispatchEvent(new MouseEvent('click', opts));

        // MAALT 10/9 af Astra (anden runde): React-fiberens onClick blev kaldt UBETINGET efter el.click() -
        // men el.click() udloeser allerede Reacts handler. To koersler, og en toggle endte hvor den startede.
        // Framework-vejene er til elementer hvor det native klik INGEN virkning gav.
        if (aftryk() === foerKlik) {
          // React fiber fallback — find and call onClick handler directly
          const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
          if (fiberKey) {
            let fiber = el[fiberKey];
            for (let i = 0; i < 10 && fiber; i++) {
              if (fiber.memoizedProps?.onClick) { fiber.memoizedProps.onClick(new MouseEvent('click', {bubbles:true})); break; }
              fiber = fiber.return;
            }
          }

          // Angular Material fallback — ripple + internal handlers
          const ngKey = Object.keys(el).find(k => k.startsWith('__ng'));
          if (ngKey || el.getAttribute('ng-click') || el.getAttribute('(click)')) {
            const matRipple = el.closest && el.closest('[mat-button], [mat-raised-button], [mat-icon-button], [mat-fab], mat-checkbox, mat-slide-toggle, mat-radio-button');
            if (matRipple) matRipple.dispatchEvent(new MouseEvent('click', opts));
          }
        }

        // Lytteren kan IKKE bruges her. Den udloeses af enhver dispatch paa maalet, og
        // reserveloesningen dispatcher netop paa maalet — saa flaget ville vaere sandt fordi
        // VI sendte noget, ikke fordi siden reagerede. Reproduceret 9/9 mod et <div> uden
        // nogen handler: foer=false, efter=true.
        // Derfor maales sidens REAKTION i stedet, med samme aftryks-greb som select_option
        // allerede bruger: aendrede noget sig af det et klik plejer at aendre?
        const efterAftryk = aftryk();
        const reagerede = efterAftryk !== foerAftryk;
        ryd();
        return { landed: reagerede, fallbackFired: true, aftrykFoer: foerAftryk, aftrykEfter: efterAftryk };
      })()`,
    });
    const vaerdi = settle?.result?.value ?? null;

    // MAALT 28/8: uden det her svarede klikket 5,5 sek FOER dialogen var besvaret, saa
    // den NAESTE kommando ramte en stadig frossen side og ventede 15 sek forgaeves.
    // Svarede rendereren ikke, ER der en dialog i vejen — saa vent til den er ude af
    // verden, foer vi melder klikket faerdigt. Sidebonus: kalderen faar en side der
    // rent faktisk er klar til naeste skridt.
    if (vaerdi && vaerdi.rendererSvarede === false) {
      const loefte = dialogLoefter.get(tabId);
      if (loefte) {
        await Promise.race([loefte, new Promise((r) => setTimeout(r, 8000))]);
        dialogLoefter.delete(tabId);
      }
    }
    return vaerdi ?? await tolkManglendeSettle(tabId, settle, urlFoer);
  } catch (e) {
    if (trykSendt && e && typeof e === 'object') e.trykSendt = true;
    throw e;
  } finally {
    await debuggerDetach(tabId);
  }
}

async function debuggerFocus(tabId, selector) {
  await debuggerAttach(tabId);
  try {
    const { root } = await cdpSend(tabId, 'DOM.getDocument', {});
    const { nodeId } = await cdpSend(tabId, 'DOM.querySelector', {
      nodeId: root.nodeId, selector,
    });
    if (!nodeId) throw new Error('Element not found: ' + selector);
    await cdpSend(tabId, 'DOM.focus', { nodeId });
    return nodeId;
  } catch (e) {
    await debuggerDetach(tabId);
    throw e;
  }
}

// Runtime.evaluate that leaves attach state alone. debuggerEval() detaches in its
// finally, which would pull the debugger out from under a fill that is mid-flight.
async function evalAttached(tabId, expression) {
  const result = await cdpSend(tabId, 'Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Script execution failed');
  }
  return result.result?.value;
}

// En tast ned og op igen - og op igen UANSET hvad. MAALT 10/9 af Astra (anden runde): press_key fik
// keyUp-altid i foerste runde, men de tre hjaelpere der ogsaa sender taster gjorde ikke. Timede et
// keyDown ud efter at det VAR landet, forlod hjaelperen funktionen foer sit keyUp, og tasten sad fast
// for siden. Et fastsiddende Cmd goer det naeste tastetryk til en genvej.
async function tastParAttached(tabId, ned, op) {
  let fejl = null;
  try { await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...ned }); } catch (e) { fejl = e; }
  try { await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...op }); } catch (e) { fejl = fejl || e; }
  if (fejl) throw fejl;
}

// Select-all + Backspace. Assumes the debugger is already attached.
async function clearFieldAttached(tabId) {
  await tastParAttached(tabId, { key: 'a', code: 'KeyA', modifiers: SELECT_ALL_MODS }, { key: 'a', code: 'KeyA' });
  await tastParAttached(tabId, { key: 'Backspace', code: 'Backspace' }, { key: 'Backspace', code: 'Backspace' });
}

async function debuggerFill(tabId, selector, value) {
  // Check if element is contenteditable (rich text editors: LinkedIn, Slack)
  const isContentEditable = await debuggerEval(tabId, `
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      return el?.isContentEditable || el?.getAttribute('contenteditable') === 'true';
    })()
  `);

  if (isContentEditable) {
    // Rich text editors (Quill, ProseMirror, Slate, Draft.js) maintain internal
    // state. Key events get ignored. execCommand('insertText') fires proper
    // InputEvent that these editors handle correctly.
    await debuggerEval(tabId, `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        el.focus();
        // Select all existing content and delete it
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        // Insert new text — fires InputEvent with inputType='insertText'
        document.execCommand('insertText', false, ${JSON.stringify(value)});
      })()
    `);
    return;
  }

  // Standard input/textarea — focus, clear, fill
  await debuggerFocus(tabId, selector);
  await debuggerAttach(tabId);
  try {
    await clearFieldAttached(tabId);

    // ── Blev feltet FAKTISK tomt? (MAALT 8/9) ────────────────────────────────
    //
    // `clearFieldAttached` sender Cmd/Ctrl+A og Backspace som aegte tastetryk. Paa et
    // React-styret felt tommer det ikke: maalt paa forbrugeragenten.dk/penge-tilbage gav
    // to fill-kald efter hinanden vaerdien "test@example.dkanden@example.dk" — begge kald
    // svarede ok:true. Vaerktoejet meldte succes og gjorde noget andet end det lovede.
    //
    // Et fill paa et TOMT felt var rent i samme maaling, saa fejlen sidder alene her.
    // Derfor: laes tilbage, og ryd med den vej der virker paa styrede felter hvis
    // tastetrykkene ikke slog igennem. Vi gaetter ikke paa hvorfor — vi tjekker.
    const restVaerdi = await evalAttached(tabId, `
      (function() {
        const el = document.activeElement;
        return el && 'value' in el ? el.value : '';
      })()
    `);
    if (restVaerdi) {
      await evalAttached(tabId, `
        (function() {
          const el = document.activeElement;
          if (!el || !('value' in el)) return false;
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(el, ''); else el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()
      `);
    }

    // Fast path: one trusted InputEvent instead of N key events. This is the same
    // primitive set_combobox and set_date already rely on, it avoids per-key `code`
    // mapping entirely, and it turns a 40-character value from ~3 seconds of
    // keystrokes into a single call — which also shrinks the window in which the
    // debugger can detach mid-fill.
    await cdpSend(tabId, 'Input.insertText', { text: value });

    // Verify something actually landed. Masked inputs, maxlength enforcement and
    // autocompletes that filter per keydown can swallow an inserted string, and
    // until now that failed silently: the caller got "ok" and the field stayed
    // empty. Only an EMPTY field triggers the fallback — a field that transformed
    // the text (phone/date masks reformatting it) did accept the input, and
    // retyping it per character would produce the same transform for no gain.
    const landed = await evalAttached(tabId, `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        return ('value' in el) ? el.value : el.textContent;
      })()
    `);
    if (!landed) {
      await clearFieldAttached(tabId);
      await typeCharsAttached(tabId, value);
    }
  } finally {
    await debuggerDetach(tabId);
  }
}

async function debuggerEval(tabId, expression) {
  await debuggerAttach(tabId);
  try {
    const result = await cdpSend(tabId, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Script execution failed');
    }
    return result.result?.value;
  } finally {
    await debuggerDetach(tabId);
  }
}

// Synthetic click via chrome.scripting — fallback when debugger detaches on
// anti-automation sites (Apple ASC, etc.). Loses isTrusted=true but works for
// the ~95% of sites that don't check it. Handles text= and :text() selectors.
async function scriptingClick(tabId, selector) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel) => {
        let el;
        if (sel.startsWith('text=')) {
          const text = sel.slice(5).trim();
          el = Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], [role="option"], input, label, span, div, p, li, td'))
            .find(e => (e.textContent || '').trim() === text);
        } else {
          const m = sel.match(/^([\w-]+):text\(([^)]+)\)$/);
          if (m) {
            const needle = m[2].trim();
            el = Array.from(document.querySelectorAll(m[1]))
              .find(e => (e.textContent || '').trim().includes(needle));
          } else {
            el = document.querySelector(sel);
          }
        }
        if (!el) return { ok: false, reason: 'not_found' };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        // Sign-off 11/9 (Astra og Fable, begge reproduceret): paa en baggrundsfane blev et klik der krævede isTrusted,
        // eller kun lyttede paa pointerdown, meldt ok:true uden nogen virkning. Klikket maaler nu sidens reaktion med
        // samme aftryk og samme regel som debuggerens reserve (debuggerClick) - ingen backticks herinde.
        const hash = (s) => {
          let x = 2166136261;
          for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
          return (x >>> 0).toString(36);
        };
        const aftryk = () => {
          try {
            return document.querySelectorAll('*').length + '|' +
                   hash(document.body ? String(document.body.innerText) : '') + '|' +
                   location.href + '|' +
                   document.querySelectorAll('[aria-expanded="true"],[aria-selected="true"],[open],.open,.active').length + '|' +
                   document.querySelectorAll('input:checked,option:checked').length + '|' +
                   hash(Array.from(document.querySelectorAll('input,textarea,select')).map((e) => String(e.value || '')).join(' '));
          } catch (e) { return 'aftryk-fejlede'; }
        };
        const opts = { bubbles: true, cancelable: true, composed: true, view: window };
        // Et rigtigt klik sender pointerdown foer mousedown; Radix/shadcn aabner paa pointerdown.
        // MAALT 11/9 af Astra (efterproevning af 9814636): uden pointerType ("") handlede en side der reagerer paa ikke-mus-
        // pointere OG paa click to gange. En rigtig mus sender pointerType "mouse".
        const mus = { ...opts, pointerType: 'mouse', isPrimary: true, pointerId: 1, button: 0 };
        try { el.dispatchEvent(new PointerEvent('pointerdown', { ...mus, buttons: 1 })); } catch (e) {}
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        try { el.dispatchEvent(new PointerEvent('pointerup', { ...mus, buttons: 0 })); } catch (e) {}
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        // Aftrykket tages lige foer el.click(). MAALT 11/9 af Astra (e2e-review): taget foer mousedown blev en ripple klikbevis
        // (ok:true, nul handlinger; 1.29.0: fejl). En side der reagerer paa pointerdown, bliver derfor aerligt uvist.
        const foer = aftryk();
        el.click();
        // Maales i samme oejeblik som klikket. Astra (efterproevning af c1496d4): en anden maaling 200 ms senere gjorde et
        // uafhaengigt ur til klikbevis og et klik der navigerede i ventetiden til en fejl. En sen React-opdatering giver
        // derfor landed:false og maaske_landet - aerligt, aldrig en falsk succes.
        return { ok: true, tag: el.tagName, landed: aftryk() !== foer, detached: el.isConnected === false };
      },
      args: [selector],
    });
    return result?.result || { ok: false, reason: 'no_result' };
  } catch (e) {
    return { ok: false, reason: 'exception', error: e.message };
  }
}

// Try executeScript first, fall back to debugger on CSP error
async function safeExecuteScript(tabId, func, args = [], world = 'MAIN') {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args,
      ...(world === 'MAIN' ? { world: 'MAIN' } : {}),
    });
    return { result: result.result, usedDebugger: false };
  } catch (e) {
    if (e.message?.includes('Content Security Policy') || e.message?.includes('unsafe-eval')) {
      // CSP blocked — this is expected on Google, Stripe, Slack
      return { cspBlocked: true };
    }
    throw e;
  }
}

// ── Smart Selector Resolution ─────────────────────────────────────────────
// Supports CSS selectors AND text-based selectors:
//   "button:text(Get started)" → finds button containing "Get started"
//   "#my-id" → standard CSS selector
//   "text=Submit" → any element containing "Submit"

function buildTextFinderJS(textPattern, tagFilter) {
  const escaped = JSON.stringify(textPattern);
  const wantTag = tagFilter ? JSON.stringify(tagFilter.toUpperCase()) : 'null';
  return `(function() {
    const text = ${escaped};
    const wantTag = ${wantTag};
    // Interactive controls we prefer to actually click. Fixes the class of bug where a
    // text match lands on a large CONTAINER (e.g. Angular Material <mat-nav-list>,
    // toolbar, list-item) whose center is NOT over the real <button> — so the trusted
    // click misses and menus/dropdowns never open.
    const CLICKABLE = 'a,button,summary,label,[role="button"],[role="menuitem"],' +
      '[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"],[role="tab"],' +
      '[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[onclick],' +
      '[mat-button],[mat-raised-button],[mat-stroked-button],[mat-flat-button],' +
      '[mat-icon-button],[mat-fab],[mat-mini-fab],[mat-menu-item],[mat-list-item],' +
      'mat-checkbox,mat-slide-toggle,mat-radio-button';
    function collectAll(root, results) {
      for (const el of root.querySelectorAll('*')) {
        results.push(el);
        if (el.shadowRoot) collectAll(el.shadowRoot, results);
      }
      return results;
    }
    const all = collectAll(document, []);
    const tagOk = (el) => !wantTag || el.tagName === wantTag;
    // Map a matched element to the ACTIONABLE control: itself if clickable, else the
    // nearest clickable ancestor (only if its own text isn't much larger than the match,
    // so we don't grab a whole toolbar), else a clickable descendant.
    function toClickable(el) {
      if (el.matches && el.matches(CLICKABLE)) return el;
      const anc = el.closest && el.closest(CLICKABLE);
      if (anc && (anc.textContent || '').trim().length <= text.length + 40) return anc;
      const desc = el.querySelector && el.querySelector(CLICKABLE);
      if (desc) return desc;
      return el;
    }
    function pick(test) {
      const matches = all.filter(el => tagOk(el) && test((el.textContent || '').trim()));
      if (!matches.length) return null;
      // Prefer the INNERMOST matches (an element that is not an ancestor of another
      // match) — this is what "prefer leaf nodes" was supposed to do.
      const inner = matches.filter(el => !matches.some(o => o !== el && el.contains && el.contains(o)));
      const pool = inner.length ? inner : matches;
      // Prefer a match that resolves to a real interactive control.
      for (const el of pool) {
        const c = toClickable(el);
        if (c && c.matches && c.matches(CLICKABLE)) return c;
      }
      return toClickable(pool[0]);
    }
    // Exact match first, then partial fallback.
    return pick(t => t === text) || pick(t => t && t.includes(text));
  })()`;
}

function parseSelector(selector) {
  // "button:text(Get started)" → { tag: 'button', text: 'Get started' }
  const tagTextMatch = selector.match(/^(\w+):text\((.+)\)$/);
  if (tagTextMatch) return { type: 'text', tag: tagTextMatch[1], text: tagTextMatch[2] };

  // "text=Submit" → { text: 'Submit' }
  if (selector.startsWith('text=')) return { type: 'text', tag: null, text: selector.slice(5) };

  // Standard CSS selector
  return { type: 'css', selector };
}

async function resolveElement(tabId, selectorStr) {
  const parsed = parseSelector(selectorStr);

  if (parsed.type === 'css') {
    // Standard CSS with shadow DOM traversal — try executeScript first, debugger fallback
    const deepQueryFn = (sel) => {
      function queryDeep(root, s) {
        const el = root.querySelector(s);
        if (el) return el;
        for (const node of root.querySelectorAll('*')) {
          if (node.shadowRoot) {
            const found = queryDeep(node.shadowRoot, s);
            if (found) return found;
          }
        }
        return null;
      }
      const el = queryDeep(document, sel);
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      // MAALT 21/8: et skjult element har rect 0x0 ved (0,0), saa midtpunktet blev (0,0)
      // og debuggerClick sendte et AEGTE museklik i sidens oeverste venstre hjoerne —
      // paa hvad der nu laa der (logo, menu, link) — og svarede ok:true. Det er ikke en
      // rapporteringsfejl men en handlingsfejl: vi klikker et andet sted end der blev bedt om.
      if (r.width <= 0 || r.height <= 0) {
        return { found: false, hidden: true, tag: el.tagName, rect: { w: r.width, h: r.height } };
      }
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName, found: true };
    };

    const scriptResult = await safeExecuteScript(tabId, deepQueryFn, [parsed.selector]);

    if (scriptResult.cspBlocked) {
      const sel = JSON.stringify(parsed.selector);
      const result = await debuggerEval(tabId, `
        (function() {
          function queryDeep(root, s) {
            const el = root.querySelector(s);
            if (el) return el;
            for (const node of root.querySelectorAll('*')) {
              if (node.shadowRoot) { const f = queryDeep(node.shadowRoot, s); if (f) return f; }
            }
            return null;
          }
          const el = queryDeep(document, ${sel});
          if (!el) return null;
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) {
            return { found: false, hidden: true, tag: el.tagName, rect: { w: r.width, h: r.height } };
          }
          return { x: r.x + r.width/2, y: r.y + r.height/2, tag: el.tagName, found: true };
        })()
      `);
      return result ? { ...result, method: 'debugger' } : null;
    }
    return scriptResult.result;
  }

  // Text-based selector — always use debugger (more reliable, no CSP issues)
  const finderJS = buildTextFinderJS(parsed.text, parsed.tag);
  const result = await debuggerEval(tabId, `
    (function() {
      const el = ${finderJS};
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) {
        return { found: false, hidden: true, tag: el.tagName, text: el.textContent?.trim().slice(0, 80), rect: { w: r.width, h: r.height } };
      }
      return { x: r.x + r.width/2, y: r.y + r.height/2, tag: el.tagName, text: el.textContent?.trim().slice(0, 80), found: true };
    })()
  `);
  return result ? { ...result, method: 'debugger' } : null;
}

// ── Offscreen Document Setup ───────────────────────────────────────────────

// MAALT 21/8: her stod kun `if (!await chrome.offscreen.hasDocument()) createDocument()`.
// Den spurgte om dokumentet FANDTES — aldrig om det SVAREDE. Et dokument hvis script
// aldrig blev indlaest (en CSP-afvisning raekker) taeller stadig som eksisterende, saa
// hjerteslaget hvert minut gjorde ingenting, for evigt. Udvidelsen saa levende ud i
// chrome://extensions, men havde ingen WebSocket og kunne ikke naas af noget — heller
// ikke af reload_extension, som netop kraever den forbindelse den mangler. Eneste vej
// ud var ↻ i haanden.
//
// Nu spoerges dokumentet om det er der. Svarer det ikke, erstattes det.
async function offscreenSvarer() {
  try {
    const svar = await Promise.race([
      chrome.runtime.sendMessage({ type: 'bmcp_ping' }),
      new Promise((_, afvis) => setTimeout(() => afvis(new Error('intet svar')), 1500)),
    ]);
    if (svar?.ok !== true) return false;
    // "Svarer den?" er ikke nok — den skal ogsaa vaere den udgave vi koerer nu.
    // En bro fra en aeldre udgave svarer lige saa villigt, og saa blev den aldrig
    // udskiftet. Oplyser den ingen version, er den fra foer 1.27.1 og altsaa gammel.
    let vores = null;
    try { vores = chrome.runtime.getManifest().version; } catch {}
    if (!vores) return true;                       // kan vi ikke sammenligne, saa lad den vaere
    return svar.version === vores;
  } catch {
    return false;   // ingen modtager, eller den svarede ikke i tide
  }
}

// Genskabelsen er BEGRAENSET, og det er ikke pynt.
//
// "Svarer ikke" betyder ikke altid "doed". En AELDRE offscreen.js — fra foer
// ping-lytteren fandtes — svarer heller ikke, og Chrome kan servere den fra cache
// hen over en genindlaesning (maalt 21/8). Uden en graense ville hjerteslaget saa
// lukke og genskabe en fuldt fungerende bro hvert minut, for evigt, og rive
// WebSocket-forbindelsen ned hver gang. Kuren ville vaere vaerre end sygdommen.
//
// Derfor: hoejst tre forsoeg i traek. Er dokumentet aegte doedt, er ét nok. Er det
// bare gammelt, koster det tre korte afbrydelser og saa faar det fred et stykke tid.
//
// MAALT 22/8 — og det var en fejl i denne blok: graensen var PERMANENT. Naaede
// taelleren tre, blev der aldrig forsoegt igen, og taelleren nulstilles kun naar en
// ping lykkes — hvilket en doed bro pr. definition aldrig goer. Resultatet var en
// doed bro der laa doed for evigt, hvor symptomet for brugeren er "browser-mcp
// virker ikke", og hvor den eneste udvej var at genindlaese udvidelsen i haanden.
// Praecis den tilstand vaernet skulle forhindre.
//
// Rettelsen: graensen er nu tidsbestemt, ikke endelig. Efter tre forsoeg holder vi
// pause — og naar pausen er ovre, proever vi igen. En gammel-men-fungerende bro
// faar altsaa ro i pausen i stedet for at blive revet ned hvert minut, og en aegte
// doed bro er hoejst én pause fra at blive erstattet. Begge hensyn er i behold.
const MAX_OFFSCREEN_GENSKAB = 3;
const OFFSCREEN_PAUSE_MS = 10 * 60 * 1000;

async function ensureOffscreen() {
  const findes = await chrome.offscreen.hasDocument();

  if (findes) {
    if (await offscreenSvarer()) {
      await chrome.storage.local.set({ offscreenGenskabt: 0 });   // levende — nulstil
      return;
    }
    // Taelleren skal ligge i storage, ikke i en modul-variabel: service-workeren
    // genstartes hele tiden, og en variabel ville nulstilles ved hver genstart —
    // altsaa ingen graense i praksis.
    let { offscreenGenskabt = 0 } =
      await chrome.storage.local.get({ offscreenGenskabt: 0, offscreenPauseTil: 0 });
    const { offscreenPauseTil = 0 } =
      await chrome.storage.local.get({ offscreenPauseTil: 0 });

    const nu = Date.now();
    if (offscreenPauseTil > nu) return;            // midt i pausen — lad broen vaere

    if (offscreenPauseTil > 0) {
      // Pausen er udloebet. Taelleren SKAL nulstilles her, foer graensen tjekkes —
      // ellers rammer vi graensen igen med det samme, saetter endnu en pause, og
      // graensen er i praksis permanent alligevel, bare med et ekstra skridt.
      // (Maalt 22/8: det var praecis den fejl den foerste udgave af rettelsen havde.
      // Testen "naar pausen er ovre, proeves der igen" fangede den.)
      offscreenGenskabt = 0;
      await chrome.storage.local.set({ offscreenGenskabt: 0, offscreenPauseTil: 0 });
    }

    if (offscreenGenskabt >= MAX_OFFSCREEN_GENSKAB) {
      // Pause i stedet for at give op. Taelleren nulstilles samtidig, saa naeste
      // runde faar sine egne tre forsoeg — ellers ville graensen vaere permanent
      // alligevel, bare med et ekstra skridt.
      console.warn(`[BG] offscreen-dokumentet svarer stadig ikke efter ${MAX_OFFSCREEN_GENSKAB} ` +
        `forsoeg — holder pause i ${OFFSCREEN_PAUSE_MS / 60000} min og proever saa igen. ` +
        'Haster det: chrome://extensions → slaa udvidelsen fra og til.');
      await chrome.storage.local.set({ offscreenGenskabt: 0, offscreenPauseTil: nu + OFFSCREEN_PAUSE_MS });
      return;
    }
    console.warn(`[BG] offscreen-dokumentet svarer ikke — erstatter det (forsoeg ${offscreenGenskabt + 1}/${MAX_OFFSCREEN_GENSKAB})`);
    await chrome.storage.local.set({ offscreenGenskabt: offscreenGenskabt + 1 });
    try { await chrome.offscreen.closeDocument(); } catch (e) {
      console.warn('[BG] kunne ikke lukke det doede dokument:', e?.message || e);
      return;                                      // proev igen ved naeste hjerteslag
    }
  }

  // Versionen foelger med i URL'en. Et offscreen-dokument har IKKE
  // chrome.runtime.getManifest() — kaldet kaster "is not a function", saa dokumentet
  // kunne aldrig oplyse sin version, `offscreenSvarer()` sammenlignede null mod vores
  // og fik altid falsk, og broen blev revet ned tre gange hvert tiende minut for evigt.
  // (Symptomet var "Offscreen document closed before fully loading" — nedrivningen
  // ramte dokumentet mens det stadig startede op.)
  // URL'en er baaret af dokumentet selv: et dokument oprettet af en aeldre udgave
  // baerer den aeldre version, hvilket er praecis den skelnen tjekket skal bruge.
  let minVersion = '';
  try { minVersion = chrome.runtime.getManifest().version; } catch {}
  await chrome.offscreen.createDocument({
    url: 'offscreen.html' + (minVersion ? '?v=' + encodeURIComponent(minVersion) : ''),
    reasons: ['WORKERS'],
    justification: 'Maintain persistent WebSocket connection to local MCP server',
  });
}

// ── Action Logging ─────────────────────────────────────────────────────────

const SENSITIVE = new Set(['get_cookies', 'get_local_storage', 'execute_script', 'extract_token']);

// MAALT 11/9 (Astra, efterproevet): her stod `params: JSON.stringify(params).slice(0, 200)`.
// De foerste 200 tegn af ALLE parametre — ogsaa vaerdien til fill (adgangskoder), cookie-
// vaerdier og adresser med login-tokens — laa i klartekst i chrome.storage.local. Popuppen
// viser kun tid, vaerktoej og session, saa parametrene tjente intet. De gemmes ikke laengere,
// og poster gemt af aeldre udgaver renses ved opdatering (rensHandlingslog i onInstalled).
async function logAction(port, method) {
  const category = SENSITIVE.has(method) ? 'sensitive' : 'safe';
  const session = sessions.get(port);
  const entry = {
    time: Date.now(),
    method,
    category,
    session: session?.label || `Port ${port}`,
    color: session?.color || 'grey',
  };
  try {
    const { actionLog = [] } = await chrome.storage.local.get({ actionLog: [] });
    // MAALT 11/9 af Astra (e2e-review): et logAction der koerte samtidig med rensHandlingslog i onInstalled, havde laest den
    // gamle log foer oprydningen skrev - og skrev saa den gamle adgangskode tilbage. Hver skrivning renser derfor selv.
    const renset = (Array.isArray(actionLog) ? actionLog : []).filter(Boolean).map(({ params, ...resten }) => resten);
    renset.unshift(entry);
    if (renset.length > 50) renset.length = 50;
    await chrome.storage.local.set({ actionLog: renset });
  } catch (e) {
    console.warn('[BG] handlingslog kunne ikke skrives:', e?.message || e);
  }
}

async function rensHandlingslog() {
  try {
    const { actionLog } = await chrome.storage.local.get({ actionLog: [] });
    if (!Array.isArray(actionLog) || !actionLog.some((p) => p && 'params' in p)) return;
    await chrome.storage.local.set({ actionLog: actionLog.map(({ params, ...resten }) => resten) });
  } catch (e) {
    console.warn('[BG] gammel handlingslog kunne ikke renses:', e?.message || e);
  }
}

// ── Message Handler — receives commands from offscreen.js ──────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'mcp_command') {
    const port = msg.port;
    logAction(port, msg.method);
    // Restore sessions from storage (service worker may have restarted), then take over any
    // session orphaned by an unclean disconnect so navigate→click keeps hitting the same tab.
    restoreSessions()
      .then(() => adoptOrphanedSession(port, msg.pid).catch(() => null)) // adoption is best-effort, never fatal
      .then(() => {
        // Stempl pid'en ÉT sted, foer dispatch. De fem nedstroems getSession(port)-kald
        // arver den derfra, saa ingen af dem behoever at kende til pid-begrebet.
        getSession(port, msg.pid);
        dispatch(port, msg.method, msg.params)
          .then(result => sendResponse(result))
          .catch(err => sendResponse({ __error: err.message || String(err) }));
      })
      .catch(err => sendResponse({ __error: err.message || String(err) })); // else a storage-restore reject hangs the caller
    return true; // async response
  }

  if (msg.type === 'session_disconnect') {
    releaseSession(msg.port);
    return;
  }

  if (msg.type === 'reconnect') {
    // FEJL RETTET 19/8: der var ingen fangst her. Lykkedes closeDocument()
    // men fejlede ensureOffscreen() — fx fordi dokumentet stadig var ved at
    // lukke — blev afvisningen slugt, og extensionen stod tilbage UDEN
    // offscreen-dokument. Ingen WebSocket, ingen genopretning, og kun en
    // manuel genindlaesning kunne redde den.
    (async () => {
      try {
        if (await chrome.offscreen.hasDocument()) {
          await chrome.offscreen.closeDocument();
        }
      } catch (e) {
        console.warn('[BG] kunne ikke lukke offscreen:', e?.message || e);
      }
      // Proev at genskabe. Fejler det, tager hjerteslags-alarmen den
      // inden for et minut — men kun fordi vi IKKE lader fejlen forsvinde.
      try {
        await ensureOffscreen();
      } catch (e) {
        console.error('[BG] kunne ikke genskabe offscreen:', e?.message || e);
        setTimeout(() => ensureOffscreen().catch(console.error), 2000);
      }
    })();
    return;
  }

  if (msg.type === 'ws_status') {
    const count = msg.count || (msg.connected ? 1 : 0);
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    if (count > 0) {
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    }
    chrome.storage.local.set({
      mcpConnected: msg.connected,
      mcpCount: count,
      mcpPorts: msg.ports || [],
    });
    return;
  }
});

// ── OAuth Popup Interception ─────────────────────────────────────────────────

const OAUTH_DOMAINS = ['accounts.google.com', 'login.microsoftonline.com', 'github.com/login/oauth', 'slack.com/oauth', 'app.hubspot.com/oauth'];

// MAALT 10/9, reproduceret i selen: her stod kun `lastCreatedTabId = tab.id` — sat paa
// HVER onCreated, ogsaa naar brugeren selv trykker Cmd+T eller aabner sin netbank.
// `get_new_tab` adopterede den saa ind i agentens session, hvorefter skaermbillede,
// sidetekst og localStorage af BRUGERENS fane var lovligt. Reproduktionen: bruger aabner
// brugerens-netbank.example -> get_new_tab svarer med den -> fanen staar i tabIds.
//
// En ny fane hoerer til en session naar den er aabnet FRA en af dens faner (klik paa et
// link med target=_blank, en OAuth-popup). Det staar i openerTabId. Er der ingen opener,
// var det brugeren, og saa er den ikke vores.
let lastCreatedTabId = null;
// Aabneren huskes PR. FANE. En global "seneste aabner" blev 10/9 (Astra, reproduceret) laant af
// den forkerte fane, naar to faner blev aabnet mens get_new_tab ventede paa tabs.get.
const openerForFane = new Map();
// MAALT 11/9 af Astra (R5 F9), reproduceret: fane 1 aabner en popup og lukkes derefter (typisk
// "log ind i nyt vindue"). get_new_tab slog aabneren op i sessionens faner NU, hvor 1 var vaek,
// og svarede not-ours paa sessionens egen popup. Ejeren huskes derfor i det oejeblik fanen
// oprettes, hvor aabneren stadig staar i sin session.
const ejerForFane = new Map();

chrome.tabs.onCreated.addListener(async (tab) => {
  lastCreatedTabId = tab.id;
  openerForFane.set(tab.id, tab.openerTabId ?? null);
  if (openerForFane.size > 500) openerForFane.delete(openerForFane.keys().next().value);
  let ejer = null;
  if (tab.openerTabId != null) {
    for (const [p, s] of sessions) { if (s.tabIds.has(tab.openerTabId)) { ejer = p; break; } }
  }
  ejerForFane.set(tab.id, ejer);
  if (ejerForFane.size > 500) ejerForFane.delete(ejerForFane.keys().next().value);

  // Auto-claim OAuth popups for the session that opened them
  if (tab.pendingUrl || tab.url) {
    const url = tab.pendingUrl || tab.url;
    const isOAuth = OAUTH_DOMAINS.some(d => url.includes(d));
    if (isOAuth) {
      for (const [port, session] of sessions) {
        if (tab.openerTabId && session.tabIds.has(tab.openerTabId)) {
          await addTabToSession(port, tab.id);
          session.activeTabId = tab.id;
          persistSessions();
          break;
        }
      }
    }
  }
});

// ── Deep Shadow DOM Query ────────────────────────────────────────────────────
// querySelectorDeep: finds elements inside shadow DOMs (Shopify, Salesforce, etc.)

function buildDeepQueryJS(selector) {
  return `(function() {
    function queryDeep(root, sel) {
      const el = root.querySelector(sel);
      if (el) return el;
      for (const node of root.querySelectorAll('*')) {
        if (node.shadowRoot) {
          const found = queryDeep(node.shadowRoot, sel);
          if (found) return found;
        }
      }
      return null;
    }
    return queryDeep(document, ${JSON.stringify(selector)});
  })()`;
}

// ── Date Input Helpers ──────────────────────────────────────────────────────

const MONTHS_EN = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTHS_DA = ['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
const MONTHS_ABBR_EN = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function parsePlaceholderFormat(placeholder) {
  if (!placeholder) return null;
  const upper = placeholder.toUpperCase();
  let sep = null;
  if (upper.includes('/')) sep = '/';
  else if (upper.includes('-')) sep = '-';
  else if (upper.includes('.')) sep = '.';
  else return null;
  const parts = upper.split(sep);
  if (parts.length !== 3) return null;
  const order = parts.map(p => p.includes('Y') ? 'Y' : p.includes('M') ? 'M' : p.includes('D') ? 'D' : null);
  if (order.includes(null) || new Set(order).size !== 3) return null;
  const padded = parts.map(p => p.length >= 2);
  // Fjerde runde: YY og YYYY skal kunne skelnes, ellers skrives "2026" i et felt der kun tager to cifre.
  const lengths = parts.map(p => p.length);
  return { sep, order, padded, lengths };
}

function isoToFormat(iso, fmt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error('Invalid ISO date: ' + iso);
  const [, y, mo, d] = m;
  return fmt.order.map((slot, i) => {
    if (slot === 'Y') return fmt.lengths && fmt.lengths[i] === 2 ? y.slice(2) : y;
    if (slot === 'M') return fmt.padded[i] ? mo : String(parseInt(mo, 10));
    if (slot === 'D') return fmt.padded[i] ? d : String(parseInt(d, 10));
  }).join(fmt.sep);
}

function parseMonthYearText(text) {
  if (!text) return null;
  const cleaned = text.toLowerCase().trim();
  const tables = [MONTHS_EN, MONTHS_DA, MONTHS_ABBR_EN];
  for (const table of tables) {
    for (let i = 0; i < table.length; i++) {
      if (cleaned.includes(table[i])) {
        const ym = cleaned.match(/(\d{4})/);
        if (ym) return { year: parseInt(ym[1], 10), month: i + 1 };
      }
    }
  }
  const num = cleaned.match(/(\d{1,2})[\/\-\s.](\d{4})/);
  if (num) return { year: parseInt(num[2], 10), month: parseInt(num[1], 10) };
  return null;
}

function valueLooksLikeIso(raaVaerdi, iso, fmt) {
  if (!raaVaerdi || !iso) return false;
  const [y, m, d] = iso.split('-');
  const Y = Number(y), M = Number(m), D = Number(d);
  // Fjerde runde: en aflaesning der BEGYNDER med den oenskede ISO-dato (fx "2026-01-02T12:00:00") er den dato,
  // uanset hvilket format placeholderen lover - ellers blev en korrekt dato afvist og kalenderen proevet oveni.
  if (raaVaerdi.trim().startsWith(iso) && !/\d/.test(raaVaerdi.trim().charAt(iso.length))) return true;
  // MAALT 11/9 af Astra (R5): klokkeslaet og tidszone er ikke en del af datoen. F2: "02/01 20:26" gav timen 20
  // som aaret 2020 og ok:true. F3: "02/01/2026 12:00 GMT" blev afvist af bogstavkontrollen paa "GMT", og
  // kalenderen blev proevet oveni. Begge fjernes foer datoen laeses.
  const value = raaVaerdi
    .replace(/\b\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(\s*[ap]\.?m\.?)?(?![\d:])/gi, ' ')
    .replace(/\b(GMT|UTC|UT|CET|CEST|EET|EEST|WET|WEST|BST|EST|EDT|CST|CDT|MST|MDT|PST|PDT)\b([+-]\d{1,2}(:?\d{2})?)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return false;
  // Astra, anden runde: tre `value.includes(...)` hver for sig godkendte "20/12/2026" som 2026-01-02.
  // Tredje runde: tre `digits.includes(...)` koerte stadig FOER kontrollen af hele tal, saa
  // "2026-1-1 02:00" blev 2026-11-02. Nu sammenlignes cifre som én streng KUN naar vaerdien udelukkende
  // ER otte cifre - og med kendt format kun i formatets raekkefoelge ("01/12/2026" under DD/MM/YYYY er
  // 1. december, ikke 12. januar).
  const ordener = fmt?.order ? [fmt.order] : [['Y', 'M', 'D'], ['D', 'M', 'Y'], ['M', 'D', 'Y']];
  const del = { Y: y, M: m, D: d };
  if (/^\s*\d{8}\s*$/.test(value)) {
    const cifre = value.trim();
    return ordener.some((o) => o.map((slot) => del[slot]).join('') === cifre);
  }
  // Hele tal fra vaerdiens START - et klokkeslaet bagefter maa ikke levere dag eller maaned.
  const tok = value.match(/\d+/g) || [];
  const passer = (slot, s) => {
    if (s === undefined) return false;
    if (slot === 'Y') return (s.length === 4 && Number(s) === Y) || (s.length === 2 && Number(s) === Y % 100);
    return s.length <= 2 && Number(s) === (slot === 'M' ? M : D);
  };
  // Fjerde runde: rene tal kun naar vaerdien ingen bogstaver har - i "2 Jan 26 05:00" blev timen ellers et aarstal.
  if (!/\p{L}/u.test(value) && ordener.some((o) => o.every((slot, i) => passer(slot, tok[i])))) return true;
  // Maanedsnavn ("2 Jan 2026", "2. maj 2026", "Jan 2, 2026"): dagen skal staa lige foer eller lige efter navnet.
  const navne = [/jan/, /feb/, /mar/, /apr/, /ma[iyj]/, /jun/, /jul/, /aug/, /sep/, /o[ck]t/, /nov/, /de[cz]/];
  const navn = navne[M - 1];
  if (navn) {
    const lav = value.toLowerCase();
    const n = navn.source;
    const foer = new RegExp('^\\s*(\\d{1,2})\\.?\\s+' + n + '[a-zæøå]*\\.?,?\\s+(\\d{4})(?!\\d)').exec(lav);
    const efter = new RegExp('^\\s*' + n + '[a-zæøå]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})(?!\\d)').exec(lav);
    for (const r of [foer, efter]) if (r && Number(r[1]) === D && Number(r[2]) === Y) return true;
  }
  return false;
}

async function getDateInputInfo(tabId, selector) {
  const json = await debuggerEval(tabId, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return JSON.stringify({ found: false });
    return JSON.stringify({
      found: true,
      tag: el.tagName,
      inputType: (el.type || '').toLowerCase(),
      readOnly: !!el.readOnly,
      disabled: !!el.disabled,
      placeholder: el.placeholder || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      value: el.value !== undefined ? el.value : (el.textContent || ''),
    });
  })()`);
  return JSON.parse(json);
}

async function readBackValue(tabId, selector) {
  const json = await debuggerEval(tabId, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return JSON.stringify({ value: null });
    return JSON.stringify({ value: el.value !== undefined ? el.value : (el.textContent || '') });
  })()`);
  return JSON.parse(json).value;
}

async function setDateNative(tabId, selector, iso) {
  const r = await safeExecuteScript(tabId, (sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, error: 'not-found' };
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.focus();
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, val); else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return { ok: true, value: el.value };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, [selector, iso]);
  if (r.cspBlocked) {
    await debuggerEval(tabId, `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(iso)}); else el.value = ${JSON.stringify(iso)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    })()`);
    return { ok: true, csp: true };
  }
  return r.result || { ok: false, error: 'no-result' };
}

async function setDateMaskedTyping(tabId, selector, iso, format) {
  const formatted = isoToFormat(iso, format);
  await debuggerFocus(tabId, selector);
  await debuggerAttach(tabId);
  try {
    await clearFieldAttached(tabId);
    await cdpSend(tabId, 'Input.insertText', { text: formatted });
    await tastParAttached(tabId, { key: 'Tab', code: 'Tab' }, { key: 'Tab', code: 'Tab' });
  } finally {
    await debuggerDetach(tabId);
  }
  return { ok: true, formatted };
}

const PICKER_OPEN_SELECTORS = [
  '[role="dialog"] [role="grid"]',
  '[role="dialog"] [role="gridcell"]',
  '.react-datepicker',
  '.MuiPickersPopper-root',
  '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
  '[class*="DayPicker"]:not(input)',
  '[class*="Calendar"][class*="open" i]',
];

async function isPickerOpen(tabId) {
  return await debuggerEval(tabId, `(() => {
    const sels = ${JSON.stringify(PICKER_OPEN_SELECTORS)};
    for (const s of sels) {
      try { if (document.querySelector(s)) return true; } catch {}
    }
    return false;
  })()`);
}

async function setDatePicker(tabId, selector, iso) {
  const [yStr, mStr, dStr] = iso.split('-');
  const targetYear = parseInt(yStr, 10);
  const targetMonth = parseInt(mStr, 10);
  const targetDay = parseInt(dStr, 10);

  const inputEl = await resolveElement(tabId, selector);
  if (!inputEl) return { ok: false, error: 'input-not-found' };
  await debuggerClick(tabId, inputEl.x, inputEl.y);

  let opened = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (await isPickerOpen(tabId)) { opened = true; break; }
  }

  if (!opened) {
    const triggerClicked = await safeExecuteScript(tabId, (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const candidates = [
        ...(el.parentElement?.querySelectorAll('button, [role="button"], [aria-haspopup]') || []),
        ...(el.parentElement?.parentElement?.querySelectorAll('button, [role="button"], [aria-haspopup]') || []),
      ];
      for (const c of candidates) {
        const label = (c.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('calendar') || label.includes('date') || label.includes('vælg dato') || label.includes('open') || label.includes('åbn')) {
          c.click();
          return true;
        }
      }
      for (const c of candidates) {
        if (c.querySelector('svg, [class*="calendar" i]')) {
          c.click();
          return true;
        }
      }
      return false;
    }, [selector]);
    if (triggerClicked.result) {
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (await isPickerOpen(tabId)) { opened = true; break; }
      }
    }
  }

  if (!opened) return { ok: false, error: 'picker-did-not-open' };

  const MAX_NAV = 36;
  let navAttempts = 0;
  let lastHeader = null;
  let stuck = 0;
  let navExitReason = 'reached-target';
  let lastReachedMonthYear = null;
  for (let i = 0; i < MAX_NAV; i++) {
    const headerJson = await debuggerEval(tabId, `(() => {
      const roots = [
        document.querySelector('[role="dialog"]'),
        document.querySelector('.react-datepicker'),
        document.querySelector('.MuiPickersPopper-root'),
        document.querySelector('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)'),
      ].filter(Boolean);
      for (const root of roots) {
        const candidates = [
          root.querySelector('[role="heading"]'),
          root.querySelector('[aria-live]'),
          root.querySelector('.MuiPickersCalendarHeader-label'),
          root.querySelector('.react-datepicker__current-month'),
          root.querySelector('.ant-picker-header-view'),
        ].filter(Boolean);
        for (const el of candidates) {
          const t = (el.textContent || '').trim();
          if (t.length > 0 && t.length < 80) return JSON.stringify({ text: t });
        }
      }
      return JSON.stringify({});
    })()`);
    const header = JSON.parse(headerJson);
    const parsed = parseMonthYearText(header.text || '');
    if (!parsed) {
      navExitReason = header.text ? 'header-parse-failed' : 'no-header-found';
      break;
    }
    lastReachedMonthYear = `${parsed.year}-${String(parsed.month).padStart(2, '0')}`;

    if (header.text === lastHeader) {
      stuck++;
      if (stuck >= 3) { navExitReason = 'navigation-stuck'; break; }
    } else {
      stuck = 0;
      lastHeader = header.text;
    }

    const delta = (targetYear * 12 + targetMonth) - (parsed.year * 12 + parsed.month);
    if (delta === 0) break;
    if (i === MAX_NAV - 1) {
      navExitReason = 'max-nav-exceeded';
    }

    const dir = delta > 0 ? 'next' : 'prev';
    const navClicked = await safeExecuteScript(tabId, (direction) => {
      const roots = [
        document.querySelector('[role="dialog"]'),
        document.querySelector('.react-datepicker'),
        document.querySelector('.MuiPickersPopper-root'),
        document.querySelector('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)'),
      ].filter(Boolean);
      const labels = direction === 'next'
        ? ['next month', 'next', 'forward', 'næste']
        : ['previous month', 'previous', 'prev', 'back', 'forrige'];
      const classFallbacks = direction === 'next'
        ? ['.react-datepicker__navigation--next', '.ant-picker-header-next-btn', '.ant-picker-header-super-next-btn']
        : ['.react-datepicker__navigation--previous', '.ant-picker-header-prev-btn', '.ant-picker-header-super-prev-btn'];
      for (const root of roots) {
        const buttons = [...root.querySelectorAll('button, [role="button"]')];
        for (const b of buttons) {
          const label = (b.getAttribute('aria-label') || b.title || '').toLowerCase();
          if (labels.some(l => label.includes(l))) { b.click(); return true; }
        }
        for (const cs of classFallbacks) {
          const b = root.querySelector(cs);
          if (b) { b.click(); return true; }
        }
      }
      return false;
    }, [dir]);

    if (!navClicked.result) {
      await debuggerAttach(tabId);
      try {
        const key = delta > 0 ? 'PageDown' : 'PageUp';
        await tastParAttached(tabId, { key, code: key }, { key, code: key });
      } finally {
        await debuggerDetach(tabId);
      }
    }
    navAttempts++;
    await new Promise(r => setTimeout(r, 90));
  }

  const dayResult = await safeExecuteScript(tabId, (day, year, month, monthsEn, monthsDa, monthsAbbr) => {
    const roots = [
      document.querySelector('[role="dialog"]'),
      document.querySelector('.react-datepicker'),
      document.querySelector('.MuiPickersPopper-root'),
      document.querySelector('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)'),
    ].filter(Boolean);
    const monthEn = monthsEn[month - 1];
    const monthDa = monthsDa[month - 1];
    const monthAbbr = monthsAbbr[month - 1];

    for (const root of roots) {
      const cells = [...root.querySelectorAll('[role="gridcell"], .react-datepicker__day, .ant-picker-cell, [class*="PickersDay"]')];
      const isDisabled = (c) => c.getAttribute('aria-disabled') === 'true' ||
        c.classList.contains('disabled') ||
        c.classList.contains('react-datepicker__day--disabled') ||
        c.classList.contains('ant-picker-cell-disabled') ||
        c.classList.contains('Mui-disabled');
      const isOutside = (c) => {
        const cls = c.className || '';
        if (/outside|other-month|--prev|--next|adjacent/i.test(cls)) return true;
        if (c.classList.contains('react-datepicker__day--outside-month')) return true;
        if (c.classList.contains('ant-picker-cell') && !c.classList.contains('ant-picker-cell-in-view')) return true;
        return false;
      };

      for (const c of cells) {
        if (isDisabled(c) || isOutside(c)) continue;
        const label = (c.getAttribute('aria-label') || '').toLowerCase();
        if (!label) continue;
        const matchesMonth = label.includes(monthEn) || label.includes(monthDa) || label.includes(monthAbbr);
        const matchesYear = label.includes(String(year));
        const dayPattern = new RegExp('\\b' + day + '(st|nd|rd|th)?\\b');
        const dayPaddedPattern = new RegExp('\\b' + String(day).padStart(2, '0') + '\\b');
        if (matchesMonth && matchesYear && (dayPattern.test(label) || dayPaddedPattern.test(label))) {
          c.click();
          return { ok: true, method: 'aria-label', label };
        }
      }

      for (const c of cells) {
        if (isDisabled(c) || isOutside(c)) continue;
        const text = (c.textContent || '').trim();
        if (text === String(day) || text === String(day).padStart(2, '0')) {
          c.click();
          return { ok: true, method: 'text-content' };
        }
      }
    }
    return { ok: false, error: 'day-not-found' };
  }, [targetDay, targetYear, targetMonth, MONTHS_EN, MONTHS_DA, MONTHS_ABBR_EN]);

  if (!dayResult.result || !dayResult.result.ok) {
    return {
      ok: false,
      error: dayResult.result?.error || 'day-click-failed',
      navAttempts,
      navExitReason,
      lastReachedMonthYear,
      targetMonthYear: `${targetYear}-${String(targetMonth).padStart(2, '0')}`,
    };
  }

  await new Promise(r => setTimeout(r, 350));
  return { ok: true, method: dayResult.result.method, navAttempts };
}

async function collectVisibleErrors(tabId, selector) {
  const json = await debuggerEval(tabId, `(() => {
    const errs = [];
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el?.getAttribute('aria-invalid') === 'true') errs.push('aria-invalid=true on input');
    const candidates = [
      ...document.querySelectorAll('[role="alert"], .error-text, [class*="error" i]:not(input):not(button)'),
    ].slice(0, 8);
    for (const c of candidates) {
      const t = (c.textContent || '').trim();
      if (t && t.length < 200 && c.offsetHeight > 0) errs.push(t);
    }
    return JSON.stringify(errs);
  })()`);
  try { return JSON.parse(json); } catch { return []; }
}

// ── Overlay Dismissal Helper ────────────────────────────────────────────────

async function dismissOverlays(tabId, scope = 'non_critical', maxPasses = 3) {
  // Clamp to sensible range; reject sloppy input
  const passes = Math.max(1, Math.min(10, Number.isInteger(maxPasses) ? maxPasses : 3));
  const allDismissed = [];
  const allSkipped = [];

  for (let pass = 0; pass < passes; pass++) {
    const r = await safeExecuteScript(tabId, (s) => {
      const dismissed = [];
      const skipped = [];

      // "Safe" texts cannot revert form data — they're purely informational close affordances
      const safeTexts = [
        "luk", "dismiss", "close", "got it", "got it, thanks",
        "not now", "ikke nu", "senere", "later",
        "don't show", "don't show again", "dont show again", "dont show",
        "no thanks", "maybe later", "ok", "ok!", "okay",
      ];
      // "Ambiguous" texts MAY revert partial form data ("Cancel" usually reverts state)
      // — only used when overlay has no editable form fields, or in aggressive scope
      // ── VETO-LISTE (MAALT 23/8 — det dyreste fund i hele auditten) ────────────
      //
      // Koert med den ORDRETTE kode mod knapper i en rigtig browser trykkede
      // dismiss_overlays paa "Close account", "Close and delete everything",
      // "Cancel subscription" og "Afvis betalingen permanent" — og paa enhver knap
      // med aria-label="Close account" eller "Luk kontoen". Det skete i DEFAULT-scope,
      // ikke kun aggressive.
      //
      // Aarsagen: "close" og "luk" er lovlige luk-ord, og matchningen havde ingen
      // ord-graense. "Close account" indeholder "close". Og instruktionerne beder
      // agenten kalde dismiss_overlays FOER hvert stoerre skridt, saa det ville ske
      // paa hver eneste side hvor saadan en knap findes.
      //
      // Et luk-ord er derfor ikke laengere nok: findes ET af disse ord i teksten eller
      // aria-labelen, klikkes der ALDRIG — uanset hvor godt resten matcher. Det er en
      // veto, ikke en vaegtning. Et overlay der ikke bliver lukket koster et ekstra
      // skridt; en lukket konto koster brugeren penge eller adgang.
      const VETO = [
        'account', 'konto', 'subscription', 'abonnement', 'membership', 'medlemskab',
        'payment', 'betaling', 'kort', 'card', 'billing', 'faktura', 'invoice',
        'delete', 'slet', 'remove', 'fjern', 'erase', 'wipe', 'destroy',
        'permanent', 'permanently', 'forever', 'for evigt', 'irreversibl',
        'unsubscribe', 'opsig', 'afmeld', 'terminate', 'opheav',
        'deactivate', 'deaktiver', 'disable', 'deaktivér',
        'sign out', 'log out', 'log ud', 'logout', 'sign-out',
        'order', 'ordre', 'purchase', 'koeb', 'køb', 'refund', 'refunder',
      ];
      const erFarlig = (tekst) => {
        const t = (tekst || '').toLowerCase();
        return VETO.some((v) => t.includes(v));
      };

      const ambiguousTexts = [
        "skip", "cancel", "afvis", "spring over",
      ];
      const xChars = ['×', '✕', '✖', '⨯'];

      // MAALT 21/8: her stod `if (!el || !el.offsetParent && el.tagName !== 'BODY') return false`.
      // offsetParent er ALTID null for et position:fixed-element — det er ikke en fejl i
      // browseren, det er definitionen. Saa hele overlay-fjerneren var blind for praecis
      // den slags elementer som cookie-bannere, samtykke-bjaelker og modaler ER. Et
      // synligt fixed-banner med <button aria-label="Close"> blev hverken fundet som
      // overlay eller som luk-knap: dismissed:[], skipped:[], count:0 — tavst intet.
      //
      // Rigtig synlighed laeses af layout og stil, ikke af offsetParent.
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse') return false;
        if (parseFloat(st.opacity) === 0) return false;
        return true;
      };

      const findCloseAffordance = (overlay, allowAmbiguous) => {
        const all = [...overlay.querySelectorAll('button, [role="button"], a[href="#"], [aria-label]')];
        const allTexts = allowAmbiguous ? [...safeTexts, ...ambiguousTexts] : safeTexts;

        // Priority 1: aria-label match. MAALT 23/8: "always safe" var FORKERT — aria-label
          // "Close account" indeholder "close", saa knappen blev trykket. Vetoet nedenfor
          // er derfor det foerste der koeres, foer nogen match overhovedet forsoeges.
        for (const c of all) {
          if (!isVisible(c)) continue;
          const label = (c.getAttribute('aria-label') || '').toLowerCase();
          if (!label) continue;
            if (erFarlig(label) || erFarlig(c.textContent)) continue;   // veto — se listen ovenfor
          if (label.includes('close') || label.includes('dismiss') || label.includes('luk')) {
            return { el: c, method: 'aria-label', label };
          }
          if (allowAmbiguous && label.includes('afvis')) {
            return { el: c, method: 'aria-label', label };
          }
        }

        // Priority 2: button text exact match
        for (const c of all) {
          if (!isVisible(c)) continue;
          const text = (c.textContent || '').trim().toLowerCase();
          if (!text || text.length > 30) continue;
          if (erFarlig(text) || erFarlig(c.getAttribute('aria-label'))) continue;   // veto
          if (allTexts.some(t => text === t || text === t + '!' || text === t + '.')) {
            return { el: c, method: 'text-exact', label: text };
          }
        }
        // Priority 3: button text contains
        for (const c of all) {
          if (!isVisible(c)) continue;
          const text = (c.textContent || '').trim().toLowerCase();
          if (!text || text.length > 40) continue;
          // MAALT 22/8: contains-passet gjorde "ok" til en delstreng-traeffer, saa
          // "Book a demo", "Unlock account" og "Cookie settings" blev klikbare — i
          // DEFAULT-scope. Korte ord maa kun matche eksakt (prioritet 2 ovenfor).
          if (erFarlig(text) || erFarlig(c.getAttribute('aria-label'))) continue;   // veto
          if (allTexts.filter(t => t.length >= 5).some(t => text.includes(t))) {
            return { el: c, method: 'text-contains', label: text };
          }
        }

        // Priority 4: × character buttons (always safe — these are universal close)
        for (const c of all) {
          if (!isVisible(c)) continue;
          const text = (c.textContent || '').trim();
          if (erFarlig(c.getAttribute('aria-label'))) continue;   // et × med farlig aria-label
          if (xChars.includes(text)) {
            return { el: c, method: 'x-char', label: text };
          }
        }

        return null;
      };

      const overlays = new Set();
      const selectors = [
        '[role="dialog"]:not([aria-hidden="true"])',
        '[role="alertdialog"]:not([aria-hidden="true"])',
        '[role="tooltip"]:not([aria-hidden="true"])',
        '[role="alert"]',
        '[class*="modal" i]:not([class*="-hidden"]):not([style*="display: none"])',
        '[class*="tooltip" i]:not([class*="-hidden"])',
        '[class*="popover" i]:not([class*="-hidden"])',
        '[class*="overlay" i]:not([class*="-hidden"])',
        '[class*="banner" i]:not([class*="-hidden"]):not(input):not(button)',
        '[data-testid*="dialog" i]',
        '[data-testid*="modal" i]',
        // MAALT 22/8 af flowtesten: listen matchede kun paa class, aldrig paa id. Et
        // helt almindeligt <div id="banner"> blev derfor ALDRIG set som et overlay —
        // og cookie-bannere skrives lige saa ofte med id som med class. Hullet var
        // skjult indtil i dag, fordi det strukturelle fixed/sticky-spor fangede dem
        // alligevel; det spor blev skaaret efter sikkerhedsreview, og saa stod hullet
        // bart. De samme fem ord, samme regler — bare paa id.
        //
        // Det her er IKKE det skaarne spor i ny form: her har sideforfatteren selv
        // kaldt elementet en dialog/modal/banner. Det er en eksplicit erklaering, ikke
        // et gaet ud fra placering, saa faren ved delstrengs-matchning gaelder ikke.
        '[id*="modal" i]:not(input):not(button)',
        '[id*="overlay" i]:not(input):not(button)',
        '[id*="popover" i]:not(input):not(button)',
        '[id*="banner" i]:not(input):not(button)',
        '[id*="dialog" i]:not(input):not(button)',
      ];
      for (const sel of selectors) {
        try {
          for (const el of document.querySelectorAll(sel)) {
            if (isVisible(el) && el.tagName !== 'INPUT' && el.tagName !== 'BUTTON') {
              overlays.add(el);
            }
          }
        } catch {}
      }

      // Et strukturelt spor (alt fixed/sticky over 40x20px som overlay-kandidat) blev
      // proevet 21/8 og SKAARET 22/8 efter sikkerhedsreview: findCloseAffordance matcher
      // paa delstrenge, saa "Cancel subscription", "Close account" og "Book now" (via "ok")
      // alle blev klikkbare — paa hver eneste side, og instruktionerne beder agenten kalde
      // dismiss_overlays foer hvert stoerre skridt. Den maalte fejl var offsetParent-
      // blindheden i isVisible ovenfor; den er rettet. Sporet var ny adfaerd uden bevist
      // behov. Genindfoeres kun med eksakt tekstmatch og et krav om luk-affordance som
      // direkte barn.

      for (const overlay of overlays) {
        const role = overlay.getAttribute('role') || (overlay.className || '').split(' ')[0] || 'unknown';

        // Inspect for editable form fields
        const editableTextInputs = overlay.querySelectorAll(
          'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), [contenteditable="true"]'
        );
        const allEditableInputs = overlay.querySelectorAll(
          'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), [contenteditable="true"]'
        );
        const hasTextFields = editableTextInputs.length > 0;
        const hasOnlyCheckboxRadios = !hasTextFields && allEditableInputs.length > 0;

        // Determine if ambiguous keywords (Skip/Cancel/Afvis) are allowed
        let allowAmbiguous;
        if (s === 'aggressive') {
          allowAmbiguous = true;
        } else if (role === 'tooltip' || role === 'alert') {
          allowAmbiguous = true;  // tooltips never hold form data
        } else if (hasTextFields) {
          allowAmbiguous = false; // protect form data — only safe keywords
        } else {
          allowAmbiguous = true;  // checkbox-only or empty dialogs — fair game
        }

        const found = findCloseAffordance(overlay, allowAmbiguous);
        if (found) {
          try {
            found.el.click();
            dismissed.push({ role, method: found.method, label: found.label, scope: allowAmbiguous ? 'ambiguous-ok' : 'safe-only' });
          } catch (e) {
            skipped.push({ role, reason: 'click-error', error: e.message });
          }
        } else {
          skipped.push({
            role,
            reason: hasTextFields && !allowAmbiguous
              ? 'no-safe-dismiss-affordance (text fields present)'
              : 'no-dismiss-affordance-found',
            hasTextFields,
            hasOnlyCheckboxRadios,
          });
        }
      }

      return { dismissed, skipped };
    }, [scope]);

    const passResult = r.result || { dismissed: [], skipped: [] };
    if (pass === 0) allSkipped.push(...passResult.skipped);
    if (passResult.dismissed.length === 0) break;
    allDismissed.push(...passResult.dismissed);
    await new Promise(r2 => setTimeout(r2, 250));
  }

  return { dismissed: allDismissed, skipped: allSkipped };
}

// ── Combobox / Autocomplete Helper ──────────────────────────────────────────

async function setCombobox(tabId, selector, values, opts = {}) {
  const valueList = Array.isArray(values) ? values : [values];
  const multi = !!opts.multi;
  const queryPrefixLen = opts.query_chars || 4;
  const waitMs = opts.wait_ms || 3000;
  const waitIterations = Math.max(1, Math.ceil(waitMs / 100));
  const results = [];

  // MAALT 9/9-2026: paa en aegte <select> brugte den her 8,5 sekunder paa at sige nej.
  // Den klikkede feltet, forsoegte at tomme det med en input-vaerdisaetter (en <select>
  // ER ikke et input), skrev tekst ind, og pollede saa 30 gange efter en listbox der
  // aldrig kan opstaa — for saa at svare "no-options-rendered". Kapaciteten fandtes hele
  // tiden i browser_select_option, som klarer samme felt paa 9 ms. Nu siger den det
  // med det samme i stedet for at lade agenten vente og gaette.
  const erNativeSelect = await debuggerEval(tabId, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return el?.tagName === 'SELECT';
  })()`).catch(() => false);
  if (erNativeSelect) {
    return {
      ok: false,
      error: 'native-select',
      hint: 'Feltet er en almindelig <select>. Brug browser_select_option i stedet — ' +
            'set_combobox er til dropdowns bygget af div/li med en listbox.',
      selector,
    };
  }

  for (const val of valueList) {
    try {
      const inputEl = await resolveElement(tabId, selector);
      if (!inputEl) {
        results.push({ value: val, ok: false, error: 'input-not-found' });
        continue;
      }
      await debuggerClick(tabId, inputEl.x, inputEl.y);
      await new Promise(r => setTimeout(r, 120));

      // Clear input only if non-empty. Backspace on empty multi-select deletes the previous chip
      // (react-select, MUI Autocomplete, Meta combobox all behave this way) — so we use native
      // value-setter to clear cleanly without ever pressing Backspace on an empty field.
      const currentValue = await readBackValue(tabId, selector);
      if (currentValue) {
        await safeExecuteScript(tabId, (sel) => {
          const el = document.querySelector(sel);
          if (!el) return;
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(el, ''); else el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, [selector]);
      }

      // Type partial query via Input.insertText (bypasses per-keystroke validators)
      const query = val.slice(0, Math.min(queryPrefixLen, val.length));
      await debuggerAttach(tabId);
      await cdpSend(tabId, 'Input.insertText', { text: query });

      // Wait for listbox/options to appear
      let ready = false;
      for (let i = 0; i < waitIterations; i++) {
        await new Promise(r => setTimeout(r, 100));
        const found = await debuggerEval(tabId, `(() => {
          const lbs = document.querySelectorAll('[role="listbox"], [role="grid"][aria-label*="suggest" i], [class*="autocomplete" i] [class*="option" i], [class*="menu" i][role]:not([aria-hidden="true"])');
          for (const lb of lbs) {
            if (lb.offsetHeight === 0) continue;
            const opts = lb.querySelectorAll('[role="option"], [role="menuitem"], [data-option-index], [class*="option" i]:not([class*="optgroup" i])');
            if (opts.length > 0) return true;
          }
          return false;
        })()`);
        if (found) { ready = true; break; }
      }

      if (!ready) {
        results.push({ value: val, ok: false, error: 'no-options-rendered', query, waitMs });
        continue;
      }

      // Find and click matching option
      const click = await safeExecuteScript(tabId, (query) => {
        const lbs = [...document.querySelectorAll('[role="listbox"], [role="grid"][aria-label*="suggest" i], [class*="autocomplete" i], [class*="menu" i][role]:not([aria-hidden="true"])')]
          .filter(lb => lb.offsetHeight > 0);

        const queryLower = query.toLowerCase();
        const allOptions = [];
        for (const lb of lbs) {
          const opts = [...lb.querySelectorAll('[role="option"], [role="menuitem"], [data-option-index]')];
          if (opts.length === 0) {
            opts.push(...lb.querySelectorAll('li, [class*="option" i]:not([class*="optgroup" i])'));
          }
          const enabled = opts.filter(o =>
            o.getAttribute('aria-disabled') !== 'true' &&
            !o.classList.contains('disabled') &&
            o.offsetHeight > 0
          );
          allOptions.push(...enabled);
        }

        for (const o of allOptions) {
          const text = (o.textContent || '').trim().toLowerCase();
          if (text === queryLower) {
            o.click();
            return { ok: true, method: 'exact', text: o.textContent.trim() };
          }
        }
        for (const o of allOptions) {
          const text = (o.textContent || '').trim().toLowerCase();
          if (text.startsWith(queryLower)) {
            o.click();
            return { ok: true, method: 'startsWith', text: o.textContent.trim() };
          }
        }
        for (const o of allOptions) {
          const text = (o.textContent || '').trim().toLowerCase();
          if (text.includes(queryLower)) {
            o.click();
            return { ok: true, method: 'contains', text: o.textContent.trim() };
          }
        }

        return { ok: false, error: 'no-match-found', optionCount: allOptions.length };
      }, [val]);

      if (click.result?.ok) {
        results.push({ value: val, ok: true, method: click.result.method, selected: click.result.text });
        if (multi) {
          await new Promise(r => setTimeout(r, 250));
        }
      } else {
        results.push({ value: val, ok: false, error: click.result?.error || 'click-failed' });
      }
    } catch (e) {
      results.push({ value: val, ok: false, error: e?.message || String(e) });
    }
  }

  return { ok: results.every(r => r.ok), results };
}

// ── File Drop Helper (for drop-zones without <input type="file">) ───────────

async function dropFileOnTarget(tabId, selector, files) {
  const fileList = Array.isArray(files) ? files : [files];

  // Sweep any stale tags from previous failed runs before tagging fresh
  await debuggerEval(tabId, `(() => {
    document.querySelectorAll('[data-bmcp-drop-tag]').forEach(el => el.removeAttribute('data-bmcp-drop-tag'));
  })()`);

  // Strategy 1: search subtree (and 2 ancestor levels) for a file input — even if hidden
  const inputJson = await debuggerEval(tabId, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return JSON.stringify({ found: false, error: 'target-not-found' });

    const candidates = [];
    candidates.push(...target.querySelectorAll('input[type="file"]'));
    if (candidates.length === 0 && target.parentElement) {
      candidates.push(...target.parentElement.querySelectorAll('input[type="file"]'));
    }
    if (candidates.length === 0 && target.parentElement?.parentElement) {
      candidates.push(...target.parentElement.parentElement.querySelectorAll('input[type="file"]'));
    }
    if (candidates.length === 0) {
      // Last resort: any file input on the page
      candidates.push(...document.querySelectorAll('input[type="file"]'));
    }
    if (candidates.length === 0) return JSON.stringify({ found: false });

    // Tag the first viable input with a unique data-attribute so we can re-query reliably
    const tag = '__bmcp_drop_target_' + Math.random().toString(36).slice(2, 10);
    candidates[0].setAttribute('data-bmcp-drop-tag', tag);
    return JSON.stringify({ found: true, tag, accept: candidates[0].accept || '', multiple: !!candidates[0].multiple });
  })()`);

  const inputInfo = JSON.parse(inputJson);

  if (inputInfo.found) {
    const taggedSel = `[data-bmcp-drop-tag="${inputInfo.tag}"]`;
    let result;
    let caughtError;
    try {
      await debuggerAttach(tabId);
      const docResult = await cdpSend(tabId, 'DOM.getDocument', {});
      const queryResult = await cdpSend(tabId, 'DOM.querySelector', {
        nodeId: docResult.root.nodeId,
        selector: taggedSel,
      });
      if (queryResult.nodeId) {
        await cdpSend(tabId, 'DOM.setFileInputFiles', {
          nodeId: queryResult.nodeId,
          files: fileList,
        });
        result = { ok: true, method: 'hidden-input', files: fileList, accept: inputInfo.accept };
      }
    } catch (e) {
      caughtError = e?.message || String(e);
    } finally {
      // Always remove the tag attribute — success or failure
      try {
        await debuggerEval(tabId, `(() => {
          const el = document.querySelector(${JSON.stringify(taggedSel)});
          if (el) el.removeAttribute('data-bmcp-drop-tag');
        })()`);
      } catch {}
    }
    if (result) return result;
    if (caughtError) {
      return {
        ok: false,
        error: 'setFileInputFiles-failed',
        detail: caughtError,
      };
    }
  }

  // Strategy 2 (v1.27): intercept the NATIVE OS file chooser.
  //
  // Sites like Google Ads never put an <input type="file"> in the DOM — clicking
  // their "choose a file" control opens the OS dialog directly, which no browser
  // automation can reach. Page.setInterceptFileChooserDialog makes Chrome fire
  // Page.fileChooserOpened instead of showing that dialog, and the event carries
  // the backendNodeId of the element that requested it. DOM.setFileInputFiles
  // accepts a backendNodeId, so we can satisfy the request programmatically.
  //
  // Order matters: interception must be armed BEFORE the click that opens the
  // chooser, otherwise the OS dialog is already up and the event never fires.
  const chooserResult = await interceptFileChooser(tabId, selector, fileList);
  if (chooserResult) return chooserResult;

  return {
    ok: false,
    error: 'no-file-input-found',
    hint: 'No <input type="file"> found, and the native file-chooser interception did not fire. The trigger element may not open a file dialog at all — check the selector.',
  };
}

// Arms Page.fileChooserOpened, clicks the trigger, and fulfils the chooser with
// the given files. Returns null if no chooser opened (so the caller can fall
// through to its own error), or a result object on success/explicit failure.
async function interceptFileChooser(tabId, selector, fileList) {
  try {
    await debuggerAttach(tabId);
    await cdpSend(tabId, 'Page.enable', {});
    await cdpSend(tabId, 'DOM.enable', {});
    await cdpSend(tabId, 'Page.setInterceptFileChooserDialog', { enabled: true });
  } catch (e) {
    return null; // interception unavailable — let caller report the original error
  }

  try {
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        chrome.debugger.onEvent.removeListener(listener);
        clearTimeout(timer);
        resolve(value);
      };

      const listener = (source, method, eventParams) => {
        if (source.tabId !== tabId || method !== 'Page.fileChooserOpened') return;
        const backendNodeId = eventParams?.backendNodeId;
        if (!backendNodeId) {
          finish({ ok: false, error: 'file-chooser-without-node', detail: 'Chrome fired fileChooserOpened but supplied no backendNodeId.' });
          return;
        }
        cdpSend(tabId, 'DOM.setFileInputFiles', { backendNodeId, files: fileList })
          .then(() => finish({
            ok: true,
            method: 'native-chooser-intercepted',
            files: fileList,
            mode: eventParams.mode,
          }))
          .catch(e => finish({ ok: false, error: 'setFileInputFiles-failed', detail: e?.message || String(e) }));
      };
      chrome.debugger.onEvent.addListener(listener);

      // 8s: the click is local, so the chooser opens within a frame or two.
      // A longer wait would just stall the caller when the element opens no dialog.
      const timer = setTimeout(() => finish(null), 8000);

      // Click the trigger so the page asks for the chooser. Real mouse events —
      // a synthetic .click() does not always reach the file-picker code path.
      (async () => {
        const el = await resolveElement(tabId, selector);
        if (!el) { finish({ ok: false, error: 'trigger-not-found', detail: selector }); return; }
        await debuggerClick(tabId, el.x, el.y);
      })().catch(e => finish({ ok: false, error: 'trigger-click-failed', detail: e?.message || String(e) }));
    });
  } finally {
    try { await cdpSend(tabId, 'Page.setInterceptFileChooserDialog', { enabled: false }); } catch {}
  }
}

// ── Command Dispatcher ──────────────────────────────────────────────────────

async function dispatch(port, method, params) {
  switch (method) {
    case 'navigate': {
      const session = getSession(port);
      let tab = await getSessionTab(port);

      // Always reuse the active tab — navigate in place, don't create new tabs
      // Only create new tab if explicitly requested via new_tab param
      if (params.new_tab) {
        tab = await chrome.tabs.create({ url: params.url, active: false });
        await addTabToSession(port, tab.id);
      } else {
        await chrome.tabs.update(tab.id, { url: params.url });
      }

      // Wait for load
      await new Promise(resolve => {
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
      });

      // Set as active tab for this session
      session.activeTabId = tab.id;
      persistSessions();
      const updated = await chrome.tabs.get(tab.id);

      // Check for CAPTCHA after navigation
      const captcha = await detectCaptcha(tab.id);
      const result = { title: updated.title, url: updated.url, tab_id: tab.id, session: session.label };
      if (captcha && captcha.found) {
        result.captcha_detected = captcha.types.join(', ');
        result.hint = `CAPTCHA detected: ${captcha.types.join(', ')}. Use browser_solve_captcha to handle it.`;
      }
      return result;
    }

    case 'get_page_content': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot access chrome:// pages');
      const format = params.format || 'text';
      const scriptResult = await safeExecuteScript(tab.id, (fmt) => fmt === 'html' ? document.documentElement.outerHTML : document.body.innerText, [format]);
      if (!scriptResult.cspBlocked) {
        return { content: scriptResult.result, url: tab.url, title: tab.title };
      }
      // CSP fallback
      const content = await debuggerEval(tab.id, format === 'html' ? 'document.documentElement.outerHTML' : 'document.body.innerText');
      return { content, url: tab.url, title: tab.title, method: 'debugger' };
    }

    // Read EVERY row of a virtualised list by scrolling its container until the set stops
    // growing. Outlook, Gmail and most mail/table UIs keep only ~7 rows in the DOM, so a
    // single get_page_content sees a sliver — this walks the whole list instead.
    case 'extract_list': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot access chrome:// pages');
      const rowSel = params.selector;
      if (!rowSel) throw new Error('extract_list requires `selector` (the repeating row element)');
      const containerSel = params.container || null;
      const maxRows = Math.min(params.max_rows || 500, 5000);
      const stableNeeded = params.stable_rounds || 3;
      const waitMs = params.wait_ms || 350;

      const seen = new Set();
      let stable = 0, rounds = 0, atEnd = false;
      const MAX_ROUNDS = 300; // backstop: a list that never stabilises must not spin forever

      while (seen.size < maxRows && stable < stableNeeded && rounds < MAX_ROUNDS) {
        rounds++;
        const r = await safeExecuteScript(tab.id, (rs, cs, keep) => {
          const rows = Array.from(document.querySelectorAll(rs));
          const texts = rows
            .map(el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(t => t.length > 0);

          // Scroll the row's own scrollable ancestor — scrolling window does nothing when the
          // list lives in an inner overflow container (the normal case in webmail).
          let c = cs ? document.querySelector(cs) : null;
          if (!c && rows.length) {
            let p = rows[0].parentElement;
            while (p && p !== document.documentElement) {
              const s = getComputedStyle(p);
              if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 20) { c = p; break; }
              p = p.parentElement;
            }
          }
          const step = keep || (c ? c.clientHeight : window.innerHeight) * 0.85;
          const before = c ? c.scrollTop : window.scrollY;
          if (c) c.scrollTop = before + step; else window.scrollBy(0, step);
          const after = c ? c.scrollTop : window.scrollY;
          const done = c
            ? c.scrollTop + c.clientHeight >= c.scrollHeight - 4
            : window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
          return { texts, moved: after - before, done, container: !!c };
        }, [rowSel, containerSel, params.scroll_step || 0]);

        if (r.cspBlocked) throw new Error('extract_list: this page blocks script injection — use screenshots instead');
        const data = r.result || { texts: [] };
        const before = seen.size;
        for (const t of data.texts) seen.add(t);
        // Two independent stop signals: nothing new appeared, or the container hit its end.
        if (seen.size === before) stable++; else stable = 0;
        if (data.done) { atEnd = true; stable++; }
        if (!data.texts.length && rounds > 2) break; // selector matches nothing — fail fast
        await new Promise(res => setTimeout(res, waitMs));
      }

      return {
        rows: [...seen],
        count: seen.size,
        rounds,
        reached_end: atEnd,
        truncated: seen.size >= maxRows,
      };
    }

    case 'screenshot': {
      // EKSPERIMENT 21/8: fanen aktiveres IKKE laengere.
      //
      // getSessionTab(…, true) stjal ikke VINDUES-fokus (FIX-1), men den kaldte stadig
      // chrome.tabs.update({active:true}) — altsaa et fane-skift INDE i vinduet. Sidder
      // brugeren i det samme Chrome-vindue paa sin egen fane, bliver den revet vaek hver
      // eneste gang agenten tager et billede. Og billeder tages konstant.
      //
      // Aktiveringen er formentlig unoedvendig: CDP Page.captureScreenshot nedenfor
      // fotograferer en fane der ikke er forrest. Den okkluderede sidste-udvej loefter
      // stadig vinduet hvis CDP virkelig ikke kan producere en frame.
      const tab = await getSessionTab(port, false);
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) {
        throw new Error(`Cannot screenshot ${tab.url.split(':')[0]}: pages — navigate to a real page first`);
      }
      // MAALT 10/9, anden runde (Astra, reproduceret): reserveloesningen captureVisibleTab
      // fotograferer den fane der er SYNLIG i vinduet, ikke agentens. Et tjek foer og et efter
      // kunne ikke udelukke at brugeren skiftede A->B->A imens - og saa blev brugerens side
      // leveret. To tidspunkter beviser ikke hvad der skete imellem. Reserveloesningen er derfor
      // fjernet: CDP optager netop `tab.id`, eller der er intet billede.
      // Samme runde: en frist paa optagelsen startede alligevel en ny runde (haev vinduet, optag
      // igen), og kaeden kom over serverens 30 s. En frist markeres nu, og saa proeves der ikke igen.
      // Sign-off 11/9 (Astra, R5 F8): hele kaeden har ét budget (skaermbilledeFrister). Fristen gaelder ogsaa mens
      // cdpSend gentager et kald efter en afkobling - det var den gentagelse der bar kaeden over 30 s.
      const { foersteMs, samletMs } = skaermbilledeFrister();
      const budgetSlut = Date.now() + samletMs;
      const tryCapture = async () => {
        await debuggerAttach(tab.id);
        const optag = (p) => {
          const kald = cdpSend(tab.id, 'Page.captureScreenshot', p);
          kald.catch(() => {});   // et svar efter budgettet er ligegyldigt
          return kald;
        };
        const medFrist = async (loefte, ms) => {
          let ur;
          try {
            return await Promise.race([
              loefte,
              new Promise((_, afvis) => {
                const frist = Math.max(0, ms);
                ur = setTimeout(() => afvis(new Error(`CDP svarede ikke inden ${frist} ms: Page.captureScreenshot`)), frist);
              }),
            ]);
          } catch (e) {
            if (e && typeof e === 'object' && /svarede ikke inden/.test(e.message || '')) e.ingenNyRunde = true;
            throw e;
          } finally {
            clearTimeout(ur);
          }
        };
        const standard = optag({ format: 'png' });
        try {
          const shot = await medFrist(standard, Math.min(foersteMs, budgetSlut - Date.now()));
          return { image: 'data:image/png;base64,' + shot.data };
        } catch (foersteFejl) {
          // fromSurface:false proeves ogsaa efter en frist: i 1.29.0 var det netop fristen der naaede hertil, og den
          // leverede billedet. Men efter en frist startes ingen runde mere, uanset hvordan reserven fejler.
          // MAALT 11/9 af Astra (efterproevning af f084d1b): standardoptagelsen lykkedes efter 11 s, reserven fejlede, og
          // fristen paa 10 s havde kasseret standardbilledet. Standardoptagelsen loeber derfor videre efter sin frist, og
          // den af de to der lykkes foerst inden for budgettet, vinder.
          const reserve = optag({ format: 'png', fromSurface: false, captureBeyondViewport: false });
          const kandidater = foersteFejl?.ingenNyRunde ? [standard, reserve] : [reserve];
          try {
            const shot = await medFrist(Promise.any(kandidater), budgetSlut - Date.now());
            return { image: 'data:image/png;base64,' + shot.data };
          } catch (andenFejl) {
            const fejl = andenFejl instanceof AggregateError ? andenFejl.errors[andenFejl.errors.length - 1] : andenFejl;
            if (foersteFejl?.ingenNyRunde && fejl && typeof fejl === 'object') fejl.ingenNyRunde = true;
            throw fejl;
          }
        }
      };

      // Attempt 1 — focus-neutral. Handles the vast majority (background-but-visible window).
      try {
        return await tryCapture();
      } catch (firstErr) {
        // En frist er et svar: kompositoren svarede ikke. At haeve vinduet og optage igen
        // fordobler kun ventetiden og tager brugerens fokus for ingenting.
        if (firstErr?.ingenNyRunde) throw firstErr;
        // Er budgettet brugt, er der ikke tid til en runde med haevet vindue foer serverens 30 s.
        if (budgetSlut - Date.now() < 1000) throw firstErr;
        // Both methods failed → the window is genuinely OCCLUDED (covered by other windows),
        // so Chrome's compositor produced no frames. LAST RESORT ONLY: raise the window to
        // de-occlude it, capture, then RESTORE the user's previously-focused window. This
        // focus-steal happens ONLY in the rare covered case — never on a normal screenshot.
        const prev = await chrome.windows.getLastFocused().catch(() => null);
        try {
          await chrome.windows.update(tab.windowId, { focused: true, state: 'normal' });
          await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
          await new Promise(r => setTimeout(r, 250)); // let it composite
          return await tryCapture();
        } catch (secondErr) {
          throw new Error(
            `Screenshot failed after focus-neutral AND raised attempts. ` +
            `First: ${firstErr?.message || firstErr}. Raised: ${secondErr?.message || secondErr}. ` +
            `If both say "image readback failed" the GPU compositor is not producing frames — ` +
            `disable Chrome hardware acceleration (chrome://settings/system) as a last resort.`
          );
        } finally {
          // Give focus back to the user's previous Chrome window (best-effort; getLastFocused
          // only sees Chrome windows, so a non-Chrome IDE can't be re-focused programmatically).
          if (prev && prev.id != null && prev.id !== tab.windowId) {
            await chrome.windows.update(prev.id, { focused: true }).catch(() => {});
          }
        }
      }
    }

    case 'execute_script': {
      // v1.22.2 (DIAGNOSTIC): Try scripting paths but log all errors so we can see WHY they fail
      // v1.26: accept `script` as alias for `code` — the historic param-name mismatch caused
      // silent "unserializable"/undefined failures that read as "execute_script is broken".
      if (params.code == null && typeof params.script === 'string') params.code = params.script;
      if (typeof params.code !== 'string' || !params.code.trim()) {
        return { ok: false, error: 'Missing code. Pass a JavaScript EXPRESSION in `code` (e.g. an IIFE: (() => {...; return x;})()). `return ...` at top level is invalid — the handler wraps code in parentheses.' };
      }
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot execute scripts on chrome:// pages');

      const diag = { tried: [] };

      // MAALT 10/9 af Astra (anden runde), reproduceret med en taeller: kode der udfoerte en
      // effekt og SAA kastede, blev koert igen via debuggeren - to effekter. `sendt` beskyttede
      // kun debugger-loekken. Er koden koert, er dens fejl svaret; den koeres ikke igen.
      // Samme runde: scripting-stierne afventede ikke et Promise ("Promise.resolve(42)" gav {}).
      // Den injicerede funktion er nu async og afventer resultatet.
      const koertOgFejlede = (r) => ({
        ok: false, error: r.message, name: r.name,
        method: r.world === 'MAIN' ? 'scripting-main' : 'scripting-isolated',
        note: 'Koden KOERTE og kastede en fejl. Den koeres ikke igen via debuggeren, fordi det den ' +
              'naaede at goere foer fejlen saa ville ske to gange.',
      });
      // MAALT 11/9 af Astra (R5 F4), reproduceret: scriptet sendte en POST og returnerede et
      // Promise; mens scripting-stien ventede, forsvandt dokumentet, og Chrome afviste med
      // "Frame with ID 0 was removed." Handleren gik saa videre til debuggeren, som koerte koden
      // igen - to POST'er. Forsvinder siden EFTER at koden er startet, kan den have koert, og
      // den koeres ikke igen. Blev den aldrig indsproejtet, maa debuggeren stadig proeve.
      const sidenForsvandt = (m) => /was removed|execution context was destroyed|document (was )?unloaded/i.test(m);
      const maaskeKoert = (world, m) => ({
        ok: false, error: m, maybe_ran: true,
        method: world === 'MAIN' ? 'scripting-main' : 'scripting-isolated',
        note: 'Siden skiftede eller lukkede mens koden koerte. Den kan allerede have koert, saa den ' +
              'koeres ikke igen via debuggeren. Kald igen kun hvis det er sikkert at koere to gange.',
      });
      // Step 1: try ISOLATED world
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'ISOLATED',
          args: [params.code],
          func: async (codeStr) => {
            // Oversaettelse og koersel er adskilt: fejler oversaettelsen (CSP, syntaks), koerte
            // intet, og debuggeren maa proeve. Fejler KOERSLEN, er koden allerede koert.
            let fn;
            try { fn = new Function('return (' + codeStr + ')'); }
            catch (e) { return { __kompilering: true, message: String(e?.message || e), name: e?.name, world: 'ISOLATED' }; }
            try { return { __ok: true, value: await fn() }; }
            catch (e) { return { __scriptingError: true, koerte: true, message: String(e?.message || e), name: e?.name, world: 'ISOLATED' }; }
          },
        });
        const r = result?.result;
        diag.tried.push({ world: 'ISOLATED', result_keys: r ? Object.keys(r) : null, r_type: typeof r });
        if (r && typeof r === 'object' && r.__ok) {
          return { result: r.value, method: 'scripting-isolated' };
        }
        if (r && typeof r === 'object' && r.__scriptingError && r.koerte) return koertOgFejlede(r);
        if (r && typeof r === 'object' && (r.__scriptingError || r.__kompilering)) {
          diag.isolated_error = r.message;
        }
      } catch (e) {
        // Ingen maybe_ran her. MAALT 11/9 i Chrome for Testing 153: `new Function` i ISOLATED afvises af udvidelsens
        // CSP ('unsafe-eval'), saa brugerens kode kan aldrig have koert i denne verden. Sign-off (Astra): en afvisning
        // med "Frame with ID 0 was removed." foer start gav maybe_ran og nul koersler, hvor 1.29.0 koerte koden via MAIN.
        diag.isolated_throw = String(e?.message || e);
      }

      // Step 2: try MAIN world
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          args: [params.code],
          func: async (codeStr) => {
            // Oversaettelse og koersel er adskilt: fejler oversaettelsen (CSP, syntaks), koerte
            // intet, og debuggeren maa proeve. Fejler KOERSLEN, er koden allerede koert.
            let fn;
            try { fn = new Function('return (' + codeStr + ')'); }
            catch (e) { return { __kompilering: true, message: String(e?.message || e), name: e?.name, world: 'MAIN' }; }
            try { return { __ok: true, value: await fn() }; }
            catch (e) { return { __scriptingError: true, koerte: true, message: String(e?.message || e), name: e?.name, world: 'MAIN' }; }
          },
        });
        const r = result?.result;
        diag.tried.push({ world: 'MAIN', result_keys: r ? Object.keys(r) : null, r_type: typeof r });
        if (r && typeof r === 'object' && r.__ok) {
          return { result: r.value, method: 'scripting-main' };
        }
        if (r && typeof r === 'object' && r.__scriptingError && r.koerte) return koertOgFejlede(r);
        if (r && typeof r === 'object' && (r.__scriptingError || r.__kompilering)) {
          diag.main_error = r.message;
        }
      } catch (e) {
        const m = String(e?.message || e);
        if (sidenForsvandt(m)) return maaskeKoert('MAIN', m);
        diag.main_throw = m;
      }

      // Step 3: debugger fallback — the ONLY universal path for arbitrary STRING code
      // (both scripting worlds block `new Function`: ISOLATED via MV3 extension-CSP,
      // MAIN via the page's own unsafe-eval CSP). CDP Runtime.evaluate bypasses CSP.
      // FIX (2026-07-16): retry on an EMPTY/undefined CDP response. On some pages the
      // debugger auto-detaches mid-command and `chrome.debugger.sendCommand` RESOLVES
      // with `undefined` instead of rejecting, so cdpSend's throw-based retry never
      // fires and debuggerEval silently returned undefined → the caller saw a bare
      // `{method:"debugger"}` with no result. Also surface script exceptions + raw
      // diagnostics so a genuine failure is never mistaken for an empty success.
      let rawDbg, dbgErr = '', sendt = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await debuggerAttach(tab.id);
          // MAALT 10/9 af Astra: faldt debuggeren af EFTER at scriptet var sendt, loeb loekken
          // videre og koerte BRUGERENS kode igen — op til fire gange. Vi kan ikke se om et
          // vilkaarligt script muterer. Samme regel som for Runtime.evaluate i cdpSend: er det
          // sendt, gentages det ikke automatisk. Kun en fejl FOER afsendelse proeves igen.
          sendt = true;
          rawDbg = await cdpSend(tab.id, 'Runtime.evaluate', {
            expression: '(' + params.code + '\n)',
            returnByValue: true,
            awaitPromise: true,
          });
          if (rawDbg && rawDbg.exceptionDetails) {
            const ex = rawDbg.exceptionDetails;
            await debuggerDetach(tab.id).catch(() => {});
            throw new Error('__SCRIPT_EX__' + (ex.exception?.description || ex.text || 'Script exception'));
          }
          if (rawDbg && rawDbg.result && rawDbg.result.type !== 'undefined') {
            await debuggerDetach(tab.id).catch(() => {});
            return { result: rawDbg.result.value, method: 'debugger' };
          }
          dbgErr = 'empty/undefined CDP response: ' + JSON.stringify(rawDbg);
          break;   // tomt svar efter afsendelse: scriptet kan have koert — gentag ikke
        } catch (e) {
          const m = String(e?.message || e);
          if (m.startsWith('__SCRIPT_EX__')) {
            throw new Error(m.slice('__SCRIPT_EX__'.length) + ' | scripting-diag: ' + JSON.stringify(diag));
          }
          dbgErr = m;
          if (sendt) break;   // sendt = maaske koert — se kommentaren ved afsendelsen
          if (!/detach|attach|empty|gone|given id|not attached/i.test(m)) break;
        }
        await debuggerDetach(tab.id).catch(() => {});
        await new Promise(r => setTimeout(r, 200 + attempt * 200));
      }
      throw new Error(
        'execute_script failed on all paths. debugger: ' + dbgErr +
        (sendt ? ' | NB: scriptet blev sendt til siden foer det fejlede og KAN allerede have koert. ' +
                 'Det gentages ikke automatisk — kald igen kun hvis det er sikkert at koere to gange.' : '') +
        ' | raw: ' + JSON.stringify(rawDbg) +
        ' | scripting-diag: ' + JSON.stringify(diag)
      );
    }

    case 'click': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');

      // Wrap full click flow (incl. resolveElement) so debugger failures in EITHER
      // resolveElement (text-selectors use debuggerEval) OR debuggerClick trigger
      // the scripting-fallback. v1.21.2: previously only debuggerClick was wrapped,
      // leaving text-selector clicks unrecoverable when debugger was user-blocked.
      try {
        const el = await resolveElement(tab.id, params.selector);
        if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
        // Elementet findes, men har ingen udstraekning — at klikke ville ramme (0,0),
        // altsaa et HELT andet element end det der blev bedt om. Sig det i stedet.
        if (el.hidden) {
          return {
            ok: false,
            error: 'Element fundet men ikke synligt (0x0) — klik ville ramme sidens hjoerne: ' + params.selector,
            hidden: true,
            tag: el.tag,
          };
        }

        // Primary path: debugger mouse events (isTrusted=true, works on React/Angular SPAs)
        const clickResult = await debuggerClick(tab.id, el.x, el.y);
        return {
          // MAALT 9/9 (issue #19, fjerde gang samme fejlklasse efter select_option og fill):
          // `ok: true` stod hardkodet, og `landed` blev spredt ind bagefter. Klikket svarede
          // altsaa ja og nej i samme aandedrag, og en agent laeser `ok`.
          // Et element der forsvandt ER en virkning — derfor tæller `detached` som landet.
          ok: klikLandede(clickResult),
          method: el.method || 'debugger',
          tag: el.tag,
          text: el.text,
          // MAALT 21/8: `landed` blev allerede beregnet inde i debuggerClick og smidt vaek,
          // saa `click` svarede ok:true selv naar siden slet ikke reagerede. Nu foelger den med:
          // landed=false betyder "eventet blev sendt, men intet handler tog imod det".
          ...(clickResult || {}),
        };
      } catch (e) {
        // Fallback: synthetic click via chrome.scripting for anti-automation sites
        // (Apple ASC etc.) OR user-blocked-debugger scenarios.
        //
        // MÅLT 29/7: betingelsen var kun /Debugger detached/, men den HYPPIGSTE fejl hedder
        // "Debugger attach failed after 3 attempts" (kastes l.298) — altså når Chrome nægter
        // at koble debuggeren på overhovedet. De to strenge ligner hinanden og betyder næsten
        // det samme, men regexet ramte kun den ene, så fallbacken fyrede aldrig i det tilfælde
        // den var skrevet til: "user-blocked-debugger scenarios" står ordret i kommentaren
        // ovenfor, og det var netop dét den ikke dækkede.
        //
        // Konsekvens i praksis: klikker brugeren Cancel på Chromes debugger-banner ÉN gang,
        // husker Chrome det på tværs af extension-reloads, og hvert eneste klik fejler
        // permanent — selvom scriptingClick ville have virket hele tiden. Den bruger `func:`
        // og ikke en kode-streng, så den rammes ikke af sidens CSP.
        //
        // Prisen ved fallbacken er at klikket mister isTrusted=true. Det tjekker de færreste
        // sider, og et klik der virker på 95% af nettet slår et klik der aldrig virker.
        // MAALT 10/9 af Astra (anden runde), reproduceret: museknappen var sendt ned og op, CDP meldte
        // derefter afkobling - og reserveloesningen klikkede EN GANG TIL. To effekter, ok:true. Er
        // trykket sendt, kan klikket vaere landet; saa klikkes der ikke igen.
        if (e?.trykSendt) {
          return {
            ok: false, error: e.message, maaske_landet: true, method: 'debugger',
            note: 'Museklikket blev sendt, men debuggeren koblede fra bagefter. Klikket KAN vaere landet, ' +
                  'saa det gentages ikke. Tjek siden foer du klikker igen.',
          };
        }
        // MAALT 11/9 i Chrome for Testing: en fane i baggrunden faar ikke Input.* - musebevaegelsen udloeber FOER
        // trykket er sendt. Intet klik kan vaere landet (trykSendt er falsk, se ovenfor), saa script-klikket er sikkert.
        const inputFristFoerTryk = /svarede ikke inden \d+ ms: Input\./.test(e?.message || '');
        if (inputFristFoerTryk || /Debugger detached|Debugger attach failed|not attached/i.test(e?.message || '')) {
          // Ingen "ny adresse = klikket navigerede"-regel her. Astra (efterproevning af c1496d4): en UAFHAENGIG navigation
          // fjernede rammen foer scriptet koerte, og reglen svarede ok:true med nul handlinger. En afvisning beviser ikke at
          // scriptet koerte, og en ny adresse beviser ikke at det var klikket.
          const r = await scriptingClick(tab.id, params.selector);
          if (r.ok && !inputFristFoerTryk) {
            // Debuggeren var blokeret eller afkoblet: samme svar som 1.29.0. landed vedlaegges kun naar klikket er bevist - Astra
            // (efterproevning af c826f63): en menu der aabnede paa mousedown, blev ellers meldt som landed:false.
            return { ok: true, method: 'scripting-fallback', tag: r.tag, ...(klikLandede(r) ? { landed: true } : {}) };
          }
          if (r.ok) {
            // Sign-off 11/9 (Astra og Fable): paa en baggrundsfane svarede reserven ok:true, ogsaa naar siden intet gjorde
            // (handler der kraever isTrusted). 1.29.0 svarede med en fejl. Nu kraever ok samme bevis som de andre klikveje.
            // Viste siden ingen reaktion, er klikket alligevel sendt - saa det meldes som "kan vaere landet", ikke gentag blindt.
            if (klikLandede(r)) {
              return {
                ok: true, method: 'scripting-fallback', tag: r.tag, landed: true,
                note: 'Fanen var i baggrunden, saa musehaendelser naaede ikke frem. Klikket blev udfoert med et script i stedet.',
              };
            }
            return {
              ok: false, method: 'scripting-fallback', tag: r.tag, landed: false, maaske_landet: true, error: e.message,
              note: 'Fanen var i baggrunden, saa musehaendelser naaede ikke frem. Et script-klik blev sendt, men klikket selv ' +
                    'gav ingen synlig virkning: enten kraever siden et aegte klik, eller klikket virkede uden synlig aendring. Tjek siden, ' +
                    'og kald browser_switch_tab og klik igen kun hvis intet skete.',
            };
          }
        }
        throw e;
      }
    }

    case 'fill': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const parsed = parseSelector(params.selector);

      // For text-based selectors, click the element first then type
      if (parsed.type === 'text') {
        const el = await resolveElement(tab.id, params.selector);
        if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
        await debuggerClick(tab.id, el.x, el.y);
        await new Promise(r => setTimeout(r, 100));
        await debuggerType(tab.id, params.value);
        return { ok: true, method: 'debugger' };
      }

      // Always use debugger for input/textarea — React/Angular/Vue need real keyboard events
      try {
        await debuggerFill(tab.id, parsed.selector, params.value);
        return { ok: true, method: 'debugger' };
      } catch (e) {
        // MAALT 10/9 af Astra: debugger-vejen timede ud, og reserveloesningen skrev saa hele
        // vaerdien med den native setter. Men Promise.race afbryder ikke — tastetrykkene fra
        // debugger-forsoeget kan lande BAGEFTER. Reproduceret: "X" blev til "XX", og kaldet
        // svarede ok:true. To regler: er vaerdien der allerede efter en frist, er vi faerdige;
        // og efter reserveloesningen laeses feltet igen, saa en fordobling ses i stedet for
        // at blive meldt som succes.
        const laesFelt = async () => {
          const r = await safeExecuteScript(tab.id, (sel) => {
            const el = document.querySelector(sel);
            return el && 'value' in el ? el.value : null;
          }, [parsed.selector]).catch(() => null);
          return r && !r.cspBlocked ? r.result : null;
        };
        const fristUdloeb = /svarede ikke inden/.test(e?.message || '');
        if (fristUdloeb) await new Promise((r) => setTimeout(r, 400));
        // MAALT 11/9 af Astra (R5 F1): feltet laeses FOER reserveloesningen skriver. Det er det der skiller en
        // side der afviste vaerdien (feltet stod stille) fra en side der formaterede den (feltet aendrede sig).
        const foer = await laesFelt();
        if (fristUdloeb && foer === params.value) {
          return { ok: true, method: 'debugger', note: 'landede trods fristen' };
        }
        // Fallback to executeScript if debugger fails
        const scriptResult = await safeExecuteScript(tab.id, (sel, val) => {
          const el = document.querySelector(sel);
          if (!el) return { ok: false, error: 'Element not found: ' + sel };
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          el.focus();
          // Use nativeInputValueSetter to bypass React controlled input
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(el, val); else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        }, [parsed.selector, params.value]);
        if (scriptResult.cspBlocked) return { ok: false, error: e.message, method: 'debugger' };
        if (!scriptResult.result?.ok) return scriptResult.result;
        await new Promise((r) => setTimeout(r, 300));
        const endelig = await laesFelt();
        // Kun to sluttilstande er fejl. FORDOBLET: et forsinket Input.insertText landede efter
        // setteren ("X" -> "XX", reproduceret). TOEMT: et forsinket Cmd+A/Backspace ryddede feltet
        // igen. Alt andet — "5" der bliver til "5,00 kr", et telefonnummer med mellemrum — er
        // feltets egen formatering og maa ikke meldes som fejl.
        const v = String(params.value ?? '');
        if (typeof endelig === 'string' && endelig !== v) {
          const fordoblet = endelig === v + v || (v.length >= 3 && endelig.includes(v + v));
          if (fordoblet || (v && endelig === '')) {
            return {
              ok: false, method: 'fallback', error: fordoblet ? 'feltet-fordoblet' : 'feltet-toemt',
              forventet: v, faktisk: endelig,
              note: 'Et forsinket tastetryk fra debugger-forsoeget landede efter reserveloesningen.',
            };
          }
          // Anden runde: "OLD" efter fill("NEW") blev kaldt formatering. Tredje og fjerde runde: hver regel for
          // "det er bare formatering" havde huller ("5" -> "15", "1.5" -> "15", Unicode-minus, "+45" -> "+1 45").
          // Femte runde (R5 F1): at melde ENHVER afvigelse som fejl gjorde korrekt formatering ("1.234,50 kr",
          // "+45 12 34 56 78") til ok:false, hvor 1.29.0 sagde ok. Skellet maales nu i stedet for at gaettes:
          //   stod feltet stille (foer === efter)  -> uvist, og det siges: afviger + uaendret (se nedenfor)
          //   aendrede det sig til noget andet     -> ok:true, men afviger:true med den faktiske vaerdi
          // Kalderen faar altsaa aldrig en tavs succes paa en anden vaerdi end den der blev skrevet.
          // Sign-off 11/9 (Astra og Fable, begge reproduceret): feltet viste allerede "1.234,50 kr", fill("1234.5")
          // blev formateret tilbage til praecis det samme, og svaret var "siden tog ikke imod vaerdien" (1.29.0: ok).
          // Foer = efter kan ikke skelne en afvisning fra en vaerdi der allerede stod der i sidens format.
          // Kun en toemning der ikke skete er entydig: intet format goer "" til noget andet.
          if (typeof foer === 'string' && endelig === foer) {
            if (!v) {
              return {
                ok: false, method: 'fallback', error: 'feltet-viser-andet', forventet: v, faktisk: endelig,
                note: 'Feltet skulle toemmes, men viser det samme som foer.',
              };
            }
            return {
              ok: true, method: 'fallback', value: endelig, afviger: true, uaendret: true, forventet: v, faktisk: endelig,
              note: 'Feltet viste det samme foer og efter skrivningen. Enten stod vaerdien der allerede i sidens eget ' +
                    'format, eller siden tog ikke imod den. Tjek `faktisk` foer du gaar videre.',
            };
          }
          return {
            ok: true, method: 'fallback', value: endelig, afviger: true, forventet: v, faktisk: endelig,
            ...(typeof foer === 'string' ? {} : { foer_ukendt: true }),
            note: 'Feltet aendrede sig, men viser en anden tekst end den der blev skrevet - fx formatering ' +
                  '("5,00 kr", "+45 12 34 56 78") eller en afkortning. Tjek `faktisk`, hvis den praecise vaerdi betyder noget.',
          };
        }
        return {
          ok: true, method: 'fallback', value: endelig ?? v,
          ...(typeof endelig === 'string' ? {} : { verificeret: false }),
        };
      }
    }

    case 'set_date': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
        return { ok: false, error: 'date must be ISO format YYYY-MM-DD, got: ' + params.date };
      }

      const info = await getDateInputInfo(tab.id, params.selector);
      if (!info.found) return { ok: false, error: 'Element not found: ' + params.selector };

      const tried = [];
      const iso = params.date;

      // Path A: native <input type="date"> or <input type="datetime-local">
      if (info.tag === 'INPUT' && (info.inputType === 'date' || info.inputType === 'datetime-local')) {
        await setDateNative(tab.id, params.selector, iso);
        await new Promise(r => setTimeout(r, 200));
        const v = await readBackValue(tab.id, params.selector);
        tried.push({ path: 'native', value: v });
        if (v && v.startsWith(iso)) return { ok: true, method: 'native', value: v };
      }

      // Path B: masked text input — parse format and type via Input.insertText
      if (info.tag === 'INPUT' && !info.readOnly && !info.disabled) {
        const fmt = parsePlaceholderFormat(info.placeholder) || parsePlaceholderFormat(info.ariaLabel);
        if (fmt) {
          try {
            await setDateMaskedTyping(tab.id, params.selector, iso, fmt);
            await new Promise(r => setTimeout(r, 250));
            const v = await readBackValue(tab.id, params.selector);
            tried.push({ path: 'masked', format: fmt.order.join(fmt.sep), value: v });
            if (valueLooksLikeIso(v, iso, fmt)) return { ok: true, method: 'masked', value: v, format: fmt.order.join(fmt.sep) };
          } catch (e) {
            // MAALT 10/9 af Astra: en frist her betyder ikke at intet skete. Tastetrykkene kan
            // allerede staa i feltet, og saa ville kalender-vejen nedenfor saette datoen EN GANG
            // TIL. Laes feltet foer vi proever noget andet.
            const v = await readBackValue(tab.id, params.selector).catch(() => null);
            tried.push({ path: 'masked', error: e.message, value: v });
            if (valueLooksLikeIso(v, iso, fmt)) {
              return { ok: true, method: 'masked', value: v, format: fmt.order.join(fmt.sep), note: 'landede trods fejl i afsendelsen' };
            }
          }
        } else {
          tried.push({
            path: 'masked',
            skipped: true,
            reason: 'no-parseable-format',
            placeholder: info.placeholder,
            ariaLabel: info.ariaLabel,
          });
        }
      } else {
        tried.push({
          path: 'masked',
          skipped: true,
          reason: info.tag !== 'INPUT' ? 'not-input-element' : (info.readOnly ? 'readonly' : 'disabled'),
        });
      }

      // Path C: calendar-picker navigation
      if (!params.skip_picker) {
        // Fjerde runde (Astra): kalender-grenen glemte feltets format, saa 01/12/2026 blev godkendt som 12. januar.
        const kendtFormat = parsePlaceholderFormat(info.placeholder) || parsePlaceholderFormat(info.ariaLabel);
        const r = await setDatePicker(tab.id, params.selector, iso);
        await new Promise(r2 => setTimeout(r2, 200));
        const v = await readBackValue(tab.id, params.selector);
        tried.push({ path: 'picker', ...r, value: v });
        if (r.ok && valueLooksLikeIso(v, iso, kendtFormat)) return { ok: true, method: 'picker', value: v, navAttempts: r.navAttempts };
      }

      const visibleErrors = await collectVisibleErrors(tab.id, params.selector);
      const finalValue = await readBackValue(tab.id, params.selector);
      return {
        ok: false,
        error: 'all-paths-failed',
        tried,
        current_value: finalValue,
        visible_errors: visibleErrors,
        input_info: info,
      };
    }

    case 'dismiss_overlays': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const scope = params.scope || 'non_critical';
      const maxPasses = params.max_passes ?? 3;
      const r = await dismissOverlays(tab.id, scope, maxPasses);
      return { ok: true, dismissed: r.dismissed, skipped: r.skipped, count: r.dismissed.length };
    }

    case 'set_combobox': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      if (!params.selector) return { ok: false, error: 'selector required' };
      if (!params.values && !params.value) return { ok: false, error: 'value or values required' };
      const values = params.values || [params.value];
      const r = await setCombobox(tab.id, params.selector, values, {
        multi: !!params.multi,
        query_chars: params.query_chars,
        // MAALT 22/8: wait_ms blev tavst kasseret her. Skemaet lover parameteren, og
        // setCombobox laeser opts.wait_ms — men handleren videregav den ikke, saa
        // ventetiden stod altid paa standarden 3000 ms. En agent der bad om laengere
        // tid til en langsom liste fik den ikke, og fik ingen besked om det.
        wait_ms: params.wait_ms,
      });
      const visibleErrors = r.ok ? [] : await collectVisibleErrors(tab.id, params.selector);
      return r.ok ? r : { ...r, visible_errors: visibleErrors };
    }

    case 'drop_file': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const files = Array.isArray(params.files) ? params.files
                  : [params.files || params.file || params.file_path].filter(Boolean);
      if (!files[0]) return { ok: false, error: 'files or file required' };
      return await dropFileOnTarget(tab.id, params.selector || 'body', files);
    }

    case 'wait': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const timeout = params.timeout || 10000;
      const sel = params.selector;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        // Text-based selectors use debugger directly
        if (sel.startsWith('text=') || sel.match(/^\w+:text\(/)) {
          const el = await resolveElement(tab.id, sel);
          if (el) return { found: true, method: 'debugger' };
        } else {
          const scriptResult = await safeExecuteScript(tab.id, (s) => !!document.querySelector(s), [sel]);
          if (scriptResult.cspBlocked) {
            const found = await debuggerEval(tab.id, `!!document.querySelector(${JSON.stringify(sel)})`);
            if (found) return { found: true, method: 'debugger' };
          } else if (scriptResult.result) {
            return { found: true };
          }
        }
        await new Promise(r => setTimeout(r, 500));
      }
      return { found: false };
    }

    case 'press_key': {
      // EKSPERIMENT 21/8: aktiverer IKKE fanen. Kommentaren her sagde at Chrome ellers
      // sender tastetrykket til den aktive fane — det maales nu i stedet for at antages.
      const tab = await getSessionTab(port, false);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const key = params.key; // e.g. "Enter", "Tab", "Escape", "ArrowDown"
      const modifiers = (params.ctrl ? 2 : 0) | (params.alt ? 1 : 0) | (params.shift ? 8 : 0) | (params.meta ? 4 : 0);

      // v1.22: Chrome requires windowsVirtualKeyCode for navigation/system keys to trigger
      // scroll/form-submit behavior. Without these, key-event is dispatched but page doesn't react.
      const VK_CODES = {
        'Backspace': 8, 'Tab': 9, 'Enter': 13, 'Shift': 16, 'Control': 17, 'Alt': 18,
        'Escape': 27, 'Space': 32, ' ': 32,
        'PageUp': 33, 'PageDown': 34, 'End': 35, 'Home': 36,
        'ArrowLeft': 37, 'ArrowUp': 38, 'ArrowRight': 39, 'ArrowDown': 40,
        'Delete': 46,
      };
      const vkCode = VK_CODES[key];
      const vkParams = vkCode ? { windowsVirtualKeyCode: vkCode, nativeVirtualKeyCode: vkCode } : {};

      // MAALT 10/9 af Astra: keyDown og keyUp stod i samme try. Timede keyDown ud — og det
      // kan det, selv naar tasten LANDEDE (Enter der sender en formular) — blev keyUp aldrig
      // sendt. En tast der kun er trykket ned, er en tast der haenger. Nu sendes keyUp altid,
      // og svaret siger om nedtrykket fejlede i stedet for at kaste raat.
      await debuggerAttach(tab.id);
      let tastFejl = null;
      try {
        try {
          await cdpSend(tab.id, 'Input.dispatchKeyEvent', {
            type: 'keyDown',
            key,
            code: params.code || key,
            modifiers,
            text: key.length === 1 ? key : '',
            ...vkParams,
          });
        } catch (e) { tastFejl = e; }
        try {
          await cdpSend(tab.id, 'Input.dispatchKeyEvent', {
            type: 'keyUp',
            key,
            code: params.code || key,
            modifiers,
            ...vkParams,
          });
        } catch (e) { if (!tastFejl) tastFejl = e; }
      } finally {
        await debuggerDetach(tab.id);
      }
      if (tastFejl) {
        const frist = /svarede ikke inden/.test(tastFejl.message || '');
        return {
          ok: false, key, error: tastFejl.message,
          ...(frist ? { maaske_landet: true,
            note: 'Chrome kvitterede ikke inden fristen. Tasten kan alligevel have virket ' +
                  '(fx en formular der blev sendt) — tjek siden foer du trykker igen.' } : {}),
        };
      }
      return { ok: true, key };
    }

    case 'scroll': {
      // v1.22: NO activate — CDP Input.dispatchMouseEvent goes via debugger directly to target,
      // doesn't need active tab. Re-activating on every scroll-call destabilizes debugger.
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      // Scroll to element
      if (params.selector) {
        const el = await resolveElement(tab.id, params.selector);
        if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
        return { ok: true, scrolled_to: params.selector };
      }
      // Scroll by pixels using CDP mouseWheel — split into smaller steps so IntersectionObservers fire.
      // FB/Twitter/IG only trigger lazy-load on continuous wheel events, not a single large delta.
      const dx = params.x || 0;
      const dy = params.y || 0;
      // Hvor stod siden FOER vi roerte den? Uden det tal kan reserveloesningen ikke vide
      // hvor meget hjulet naaede, og ender med at rulle for langt.
      // MAALT 10/9: her stod `.catch(() => ({x:0,y:0}))`. Et opdigtet nulpunkt er vaerre end
      // ingen: stod siden paa 500 og laesningen fejlede, ville reserveloesningen rulle OP.
      const start = await debuggerEval(tab.id, '({x: window.scrollX, y: window.scrollY})')
        .catch(() => null);
      const startKendt = !!start && typeof start.y === 'number';
      const startX = startKendt ? start.x : 0, startY = startKendt ? start.y : 0;
      try {
        await debuggerAttach(tab.id);
        const STEP_SIZE = 300; // pixels per wheel-event (matches a typical mouse-wheel notch)
        const totalSteps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / STEP_SIZE));
        const stepX = dx / totalSteps;
        const stepY = dy / totalSteps;
        for (let i = 0; i < totalSteps; i++) {
          await cdpSend(tab.id, 'Input.dispatchMouseEvent', {
            type: 'mouseWheel', x: 400, y: 300, deltaX: stepX, deltaY: stepY,
          });
          // Small delay between wheel-events so IntersectionObserver + lazy-load XHRs can fire
          if (i < totalSteps - 1) await new Promise(r => setTimeout(r, 80));
        }
        // After last wheel-event, give FB/Twitter/IG ~600ms to start lazy-load XHRs
        // before any subsequent commands run (caller often scrapes immediately after)
        await new Promise(r => setTimeout(r, 600));
      } catch (e) {
        // MAALT 9/9 af reviewet: her stod `window.scrollBy(dx, dy)` — altsaa "rul det HELE igen".
        // Promise.race afbryder ikke det kald den opgiver, saa hjultrin der allerede virkede
        // bliver liggende. Reproduceret: scroll({y:600}), foerste trin flyttede 300 uden at
        // kvittere, fallbacken lagde 600 oveni = 900 faktisk, 600 rapporteret.
        // scrollTo mod en beregnet MAAL-position er idempotent: har hjulet allerede rullet
        // halvdelen, ruller vi kun resten.
        // MAALT 10/9 af Astra, i MIN egen rettelse fra fire timer foer: her stod
        // `.catch(() => null)` og derefter `ok: true` ubetinget. Fejlede ogsaa
        // reserveloesningen, svarede vaerktoejet succes med nul rullede pixels.
        // Femte gang samme fejlklasse paa én dag — og den her var min.
        // MAALT 10/9 af Astra (anden runde), reproduceret: kunne starten ikke laeses, blev der
        // rullet RELATIVT - og hjultrin der allerede var landet blev lagt oveni (500 -> 1400 ved
        // y:600). Flaget start_ukendt dokumenterede risikoen uden at forhindre den. Uden kendt
        // start findes ingen rulning der kan gentages uden at rulle dobbelt, saa der rulles ikke.
        if (!startKendt) {
          return {
            ok: false, method: 'fallback', error: 'scroll-uvist', start_ukendt: true, hjul_fejl: e.message,
            hint: 'Hjul-kaldet svarede ikke, og startpositionen kunne ikke laeses, saa siden KAN have ' +
                  'rullet. Laes window.scrollY med browser_execute_script, og rul derefter det der mangler.',
          };
        }
        const landede = await debuggerEval(tab.id, `(() => {
          const foer = { x: window.scrollX, y: window.scrollY };
          window.scrollTo(${startX} + ${dx}, ${startY} + ${dy});
          return { foer, efter: { x: window.scrollX, y: window.scrollY } };
        })()`).catch((fejl) => ({ fejl: fejl?.message || String(fejl) }));

        if (!landede || landede.fejl) {
          return {
            ok: false, method: 'fallback', error: 'scroll-mislykkedes',
            hjul_fejl: e.message,
            fallback_fejl: landede?.fejl || 'reserveloesningen svarede ikke',
          };
        }
        // MAALT 11/9 af Astra (e2e-review): med blød rulning (scroll-behavior: smooth) naar siden foerst maalet over de naeste
        // billeder. Laest i samme oejeblik blev en rulning der lykkedes meldt som "bunden er maaske naaet" (1.29.0: ok).
        // Positionen laeses igen hvert 100 ms, til maalet er naaet eller siden staar stille - hoejst ca. 1 s.
        // Astra (efterproevning af c826f63): bundet af et ANTAL forsoeg kom en side med langsomme opslag over serverens 30 s
        // (1.29.0: svar efter 3 s). Genlaesningen er bundet af tid.
        const roSlut = Date.now() + 1000;
        while (Date.now() < roSlut && !(landede.efter.x === startX + dx && landede.efter.y === startY + dy)) {
          await new Promise((r) => setTimeout(r, 100));
          const nu = await debuggerEval(tab.id, '({x: window.scrollX, y: window.scrollY})').catch(() => null);
          if (!nu || typeof nu.y !== 'number') break;
          const stille = nu.x === landede.efter.x && nu.y === landede.efter.y;
          landede.efter = nu;
          if (stille) break;
        }
        const flyttede = landede.efter.x !== landede.foer.x || landede.efter.y !== landede.foer.y;
        const alleredeFremme = !flyttede && startKendt &&
          landede.efter.x === startX + dx && landede.efter.y === startY + dy;
        return {
          ok: flyttede || alleredeFremme,
          method: 'fallback', fallback_reason: e.message,
          position: landede.efter, foer: landede.foer,
          ...(flyttede || alleredeFremme ? {} : { note: 'siden flyttede sig ikke — bunden er maaske naaet' }),
        };
      }
      return { ok: true, scrolled: { x: dx, y: dy }, method: 'mouseWheel-stepped' };
    }

    // ── v1.26 "superior" tools ──────────────────────────────────────────────
    // to the MCP server — only lengths and shape booleans. Born from the 2026-07-27
    // Azure-secret night: the agent must be able to move a credential from page to
    // field without the value ever entering the LLM context or transcript.

    case 'double_click': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const el = await resolveElement(tab.id, params.selector);
      if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
      await debuggerAttach(tab.id);
      const { x, y } = el;
      await cdpSend(tab.id, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await new Promise(r => setTimeout(r, 30));
      // Proper dblclick: two press/release pairs with escalating clickCount.
      await dispatchTaalmodigt(tab.id, { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await dispatchTaalmodigt(tab.id, { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      await new Promise(r => setTimeout(r, 40));
      await dispatchTaalmodigt(tab.id, { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 2 });
      await dispatchTaalmodigt(tab.id, { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 2 });
      return { ok: true, double_clicked: true, tag: el.tag, text: el.text };
    }

    case 'right_click': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const el = await resolveElement(tab.id, params.selector);
      if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
      await debuggerAttach(tab.id);
      const { x, y } = el;
      await cdpSend(tab.id, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await new Promise(r => setTimeout(r, 30));
      await dispatchTaalmodigt(tab.id, { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
      await dispatchTaalmodigt(tab.id, { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
      return { ok: true, right_clicked: true, tag: el.tag, text: el.text, note: 'contextmenu event fired; native Chrome menu does not open via CDP — page-level menus (OWA, web apps) do' };
    }

    case 'click_xy': {
      // Raw coordinate click — the escape hatch for custom widgets whose buttons
      // resist every selector strategy (Azure portal dialogs, KO-bound divs).
      // Coordinates come from the caller's own screenshot analysis.
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      if (typeof params.x !== 'number' || typeof params.y !== 'number') {
        return { ok: false, error: 'x and y (numbers, CSS pixels in viewport) are required' };
      }
      // MAALT 10/9: debuggerClick maaler om klikket landede, men svaret blev smidt vaek og
      // `ok: true` stod hardkodet — samme fejl som `click` havde (issue #19). Samme regel her.
      let klik;
      try {
        klik = await debuggerClick(tab.id, params.x, params.y);
      } catch (e) {
        // Samme regel som click (Astra, tredje runde): er museknappen sendt, kan klikket vaere landet -
        // og en kastet fejl mister markeringen over forbindelsen.
        if (e?.trykSendt) {
          return {
            ok: false, error: e.message, maaske_landet: true, clicked_at: { x: params.x, y: params.y },
            note: 'Museklikket blev sendt, men debuggeren fejlede bagefter. Klikket KAN vaere landet, ' +
                  'saa det gentages ikke. Tjek siden foer du klikker igen.',
          };
        }
        throw e;
      }
      return {
        ok: klikLandede(klik),
        clicked_at: { x: params.x, y: params.y },
        ...(klik || {}),
      };
    }

    case 'reattach_debugger': {
      // Ghost-attach recovery without full extension reload: force detach + fresh attach.
      const tab = await getSessionTab(port);
      try { await chrome.debugger.detach({ tabId: tab.id }); } catch {}
      await new Promise(r => setTimeout(r, 150));
      await debuggerAttach(tab.id);
      return { ok: true, reattached: true, tab_id: tab.id };
    }

    case 'hover': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const el = await resolveElement(tab.id, params.selector);
      if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
      await debuggerAttach(tab.id);
      try {
        await cdpSend(tab.id, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: el.x, y: el.y,
        });
        // Hold hover for duration (default 500ms) so menus/tooltips appear
        await new Promise(r => setTimeout(r, params.duration || 500));
      } finally {
        await debuggerDetach(tab.id);
      }
      return { ok: true, tag: el.tag, text: el.text };
    }

    case 'select_option': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');

      // Strategy: handle native <select> and custom dropdowns differently
      const isNativeSelect = await debuggerEval(tab.id, `
        (function() {
          const el = document.querySelector(${JSON.stringify(params.selector)});
          return el?.tagName === 'SELECT';
        })()
      `);

      // `value` og `label` accepteres som alias for `option`. Uden dem gav et forkert
      // navn "undefined" som soegetekst — og vaerktoejet svarede alligevel ok:true.
      const oensket = params.option ?? params.value ?? params.label;
      if (typeof oensket !== 'string' || !oensket) {
        return { ok: false, error: 'Manglende `option` (teksten eller vaerdien paa den mulighed der skal vaelges).' };
      }

      if (isNativeSelect) {
        // MAALT 21/8: her blev resultatet af evalueringen — `return !!opt` — kastet vaek,
        // og handleren svarede ubetinget ok:true. Blev muligheden ikke fundet, skete der
        // INTET, og svaret sagde stadig at det var lykkedes. Samme fejlklasse som klikket
        // der svarede ok:true uden at siden reagerede. Nu laeses svaret, og der laeses
        // TILBAGE fra feltet bagefter, saa "valgt" betyder at vaerdien faktisk staar der.
        // MAALT 8/9 paa forbrugeragenten.dk/penge-tilbage: her laa en anden fejl af samme
        // familie. Vagten laeste `sel.value` SYNKRONT lige efter dispatch og kaldte enhver
        // afvigelse "rullet tilbage". Men et React-styret felt der ARBEJDER ser praecis
        // saadan ud: onChange koerer, komponenten gemmer valget et andet sted og nulstiller
        // sin egen `value`. Vi maalte altsaa succes som fiasko — og sagde ok:false om et
        // valg der faktisk landede (chippen "Norlys Energi ×" stod paa siden bagefter).
        //
        // Det er den omvendte udgave af issue #19, og rettelsen er den samme som issuet
        // beder om: maal EFFEKTEN, ikke feltet. Aendrede resten af siden sig, gjorde
        // komponenten sit arbejde — uanset hvad feltet staar paa nu.
        const aftryk = `(function(el){
          return el.options.length + '|' + (el.form ? el.form.innerText.length : document.body.innerText.length);
        })(document.querySelector(${JSON.stringify(params.selector)}))`;

        const valg = await debuggerEval(tab.id, `
          (function() {
            const sel = document.querySelector(${JSON.stringify(params.selector)});
            if (!sel) return JSON.stringify({ found: false, error: 'select ikke fundet' });
            const oensket = ${JSON.stringify(oensket)};
            const opt = Array.from(sel.options).find(o => o.value === oensket)
                     || Array.from(sel.options).find(o => o.text.trim() === oensket)
                     || Array.from(sel.options).find(o => o.text.includes(oensket));
            if (!opt) {
              return JSON.stringify({ found: false, error: 'Ingen mulighed matchede: ' + oensket,
                available: Array.from(sel.options).map(o => o.text.trim()).slice(0, 25) });
            }
            const foer = ${aftryk};
            sel.value = opt.value;
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return JSON.stringify({ found: true, wanted: opt.value, actual: sel.value, text: opt.text.trim(), foer });
          })()
        `);
        let r; try { r = JSON.parse(valg); } catch { r = null; }
        if (!r) return { ok: false, type: 'native_select', error: 'Kunne ikke laese resultatet af valget' };
        if (!r.found) return { ok: false, type: 'native_select', error: r.error, available: r.available };

        if (r.actual === r.wanted) return { ok: true, type: 'native_select', selected: r.text, value: r.actual };

        // Feltet holder ikke vaerdien. Giv rammen tid til at gen-rendere, og se saa efter
        // om NOGET andet aendrede sig. Gjorde det det, blev valget taget imod.
        await new Promise((res) => setTimeout(res, 150));
        const efter = await debuggerEval(tab.id, `
          (function() {
            const sel = document.querySelector(${JSON.stringify(params.selector)});
            if (!sel) return JSON.stringify({ vaerdi: null, aftryk: null });
            return JSON.stringify({ vaerdi: sel.value, aftryk: ${aftryk} });
          })()
        `);
        let e; try { e = JSON.parse(efter); } catch { e = null; }

        if (e && e.vaerdi === r.wanted) {
          return { ok: true, type: 'native_select', selected: r.text, value: e.vaerdi };
        }
        if (e && e.aftryk && r.foer && e.aftryk !== r.foer) {
          return {
            ok: true, type: 'native_select', selected: r.text, value: e.vaerdi,
            note: `Feltet nulstillede sig selv til "${e.vaerdi}", men siden reagerede — ` +
                  'et styret felt der gemmer valget et andet sted. Valget landede.',
          };
        }
        return { ok: false, type: 'native_select',
          error: `Valget blev rullet tilbage: satte "${r.wanted}", feltet staar paa "${e ? e.vaerdi : r.actual}", ` +
                 'og intet andet paa siden aendrede sig.' };
      }

      // Custom dropdown (Angular Material, React Select, etc.)
      // Step 1: Click the trigger to open
      const trigger = await resolveElement(tab.id, params.selector);
      if (!trigger) return { ok: false, error: 'Dropdown trigger not found: ' + params.selector };
      await debuggerClick(tab.id, trigger.x, trigger.y);

      // Step 2: Wait for options to appear
      await new Promise(r => setTimeout(r, params.wait || 300));

      // Step 3: Find and click the option by text
      const option = await resolveElement(tab.id, `text=${oensket}`);
      if (!option) return { ok: false, error: 'Option not found: ' + oensket };
      const valgKlik = await debuggerClick(tab.id, option.x, option.y);

      // MAALT 22/8 ved review: aerlighedsfixet blev kun anvendt paa native-grenen
      // ovenfor. Her stod stadig `return { ok: true }` ubetinget, selv om resultatet
      // af klikket var beregnet og smidt vaek — praecis den fejl der blev lukket to
      // gange andre steder samme dag. En brugerdefineret dropdown hvor klikket ikke
      // blev taget imod, meldte altsaa stadig succes.
      // MAALT 22/8 (tredje gang samme fejlklasse): `ok: true` stod hardkodet, og `landed`
      // blev blot spredt ind ved siden af. En dropdown hvor klikket ikke blev taget imod
      // svarede altsaa {ok:true, landed:false} — og agenten laeser ok. Beskrivelsen lover
      // ordret "it never reports success without the field actually changing".
      return {
        ...(valgKlik || {}),
        ok: klikLandede(valgKlik),
        type: 'custom_dropdown',
        selected: oensket,
        ...(!klikLandede(valgKlik)
          ? { error: 'Klikket paa muligheden blev ikke taget imod af siden: ' + oensket }
          : {}),
      };
    }

    case 'handle_dialog': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const action = params.action === 'dismiss' ? 'dismiss' : 'accept';
      const promptText = params.text || '';
      const vent = params.wait === true;              // gammel, blokerende adfaerd
      const levetid = params.timeout || 60000;

      await debuggerAttach(tab.id);
      await cdpSend(tab.id, 'Page.enable', {});
      afvaebnDialog(tab.id, 'en ny armering overtog denne fane');   // kun én ad gangen

      let opfyld;
      const svar = new Promise((resolve) => { opfyld = resolve; });

      const listener = (source, method, eventParams) => {
        if (source.tabId !== tab.id || method !== 'Page.javascriptDialogOpening') return;
        afvaebnDialog(tab.id);   // uden grund: vi svarer selv lige nedenfor
        cdpSend(tab.id, 'Page.handleJavaScriptDialog', {
          accept: action === 'accept',
          promptText,
        })
          .then(() => opfyld({ ok: true, dialog_type: eventParams.type, message: eventParams.message, action }))
          .catch((e) => opfyld({ ok: false, error: e.message }));
      };

      const timer = setTimeout(() => {
        afvaebnDialog(tab.id);
        opfyld({ ok: false, error: `Ingen dialog dukkede op inden for ${levetid} ms` });
      }, levetid);

      armeredeDialoger.set(tab.id, { listener, timer, action, opfyld });
      dialogLoefter.set(tab.id, svar);
      chrome.debugger.onEvent.addListener(listener);

      if (vent) return await svar;

      // Armeret. Debuggeren bliver siddende — frakobler vi her, doer lytteren med den.
      return {
        ok: true,
        armed: true,
        action,
        expires_in_ms: levetid,
        note: 'Naeste dialog paa denne fane haandteres automatisk. Klik nu paa det der aabner den.',
      };
    }

    case 'wait_for_network': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const urlPattern = params.url_pattern || '';
      const timeout = params.timeout || 15000;
      const netFrister = netvaerkFrister();
      const budgetSlut = Date.now() + netFrister.budgetMs;

      await debuggerAttach(tab.id);
      try {
        await cdpSend(tab.id, 'Network.enable', {});

        const result = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            chrome.debugger.onEvent.removeListener(listener);
            resolve({ ok: false, error: 'No matching request within timeout' });
          }, timeout);

          const listener = (source, method, eventParams) => {
            if (source.tabId !== tab.id) return;

            if (method === 'Network.responseReceived') {
              const url = eventParams.response?.url || '';
              const status = eventParams.response?.status;
              // Match by pattern (substring match) or return any if no pattern
              if (!urlPattern || url.includes(urlPattern)) {
                chrome.debugger.onEvent.removeListener(listener);
                clearTimeout(timer);
                // Try to get response body - kun inden for vaerktoejets budget (netvaerkBudgetMs). Naar den ikke frem, er
                // svaret body:null som i 1.29.0, i stedet for at serverens 30 s loeber ud.
                const bodyKald = cdpSend(tab.id, 'Network.getResponseBody', { requestId: eventParams.requestId });
                bodyKald.catch(() => {});
                let bodyUr;
                Promise.race([
                  bodyKald,
                  new Promise((ok) => {
                    const bodyFrist = Math.min(netFrister.bodyMaxMs, Math.max(netFrister.bodyMinMs, budgetSlut - Date.now()));
                    bodyUr = setTimeout(() => ok(null), bodyFrist);
                  }),
                ]).finally(() => clearTimeout(bodyUr)).then(bodyResult => {
                  resolve({
                    ok: true,
                    url,
                    status,
                    method: eventParams.response?.requestHeaders?.[':method'] || 'GET',
                    body: bodyResult?.body?.substring(0, 5000) || null,
                  });
                }).catch(() => {
                  resolve({
                    ok: true,
                    url,
                    status,
                    method: eventParams.response?.requestHeaders?.[':method'] || 'GET',
                    body: null,
                  });
                });
              }
            }
          };
          chrome.debugger.onEvent.addListener(listener);
        });

        await cdpSend(tab.id, 'Network.disable', {});
        return result;
      } finally {
        await debuggerDetach(tab.id);
      }
    }

    case 'fetch': {
      // HTTP requests from background — NOT subject to CORS
      const options = {
        method: params.method || 'GET',
        headers: params.headers || {},
      };
      if (params.body) options.body = typeof params.body === 'string' ? params.body : JSON.stringify(params.body);
      try {
        const resp = await fetch(params.url, options);
        const text = await resp.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        return { ok: resp.ok, status: resp.status, body: json || text };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    case 'list_tabs': {
      // Return only this session's tabs
      const session = getSession(port);
      const tabs = [];
      for (const tabId of session.tabIds) {
        try {
          const tab = await chrome.tabs.get(tabId);
          tabs.push({ id: tab.id, url: tab.url, title: tab.title, active: tab.active });
        } catch {
          session.tabIds.delete(tabId);
        }
      }
      return { tabs, session: session.label, color: session.color };
    }

    case 'get_cookies': {
      // MAALT 10/9, reproduceret i selen: uden `domain` blev filteret {} — altsaa INTET
      // filter, altsaa hver eneste cookie i profilen, inklusive httpOnly-sessionscookies
      // som sidens eget JS ikke maa se. Skemaet siger required: ['domain'], men serveren
      // videresender argumenter uvalideret, saa skemaet var en henstilling.
      if (!params.domain || typeof params.domain !== 'string' || !params.domain.trim()) {
        return {
          ok: false,
          error: 'domain-mangler',
          hint: 'Angiv `domain`. Uden det ville kaldet returnere HVER cookie i profilen — ' +
                'ogsaa fra sider der intet har med opgaven at goere.',
        };
      }
      // MAALT 10/9, to runder. Foerste udgave gaettede domaeneslaegtskab ud fra fanernes
      // vaertsnavne ("a.example.com ligger under com"). Astra omgik det tre veje: en fane paa
      // https://com/ aabnede hele .com, en file://bank.example/-fane gav bankens cookies uden at
      // nogen side var aabnet, og et tomt vaertsnavn (about:blank) lod "bank.example." slippe
      // igennem. Et domaene kan man ikke raesonnere sig til uden public suffix-listen. Saa nu
      // spoerges Chrome i stedet: hvilke cookies ville du SENDE til de http(s)-sider sessionen har
      // aabne? Kun dem - og kun dem der passer paa det domaene der blev bedt om.
      const session = getSession(port);
      // Astra, tredje runde: en inkognito-fane har sit EGET cookie-lager. Uden storeId blev den
      // almindelige profils cookies laest for en inkognito-fane.
      let lagre = null;
      try { lagre = await chrome.cookies.getAllCookieStores(); } catch {}
      const lagerFor = (tabId) => (lagre || []).find((l) => (l.tabIds || []).includes(tabId))?.id;
      const sider = [];
      let ukendtLager = false;
      for (const id of session.tabIds) {
        const t = await chrome.tabs.get(id).catch(() => null);
        try {
          const u = new URL(t?.url || '');
          if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname) {
            const storeId = lagerFor(id);
            // Astra (sign-off 11/9): fejlede getAllCookieStores for en inkognitofane, blev storeId udeladt, og Chrome
            // laeste den almindelige profils lager. Kan en inkognitofanes lager ikke findes, laeses intet for den.
            if (t.incognito && !storeId) { ukendtLager = true; continue; }
            // Fanens vaertsnavn er altid ASCII (punycode). Et afsluttende punktum er en ANDEN cookie-vaert i
            // Chromium (Astra, fjerde runde: x.example. fik cookies fra x.example) - saa det bevares.
            sider.push({ u, vaert: u.hostname.toLowerCase(), storeId });
          }
        } catch {}
      }
      if (!sider.length && ukendtLager) {
        return {
          ok: false, error: 'cookie-lager-ukendt',
          hint: 'Fanen er et inkognitovindue, og Chrome oplyste ikke dens cookie-lager. Intet blev laest - ellers ville ' +
                'den almindelige profils cookies blive leveret i stedet.',
        };
      }
      const vaertsnavne = sider.map((x) => x.vaert);
      // Argumentet normaliseres som fanens adresse - "bücher.example" ER xn--bcher-kva.example.
      let d = params.domain.trim().toLowerCase().replace(/^\.+/, '');
      try { if (d) d = new URL('http://' + d + '/').hostname; } catch {}
      const slaegt = (a, b) => a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
      if (!d || !vaertsnavne.some((h) => slaegt(h, d))) {
        return {
          ok: false, error: 'domaene-ikke-i-sessionen', domain: d, aabne: vaertsnavne,
          hint: 'Cookies kan kun laeses for http(s)-sider denne session har aabne. Naviger til ' +
                'siden foerst - saa kan agenten ikke laese cookies fra noget den ikke arbejder med.',
        };
      }
      // Noeglen er et JSON-array, saa "a|b" i sti og navn ikke kan laegge to cookies sammen til én.
      const fundne = new Map();
      const med = (c, storeId) => {
        const cd = String(c.domain || '').toLowerCase().replace(/^\./, '');
        if (slaegt(cd, d)) fundne.set(JSON.stringify([storeId ?? '', c.domain, c.path, c.name]), c);
      };
      for (const side of sider) {
        const lager = side.storeId ? { storeId: side.storeId } : {};
        // Fable (sign-off 11/9): en session paa http:// fik en Secure-cookie fra overdomaenet. {url} udelader dem selv,
        // men opslagene paa {domain} kender ikke sidens protokol. Chrome sender aldrig en Secure-cookie til http.
        // Astra (efterproevning af c1496d4): Chromium regner localhost for sikker og sender Secure-cookies dertil over http.
        const sikkerVaert = side.u.protocol === 'https:' || side.vaert === 'localhost' || side.vaert.endsWith('.localhost') ||
          /^127(\.\d{1,3}){3}$/.test(side.vaert) || side.vaert === '[::1]';
        const sendesOverProtokollen = (c) => !c.secure || sikkerVaert;
        // De cookies Chrome ville SENDE til siden - inklusive overdomaenets ...
        for (const c of await chrome.cookies.getAll({ url: side.u.href, ...lager })) med(c, side.storeId);
        // ... plus sidens EGNE cookies paa alle stier (Path=/api kom ikke med ovenfor). {domain} giver
        // ogsaa underdomaener og, for et public suffix, hele suffixet - saa kun cookies hvis domaene ER
        // vaertsnavnet.
        for (const c of await chrome.cookies.getAll({ domain: side.vaert, ...lager })) {
          if (String(c.domain || '').toLowerCase().replace(/^\./, '') === side.vaert && sendesOverProtokollen(c)) med(c, side.storeId);
        }
        // MAALT 11/9 af Astra (R5 F7): overdomaenets cookie paa en anden sti (Domain=.example.com; Path=/api) kom
        // med i 1.29.0, men ikke her: {url} giver kun sidens egen sti, og {domain: vaert} holdt kun cookies hvis
        // domaene ER vaertsnavnet. Chrome spoerges nu ogsaa om det domaene der blev bedt om, og kun cookies som
        // DENNE vaert ville faa tilsendt paa en eller anden sti beholdes. En host-only-cookie sendes kun til sin
        // egen vaert, saa den skal passe praecist.
        for (const c of await chrome.cookies.getAll({ domain: d, ...lager })) {
          const cd = String(c.domain || '').toLowerCase().replace(/^\./, '');
          const sendesTilVaerten = c.hostOnly ? side.vaert === cd : (side.vaert === cd || side.vaert.endsWith('.' + cd));
          if (sendesTilVaerten && sendesOverProtokollen(c)) med(c, side.storeId);
        }
      }
      return { cookies: [...fundne.values()].map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path })) };
    }

    case 'get_local_storage': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot access chrome:// pages');
      const scriptResult = await safeExecuteScript(tab.id, (key) => key ? localStorage.getItem(key) : JSON.stringify(Object.fromEntries(Object.entries(localStorage))), [params.key || null]);
      if (!scriptResult.cspBlocked) {
        return { value: scriptResult.result };
      }
      const expr = params.key
        ? `localStorage.getItem(${JSON.stringify(params.key)})`
        : `JSON.stringify(Object.fromEntries(Object.entries(localStorage)))`;
      const value = await debuggerEval(tab.id, expr);
      return { value, method: 'debugger' };
    }

    case 'set_cookies': {
      const results = [];
      const cookieList = Array.isArray(params.cookies) ? params.cookies : [params];
      for (const c of cookieList) {
        try {
          const cookie = await chrome.cookies.set({
            url: c.url || `https://${c.domain}`,
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path || '/',
            secure: c.secure !== false,
            httpOnly: c.httpOnly || false,
            sameSite: c.sameSite || 'lax',
          });
          results.push({ ok: true, name: c.name });
        } catch (e) {
          results.push({ ok: false, name: c.name, error: e.message });
        }
      }
      return { results };
    }

    case 'set_local_storage': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot access chrome:// pages');
      const key = params.key;
      const val = params.value;
      const expr = `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(val)})`;
      try {
        const scriptResult = await safeExecuteScript(tab.id, (k, v) => { localStorage.setItem(k, v); return { ok: true }; }, [key, val]);
        if (!scriptResult.cspBlocked) return scriptResult.result;
      } catch {}
      await debuggerEval(tab.id, expr);
      return { ok: true, method: 'debugger' };
    }

    case 'console_logs': {
      const tab = await getSessionTab(port);
      const count = params.count || 50;
      try {
        await debuggerAttach(tab.id);
        await cdpSend(tab.id, 'Runtime.enable');
        // Collect console messages for a brief period
        const logs = [];
        const handler = (source, method, eventParams) => {
          if (source.tabId === tab.id && method === 'Runtime.consoleAPICalled') {
            logs.push({
              type: eventParams.type,
              text: eventParams.args?.map(a => a.value || a.description || '').join(' '),
              timestamp: eventParams.timestamp,
            });
          }
        };
        chrome.debugger.onEvent.addListener(handler);
        // Also grab existing console via page JS
        const { result } = await cdpSend(tab.id, 'Runtime.evaluate', {
          expression: `(() => {
            if (!window.__mcpConsoleLogs) {
              window.__mcpConsoleLogs = [];
              const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
              for (const [type, fn] of Object.entries(orig)) {
                console[type] = (...args) => {
                  window.__mcpConsoleLogs.push({ type, text: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), ts: Date.now() });
                  if (window.__mcpConsoleLogs.length > 200) window.__mcpConsoleLogs.shift();
                  fn.apply(console, args);
                };
              }
            }
            return JSON.stringify(window.__mcpConsoleLogs.slice(-${count}));
          })()`,
          returnByValue: true,
        });
        chrome.debugger.onEvent.removeListener(handler);
        await debuggerDetach(tab.id);
        const existing = JSON.parse(result.value || '[]');
        return { logs: [...existing, ...logs].slice(-count) };
      } catch (e) {
        try { await debuggerDetach(tab.id); } catch {}
        return { logs: [], error: e.message };
      }
    }

    case 'ask_user': {
      const tab = await getSessionTab(port, true);
      const timeout = params.timeout || 120000;
      const fields = params.fields || [];
      const hasFields = fields.length > 0;
      const session = getSession(port);

      // Activate tab + alert badge
      await chrome.tabs.update(tab.id, { active: true });
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
      const notifId = 'mcp-ask-' + Date.now();
      chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: `${session.label} - Action Required`,
        message: params.message,
        requireInteraction: true,
        silent: false,
        priority: 2,
      });

      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (message, title, fields, hasFields, timeout, sessionLabel) => {
          return new Promise((resolve) => {
            document.getElementById('a360-overlay')?.remove();

            // Notification sound — short pleasant chime
            try {
              const ctx = new AudioContext();
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.frequency.value = 880;
              osc.type = 'sine';
              gain.gain.setValueAtTime(0.3, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.4);
              // Second tone (higher, pleasant ding-dong)
              setTimeout(() => {
                const osc2 = ctx.createOscillator();
                const gain2 = ctx.createGain();
                osc2.connect(gain2);
                gain2.connect(ctx.destination);
                osc2.frequency.value = 1320;
                osc2.type = 'sine';
                gain2.gain.setValueAtTime(0.2, ctx.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
                osc2.start(ctx.currentTime);
                osc2.stop(ctx.currentTime + 0.3);
              }, 150);
            } catch {}

            // Inject animation keyframes
            if (!document.getElementById('a360-styles')) {
              const style = document.createElement('style');
              style.id = 'a360-styles';
              style.textContent = `
                @keyframes a360-fade-in { from { opacity: 0; } to { opacity: 1; } }
                @keyframes a360-slide-up { from { opacity: 0; transform: translateY(30px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
              `;
              document.head.appendChild(style);
            }

            const overlay = document.createElement('div');
            overlay.id = 'a360-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif;animation:a360-fade-in 0.3s ease-out';

            const card = document.createElement('div');
            card.style.cssText = 'background:#1e293b;border-radius:12px;padding:24px;max-width:420px;width:90%;color:#e2e8f0;box-shadow:0 20px 60px rgba(0,0,0,0.5);animation:a360-slide-up 0.4s ease-out';

            const h = document.createElement('div');
            h.style.cssText = 'font-size:14px;font-weight:600;color:#3b82f6;margin-bottom:4px';
            h.textContent = title || 'Agent360 - Action Required';
            card.appendChild(h);
            const badge = document.createElement('div');
            badge.style.cssText = 'font-size:10px;color:#94a3b8;margin-bottom:12px';
            badge.textContent = sessionLabel;
            card.appendChild(badge);
            const msg = document.createElement('div');
            msg.style.cssText = 'font-size:13px;color:#cbd5e1;margin-bottom:16px;line-height:1.5';
            msg.textContent = message;
            card.appendChild(msg);
            const inputs = {};
            if (hasFields) {
              fields.forEach(f => {
                const label = document.createElement('label');
                label.style.cssText = 'display:block;font-size:11px;color:#94a3b8;margin-bottom:4px;margin-top:8px';
                label.textContent = f.label || f.name;
                card.appendChild(label);
                const input = document.createElement('input');
                input.type = f.type || 'text';
                input.placeholder = f.label || f.name;
                input.style.cssText = 'width:100%;padding:8px 10px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box';
                input.addEventListener('focus', () => input.style.borderColor = '#3b82f6');
                input.addEventListener('blur', () => input.style.borderColor = '#334155');
                card.appendChild(input);
                inputs[f.name] = input;
              });
            }
            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px';
            const doneBtn = document.createElement('button');
            doneBtn.textContent = hasFields ? 'Submit' : '✓ Done';
            doneBtn.style.cssText = 'flex:1;padding:10px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500';
            doneBtn.addEventListener('click', () => {
              const values = {};
              Object.entries(inputs).forEach(([k, el]) => values[k] = el.value);
              overlay.remove();
              resolve({ acknowledged: true, action: 'done', values });
            });
            const skipBtn = document.createElement('button');
            skipBtn.textContent = '✗ Skip';
            skipBtn.style.cssText = 'flex:1;padding:10px;background:#334155;color:#94a3b8;border:none;border-radius:6px;font-size:13px;cursor:pointer';
            skipBtn.addEventListener('click', () => { overlay.remove(); resolve({ acknowledged: true, action: 'skip', values: {} }); });
            btnRow.appendChild(doneBtn);
            btnRow.appendChild(skipBtn);
            card.appendChild(btnRow);
            overlay.appendChild(card);
            document.body.appendChild(overlay);
            const firstInput = Object.values(inputs)[0];
            if (firstInput) setTimeout(() => firstInput.focus(), 100);
            card.addEventListener('keydown', (e) => { if (e.key === 'Enter') doneBtn.click(); });
            setTimeout(() => { if (document.getElementById('a360-overlay')) { overlay.remove(); resolve({ acknowledged: false, action: 'timeout', values: {} }); } }, timeout);
          });
        },
        // MAALT 21/8: her stod `params.title` raat. Skemaet siger at title er VALGFRI
        // med standarden "Agent360 - Action Required", men udelades den, er vaerdien
        // undefined — og chrome.scripting.executeScript afviser hele kaldet med
        // "Error at property 'args': Error at index 1: Value is unserializable".
        // Altsaa styrtede human-in-the-loop-vaerktoejet hver gang en agent fulgte sit
        // eget skema. Det blev aldrig fanget, fordi ask_user stod som "springes over"
        // i flowtesten — den eneste der kunne have set det.
        //
        // Alle argumenter tvinges nu til serialiserbare vaerdier, og standarden
        // anvendes der hvor den er lovet.
        args: [
          String(params.message ?? ''),
          String(params.title ?? 'Agent360 - Action Required'),
          Array.isArray(fields) ? fields : [],
          Boolean(hasFields),
          Number(timeout) || 120000,
          String(session.label ?? 'Claude'),
        ],
        world: 'MAIN',
      });

      // Restore badge
      const count = sessions.size;
      chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
      chrome.notifications.clear(notifId);
      return result.result;
    }

    case 'select_frame': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot access chrome:// pages');
      const frameIndex = params.frame_index ?? 0;
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      if (!frames || frameIndex >= frames.length) {
        return { error: `Frame ${frameIndex} not found. Available: ${frames?.length || 0} frames`, frames: frames?.map((f, i) => ({ index: i, url: f.url })) };
      }
      const frameId = frames[frameIndex].frameId;
      // MAALT 21/8: her stod `func: new Function('return (' + code + ')')`. Den byggede
      // funktionen i SERVICE-WORKEREN, hvor udvidelsens egen CSP forbyder eval — saa
      // vaerktoejet fejlede paa hver eneste side, ogsaa med koden '1+1':
      //   "Evaluating a string as JavaScript violates ... 'unsafe-eval' is not allowed".
      // execute_script loeser det samme problem korrekt: send koden med som ARGUMENT og
      // byg funktionen INDE i den injicerede func, hvor sidens egen CSP gaelder. Samme
      // vej her.
      //
      // Og som i execute_script (v1.26): accepter `script` som alias for `code`. Samme
      // navne-uoverensstemmelse har foer faaet vaerktoejer til at se brudte ud i tavshed.
      if (params.code == null && typeof params.script === 'string') params.code = params.script;
      const code = params.code || 'document.body.innerText.slice(0, 5000)';
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frameId] },
        world: 'MAIN',
        args: [code],
        func: (codeStr) => {
          try {
            return { __ok: true, value: new Function('return (' + codeStr + ')')() };
          } catch (e) {
            return { __scriptingError: true, message: String(e?.message || e) };
          }
        },
      });
      const r = result?.result;
      if (r && r.__scriptingError) {
        return { ok: false, error: r.message, frame_url: frames[frameIndex].url };
      }
      return { result: r?.value, frame_url: frames[frameIndex].url };
    }

    case 'list_frames': {
      const tab = await getSessionTab(port);
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      return { frames: frames?.map((f, i) => ({ index: i, url: f.url, frame_id: f.frameId, parent_frame_id: f.parentFrameId })) || [] };
    }

    case 'get_new_tab': {
      if (!lastCreatedTabId) return { error: 'No new tab detected' };
      try {
        const tab = await chrome.tabs.get(lastCreatedTabId);
        // Kun faner der er aabnet FRA en af sessionens egne faner. Uden det her overtog
        // agenten enhver fane brugeren selv havde aabnet — se kommentaren ved onCreated.
        const session = getSession(port);
        const opener = tab.openerTabId ?? openerForFane.get(tab.id) ?? null;
        // Aabneren i sessionen NU, eller sessionen der ejede aabneren da fanen blev oprettet
        // (aabneren kan vaere lukket siden - se ejerForFane ved onCreated).
        const voresNu = opener != null && session.tabIds.has(opener);
        const voresDaDenBlevAabnet = opener != null && ejerForFane.get(tab.id) === port;
        if (!voresNu && !voresDaDenBlevAabnet) {
          return {
            error: 'not-ours',
            hint: 'Den seneste nye fane blev ikke aabnet fra en af dine egne faner, saa den ' +
                  'tilhoerer brugeren. Brug browser_navigate(new_tab: true) hvis du selv skal ' +
                  'have en ny fane.',
            tab_id: tab.id,
          };
        }
        await addTabToSession(port, tab.id);
        return { id: tab.id, url: tab.url, title: tab.title };
      } catch {
        return { error: 'Tab no longer exists' };
      }
    }

    case 'switch_tab': {
      const session = getSession(port);
      if (!session.tabIds.has(params.tab_id)) {
        throw new Error(`Tab ${params.tab_id} does not belong to this session (${session.label})`);
      }
      const tab = await chrome.tabs.update(params.tab_id, { active: true });
      // Gør ogsaa VINDUET forrest. Uden det bliver fanen aktiv inde i sit vindue —
      // document.hasFocus() bliver sand — men document.visibilityState forbliver
      // 'hidden' fordi vinduet ligger bagved. Chrome struber timere i skjulte
      // faner, saa Angular-apps (Google Ads, GA4, Search Console) renderer aldrig
      // faerdigt: man laeser en halvt bygget side og drager forkerte konklusioner.
      // Kostede to opgaver og en forkert konklusion 31/8-2026.
      let vinduesFokus = null;
      try {
        await chrome.windows.update(tab.windowId, { focused: true });
        vinduesFokus = true;
      } catch (e) {
        // Vinduet kan vaere lukket eller paa et andet Space. Fanen er stadig
        // aktiv; vi siger bare aerligt at synligheden ikke kunne sikres.
        vinduesFokus = false;
      }
      session.activeTabId = tab.id;
      persistSessions();
      return { id: tab.id, url: tab.url, title: tab.title, windowFocused: vinduesFokus };
    }

    case 'close_tab': {
      const session = getSession(port);
      const tabId = params.tab_id;
      if (!session.tabIds.has(tabId)) {
        throw new Error(`Tab ${tabId} does not belong to this session (${session.label})`);
      }
      // Maerk lukningen som agentens egen. Ellers laeser onRemoved den tomme session som
      // "brugeren er faerdig" og lukker serveren ned midt i samtalen (MAALT 22/8).
      agentLukkedeFaner.add(tabId);
      await chrome.tabs.remove(tabId);
      session.tabIds.delete(tabId);
      if (session.activeTabId === tabId) session.activeTabId = null;
      persistSessions();
      return { ok: true, remaining: session.tabIds.size };
    }

    case 'solve_captcha': {
      const tab = await getSessionTab(port);
      const action = params.action || 'detect';

      // ── Detect CAPTCHA on page ──
      if (action === 'detect') {
        const detection = await detectCaptcha(tab.id);
        return detection;
      }

      // ── Auto-click reCAPTCHA checkbox ──
      if (action === 'click_checkbox') {
        const result = await clickRecaptchaCheckbox(tab.id);
        // Wait for challenge or pass
        await new Promise(r => setTimeout(r, 2500));
        // Re-detect to see if it passed or image challenge appeared
        const after = await detectCaptcha(tab.id);
        return { ...result, after };
      }

      // ── Click specific grid cells (AI vision guided) ──
      if (action === 'click_grid') {
        const cells = params.cells || [];
        if (!cells.length) return { error: 'No cells specified' };
        const result = await clickCaptchaGridCells(tab.id, cells);
        return result;
      }

      // ── Human fallback ──
      if (action === 'ask_human') {
        return { method: 'human', instructions: 'Call browser_ask_user with message: "A CAPTCHA needs to be solved. Please solve it in the browser and click Done when finished."' };
      }

      return { error: 'Unknown action: ' + action };
    }

    case 'upload_file': {
      const tab = await getSessionTab(port);
      const selector = params.selector || 'input[type="file"]';
      try {
        await debuggerAttach(tab.id);
        // Find the file input element
        const { result: nodeResult } = await cdpSend(tab.id, 'Runtime.evaluate', {
          expression: `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return JSON.stringify({ found: false, error: 'File input not found: ' + ${JSON.stringify(selector)} });
            return JSON.stringify({ found: true, tag: el.tagName, type: el.type, accept: el.accept, multiple: el.multiple });
          })()`,
          returnByValue: true,
        });
        const info = JSON.parse(nodeResult.value);
        if (!info.found) {
          await debuggerDetach(tab.id);
          return info;
        }

        // Get the DOM node ID for the file input.
        //
        // MAALT 21/8: her stod `const { result: docResult } = await cdpSend(...)`.
        // Runtime.evaluate ovenfor svarer {result:{...}}, men DOM.getDocument svarer
        // {root:{...}} — moenstret var kopieret fra det ene kald til det andet. Saa
        // docResult var undefined, og vaerktoejet doede paa
        // "Cannot read properties of undefined (reading 'root')" ved HVERT eneste kald.
        // browser_upload_file kunne ikke uploade en fil paa nogen side overhovedet.
        const docResult = await cdpSend(tab.id, 'DOM.getDocument', {});
        if (!docResult?.root?.nodeId) {
          await debuggerDetach(tab.id);
          return { ok: false, error: 'DOM.getDocument gav intet rod-element' };
        }
        const { nodeId } = await cdpSend(tab.id, 'DOM.querySelector', {
          nodeId: docResult.root.nodeId,
          selector: selector,
        });

        if (!nodeId) {
          await debuggerDetach(tab.id);
          return { found: false, error: 'Could not get DOM node for file input' };
        }

        // Set files on the input using CDP.
        // `file_path` accepteres som alias for `file`/`files` — praecis samme navne-faelde
        // som execute_script fik lukket i v1.26. Et forkert navn gav [undefined] og en
        // upload der saa ud til at lykkes.
        const files = Array.isArray(params.files) ? params.files
                    : [params.files || params.file || params.file_path].filter(Boolean);
        if (!files.length) {
          await debuggerDetach(tab.id);
          return { ok: false, error: 'Ingen fil angivet. Brug `files` (array) eller `file` (enkelt sti).' };
        }
        await cdpSend(tab.id, 'DOM.setFileInputFiles', {
          nodeId: nodeId,
          files: files,
        });

        await debuggerDetach(tab.id);
        return { ok: true, files: files, input: info };
      } catch (e) {
        try { await debuggerDetach(tab.id); } catch {}
        return { ok: false, error: e.message };
      }
    }

    case 'reload_extension': {
      // MCP server signals that extension files were updated via npx
      // Reload after a short delay to allow response to be sent
      setTimeout(() => chrome.runtime.reload(), 500);
      return { ok: true, message: 'Extension reloading in 500ms' };
    }

    default:
      throw new Error('Unknown method: ' + method);
  }
}

// ── CAPTCHA Detection & Solving Helpers ─────────────────────────────────────

async function detectCaptcha(tabId) {
  try {
    await debuggerAttach(tabId);
    const { result } = await cdpSend(tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const res = { found: false, types: [] };

        // reCAPTCHA v2 — checkbox iframe
        const recaptchaAnchor = document.querySelector('iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]');
        if (recaptchaAnchor) {
          res.found = true;
          res.types.push('recaptcha_v2_checkbox');
          const container = document.querySelector('.g-recaptcha');
          if (container) res.sitekey = container.getAttribute('data-sitekey');
        }

        // reCAPTCHA v2 — image challenge iframe
        const recaptchaChallenge = document.querySelector('iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"]');
        if (recaptchaChallenge) {
          res.found = true;
          if (!res.types.includes('recaptcha_v2_checkbox')) res.types.push('recaptcha_v2_image');
          res.types.push('recaptcha_v2_challenge_visible');
          // Get iframe dimensions for grid clicking
          const rect = recaptchaChallenge.getBoundingClientRect();
          res.challengeFrame = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }

        // reCAPTCHA v3 — invisible badge
        const recaptchaV3 = document.querySelector('.grecaptcha-badge');
        if (recaptchaV3 && !recaptchaAnchor) {
          res.found = true;
          res.types.push('recaptcha_v3_invisible');
          res.note = 'reCAPTCHA v3 is invisible and score-based. Real Chrome with Google login usually passes automatically. No action needed.';
        }

        // hCaptcha
        const hcaptcha = document.querySelector('iframe[src*="hcaptcha.com"], .h-captcha');
        if (hcaptcha) {
          res.found = true;
          res.types.push('hcaptcha');
          const container = document.querySelector('.h-captcha');
          if (container) res.sitekey = container.getAttribute('data-sitekey');
        }

        // Cloudflare Turnstile
        const turnstile = document.querySelector('iframe[src*="challenges.cloudflare.com"], .cf-turnstile');
        if (turnstile) {
          res.found = true;
          res.types.push('cloudflare_turnstile');
          const container = document.querySelector('.cf-turnstile');
          if (container) res.sitekey = container.getAttribute('data-sitekey');
        }

        // Cloudflare challenge page (5-second interstitial)
        if (document.title.includes('Just a moment') || document.querySelector('#challenge-running')) {
          res.found = true;
          res.types.push('cloudflare_challenge_page');
          res.note = 'Cloudflare challenge page. Wait 5-10 seconds — real Chrome usually passes automatically.';
        }

        // FunCaptcha / Arkose Labs
        const funcaptcha = document.querySelector('#FunCaptcha, iframe[src*="funcaptcha"], iframe[src*="arkoselabs"]');
        if (funcaptcha) {
          res.found = true;
          res.types.push('funcaptcha');
        }

        if (!res.found) res.note = 'No CAPTCHA detected on this page.';
        res.pageUrl = window.location.href;
        return JSON.stringify(res);
      })()`,
      returnByValue: true,
    });
    await debuggerDetach(tabId);
    return JSON.parse(result.value);
  } catch (e) {
    try { await debuggerDetach(tabId); } catch {}
    return { found: false, error: e.message };
  }
}

async function clickRecaptchaCheckbox(tabId) {
  try {
    await debuggerAttach(tabId);
    // Find the reCAPTCHA anchor iframe position
    const { result } = await cdpSend(tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const iframe = document.querySelector('iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]');
        if (!iframe) return JSON.stringify({ found: false });
        const rect = iframe.getBoundingClientRect();
        // Checkbox is roughly at 27,30 inside the iframe (standard reCAPTCHA layout)
        return JSON.stringify({ found: true, x: rect.x + 27, y: rect.y + 30 });
      })()`,
      returnByValue: true,
    });
    const pos = JSON.parse(result.value);
    if (!pos.found) {
      await debuggerDetach(tabId);
      return { clicked: false, reason: 'reCAPTCHA checkbox iframe not found' };
    }

    // Click the checkbox using real mouse events
    await cdpSend(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: pos.x, y: pos.y,
    });
    await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
    await dispatchTaalmodigt(tabId, {
      type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1,
    });
    await dispatchTaalmodigt(tabId, {
      type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1,
    });
    await debuggerDetach(tabId);
    return { clicked: true, position: pos, note: 'Checkbox clicked. Wait 2-3 seconds then re-detect to check if passed or image challenge appeared.' };
  } catch (e) {
    try { await debuggerDetach(tabId); } catch {}
    return { clicked: false, error: e.message };
  }
}

async function clickCaptchaGridCells(tabId, cells) {
  try {
    await debuggerAttach(tabId);
    // Find the challenge iframe position and dimensions
    const { result } = await cdpSend(tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const iframe = document.querySelector('iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"]');
        if (!iframe) return JSON.stringify({ found: false });
        const rect = iframe.getBoundingClientRect();
        return JSON.stringify({ found: true, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      })()`,
      returnByValue: true,
    });
    const frame = JSON.parse(result.value);
    if (!frame.found) {
      await debuggerDetach(tabId);
      return { clicked: false, reason: 'Challenge iframe not found. Take a screenshot to verify CAPTCHA state.' };
    }

    // Determine grid size — reCAPTCHA uses 3x3 or 4x4 grids
    // The image grid starts ~100px from top of iframe, and is roughly square
    const gridTop = frame.y + 100;
    const gridLeft = frame.x + 14;
    const gridSize = frame.width - 28; // padding on each side
    const cols = cells.some(c => c >= 9) ? 4 : 3;
    const rows = cols;
    const cellSize = gridSize / cols;

    const maxCell = cols * rows - 1;
    const validCells = cells.filter(c => c >= 0 && c <= maxCell);
    if (!validCells.length) {
      await debuggerDetach(tabId);
      return { clicked: false, error: `All cell indices out of bounds. Grid is ${cols}x${rows}, valid range: 0-${maxCell}` };
    }

    const clicked = [];
    for (const cell of validCells) {
      const row = Math.floor(cell / cols);
      const col = cell % cols;
      const x = Math.round(gridLeft + col * cellSize + cellSize / 2);
      const y = Math.round(gridTop + row * cellSize + cellSize / 2);

      // Human-like click with small random offset
      const ox = x + Math.round((Math.random() - 0.5) * cellSize * 0.3);
      const oy = y + Math.round((Math.random() - 0.5) * cellSize * 0.3);

      await cdpSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: ox, y: oy,
      });
      await new Promise(r => setTimeout(r, 150 + Math.random() * 300));
      await dispatchTaalmodigt(tabId, {
        type: 'mousePressed', x: ox, y: oy, button: 'left', clickCount: 1,
      });
      await dispatchTaalmodigt(tabId, {
        type: 'mouseReleased', x: ox, y: oy, button: 'left', clickCount: 1,
      });
      await new Promise(r => setTimeout(r, 200 + Math.random() * 400));
      clicked.push({ cell, row, col, x: ox, y: oy });
    }

    await debuggerDetach(tabId);
    return {
      clicked: true,
      cells: clicked,
      grid: `${cols}x${rows}`,
      note: 'Cells clicked. Take a screenshot to verify, then click the "Verify" / "Skip" button if needed.',
    };
  } catch (e) {
    try { await debuggerDetach(tabId); } catch {}
    return { clicked: false, error: e.message };
  }
}

// ── Start ───────────────────────────────────────────────────────────────────
ensureOffscreen().catch(console.error);

chrome.runtime.onStartup.addListener(() => ensureOffscreen().catch(console.error));
// onInstalled fyrer ved installation, opdatering OG ved "Genindlaes" paa
// chrome://extensions. I alle tre tilfaelde er koden aendret pr. definition, saa en
// overlevende bro er per definition forældet — uanset hvor villigt den svarer paa ping.
// MAALT 22/8: uden tvangen slog en genindlaesning aldrig igennem til broen, og
// udvikling krævede en fuld genstart af Chrome hver gang.
chrome.runtime.onInstalled.addListener(async () => {
  // Foerst: aeldre udgaver gemte parametre (adgangskoder, cookie-vaerdier) i historikken.
  await rensHandlingslog();
  try {
    if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  } catch (e) {
    console.warn('[BG] kunne ikke lukke broen ved genindlaesning:', e?.message || e);
  }
  await chrome.storage.local.set({ offscreenGenskabt: 0, offscreenPauseTil: 0 });
  ensureOffscreen().catch(console.error);
});

// Hjerteslag der genskaber offscreen-dokumentet hvis Chrome har ryddet det.
//
// FEJL RETTET 19/8: alarmen blev oprettet paa oeverste niveau ved HVER
// service-worker-opstart. chrome.alarms.create() med et navn der allerede
// findes NULSTILLER nedtaellingen — saa hvis workeren vaagnede oftere end
// hvert minut (hvilket den goer ved tab-events, beskeder, navigation),
// naaede alarmen aldrig at fyre. Resultat: offscreen-dokumentet doede, intet
// genskabte det, og forbindelsen til MCP-serveren kom aldrig tilbage foer
// nogen genindlaeste extensionen i haanden.
//
// Nu oprettes den kun hvis den ikke findes, saa nedtaellingen faar lov at
// loebe faerdig.
chrome.alarms.get('ensure-offscreen', (eksisterende) => {
  if (!eksisterende) {
    chrome.alarms.create('ensure-offscreen', {
      periodInMinutes: 1,
      delayInMinutes: 1,
    });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'ensure-offscreen') {
    ensureOffscreen().catch(console.error);
  }
  if (alarm.name.startsWith('frigiv-')) {
    const port = Number(alarm.name.slice('frigiv-'.length));
    // ── Hvorfor lageret laeses DIREKTE og ikke via restoreSessions() ─────────
    //
    // FUNDET AF REVIEW 7/9. Her stod `restoreSessions().then(...)`, og kommentaren
    // sagde at det var vaernet mod en genstartet service-worker. Den gjorde det
    // modsatte: `restoreSessions()` gendanner kun sessioner der har GYLDIGE FANER
    // (`if (validTabIds.size > 0)`) — og en tom session er praecis den her alarm
    // handler om. En MV3-worker suspenderes efter ~30 sekunder; fristen er paa fem
    // minutter, saa workeren er naesten altid frisk naar alarmen fyrer. Sessionen
    // blev derfor aldrig fundet, `if (!s) return` ramte, og porten blev holdt til
    // 4-timers-tomgangen — altsaa praecis den fejl frigivelsen skulle fjerne.
    //
    // restoreSessions() har god grund til ikke at genoplive doede sessioner (andre
    // kaldere vil ikke arve faner der ikke findes). Derfor rettes det HER.
    (async () => {
      const iHukommelsen = sessions.get(port);
      if (iHukommelsen) {
        if (iHukommelsen.tabIds.size > 0) return;   // den arbejder igen — lad den vaere
      } else {
        const { sessions: gemte } = await chrome.storage.local.get({ sessions: {} });
        const gemt = gemte[String(port)];
        if (!gemt) return;                          // sessionen er reelt vaek
        if ((gemt.tabIds || []).length > 0) return; // den arbejder igen
      }
      frivilligtFrigivet.add(port);
      chrome.runtime.sendMessage({ type: 'terminate_mcp_session', port }).catch(() => {});
    })().catch(() => {});
  }
});
