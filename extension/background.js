/**
 * Agent360 Browser MCP — Background Service Worker
 *
 * Handles Chrome API calls relayed from the offscreen document.
 * Each MCP session (port) gets its own Chrome Tab Group with color coding.
 * Tabs are isolated per session — no cross-session interference.
 */

// ── Session Tab Management ─────────────────────────────────────────────────

const SESSION_COLORS = ['blue', 'green', 'yellow', 'red', 'pink', 'purple', 'cyan', 'orange'];
// #91 (1.34): de farver chrome.tabGroups kender - browser_set_group_label afviser alt andet.
const GRUPPE_FARVER = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
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
          // #91 (1.34): et navn agenten selv har sat (browser_set_group_label), gendannes som det er - kun standardnavne foelger nummeret.
          color: data.egetNavn === true && GRUPPE_FARVER.includes(data.color) ? data.color : SESSION_COLORS[(nummer - 1) % SESSION_COLORS.length],
          label: data.egetNavn === true && typeof data.label === 'string' && data.label ? data.label : `Claude ${nummer}`,
          egetNavn: data.egetNavn === true,
          pid: typeof data.pid === 'number' ? data.pid : null,
          ...generationFraLager(data),
        });
      }
    }
  })().catch(err => { restorePromise = null; throw err; });
  return restorePromise;
}

// ── 1.32 (S4): sessionsgeneration ─────────────────────────────────────────────
// Astra MAALTE (R107): efter at en ny session var oprettet paa samme port med fane 99, lukkede et forsinket
// releaseSession(port) - bestilt af den GAMLE forbindelses lukning - fane 99 og slettede sessionen. Kortet er noeglet paa
// porten, og portnummeret siger ikke, hvilken forbindelse der ejer sessionen. Med partitioner (#20) genbruges porte oftere.
// Derfor: broen (offscreen.js) giver hver forbindelse en generation, som foelger med hver kommando og hver frigivelse.
// Sessionen husker den generation, der ejer den nu (`gen`), og hver fane den generation, der aabnede den (`faneGen`).
// En frigivelse for en anden generation end sessionens roerer kun sin egen generations faner (se releaseSession).
function generationFraLager(d) {
  const faneGen = new Map();
  for (const [t, g] of Object.entries(d?.faneGen || {})) if (typeof g === 'string') faneGen.set(Number(t), g);
  return { gen: typeof d?.gen === 'string' ? d.gen : null, faneGen };
}

function getSession(port, pid, gen = null) {
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
      gen: typeof gen === 'string' ? gen : null,
      faneGen: new Map(),
    });
  }
  const s = sessions.get(port);
  // Foerste kald fra en genstartet server kan baere pid'en foer sessionen har den.
  if (s.pid == null && typeof pid === 'number') { s.pid = pid; husketPlads(pid, s.nummer); }
  // 1.32 (S4): en kommando fra en ny forbindelse paa porten overtager sessionen (samme chat efter et genskabt offscreen-
  // dokument, eller efter at den slap og fik porten igen). Fanerne beholder den generation, der aabnede dem, saa en sen
  // frigivelse fra den gamle forbindelse stadig kan rydde netop dem - og kun dem.
  if (typeof gen === 'string' && s.gen !== gen) s.gen = gen;
  if (!s.faneGen) s.faneGen = new Map();
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
async function adoptOrphanedSession(port, pid, gen = null) {
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
  // R139 (Astra, MAALT i model): adoptionen venter (mcpPorts, tabs.get) og skrev derefter sessionskortet uden at se efter igen.
  // Et kald fra en forbindelse, der lukkede imens, adopterede donorens session INDOVER den nye forbindelses session, og den nye
  // forbindelses naeste kald koerte i donorens fane. Efter hver ventetid: er kaldets forbindelse lukket, ejer porten nu faner,
  // eller er donoren aendret, adopteres intet (kontrollen staar efter den sidste ventetid, lige foer kortet skrives).
  const portenEjerFaner = () => sessions.has(port) && sessions.get(port).tabIds.size > 0;
  // R141 (Opus): kender udvidelsen broens status, er den nyere end lageret - ogsaa i det foerste filter.
  const levendePorte = broensPorte !== null ? new Set(broensPorte)
    : new Set(((await chrome.storage.local.get({ mcpPorts: [] })).mcpPorts || []).map(Number));

  let best = null;
  for (const [p, session] of sessions) {
    if (p === port || !session.tabIds.size) continue;
    if (session.pid !== pid) continue;        // en anden chat — lad den vaere
    if (levendePorte.has(Number(p))) continue; // donoren arbejder stadig — hænderne væk
    if (!best || session.tabIds.size > best.session.tabIds.size) best = { port: p, session };
  }
  if (!best) return null;
  // R140 (Astra, MAALT i model): kom donorens forbindelse tilbage under ventetiden, skiftede getSession generationen paa SAMME
  // objekt, og identitetstjekket bestod. Donoren er kun forældreløs, hvis dens generation er den samme, og dens port stadig er doed.
  const donorGen = best.session.gen;

  // Verify at least one tab survives — an orphan whose tabs the user already closed is
  // worthless, and adopting it would mask a genuinely fresh start.
  const alive = new Set();
  for (const tabId of best.session.tabIds) {
    try { await chrome.tabs.get(tabId); alive.add(tabId); } catch {}
  }
  // Den sidste ventetid: kender udvidelsen broens portliste (ws_status siden start), bruges den - uden at vente. Ellers laeses lageret,
  // og en status, der kom imens, taeller ogsaa: donoren lever, hvis EN af kilderne siger det.
  const lagerPorte = broensPorte ? [] : ((await chrome.storage.local.get({ mcpPorts: [] })).mcpPorts || []);
  const donorLever = (broensPorte !== null && broensPorte.has(Number(best.port))) || lagerPorte.map(Number).includes(Number(best.port));
  if (fraLukketForbindelse(port, gen) || portenEjerFaner() || sessions.get(best.port) !== best.session
    || best.session.gen !== donorGen || donorLever) return null;
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

async function addTabToSession(port, tabId, { gruppe = true } = {}) {
  const session = getSession(port);
  session.tabIds.add(tabId);
  // Sessionen lever igen — aflys en eventuel port-frigivelse (se tabs.onRemoved).
  chrome.alarms.clear(`frigiv-${port}`).catch(() => {});

  // LRU eviction: når sessionen overstiger cap, luk de ældste tabs.
  if (session.tabIds.size > MAX_TABS_PER_SESSION) {
    await evictOldestTabs(session, tabId);
  }
  // 1.32 (S4): fanen hoerer til den forbindelse (generation), der aabnede den - se releaseSession.
  if (session.gen && session.tabIds.has(tabId)) session.faneGen.set(tabId, session.gen);

  // R57 (Opus, maalt i Chrome): chrome.tabs.group flytter fanen ind i gruppens vindue. For en fane i sit eget vindue
  // (navigate eget_vindue) betoed det, at fanen blev flyttet tilbage til sessionens foerste vindue, og det nye vindue
  // forsvandt. En saadan fane grupperes ikke, og en ny gruppe samler kun faner fra samme vindue.
  if (!gruppe) { persistSessions(); return; }
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
      const vindue = (await chrome.tabs.get(tabId).catch(() => null))?.windowId;
      const samme = [];
      for (const id of session.tabIds) {
        const t = id === tabId ? { windowId: vindue } : await chrome.tabs.get(id).catch(() => null);
        if (t && t.windowId === vindue) samme.push(id);
      }
      const groupId = await chrome.tabs.group({ tabIds: samme.length ? samme : [tabId] });
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

async function releaseSession(port, gen = null) {
  const session = sessions.get(port);
  if (!session) return;
  // 1.32 (S4): frigivelsen er bestilt for forbindelsen `gen`. Ejer en NYERE forbindelse sessionen nu, gaelder den kun de
  // faner, den gamle forbindelse aabnede - aldrig sessionen, dens frist eller den nye forbindelses faner (Astra, MAALT).
  // Uden generation (en bro fra foer 1.32) som foer.
  const bestiltFor = typeof gen === 'string' ? gen : null;
  if (bestiltFor && session.gen && session.gen !== bestiltFor) {
    if (frivilligtFrigivet.get(port) === bestiltFor) { frivilligtFrigivet.delete(port); return; }
    for (const tabId of [...session.tabIds]) {
      if (session.faneGen.get(tabId) !== bestiltFor) continue;
      debuggerForceDetach(tabId);
      try { await chrome.tabs.remove(tabId); } catch {
        try { await chrome.tabs.get(tabId); continue; } catch {}   // findes den stadig, beholdes den (#13)
      }
      session.tabIds.delete(tabId);
      session.faneGen.delete(tabId);
      if (session.activeTabId === tabId) session.activeTabId = null;
    }
    persistSessions();
    return;
  }
  // Frigivelsen gaelder sessionen. En frivillig bestilling taeller kun, hvis den blev bestilt for netop denne forbindelse.
  const frivillig = frivilligtFrigivet.has(port)
    && (!bestiltFor || frivilligtFrigivet.get(port) === null || frivilligtFrigivet.get(port) === bestiltFor);

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

  if (frivillig) {
    frivilligtFrigivet.delete(port);
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
  frivilligtFrigivet.delete(port);   // en bestilling for en anden forbindelse maa ikke overleve til den naeste
  // 1.32 (S4): sessionen tages ud af kortet FOER foerste await. En kommando fra en ny forbindelse paa porten, der kommer imens
  // fanerne lukkes, faar en frisk session i stedet for den, der ryddes - og som ellers blev slettet bagefter med den nye
  // forbindelses fane i.
  sessions.delete(port);
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
    session.tabIds = stadigAabne;
    // 1.32 (S4): tog en ny forbindelse porten imens, ejer den pladsen; de faner, der ikke kunne lukkes, beholder vi ikke
    // under dens session (den nye forbindelse maa ikke arve en doed forbindelses faner).
    if (!sessions.has(port)) {
      console.warn('[BG] kunne ikke lukke', [...stadigAabne], '— sessionen beholdes saa fanerne ikke strander');
      sessions.set(port, session);
    } else {
      console.warn('[BG] kunne ikke lukke', [...stadigAabne], '— og porten har allerede en ny session; fanerne er ikke laengere i en session');
    }
  }
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
      egetNavn: session.egetNavn === true,   // #91: uden maerket skriver gendannelsen navnet om til Claude N
      nummer: session.nummer ?? null,   // uden denne mister en gendannet session sin plads og kan kollidere
      pid: session.pid ?? null,   // uden denne adopterer en genstartet service worker paa tvaers af chats igen
      // 1.32 (S4): uden disse kan en frigivelse fra en gammel forbindelse efter en genstart ikke kende sine egne faner
      gen: session.gen ?? null,
      faneGen: Object.fromEntries([...(session.faneGen || [])].filter(([t]) => session.tabIds.has(t))),
    };
  }
  chrome.storage.local.set({ sessions: data });
}

// Get the active tab for this session (last navigated), or create one.
// activate=false (default): runs in background — no focus stealing.
// activate=true: only for commands that NEED visible tab (screenshot, ask_user, navigate, execute_script).
async function getSessionTab(port, activate = false, opretMed = null) {
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

  // R112/R113 (Astra 2, Opus N-c): et opslag kan haenge laenge (ogsaa ud over serverens 30 s, der ikke stopper arbejdet her).
  // Har et andet kald imens aendret sessionens aktive fane (skiftet til, oprettet eller lukket en fane), stopper dette kald,
  // foer det handler: efter hvert opslag - ogsaa et, der LYKKES - i reserve-loekken og foer en fane oprettes.
  let forventetAktiv = session.activeTabId;
  const sessionUroert = () => {
    if (session.activeTabId !== forventetAktiv) {
      const e = new Error('The session\'s active tab changed while this call was waiting for Chrome (another call switched ' +
        'to, opened or closed a tab), so this call stopped before acting on a tab: nothing was sent, and no tab was created ' +
        'or made active. Call again.');
      e.sessionSkiftet = true;
      throw e;
    }
  };

  // Prefer the active (last navigated) tab.
  // 1.33 (privat rapport 2.4): ogsaa naar den aktive fane er sessionens egen tomme about:-side. Foer blev den sprunget over,
  // og kaldet tog stille en anden af sessionens faner - navigate skrev i fane A, mens B = about:blank var aktiv (MAALT).
  let aktivChrome = false;
  if (session.activeTabId) {
    const aktiv = session.activeTabId;   // FIX-17 / R112: det id, der faktisk slaas op - laest FOER opslaget
    try {
      const tab = await chrome.tabs.get(aktiv);
      // R113: ogsaa et vellykket, men sent opslag - ellers sendte et gammelt kald sin adresse eller sit script til den gamle fane.
      sessionUroert();
      if (tab.url.startsWith('chrome://')) aktivChrome = true;
      else target = tab;
    } catch (e) {
      if (e && e.sessionSkiftet) throw e;
      sessionUroert();
      session.activeTabId = null;
      forventetAktiv = null;
      session.tabIds.delete(aktiv);
    }
  }

  // Ingen aktiv fane: den blev lukket (af agenten eller brugeren), eller den blev aldrig valgt.
  // 1.33 (privat rapport 3.2): foer valgtes stille den foerste brugbare af sessionens oevrige faner, og navigate skrev hen over
  // en side, brugeren arbejdede i (MAALT paa 1.27.1). Nu gaettes der ikke: har sessionen en fane med indhold, svarer kaldet med
  // listen og sender intet. Doede faner ryddes og egne tomme faner genbruges som foer. Er den aktive fane en chrome://-side, faar
  // kaldet som foer en ny fane - den skriver ikke hen over noget.
  if (!target) {
    const medIndhold = [];
    for (const tabId of [...session.tabIds]) {
      try {
        const tab = await chrome.tabs.get(tabId);
        sessionUroert();
        if (consider(tab)) medIndhold.push(tab);
      } catch (e) {
        if (e && e.sessionSkiftet) throw e;
        sessionUroert();
        session.tabIds.delete(tabId);
      }
    }
    if (medIndhold.length && !aktivChrome) {
      persistSessions();
      const liste = medIndhold.slice(0, 10)
        .map((t) => `${t.id} ${JSON.stringify(String(t.title || '').slice(0, 60))} ${String(t.url).slice(0, 100)}`).join('; ');
      const e = new Error('This session has no active tab (the tab it worked in was closed, by the agent or the user), so ' +
        'this call did not guess which of the session\'s other tabs to use: nothing was sent, and no tab was changed. The ' +
        `session's tabs: ${liste}${medIndhold.length > 10 ? ` (and ${medIndhold.length - 10} more)` : ''}. Call ` +
        'browser_switch_tab with the tab you mean, or browser_navigate with new_tab: true.');
      e.ingenAktiv = true;
      throw e;
    }
  }

  // Reuse our own blank placeholder rather than spawning yet another one (FIX-4).
  if (!target && blankFallback) {
    sessionUroert();
    target = blankFallback;
    skiftAktiv(session, target.id);
    persistSessions();
  }

  // No usable tab at all — create ONE placeholder and pin it as the active tab so the
  // NEXT call reuses it (FIX-4) instead of creating a fresh about:blank every time.
  // Gustav 9/10 (set i sin egen Chrome): en ny sessions foerste navigate aabnede foerst en tom about:blank-fane og skiftede
  // den saa til adressen - about:blank stod hver gang som det foerste. Kender kalderen adressen (navigate), oprettes fanen
  // direkte med den.
  if (!target) {
    sessionUroert();
    target = await chrome.tabs.create({ url: opretMed || 'about:blank', active: false });
    // R111: feltet fortaeller navigate, at adressen ER sendt (fanen blev oprettet med den).
    if (opretMed) target.oprettetMedUrl = true;
    await addTabToSession(port, target.id);
    skiftAktiv(session, target.id);
    persistSessions();
    // fall through to the activate branch (SC-3: previously returned early, skipping it)
  }

  // Activate the tab WITHOUT stealing the user\'s focus (FIX-1). This is a BACKGROUND tool:
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

// Verify Chrome\'s actual debugger-truth before trusting local cache.
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
    `or the user canceled Chrome\'s debugger banner — reload Browser MCP (chrome://extensions/ → ↻) or restart Chrome.`
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
    // #69 (1.30.3): en boks, koordinatoren kendte, er nu ukendt - ingen Closed kommer herfra.
    // R108 (Opus, maalt i Chrome): target_closed kommer OGSAA, naar fanen navigerer til chrome:// eller Chrome-butikken,
    // og fanen lever. Chrome spoerges, foer fanen regnes som lukket.
    const id = source.tabId;
    if (reason === 'target_closed') {
      Promise.resolve().then(() => chrome.tabs.get(id)).then((t) => dialogFaneMistet(id, !t), () => dialogFaneMistet(id, true));
    } else {
      dialogFaneMistet(id, false);
    }
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
  // Brugerens egen kode maa vente: awaitPromise betyder "vent paa dette loefte". R131 (Opus, maalt i Chrome): 20 s skar et
  // loefte paa 21 s over, som 1.30.3 besvarede (MAIN-vejen havde ingen frist under serverens). Fristen foelger derfor
  // serverens standardfrist minus hjemrejsen - samme udledning som skaermbilledets budget. Kun koerAgentKode bruger awaitPromise.
  // R137: for agentkodens to vaerktoejer venter serveren selv laengere end det (se AGENTKODE_FRIST); budgettet her er uaendret.
  if (m === 'Runtime.evaluate' && params && params.awaitPromise) return SERVER_FRIST_MS - SVARETS_HJEMREJSE_MS;
  if (m === 'Page.captureScreenshot' || m === 'Network.getResponseBody') return CDP_FRIST_TUNG_MS;
  return m.startsWith('Input.') ? CDP_FRIST_INPUT_MS : CDP_FRIST_MS;
}

// Skaermbilledet har et budget for HELE kaeden, ikke kun pr. kald.
// MAALT 11/9 af Astra (sign-off, R5 F8): standardoptagelsen hang og koblede foerst fra efter 19 s. cdpSend gentog den,
// fordi den staar som sikker at gentage, og billedet kom efter ca. 38 s - serveren havde opgivet ved 30 s. I 1.29.0
// sendte en frist paa 8 s kaldet videre til fromSurface:false, som svarede paa et halvt sekund.
// Standardoptagelsen faar derfor 10 s. Reserven faar resten af budgettet, saa svaret naar frem foer serverens frist.
// MAALT 11/9 af Fable (e2e-review): haenger BEGGE optagelser, haevede 1.29.0 vinduet og leverede et billede efter 16,7 s.
// En frist afskar den sidste udvej her, saa der kom intet billede. Budgettet reserverer derfor haevMs til den haevede runde.
//
// MAALT 12/9 af Astra (tredje runde paa samme sted): en gentilslutning paa 12,5 s betoed at kandidaten opgav efter 26,9 s,
// hvor 1.29.0 leverede et billede efter 29,2 s. Aarsagen var ikke logikken, men TALLET: 26 s var valgt frit, ikke udledt.
// Hver runde fandt et nyt scenarie i de 4 sekunder vi gav bort. Budgettet er derfor nu udledt af det eneste tal der
// betyder noget - serverens standardfrist pr. kald (KALD_FRIST_MS i mcp-server/index.js) - minus den tid svaret skal
// bruge paa at komme tilbage gennem broen. Aendres serverens standardfrist, skal tallet her aendres med (det er ikke koblet).
// R137: for execute_script og select_frame venter serveren KALD_FRIST_MS + AGENTKODE_MARGEN_MS (30 + 15 s), altsaa laengere
// end budgettet her, saa svaret naar frem, ogsaa naar Chromes browsertraad er lammet. Budgettet her er det samme for alle.
const SERVER_FRIST_MS = 30000;      // KALD_FRIST_MS i mcp-server/index.js (serverens standardfrist pr. vaerktoejskald)
// MAALT 12/9 af Astra: hjemrejsen for en skaermbillede-stor nyttelast over den lokale WebSocket er 84-154 ms
// (0,5 / 2 / 8 MB, tre maalinger hver). 1500 ms var 10x det - altsaa endnu et frit valgt tal i den regel der lige var
// lukket. 500 ms er tre gange det maalte og krymper baandet, hvor 1.29.0 leverer og vi ikke goer, fra ~1,35 s til ~0,35 s.
const SVARETS_HJEMREJSE_MS = 500;   // udvidelse -> offscreen -> WebSocket -> server
function skaermbilledeFrister() {
  return { foersteMs: 10000, samletMs: SERVER_FRIST_MS - SVARETS_HJEMREJSE_MS, haevMs: 8000 };
}

// wait_for_network har samme loft hos serveren (30 s). MAALT 11/9 af Astra (e2e-review): svaret kom efter 13 s, body-kaldet
// fik CDP_FRIST_TUNG_MS (20 s) oveni, og serveren opgav ved 30 s, hvor 1.29.0 svarede efter 21 s med body:null.
// Hele vaerktoejet har derfor ét budget, og body-kaldet faar kun det der er tilbage.
// Astra (efterproevning af c826f63): budgettet skar en body over der kom efter 27 s + 2 s, som 1.29.0 leverede efter 29 s.
// Body-kaldet faar derfor aldrig kortere tid end 1.29.0's frist (CDP_FRIST_MS) og aldrig mere end CDP_FRIST_TUNG_MS.
// MAALT 12/9 af Astra: her stod 28000 haardkodet - det SAMME frie tal som skaermbilledets budget lige var sluppet af med.
// Begge budgetter udledes nu af serverens egen frist, saa reglen gaelder hele vejen og ikke kun dér hvor den blev fundet.
function netvaerkFrister() {
  return { budgetMs: SERVER_FRIST_MS - SVARETS_HJEMREJSE_MS, bodyMinMs: CDP_FRIST_MS, bodyMaxMs: CDP_FRIST_TUNG_MS };
}


// ── CDP-fristen er et SIGNAL, ikke en saetning ──────────────────────────────
// FUNDET 19/9 af Astra, efterproevet: fire steder afgjorde de, at en handling var
// UVIS - og dermed om svaret baerer `maaske_landet` - ved at regex-matche den danske
// tekst «svarede ikke inden» i fejlens besked. Astra oversatte teksten i hukommelsen
// og koerte samme press_key-forloeb: `maaske_landet` forsvandt, og advarslen mod blind
// gentagelse med den. Altsaa kunne en ren tekstrettelse - eller en oversaettelse -
// tavst slaa praecis den aerlighed fra som 1.29.2 handlede om.
//
// Det er husets egen lære, skrevet ned 7/9: et ord kan ikke baere en regel. Fejlen
// baerer nu et flag. Teksten maa aendres, oversaettes og omskrives frit; signalet
// foelger ikke med. Tekst-matchet bevares som bagstopper for fejl der er rejst
// andre steder fra.
function cdpFristFejl(besked) {
  const e = new Error(besked);
  e.cdpFrist = true;
  return e;
}
function erCdpFrist(e) {
  if (e && e.cdpFrist === true) return true;
  return /did not respond within|svarede ikke inden/.test((e && e.message) || '');
}

// sessionId (1.31.0): en frame fra et andet domaene (OOPIF) er sit eget maal i debuggeren. Den naas gennem fanens egen
// tilslutning med flade sessioner (Target.setAutoAttach, flatten:true, Chrome 125+), ved at sende sessionId med.
function cdpMedFrist(tabId, method, params, sessionId = null, fristMs = null) {
  let ur;
  const frist = fristMs != null ? fristMs : cdpFrist(method, params);
  return Promise.race([
    chrome.debugger.sendCommand(sessionId ? { tabId, sessionId } : { tabId }, method, params),
    new Promise((_, afvis) => {
      // MAALT 11/9 (raa CDP-proeve i Chrome for Testing): Chrome leverer ikke Input.* til en fane i baggrunden.
      // Kaldet haenger, og efter aktivering svarer det paa millisekunder. Fejlen siger det, saa agenten ved hvad den goer.
      const hint = String(method).startsWith('Input.')
        // #69 (MAALT 13/10): et klik paa et link, der aabnede «Leave site?», endte her ogsaa - og svaret pegede kun paa en baggrundsfane.
        ? ' (the tab is probably in the background - Chrome does not deliver mouse or keyboard input to a tab that is not active; call browser_switch_tab and try again. ' +
          'Or the input opened a dialog - an alert, a confirm or "Leave site?" - which blocks the tab until it is answered; see browser_handle_dialog)'
        : '';
      ur = setTimeout(() => afvis(cdpFristFejl(`CDP did not respond within ${frist} ms: ${method}${hint}`)), frist);
    }),
  ]).finally(() => clearTimeout(ur));
}

// Fejl FOER noget er sendt til Chrome (kaldets tid er brugt): kalderen ved, at intet er koert.
function ikkeSendtFejl(besked) {
  const e = new Error(besked);
  e.ikkeSendt = true;
  return e;
}

// slut (R133, Astra): kaldets sluttid. Fristen regnes EFTER tilslutningen herunder, ved hvert forsoeg, og er tiden brugt,
// sendes intet - ellers kunne en langsom tilslutning skubbe afsendelsen forbi serverens frist.
async function cdpSend(tabId, method, params = {}, sessionId = null, slut = null, vagt = null) {
  await debuggerAttach(tabId);
  let lastMsg = '';
  // 4 total attempts (initial + 3 retries) for read-only methods; backoff 100/300/500ms.
  // Handles aggressive auto-detach on anti-automation sites (Apple ASC, Salesforce, etc.)
  // where Chrome re-detaches between attach and command execution.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      let frist = null;
      if (slut != null) {
        frist = Math.min(cdpFrist(method, params), slut - Date.now());
        if (frist <= 0) throw ikkeSendtFejl(`the call ran out of time before ${method} could be sent`);
      }
      // Den sidste afsendelseskontrol (R134): har kaldets ydre frist allerede svaret, sendes agentkoden ikke.
      if (vagt) {
        if (vagt.lukket) throw ikkeSendtFejl('the call had already answered that its time ran out; the code was not sent');
        vagt.sendt = true;
      }
      return await cdpMedFrist(tabId, method, params, sessionId, frist);
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
// R173: close_tab-handleren koerer lukningerne én ad gangen gennem denne kaede.
let fanelukninger = Promise.resolve();
const fanerUnderLukning = new Set();   // R174: fjernelsen er sendt, Chrome har ikke svaret endnu
// R175 (Opus): serverens partitionslukning giver hver close_tab 5 s - udvidelsens frist skal ligge inden for, ellers giver
// serveren op foerst og ser aldrig tab-not-closed.
const LUK_FANE = { ms: 4000 };
// Porte hvor VI selv har bedt serveren slippe porten, fordi sessionen var tom.
// Skelnen betyder alt i releaseSession: en frivillig frigivelse maa aldrig lukke
// faner, mens en uventet afbrydelse (chatten er vaek) netop skal rydde op.
// 1.32 (S4): port -> den generation (forbindelse), frigivelsen blev bestilt for (null for en session uden generation).
const frivilligtFrigivet = new Map();
// R138 (Astra, MAALT i model): et kald fra en forbindelse, der er lukket, ventede i sessionsgendannelsen, mens en ny forbindelse
// tog porten; bagefter koerte det sin kode i den nye forbindelses fane og stemplede sessionen tilbage. Broen sender
// session_disconnect med forbindelsens generation, naar den lukker; de generationer huskes her pr. port (de seneste 16), og et kald
// fra en af dem koerer intet. Kun i hukommelsen: en genstartet service worker har ingen ventende kald fra foer genstarten.
const lukkedeGen = new Map();   // port -> Set af generationer, hvis forbindelse er lukket
// R141 (Astra, MAALT i model): et lagersvar kan vaere AELDRE end en ws_status, udvidelsen allerede har faaet. Broens seneste portliste
// holdes derfor ogsaa i hukommelsen, sat synkront i lytteren. null = ingen status siden service workeren startede.
let broensPorte = null;
function forbindelsenLukket(port, gen) {
  if (typeof gen !== 'string') return;
  const saet = lukkedeGen.get(port) || new Set();
  saet.add(gen);
  while (saet.size > 16) saet.delete(saet.values().next().value);
  lukkedeGen.set(port, saet);
}
// R138 (Opus, LAEST): erstatter udvidelsen selv broen (closeDocument), faar det gamle dokuments forbindelser ingen
// session_disconnect. En generation er `<dokument>-<nr>` (offscreen.js), og der findes kun ét offscreen-dokument ad gangen: kommer
// en kommando fra et NYT dokument, eller genopbygges broen, er alle det gamle dokuments forbindelser lukkede.
let broensDokument = null;
const doedeDokumenter = new Set();   // hoejst 16
function dokumentAf(gen) {
  const i = typeof gen === 'string' ? gen.lastIndexOf('-') : -1;
  return i > 0 ? gen.slice(0, i) : null;
}
function dokumentDoedt(dok) {
  if (!dok) return;
  doedeDokumenter.add(dok);
  while (doedeDokumenter.size > 16) doedeDokumenter.delete(doedeDokumenter.values().next().value);
}
function kommandoFraDokument(gen) {
  const dok = dokumentAf(gen);
  if (!dok || doedeDokumenter.has(dok)) return;
  if (broensDokument && broensDokument !== dok) dokumentDoedt(broensDokument);
  broensDokument = dok;
}
function broenErstattes() { dokumentDoedt(broensDokument); broensDokument = null; }
// R141 (Opus H3): kastede closeDocument, er broen kun vaek, hvis Chrome siger, at dokumentet ikke findes. Kan det ikke afgoeres: ikke vaek.
// R143 (Opus, MAALT med injektion): et enkelt falsk hasDocument-svar markerede en levende bro doed. Broen er kun vaek, naar Chromes
// kontekstliste OGSAA er tom - to uafhaengige kilder. Findes getContexts ikke (Chrome foer 116), gaelder hasDocument alene.
async function broenErVaek() {
  if (await chrome.offscreen.hasDocument().catch(() => true)) return false;
  if (typeof chrome.runtime.getContexts !== 'function') return true;
  const kontekster = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).catch(() => null);
  return Array.isArray(kontekster) && kontekster.length === 0;
}
const fraLukketForbindelse = (port, gen) => typeof gen === 'string'
  && (!!lukkedeGen.get(port)?.has(gen) || doedeDokumenter.has(dokumentAf(gen)));
const LUKKET_SVAR = { ok: false, error: 'connection-closed', sent: false,
  note: 'This call came from a connection to the extension that has closed since; nothing was run.' };
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
// R174 (Astra, MAALT): armeringen fulgte kun fanen i det oejeblik, dialogen kom - et skift vaek og tilbage slap igennem. Et
// skift af sessionens aktive fane afvaebner nu straks den gamle fanes armering. Samme skift glemmer en OAuth-tilbagevenden
// (R173), medmindre det er popuppen selv, der bliver aktiv. ALLE skift af sessionens aktive fane til en fane gaar herigennem.
function skiftAktiv(session, id) {
  const gammel = session.activeTabId;
  if (gammel != null && gammel !== id && armeredeDialoger.has(gammel)) {
    afvaebnDialog(gammel, 'the session moved to another tab before a dialog appeared, so the arming was dropped');
  }
  if (session.tilbageTil && id !== session.tilbageTil.popup) session.tilbageTil = null;
  if (id !== gammel) session.skiftNr = (session.skiftNr || 0) + 1;   // R175: et kald kan se, om der blev skiftet undervejs
  session.activeTabId = id;
}
// R173 (Opus, MAALT i egen session): mellemrummet mellem to af en agents kald var 20-108 s - 10 s brod forloebet «armer, klik».
// Beskyttelsen ligger i typefiltret, afvaebningen ved side- og faneskift og loftet; standarden er derfor loftet.
const DIALOG_ARMERING = { standard: 30000, loft: 30000 };
// Loeftet for den senest armerede dialog pr. fane. Ligger UDEN for armeredeDialoger,
// fordi lytteren afvaebner i samme oejeblik dialogen aabner — og klikket skal kunne
// vente paa svaret BAGEFTER.
const dialogLoefter = new Map();   // tabId -> Promise   // tabId → { timer, action, accept, text, udloeb, opfyld }

function afvaebnDialog(tabId, grund) {
  const a = armeredeDialoger.get(tabId);
  if (!a) return;
  clearTimeout(a.timer);
  armeredeDialoger.delete(tabId);
  // MAALT 22/8: her stoppede funktionen. Loeftet blev ALDRIG opfyldt, saa en kalder
  // med `wait: true` haengte for evigt ad to helt almindelige veje — fanen blev
  // lukket, eller et andet handle_dialog armerede paa samme fane. Ingen fejl, intet
  // svar, bare stilhed. Nu faar kalderen altid et svar.
  if (grund && a.opfyld) a.opfyld({ ok: false, error: grund });
}

// ── #69 (1.30.3): én dialog-koordinator for hele udvidelsen ──────────────────────
// Design: ~/.claude/plans/browsermcp-1302-2026-10-07/DESIGN-1.30.3-og-1.31-SAMLET.md (godkendt af Astra og Opus, R107).
// Foer 1.30.3 havde handle_dialog sin egen lytter, og navigate ingen: et navigate paa en side med «Leave site?» svarede
// ok:true med den GAMLE adresse (tabs.update loeser foer boksen kommer, maalt F1), og boksen blev staaende.
//
// Nu er der én lytter (dialogKoordinator), og den er det ENESTE sted, der sender Page.handleJavaScriptDialog
// (kildeproeven i test/dialog-1303.test.mjs). Hvem der svarer, vaelges ÉN gang, naar boksen aabner, i samme synkrone tur
// som armeringens udloebstjek: en gyldig armering (handle_dialog) forbruges, ellers svarer det navigate, der ejer fanen og
// HAR sendt sin adresse (Stay, eller Leave med leave_page:true), ellers ingen. Dommen kommer KUN fra
// Page.javascriptDialogClosed - aldrig fra svaret paa kommandoen (det var mutant M2's moenster, og mains handle_dialog).
// Tilstand pr. fane: ejer (et navigate i gang), boks (en set, aaben boks), pendingUrl (en navigation, der kan
// fuldfoere senere), uafgjort (et tabs.update, Chrome endnu ikke har svaret paa, efter at loftet ramte) og udestaaende
// (vores egne Page.handleJavaScriptDialog-kald, Chrome endnu ikke har svaret paa - CDP har intet dialog-id, saa et
// forsinket svar rammer den boks, der staar der, naar det lander; R108 Astra 2).
const NAV_FRISTER = { port: 8000, luk: 5000, loft: 25000 };
const dialogFaner = new Map();   // tabId -> { ejer, boks, pendingUrl, uafgjort, udestaaende, lukketFane }
let naesteNavOp = 0;
function dialogFane(tabId) {
  let s = dialogFaner.get(tabId);
  if (!s) {
    s = { ejer: null, boks: null, pendingUrl: null, uafgjort: null, udestaaende: new Set(), lukketFane: false };
    dialogFaner.set(tabId, s);
  }
  return s;
}

// Det ENESTE sted, der sender Page.handleJavaScriptDialog. Svaret paa kommandoen er ikke dommen - Closed er.
function dialogSvar(tabId, boks, accept, promptText, af) {
  boks.besvaretAf = af;
  boks.accept = accept;
  boks.svaretVed = Date.now();
  // Kaldet holdes som udestaaende, til Chrome har svaret: indtil da kan det lande paa en ANDEN boks paa fanen (R108).
  const s = dialogFane(tabId);
  const svarId = {};
  s.udestaaende.add(svarId);
  let kald;
  try { kald = Promise.resolve(chrome.debugger.sendCommand({ tabId }, 'Page.handleJavaScriptDialog', { accept, promptText: promptText || '' })); }
  catch (e) { kald = Promise.reject(e); }
  kald.catch((e) => { boks.svarFejl = e?.message || String(e); })
    .finally(() => { s.udestaaende.delete(svarId); if (s.ejer && s.ejer.vaek) s.ejer.vaek(); });
}

function vaekDialogVentere(s, boks) {
  if (boks && boks.vedLukket) boks.vedLukket(boks);
  if (s && s.ejer && s.ejer.vaek) s.ejer.vaek();
}

function dialogKoordinator(source, method, p) {
  const tabId = source && source.tabId;
  if (tabId == null) return;
  if (method === 'Page.javascriptDialogOpening') {
    const s = dialogFane(tabId);
    const boks = { type: String(p?.type || ''), message: String(p?.message ?? ''), url: p?.url ?? null,
      besvaretAf: null, ejer: s.ejer, armering: null, lukket: null };
    s.boks = boks;
    // R108 (Opus): boksen registreres ogsaa paa ejeren, saa en boks, der aabner OG lukker, mens navigate venter paa et
    // opslag, ikke gaar tabt.
    // R109 (Astra 3): kun bokse, der aabner EFTER adressen er sendt - et Stay fra sidens egen navigation foer det er ikke vores.
    if (s.ejer && s.ejer.sent) s.ejer.bokse.push(boks);
    const a = armeredeDialoger.get(tabId);
    const udloebet = !!a && a.udloeb != null && Date.now() >= a.udloeb;
    // 1.33 (privat rapport 4.2): en armeret accept svarede ogsaa «Leave site?» - en glemt armering kunne forlade en side med
    // ugemt arbejde. Accept af beforeunload kraever nu leave_page: true ved armeringen; ellers bliver armeringen staaende til
    // naeste alert/confirm/prompt, og boksen gaar til navigates eget svar (Stay) eller bliver staaende til brugeren.
    // En armeret dismiss (Stay) kan ikke miste noget og svarer som foer.
    const forbeholdt = !!a && boks.type === 'beforeunload' && a.action === 'accept' && a.leave !== true;
    // R173 (Astra, MAALT): efter switch_tab til en anden fane svarede armeringen stadig den gamle fanes naeste confirm. En
    // armering gaelder kun, mens fanen er sin sessions aktive fane - ogsaa naar skiftet skete, mens armeringen blev sat.
    let ejer = null;
    for (const [, sess] of sessions) if (sess.tabIds.has(tabId)) { ejer = sess; break; }
    const flyttet = !!a && !!ejer && ejer.activeTabId !== tabId;
    const gyldig = !!a && !udloebet && !forbeholdt && !flyttet;
    if (gyldig) {
      afvaebnDialog(tabId);   // forbruges - uden grund, for vi svarer selv lige her
      boks.armering = a;
      dialogSvar(tabId, boks, a.action !== 'dismiss', a.text, 'handle_dialog');
      boks.armUr = setTimeout(() => {
        if (!boks.lukket && a.opfyld) a.opfyld(dialogUbekraeftet(boks));
      }, NAV_FRISTER.luk);
    } else {
      if (udloebet) afvaebnDialog(tabId, 'the arming expired before a dialog appeared');
      else if (flyttet) afvaebnDialog(tabId, 'the session moved to another tab before a dialog appeared, so the arming was dropped');
      if (s.ejer && s.ejer.sent && boks.type === 'beforeunload') dialogSvar(tabId, boks, s.ejer.leave === true, '', 'navigate');
    }
    vaekDialogVentere(s, null);
  } else if (method === 'Page.frameNavigated') {
    // R173 (Astra, MAALT): efter et dokumentskift i fanen svarede armeringen den nye sides confirm (og med leave_page dens
    // «Leave site?»). Samtykket gjaldt den side, agenten saa - et nyt dokument i hovedrammen afvaebner.
    if (p && p.frame && !p.frame.parentId) {
      const s = dialogFane(tabId);
      s.dokGen = (s.dokGen || 0) + 1;
      if (armeredeDialoger.has(tabId)) afvaebnDialog(tabId, 'the page changed (a new document loaded) before a dialog appeared, so the arming was dropped');
    }
  } else if (method === 'Page.javascriptDialogClosed') {
    const s = dialogFaner.get(tabId);
    const boks = s && s.boks;
    if (!boks) return;
    s.boks = null;
    // Kun «Leave site?» afgoer en ventende navigation (Stay annullerer, Leave lader den fortsaette); en alert goer ikke.
    if (boks.type === 'beforeunload') s.pendingUrl = null;
    boks.lukket = { result: p?.result === true };
    clearTimeout(boks.armUr);
    if (boks.armering && boks.armering.opfyld) {
      boks.armering.opfyld({ ok: true, dialog_type: boks.type, message: boks.message,
        action: boks.lukket.result ? 'accept' : 'dismiss', answered_by: 'handle_dialog' });
    }
    vaekDialogVentere(s, boks);
  }
}
chrome.debugger.onEvent.addListener(dialogKoordinator);

// R174 (Astra, MAALT): en URL-sammenligning baerer ikke dokumentbindingen - samme adresse genindlaest, eller en ny adresse
// efter det sidste opslag, slap igennem. Hver fane har en dokumentgeneration, som taelles op, naar Chrome begynder at indlaese
// et dokument i den. En armering gaelder kun i den generation, den blev sat i, og den afvaebnes straks. Fejler reglen, er det
// i den sikre retning (en armering droppes, en dialog besvares ikke) - aldrig et svar paa en side, agenten ikke saa.
// R175 (Opus, MAALT i Chrome 155): «loading» kommer ogsaa ved pushState, replaceState, hash og en iframe, der skifter adresse -
// ikke kun ved et nyt dokument. Det afvaebnede en armering, saa en confirm efter et SPA-skift stod ubesvaret og klikket hang.
// «loading» bruges derfor til at se, om noget skiftede, mens et handle_dialog-kald koerer (den sikre retning: page-changed),
// og til at spoerge, om hovedrammen har faaet et nyt dokument (loaderTjek nedenfor).
// En sat armering afvaebnes af hovedrammens Page.frameNavigated (et nyt dokument, ogsaa en genindlaesning; aldrig et SPA-skift
// eller en iframe). Opus maalte: «loading» kommer aldrig foer «Leave site?» (0/9), og frameNavigated kommer foer en ny sides
// straks-confirm (12/12).
// R176 (Opus, MAALT i Chrome 155): en prerender-aktivering (speculation rules) skifter dokument UDEN frameNavigated - kun
// «loading» og en ny loaderId i hovedrammen. Armeringen svarede den nye sides confirm (9/9). En armering baerer derfor
// hovedrammens loaderId, og ved «loading» spoerges Chrome: er det et andet dokument, afvaebnes den. Kan det ikke afgoeres
// (intet svar, intet id), afvaebnes den ogsaa - den sikre retning.
// Kendt rest (R177-R178, begge konsulenter): aabner den nye sides dialog inden for ca. 10 ms efter en prerender-aktivering, foer
// Chromes svar kommer, besvares den stadig. Svaret kan ikke ventes paa - mens en dialog staar aaben, svarer Page.getFrameTree ikke
// (MAALT i Chrome 155, intet svar paa 3 s), og at vente ville faa en SPA-confirm til at haenge (R175). At binde armeringen til
// sidens ramme-id'er lukkede kapløbet, men en iframe fra et andet site (en anden proces) staar ikke i getFrameTree, saa dens
// dialoger blev ikke besvaret (Opus R178, MAALT i Chrome: en regression mod 1.32) - den binding er derfor ikke med.
const hovedLoader = async (tabId) => {
  const t = await venteMedFrist(cdpSend(tabId, 'Page.getFrameTree', {}), NAV_FRISTER.port).catch(() => null);
  return (t && t !== FRIST_UDLOEB && t.frameTree && t.frameTree.frame && t.frameTree.frame.loaderId) || null;
};
async function loaderTjek(tabId, a) {
  const nu = a.loader ? await hovedLoader(tabId) : null;
  if (armeredeDialoger.get(tabId) !== a) return;   // forbrugt eller afloest imens
  if (!nu || nu !== a.loader) afvaebnDialog(tabId, 'the page changed (a new document became active) before a dialog appeared, so the arming was dropped');
}
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!info || info.status !== 'loading') return;
  const s = dialogFane(tabId);
  s.dokGen = (s.dokGen || 0) + 1;
  const a = armeredeDialoger.get(tabId);
  if (a) loaderTjek(tabId, a);
});

// Debuggeren faldt af, eller fanen lukkede: en boks, vi kendte, er nu ukendt. Intet sendes igen; Page.enable-porten
// afgoer naeste kald (en aaben boks faar den til at haenge, maalt F4).
function dialogFaneMistet(tabId, fanenLukket) {
  const s = dialogFaner.get(tabId);
  if (!s) return;
  const boks = s.boks;
  s.boks = null;
  // Svar, der var undervejs, kan ikke lande laengere (debuggeren er vaek); porten afgoer naeste kald.
  s.udestaaende.clear();
  if (fanenLukket) { s.lukketFane = true; dialogFaner.delete(tabId); }
  if (boks) {
    boks.mistet = fanenLukket ? 'tab-closed' : 'debugger-detached';
    clearTimeout(boks.armUr);
    if (boks.armering && boks.armering.opfyld) {
      boks.armering.opfyld(fanenLukket ? { ok: false, error: 'tab-closed', note: 'The tab was closed while its dialog was open.' }
        : dialogUbekraeftet(boks));
    }
  }
  vaekDialogVentere(s, boks);
}

function dialogFelter(boks) {
  return { dialog_type: boks.type, message: boks.message };
}

const FRIST_UDLOEB = Symbol('frist');
function venteMedFrist(loefte, ms) {
  let ur;
  return Promise.race([loefte, new Promise((r) => { ur = setTimeout(() => r(FRIST_UDLOEB), Math.max(0, ms)); })])
    .finally(() => clearTimeout(ur));
}

// handle_dialog paa en set, aaben boks: svar nu gennem koordinatoren og vent paa Chromes Closed (5 s).
async function besvarAabenBoks(tabId, boks, action, promptText, forlad = false) {
  const sf = dialogFaner.get(tabId);
  if (!boks.besvaretAf && sf && sf.udestaaende.size) {
    return { ok: false, error: 'dialog-being-answered', ...dialogFelter(boks), answered_by: 'an earlier answer',
      note: 'An earlier answer to a dialog on this tab has not been confirmed by Chrome yet, and it would land on this ' +
        'dialog. Wait a moment, then look at the tab before you act again.' };
  }
  // Et svar uden Closed efter fristen er ikke «under besvarelse» laengere - det er ubekraeftet, og intet sendes igen.
  if (boks.besvaretAf && Date.now() - boks.svaretVed >= NAV_FRISTER.luk) return dialogUbekraeftet(boks);
  if (boks.besvaretAf) {
    return { ok: false, error: 'dialog-being-answered', ...dialogFelter(boks), answered_by: boks.besvaretAf,
      note: boks.besvaretAf === 'navigate'
        ? 'browser_navigate is answering this dialog (Stay, or Leave with leave_page:true). Wait for its answer; it says what happened.'
        : 'An earlier browser_handle_dialog is answering this dialog. Wait a moment, then look at the tab before you act again.' };
  }
  // R173 (Opus H1, MAALT): en AABEN «Leave site?» blev besvaret accept af et handle_dialog() uden argumenter - siden blev
  // forladt uden leave_page, mod reglen for en armering. Samme regel her, lige foer der ville blive sendt.
  if (boks.type === 'beforeunload' && action === 'accept' && forlad !== true) {
    return { ok: false, error: 'leave-page-required', ...dialogFelter(boks), sent: false,
      note: 'A "Leave site?" is open on this tab, and accepting it leaves the page and loses anything unsaved on it. Nothing ' +
        'was answered. Ask the user (browser_ask_user); if they agree, call again with leave_page: true, or pass action: ' +
        '"dismiss" to stay.' };
  }
  const lukket = new Promise((r) => { boks.vedLukket = r; });
  dialogSvar(tabId, boks, action === 'accept', promptText, 'handle_dialog');
  await venteMedFrist(lukket, NAV_FRISTER.luk);
  if (boks.mistet === 'tab-closed') return { ok: false, error: 'tab-closed', ...dialogFelter(boks), note: 'The tab was closed while its dialog was open.' };
  if (!boks.lukket) return dialogUbekraeftet(boks);
  const forlod = boks.type === 'beforeunload' && boks.lukket.result;
  return { ok: true, ...dialogFelter(boks), action: boks.lukket.result ? 'accept' : 'dismiss', answered_by: 'handle_dialog',
    ...(boks.type === 'beforeunload' ? { note: forlod
      ? 'The page was left. The navigation it was holding back now continues; read the tab (browser_list_tabs) to see where it went.'
      : 'Stay: the tab is still on the page.' } : {}) };
}

// ── #69 (1.30.3): browser_navigate i en eksisterende fane, trin 0-10 i designet ───────────
// Fejlsvarene siger altid `sent` (er adressen sendt til Chrome?), og hvad agenten kan goere.
const NAV_NOTER = {
  'navigation-in-progress': 'Another browser_navigate is still working in this tab (op_id). Nothing was sent. Wait for its ' +
    'answer before you navigate again, and do not resend the address blindly.',
  'navigation-in-progress-svar': 'An earlier answer to a dialog on this tab (from browser_navigate or browser_handle_dialog) ' +
    'has not been confirmed by Chrome yet, and Chrome gives no way to aim it at one dialog: it could land on the dialog this ' +
    'navigation opens. Nothing was sent. Try again in a moment. The tab stays held until Chrome answers, the debugger ' +
    'detaches or the tab closes; browser_reattach_debugger releases it.',
  'dialog-open': 'A dialog is open on this tab, and nothing was sent. For "Leave site?" (dialog_type beforeunload) the page ' +
    'may hold unsaved work: ask the user with browser_ask_user before leaving. Then answer it with browser_handle_dialog - ' +
    'accept with leave_page: true leaves the page (pending_url, if any, may then load), dismiss stays - and navigate again if ' +
    'you still need to.',
  'dialog-open-sent': 'The address was sent, and the page then opened a dialog that is not "Leave site?" (dialog_type). It ' +
    'was not answered. Answer it with browser_handle_dialog, then read the tab before you navigate again.',
  'tab-not-responding': 'Chrome did not answer on this tab within the time limit: a busy page, or a dialog Chrome does not ' +
    'show us (one that opened before anything listened). Nothing was sent. Try again in a moment; if it keeps happening, ' +
    'ask the user (browser_ask_user) to look at the tab, or open the address in a new tab with new_tab: true.',
  'navigation-failed': 'Chrome refused the navigation (detail), and the tab is where it was.',
  'session-changed': 'Another call changed this session\'s active tab while this one waited for Chrome (it switched to, ' +
    'opened or closed a tab), so nothing was sent. Check the tabs with browser_list_tabs, then call again if you still need to.',
  'no-active-tab': 'This session has no active tab (the tab it worked in was closed), and nothing was sent: the call did not ' +
    'guess which of the session\'s other tabs to use (detail lists them). Call browser_switch_tab with the tab you mean and ' +
    'navigate again, or pass new_tab: true.',
  'session-langsom': 'Chrome took longer than the time limit to report this session\'s tabs, and nothing was sent. Try ' +
    'again in a moment; if it keeps happening, ask the user (browser_ask_user) to look at Chrome.',
  'beforeunload-blocked': 'The page asked "Leave site?" and the answer was Stay (answered_by), so the tab is still on url. ' +
    'The page may hold unsaved work: ask the user with browser_ask_user whether to leave it. If they say yes, call ' +
    'browser_navigate again with leave_page: true.',
  'navigation-unconfirmed': 'The address was sent, but no load was proven in time. The navigation may still complete ' +
    'later (pending_url). Do not send it again blindly: read the tab first (browser_list_tabs or browser_get_page_content).',
  'tab-closed': 'The tab was closed while the navigation was in progress (Chrome no longer has a tab with this id).',
};

// Forbeholdet foer loftet: ventningen slutter saa meget foer, at de sidste opslag (fanens adresse i svaret, CAPTCHA-kontrollen)
// ogsaa naar inden for det.
function navForbehold() { return Math.min(500, Math.floor(NAV_FRISTER.loft / 10)); }

async function navigerIFanen(port, session, tab, params, navSlut = null) {
  const url = String(params.url);
  const s = dialogFane(tab.id);
  const svar = (error, ekstra = {}) => ({ ok: false, error, tab_id: tab.id, requested_url: url, ...ekstra,
    note: NAV_NOTER[ekstra.__note || error] + (ekstra.__tillaeg || '') });
  // Trin 0: ingen overhaling - heller ikke af et tabs.update, Chrome endnu ikke har svaret paa efter et loft (Astra R107).
  if (s.ejer) return rens(svar('navigation-in-progress', { sent: false, op_id: s.ejer.opId, pending_url: s.ejer.sent ? s.ejer.url : null }));
  if (s.uafgjort) {
    return rens(svar('navigation-in-progress', { sent: false, op_id: s.uafgjort.opId, pending_url: s.uafgjort.url, may_complete_later: true }));
  }
  // R108 (Astra 2): et af vores egne dialogsvar er stadig undervejs - det kunne lande paa denne navigations boks.
  if (s.udestaaende.size) {
    return rens(svar('navigation-in-progress', { __note: 'navigation-in-progress-svar', sent: false, op_id: null, pending_url: s.pendingUrl,
      detail: 'an earlier answer to a dialog on this tab has not been confirmed by Chrome yet' }));
  }
  // Trin 1: ejerskab tages synkront, foer foerste await.
  const ejer = { opId: 'nav-' + (++naesteNavOp), sent: false, url, leave: params.leave_page === true, vaek: null, bokse: [] };
  s.ejer = ejer;
  try {
    return rens(await navigerSomEjer(port, session, tab, url, s, ejer, svar, navSlut));
  } finally {
    if (s.ejer === ejer) s.ejer = null;
    ejer.vaek = null;
  }
}

// Interne hjaelpefelter (__note, __tillaeg) forlader aldrig udvidelsen.
function rens(r) {
  if (r && typeof r === 'object') { delete r.__note; delete r.__tillaeg; }
  return r;
}

async function navigerSomEjer(port, session, tab, url, s, ejer, svar, navSlut) {
  const slut = navSlut ?? Date.now() + NAV_FRISTER.loft;
  // R109 (Astra 2): hvert ventepunkt er under samme frist. Ventningen slutter et forbehold foer loftet, saa de sidste opslag
  // (fanens adresse i svaret, CAPTCHA-kontrollen) ogsaa naar inden for det; succes afgoeres aldrig efter slutVent.
  const slutVent = slut - navForbehold();
  const tilbage = (ud = slutVent) => Math.max(0, ud - Date.now());
  // Fanen, som Chrome ser den nu: et objekt, null (fanen findes ikke) eller undefined (Chrome svarede ikke i tide).
  const fane = async (ud = slut) => {
    const r = await venteMedFrist(chrome.tabs.get(tab.id).catch(() => null), tilbage(ud));
    return r === FRIST_UDLOEB ? undefined : r;
  };
  // En ventende adresse, fanen allerede staar paa, venter ikke laengere.
  if (s.pendingUrl && String(tab.url || '') === s.pendingUrl) s.pendingUrl = null;
  // Trin 2: lytteren kender en aaben boks.
  if (s.boks) return svar('dialog-open', { sent: false, ...dialogFelter(s.boks), pending_url: s.pendingUrl });

  // Trin 3: debuggeren. Kan den ikke tilknyttes (chrome:// m.fl.), navigeres som foer - men uden dialoger i syne, og
  // aldrig med ok:true uden bevist indlaesning.
  let medDebugger = true;
  let attachFejl = null;
  const tilknyttet = await venteMedFrist(debuggerAttach(tab.id).then(() => true, (e) => e), tilbage());
  if (tilknyttet === FRIST_UDLOEB) {
    // R110 (Astra 2): en boks, koordinatoren saa aabne imens, er forklaringen - som ved porten.
    if (s.boks) return svar('dialog-open', { sent: false, ...dialogFelter(s.boks), pending_url: s.pendingUrl });
    return svar('tab-not-responding', { sent: false, detail: 'attaching the debugger did not finish in time' });
  }
  if (tilknyttet !== true) { medDebugger = false; attachFejl = tilknyttet?.message || String(tilknyttet); }
  if (s.lukketFane) return svar('tab-closed', { sent: false });
  if (medDebugger) {
    // Trin 4: porten. Svarer Page.enable, stod der ingen boks aaben i det oejeblik (maalt F4: den haenger bag en boks).
    let r;
    try {
      r = await venteMedFrist(cdpSend(tab.id, 'Page.enable', {}), Math.min(NAV_FRISTER.port, tilbage()));
    } catch (e) {
      if (erCdpFrist(e)) r = FRIST_UDLOEB;
      else return svar('navigation-failed', { sent: false, detail: e?.message || String(e) });
    }
    if (s.lukketFane) return svar('tab-closed', { sent: false });
    if (r === FRIST_UDLOEB) {
      // R108 (Opus): en boks, koordinatoren saa aabne, mens porten ventede, er forklaringen - sig det.
      if (s.boks) return svar('dialog-open', { sent: false, ...dialogFelter(s.boks), pending_url: s.pendingUrl });
      return svar('tab-not-responding', { sent: false, ...(s.pendingUrl ? { pending_url: s.pendingUrl } : {}) });
    }
  }

  // R75/R76 (Astra, maalt i model): en 'complete' taeller kun, naar navigationen er set begynde ('loading'), den gamle side
  // allerede var faerdig, da adressen blev sendt, eller adressen er den oenskede - ellers kan den vaere den gamle sides.
  // Haendelserne opfanges fra foer afsendelsen, saa en side fra cachen, samme adresse eller et fragment ikke venter.
  const foer = await fane(slutVent);
  if (foer === undefined) {
    if (s.boks) return svar('dialog-open', { sent: false, ...dialogFelter(s.boks), pending_url: s.pendingUrl });
    return svar('tab-not-responding', { sent: false, detail: 'Chrome did not report the tab in time' });
  }
  if (s.lukketFane || !foer) return svar('tab-closed', { sent: false });
  // Trin 5: en boks, der aabnede, mens porten ventede, eller lige efter - sidste tjek foer afsendelsen, i samme tur.
  if (s.boks) return svar('dialog-open', { sent: false, ...dialogFelter(s.boks), pending_url: s.pendingUrl });
  // R109 (Astra 1): et dialogsvar, der opstod under klargoeringen (fx en armering forbrugt paa en anden boks), kunne
  // lande paa denne navigations boks. Ogsaa det gentjekkes her, i samme tur som afsendelsen.
  if (s.udestaaende.size) {
    return svar('navigation-in-progress', { __note: 'navigation-in-progress-svar', sent: false, op_id: null, pending_url: s.pendingUrl,
      detail: 'an earlier answer to a dialog on this tab has not been confirmed by Chrome yet' });
  }
  const obs = { loading: false, completes: 0, completeUrl: '', gammelKlar: foer.status === 'complete', gammelUrl: String(foer.url || '') };
  const awaitingRealUrl = !url.startsWith('about:');
  let vaekker = null;
  const vaek = () => { const v = vaekker; vaekker = null; if (v) v(); };
  // Venter til en haendelse vaekker loekken eller tiden er gaaet - og rydder sit ur, saa intet ur haenger efter svaret.
  const sov = (ms) => new Promise((r) => {
    const ur = setTimeout(() => { vaekker = null; r(); }, Math.max(0, ms));
    vaekker = () => { clearTimeout(ur); r(); };
  });
  ejer.vaek = vaek;
  let minBoks = null;
  let bevist = false;
  let bevisFane = null;
  const opd = (tabId, info, t) => {
    if (tabId !== tab.id) return;
    if (info.status === 'loading') obs.loading = true;
    if (info.status === 'complete') { obs.completes++; obs.completeUrl = String((t && t.url) || info.url || ''); }
    vaek();
  };
  chrome.tabs.onUpdated.addListener(opd);
  const upd = { status: 'venter', fejl: null };
  try {
    // Trin 6: adressen sendes. Afvisningen afventes og slugs aldrig (Astra R107: et afvist tabs.update gav ok:true).
    ejer.sent = true;
    let updLoefte;
    try { updLoefte = Promise.resolve(chrome.tabs.update(tab.id, { url })); } catch (e) { updLoefte = Promise.reject(e); }
    updLoefte.then(() => { upd.status = 'ok'; vaek(); }, (e) => { upd.status = 'afvist'; upd.fejl = e?.message || String(e); vaek(); });

    let tjekket = 0;
    for (;;) {
      if (s.lukketFane) return svar('tab-closed', { sent: true });
      // Trin 7-8: en boks, der aabnede, efter at adressen var sendt. Koordinatoren har allerede valgt svareren og lagt
      // boksen paa ejeren - ogsaa en boks, der aabnede og lukkede, mens loekken ventede paa et opslag.
      if (ejer.bokse.length) minBoks = ejer.bokse[ejer.bokse.length - 1];
      const stay = ejer.bokse.find((b) => b.type === 'beforeunload' && b.lukket && b.lukket.result === false);
      if (stay) {
        const nu = await fane();
        return svar('beforeunload-blocked', { sent: true, url: nu?.url ?? null, answered_by: stay.besvaretAf });
      }
      if (minBoks && !minBoks.lukket) {
        // R108 (Astra 6): den ventende adresse gemmes ved hver uafklaret afgang med sent:true.
        if (minBoks.mistet) { s.pendingUrl = url; return dialogUbekraeftet(minBoks, { sent: true, tab_id: tab.id, requested_url: url, pending_url: url }); }
        if (!minBoks.besvaretAf) {
          s.pendingUrl = url;
          return svar('dialog-open', { __note: 'dialog-open-sent', sent: true, ...dialogFelter(minBoks), pending_url: url,
            url: (await fane())?.url ?? null });
        }
        // R108 (Astra 3): ventetiden paa Closed er ogsaa inden for det samlede loft.
        const rest = Math.min(minBoks.svaretVed + NAV_FRISTER.luk, slutVent) - Date.now();
        if (rest <= 0) {
          s.pendingUrl = url;
          return dialogUbekraeftet(minBoks, { sent: true, tab_id: tab.id, requested_url: url, pending_url: url,
            ...(Date.now() >= slutVent ? { may_complete_later: true } : {}) });
        }
        await sov(rest);
        continue;
      }
      // Trin 9: bevist indlaesning. R108 (Astra 1): den gamle sides 'complete' med den gamle adresse er intet bevis, og
      // succes kraever et tabs.update, Chrome har taget imod (ikke afvist, ikke stadig ubesvaret).
      if (obs.completes > tjekket) {
        tjekket = obs.completes;
        const nu = await fane(slutVent);
        if (nu === undefined) continue;                     // intet svar i tide: loftet nedenfor afgoer
        if (!nu) return svar('tab-closed', { sent: true });
        const nuUrl = String(nu.url || '');
        const indlaest = !awaitingRealUrl || (nu.status === 'complete' && !nuUrl.startsWith('about:blank'));
        const nyNok = obs.loading || obs.completeUrl === url || nuUrl === url || (obs.gammelKlar && nuUrl !== obs.gammelUrl);
        // R109 (Astra 2): opslaget er bundet af fristen, og succes afgoeres kun foer den (se loftet nedenfor).
        if (indlaest && nyNok) { bevist = true; bevisFane = nu; }
        continue;
      }
      // Trin 6: Chrome afviste adressen, foer nogen boks aabnede.
      if (upd.status === 'afvist' && !minBoks) return svar('navigation-failed', { sent: false, detail: upd.fejl });
      // Trin 10: loftet - FOER succes, saa succes aldrig afgoeres efter fristen.
      const rest = slutVent - Date.now();
      if (rest > 0 && bevist && upd.status === 'ok') break;
      if (rest <= 0) {
        s.pendingUrl = url;
        if (upd.status === 'venter') {
          const uafgjort = { opId: ejer.opId, url };
          s.uafgjort = uafgjort;
          updLoefte.catch(() => {}).finally(() => { if (s.uafgjort === uafgjort) s.uafgjort = null; });
        }
        return svar('navigation-unconfirmed', { sent: true, may_complete_later: true, pending_url: url,
          url: (await fane())?.url ?? null,
          ...(medDebugger ? {} : { detail: attachFejl, __tillaeg: ' The debugger could not attach to this tab, so a ' +
            '"Leave site?" dialog here cannot be seen or answered: if one is on screen, ask the user (browser_ask_user).' }) });
      }
      await sov(rest);
    }
  } finally {
    chrome.tabs.onUpdated.removeListener(opd);
  }

  // Bevist: samme svar som foer, nu med ok:true og - hvis en boks blev besvaret undervejs - hvem der svarede.
  s.pendingUrl = null;
  skiftAktiv(session, tab.id);
  persistSessions();
  // R109: fanen, som beviset saa den - intet nyt, ubegraenset opslag efter fristen.
  const updated = bevisFane;
  // R108 (Astra 3): CAPTCHA-kontrollen ligger inden for loftet. Naar den ikke naar frem, siger svaret det - ellers ville
  // en oversprunget kontrol ligne «ingen CAPTCHA».
  const captcha = await venteMedFrist(detectCaptcha(tab.id), tilbage(slut));
  const result = { ok: true, title: updated.title, url: updated.url, tab_id: tab.id, session: session.label };
  if (captcha === FRIST_UDLOEB) result.captcha_checked = false;
  if (minBoks) { result.answered_by = minBoks.besvaretAf; result.dialog_type = minBoks.type; }
  if (captcha && captcha.found) {
    result.captcha_detected = captcha.types.join(', ');
    result.hint = `CAPTCHA detected: ${captcha.types.join(', ')}. Use browser_solve_captcha to handle it.`;
  } else if (captcha && captcha.invisible) result.captcha_invisible = captcha.invisible.join(', ');
  return result;
}

function dialogUbekraeftet(boks, ekstra = {}) {
  return { ok: false, error: 'dialog-unconfirmed', ...dialogFelter(boks), answered_by: boks.besvaretAf,
    ...(boks.mistet ? { detail: boks.mistet === 'debugger-detached' ? 'the debugger detached from the tab' : boks.mistet } : {}),
    ...(boks.svarFejl ? { answer_error: boks.svarFejl } : {}),
    ...ekstra,
    note: 'The dialog was answered, but Chrome did not confirm that it closed. Nothing more was sent. Look at the tab ' +
      '(browser_screenshot or browser_list_tabs) before you act again; if a dialog is still on screen, ask the user ' +
      '(browser_ask_user) to answer it in Chrome.' };
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
      ...generationFraLager(d),
    });
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  afvaebnDialog(tabId, 'the tab was closed before any dialog appeared');
  dialogFaneMistet(tabId, true);
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
    // R173: en OAuth-popup, udvidelsen selv gjorde aktiv, lukkede sig selv - tilbage til aabneren, hvis den stadig er
    // sessionens og popuppen stadig var den aktive fane (agenten havde ikke selv skiftet).
    // R174 (Astra): ikke naar agenten selv lukkede popuppen - saa gaelder no-active-tab som ved enhver anden af dens lukninger.
    if (session.tilbageTil && session.tilbageTil.popup === tabId) {
      const aabner = session.tilbageTil.aabner;
      session.tilbageTil = null;
      if (!lukketAfAgenten && session.activeTabId === tabId && session.tabIds.has(aabner)) { skiftAktiv(session, aabner); persistSessions(); }
    }
    if (session.tabIds.size === 0 && !lukketAfAgenten) {
      // Last tab closed — tell offscreen to terminate the MCP server.
      // Resulting WS-close triggers the existing session_disconnect → releaseSession path.
      frivilligtFrigivet.set(port, session.gen ?? null);
      chrome.runtime.sendMessage({ type: 'terminate_mcp_session', port, gen: session.gen ?? null }).catch(() => {});
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
  // R125 (Astra/Opus): "\n" og "\t" har ingen code - de er ikke Enter- eller Tab-tasten (se fysiskTast og typeCharsAttached,
  // der indsaetter kontroltegn som tekst), og en side, der lytter paa e.code === 'Enter', maa ikke udloeses af en vaerdi.
  ' ': 'Space',
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

// #76 (arasmileska): den fysiske tast for en tast eller et tegn - code, tastkode (keyCode) og om Shift holdes nede. Brugt
// af ALLE steder, der sender et tastetryk over CDP (press_key, fill's tegn-for-tegn-skrivning, rydning, Tab, PageUp/Down),
// saa siden ser det samme som fra et rigtigt US-tastatur. Uden tastkode faar keydown keyCode 0, og et tag-felt, der lytter
// paa keyCode 188, faar aldrig sit komma. Et skiftet tegn ("<", "@") er samme tast med Shift holdt nede. Store bogstaver
// faar IKKE Shift her (det har press_key aldrig givet dem). "\n", "\r" og "\t" faar ingen tastkode og ingen code - og fill
// sender dem slet ikke som taster, men som indsat tekst (typeCharsAttached, R126): som taster sendte "\r" formularen, "\t"
// flyttede fokus, og "\n" forsvandt (MAALT i Chrome).
const NAVNGIVNE_TASTKODER = {
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Escape: 27, Space: 32,
  PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46,
};
const TEGN_TASTKODER = { Space: 32, Comma: 188, Period: 190, Minus: 189, Equal: 187, Semicolon: 186, Quote: 222,
  Slash: 191, Backslash: 220, BracketLeft: 219, BracketRight: 221, Backquote: 192 };
const SKIFTEDE_TEGN = '<>?:"{}|_+~!@#$%^&*()';
function fysiskTast(key) {
  // R125 (Astra): et tegn er ét kodepunkt - ogsaa et uden for BMP ("😀" er to UTF-16-enheder). Kun et navn som "Enter",
  // "ArrowDown" eller "F5" er sin egen code; alt andet uden for US-tabellen faar ingen code, aldrig sig selv.
  if (typeof key !== 'string' || [...key].length !== 1) {
    const navn = typeof key === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(key);
    return { code: navn ? key : '', vk: navn ? NAVNGIVNE_TASTKODER[key] : undefined, shift: false };
  }
  const code = cdpCodeForChar(key);
  const vk = /^Key[A-Z]$/.test(code) ? code.charCodeAt(3)
    : /^Digit\d$/.test(code) ? code.charCodeAt(5)
    : TEGN_TASTKODER[code];
  return { code, vk, shift: SKIFTEDE_TEGN.includes(key) };
}
// CDP-felterne for tastkoden (tomt, naar tasten ingen har).
function tastkodeFelter(vk) { return vk ? { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk } : {}; }

// Types text as individual key events. Assumes the debugger is already attached —
// debuggerType() is the public wrapper that manages attach/detach.
// R127: hvilket slags felt har fokus lige nu? 'tekst' (textarea eller contenteditable: et linjeskift er tekst), 'linje'
// (et <input>: et linjeskift sender formularen) eller 'ukendt' (en iframe, intet felt, eller kunne ikke laeses). Gennem aabne
// shadow roots til det element, der faktisk har fokus. Et linjeskift skrives kun ved 'tekst'.
async function linjeFelt(tabId) {
  const svar = await evalAttached(tabId, `(() => { /* bmcpLinjeFelt */
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    // R130 (Opus, MAALT i Chrome): paa en XHTML-side er tagName "textarea" med smaa bogstaver - navnet sammenlignes derfor
    // uden hensyn til store og smaa bogstaver (localName, ellers tagName).
    const navn = a ? String(a.localName || a.tagName || '').toLowerCase() : '';
    if (!a || navn === 'iframe' || navn === 'frame') return 'ukendt';
    if (navn === 'textarea' || a.isContentEditable) return 'tekst';
    // R138 (Opus, MAALT i Chrome): mellemrumstasten klikker en knap, sender med en submit-knap og saetter et kryds. Kun et
    // tekst-input faar linjeskiftet som mellemrum ('linje'); alt andet ('ukendt') faar intet.
    if (navn === 'input') {
      const type = String(a.type || 'text').toLowerCase();
      return ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(type) ? 'linje' : 'ukendt';
    }
    return 'ukendt';
  })()`).catch(() => 'ukendt');
  return svar === 'tekst' || svar === 'linje' ? svar : 'ukendt';
}

async function typeCharsAttached(tabId, text) {
  const linjeskift = { somTekst: 0, somMellemrum: 0, udeladt: 0 };   // R130/R138: hvordan linjeskiftene blev skrevet (svaret siger det)
  // MAALT i aegte headless Chrome (4044388): "hej 😀 👍🏽 é" endte som "hej �� ���� é" - hver UTF-16-halvdel blev sendt som
  // sit eget tegn. Ét tastetryk pr. KODEPUNKT; "👍🏽" (to kodepunkter) og "👩‍💻" (tre) bliver til det rigtige i feltet.
  const tegn = [...String(text)];
  // #76: tastkode og Shift fra den fysiske tast (fysiskTast) - teksten er stadig tegnet selv.
  const tastTegn = async (char) => {
    const { code, vk, shift } = fysiskTast(char);
    const mods = shift ? { modifiers: 8 } : {};
    await tastParAttached(tabId,
      { text: char, key: char, ...(code ? { code } : {}), unmodifiedText: char, ...tastkodeFelter(vk), ...mods },
      { key: char, ...(code ? { code } : {}), ...tastkodeFelter(vk), ...mods });
  };
  for (let i = 0; i < tegn.length; i++) {
    const char = tegn[i];
    // R126 (Opus, MAALT i Chrome): "\t" kom frem som Tab og flyttede fokus, "\r" sendte formularen, og "\n" forsvandt i en
    // textarea. Et kontroltegn er tekst i vaerdien, ikke en tast: det indsaettes som tekst og kan hverken sende eller flytte.
    if (char < ' ') {
      if (char === '\r' || char === '\n') {
        // MAALT i Chrome (R126): et ENKELT "\n" eller "\r" indsat i et <input> sender formularen (som Enter), og "\r" + "\n"
        // hver for sig giver to linjeskift i en textarea. Et linjeskift er ét: "\r\n" og "\r" bliver "\n". R127 (Astra): det
        // aktive felt laeses ved HVERT linjeskift (fokus kan skifte undervejs), og linjeskiftet skrives kun i en textarea eller
        // et contenteditable-felt; i et enkeltlinje-input, i en iframe eller naar feltet ikke kan laeses, udelades det.
        if (char === '\r' && tegn[i + 1] === '\n') continue;
        // R130 (Opus): udeladt limede det ord sammen ("a\nb" -> "ab"); et mellemrum holder dem adskilt og sender ingen formular.
        // MAALT i Chrome (R130): et felt, der kun tager tastet input, afviste et INDSAT mellemrum - her tastes det som
        // mellemrumstasten, ligesom de andre tegn (et mellemrum sender ingen formular).
        // R138 (Opus): kun i et tekst-input - fokus kan hoppe til en knap eller et afkrydsningsfelt midt i skrivningen, og der
        // trykker mellemrumstasten paa det. Andre steder (knap, afkrydsning, ramme, ukendt) udelades linjeskiftet, og svaret siger det.
        const felt = await linjeFelt(tabId);
        if (felt === 'linje') {
          await tastTegn(' ');
          linjeskift.somMellemrum++;
          continue;
        }
        if (felt !== 'tekst') { linjeskift.udeladt++; continue; }
        await cdpSend(tabId, 'Input.insertText', { text: '\n' });
        linjeskift.somTekst++;
        continue;
      }
      await cdpSend(tabId, 'Input.insertText', { text: char });
      continue;
    }
    await tastTegn(char);
    // Human-like typing: random 30-120ms, occasional longer pause
    const pause = (i > 0 && i % (7 + Math.floor(Math.random() * 5)) === 0)
      ? 150 + Math.random() * 200  // thinking pause every ~10 chars
      : 30 + Math.random() * 90;   // normal keystroke
    await new Promise(r => setTimeout(r, pause));
  }
  return linjeskift;
}

// R125 (Astra, MAALT i model; Opus i Chrome): skrives der tegn for tegn, maales ogsaa om tasterne NAAEDE siden (samme
// lytter som press_key, i udvidelsens egen verden). Et tomt felt bagefter er ikke bevis for at intet kom frem: et tag-felt
// goer teksten til et tag og tommer feltet. Uden beviset raadede svaret agenten til at proeve igen - og saa kom tagget to gange.
async function skrivTegnMedBevis(tabId, text) {
  const forventet = [...String(text)].find((c) => c >= ' ');
  const bevis = forventet ? await armerTastBevis(tabId, forventet).catch(() => null) : null;
  const linjeskift = await typeCharsAttached(tabId, text);
  const levering = bevis ? await laesTastBevis(tabId, bevis, { enhverTast: true }) : { landed: null };
  return { ...levering, linjeskift };
}

async function debuggerType(tabId, text) {
  await debuggerAttach(tabId);
  try {
    return await skrivTegnMedBevis(tabId, text);
  } finally {
    await debuggerDetach(tabId);
  }
}

// Svaret naar feltet er tomt efter en skrivning. `landed`: naaede tasterne siden (true), ikke (false), uvist (null).
// Raadet om at proeve igen gives KUN, naar intet naaede frem.
// R127 (MAALT i Chrome): en vaerdi af KUN linjeskift i et felt, der ikke tager linjeskift (linjeFelt), skrives slet ikke - saa
// er et tomt felt det rigtige udfald, ikke en fejl, og intet blev sendt, der kunne sende formularen.
// R130 (Opus i Chrome, Astra i model): noten sagde «this field takes none ... left out ... Nothing was sent» - ogsaa i en
// textarea, hvor "\n" BLEV sendt, og siden afviste det. Noten siger nu, hvordan linjeskiftene faktisk blev sendt (som linjeskift
// i et tekstfelt, som mellemrum i et felt uden linjeskift), og at feltet ikke tog dem.
function kunLinjeskiftSvar(ekstra, ls) {
  const somMellemrum = !!(ls && ls.somMellemrum && !ls.somTekst);
  const udeladt = ls && ls.udeladt ? ls.udeladt : 0;
  // R138: blev de alle udeladt, er intet sendt - og et tomt felt er netop det.
  if (udeladt && !(ls.somMellemrum || ls.somTekst)) {
    return { ok: true, ...ekstra, differs: true, value: '', actual: '', line_breaks_left_out: udeladt,
      note: 'The value holds only line breaks, and they were left out: the tool did not recognise the focused element as a text ' +
        'field (a button, a checkbox, a frame, or an element it could not read), so nothing was sent.' };
  }
  return { ok: true, ...ekstra, differs: true, value: '', actual: '',
    ...(somMellemrum ? { line_breaks_as_spaces: ls.somMellemrum } : {}),
    ...(udeladt ? { line_breaks_left_out: udeladt } : {}),
    note: 'The value holds only line breaks. They were sent ' +
      (somMellemrum ? 'as spaces (this field takes no line breaks: a single-line text input)'
        : 'as line breaks') + ', but the field is empty afterwards: the field did not take them.' };
}

// R130: blev linjeskift skrevet som mellemrum, siger svaret det - og er det den eneste forskel, skyder noten ikke aendringen
// paa siden («formatted»): det var vaerktoejet, der skrev mellemrummet.
function medLinjeskift(svar, oensket, ls) {
  if (!svar || !ls || (!ls.somMellemrum && !ls.udeladt) || svar.line_breaks_as_spaces || svar.line_breaks_left_out) return svar;
  const n = ls.somMellemrum || 0;
  const u = ls.udeladt || 0;
  const saetninger = [];
  if (n) saetninger.push((n === 1 ? 'A line break was typed as a space' : `${n} line breaks were typed as spaces`) +
    ': this field is a single-line text input, and a line break there could submit the form.');
  // R138 (Opus): en knap, et afkrydsningsfelt eller en ramme faar hverken linjeskift eller mellemrum - mellemrumstasten ville trykke paa dem.
  if (u) saetninger.push((u === 1 ? 'A line break was left out' : `${u} line breaks were left out`) +
    ': the tool did not recognise the focused element as a text field (a button, a checkbox, a frame, or an element it could ' +
    'not read), and a ' +
    'key there could press it.');
  const saetning = saetninger.join(' ');
  const normal = String(oensket).replace(/\r\n?/g, '\n');
  const forventet = u && !n ? normal.replace(/\n/g, '') : normal.replace(/\n/g, ' ');
  const kunDet = !ls.somTekst && !(n && u) && typeof svar.actual === 'string' && svar.actual === forventet;
  return { ...svar, ...(n ? { line_breaks_as_spaces: n } : {}), ...(u ? { line_breaks_left_out: u } : {}),
    note: kunDet || !svar.note ? saetning : `${svar.note} ${saetning}` };
}
const kunLinjeskift = (v) => /[\r\n]/.test(String(v)) && String(v).replace(/[\r\n]/g, '') === '';

function tomtFeltSvar(ekstra, landed, ikkeLeveretNote) {
  if (landed === true) {
    return { ok: true, ...ekstra, differs: true, keys_delivered: true, value: '', actual: '',
      note: 'The tool saw keys arrive, but the field is empty afterwards. Either the page turned the text into something ' +
            'else - a tag or chip input makes it a tag and clears the field - or it rejected the keys (a field that blocks ' +
            'typing, a length limit, a field that takes only digits). Check the page before typing it again: repeating it ' +
            'may add it twice.' };
  }
  if (landed === null) {
    return { ok: false, ...ekstra, error: 'field-is-empty', value: '', actual: '', keys_delivered: null,
      note: 'The field was empty after the write, and whether the keys arrived could not be measured (the page may also ' +
            'have navigated). Check the page first: it may have handled the text (a tag or chip input turns it into a tag ' +
            'and clears the field) or rejected it. Only if nothing happened there: the tab may be in the background - call ' +
            'browser_switch_tab, then type it again.' };
  }
  return { ok: false, ...ekstra, error: 'field-is-empty', value: '', actual: '', keys_delivered: false, note: ikkeLeveretNote };
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
// select_option havde stadig den gamle ("ikke falsk" = landet), saa et unknown klik blev til ok:true.
function klikLandede(r) {
  return r?.landed === true || r?.detached === true;
}

// Teksten der foelger med et unknown klik. Staar ét sted, fordi den skal vaere ens for click, click_xy og select_option -
// tre kaldesteder med den samme regel har foer drevet fra hinanden (select_option havde den gamle i to udgaver).
const UVIST_NOTE = 'The click was sent, and the page changed on mousedown - but not from the click itself. That may be a ripple, and it may be a menu that opens on mousedown. Check the state before clicking again: a second click closes a menu that is already open.';
const IRAMME_NOTE = 'The click went into a frame (an iframe), and the page around it cannot see what happened inside. ' +
  'It may have landed: check the frame before clicking again (browser_select_frame reads inside it).';
const UVERIFICERET_NOTE = 'The mouse button was sent, but the page could not be read afterwards (the lookup failed and the page did not navigate). ' +
  'The click may have landed. Check the state before clicking again.';

// MAALT 12/9 af Astra: der er TO uvisheds-kanaler - `unknown` (kun mousedown aendrede noget) og `uverificeret`
// (settle-opslaget fejlede uden navigation, men museknappen ER sendt). Rettelsen roerte kun den foerste, saa den anden
// gav stadig et bart ok:false hvor 1.29.0 gav ok:true - og et bart nej faar agenten til at klikke igen.
// Betingelsen spoerger derfor paa landed === null, ikke paa ét flag: en fremtidig tredje kanal er daekket fra dag ét.
// MAALT 19/9: `note` kan nu gives af kalderen. Uden det laante select-grenens tredje udfald
// UVERIFICERET_NOTE, som siger "Museknappen blev sendt, men siden kunne ikke laeses bagefter".
// Begge dele er forkerte for en select: der er ingen museknap, og siden BLEV laest - det er
// netop derfor vi ved at noget flyttede sig. En rigtig dom med en forkert begrundelse sender
// laeseren det forkerte sted hen, og det er den samme fejlklasse som resten af 1.29.2.
function uvisVurdering(r, egenNote) {
  if (!r || r.landed !== null) return null;
  if (egenNote) return { maybe_landed: true, note: egenNote };
  if (r.unknown) return { maybe_landed: true, note: UVIST_NOTE };
  if (r.unverified && r.dialog) return { maybe_landed: true, note: 'A dialog opened during the click, and the page could not be read while it was open, so whether the target got the click cannot be told. Answer the dialog with browser_handle_dialog, then check the state before clicking again.' };
  if (r.unverified) return { maybe_landed: true, note: UVERIFICERET_NOTE };
  if (r.iRamme) return { maybe_landed: true, note: IRAMME_NOTE };
  if (r.udskiftetMaal) return { maybe_landed: true, note: 'The page replaced the target while the mouse was on it (for instance on the press), so whether the new element got the click cannot be told. Check the state before clicking again.' };
  if (r.ingenHaendelse) return { maybe_landed: true, note: 'The click was sent, but no mouse event reached the page around the target - it may have gone into a frame, or a listener on the window stopped it. Check the state before clicking again.' };
  if (r.slipAndetSted) return { maybe_landed: true, note: 'The press reached the target, but the page moved the release elsewhere (a menu or backdrop that opened on the press, or a drag), so whether the click completed cannot be told. Check the state before clicking again.' };
  if (r.forfaderUdenBevis) return { maybe_landed: true, note: 'The click reached an element around the target that listens for clicks itself, not the target; whether that was the target\'s action cannot be told. Check the state before clicking again.' };
  if (r.stoppetUndervejs) return { maybe_landed: true, note: 'The click reached the page, but something on the way stopped it before the target - the page may have acted on it itself. Check the state before clicking again.' };
  return { maybe_landed: true, note: 'The action was sent, but its effect could not be confirmed. Check the state before repeating it.' };
}

// MAALT 10/9 af Astra (anden runde): et settle-opslag der FEJLEDE gav null, og null blev til ok:true.
// Men den hyppigste grund til at opslaget fejler er at klikket navigerede - det er en virkning, og agenten
// maa ikke faa at vide at den skal klikke igen.
// Tredje runde: "detached", "closed" og "Cannot find" er IKKE bevis for navigation - afkobling sker ogsaa
// naar nogen aabner DevTools. Bevis er nu: fanen er lukket, adressen er skiftet, eller JavaScript-konteksten
// blev revet ned (det sker kun naar dokumentet blev udskiftet). Alt andet er unknown og siges som unknown.
async function tolkManglendeSettle(tabId, settle, urlFoer) {
  const fejl = settle?.__fejl || 'the settle lookup returned nothing';
  const fane = await chrome.tabs.get(tabId).catch(() => null);
  const urlEfter = fane?.url ?? null;
  const kontekstVaek = /Execution context was destroyed|Cannot find context with specified id|Inspected target navigated/i.test(fejl);
  if (!fane || (urlFoer && urlEfter && urlEfter !== urlFoer) || kontekstVaek) {
    return { landed: false, fallbackFired: false, detached: true, navigated: true };
  }
  return { landed: null, fallbackFired: false, unverified: true, fejl };
}

async function debuggerClick(tabId, x, y, bundet = false) {
  await debuggerAttach(tabId);
  // Er museknappen sendt ned, kan klikket vaere landet - saa maa en fejl bagefter ikke fore til et klik til.
  let trykSendt = false;
  let vagtArmet = false;
  try {
    // R64 (Opus' ramme.html, maalt i Chrome 9/10): et klik paa en iframe gaar ind i rammens eget dokument, som lytteren her
    // ikke ser. Betalingsknappen i rammen fik klikket, svaret var ok:false, og reserven sendte et klik til. Nu: ingen reserve,
    // og svaret er uvist (iRamme), saa agenten tjekker rammen i stedet for at klikke igen.
    // R67 (Astra, maalt i model): en fremmed ramme, der kom foran EFTER trykket (sendt > 0), gav «stoppet undervejs» og
    // ikke covered. Ligger der en fremmed ramme i punktet, og naaede klikket ikke maalet, er svaret nu altid covered + uvist.
    // R65 (Opus, maalt i Chrome): testen saa paa det fundne maal, ikke paa det trykket ramte - en div om en betalingsramme
    // (som Stripe) og en fremmed iframe, der kom frem over maalet, gav stadig et syntetisk klik nr. 2. Nu: saa vagten ingen
    // haendelse overhovedet, er der ingen reserve; ligger der en ramme i punktet, er den maalets (uvist) eller fremmed (covered).
    // R64: `bundet` = klikket hoerer til et element, resolveElement lige har fundet. Vagten i siden binder haendelserne til
    // det (armerMaalVagt). Ligger noget andet i punktet nu, sendes intet. Kan vagten ikke armeres, sendes intet (R70).
    // Med vagten svarer efterkontrollen ud fra vagten alene (blokeret, ingen haendelse, naaet maalet, udskiftet, stoppet
    // undervejs), og reserven naas aldrig - saa den kan ikke ramme et overlay, der kom frem efter opslaget.
    if (bundet) {
      const vagt = await armerMaalVagt(tabId, x, y, VAGT_KLIK);
      if (vagt && vagt.daekket) return { landed: false, fallbackFired: false, blokeret: vagt.daekket, foerSendt: true };
      if (vagt && vagt.vaek) return { landed: false, fallbackFired: false, vaek: true };
      vagtArmet = !!(vagt && vagt.armet);
      // R70 (Astra, maalt i model): uden armeret vagt faldt klikket tilbage paa 1.30.1's bevis (en lytter paa dokumentet), der
      // saa et klik, siden stoppede foer maalet, og gav ok:true, eller et nej efter en handling og et syntetisk klik til. Et
      // bundet klik sendes derfor kun med vagten; kan den ikke armeres, sendes intet.
      if (!vagtArmet) return { landed: false, fallbackFired: false, ikkeArmeret: true };
    }
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
        const vagt = ${vagtArmet} ? window.__bmcpVagt : null;
        const landed = window.__bmcpClicked === true;
        const iMaal = vagt ? (!vagt.urent && ((vagt.naaet && vagt.naaet.click) || 0) > 0) : landed;
        const ryd = () => {
          try { window.__bmcpClickListener && document.removeEventListener('click', window.__bmcpClickListener, true); } catch (e) {}
          try { delete window.__bmcpClickTarget; delete window.__bmcpClicked; delete window.__bmcpClickListener; } catch (e) {}
        };
        if (${vagtArmet} && !vagt) { ryd(); return { landed: null, fallbackFired: false, unverified: true, fejl: 'the guard was gone' }; }
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
                   hash(Array.from(document.querySelectorAll('input,textarea,select')).map((e) => String(e.value || '')).join('\0'));
          } catch (e) { return 'aftryk-fejlede'; }
        };
        // R69: uden en armeret vagt vides det ikke, om trykket naaede maalet - null, ikke false (ellers sagde select_option «did not reach it»).
        const trykNaaet = vagt ? (((vagt.naaet && vagt.naaet.pointerdown) || 0) + ((vagt.naaet && vagt.naaet.mousedown) || 0)) > 0 : null;
        if (vagt && vagt.blokeret) { ryd(); return { landed: false, fallbackFired: false, blokeret: vagt.blokeret, delvis: !!vagt.delvis, trykNaaet }; }
        let p = vagt ? document.elementFromPoint(${x}, ${y}) : null;
        for (let i = 0; i < 20 && p && p.shadowRoot; i++) { const n = p.shadowRoot.elementFromPoint(${x}, ${y}); if (!n || n === p) break; p = n; }
        const rammeIPunkt = !!p && /^(IFRAME|FRAME|OBJECT|EMBED)$/.test(p.tagName || '');
        // R68 (Astra, maalt i model): el er det, der laa i punktet ved gemningen - en fremmed iframe, der kom frem foer den,
        // blev regnet for maalets egen. Sammenlign med det fundne maal (vagtens).
        const maalEl = (vagt && vagt.maal) || el;
        let rammeIMaalet = false;
        for (let n = p; n; n = n.parentNode || n.host) if (n === maalEl) { rammeIMaalet = true; break; }
        if (vagt && !iMaal && rammeIPunkt && !rammeIMaalet) {
          ryd();
          return { landed: null, fallbackFired: false, fremmedRamme: { tag: p.tagName, id: p.id || null, text: '' }, trykNaaet };
        }
        if (vagt && vagt.sendt === 0) { ryd(); return { landed: null, fallbackFired: false, trykNaaet, ...(rammeIPunkt ? { iRamme: true } : { ingenHaendelse: true }) }; }
        if (el && /^(IFRAME|FRAME|OBJECT|EMBED)$/.test(el.tagName || '')) { ryd(); return { landed: null, fallbackFired: false, iRamme: true }; }
        if (iMaal) { ryd(); return { landed: true, fallbackFired: false }; }   // FIX-13: trusted click already landed — do NOT double-fire
        if (vagt && vagt.vaek) { ryd(); return { landed: null, fallbackFired: false, udskiftetMaal: true, trykNaaet }; }
        if (vagt && vagt.urent) { ryd(); return { landed: null, fallbackFired: false, slipAndetSted: true, trykNaaet }; }
        if (vagt && vagt.forfader) { ryd(); return { landed: null, fallbackFired: false, forfaderUdenBevis: true, trykNaaet }; }
        if (vagt && vagt.sendt > 0) { ryd(); return { landed: null, fallbackFired: false, stoppetUndervejs: true, trykNaaet }; }
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
        // MAALT 12/9 af Fable (e2e runde 3): her sammenlignedes med aftrykket fra FOER mousedown.
        // Rettelsen af R5 F5 ovenfor gjaldt kun HVILKEN vej der blev proevet, ikke hvad vi SVAREDE. Uden en framework-vej
        // at falde tilbage paa gav en ripple derfor stadig landed:true med nul handling.
        // Tre udfald, ikke to: aendrede klikket (eller framework-vejen) noget, er det landet. Aendrede kun mousedown
        // noget, ved vi det ikke - det kan vaere en ripple, men ogsaa en menu der aabner paa mousedown. Saa siges der
        // hverken ja eller nej: landed null bliver til maaske_landet hos kalderen, med den maalte tilstand.
        const efterAftryk = aftryk();
        const klikketVirkede = efterAftryk !== foerKlik;
        const kunMousedown = !klikketVirkede && foerKlik !== foerAftryk;
        ryd();
        return {
          landed: kunMousedown ? null : klikketVirkede,
          ...(kunMousedown ? { unknown: true } : {}),
          fallbackFired: true, aftrykFoer: foerAftryk, aftrykEfter: efterAftryk,
        };
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
    // R67 (Opus, maalt i Chrome): et slip, siden flyttede, aabnede en alert; efterkontrollen kunne ikke laese vagten, mens
    // dialogen holdt siden, og faldt tilbage til landed:true - selv om klikket aldrig naaede maalet. Med vagten armet er det
    // nu uvist.
    if (vagtArmet && vaerdi && vaerdi.rendererSvarede === false) return { landed: null, fallbackFired: false, unverified: true, dialog: true };
    return vaerdi ?? await tolkManglendeSettle(tabId, settle, urlFoer);
  } catch (e) {
    if (trykSendt && e && typeof e === 'object') e.trykSendt = true;
    throw e;
  } finally {
    if (vagtArmet) await laesMaalVagt(tabId);
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

// CSS viewport and devicePixelRatio for a screenshot. Page.captureScreenshot returns DEVICE
// pixels, but browser_click_xy takes CSS pixels. Measured 2026-10-04 at devicePixelRatio 1.65
// (display scaling 150 % x page zoom 110 %): a position read off the image and passed to
// click_xy missed by ~450 px, and click_xy still answered landed:true. Read through CDP, so it
// also works where page scripts are blocked. Best-effort: a screenshot never fails because of it.
function pngSize(dataUrl) {
  try {
    const b64 = String(dataUrl || '').replace(/^data:image\/png;base64,/, '');
    const bin = atob(b64.slice(0, 44));   // signature (8) + IHDR length/type (8) + width/height (8)
    if (bin.slice(12, 16) !== 'IHDR') return null;
    const u32 = (i) => ((bin.charCodeAt(i) << 24) | (bin.charCodeAt(i + 1) << 16) |
                        (bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3)) >>> 0;
    return { width: u32(16), height: u32(20) };
  } catch (e) {
    return null;
  }
}

// R50 (Astra, MAALT): maalingen laa uden for skaermbilledets budget - et billede der kom efter 29 s, fulgt af en
// maaling der hang i 1,5 s, naaede ikke serverens frist paa 30 s. Den faar nu kun det, der er tilbage (maxMs).
async function screenshotViewport(tabId, image, maxMs = 1500) {
  const frist = Math.min(1500, maxMs);
  if (!(frist > 0)) return undefined;
  try {
    let timer;
    const m = await Promise.race([
      cdpSend(tabId, 'Page.getLayoutMetrics', {}),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), frist); }),
    ]).finally(() => clearTimeout(timer));
    const css = m?.cssVisualViewport;
    if (!css?.clientWidth || !css?.clientHeight) return undefined;
    // R50 (Opus, MAALT i Chrome med en klassisk rullebjaelke): billedet rummer rullebjaelken, men
    // cssVisualViewport goer ikke, saa forholdet blev 2,033 i stedet for 2 og et klik ved hoejre kant
    // ramte op til 15 px skaevt. Forholdet tages fra Chromes to maal af SAMME flade (visualViewport i
    // enhedspixel og cssVisualViewport i CSS-pixel, begge uden rullebjaelke), og billedets CSS-stoerrelse
    // er billedets stoerrelse delt med forholdet.
    const png = pngSize(image);
    const dpr = m?.visualViewport?.clientWidth ? m.visualViewport.clientWidth / css.clientWidth
      : (png ? png.width / css.clientWidth : 0);
    if (!dpr) return undefined;
    return {
      css_width: Math.round(png ? png.width / dpr : css.clientWidth),
      css_height: Math.round(png ? png.height / dpr : css.clientHeight),
      device_pixel_ratio: Math.round(dpr * 1000) / 1000,
      ...(png ? { image_width: png.width, image_height: png.height } : {}),
    };
  } catch (e) {
    return undefined;
  }
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
  await markerAltAttached(tabId);
  await sletMarkeretAttached(tabId);
}
async function markerAltAttached(tabId) {
  // R125 (Opus, MAALT i Chrome paa macOS): cmd+a markerede ikke alt, og set_date's maskerede vej skrev datoen bag den
  // gamle ("16/10/202601/01/2000"). #68's laere: kun Chromes egen kommando markerer paa macOS.
  await tastParAttached(tabId, { key: 'a', code: 'KeyA', modifiers: SELECT_ALL_MODS, ...tastkodeFelter(65), commands: ['selectAll'] },
    { key: 'a', code: 'KeyA', ...tastkodeFelter(65) });
}
async function sletMarkeretAttached(tabId) {
  await tastParAttached(tabId, { key: 'Backspace', code: 'Backspace', ...tastkodeFelter(8) },
    { key: 'Backspace', code: 'Backspace', ...tastkodeFelter(8) });
}

// Clear only when the focused field has something in it. Backspace in an EMPTY
// multi-select search input deletes the previous chip (Ant Design Select/TreeSelect,
// react-select, MUI Autocomplete) - the same reason setCombobox never presses it on an
// empty field. Measured 2026-10-04 on Ant Design TreeSelect: fill removed the selected
// chip on every call. When the value cannot be read, clear as before.
async function clearFieldIfFilledAttached(tabId) {
  const current = await evalAttached(tabId, `
    (function() {
      const el = document.activeElement;
      return el && 'value' in el ? String(el.value) : null;
    })()
  `).catch(() => null);
  if (current === '') return false;
  await clearFieldAttached(tabId);
  return true;
}

/**
 * Tre-vejs dom paa hvad der FAKTISK staar i feltet. Delt af fill's to grene.
 *
 * FUNDET 13/9 af Astra: tekst-grenen fik den her dom om formiddagen, CSS-grenen ikke - og
 * CSS-grenen er den mest brugte. Én funktion, saa de ikke kan drive fra hinanden igen.
 */
// `actual` staar ved siden af `value` fordi serverens instruktion til agenten siger
// «browser_fill with differs: true … read actual» (mcp-server/index.js INSTRUCTIONS; navnene hed `faktisk`/`vaerdi` foer 1.30.0). FUNDET 19/9:
// kun reservestien satte det felt; den her - den almindelige - svarede `vaerdi` alene, saa
// raadet pegede paa noget der ikke fandtes. Samme vaerdi, to navne, saa ingen af de to
// kodestier kraever at agenten ved hvilken den ramte. Fjern ikke `vaerdi`: det er
// API-overflade nogen kan laese i dag.
function fyldSvar(laest, oensket, ekstra, rammeHoerte, tasterLanded, linjeskift) {
  if (laest === undefined || laest === null) {
    return { ok: true, ...ekstra, unknown: true,
      note: 'The text was written, but the field could not be read afterwards, so it is unknown whether ' +
            'it landed. Read the field with browser_execute_script if it matters.' };
  }
  const ikkeLeveret = 'The field was empty after the write. Chrome acknowledged both the insertion and ' +
    'the keystrokes, but the field did not take them. The tab is probably in the background, where ' +
    'Chrome does not deliver keystrokes. Call browser_switch_tab and try again.';
  if (laest === '' && kunLinjeskift(oensket)) return kunLinjeskiftSvar(ekstra, linjeskift);
  if (laest === '') {
    // R125: blev der skrevet tegn for tegn, afgoer leveringen raadet (tomtFeltSvar); ellers som foer.
    if (tasterLanded !== undefined) {
      return tomtFeltSvar(ekstra, tasterLanded, 'The field was empty after the write, and the tool saw no key arrive. ' +
        'The tab is probably in the background, where Chrome does not deliver keystrokes. Check the page before typing ' +
        'again (an editor can hide keys from the tool); if nothing happened there, call browser_switch_tab and try again.');
    }
    return { ok: false, ...ekstra, error: 'field-is-empty', value: laest, actual: laest, note: ikkeLeveret };
  }
  if (laest === String(oensket)) {
    // FUNDET 19/9 (issue #19): her stoppede vi. DOM-vaerdien var rigtig, saa vi svarede ja -
    // og en React-styret formular opfoerte sig bagefter som om feltet var tomt. Trackeren er
    // det eneste sted rammens egen opfattelse staar, og den modsiger DOM'en praecis naar
    // rammen ikke har hoert efter. Det er positivt bevis for at det IKKE landede, ikke uvished.
    if (rammeHoerte === false) {
      return { ok: true, ...ekstra, value: laest, actual: laest, framework_did_not_hear: true,
        note: 'The field SHOWS the right text, but the page\'s own state has not heard it: ' +
              'React\'s value tracker is still on the old value. The form will ' +
              'probably behave as if the field were empty, and the value may be discarded ' +
              'on submit. Click the field with browser_click and type with browser_press_key, ' +
              'or verify the result before moving on.' };
    }
    return { ok: true, ...ekstra, value: laest, actual: laest };
  }
  return { ok: true, ...ekstra, differs: true, value: laest, actual: laest,
    note: 'The field contains something other than what was typed. The page has probably formatted ' +
          'the value - or something was already there.' };
}

// Why a field cannot take typed text: 'readonly', 'disabled', or null. Checked BEFORE typing.
// Measured 2026-10-04 on a readonly multi-select search input (Ant Design TreeSelect without
// showSearch): fill typed, saw nothing land and blamed a background tab - the tab was in front,
// and switch_tab changed nothing. With no selector it checks the focused element.
function fieldBlockedExpression(selector) {
  const el = selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document.activeElement';
  return `(function() {
    const el = ${el};
    if (!el || !('value' in el)) return null;
    if (el.disabled || (el.matches && el.matches(':disabled'))) return 'disabled';
    if (el.readOnly) return 'readonly';
    return null;
  })()`;
}

async function fieldBlocked(tabId, selector) {
  const r = await debuggerEval(tabId, fieldBlockedExpression(selector)).catch(() => null);
  return r === 'readonly' || r === 'disabled' ? r : null;
}

function fieldBlockedAnswer(blocked, method) {
  return { ok: false, method, error: 'field-is-' + blocked,
    note: `The field is ${blocked === 'readonly' ? 'read-only' : 'disabled'}, so it does not take typed text, ` +
          'and the text did not land. If it opens a list (select, combobox, multi-select), click it with ' +
          'browser_click and pick the option, or use browser_select_option / browser_set_combobox.' };
}

// Teksten i en contenteditable, som den staar paa skaermen: én linje pr. blok, <br> er et linjeskift, og en <br> sidst i sin
// blok er Chromes pladsholder for en tom linje. Mellemrum foelger feltets white-space, som i innerText. Selvstaendig, saa
// den kan sendes som tekst til siden (#70).
function redigerbarTekst(rod) {
  if (!rod) return null;
  const stil = (n) => getComputedStyle(n);
  const blok = (n) => n !== rod && n.nodeType === 1 && !/^(inline|contents|none)/.test(stil(n).display);
  // Kommer der noget efter <br>'en i dens egen blok? Ellers er den kun pladsholder.
  const pladsholder = (br) => {
    for (let n = br; n && n !== rod; n = n.parentNode) {
      for (let s = n.nextSibling; s; s = s.nextSibling) {
        if (s.nodeType === 1 && stil(s).display !== 'none') return false;
        if (s.nodeType === 3 && s.data !== '') return false;
      }
      if (blok(n.parentNode) || n.parentNode === rod) return true;
    }
    return true;
  };
  // R93 (Astra, maalt i model): et mellemrum mellem to <span> blev smidt vaek («helloworld»), og to mellemrum paa hver
  // side af en elementgraense blev ikke foldet sammen. Et sammenfoldeligt mellemrum (white-space normal, nowrap,
  // pre-line) er sit eget tegn i linjen, FOLD, og foldes som i CSS: en raekke bliver ét mellemrum, og intet i linjens
  // start eller slutning. pre-line beholder sine linjeskift; pre og pre-wrap beholder alt.
  // R94 (Astra, maalt i model): FOLD var tegnet U+0001, saa et U+0001 i sidens egen tekst blev til et mellemrum. Nu er
  // FOLD et objekt i en liste af tekststykker, saa intet i teksten kan forveksles med det.
  const FOLD = {};
  const linjer = [[]];
  const sidste = () => linjer[linjer.length - 1];
  let lukket = false;   // en blok er sluttet; det naeste indhold staar paa en ny linje
  const nyLinjeEfterBlok = () => { if (lukket) { linjer.push([]); lukket = false; } };
  const tom = (l) => l.every((x) => x === FOLD || x === '');
  const gaa = (n) => {
    for (const b of n.childNodes) {
      if (b.nodeType === 3) {
        const ws = stil(b.parentNode).whiteSpace;
        const folder = ws === 'normal' || ws === 'nowrap' || ws === 'pre-line';
        const t = b.data;
        if (!t) continue;
        let stykker;   // linjer af tekststykker
        if (folder) {
          const raa = ws === 'pre-line' ? t.replace(/[ \t]*\r?\n[ \t]*/g, '\n').split('\n') : [t];
          stykker = raa.map((l) => l.split(ws === 'pre-line' ? /([ \t]+)/ : /([\t\n\r ]+)/)
            .map((x) => (/^[\t\n\r ]+$/.test(x) ? FOLD : x)).filter((x) => x !== ''));
          if (lukket && stykker.every(tom)) continue;   // mellemrum efter en blok, foer noget andet
        } else {
          // R95 (Opus, maalt i Chrome): et tomt stykke ('' efter et afsluttende linjeskift) spaerrede for, at et sammenfoldeligt
          // mellemrum i starten af naeste linje blev fjernet («a\n b» mod innerText «a\nb»). R96 (Opus, maalt i Chrome og i
          // 4000 tilfaeldige traeer mod innerText): det FOERSTE stykke skal blive, ogsaa tomt - det holder et mellemrum lige foer
          // et bevaret linjeskift paa sin linje («x <pre>\ny» er «x \ny», ikke «x\ny»).
          stykker = t.split('\n').map((l, k) => (l || k === 0 ? [l] : []));
        }
        nyLinjeEfterBlok();
        // R95 (Astra, maalt i model): push(...stykker) gav «Maximum call stack size exceeded» ved 200.000 tegn.
        for (const x of stykker[0]) sidste().push(x);
        for (const l of stykker.slice(1)) linjer.push([...l]);
      } else if (b.nodeType === 1) {
        if (stil(b).display === 'none') continue;
        if (b.tagName === 'BR') {
          if (pladsholder(b)) continue;
          nyLinjeEfterBlok();
          linjer.push([]);
        } else if (blok(b)) {
          if (lukket) nyLinjeEfterBlok();
          else if (!tom(sidste())) linjer.push([]);
          else linjer[linjer.length - 1] = [];
          gaa(b);
          lukket = true;
        } else {
          gaa(b);
        }
      }
    }
  };
  gaa(rod);
  return linjer.map((l) => {
    const u = l.filter((x, k) => x !== FOLD || l[k - 1] !== FOLD);   // en raekke FOLD bliver én
    while (u[0] === FOLD) u.shift();
    while (u[u.length - 1] === FOLD) u.pop();
    return u.map((x) => (x === FOLD ? ' ' : x)).join('');
  }).join('\n');
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
    // Samme form som den anden returvej, ellers faar kalderen to forskellige slags svar.
    // rammeHoerte er null her med vilje: en contenteditable (LinkedIn, Slack) har ingen
    // _valueTracker, saa teksten i elementet ER hele sandheden.
    // #70 (arasmileska; MAALT 13/10 i headless Chrome): textContent mister linjeskiftene, saa «line1\nline2» blev laest
    // som «line1line2» og meldt differs, netop naar teksten var landet. innerText er heller ikke svaret: Chrome skriver
    // «a\n\nb» som a<div><br></div><div>b</div>, og innerText giver «a\n\n\nb». Teksten laeses derfor som linjer: en blok
    // (div, p, li ...) begynder en ny linje, en <br> er et linjeskift, og en <br> sidst i sin blok er kun pladsholder.
    const ceTekst = await debuggerEval(tabId, `(${redigerbarTekst.toString()})(document.querySelector(${JSON.stringify(selector)}))`)
      .catch(() => null);
    return { value: ceTekst, rammeHoerte: null };
  }

  // R50 (Opus, MAALT i Chrome): Ant Design 5 saetter readOnly paa sine soegefelter, indtil de faar fokus, og
  // anti-autofill-felter goer det samme - i en baggrundsfane forbliver de readonly efter el.focus(). En
  // kontrol FOER fokus afviste dem med «read-only». Kun disabled afvises nu foerst; readonly navngives
  // foerst, naar teksten ikke landede.
  if (await fieldBlocked(tabId, selector) === 'disabled') return { value: null, blocked: 'disabled' };

  // Standard input/textarea — focus, clear, fill
  await debuggerFocus(tabId, selector);
  await debuggerAttach(tabId);
  try {
    await clearFieldIfFilledAttached(tabId);

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
          // R50: et readonly- eller disabled-felt ryddes ikke med setteren - 875b160 slettede saadan en vaerdi.
          if (!el || !('value' in el) || el.readOnly || el.disabled || (el.matches && el.matches(':disabled'))) return false;
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
    // R127 (Astra): ogsaa her gaelder linjeskiftreglen (linjeFelt) - et "\n" indsat i et enkeltlinje-input sender formularen.
    let indsaet = String(value);
    const linjeskift = { somTekst: 0, somMellemrum: 0, udeladt: 0 };
    if (/[\r\n]/.test(indsaet)) {
      indsaet = indsaet.replace(/\r\n?/g, '\n');
      const antal = (indsaet.match(/\n/g) || []).length;
      // R130: i et felt uden linjeskift bliver hvert til ét mellemrum (ikke udeladt: ordene limes ellers sammen).
      // R138: mellemrum kun i et tekst-input; ellers udelades de (samme regel som tegn for tegn).
      const felt = await linjeFelt(tabId);
      if (felt === 'tekst') linjeskift.somTekst = antal;
      else if (felt === 'linje') { indsaet = indsaet.replace(/\n/g, ' '); linjeskift.somMellemrum = antal; }
      else { indsaet = indsaet.replace(/\n/g, ''); linjeskift.udeladt = antal; }
    }
    if (indsaet) await cdpSend(tabId, 'Input.insertText', { text: indsaet });

    // Verify something actually landed. Masked inputs, maxlength enforcement and
    // autocompletes that filter per keydown can swallow an inserted string, and
    // until now that failed silently: the caller got "ok" and the field stayed
    // empty. Only an EMPTY field triggers the fallback — a field that transformed
    // the text (phone/date masks reformatting it) did accept the input, and
    // retyping it per character would produce the same transform for no gain.
    // FUNDET 19/9 (issue #19): vi laeste DOM'ens vaerdi og svarede ja. Det er vores egen
    // fejlklasse ét niveau op - feltet VISER den rigtige tekst, mens React's state aldrig
    // hoerte det, og appen opfoerer sig som om feltet er tomt. Kvitteringen kom fra DOM'en,
    // ikke fra rammen.
    //
    // Der findes et mekanisk svar. React haenger en `_valueTracker` paa elementet og
    // opdaterer den NAAR den selv har behandlet aendringen. Stemmer trackeren med feltets
    // vaerdi, har rammen hoert det. Stemmer den ikke, har den beviseligt ikke. Ingen tracker
    // = ikke et rammestyret felt, og saa er DOM-vaerdien hele sandheden.
    // Det er en egenskab, ikke et navn: et omdoebt bibliotek kan ikke skjule at trackeren
    // og vaerdien er ude af trit.
    let laesning = await evalAttached(tabId, `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const v = ('value' in el) ? el.value : el.textContent;
        let ramme = null;
        try {
          const t = el._valueTracker;
          if (t && typeof t.getValue === 'function') ramme = (String(t.getValue()) === String(v));
        } catch (e) { ramme = null; }
        return { v: v, ramme: ramme };
      })()
    `);
    let landed = laesning && typeof laesning === 'object' ? laesning.v : laesning;
    let rammeHoerte = laesning && typeof laesning === 'object' ? laesning.ramme : null;
    let tasterLanded;   // R125: kun sat, naar der blev skrevet tegn for tegn (se skrivTegnMedBevis)
    if (landed !== String(value)) {
      const nu = await evalAttached(tabId, fieldBlockedExpression(null)).catch(() => null);
      if (nu === 'readonly' || nu === 'disabled') return { value: null, blocked: nu };
    }
    if (!landed) {
      await clearFieldIfFilledAttached(tabId);
      const skrevet = await skrivTegnMedBevis(tabId, value);
      tasterLanded = skrevet.landed;
      // MAALT i Chrome (R130): hurtigvejens tal blev lagt til ("4 mellemrum" for 2 linjeskift); feltet holder nu kun
      // reservens skrivning, saa det er dens tal der gaelder.
      linjeskift.somTekst = skrevet.linjeskift.somTekst;
      linjeskift.somMellemrum = skrevet.linjeskift.somMellemrum;
      linjeskift.udeladt = skrevet.linjeskift.udeladt;
      // FUNDET 13/9 af Astra: her stoppede vi. `typeCharsAttached` sender
      // Input.dispatchKeyEvent-par - praecis den kommando der blev maalt i at lyve samme dag.
      // Leveres tasterne heller ikke, kastes intet, og kalderen fik ok:true paa et tomt felt.
      laesning = await evalAttached(tabId, `
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          const v = ('value' in el) ? el.value : el.textContent;
          let ramme = null;
          try {
            const t = el._valueTracker;
            if (t && typeof t.getValue === 'function') ramme = (String(t.getValue()) === String(v));
          } catch (e) { ramme = null; }
          return { v: v, ramme: ramme };
        })()
      `).catch(() => null);
      landed = laesning && typeof laesning === 'object' ? laesning.v : laesning;
      rammeHoerte = laesning && typeof laesning === 'object' ? laesning.ramme : null;
    }
    return { value: landed, rammeHoerte: rammeHoerte, tasterLanded, linjeskift };
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
/**
 * Hvad staar der FAKTISK paa filfeltet bagefter?
 *
 * MAALT 13/9: `DOM.setFileInputFiles` kvitterer praecis som `Input.dispatchKeyEvent` gjorde -
 * uden at love at filen kom paa. En sti der ikke findes, et `accept`-filter der afviser
 * filtypen, eller sidens egen change-lytter der rydder feltet, giver alle en tom FileList,
 * og baade upload_file og drop_file svarede ok:true paa den.
 *
 * Svarer null naar feltet ikke kan laeses. Det er UVIST, ikke nej.
 */
async function laesVedhaeftedeFiler(tabId, selector) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el || !el.files) return null;
        return { antal: el.files.length, navne: [...el.files].map((f) => f.name) };
      },
      args: [selector],
    });
    return r?.result ?? null;
  } catch { return null; }
}

// 1.30.2 skive 6 (maalt i Chromium-kilden 8/10): DOM.setFileInputFiles svarer «Not allowed», naar udvidelsen
// ikke har «Allow access to file URLs» (content/browser/devtools/protocol/dom_handler.cc; for chrome.debugger er
// MayReadLocalFiles() = util::AllowFileAccess). Butiksinstallationer har kontakten slaaet fra som standard. Fejlen
// skal sige det, i stedet for at gentage Chromes to ord, saa agenten ikke proever igen og igen.
// R45 (Opus): kortet hedder «Agent360 Browser MCP» - browsermcp.io's udvidelse hedder «Browser MCP» og kan vaere installeret
// samtidig. Og kontakten lader udvidelsen aabne enhver lokal fil som side, saa noten siger prisen, hvis brugeren skal hoere om den.
async function filAdgangsSvar(besked) {
  if (!/Not allowed/i.test(String(besked || ''))) return null;
  let tilladt = null;
  try { tilladt = await chrome.extension.isAllowedFileSchemeAccess(); } catch {}
  if (tilladt === true) return null;
  return {
    error: 'file-access-off',
    detail: String(besked),
    file_access: tilladt,
    note: (tilladt === false ? 'Chrome refused to hand the file to the page because ' : 'Chrome refused to hand the file to the page; this usually means ') +
          `"Allow access to file URLs" is off for the Agent360 Browser MCP extension (chrome://extensions/?id=${chrome.runtime?.id}). ` +
          'It is off by default for Chrome Web Store installs, and browser_upload_file and browser_drop_file both hand files over this way. ' +
          'Ask the user to attach the file. If you tell them about the setting, also tell them that it lets this extension, and so you, ' +
          'open and read any local file as a page, and that changing it reloads the extension; whether to turn it on is their call.',
  };
}

// #67 (37 af 37 uploads paa sider, der rydder feltet): siden laeste filen i sin change-lytter og ryddede feltet
// (input.value = ''), og saa var svaret file-not-attached - en agent, der troede paa det, vedhaeftede igen og sendte to
// gange. En lytter i fangstfasen, sat FOER filen afleveres, ser feltet i det oejeblik siden faar det: paa window for et
// felt i dokumentet (window kommer foer alle sidens egne lyttere), paa feltet selv for et felt uden for dokumentet.
// Svaret er { antal, navne } eller null (ingen change). Selvstaendig, saa den kan koere i siden.
function armerFilSkiftISiden(el, noegle) {
  if (!el) return false;
  const lager = window.__bmcpFilSkift || (window.__bmcpFilSkift = {});
  const fang = (e) => {
    if (e.target !== el || lager[noegle]) return;
    lager[noegle] = { antal: el.files ? el.files.length : 0, navne: el.files ? [...el.files].map((f) => f.name) : [] };
  };
  const vaerter = el.isConnected ? [window, el] : [el];
  for (const v of vaerter) v.addEventListener('change', fang, true);
  lager[noegle + ':off'] = () => { for (const v of vaerter) v.removeEventListener('change', fang, true); };
  return true;
}
function laesFilSkiftISiden(noegle) {
  const lager = window.__bmcpFilSkift || {};
  try { if (lager[noegle + ':off']) lager[noegle + ':off'](); } catch (e) {}
  const svar = lager[noegle] || null;
  delete lager[noegle]; delete lager[noegle + ':off'];
  return svar ? JSON.stringify(svar) : null;
}

/** Tre-vejs dom paa en vedhaeftning, delt af upload_file og drop_file. `skift` er hvad feltet bar, da siden fik change. */
function fildSvar(vedhaeftet, oenskede, ekstra, skift) {
  // R93 (Astra, maalt i model): «modtaget» var mere end der var set. En side, der AFVISER filen (forkert type) og rydder
  // feltet, ser ens ud. Svaret siger nu kun det maalte: filen sad i feltet, da siden fik change, og feltet er tomt nu -
  // og at siden selv viser, om den beholdt filen. Antallet sammenlignes stadig.
  if (vedhaeftet && vedhaeftet.antal === 0 && skift && skift.antal > 0) {
    const svar = { ok: true, ...ekstra, seen_in_field: skift.navne, cleared_by_page: true,
      note: 'The file was in the field when the page\'s change handler ran, and the page has since emptied the field. ' +
            'X and Facebook do that after reading the file; a page that rejects a file can do the same. Check the page - ' +
            'an attachment preview, or an error - before attaching the file again.' };
    if (skift.antal !== oenskede.length) {
      svar.differs = true;
      svar.note += ` The field held ${skift.antal} of ${oenskede.length} files at that moment.`;
    }
    return svar;
  }
  if (!vedhaeftet) {
    return { ok: true, ...ekstra, unknown: true,
      note: 'The file was sent to the field, but the field could not be read afterwards, so it is unknown ' +
            'whether it is attached. Check the page before sending again.' };
  }
  if (vedhaeftet.antal === 0) {
    // R93 (Astra): et tomt felt uden et set change er ikke et bevis paa, at siden aldrig fik filen - en lytter, siden
    // satte foer vores, kan have laest og ryddet feltet foerst. Noten siger det, i stedet for «The file is NOT uploaded».
    return { ok: false, ...ekstra, error: 'file-not-attached',
      note: 'Chrome acknowledged the file, but the field is empty, and the tool did not see the file in it. The path may not ' +
            'exist, or the field\'s `accept` rejects the file type. A page can also read the file and clear the field ' +
            'before the tool looks, so check the page before attaching again.' };
  }
  const svar = { ok: true, ...ekstra, attached: vedhaeftet.navne };
  if (vedhaeftet.antal !== oenskede.length) {
    svar.differs = true;
    svar.note = `The field took ${vedhaeftet.antal} of ${oenskede.length} files. An \`accept\` filter or ` +
                'a field without `multiple` discards the rest.';
  }
  return svar;
}

// ── Maalets identitet helt ind i haendelsen (R64, R65) ─────────────────────
// R64 (Astra, maalt i model): et overlay der kom frem MELLEM opslaget og afsendelsen, fik haendelserne, og svaret var
// ok:true - click genfandt sit maal ud fra koordinaten, og double_click, right_click og hover talte haendelser i hele fanen.
// Nu foelger maalet med ind i siden, beslaegtet med Playwrights hit-target-tjek: en lytter i fangstfasen paa window doemmer
// HVER haendelse i vores punkt (eller med maalet i stien) paa den knude, der fik den, efter samme regel som foer afsendelsen
// (maalet, dets egen ramme eller label). Er knuden en anden, stoppes den og resten (preventDefault +
// stopImmediatePropagation), og svaret bliver covered.
// R65 (Astra, maalt i model): R64 afgjorde kun ved den FOERSTE haendelse og talte resten - et overlay efter pointerdown
// fik dblclick og contextmenu med ok:true, og et link, der dukkede op i en label, fik klikket. Og en haendelse talte som
// bevis, saa snart den passerede window, selv om en lytter senere i stien stoppede den. Nu doemmes hver haendelse, og kun
// en haendelse, der NAAR knuden (en lytter paa selve knuden, sat paa under afsendelsen), taeller som bevis. Vagten fjernes
// paa hver udgang og udloeber selv i siden, saa en fejl undervejs aldrig efterlader den over brugerens egne klik.
// Haendelser andre steder (en rigtig mus) hverken doemmes eller taeller.
// R66 (Astra, maalt i model): (1) lytteren paa knuden talte en SENERE, syntetisk haendelse af samme type, som siden sendte,
// efter at vores var stoppet undervejs - beviset binder nu til selve haendelsesobjektet; (2) et klik paa en felts label
// talte som feltets, ogsaa naar labelen annullerede aktiveringen - bevis er nu kun en haendelse paa maalet, inde i det,
// eller paa en forfader, der ikke er en label (feltets eget aktiveringsklik er beviset); (3) «vores» er kun haendelser i
// punktet (et klik ogsaa med maalet i stien - labelens aktiveringsklik), og efter en blokering stoppes kun haendelser i
// punktet, ikke en rigtig mus andre steder paa maalet. En rigtig mus i samme punkt samtidig kan ikke skelnes fra vores.
// R67 (Astra, maalt i model): «et klik med maalet i stien» tog ogsaa et brugerklik et andet sted paa maalet som bevis. Et
// klik uden for punktet taeller nu kun, naar det er labelens simulerede aktiveringsklik (uden koordinater).
// R68 (Astra, maalt i model): og kun naar maalet har en label, og vores klik i punktet gik til den - et uvedkommende klik
// ved (0,0) beviste ellers vaerktoejets klik.
// R69 (Astra, maalt i model): et labelklik, siden annullerede, efterfulgt af et uvedkommende klik ved (0,0) under
// efterkontrollen, gav landed:true. Labelens aktivering sker i samme opgave som labelklikket (HTML-standarden), saa
// markeringen er selve haendelsen, og den gaelder kun til naeste opgave, kun hvis den ikke blev annulleret, og kun een gang.
// R67 (Opus, maalt i Chrome): en deaktiveret raekke i en liste med EN onclick fik sit «bevis» paa listen - klikket naaede aldrig
// raekken. En forfader er nu kun bevis, naar den er maalets semantiske ramme (knap, link, rolle), ikke en lyttende beholder.
const VAGT_KLIK = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'dblclick', 'contextmenu'];
const VAGT_HOVER = ['pointerover', 'pointerenter', 'pointermove', 'mouseover', 'mouseenter', 'mousemove'];

async function armerMaalVagt(tabId, x, y, typer, levetid = 10000, inderOk = false) {
  let r;
  try {
    r = await cdpSend(tabId, 'Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const tjek = window.__bmcpMaalTjek, maal = window.__bmcpMaal, typer = ${JSON.stringify(typer)}, inderOk = ${!!inderOk};
      try { delete window.__bmcpMaalTjek; } catch (e) {}
      const gl = window.__bmcpVagt;
      if (gl && gl.ryd) gl.ryd();
      window.__bmcpVagt = null;
      if (typeof tjek !== 'function' || !maal) return { ingen: true };
      if (!maal.isConnected) return { vaek: true };
      const nu = tjek(${x}, ${y});
      if (nu && !(inderOk && nu.inside)) return { daekket: nu };
      const inde = (n, m) => { for (let i = 0; n && i < 1000; i++) { if (n === m) return true; n = n.assignedSlot || n.parentNode || n.host; } return false; };
      // R75 (Opus, maalt i Chrome): en label med et felt som maal gav landed:true, naar labelens klik kom frem - ogsaa naar en
      // lytter (Reacts onClick, addEventListener) annullerede det, og feltet aldrig blev aktiveret. For et saadant maal er beviset
      // derfor feltets eget aktiveringsklik (eller et klik direkte paa feltet); uden det er svaret uvist, ikke ja.
      const felt = maal.tagName === 'LABEL' && maal.control ? maal.control : null;
      const v = { typer, maal, blokeret: null, delvis: false, sendt: 0, naaet: {}, vaek: false, paa: [], labelKlik: false,
        felt, kunAktivering: !!felt && typer.includes('click'), feltKlik: null,
        synligVedArm: document.visibilityState === 'visible' };
      // R79 (Opus, maalt i Chrome): feltets egen rolle-boks om feltet talte som bevis, naar maalet var feltet, selv om feltet intet
      // fik (CB:false, landed:true). For et felt som maal er kun et klik, der naar feltet selv, et bevis.
      // R80 (Astra, maalt i model): reglen gjaldt kun input/select/textarea, saa et form-associeret custom-felt og en button (begge
      // kan have en label) i en rolle-boks, der selv tog klikket, gav landed:true uden at feltet fik noget.
      // R81 (Astra, maalt i model): custom-feltet blev kendt paa klassens formAssociated - en egenskab, siden kan aendre eller faa til
      // at kaste, mens den native status (gemt ved define) er uaendret; saa gav en boks' klik igen landed:true. Enhver selvstaendig
      // custom element (navn med bindestreg - det har alle form-associerede felter) er derfor omfattet: kun en haendelse, der naar
      // den selv, er bevis. Prisen: et custom-ikon, hvis klik kun naar knappen om det, svarer maybe_landed, ikke ja.
      v.maalFelt = !!maal.matches && (maal.matches('input,select,textarea,button') || String(maal.tagName || '').includes('-'));
      // R79 (Opus, maalt i Chrome): med en tekst i en label som maal blev labelens aktiveringsklik til dens felt stoppet som «noget,
      // der kom foran» - musen afkrydser dér. Labelen om maalet, hvis felt ligger uden for maalet, huskes.
      for (let n = maal, i = 0; n && i < 1000; n = n.assignedSlot || n.parentNode || n.host, i++) {
        if (n.tagName === 'LABEL') { if (n !== maal && n.control && !inde(n.control, maal)) v.tekstLabel = n; break; }
      }
      v.fn = (ev) => {
        if (!ev.isTrusted) return;
        const vej = ev.composedPath ? ev.composedPath() : [];
        const vedPunkt = Math.abs(ev.clientX - ${x}) <= 1 && Math.abs(ev.clientY - ${y}) <= 1;
        const aktivering = ev.type === 'click' && vej.includes(maal) && ev.clientX === 0 && ev.clientY === 0 && !!v.labelKlik && !v.labelKlik.defaultPrevented;
        if (aktivering) v.labelKlik = null;
        // Chrome sender aktiveringsklikket med eller uden museens koordinater (maalt R68); begge taeller.
        // (Et annulleret labelklik giver ingen aktivering - HTML - saa der skal ikke tjekkes for det her.)
        const feltAktivering = v.kunAktivering && ev.type === 'click' && ev !== v.feltKlik && vej.includes(v.felt) && !!v.feltKlik;
        if (feltAktivering) v.feltKlik = null;
        if (ev.type === 'click' && v.tekstLabel && v.tekstLabelKlik && ev !== v.tekstLabelKlik && !v.tekstLabelKlik.defaultPrevented &&
          vej.includes(v.tekstLabel.control)) { v.tekstLabelKlik = null; return; }
        const vores = vedPunkt || aktivering || feltAktivering;
        if (!vores) return;
        if (v.blokeret) { if (vedPunkt) { ev.preventDefault(); ev.stopImmediatePropagation(); } return; }
        if (!maal.isConnected) { v.vaek = true; return; }
        // R76 (Astra, maalt i model): aktiveringen blev talt ved window - en lytter, der stoppede den, foer den naaede feltet,
        // gav landed:true med boksen tom. Den taelles nu paa knuden selv, naar netop denne haendelse naar den.
        if (feltAktivering) {
          const k = vej[0] || ev.target;
          const naaetFelt = (e2) => { if (e2 === ev) v.naaet.click = (v.naaet.click || 0) + 1; };
          try { k.addEventListener('click', naaetFelt, { once: true, capture: true }); v.paa.push([k, 'click', naaetFelt]); } catch (e) {}
          return;
        }
        const knude = vej[0] || ev.target;
        if ((ev.type === 'pointerenter' || ev.type === 'mouseenter') && knude !== maal && inde(maal, knude)) return;
        let d = tjek(${x}, ${y}, knude);
        if (d && inderOk && d.inside) d = null;
        if (d && v.sendt > 0 && (ev.type === 'pointerup' || ev.type === 'mouseup')) { v.urent = true; return; }
        if (d) { v.blokeret = d; v.delvis = v.sendt > 0; ev.preventDefault(); ev.stopImmediatePropagation(); return; }
        v.sendt++;
        if (v.kunAktivering && ev.type === 'click' && !inde(knude, v.felt)) {
          v.feltKlik = ev;
          setTimeout(() => { if (v.feltKlik === ev) v.feltKlik = null; }, 0);
          return;
        }
        if (ev.type === 'click' && v.tekstLabel && inde(knude, v.tekstLabel)) {
          v.tekstLabelKlik = ev;
          setTimeout(() => { if (v.tekstLabelKlik === ev) v.tekstLabelKlik = null; }, 0);
        }
        if (ev.type === 'click' && !inde(knude, maal) && maal.labels && Array.from(maal.labels).some((l) => inde(knude, l))) {
          v.labelKlik = ev;
          setTimeout(() => { if (v.labelKlik === ev) v.labelKlik = null; }, 0);
        }
        if (!(inde(knude, maal) || (!v.maalFelt && inde(maal, knude) && knude.tagName !== 'LABEL' && !!knude.matches &&
          knude.matches('button,a,summary,[role="button"],[role="link"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"],[role="tab"],[role="checkbox"],[role="radio"],[role="switch"]')))) {
          if (knude !== maal && inde(maal, knude)) v.forfader = true;
          return;
        }
        const type = ev.type;
        const naaet = (e2) => { if (e2 === ev) v.naaet[type] = (v.naaet[type] || 0) + 1; };
        try { knude.addEventListener(type, naaet, { once: true, capture: true }); v.paa.push([knude, type, naaet]); } catch (e) {}
      };
      v.ryd = () => {
        for (const t of typer) window.removeEventListener(t, v.fn, true);
        for (const [k, t, f] of v.paa) { try { k.removeEventListener(t, f, true); } catch (e) {} }
        v.paa = [];
        clearTimeout(v.udloeb);
      };
      for (const t of typer) window.addEventListener(t, v.fn, true);
      v.udloeb = setTimeout(() => v.ryd(), ${Number(levetid) || 10000});
      window.__bmcpVagt = v;
      return { armet: true };
    })()` });
  } catch { return null; }
  return r?.result?.value ?? null;
}

async function laesMaalVagt(tabId, x, y) {
  let r;
  try {
    r = await cdpSend(tabId, 'Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const v = window.__bmcpVagt, maal = window.__bmcpMaal;
      window.__bmcpVagt = null;
      try { delete window.__bmcpMaal; } catch (e) {}
      if (!v || !v.ryd) return { udskiftet: true };
      v.ryd();
      let fremmedRamme = null;
      if (${typeof x === 'number' && typeof y === 'number'}) {
        let p = document.elementFromPoint(${Number(x) || 0}, ${Number(y) || 0});
        for (let i = 0; i < 20 && p && p.shadowRoot; i++) { const n = p.shadowRoot.elementFromPoint(${Number(x) || 0}, ${Number(y) || 0}); if (!n || n === p) break; p = n; }
        let iMaalet = false;
        for (let n = p; n; n = n.parentNode || n.host) if (n === maal) { iMaalet = true; break; }
        if (p && /^(IFRAME|FRAME|OBJECT|EMBED)$/.test(p.tagName || '') && !iMaalet) fremmedRamme = { tag: p.tagName, id: p.id || null, text: '' };
      }
      const trykNaaet = ((v.naaet.pointerdown || 0) + (v.naaet.mousedown || 0)) > 0;
      return { naaet: v.naaet, blokeret: v.blokeret, delvis: v.delvis, sendt: v.sendt, vaek: v.vaek, fremmedRamme, urent: !!v.urent, trykNaaet,
        kunAktivering: !!v.kunAktivering,
        skjultHele: !v.synligVedArm && document.visibilityState !== 'visible' };
    })()` });
  } catch { return null; }
  return r?.result?.value ?? null;
}

/** Vagtens dom som et haendelsesbevis (samme form som laesHaendelsesBevis). */
function vagtBevis(laest, typer) {
  if (!laest) return { landed: null };
  if (laest.blokeret) return { landed: false, blokeret: laest.blokeret, delvis: !!laest.delvis };
  // R66 (Astra, maalt i model): en vagt, der er vaek ved aflaesningen, beviser ikke en navigation (den kan vaere fjernet af
  // siden eller udloebet) - det er uvist, ikke ja.
  if (laest.udskiftet) return { landed: null };
  // R75: for en label med et felt er kun feltets aktiveringsklik (eller et klik paa feltet selv) et ja.
  // Kun for klik-beviser (click, dblclick): et hoejreklik eller en hover paa en label aktiverer ikke feltet og beviser sig selv.
  if (laest.kunAktivering && (typer.includes('click') || typer.includes('dblclick'))) {
    if (!laest.urent && (laest.naaet?.click || 0) > 0) return { landed: true };
  }
  else if (!laest.urent && typer.some((t) => (laest.naaet?.[t] || 0) > 0)) return { landed: true };
  // R67 (Astra): en fremmed ramme i punktet, og haendelsen naaede ikke maalet: covered + uvist, ogsaa naar noget blev sendt.
  if (laest.fremmedRamme) return { landed: null, blokeret: laest.fremmedRamme, iFremmedRamme: true, trykNaaet: !!laest.trykNaaet };
  // R65 (Astra, maalt i model): intet naaede maalet. I en synlig side kan en lytter undervejs have stoppet haendelsen - og
  // selv have handlet - saa det er uvist, ikke et nej med raad om at proeve igen.
  // R66 (Astra, maalt i model): synligheden blev maalt ved AFLAESNINGEN, saa en fane, der blev skjult efter handlingen, gav
  // et nej. Nej kraever nu, at siden var skjult baade ved armeringen og ved aflaesningen, og at intet blev set.
  if (laest.skjultHele && !laest.sendt && !laest.vaek) return { landed: false };
  return { landed: null };
}

async function armerHaendelsesBevis(tabId, type) {
  // Samme rolle for musen som armerTastBevis har for tasterne, og af samme grund: Chrome
  // KVITTERER for en CDP-kommando uden at love at siden fik den. For tasterne loej det
  // (maalt 13/9). For hover, double_click og right_click reddes svaret i dag af 1500 ms-fristen,
  // altsaa af et uheld og ikke af en maaling - og et uheld er ikke en vagt. Et element der er
  // daekket af et overlay, eller en side der sluger haendelsen, giver samme falske ja som
  // press_key gav paa Enter.
  const id = 'h' + Math.random().toString(36).slice(2, 10);
  // FUNDET 13/9 af Astra: her stod `await ...; return id;`. Resultatet blev kasseret, saa
  // antallet af armerede rammer kunne aldrig sammenlignes med antallet der svarede. En
  // hovedramme der ikke kunne armeres, mens én iframe svarede "ingen haendelse", blev doemt
  // `landed:false` - og et falsk NEJ er dyrere end det falske ja vi lige fjernede: agenten
  // gentager handlingen, og en Enter der allerede sendte formularen sender den én gang til.
  const armet = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    injectImmediately: true,
    func: (nyId, haendelser) => {
      const p = (window.__bmcpHaendelse ||= {});
      if (p.fn) for (const t of [].concat(p.type || [])) window.removeEventListener(t, p.fn, true);
      p.id = nyId; p.type = haendelser; p.antal = 0;
      p.fn = () => { p.antal++; };
      for (const t of haendelser) window.addEventListener(t, p.fn, true);
    },
    args: [id, [].concat(type)],
  });
  return { id, rammer: armet.length };
}

async function laesHaendelsesBevis(tabId, bevis) {
  const { id, rammer } = bevis;
  let svar;
  try {
    svar = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      // Uden den her venter Chrome paa at hver ramme bliver idle. En annonce-ramme der
      // long-poller bliver det aldrig, og saa haenger dommen paa noget der intet har med
      // haendelsen at goere. Armeringen havde den allerede; laesningen ikke.
      injectImmediately: true,
      func: (minId) => {
        const p = window.__bmcpHaendelse;
        if (!p || p.id !== minId) return { udskiftet: true };
        if (p.fn) for (const t of [].concat(p.type || [])) window.removeEventListener(t, p.fn, true);
        const r = { antal: p.antal };
        p.fn = null; p.id = null;
        return r;
      },
      args: [id],
    });
  } catch { return { landed: null }; }
  // FUNDET 13/9 af Fable, bevist mod den aegte kode: `udskiftet` betyder kun "maerket er vaek".
  // En ramme der ALDRIG havde maerket svarer det samme - og der kommer rammer til hele tiden
  // (annoncer, GTM, reCAPTCHA, indlejret video; hover holder 500 ms, rigeligt). Hovedrammen
  // sagde `antal:0`, annonce-rammen sagde `udskiftet`, og fire vaerktoejer svarede landed:true.
  // Det var et falsk JA i selve beviset - den loegn 1.29.2 bliver udgivet for at fjerne.
  //
  // Kun HOVEDRAMMENS udskiftning er en navigation. En underrammes er stoej, og den taeller
  // derfor hverken for eller imod: den er bare en ramme der ikke kunne maales.
  const r = svar.filter((x) => x && x.result).map((x) => ({ frameId: x.frameId, ...x.result }));
  if (r.some((x) => x.antal > 0)) return { landed: true };
  if (r.some((x) => x.udskiftet && x.frameId === 0)) return { landed: true, navigeret: true };
  // Kun rammer der faktisk MAALTE taeller. Faerre maalinger end armeringer betyder at en
  // armeret ramme ikke kunne laeses - og det kan ikke skelnes fra "ingen fik den". UVIST.
  const maalte = r.filter((x) => typeof x.antal === 'number');
  if (!rammer || maalte.length < rammer) return { landed: null };
  return { landed: false };
}

/** Samme tre-vejs dom som click og press_key. Ét sted, saa de ikke driver fra hinanden. */
function haendelsesSvar(bevis, grund, ekstra) {
  if (bevis.landed === true) {
    return { ok: true, landed: true, ...ekstra,
      ...(bevis.navigeret ? { note: 'The page navigated on the action.' } : {}) };
  }
  if (bevis.landed === null) {
    return { ok: true, landed: null, maybe_landed: true, ...ekstra,
      note: 'The action was sent, but whether the page received it could not be read. Check the page before trying again.' };
  }
  return { ok: false, landed: false, ...ekstra, error: grund,
    note: 'Chrome acknowledged it, but no listener in the tab received the event. The tab is probably in the ' +
          'background, and Chrome does not deliver mouse or keyboard input to a tab that is not the visible one in its ' +
          'window. Call browser_switch_tab and try again.' };
}

async function armerTastBevis(tabId, forventet) {
  // MAALT 13/9, live og kalibreret mod et kendt-sandt tilfaelde: i en baggrundsfane KVITTERER
  // Chrome for Input.dispatchKeyEvent og leverer ikke tasten. Ingen fejl, ingen frist. Musen
  // haenger og bliver derfor opdaget af 1500 ms-fristen; tasten goer ikke, og press_key svarede
  // ok:true paa en tast der aldrig kom frem. Det er den fejlklasse 1.29.1 blev udgivet for at
  // fjerne, og den var tilbage i vaerktoejet selv.
  //
  // Musen maaler sidens REAKTION (aftryk foer/efter). En tast maa lovligt ikke aendre noget -
  // Tab og Escape goer typisk intet synligt - saa reaktion duer ikke. Vi maaler LEVERING.
  // Lytteren plantes i udvidelsens EGEN verden (ISOLATED): siden kan hverken se eller fjerne
  // den, og sidens CSP rammer den ikke. Capture paa window er foerste led i kaeden, saa et
  // stopPropagation i siden kan ikke skjule at tasten blev leveret.
  const id = 'k' + Math.random().toString(36).slice(2, 10);
  // FUNDET 13/9 af Astra: her stod `p.sidst = e.key`, og dommen var `p.sidst === forventet`.
  // Lytteren sidder paa window i capture for hele fanen, saa skriver brugeren selv mens
  // agenten trykker, overskrives `sidst` og en tast der LANDEDE meldes som ikke-leveret.
  // Nu saettes et flag naar den ventede tast ses, og det kan ikke overskrives igen.
  const armet = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },   // fokus kan staa i en iframe
    injectImmediately: true,
    func: (nyId, vent) => {
      const p = (window.__bmcpTast ||= {});
      if (p.fn) window.removeEventListener('keydown', p.fn, true);
      p.id = nyId; p.antal = 0; p.traf = false;
      // R126 (Astra): kun browserens egne haendelser taeller - et keydown, siden selv udsender (isTrusted: false), er intet bevis.
      p.fn = (e) => { if (!e.isTrusted) return; p.antal++; if (e.key === vent) p.traf = true; };
      window.addEventListener('keydown', p.fn, true);
    },
    args: [id, forventet],
  });
  return { id, rammer: armet.length };
}

// `enhverTast` (fill, R126): leveret = NOGEN ægte tast set, ikke kun den forventede, og en udskiftet hovedramme er uvist -
// en navigation beviser ikke, at tasterne kom frem. press_key beholder sin dom (den ventede tast; en navigation paa tasten
// er dens virkning).
async function laesTastBevis(tabId, bevis, { enhverTast = false } = {}) {
  const { id, rammer } = bevis;
  let svar;
  try {
    svar = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      injectImmediately: true,
      func: (minId) => {
        const p = window.__bmcpTast;
        if (!p || p.id !== minId) return { udskiftet: true };  // navigation tog lytteren med
        if (p.fn) window.removeEventListener('keydown', p.fn, true);
        const r = { antal: p.antal, traf: !!p.traf };
        p.fn = null; p.id = null;
        return r;
      },
      args: [id],
    });
  } catch { return { landed: null }; }     // kunne ikke laeses: unknown, ikke nej
  const r = svar.filter((x) => x && x.result).map((x) => ({ frameId: x.frameId, ...x.result }));
  if (enhverTast) {
    if (r.some((x) => x.antal > 0)) return { landed: true };
    if (r.some((x) => x.udskiftet && x.frameId === 0)) return { landed: null, navigeret: true };
  }
  if (r.some((x) => x.antal > 0 && x.traf)) return { landed: true };
  // Samme regel som for musen: kun hovedrammens udskiftning er en navigation.
  if (r.some((x) => x.udskiftet && x.frameId === 0)) return { landed: true, navigeret: true };
  const maalte = r.filter((x) => typeof x.antal === 'number');
  if (!rammer || maalte.length < rammer) return { landed: null };
  return { landed: false };
}

async function scriptingClick(tabId, selector) {
  try {
    // R57 (Opus, maalt i Chrome): reserven havde sin egen soegning (foerste eksakte match i en fast liste) og klikkede
    // med el.click(), som ikke rammer-tester - saa den klikkede sidens knap gennem en modal dialogs overlay. Maalet findes
    // nu af klikMaal, samme funktion som debugger-vejen, og et daekket maal klikkes ikke.
    const p = parseSelector(selector);
    const [maal] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: klikMaal,
      args: p.type === 'css' ? [p.selector, null, null, true, false] : [null, p.text, p.tag, true, false],
    });
    const info = maal?.result;
    if (!info) return { ok: false, reason: 'not_found' };
    if (info.hidden) return { ok: false, reason: 'hidden', tag: info.tag };
    if (info.covered) return { ok: false, reason: 'covered', tag: info.tag, covered: info.covered, ...(info.text ? { text: info.text } : {}) };
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const el = window.__bmcpMaal;
        try { delete window.__bmcpMaal; } catch (e) {}
        if (!el || !el.isConnected) return { ok: false, reason: 'not_found' };
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
        // (ok:true, nul handlinger; 1.29.0: fejl). En side der reagerer paa pointerdown, bliver derfor aerligt unknown.
        const foer = aftryk();
        el.click();
        // Maales i samme oejeblik som klikket. Astra (efterproevning af c1496d4): en anden maaling 200 ms senere gjorde et
        // uafhaengigt ur til klikbevis og et klik der navigerede i ventetiden til en fejl. En sen React-opdatering giver
        // derfor landed:false og maaske_landet - aerligt, aldrig en falsk succes.
        return { ok: true, tag: el.tagName, landed: aftryk() !== foer, detached: el.isConnected === false };
      },
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

// ── Klikkets maal ──────────────────────────────────────────────────────────
// R57 (Opus, maalt i Chrome 9/10): `click text=Add` valgte den foerste «Add» i DOM-raekkefoelgen, ogsaa naar en modal
// dialog var aaben, og svarede ok:true, selv naar klikket ramte overlayet eller dialogens backdrop. Reserven (script-
// klikket) havde sin egen, simplere soegning og klikkede sidens knap gennem overlayet. Nu findes maalet EET sted, her:
//   - en aaben modal dialog (dialog:modal eller en synlig [aria-modal="true"]) soeges foerst, eksakt tekst foer delvis;
//   - ligger et andet element over maalets midtpunkt, meldes det i `covered`, og musevaerktoejerne klikker ikke.
// Funktionen er selvstaendig, saa den kan sendes som `func` til chrome.scripting OG som tekst til Runtime.evaluate.
// `gem` lægger elementet paa window.__bmcpMaal og dets daekningsregel paa window.__bmcpMaalTjek (til script-klikket og
// vagten i armerMaalVagt); `kunElement` returnerer selve elementet.
// 1.33 (privat rapport 2.1, MAALT i headless Chrome af to bedoemmere): browser_wait meldte found:true for tekst, ingen kan
// se. display:none gav finderens {found:false, hidden:true}, og wait tjekkede kun, at der kom et svar; visibility:hidden,
// opacity:0 og en tekst flyttet ud af siden (left:-9999px) faldt tilbage til et skjult match. CSS-vejen svarede ja til et
// element med display:none. Ét kriterium for begge veje: et match er synligt, naar det har en boks paa mindst 2 x 2 px, der
// ikke ligger helt foran sidens begyndelse, ikke er visibility:hidden/collapse, og hverken det eller en forfader har opacity 0
// eller er en lukket boks (hoejde eller bredde under 2 px med overflow skaaret af). Siden rulles ikke.
function ventMaal(sel, tekst, wantTag) {
  function collectAll(root, results) {
    for (const el of root.querySelectorAll('*')) {
      results.push(el);
      if (el.shadowRoot) collectAll(el.shadowRoot, results);
    }
    return results;
  }
  function alleDybt(root, s, ud) {
    for (const el of root.querySelectorAll(s)) ud.push(el);
    for (const n of root.querySelectorAll('*')) if (n.shadowRoot) alleDybt(n.shadowRoot, s, ud);
    return ud;
  }
  const forfader = (n) => n.parentElement || (n.parentNode && n.parentNode.host) || null;
  const synligt = (el) => {
    // display:none (ogsaa paa en forfader) og display:contents giver en boks paa 0 x 0 - stoerrelsen fanger dem.
    if (!el || !el.getBoundingClientRect) return false;
    // R173 (MAALT i headless Chrome 155): indhold i en lukket <details> og under content-visibility:hidden har en boks paa
    // 740 x 18 og ingen af stilene nedenfor - kun browserens egen checkVisibility ved, at det ikke tegnes.
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    // R174 (Opus, MAALT i Chrome 155): fast-reglen fra R173 gjorde indhold under folden i en FAST boks, der kan rulles (en lang
    // <dialog>.showModal(), en modal, en app-skal), «usynligt». Kun et aegte fast element taeller (offsetParent er null - et
    // fixed inde i en transform-forfader opfoerer sig som absolute), og kan der rulles mellem elementet og den faste boks, er
    // indholdet synligt, naar den faste boks selv er i vinduet.
    let fast = null, rul = false, rulVedFast = false, hopTil = null;
    // R177 (Astra, MAALT i modellen): tekst i en rullet INDRE rulleboks blev holdt op mod den ydre boks' begyndelse og meldt
    // skjult - men den indre boks kan rulles tilbage. For forfaedrene over en rulleboks taeller boksens plads paa de akser, den kan
    // rulles paa, ikke elementets.
    let m = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    // R176 (Opus, MAALT i Chrome 155): begyndelsen af en rulleboks er ikke altid oeverst til venstre. I rtl, row-reverse,
    // column-reverse og vertical-rl ligger den til hoejre eller nederst, og rulningen er negativ.
    const omvendt = (st, n) => {
      const wm = st.writingMode || 'horizontal-tb';
      const lodretSkrift = /^(vertical|sideways)/.test(wm);
      let x = lodretSkrift ? /-rl$/.test(wm) : st.direction === 'rtl';
      let y = false;
      if (/flex/.test(st.display || '') && !lodretSkrift) {
        if (st.flexDirection === 'row-reverse') x = !x;
        if (st.flexDirection === 'column-reverse') y = true;
      }
      if ((n.scrollLeft || 0) < 0) x = true;
      if ((n.scrollTop || 0) < 0) y = true;
      return { x, y };
    };
    for (let n = el, i = 0; n && i < 1000; n = forfader(n), i++) {
      const s = getComputedStyle(n);
      // R176 (Astra, MAALT i modellen): et fast element undslipper rulning og afskaering hos forfaedrene OVER sig - kun deres
      // opacity gaelder stadig. Et synligt fast barn uden for sin rulleforfaders boks blev ellers afvist. R176 (Opus, MAALT i
      // Chrome): det samme gaelder et absolut element og forfaedrene MELLEM det og dets indeholdende blok (offsetParent).
      const overFast = !!fast;
      if (hopTil && n === hopTil) hopTil = null;
      const sprunget = overFast || !!hopTil;
      const ruller = /(auto|scroll)/.test(s.overflowX + ' ' + s.overflowY);
      let naeste = null;
      if (!sprunget && n !== el && ruller) {
        rul = true;
        // R175 (Opus, MAALT i Chrome 155): «kan rulles» er ikke «kan naas». Indhold foer en rulleboks' begyndelse (en menu
        // skubbet ud med translateX(-100%), et link paa left:-9999px) kan aldrig rulles frem - begyndelsen pr. akse, se omvendt.
        const sb = n.getBoundingClientRect();
        const o = omvendt(s, n);
        const foerX = o.x ? m.left >= sb.right - (n.scrollLeft || 0) : m.right <= sb.left - (n.scrollLeft || 0);
        const foerY = o.y ? m.top >= sb.bottom - (n.scrollTop || 0) : m.bottom <= sb.top - (n.scrollTop || 0);
        if (foerX || foerY) return false;
        // R178 (Astra, MAALT i modellen): kun de akser, boksen kan rulles paa - ellers mistede en ydre, afskaerende boks tekstens
        // plads paa den akse, der ikke kan rulles frem, og gav en falsk «found».
        naeste = { ...m };
        if (/(auto|scroll)/.test(s.overflowX)) { naeste.left = sb.left; naeste.right = sb.right; }
        if (/(auto|scroll)/.test(s.overflowY)) { naeste.top = sb.top; naeste.bottom = sb.bottom; }
      }
      // R175 (Astra, MAALT i modellen): den YDRE faste ramme overskrev den indre - en fast skuffe uden for vinduet i en synlig,
      // rullebar fast ramme blev «synlig». Den inderste faste boks afgoer: den er placeret efter vinduet, ikke efter rammen.
      if (!fast && s.position === 'fixed' && n.offsetParent === null) { fast = n; rulVedFast = rul || (n !== el && ruller); }
      if (parseFloat(s.opacity) === 0) return false;
      if (!sprunget && n !== el && (s.overflowX !== 'visible' || s.overflowY !== 'visible')) {
        const b = n.getBoundingClientRect();
        if (b.width < 2 || b.height < 2) return false;
        // R173 (Astra, MAALT): tekst helt uden for en boks, der skaerer af (hidden/clip), talte som synlig. En boks, der kan
        // rulles (auto/scroll), skjuler ikke - som siden under folden.
        const skaerer = (v) => v === 'hidden' || v === 'clip';
        // Pr. akse (R174): overflow-x: hidden med overflow-y: auto skaerer kun vandret - lodret kan der rulles.
        if ((skaerer(s.overflowX) && (m.right <= b.left || m.left >= b.right))
          || (skaerer(s.overflowY) && (m.bottom <= b.top || m.top >= b.bottom))) return false;
      }
      if (naeste) m = naeste;
      // R177 (Astra, MAALT i Chrome 155 22/10): et fixed element under en transform-forfader opfoerer sig som absolute (det har en
      // offsetParent) - samme spring op til den indeholdende blok.
      if (!fast && !hopTil && (s.position === 'absolute' || s.position === 'fixed')) hopTil = n.offsetParent || null;
    }
    // R173 (Opus, MAALT i Chrome): et fast element (position:fixed, ogsaa via en forfader) ruller ikke med siden - det er kun
    // synligt i vinduet. En topbjaelke skubbet op med translateY(-100%) paa en rullet side og en skuffe skubbet ud til hoejre
    // med translateX(100%) talte som synlige.
    // Vinduets synlige flade er uden rullebjaelke (MAALT i Chrome 155: en skuffe skubbet ud med translateX(100%) stod paa x=1265
    // under en rullebjaelke paa 15 px, og innerWidth paa 1280 regnede den som i vinduet). R176 (Opus, MAALT): i quirks-tilstand
    // med vandret rullebjaelke giver document.scrollingElement fladen; documentElement giver hele dokumentet.
    const rod = document.scrollingElement || document.documentElement;
    // R175 (Opus, MAALT): i quirks-tilstand er documentElement.clientHeight hele dokumentets hoejde (4333 mod 713) - den mindste
    // af de to er vinduet.
    const bredde = Math.min(window.innerWidth, (rod && rod.clientWidth) || window.innerWidth);
    const hoejde = Math.min(window.innerHeight, (rod && rod.clientHeight) || window.innerHeight);
    const iVindue = (b) => b.right > 0 && b.bottom > 0 && b.left < bredde && b.top < hoejde;
    if (fast) return iVindue(r) || (rulVedFast && iVindue(fast.getBoundingClientRect()));
    // Sidens begyndelse. R176 (Opus, MAALT i Chrome): indhold rullet forbi i en rulleboks har negative sidekoordinater, men kan
    // naas ved at rulle boksen - for indhold i en rulleboks afgoer den yderste rulleboks' plads (m). Paa en rtl-side ligger
    // sidens vandrette begyndelse til hoejre; der gaelder kun den lodrette.
    const b = m;
    const sideRtl = getComputedStyle(document.documentElement || document.body || el).direction === 'rtl';
    return (sideRtl || b.right + window.scrollX > 0) && b.bottom + window.scrollY > 0;
  };
  // Tekst i script, style, template, noscript og title vises aldrig. MAALT i headless Chrome: et <script> med ordet gjorde
  // ellers ordet «paa siden», og <body> - hvis textContent ogsaa rummer scriptets tekst - blev regnet for synlig.
  const IKKE_VIST = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'TITLE']);
  const vistTekst = (el) => {
    let ud = '';
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      let skjult = false;
      for (let n = t.parentNode; n && n !== el.parentNode; n = n.parentNode) if (IKKE_VIST.has(n.nodeName)) { skjult = true; break; }
      if (!skjult) ud += t.data;
    }
    return ud;
  };
  // R173 (Astra, MAALT i side-modellen): det inderste match afgjorde sagen - en synlig knap med en skjult <span>Saved</span>
  // blev godkendt, «Sa<span skjult>ved</span>» ogsaa, og et synligt «Saved» med en skjult kopi inden i blev overset. Nu
  // afgoer den SYNLIGE tekst: tekstnoder, hvis eget element kan ses, i dokumentets raekkefoelge.
  const kendt = new Map();
  const vises = (el) => { if (!kendt.has(el)) kendt.set(el, synligt(el)); return kendt.get(el); };
  const synligTekst = (rod) => {
    let ud = '';
    // R175 (Astra, MAALT i modellen): en TreeWalker over tekst lagde en <select>s etiket EFTER al den oevrige tekst, saa
    // «Sa<select>…</select>ved» blev til «Saved». Traeet gaas nu igennem i tegnet raekkefoelge, og en lukket <select>
    // bidrager paa sin egen plads med det, den viser - adskilt fra naboerne.
    const tekstNode = (t, ejer) => {
      // R173 (Opus, MAALT i Chrome): tekst direkte i et display:contents-element (fx et #root) tegnes i en forfaders boks.
      for (let i = 0; i < 50 && ejer.parentElement && getComputedStyle(ejer).display === 'contents'; i++) {
        if (getComputedStyle(ejer).visibility !== 'visible') break;   // en skjult contents-forfader skjuler ogsaa teksten
        ejer = ejer.parentElement;
      }
      if (vises(ejer)) ud += t.data;
    };
    // Et element bidrager efter samme regler, hvad enten det er roden eller et barn. R176 (Astra, MAALT i modellen): en
    // <option label> som SOEGEROD (option:text(...)) fik sin tekst talt - kun et barn fik label-reglen.
    const element = (c) => {
      if (IKKE_VIST.has(c.nodeName)) return;
      if (c.nodeName === 'SELECT' && !c.multiple && !(c.size > 1)) {
        // En lukket <select> viser den valgte options etiket - en ikke-tom label, ellers optionens tekst (HTML-standarden).
        const o = c.options && c.options[c.selectedIndex];
        const vist = o ? ((o.getAttribute && o.getAttribute('label')) || o.textContent || '') : '';
        if (vist && vises(c)) ud += '\n' + vist + '\n';
        return;
      }
      if (c.nodeName === 'OPTION' && c.getAttribute && c.getAttribute('label')) {
        // R174 (Astra): i en aaben liste viser en option med label sin label, ikke sin tekst.
        if (vises(c)) ud += '\n' + c.getAttribute('label') + '\n';
        return;
      }
      gaa(c, c);
    };
    const gaa = (n, ejer) => {
      for (const c of n.childNodes || []) {
        if (c.nodeType === 3) { if (ejer) tekstNode(c, ejer); continue; }
        if (c.nodeType === 1) element(c);
      }
    };
    // Tekst direkte i en shadow root tegnes i vaertens boks.
    if (rod.nodeType === 1) element(rod);
    else gaa(rod, rod.host || null);
    return ud;
  };
  if (tekst != null) {
    const tag = wantTag ? String(wantTag).toUpperCase() : null;
    const alle = collectAll(document, []);
    const m = alle.filter((el) => (!tag || el.tagName === tag) && !IKKE_VIST.has(el.tagName)
      && (el.textContent || '').includes(tekst) && vistTekst(el).includes(tekst));
    // Uden tag: den synlige tekst i dokumentet og i hver shadow root (tekst over en skyggegraense laeses ikke som én).
    // Med tag: den synlige tekst i hvert element af den slags. R174 (Astra): her filtreredes foerst paa den raa textContent,
    // saa «Sa<span skjult>X</span>ved» blev fundet som text=Saved, men overset som button:text(Saved).
    const roedder = [document, ...alle.filter((el) => el.shadowRoot).map((el) => el.shadowRoot)];
    const synlig = tag
      ? alle.some((el) => el.tagName === tag && synligTekst(el).includes(tekst))
      : roedder.some((rod) => synligTekst(rod).includes(tekst));
    // Det, der kan ses, findes ogsaa paa siden (R174, Astra: tekst direkte i en shadow root gav synlig:true, paaSiden:false).
    return { synlig, paaSiden: m.length > 0 || synlig };
  }
  const matches = alleDybt(document, sel, []);
  return { synlig: matches.some(synligt), paaSiden: matches.length > 0 };
}

function klikMaal(sel, tekst, wantTag, gem, kunElement, ingenRul) {
  // Interactive controls we prefer to actually click. Fixes the class of bug where a
  // text match lands on a large CONTAINER (e.g. Angular Material <mat-nav-list>,
  // toolbar, list-item) whose center is NOT over the real <button> - so the trusted
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
  function queryDeep(root, s) {
    const el = root.querySelector(s);
    if (el) return el;
    for (const node of root.querySelectorAll('*')) {
      if (node.shadowRoot) { const f = queryDeep(node.shadowRoot, s); if (f) return f; }
    }
    return null;
  }
  // Ligger n i maal - ogsaa paa tvaers af shadow roots? R71 (Astra): i den flade kaede, saa en knaps eget slottede ikon er knappens.
  function inde(n, maal) {
    for (let i = 0; n && i < 1000; i++) { if (n === maal) return true; n = n.assignedSlot || n.parentNode || n.host; }
    return false;
  }
  // R61 (Astra og Opus, maalt): en modal i en aaben shadow root blev ikke fundet, selv om tekstsoegningen gaar gennem
  // shadow roots; en lukket skuffe med aria-modal, skubbet ud af billedet, blev valgt; og af to stablede dialoger blev
  // den foerste i DOM valgt, ikke den oeverste. Dialogen soeges nu i de samme elementer som teksten, den skal ligge i
  // vinduet, og af flere er det den, der ligger oeverst ved sit eget midtpunkt.
  function aabenDialog(all) {
    const iRuden = (r) => r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
    // Dialogens synlige rektangel. R62 (Opus): Tailwind/Headless UI saetter aria-modal paa en indpakning med hoejde 0, hvor
    // alle boern er fixed - saa er rektanglet foreningen af de synlige boern. R63 (Astra): det samme rektangel bruges ogsaa,
    // naar to dialoger sammenlignes; foer blev to tomme indpakninger uafgjort, og den sidste i DOM vandt.
    const visRekt = (d) => {
      const egen = d.getBoundingClientRect();
      if (egen.width > 0 && egen.height > 0) return egen;
      let l = Infinity, o = Infinity, h = -Infinity, u = -Infinity;
      for (const b of Array.from(d.querySelectorAll ? d.querySelectorAll('*') : []).slice(0, 200)) {
        const bs = getComputedStyle(b);
        if (bs.visibility === 'hidden' || bs.display === 'none') continue;
        const r = b.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) continue;
        l = Math.min(l, r.left); o = Math.min(o, r.top); h = Math.max(h, r.right); u = Math.max(u, r.bottom);
      }
      return h > l ? { left: l, top: o, right: h, bottom: u, width: h - l, height: u - o } : egen;
    };
    const iVinduet = (d) => {
      const cs = getComputedStyle(d);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      return iRuden(visRekt(d));
    };
    const kandidater = all.filter((d) => {
      let modal = false;
      try { modal = d.matches('dialog:modal'); } catch (e) {}
      return (modal || (d.getAttribute && d.getAttribute('aria-modal') === 'true')) && iVinduet(d);
    });
    if (kandidater.length < 2) return kandidater[0] || null;
    // R62 (Astra, maalt i model): to forskudte dialoger kan begge ligge oeverst ved deres EGET midtpunkt. Hvem der ligger
    // oeverst, afgoeres derfor dér hvor de overlapper: den valgte maa ikke ligge under nogen anden kandidat.
    // R64 (Astra, maalt i model): foreningsrektanglet om to adskilte paneler omsluttede ogsaa hullet imellem, og punktet
    // landede dér. Nu sammenlignes de synlige bokse parvis, og punktet tages i en ægte overlapning.
    const bokse = (d) => {
      const egen = d.getBoundingClientRect();
      if (egen.width > 0 && egen.height > 0) return [egen];
      return Array.from(d.querySelectorAll ? d.querySelectorAll('*') : []).slice(0, 200).filter((b) => {
        const bs = getComputedStyle(b);
        const r = b.getBoundingClientRect();
        return bs.visibility !== 'hidden' && bs.display !== 'none' && r.width > 0 && r.height > 0;
      }).map((b) => b.getBoundingClientRect()).slice(0, 50);
    };
    const over = (a, b) => {
      for (const ra of bokse(a)) for (const rb of bokse(b)) {
        const l = Math.max(ra.left, rb.left, 0), r = Math.min(ra.right, rb.right, window.innerWidth);
        const t = Math.max(ra.top, rb.top, 0), u = Math.min(ra.bottom, rb.bottom, window.innerHeight);
        if (r <= l || u <= t) continue;
        const h = dybtPunkt((l + r) / 2, (t + u) / 2);
        if (inde(h, a) && !inde(h, b)) return true;
        if (inde(h, b) && !inde(h, a)) return false;
      }
      return null;
    };
    const oeverst = kandidater.filter((d) => kandidater.every((o) => o === d || over(d, o) !== false));
    return (oeverst.length ? oeverst : kandidater)[(oeverst.length ? oeverst : kandidater).length - 1];
  }
  function findTekst() {
    const all = collectAll(document, []);
    const tag = wantTag ? String(wantTag).toUpperCase() : null;
    const tagOk = (el) => !tag || el.tagName === tag;
    // Map a matched element to the ACTIONABLE control: itself if clickable, else the
    // nearest clickable ancestor (only if its own text isn't much larger than the match,
    // so we don't grab a whole toolbar), else a clickable descendant.
    function toClickable(el) {
      if (el.matches && el.matches(CLICKABLE)) return el;
      const anc = el.closest && el.closest(CLICKABLE);
      if (anc && (anc.textContent || '').trim().length <= tekst.length + 40) return anc;
      // R68 (Opus, maalt i Chrome, ogsaa i 1.30.1): `text=Ordre 7` paa et kort valgte det FOERSTE klikbare barn - kortets
      // Slet-knap - og slettede med ok:true. Et barn vaelges nu kun, naar teksten staar i det; ellers er maalet elementet
      // med teksten, og en handling inde i det er en daekning.
      const desc = el.querySelector && el.querySelector(CLICKABLE);
      if (desc && (desc.textContent || '').includes(tekst)) return desc;
      return el;
    }
    // #70 (sider med skjulte kopier af knapper): `text=Send` stoppede ved en skjult foerste «Send» og meldte
    // «not visible», skoent en synlig knap med samme tekst fandtes. Et maal
    // med en boks og uden visibility:hidden foretraekkes nu; findes der kun skjulte, vaelges som foer, og svaret siger det.
    const synlig = (el) => {
      if (!el || !el.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    function pick(kandidater, test, kunSynlige) {
      const matches = kandidater.filter((el) => tagOk(el) && test((el.textContent || '').trim()));
      if (!matches.length) return null;
      // Prefer the INNERMOST matches (an element that is not an ancestor of another match).
      const inner = matches.filter((el) => !matches.some((o) => o !== el && el.contains && el.contains(o)));
      const pool = inner.length ? inner : matches;
      // Prefer a match that resolves to a real interactive control.
      for (const el of pool) {
        const c = toClickable(el);
        if (c && c.matches && c.matches(CLICKABLE) && (!kunSynlige || synlig(c))) return c;
      }
      // R93 (Opus, maalt i Chrome): en synlig <h2>Settings</h2> slog en skjult <button>Settings</button>, og klikket gik til
      // overskriften med ok:true. Foerste gennemgang tager derfor kun synlige KLIKBARE maal; ellers som foer.
      return kunSynlige ? null : toClickable(pool[0]);
    }
    const eksakt = (t) => t === tekst;
    const delvis = (t) => t && t.includes(tekst);
    const dlg = aabenDialog(all);
    const iDlg = dlg ? all.filter((el) => inde(el, dlg)) : null;
    const kaede = (s) => dlg
      ? pick(iDlg, eksakt, s) || pick(all, eksakt, s) || pick(iDlg, delvis, s) || pick(all, delvis, s)
      // Exact match first, then partial fallback.
      : pick(all, eksakt, s) || pick(all, delvis, s);
    return kaede(true) || kaede(false);
  }
  // Hvad ligger oeverst ved punktet? Elementet selv, noget inde i det, en forfader (klikket bobler gennem den), dets
  // label eller dets egen knap/link-ramme er ikke en daekning. Alt andet er: et overlay, en backdrop, en anden dialog.
  function dybtPunkt(x, y) {
    let hit = document.elementFromPoint(x, y);
    for (let i = 0; i < 20 && hit && hit.shadowRoot; i++) {
      const indre = hit.shadowRoot.elementFromPoint(x, y);
      if (!indre || indre === hit) break;
      hit = indre;
    }
    return hit;
  }
  // R61 (Opus, maalt i Chrome): en forfader under midtpunktet blev regnet for «ikke daekning, klikket bobler gennem den».
  // Men saa gaar klikket til forfaderen og naar aldrig maalet - et deaktiveret link (pointer-events:none), en knap med
  // visibility:hidden, en afklippet slide og en skjult afkrydsning svarede ok:true uden at maalet fik klikket. En forfader
  // er nu ogsaa en daekning, medmindre den er maalets egen knap-, link- eller label-ramme.
  function daekketAf(el, x, y) {
    const hit = dybtPunkt(x, y);
    if (!hit) return { tag: null, id: null, text: '', outside: true };
    return daekketVed(el, hit);
  }
  // R65 (Astra, maalt i model): samme regel for den knude, der faktisk fik en haendelse - maalvagten doemmer hver haendelse
  // paa sin knude, ikke kun den foerste i punktet.
  // HTML-standardens «interactive content»: et klik dér aktiverer ikke en omsluttende labels felt.
  // R74 (Astra, laest): `object` staar ikke paa standardens nuvaerende liste; dens reservetekst er almindelig tekst.
  const INTERAKTIV = 'a[href],button,input,select,textarea,details,embed,iframe,audio[controls],video[controls],img[usemap],label';
  // R66 (Astra): en handling er alt det, klikMaal selv regner for klikbart (CLICKABLE), plus input-knapper. (Flyttet herop i R74,
  // saa ogsaa label-rammen nedenfor kan bruge den.)
  const HANDLING = CLICKABLE + ',input[type="button"],input[type="submit"],input[type="reset"],input[type="image"]';
  // R75 (Opus, maalt i Chrome med Element UI og Base UI-DOM): i en label er en boks med rollen checkbox, switch eller radio
  // feltets egen (el-checkbox__input, Base UI's span role=checkbox) - ikke en anden kontrol. Det samme er alt, der rummer
  // labelens felt eller ligger i det (et custom-felts egen boks i dets skygge, el-checkbox'ens span om sit input).
  const FELTROLLE = '[role="checkbox"],[role="switch"],[role="radio"]';
  const iLabelHandling = (n) => !!n.matches && n.matches(INTERAKTIV + ',' + HANDLING);
  // R76 (Astra, maalt i model): en rolle alene beviser ikke, hvilket felt kontrollen hoerer til - en selvstaendig span med
  // role=checkbox og onclick ved siden af labelens synlige input slap igennem. En boks med feltrolle er derfor kun feltets
  // egen, naar labelens felt er skjult (Base UI, sr-only: inputtet er 1x1 px, og boksen er dets synlige stedfortraeder);
  // ellers skal den rumme feltet eller ligge i det.
  const feltSkjult = (felt) => { if (!felt || !felt.getBoundingClientRect) return false; const r = felt.getBoundingClientRect(); return r.width * r.height <= 1; };
  // R76 (Opus, maalt i Chrome): en div med onclick («aabn detaljer») om feltet blev regnet for feltets egen, og dens handling koerte
  // to gange med landed:true. En beholder om feltet er kun feltets egen, naar den ikke selv er en handling - eller er en boks med
  // feltrolle (el-checkbox__input om sit input).
  const boksRolle = (n) => !!n.matches && n.matches(FELTROLLE) && !n.matches(INTERAKTIV);
  // R77 (Opus, maalt i Chrome med rigtig Base UI 1.9.0): ved et skjult felt blev ENHVER rolle-boks i labelen feltets egen, saa en
  // anden kontrol (en nyhedsbrevs-switch) fik klikket med landed:true. Stedfortraederen ligger lige ved siden af sit skjulte input
  // (Base UI: boksen umiddelbart foer; et sr-only input foer sin switch); en anden kontrol goer ikke.
  const naboTil = (n, felt) => {
    const p = n.parentNode;
    if (!p || p !== felt.parentNode || !p.children) return false;
    const born = Array.from(p.children);
    if (Math.abs(born.indexOf(n) - born.indexOf(felt)) !== 1) return false;
    // R78 (maalt i Chrome med rigtig Base UI 1.9.0): en anden switch kan ligge lige efter det skjulte input, mens den rigtige boks
    // ligger lige foer. Er der flere rolle-bokse i labelen, er stedfortraederen ikke entydig, og ingen af dem er feltets egen.
    // R78 (Astra, maalt i model): optaellingen skete i felt.labels[0], ogsaa naar boksen laa i en anden af feltets labels. Det er
    // den label, der rummer boksen, der taeller.
    // R79 (Astra, maalt i model): et form-associeret custom-felt har ingen offentlig `labels`, saa ingen label blev fundet, og
    // kandidaten blev godtaget uden optaelling; og querySelectorAll saa hverken bokse i aabne shadow roots eller slottede bokse.
    // Labelen findes nu ogsaa via label.control, og boksene taelles i hele det flade traee under den (som daekningen ser det).
    // R80 (Astra, maalt i model): en tom offentlig labels-liste sprang label.control-opslaget over, og uden label blev boksen
    // godtaget uden optaelling; og ved indlejrede labels blev den yderste valgt, saa dens bokse talte med. Labelen er nu den
    // naermeste label om boksen, den skal have feltet som control, og uden en saadan er boksen ikke feltets.
    let lab = null;
    for (let l = n.assignedSlot || n.parentNode || n.host, i = 0; l && i < 1000; l = l.assignedSlot || l.parentNode || l.host, i++) {
      if (l.tagName === 'LABEL') { lab = l.control === felt ? l : null; break; }
    }
    if (!lab) return false;
    const alle = collectAll(document, []);
    return alle.filter((k) => k !== lab && inde(k, lab) && !!k.matches && k.matches(FELTROLLE) && !k.matches(INTERAKTIV)).length === 1;
  };
  const egenBoks = (n, felt) => !!felt && (inde(n, felt) ||
    (inde(felt, n) && (!n.matches || !n.matches(HANDLING) || boksRolle(n))) ||
    (boksRolle(n) && feltSkjult(felt) && naboTil(n, felt)));
  const feltetSelv = egenBoks;
  const lukket = (k) => (k && k.tagName === 'INPUT' && String(k.getAttribute('type') || '').toLowerCase() === 'hidden' ? null : k);
  function daekketVed(el, hit) {
    if (inde(hit, el)) {
      // R64 (Opus' etiket.html, maalt i Chrome 9/10): `click text=Jeg accepterer` fandt labelen, men dens midtpunkt laa paa
      // et link inde i den. Linket fik klikket, afkrydsningen intet, og svaret var ok:true: et klik paa interaktivt indhold
      // i en label aktiverer ikke labelens felt (HTML-standarden). En anden kontrol i en labels punkt er derfor en daekning;
      // labelens eget felt er ikke.
      // R65 (Opus, maalt i Chrome): reglen brugte CLICKABLE - men et link uden href, en span med role=button eller onclick
      // afkrydser feltet med en rigtig mus. Chrome foelger HTML-standardens «interactive content», og det goer reglen nu.
      // R65 (Opus' r65-kortbarn.html, maalt i Chrome): et kort med en Slet-knap i midten svarede ok:true, og Slet blev udfoert -
      // kortets eget klik kom aldrig. En HANDLING inde i maalet er derfor en daekning for ethvert maal; et felt inde i maalet
      // er det ikke (det er saadan en combobox-beholder virker).
      // R66 (Astra, maalt i model): handlingen var kun native knapper og links - en Slet som span role=button eller span med
      // onclick kom igennem med ok:true. Nu er en handling alt det, klikMaal selv regner for klikbart (CLICKABLE), plus
      // input-knapper.
      const erLabel = el.tagName === 'LABEL';
      // R69 (Astra, maalt i model): closest() krydser ikke en aaben shadow root, saa en role=button-vaert uden om en span i
      // dens shadow root blev aldrig set, og Slet koerte med ok:true. Kaeden gaas derfor knude for knude (parentNode || host).
      let indre = null;
      // R66 (Opus, maalt i Chrome): et WordPress-menupunkt (li med sit link), et produktkort med et billedlink og et kort med
      // et «stretched link» blev afvist - linket ER den passive beholders egen handling. Er maalet ikke selv klikbart, er et
      // link inde i det derfor ikke en daekning; en knap eller en anden handling (Slet paa et kort) er det stadig.
      const klikbartMaal = !!el.matches && (el.matches(CLICKABLE) || (!!el.getAttribute && el.getAttribute('tabindex') !== null));
      // R67 (Astra, maalt i model): `<a role="button" onclick="slet()">` i et passivt kort blev fritaget som «link». Kun et
      // rigtigt link er beholderens egen handling: et a med adresse (eller role=link), uden knaprolle og uden onclick.
      // R67 (Opus, maalt i Chrome): og en role=button uden om et ikon-link blev aldrig set, fordi closest standsede ved linket.
      // Er det fundne et rent link, ses der videre ud; en knap uden om det er handlingen.
      // R68 (Opus, maalt i Chrome): `href="#"`, `javascript:` og en rolle som menuitem blev godtaget som «adresse» - Reacts
      // <a href="#" onClick> slettede med ok:true. Et rent link har en rigtig adresse og ingen anden rolle end link.
      const etLink = (n) => {
        const rolle = String((n.getAttribute && n.getAttribute('role')) || '');
        if (n.getAttribute('onclick') !== null || (rolle && rolle !== 'link')) return false;
        // R69 (Opus, maalt i Chrome): en <span role="link"> med en lytter slettede med ok:true - den har ingen adresse og
        // virker kun via script. Kun et <a> kan vaere et rent link.
        if (n.tagName !== 'A') return false;
        const href = n.getAttribute('href');
        if (href === null) return false;
        // R69 (Astra, maalt i model): `java\nscript:` og en tabulator i protokollen er javascript:-adresser for browseren, men
        // ikke for et regulaert udtryk paa den raa attribut. Adressen renses som URL-parseren goer det (tabulatorer og
        // linjeskift fjernes overalt, styre- og mellemrumstegn i enderne), foer den proeves.
        const a = href.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
        // R71 (Astra): et bart # afvises ikke foer opløsningen - med <base> andetsteds peger det paa et andet dokument.
        if (a === '' || /^javascript:/i.test(a)) return false;
        // R70 (Opus, maalt i Chrome): `<sti>#!` og `<hele adressen>#` peger paa samme dokument og slettede med ok:true - reglen
        // saa kun paa href, der begyndte med #. Adressen oploeses nu som browseren goer det (mod baseURI): peger den paa et
        // andet dokument, eller paa samme uden fragment (en genindlaesning), er den rigtig; ellers gaelder fragmentreglen.
        let u = null;
        // R71 (Opus, maalt i Chrome): med <base> et andet sted (Angulars <base href="/">) blev `#!` en «rigtig adresse», og Slet
        // koerte med ok:true. Et link, der kun er et fragment, er i praksis en pladsholder og laeses derfor mod siden selv (en
        // bevidst afvisning: en rigtig mus ville indlaese base-siden).
        try { u = new URL(a, a[0] === '#' ? document.URL : document.baseURI); } catch (e) {}
        if (!u || u.protocol === 'javascript:') return false;
        const udenFrag = (s) => String(s).replace(/#.*$/, '');
        if (!u.href.includes('#') || udenFrag(u.href) !== udenFrag(document.URL)) return true;
        // R69 (Opus, maalt i Chrome): `#!`, `#0` og `#slet` med en lytter slettede med ok:true. Et fragment, hvis maal ikke
        // findes paa siden, flytter intet af sig selv (kun et script giver det en virkning); det goer et spring til linket
        // selv eller til noget, der rummer det, heller ikke (Opus' Slet havde id="slet"). Et spring til et andet afsnit, der
        // findes (eller til toppen), er et rent link.
        // R70 (Astra, maalt i model): som HTML-standardens «indicated part of the document»: foerst fragmentet som skrevet, saa
        // procent-afkodet (UTF-8, ugyldige bytes som U+FFFD), og foerst derefter «top».
        // R70 (Opus, maalt i Chrome): en hash-rute (`#/ordre/7`, `#!/ordre/7`) er en navigation i appen, ikke en pladsholder.
        {
          const frag = u.hash.slice(1);
          if (frag === '') return false;
          if (/^!?\/./.test(frag)) return true;   // R71 (Opus): `#/` og `#!/` alene er ikke en rute
          const find = (f) => (document.getElementById && document.getElementById(f)) ||
            Array.from(document.querySelectorAll('a[name]')).find((x) => x.getAttribute('name') === f) || null;
          let spring = find(frag), afkodet = frag;
          if (!spring) {
            const b = new TextEncoder().encode(frag), ud = [];
            for (let i = 0; i < b.length; i++) {
              const hex = i + 2 < b.length ? String.fromCharCode(b[i + 1], b[i + 2]) : '';
              if (b[i] === 37 && /^[0-9a-f]{2}$/i.test(hex)) { ud.push(parseInt(hex, 16)); i += 2; } else ud.push(b[i]);
            }
            // R71 (Astra): «UTF-8 decode without BOM» bevarer en indledende U+FEFF; TextDecoder fjerner den uden ignoreBOM.
            afkodet = new TextDecoder('utf-8', { ignoreBOM: true }).decode(new Uint8Array(ud));
            spring = find(afkodet);
          }
          if (!spring) return afkodet.toLowerCase() === 'top';
          return !inde(n, spring);
        }
        return true;
      };
      // R68 (Astra, maalt i model): kun det naeste lag blev undersoegt, saa <div role=button><span role=link><a href> skjulte
      // knappen. Nu gaas hele kaeden fra punktet op til maalet: den foerste handling, der ikke er et rent link, er daekningen.
      // Et rent link er en passiv beholders egen handling; for et klikbart maal er ogsaa det en anden kontrol.
      // R68 (Opus' r66-rollekort, maalt i Chrome): et <a> uden adresse blev en tid regnet for «inert» og sprunget over - men
      // en lytter sat med addEventListener kan ikke ses, og Slet koerte med ok:true. Et <a> uden adresse er derfor en handling.
      // R74 (Opus, maalt i Chrome): en span med role=button i en label, hvis egen klikhaandtering annullerer klikket, gav
      // ok:true og landed:true med boksen tom - R65/R66's «en rigtig mus afkrydser dér» holder kun, naar intet annullerer, og
      // det kan ikke ses foer klikket. I label-tilstand er en handling (alt klikbart: rolle, onclick, link uden adresse) derfor
      // ogsaa en daekning, i light DOM som i en komponent; labelens eget felt er det ikke.
      if (erLabel) {
        // R77 (Astra, maalt i model): soegningen standsede ved feltets egen boks og saa aldrig en onclick-handling uden om den. Feltets
        // egne knuder springes nu over, og soegningen fortsaetter op til labelen.
        for (let n = hit; n && n !== el; n = n.assignedSlot || n.parentNode || n.host) if (iLabelHandling(n) && !feltetSelv(n, el.control)) { indre = lukket(n); break; }
      } else {
        let fundet = null, link = null;
        // R70 (Astra, maalt i model): indhold, en slot viser, haenger i light DOM; dets vej gaar gennem slotten og knappen
        // omkring den i shadow root'en (den flade kaede), saa assignedSlot foelges foer parentNode.
        // R71 (Opus, maalt i Chrome): klikket paa en webkomponents vaert (ion-button, sl-button) gik via slotten
        // til vaertens EGEN knap og blev afvist som «en anden kontrol». En handling i maalets egen shadow root (eller dybere),
        // der fylder det meste af maalet, er maalets egen knap; en lille Slet inde i en kort-komponent er det ikke (R72: graensen
        // er overlap, ikke areal - se nedenfor).
        const iEgenSkygge = (k) => { for (let x = k, i = 0; x && i < 1000; x = x.parentNode || x.host, i++) if (x.host === el) return true; return false; };
        // R72 (Astra, maalt i model): arealet alene godtog en knap paa 10000 x 2 px over en vaert paa 200 x 100 (2 % overlap),
        // `break` sprang en Slet omkring den store kontrol over, og et stort skygge-link med # eller javascript: slap uden om
        // linkreglen. Nu er kun en kontrol, hvis overlap med maalet daekker mindst 90 % af maalet, maalets
        // egen (saadan tegner ion-button og sl-button deres knap; R73 Opus maalte Material Webs md-filled-button til 15-31 % (afhaengigt af teksten), saa den
        // afvises fortsat som en graense); kaeden gaas videre forbi den, saa en handling
        // omkring den stadig er en daekning.
        const daekker = (k) => {
          const a = k.getBoundingClientRect(), b = el.getBoundingClientRect();
          const bred = Math.min(a.right, b.right) - Math.max(a.left, b.left), hoej = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          return b.width * b.height > 0 && bred > 0 && hoej > 0 && bred * hoej >= 0.9 * b.width * b.height;
        };
        // R73 (Astra, maalt i model): labelreglen herunder saa kun et link, der var gemt - men et link i komponentens egen skygge,
        // der selv daekker komponenten, blev sprunget over foer det blev gemt, og et felt, en select, en video eller et
        // billedkort i labelen er slet ikke en HANDLING. Alle gav landed:true, mens boksen forblev tom. Det foerste interaktive
        // indhold (HTML-standardens liste) under punktet huskes derfor for sig, uanset om det selv er en handling.
        // R77: alle kandidater huskes, saa labelens check kan springe feltets egne over og finde en handling uden om dem.
        const interaktive = [];
        for (let n = hit; n && n !== el; n = n.assignedSlot || n.parentNode || n.host) {
          const handling = !!n.matches && n.matches(HANDLING) && !!lukket(n);
          // R72 (Opus, maalt i Chrome): en komponent, hvis hele flade er ET link i dens egen shadow root (sl-button med href),
          // er det link; en rigtig mus og 1.30.1 kører det. Knap eller link: det, der daekker komponenten, er komponenten.
          const egenStor = handling && iEgenSkygge(n) && daekker(n);
          // R72 (Opus, maalt i Chrome): en checkbox-komponents egen <label> (ion-checkbox, sl-checkbox) fritog et vilkaarslink
          // midt i labelteksten - linket aabnede, boksen blev ikke afkrydset, og svaret var ok:true. Interaktivt indhold mellem
          // punktet og komponentens egen label er en daekning (HTML: et klik paa interaktivt indhold i en label aktiverer ikke
          // feltet); labelens eget felt er det ikke.
          // R75 (Astra, maalt i model): et custom-felt (form-associated) har sin egen boks i sin skygge; den er feltet selv, ikke en
          // anden kontrol. Alt inde i labelens eget felt er derfor feltet.
          const fremmed = n.tagName === 'LABEL' ? interaktive.find((k) => !feltetSelv(k, n.control)) : null;
          if (egenStor && fremmed) { fundet = fremmed; break; }
          // R74 (Astra, maalt i model): en label i labelen (ugyldig HTML, men muligt) blev ikke husket, saa en stor indre label
          // med for= et andet felt aktiverede det med landed:true. En label er ogsaa interaktivt indhold; den huskes efter, at den
          // selv er proevet som komponentens label.
          // R75 (Astra, maalt i model): en stor rolle-span, onclick eller et link uden adresse inde i komponentens label blev fritaget
          // som komponentens egen og ikke husket, saa en annullerende handling gav landed:true med boksen tom. Som i label-tilstanden
          // (R74) huskes enhver handling ogsaa.
          if (iLabelHandling(n) && lukket(n)) interaktive.push(n);
          if (!handling || egenStor) continue;
          // R75 (Astra, maalt i model): komponentens eget felt (et native input med rolle eller onclick) under 90 % blev afvist som
          // «en anden kontrol», selv om komponentens egen label om det daekker komponenten. Er n feltet for en saadan label laengere
          // oppe i kaeden, er det komponentens eget felt.
          let egetFelt = false;
          for (let o = n.assignedSlot || n.parentNode || n.host, i = 0; o && o !== el && i < 1000; o = o.assignedSlot || o.parentNode || o.host, i++) {
            if (o.tagName === 'LABEL' && o.control && inde(n, o.control) && o.matches && o.matches(HANDLING) && iEgenSkygge(o) && daekker(o)) { egetFelt = true; break; }
          }
          if (egetFelt) continue;
          if (etLink(n)) { link = link || n; continue; }
          fundet = n; break;
        }
        indre = fundet || (klikbartMaal ? link : null);
      }
      // R75 (Astra, maalt i model): ogsaa et punkt i labelens eget custom-felts skygge (dets egen boks) er feltet, ikke en anden kontrol.
      if (indre && indre !== el && inde(indre, el)) {   // (feltets egne knuder er sprunget over i soegningen)
        // R73 (Opus, maalt i Chrome): noten naevnte BUTTON#button i en md-filled-buttons skygge, agenten klikkede `#button`, og det
        // ramte den foerste Material-knap paa siden (Annuller) med landed:true. En kontrol i en shadow root faar et flag, saa noten
        // ikke peger paa et id, som andre komponenter deler.
        const iSkygge = !!indre.getRootNode && indre.getRootNode() !== document;
        return { tag: indre.tagName, id: indre.id || null, text: (indre.textContent || '').trim().slice(0, 60), inside: true, ...(erLabel ? { label: true } : {}), ...(iSkygge ? { skygge: true } : {}) };
      }
      return null;
    }
    // R63 (Astra og Opus, maalt): undtagelserne fra R62 for en label uden for=, en pladsholder og tekst i et kort lod click og
    // fill ramme et FREMMED felt (en nyhedsbrevs-popup) og indpakningen om et deaktiveret link med ok:true. De er fjernet: de
    // tilfaelde afvises igen, sikkert og forklaret, og noten peger paa at klikke feltet eller kortet direkte.
    const SEMANTISK = 'label,button,a,summary,[role="button"],[role="link"],[role="menuitem"],[role="menuitemcheckbox"],' +
      '[role="menuitemradio"],[role="option"],[role="tab"],[role="checkbox"],[role="radio"],[role="switch"]';
    // R72 (Opus, maalt i Chrome): closest() saa ikke en checkbox-komponents label i shadow root'en, naar maalet var den slottede
    // labeltekst - aktiveringsklikket paa feltet blev stoppet som «daekning». Rammen findes i den flade kaede, som resten.
    let ramme = null;
    for (let n = el, i = 0; n && i < 1000; n = n.assignedSlot || n.parentNode || n.host, i++) {
      if (n.matches && n.matches(SEMANTISK + ',[onclick]')) { ramme = n; break; }
    }
    // R65 (Opus, maalt i Chrome): en delegerende beholder (en liste med EN onclick) blev hver raekkes «egen ramme», saa
    // naboraekken blev godtaget, og den forkerte raekke valgt med ok:true. En ramme, der kun er en onclick-beholder, godtager
    // derfor kun det, der ligger MELLEM maalet og den (en forfader til maalet), ikke en anden raekke; en aegte knap, et link,
    // en label eller en rolle godtager som foer alt inden i sig.
    const semantisk = !!ramme && !!ramme.matches && ramme.matches(SEMANTISK);
    // R68 (Astra, maalt i model): et felt med pointer-events:none i en div role=button fik knappens klik som «sin egen ramme»,
    // og svaret var landed:true, mens feltet intet fik. Er maalet selv en kontrol, er en ydre ramme en anden kontrol; rammen
    // gaelder kun tekst og ikoner inde i en knap, et link eller en label (feltets egen label haandteres for sig herunder).
    const elKontrol = !!el.matches && el.matches(CLICKABLE + ',input,select,textarea') && el.tagName !== 'LABEL';
    // R64 (Astra, maalt i model): et input oven paa teksten i et role=button-kort, og et link inde i en afkrydsnings label,
    // blev godtaget som maalets egen ramme. Rammen og labelen taeller kun, naar det der ligger oeverst, ikke selv er en
    // anden kontrol: klik paa et link i en label aktiverer ikke labelens kontrol (HTML-standarden).
    // R66 (Astra, maalt i model): et felt, hvis label rummer en span med role=button, blev afvist, naar punktet ramte spanen -
    // men en rigtig mus afkrydser feltet dér. Ligger punktet i feltets egen label, gaelder HTML-standardens regel, som for
    // en label, der selv er maalet.
    const iEgenLabel = Array.from(el.labels || []).some((l) => inde(hit, l)) || (!!ramme && ramme.tagName === 'LABEL');
    // R73 (Astra, maalt i model): rammen blev fundet i den flade kaede, men kontrollen under punktet stadig med closest(), som
    // ikke foelger en slot. Et ikon slottet ind i et andet link eller en anden knap i rammen blev derfor ikke set, og den
    // handling koerte. Kontrollen under punktet findes nu i samme flade kaede.
    // R74 (Opus, maalt i Chrome): i en label-ramme saa vaelgeren kun INTERAKTIV, saa en Slet med en rolle over teksten fik
    // klikket. En handling er ogsaa her en anden kontrol (se label-tilstanden ovenfor).
    let hitKontrol = null;
    // R77: i label-tilstand springes labelens eget felt og dets egen boks over, saa en handling uden om dem ses.
    // Er maalet selv et felt med en label om punktet, er det feltet, der springes over (R77, ogsaa naar rammen er dets boks).
    const labelFelt = (!!ramme && ramme.tagName === 'LABEL' && ramme.control) ||
      (Array.from(el.labels || []).some((l) => inde(hit, l)) ? el : null) || el.control || null;
    for (let n = hit, i = 0; n && i < 1000; n = n.assignedSlot || n.parentNode || n.host, i++) {
      if (iEgenLabel ? (iLabelHandling(n) && !feltetSelv(n, labelFelt)) : (!!n.matches && n.matches(CLICKABLE + ',input,select,textarea'))) { hitKontrol = lukket(n); break; }
    }
    // R77: en handling, der rummer labelens felt (og ikke er feltets egen boks - den er sprunget over), er en anden kontrol,
    // ogsaa naar den er en forfader til maalet; en knap om en tekst, der ikke rummer feltet, er stadig tekstens ramme.
    const omFeltet = !!hitKontrol && iEgenLabel && !!labelFelt && inde(labelFelt, hitKontrol) && hitKontrol.tagName !== 'LABEL';
    // R78 (Opus, maalt i Chrome): med feltet som maal var en handling om feltet i labelen selve rammen (hitKontrol === ramme), og den
    // blev godtaget, foer omFeltet blev proevet. En handling om labelens felt er en anden kontrol, ogsaa naar den er rammen.
    const egenKontrol = !omFeltet && (!hitKontrol || hitKontrol === ramme || inde(el, hitKontrol) || hitKontrol === el.control ||
      egenBoks(hitKontrol, el.control) ||
      Array.from(el.labels || []).includes(hitKontrol));
    const andenKontrol = !egenKontrol;
    if (ramme && (!elKontrol || ramme.tagName === 'LABEL') && inde(hit, ramme) && !andenKontrol && (semantisk || inde(el, hit))) return null;
    for (const l of Array.from(el.labels || [])) if (inde(hit, l) && !andenKontrol) return null;
    // R61 (Astra): en svaevende label med pointer-events:none over sit eget felt - musen rammer feltet, og det er netop
    // hvad et klik paa labelen goer. Labelens eget felt er ikke en daekning.
    if (el.control && inde(hit, el.control)) return null;
    return { tag: hit.tagName, id: hit.id || null, text: (hit.textContent || '').trim().slice(0, 60) };
  }

  const el = tekst != null ? findTekst() : queryDeep(document, sel);
  if (kunElement) return el;
  if (!el) return null;
  // R64: med `gem` foelger ogsaa daekningsreglen for netop dette element med, saa vagten i siden (armerMaalVagt) kan afgoere
  // i selve haendelsen, om den ramte maalet - ikke kun hvad der laa i punktet, da maalet blev fundet.
  if (gem) { window.__bmcpMaal = el; window.__bmcpMaalTjek = (px, py, knude) => (knude ? daekketVed(el, knude) : daekketAf(el, px, py)); }
  const txt = tekst != null ? { text: (el.textContent || '').trim().slice(0, 80) } : {};
  const rFoer = el.getBoundingClientRect();
  // R66 (Opus, maalt i Chrome): genmaalingen rullede maalet til midten igen, saa to maalinger var ens per konstruktion. En
  // genmaaling (ingenRul) maaler nu, hvor maalet staar, uden at flytte det.
  if (!ingenRul) el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  const rullet = r.top !== rFoer.top || r.left !== rFoer.left;
  // MAALT 21/8: et skjult element har rect 0x0 ved (0,0), saa midtpunktet blev (0,0)
  // og debuggerClick sendte et AEGTE museklik i sidens oeverste venstre hjoerne -
  // paa hvad der nu laa der (logo, menu, link) - og svarede ok:true. Det er ikke en
  // rapporteringsfejl men en handlingsfejl: vi klikker et andet sted end der blev bedt om.
  if (r.width <= 0 || r.height <= 0) {
    return { found: false, hidden: true, tag: el.tagName, ...txt, rect: { w: r.width, h: r.height } };
  }
  // MAALT i Chrome 9/10: et link brudt over to linjer har sit midtpunkt i hullet mellem linjerne, og klikket ramte afsnittet.
  // Et menneske klikker paa teksten, saa et element med flere linjebokse klikkes midt i den foerste.
  const bokse = el.getClientRects ? Array.from(el.getClientRects()).filter((b) => b.width > 0 && b.height > 0) : [];
  // R64 (Astra, maalt i model): ligger den foerste linjeboks under noget andet, klikkes den foerste linjeboks, hvis midtpunkt
  // rammer maalet selv. Ingen undtagelse: kun et punkt, der rammer linket eller noget inde i det, vaelges; ellers den foerste,
  // og daekningen meldes som foer.
  const boks = bokse.length > 1
    ? (bokse.find((b) => inde(dybtPunkt(b.x + b.width / 2, b.y + b.height / 2), el)) || bokse[0]) : r;
  const x = boks.x + boks.width / 2;
  const y = boks.y + boks.height / 2;
  const daekket = daekketAf(el, x, y);
  return { x, y, tag: el.tagName, ...txt, found: true, ...(rullet ? { rullet: true } : {}), ...(daekket ? { covered: daekket } : {}) };
}

// Udtrykket der finder et element ud fra tekst (bruges af proever og som tekst til Runtime.evaluate).
function buildTextFinderJS(textPattern, tagFilter) {
  return `(${klikMaal})(null, ${JSON.stringify(textPattern)}, ${JSON.stringify(tagFilter || null)}, false, true)`;
}

// Svaret naar et andet element ligger over maalet: intet klikkes (R57).
function daekketSvar(selector, el, method) {
  const c = el.covered || {};
  const hvad = (c.tag || 'an element') + (c.id ? '#' + c.id : '');
  const svar = { ok: false, error: 'covered', ...(method ? { method } : {}), tag: el.tag, ...(el.text ? { text: el.text } : {}),
    covered_by: c, landed: false };
  // R61 (Opus): uden forklaring fik et maal uden for vinduet bare ok:false.
  if (c.outside) {
    svar.note = `The center of ${selector} is outside the visible part of the page, so the mouse cannot reach it there. Nothing was done.`;
    return svar;
  }
  if (c.inside) {
    svar.note = c.label
      ? `At the center of ${selector} lies ${hvad}, a different control inside it, so the mouse would click that, ` +
        'and a click on a control inside a label does not, or may not, activate the label\'s own field (its own click handler can cancel it). Nothing was done. Click the one you ' +
        'mean with its own selector (for a checkbox in the label, the checkbox itself).'
      : `At the center of ${selector} lies ${hvad}, a different control inside it, so the mouse would click that instead ` +
        'and run its action. Nothing was done. Click the one you mean with its own selector.';
    if (c.skygge) svar.note += ' It sits in a web component\'s own shadow root, so a selector for it (such as its id) can match the same ' +
      'part of another component on the page first; check what a selector matches before you click it.';
    return svar;
  }
  // R63: ingen musebevaegelse foer en afvisning (den aabnede menuer, der blev staaende). Noten siger, hvad der ligger der nu,
  // og hvad agenten selv kan goere.
  svar.note = `At the center of ${selector} lies ${hvad} right now - an element in front of it, or one around it when the ` +
    'target itself does not take clicks there (pointer-events, visibility, clipping, or a gap such as between the lines of a ' +
    'wrapped link) - so the mouse would reach that instead. Nothing was done. If an earlier mouse action opened it (a ' +
    'tooltip or a menu), move the mouse away with browser_hover on another element and try again. ' +
    'If a dialog or overlay is in front, act inside it or close it first with its own close or accept button ' +
    '(browser_dismiss_overlays knows some common banners). If that element is the one you mean - the field under a label or a ' +
    'placeholder, the card around a text, or a styled box over a hidden input - click it directly with its own selector.';
  return svar;
}

// R64: daekningen kom frem efter opslaget. Opdagede vagten det foer afsendelsen, blev intet sendt; ellers stoppede den
// haendelserne i siden, foer sidens egne lyttere saa dem.
function vagtSvar(selector, el, r) {
  const svar = daekketSvar(selector, { ...el, covered: r.blokeret });
  if (r.iFremmedRamme) {
    // R65 (Opus, maalt i Chrome): en fremmed iframe kom frem over maalet; trykket gik ind i den, og vagten i toppen saa intet.
    // R68 (Opus, maalt i Chrome): naaede trykket maalet, foer rammen kom, siger noten det - ikke «the press went into it».
    const c = r.blokeret || {};
    const hvad = (c.tag || 'a frame') + (c.id ? '#' + c.id : '');
    svar.landed = null;
    svar.maybe_landed = true;
    // R69 (Opus, maalt i Chrome): hover sender ingen tryk - dens note taler om musens bevaegelse.
    svar.note = r.hover
      ? `When the mouse moved onto ${selector}, ${hvad} - a frame - lay in front of it, and the mouse movement went into the frame; ` +
        'the page around it cannot see what happened there (a preview or menu may have opened). Check the state before trying again.'
      : r.trykNaaet
      ? `The press reached ${selector}, then ${hvad} - a frame - came in front of it, and the rest of the click went into the frame; ` +
        'the page around it cannot see what happened there. Check the state before trying again.'
      : `When the mouse pressed, ${hvad} - a frame - lay in front of ${selector}, ` +
        'and the press went into it; the page around it cannot see what happened there. Check the state before trying again.';
    return svar;
  }
  if (r.delvis) {
    // R65 (Astra): de foerste haendelser naaede maalet, foer noget kom foran - handlingen kan vaere delvist sket.
    const c = r.blokeret || {};
    svar.landed = null;
    svar.maybe_landed = true;
    svar.note = r.hover
      ? `The first mouse movement reached ${selector}, then ${(c.tag || 'an element') + (c.id ? '#' + c.id : '')} came in front of it, ` +
        'and the rest of the mouse movement was stopped at the window. The page may have reacted to the movement (a menu or preview may ' +
        'have opened): check the state before trying again.'
      : `The first mouse events reached ${selector}, then ${(c.tag || 'an element') + (c.id ? '#' + c.id : '')} came in ` +
      'front of it, and the rest of the presses and clicks were stopped at the window, so the action did not complete. The page may have reacted to ' +
      'the press: check the state before trying again.';
    return svar;
  }
  if (!r.foerSendt) {
    // R65 (Opus' r65-vindue.html, maalt i Chrome): en side, der selv lytter paa window, handlede, selv om vagten stoppede
    // haendelsen - saa svaret er uvist, ikke et nej.
    svar.landed = null;
    svar.maybe_landed = true;
    svar.note = svar.note.replace('Nothing was done.', 'The mouse events were sent, but stopped at the window before they ' +
      'reached any element of the page, so neither element got them - but a listener on the window itself may still have ' +
      'acted on them: check the state before trying again.');
  }
  return svar;
}

// R70 (Astra): vagten kunne ikke armeres i siden (fx midt i en indlaesning) - intet er sendt.
function ikkeArmeretSvar(selector, el) {
  return { ok: false, error: 'The click could not be checked in the page, so it was not sent: ' + selector, tag: el.tag, landed: false,
    note: 'The page could not be prepared to check that the mouse reaches the element (it may be loading or busy). Nothing was done; try again.' };
}

// R65 (Astra): maalet blev fundet, men siden fjernede det, foer musen kom - intet er sendt.
function vaekSvar(selector, el) {
  return { ok: false, error: 'Element not found: ' + selector, tag: el.tag, landed: false,
    note: 'The element was found, but the page removed it before the mouse got there. Nothing was done.' };
}

// R61 (Opus, maalt i Chrome): et tooltip, som vaerktoejets EGET hover havde aabnet, laa over naboknappen, og klikket blev
// afvist med «the mouse reaches that instead». En rigtig mus skjuler tooltippet, naar den flyttes. Er maalet daekket,
// flyttes musen derfor hen til det, og daekningen maales igen - kun i den aktive fane: i en baggrundsfane leverer Chrome
// ikke musen, og en bevaegelse der falder paa fristen, lander senere (maalt 19/9).
function parseSelector(selector) {
  // "button:text(Get started)" → { tag: 'button', text: 'Get started' }
  const tagTextMatch = selector.match(/^(\w+):text\((.+)\)$/);
  if (tagTextMatch) return { type: 'text', tag: tagTextMatch[1], text: tagTextMatch[2] };

  // "text=Submit" → { text: 'Submit' }
  if (selector.startsWith('text=')) return { type: 'text', tag: null, text: selector.slice(5) };

  // Standard CSS selector
  return { type: 'css', selector };
}

// R64 (Opus' hop.html, maalt i Chrome 9/10): en header, der bliver position:fixed, naar siden rulles, flyttede alt 140 px op
// EFTER at maalet var maalt. Koden foer klikkede saa raekken nedenunder med ok:true; maalvagten afviser det sikkert. Er maalet
// blevet rullet frem, maales det derfor igen, til to maalinger med 100 ms imellem er ens (hoejst tre gange).
// R65 (Opus, maalt i Chrome): en fast pause paa 150 ms er ikke «staar stille» - et indsat element 200 ms efter rulningen kom
// efter maalingen. Nu ventes der paa to ens maalinger; flytter siden sig senere, afviser vagten.
async function resolveElement(tabId, selectorStr) {
  let r = await findElement(tabId, selectorStr);
  if (!r || !r.rullet) return r;
  for (let i = 0; i < 3; i++) {
    await new Promise((ok) => setTimeout(ok, 100));
    // R65 (Astra, maalt i model): her stod `|| foerst`. Var maalet forsvundet ved anden maaling, blev det gamle punkt
    // klikket - paa den knap, der nu laa der, med ok:true. Findes maalet ikke igen, findes det ikke.
    let igen = await findElement(tabId, selectorStr, true);
    // R67 (Opus, maalt i Chrome): et billede over maalet, der blev indlaest efter rulningen, skubbede det ud af vinduet, og
    // klikket blev afvist som «outside» - en rigtig bruger ruller bare til det. Er maalet uden for vinduet, rulles det frem igen.
    if (igen && igen.covered && igen.covered.outside) igen = await findElement(tabId, selectorStr);
    if (!igen) return null;
    const stille = igen.found && r.found && Math.abs(igen.x - r.x) <= 1 && Math.abs(igen.y - r.y) <= 1;
    r = igen;
    if (stille) break;
  }
  return r;
}

async function findElement(tabId, selectorStr, ingenRul = false) {
  const parsed = parseSelector(selectorStr);

  if (parsed.type === 'css') {
    // Standard CSS with shadow DOM traversal - try executeScript first, debugger fallback on CSP
    const scriptResult = await safeExecuteScript(tabId, klikMaal, [parsed.selector, null, null, true, false, ingenRul]);
    if (scriptResult.cspBlocked) {
      const result = await debuggerEval(tabId, `(${klikMaal})(${JSON.stringify(parsed.selector)}, null, null, true, false, ${!!ingenRul})`);
      return result ? { ...result, method: 'debugger' } : null;
    }
    return scriptResult.result;
  }

  // Text-based selector - always use debugger (more reliable, no CSP issues)
  const result = await debuggerEval(tabId,
    `(${klikMaal})(null, ${JSON.stringify(parsed.text)}, ${JSON.stringify(parsed.tag)}, true, false, ${!!ingenRul})`);
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
//
// R137 (maalt 19/10 paa en side med 50-200 navigationer i sekundet): under en lammet browsertraad kom ét svar for sent, og
// broen blev revet ned - med WebSocket-forbindelsen og de svar, der var paa vej. Broen erstattes derfor kun efter to mistede
// svar i traek: svarer den foerste ping ikke inden 1,5 s, sendes en til, og et svar paa en af dem inden for 1,5 s mere taeller.
// Et afslag (ingen modtager) er et svar: det er der ingen grund til at vente paa.
async function offscreenSvarer() {
  const ping = () => chrome.runtime.sendMessage({ type: 'bmcp_ping' });
  const frist = () => new Promise((_, afvis) => setTimeout(() => afvis(new Error('no answer')), 1500));
  try {
    const foerste = ping();
    foerste.catch(() => {});
    let svar;
    try {
      svar = await Promise.race([foerste, frist()]);
    } catch (e) {
      if (e?.message !== 'no answer') throw e;
      svar = await Promise.race([Promise.any([foerste, ping()]), frist()]);
    }
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

// Et omraade paa mere end dette ville faa HVER brugers browser til at probe tusindvis af porte hvert andet sekund.
const PORTE_MAX_SPAEND = 200;
/** Laeser et alternativt portomraade fra chrome.storage.local. Ugyldigt = standarden (9876-9895) staar. */
async function portOmraadeFraLager() {
  try {
    const { bmcpPorte } = await chrome.storage.local.get({ bmcpPorte: null });
    const m = /^(\d{4,5})-(\d{4,5})$/.exec(String(bmcpPorte ?? ''));
    if (!m) return null;
    const fra = Number(m[1]), til = Number(m[2]);
    if (fra < 1024 || til > 65535 || til < fra || til - fra >= PORTE_MAX_SPAEND) return null;
    return fra + '-' + til;
  } catch { return null; }
}

// ⛔ MAALT 24/9 - fundet af Astra, bekraeftet her: broen kunne bygges af TRE kaldere paa
// samme tid - linjen oeverst i «Start», installations-haendelsen og hjerteslaget. Ingen af
// dem ventede paa de andre. Ved en ny installation fyrer de to foerste naesten samtidig, og
// installations-haendelsen LUKKER broen mens den anden er ved at bygge den. Luk-og-genbyg
// efterlader broen halvdoed: den findes, melder det rigtige spaend, og alle dens kald mod
// 127.0.0.1 haenger for evigt. Resultat: «Not connected» for evigt for en ny bruger.
//
// Nu bygges broen én ad gangen: et kald der kommer mens et andet er i gang, faar det samme
// loefte og venter paa det.
//
// ⛔ 26/9 (fuld review, maalt): to huller i den foerste udgave af koeen.
//  1. «Reconnect» og opdateringen LUKKEDE broen uden for koeen og sluttede sig derefter til en
//     igangvaerende opbygning. Var hjerteslaget midt i sit ping, fejlede pinget (dokumentet var
//     vaek), lukningen kastede, og hjerteslaget returnerede UDEN at bygge: ingen bro i op til 60 s.
//     Nu gaar «luk og byg igen» gennem SAMME koe (genbygOffscreen) og venter paa det der er i gang.
//  2. ⛔ INGEN FRIST (26/9, Astra maalte det): en foerste udgave gav hvert led en frist paa 20 s. Men
//     en frist stopper ikke arbejdet - den frigiver kun koeen. Et udloebet led kunne vaagne efter et
//     await og lukke den NYE, levende bro; og fristen talte mens leddet stod i koe, saa en
//     genopbygning fik ned til ét sekunds arbejdstid. Et haengende led blokerer derfor baade
//     hjerteslag og «Reconnect», og genopretning er IKKE garanteret: en tilkoblet debugger holder
//     servicearbejderen i live (Chrome 118+), saa den genstarter ikke af sig selv. Udvejen er at
//     genindlaese udvidelsen - det staar i CHANGELOG som kendt begraensning (Astra 26/9).
let offscreenIGang = null;

function iOffscreenKoe(arbejde) {
  const forrige = offscreenIGang;
  const ledet = (async () => {
    if (forrige) { try { await forrige; } catch { /* det forrige led fejlede - vi arbejder alligevel */ } }
    return arbejde();
  })().finally(() => {
    if (offscreenIGang === ledet) offscreenIGang = null;
  });
  offscreenIGang = ledet;
  return ledet;
}

function ensureOffscreen() {
  return offscreenIGang || iOffscreenKoe(ensureOffscreenIndre);
}

// Luk den gamle bro og byg en frisk - i koeen, efter det der allerede er i gang.
function genbygOffscreen() {
  return iOffscreenKoe(async () => {
    try {
      // R139 (Astra): erstattet er broen foerst, naar lukningen er lykkedes - en afvist lukning efterlader en levende bro.
      if (await chrome.offscreen.hasDocument()) { await chrome.offscreen.closeDocument(); broenErstattes(); }
    } catch (e) {
      console.warn('[BG] kunne ikke lukke broen foer genopbygning:', e?.message || e);
      // R141 (Opus H3): lukkede Chrome dokumentet, men kastede bagefter, er broen alligevel erstattet.
      if (await broenErVaek()) broenErstattes();
    }
    await ensureOffscreenIndre();
  });
}

// ── Installationens identitet (1.31, #58) ─────────────────────────────────────
// Chrome Web Store-udvidelsen har samme id i alle profiler, saa serveren kunne ikke se HVILKEN profil en forbindelse kom
// fra. Hver installation (én pr. Chrome-profil) faar derfor:
//   instance - 16 tilfaeldige hex-tegn, lavet ÉN gang og gemt i chrome.storage.local (ikke sync: hver profil sin egen).
//              Den laves her, FOER offscreen-dokumentet, og foelger med i dokumentets adresse (&i=): et offscreen-dokument
//              har kun chrome.runtime og kan ikke selv laese lageret (R106 - samme fejl som 1.30.0's parring maalte).
//   profile  - brugerens betegnelse fra popuppen, ^[A-Za-z0-9._-]{1,32}$ eller null (&p=). Den er et VALG, ikke en noegle:
//              hilsenen er usigneret, og et andet program paa maskinen kan paastaa samme betegnelse (README).
const PROFIL_MOENSTER = /^[A-Za-z0-9._-]{1,32}$/;
const INSTANS_MOENSTER = /^[0-9a-f]{16}$/;

function rensProfil(v) {
  const t = typeof v === 'string' ? v.trim() : '';
  return PROFIL_MOENSTER.test(t) ? t : null;
}

// Samtidige kald deler ét opslag, saa to kaldere aldrig laver hver sit id.
let identitetIGang = null;
function installationsIdentitet() {
  if (!identitetIGang) {
    identitetIGang = (async () => {
      const { bmcpInstans = null, bmcpProfil = null } = await chrome.storage.local.get({ bmcpInstans: null, bmcpProfil: null });
      let instans = INSTANS_MOENSTER.test(String(bmcpInstans ?? '')) ? bmcpInstans : null;
      if (!instans) {
        const b = new Uint8Array(8);
        crypto.getRandomValues(b);
        instans = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
        await chrome.storage.local.set({ bmcpInstans: instans });
      }
      return { instans, profil: rensProfil(bmcpProfil) };
    })().finally(() => { identitetIGang = null; });
  }
  return identitetIGang;
}

// Omdoebning fra popuppen: gem betegnelsen, og send den til offscreen-dokumentet, som sender en ny hilsen paa alle aabne
// forbindelser. Dokumentet genskabes IKKE - det ville afbryde alle chats' igangvaerende kald (R107). Er en opbygning af
// broen i gang, ventes den ud foerst (ensureOffscreen slutter sig til den), saa beskeden ikke kommer foer dokumentet lytter;
// et dokument, der bygges bagefter, laeser den nye betegnelse fra lageret.
async function saetProfil(raa) {
  const t = typeof raa === 'string' ? raa.trim() : '';
  if (t && !PROFIL_MOENSTER.test(t)) return { ok: false, error: 'profile-invalid' };
  const profil = t || null;
  await chrome.storage.local.set({ bmcpProfil: profil });
  try { await ensureOffscreen(); } catch (e) { console.warn('[BG] broen kunne ikke bygges efter omdoebning:', e?.message || e); }
  try { await chrome.runtime.sendMessage({ type: 'bmcp_profil', profile: profil }); } catch { /* intet dokument lytter */ }
  const { instans } = await installationsIdentitet();
  return { ok: true, profile: profil, instance: instans };
}

async function ensureOffscreenIndre() {
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
        `attempts - pausing for ${OFFSCREEN_PAUSE_MS / 60000} min, then trying again. ` +
        'In a hurry: chrome://extensions → toggle the extension off and on.');
      await chrome.storage.local.set({ offscreenGenskabt: 0, offscreenPauseTil: nu + OFFSCREEN_PAUSE_MS });
      return;
    }
    console.warn(`[BG] offscreen-dokumentet svarer ikke — erstatter det (forsoeg ${offscreenGenskabt + 1}/${MAX_OFFSCREEN_GENSKAB})`);
    await chrome.storage.local.set({ offscreenGenskabt: offscreenGenskabt + 1 });
    try { await chrome.offscreen.closeDocument(); } catch (e) {
      console.warn('[BG] kunne ikke lukke det doede dokument:', e?.message || e);
      // R141 (Opus H3): lukkede Chrome dokumentet, men kastede bagefter, gaelder det som lukket; ellers proeves igen senere.
      if (!(await broenErVaek())) return;          // proev igen ved naeste hjerteslag
    }
    // R138/R139: lukket - det gamle dokuments forbindelser er lukkede, ogsaa hvis det ikke naaede at sige det selv.
    broenErstattes();
  }
  // R144 (Astra, model): fandt hjerteslaget INGEN bro, og bekræfter begge kilder, at den er vaek, er den forrige bro erstattet - ogsaa
  // naar en tidligere lukning efterlod den umarkeret (H3 med en kontekstliste, der endnu viste den).
  if (!findes && broensDokument !== null && await broenErVaek()) broenErstattes();

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
  // Portomraadet foelger samme vej som versionen. MAALT 12/9 af Astra: serveren sender kun til den NYESTE forbundne
  // udvidelse, saa en testbrowser paa de samme porte bliver "nyeste" for hver eneste koerende chats server. Et
  // omraade i chrome.storage.local lader én profil koere isoleret - og fordi det er en VAERDI og ikke en kodeaendring,
  // er repoets filer byte-identiske, og udgivelsens kode-aftryk er uroert. (Mit foerste forslag, at flytte portene
  // til manifestet, ville have fjernet dem fra aftrykket - Astra maalte at de ligger i offscreen.js, som hashes.)
  const porteParam = await portOmraadeFraLager();
  // 1.31 (#58): installationens id og betegnelse (se installationsIdentitet). Kan lageret ikke laeses, sendes ingen - saa
  // hilser broen som en udvidelse fra foer 1.31, i stedet for at broen ikke bygges.
  let ident = null;
  try { ident = await installationsIdentitet(); } catch (e) { console.warn('[BG] installationens id kunne ikke laeses:', e?.message || e); }
  const identParam = (ident ? '&i=' + ident.instans : '') + (ident && ident.profil ? '&p=' + encodeURIComponent(ident.profil) : '');
  const forespoergsel = [minVersion ? 'v=' + encodeURIComponent(minVersion) : '', porteParam ? 'porte=' + porteParam : '']
    .filter(Boolean).join('&') + identParam;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html' + (forespoergsel ? '?' + forespoergsel.replace(/^&/, '') : ''),
    reasons: ['WORKERS'],
    justification: 'Maintain persistent WebSocket connection to local MCP server',
  });
}

// ── Action Logging ─────────────────────────────────────────────────────────

// 1.31.0: select_frame koerer ogsaa agentens JavaScript (R129-ASTRA D40) og fremhaeves som execute_script.
const SENSITIVE = new Set(['get_cookies', 'get_local_storage', 'execute_script', 'select_frame', 'extract_token']);

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
  // 26/9: parringen er trukket tilbage i 1.30.1 - baggrunden udleverer ingen noegle.
  if (msg.type === 'mcp_command') {
    const port = msg.port;
    // R133 (Astra): kaldets ur starter HER, naar udvidelsen modtager det - foer sessionsgendannelse og adoption.
    const modtaget = Date.now();
    kommandoFraDokument(msg.gen);   // R138: en kommando fra et nyt bro-dokument goer det gamle dokuments forbindelser lukkede
    logAction(port, msg.method);
    // R134: agentkodens to vaerktoejer svarer altid inden for budgettet (se AGENTKODE_FRIST). Kun det foerste svar sendes.
    const vagt = AGENTKODE_METODER.has(msg.method) ? { sendt: false, lukket: false } : null;
    let svaret = false;
    const svar = (r) => { if (svaret) return; svaret = true; sendResponse(r); };
    // Restore sessions from storage (service worker may have restarted), then take over any
    // session orphaned by an unclean disconnect so navigate→click keeps hitting the same tab.
    // R138: et kald fra en lukket forbindelse koerer intet - tjekket efter hver ventetid (gendannelse, adoption), foer sessionen roeres.
    const arbejde = restoreSessions()
      .then(() => adoptOrphanedSession(port, msg.pid, msg.gen).catch(() => null)) // adoption is best-effort, never fatal; R139: it checks the connection itself
      .then(() => {
        if (fraLukketForbindelse(port, msg.gen)) return { ...LUKKET_SVAR };
        // Stempl pid'en ÉT sted, foer dispatch. De fem nedstroems getSession(port)-kald
        // arver den derfra, saa ingen af dem behoever at kende til pid-begrebet.
        getSession(port, msg.pid, msg.gen);
        return dispatch(port, msg.method, msg.params, modtaget, vagt);
      });
    arbejde.then((r) => svar(r)).catch((err) => svar({ __error: err.message || String(err) })); // ogsaa en afvist sessionsgendannelse svares
    if (vagt) {
      const ur = setTimeout(() => {
        vagt.lukket = true;
        svar(vagt.sendt
          ? { __error: 'The code was sent to the page, but no answer came back within the call\'s time. It MAY already have run. ' +
              'It is not repeated automatically - call again only if it is safe to run twice.' }
          : { ok: false, error: 'call-timeout', sent: false, retry: true,
              note: 'Nothing was run; the call ran out of time before the code could be sent. Call again.' });
      }, Math.max(0, agentKodeSlut(modtaget) - Date.now()));
      arbejde.catch(() => {}).then(() => clearTimeout(ur));
    }
    return true; // async response
  }

  if (msg.type === 'session_disconnect') {
    forbindelsenLukket(msg.port, msg.gen);
    releaseSession(msg.port, msg.gen);
    return;
  }

  // 1.31 (#58): popuppen viser installationens id og betegnelse og kan omdoebe den.
  if (msg.type === 'bmcp_identitet') {
    installationsIdentitet()
      .then(({ instans, profil }) => sendResponse({ ok: true, instance: instans, profile: profil }))
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }
  if (msg.type === 'bmcp_saet_profil') {
    saetProfil(msg.profile)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }

  if (msg.type === 'reconnect') {
    // FEJL RETTET 19/8: der var ingen fangst her. Lykkedes closeDocument()
    // men fejlede ensureOffscreen() — fx fordi dokumentet stadig var ved at
    // lukke — blev afvisningen slugt, og extensionen stod tilbage UDEN
    // offscreen-dokument. Ingen WebSocket, ingen genopretning, og kun en
    // manuel genindlaesning kunne redde den.
    // 26/9: luk og byg gaar gennem koeen (genbygOffscreen) - se ensureOffscreen.
    (async () => {
      // Fejler det, tager hjerteslags-alarmen den inden for et minut - men kun fordi vi
      // IKKE lader fejlen forsvinde.
      try {
        await genbygOffscreen();
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
    broensPorte = new Set((msg.ports || []).map(Number));   // R141: synkront, foer lagret skrives
    chrome.storage.local.set({
      mcpConnected: msg.connected,
      mcpCount: count,
      mcpPorts: msg.ports || [],
    });
    return;
  }
});

// ── ask_user: the wait lives in the background, not in the page ────────────
//
// MEASURED 2026-10-08: the prompt used to be a Promise inside the page. "Please log in, then
// click Done" is the common case - and submitting the login form navigates the page. The
// prompt vanished with the old document, executeScript rejected, and the agent got an error
// for the very step it had asked the user to do. Now the page only draws the prompt and
// messages the answer back; the background owns the wait and redraws the prompt on every new
// document in the tab until it is answered, skipped, timed out or the tab is closed.
const pendingAsks = new Map(); // askId -> { tabId, spec, finish }
let lastAskPosition = null;    // where the user last dragged the floating card

// Runs in the page's ISOLATED world. It is serialized by executeScript, so it must not use
// anything from the service worker's scope.
function renderAskPrompt(spec, replay) {
  // R51 (Astra): en tegning, der allerede var planlagt, kunne lande paa et dokument fra et andet origin. En prompt med
  // felter tegnes kun paa det origin, den blev stillet paa.
  if (spec.origin) {
    const her = location.protocol === 'file:' ? 'file://' + location.host + location.pathname
      : (/^https?:$/.test(location.protocol) ? new URL(location.href).origin : null);
    if (her !== spec.origin) return;
  }
  // R48 (Astra og Opus, MAALT): siden kunne saette data-closed og saa fjerne prompten, saa den aldrig kom igen, og
  // en falsk vaert med samme data-ask-id fik en gentegning til at springe over. Hvilke prompter vi har tegnet, og om
  // de er lukket, staar nu i udvidelsens egen (ISOLATED) verden, som siden ikke kan se - ikke i DOM'en.
  const reg = (globalThis.__a360Asks ||= new Map());
  const prior = reg.get(spec.askId);
  if (prior && prior.host.isConnected) return;
  for (const [id, other] of reg) if (id !== spec.askId) other.close();
  const send = (msg) => chrome.runtime.sendMessage({ ...msg, askId: spec.askId }).catch(() => {});
  // Sidens egen frist (R48, Opus: efter et workerstop stod en foraeldreloes prompt tilbage efter fristen).
  if (Number.isFinite(spec.deadline) && spec.deadline <= Date.now()) return;

  // Notification sound — short pleasant chime. Not again when the prompt is redrawn after a
  // navigation: the user is already looking at it.
  if (!replay) {
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
  }

  // The prompt lives in a CLOSED shadow root on a host element. The page's own
  // scripts get no reference into it, so they cannot read the field values or press the
  // buttons, and the page's CSS cannot restyle it. It is NOT keyboard isolation: keydown and
  // input events still pass the page's capture listeners on window and document, also in a
  // password field (measured in Chrome 154, R48), so the page can see what is typed. A secret
  // that does not belong to this page must not be asked for here.
  const host = document.createElement('div');
  host.id = 'a360-overlay';
  host.dataset.askId = spec.askId;
  host.style.cssText = 'all:initial';
  const root = host.attachShadow({ mode: 'closed' });
  // Keystrokes in the prompt would still bubble out of the shadow root to the
  // page's document listeners. Stop them at the host.
  for (const type of ['keydown', 'keyup', 'keypress', 'input', 'beforeinput']) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }
  const style = document.createElement('style');
  style.textContent = `
    @keyframes a360-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes a360-slide-up { from { opacity: 0; transform: translateY(30px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
  `;
  root.appendChild(style);

  const card = document.createElement('div');
  const anim = replay ? '' : 'animation:a360-slide-up 0.4s ease-out;';
  if (spec.hasFields) {
    // Asking for values: a modal is right, the answer goes to the agent, not the page.
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif;' + (replay ? '' : 'animation:a360-fade-in 0.3s ease-out');
    card.style.cssText = 'background:#1e293b;border-radius:12px;padding:24px;max-width:420px;width:90%;color:#e2e8f0;box-shadow:0 20px 60px rgba(0,0,0,0.5);' + anim;
    overlay.appendChild(card);
    root.appendChild(overlay);
  } else {
    // Asking the user to act ON the page (log in, solve a CAPTCHA): a full-screen modal
    // covered the very form they had to fill in. A small card bottom-left instead - not
    // bottom-right, where OS notifications appear - that can be dragged out of the way.
    card.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;box-sizing:border-box;width:320px;max-width:calc(100vw - 32px);background:#1e293b;border-radius:12px;padding:16px;color:#e2e8f0;box-shadow:0 12px 40px rgba(0,0,0,0.45);font-family:-apple-system,BlinkMacSystemFont,sans-serif;' + anim;
    root.appendChild(card);
  }

  const h = document.createElement('div');
  h.style.cssText = 'font-size:14px;font-weight:600;color:#3b82f6;margin-bottom:4px';
  const title = spec.title;
  h.textContent = title || 'Agent360 - Action Required';
  card.appendChild(h);
  const badge = document.createElement('div');
  badge.style.cssText = 'font-size:10px;color:#94a3b8;margin-bottom:12px';
  badge.textContent = spec.sessionLabel;
  card.appendChild(badge);
  const msg = document.createElement('div');
  msg.style.cssText = 'font-size:13px;color:#cbd5e1;margin-bottom:16px;line-height:1.5';
  msg.textContent = spec.message;
  card.appendChild(msg);
  const inputs = {};
  if (spec.hasFields) {
    spec.fields.forEach(f => {
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
  doneBtn.textContent = spec.hasFields ? 'Submit' : '✓ Done';
  doneBtn.style.cssText = 'flex:1;padding:10px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500';
  let closed = false;
  let observer = null;
  const close = () => {
    closed = true;
    if (observer) observer.disconnect();
    host.remove();
    reg.delete(spec.askId);
  };
  reg.set(spec.askId, { host, close });
  const answer = (action) => {
    if (closed) return;
    const values = {};
    if (action === 'done') Object.entries(inputs).forEach(([k, el]) => values[k] = el.value);
    close();
    send({ type: 'ask_user_answer', action, values });
  };
  // Only a real click or keypress counts. A synthetic event dispatched by the
  // page (isTrusted false) must never answer on the user's behalf.
  doneBtn.addEventListener('click', (e) => { if (e.isTrusted) answer('done'); });
  const skipBtn = document.createElement('button');
  skipBtn.textContent = '✗ Skip';
  skipBtn.style.cssText = 'flex:1;padding:10px;background:#334155;color:#94a3b8;border:none;border-radius:6px;font-size:13px;cursor:pointer';
  skipBtn.addEventListener('click', (e) => { if (e.isTrusted) answer('skip'); });
  btnRow.appendChild(doneBtn);
  btnRow.appendChild(skipBtn);
  card.appendChild(btnRow);
  card.addEventListener('keydown', (e) => { if (e.isTrusted && e.key === 'Enter') answer('done'); });
  (document.body || document.documentElement).appendChild(host);
  // MEASURED 2026-10-08: Chrome's JSON viewer rebuilds <body> by script after
  // DOMContentLoaded, and the prompt went with it - the form had posted to a JSON endpoint.
  // Pages that re-render their whole body do the same. Put the prompt back until it is
  // answered or the background erases it - but at most 20 times within 2 s. R48 (Opus, MAALT): a
  // page that removes the prompt every time it comes back made the two observers chase each
  // other, 633,333 removals in 2 s with the tab frozen. R51 (Opus, MAALT): a cap over the whole
  // life of the prompt also stopped a page that only rewrites its body every 300 ms. After the
  // 21st put-back within 2 s the prompt stays gone, and the background is told.
  let reinserts = [];
  observer = new MutationObserver(() => {
    if (closed || host.isConnected) return;
    const nu = Date.now();
    reinserts = reinserts.filter((t) => nu - t < 2000);
    reinserts.push(nu);
    if (reinserts.length > 20) {
      close();
      send({ type: 'ask_user_lost' });
      return;
    }
    (document.body || document.documentElement).appendChild(host);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (Number.isFinite(spec.deadline)) setTimeout(close, Math.max(0, spec.deadline - Date.now()));

  if (!spec.hasFields) {
    // The whole card drags, except its buttons and inputs. A grip bar on top, a grab
    // cursor and a highlighted border say so. The position is kept in the viewport and sent
    // to the background, so the card comes back where the user put it after a navigation.
    const place = (x, y) => {
      const maxX = Math.max(0, window.innerWidth - card.offsetWidth);
      const maxY = Math.max(0, window.innerHeight - card.offsetHeight);
      card.style.left = Math.min(Math.max(0, x), maxX) + 'px';
      card.style.top = Math.min(Math.max(0, y), maxY) + 'px';
      card.style.bottom = 'auto';
    };
    const grip = document.createElement('div');
    grip.title = 'Drag to move';
    grip.style.cssText = 'width:40px;height:5px;border-radius:3px;background:#475569;margin:-6px auto 10px';
    card.prepend(grip);
    card.style.border = '1px solid #334155';
    card.style.cursor = 'grab';
    card.style.userSelect = 'none';
    for (const b of [doneBtn, skipBtn]) b.style.cursor = 'pointer';
    const hot = (on) => {
      card.style.borderColor = on ? '#3b82f6' : '#334155';
      grip.style.background = on ? '#3b82f6' : '#475569';
    };
    card.addEventListener('pointerenter', () => hot(true));
    card.addEventListener('pointerleave', () => { if (!drag) hot(false); });
    if (spec.position) place(spec.position.left, spec.position.top);
    let drag = null;
    card.addEventListener('pointerdown', (e) => {
      if (!e.isTrusted || e.button !== 0) return;
      if (e.composedPath().some((el) => el instanceof HTMLButtonElement || el instanceof HTMLInputElement)) return;
      const r = card.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      card.setPointerCapture(e.pointerId);
      card.style.cursor = 'grabbing';
      e.preventDefault();
    });
    card.addEventListener('pointermove', (e) => { if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy); });
    const drop = () => {
      if (!drag) return;
      drag = null;
      card.style.cursor = 'grab';
      if (!card.matches(':hover')) hot(false);
      const r = card.getBoundingClientRect();
      send({ type: 'ask_user_moved', left: Math.round(r.left), top: Math.round(r.top) });
    };
    card.addEventListener('pointerup', drop);
    card.addEventListener('pointercancel', drop);
  }

  const firstInput = Object.values(inputs)[0];
  if (firstInput) setTimeout(() => firstInput.focus(), 100);
}

function drawAskPrompt(ask, replay) {
  return chrome.scripting.executeScript({
    target: { tabId: ask.tabId },
    func: renderAskPrompt,
    args: [{ ...ask.spec, position: lastAskPosition }, Boolean(replay)],
    world: 'ISOLATED',
  });
}

function eraseAskPrompt(tabId, askId) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: (id) => {
      const reg = globalThis.__a360Asks;
      const ask = reg && reg.get(id);
      if (ask) ask.close();
    },
    args: [askId],
    world: 'ISOLATED',
  }).catch(() => {});
}

// A new document in the tab (the login form submitted, a redirect) wiped the prompt with
// the old one. Draw it again - as soon as the DOM is there, and once more when the page has
// loaded, in case a script replaced the document in between. A prompt already on the page
// is left alone, so the second draw is a no-op when the first one held.
// R48 (Opus, MAALT ende-til-ende): en prompt med felter blev tegnet igen paa et FREMMED origin efter en navigation;
// dets capture-lyttere fik koden, og svaret derfra blev godtaget som svar til den foerste side. En prompt med felter
// hoerer nu til sit origin: skifter fanen origin, slutter kaldet med action 'navigated'. En prompt uden felter
// foelger med, for et SSO-login skifter netop origin.
// Kun et http(s)-origin kan baere en binding. R51 (Astra, MAALT): en tom tab.url gav origin null, og saa slog
// begge kontroller fra, fordi de begyndte med `if (ask.origin && ...)` - et svar fra et fremmed origin blev godtaget.
// R51 (Opus, MAALT i Chrome): bindingen sammenligner ADRESSENS origin, ikke dokumentets. En side med CSP
// `sandbox` (fx raw.githubusercontent.com) har et opakt origin, og Chrome saetter sender.origin til "null" - svaret
// blev tabt, og agenten fik timeout, selvom brugeren havde svaret. En lokal fil faar sin egen binding, "file://".
// R52 (Astra, MAALT): en faelles binding "file://" lod en prompt med felter foelge med fra én lokal fil til en hvilken
// som helst anden. En lokal fil binder nu til sin egen adresse (vaert og sti, uden ? og #).
function askOrigin(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return 'file://' + u.host + u.pathname;
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch { return null; }
}

function redrawAskPrompts({ tabId, frameId, url }) {
  if (frameId !== 0) return;
  for (const ask of [...pendingAsks.values()]) {
    if (ask.tabId !== tabId) continue;
    if (ask.spec.hasFields && askOrigin(url) !== ask.origin) {
      ask.finish({ acknowledged: false, action: 'navigated', values: {} });
      continue;
    }
    drawAskPrompt(ask, true).catch(() => {});
  }
}
chrome.webNavigation.onDOMContentLoaded.addListener(redrawAskPrompts);
chrome.webNavigation.onCompleted.addListener(redrawAskPrompts);

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const ask of [...pendingAsks.values()]) {
    if (ask.tabId === tabId) ask.finish({ acknowledged: false, action: 'tab_closed', values: {} });
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'ask_user_answer' && msg?.type !== 'ask_user_moved' && msg?.type !== 'ask_user_lost') return;
  const ask = pendingAsks.get(msg.askId);
  // Only the prompt we drew, in the tab we drew it in - and for a prompt with fields, on the
  // origin it was asked on - can answer it.
  if (!ask || sender.id !== chrome.runtime.id || sender.tab?.id !== ask.tabId) return;
  if (ask.spec.hasFields && (!ask.origin || askOrigin(sender.url) !== ask.origin)) return;
  if (msg.type === 'ask_user_lost') {
    ask.finish({ acknowledged: false, action: 'removed_by_page', values: {} });
    return;
  }
  if (msg.type === 'ask_user_moved') {
    if (Number.isFinite(msg.left) && Number.isFinite(msg.top)) lastAskPosition = { left: msg.left, top: msg.top };
    return;
  }
  const values = {};
  if (msg.action === 'done') {
    for (const f of ask.spec.fields) values[f.name] = String(msg.values?.[f.name] ?? '');
  }
  ask.finish({ acknowledged: true, action: msg.action === 'done' ? 'done' : 'skip', values });
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
// 1.34 (#89): `lastCreatedTabId` var den SENESTE fane i hele Chrome, uden forbindelse til agentens klik. Kom sidens fane et oejeblik
// efter klikket, fik agenten en gammel fane (med ok-lignende felter) eller «Tab no longer exists». Nu huskes nye faner pr. session
// med det input-nummer, sessionen havde, da fanen blev aabnet; get_new_tab svarer kun med en fane fra sessionens egne faner siden
// dens sidste input, venter ellers kort og siger no-new-tab-yet. Ejeren afgoeres, mens aabneren stadig staar i sin session
// (11/9, Astra R5 F9: en popup hvis aabner lukkes bagefter, er stadig sessionens).
// R184 (Opus, MAALT i selen): noeglet paa sessions-OBJEKTET, ikke porten. Porten overlever sessionen - en anden chat eller partition
// kan faa den efter en frigivelse og ville saa arve de ikke-afhentede faner, og en adoption flytter sessionen til en ny port, saa
// chatten mistede sin egen popup. Input-taelleren ligger paa sessionen af samme grund.
const nyeFaner = new Map();   // fane-id -> { session, input }
const INPUT_METODER = new Set(['click', 'click_xy', 'double_click', 'press_key', 'execute_script', 'select_option', 'select_frame', 'set_combobox']);
function erInput(metode) { return INPUT_METODER.has(metode); }
function noterInput(port) { const s = sessions.get(port); if (s) s.inputNr = (s.inputNr || 0) + 1; }
// R184 (Opus, LAEST i Chromium tab_strip_model.cc): Cmd+T og plus-knappen arver den AKTIVE fane som aabner. Er agentens fane aktiv,
// blev brugerens nye fane ellers sessionens. En side kan ikke selv aabne chrome://newtab.
const erNyFaneSide = (url) => /^(chrome|edge|brave):\/\/(newtab|new-tab-page)\b/i.test(String(url || ''));

chrome.tabs.onCreated.addListener(async (tab) => {
  let ejer = null;
  if (tab.openerTabId != null) {
    for (const [p, s] of sessions) { if (s.tabIds.has(tab.openerTabId)) { ejer = p; break; } }
  }
  if (ejer != null && !erNyFaneSide(tab.pendingUrl || tab.url)) {
    const s = sessions.get(ejer);
    nyeFaner.set(tab.id, { session: s, input: s.inputNr || 0 });
    if (nyeFaner.size > 500) nyeFaner.delete(nyeFaner.keys().next().value);
  }

  // Auto-claim OAuth popups for the session that opened them
  if (tab.pendingUrl || tab.url) {
    const url = tab.pendingUrl || tab.url;
    const isOAuth = OAUTH_DOMAINS.some(d => url.includes(d));
    if (isOAuth) {
      for (const [port, session] of sessions) {
        if (tab.openerTabId && session.tabIds.has(tab.openerTabId)) {
          await addTabToSession(port, tab.id);
          skiftAktiv(session, tab.id);
          // R173 (Opus, MAALT i modellen): skiftet til popuppen er udvidelsens eget. Lukker popuppen sig selv (et vellykket
          // login), gaar sessionen tilbage til aabneren - se onRemoved. Uden det stod agenten uden aktiv fane (no-active-tab).
          session.tilbageTil = { popup: tab.id, aabner: tab.openerTabId };
          persistSessions();
          break;
        }
      }
    }
  }
});

// 1.34 (#89): en lukket ny fane er ikke laengere et svar.
chrome.tabs.onRemoved.addListener((tabId) => { nyeFaner.delete(tabId); });

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

// R127 (Astra, model): har fokus feltet? { status: 'ja' | 'nej' | 'ukendt', tag, id }. Kun hoveddokumentets
// document.activeElement sammenlignes med feltet (feltet findes med document.querySelector, saa et felt i en shadow root
// findes slet ikke); navnet paa det element, der har fokus, foelger aabne shadow roots. En fejl er 'ukendt', ikke 'nej'.
async function fokusPaaFelt(tabId, selector) {
  const f = await evalAttached(tabId, `(() => { /* bmcpFokusPaaMaal */
    const el = document.querySelector(${JSON.stringify(selector)});
    let a = document.activeElement;
    const paaMaal = !!el && a === el;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return { paaMaal, tag: a ? a.tagName : null, id: a && a.id ? a.id : null };
  })()`).catch(() => null);
  if (!f || typeof f.paaMaal !== 'boolean') return { status: 'ukendt' };
  return { status: f.paaMaal ? 'ja' : 'nej', tag: f.tag, id: f.id };
}

// Vaerdierne i alle felter i hoveddokumentet (input, textarea, contenteditable), saa et fejlsvar kan sige, hvad der naaede at
// blive aendret - og hvor. R130 (Astra, model): felterne parres paa IDENTITET, ikke paa plads: elementerne gemmes i siden (under
// en tilfaeldig noegle) og sammenlignes med sig selv bagefter. Bytter siden om paa raekkefoelgen, er det ingen aendring.
async function feltFoer(tabId) {
  const noegle = '__bmcpFelt' + Math.random().toString(36).slice(2, 10);
  const ok = await evalAttached(tabId, `(() => { /* bmcpFeltFoer */
    window[${JSON.stringify(noegle)}] = Array.from(document.querySelectorAll('input, textarea, [contenteditable]'))
      .map((e) => ({ e: e, v: 'value' in e ? String(e.value) : String(e.textContent || '') }));
    return true;
  })()`).catch(() => false);
  return ok === true ? noegle : null;
}
async function feltAendringer(tabId, selector, noegle) {
  if (!noegle) return null;
  const r = await evalAttached(tabId, `(() => { /* bmcpFeltDiff */
    const foer = window[${JSON.stringify(noegle)}];
    if (!Array.isArray(foer)) return null;
    const maal = document.querySelector(${JSON.stringify(selector)});
    const ud = [];
    for (const x of foer) {
      const nu = 'value' in x.e ? String(x.e.value) : String(x.e.textContent || '');
      if (nu !== x.v) ud.push({ tag: x.e.tagName, id: x.e.id || null, target: x.e === maal, value_before: x.v, value: nu });
    }
    return ud;
  })()`).catch(() => null);
  return Array.isArray(r) ? r : null;
}

async function setDateMaskedTyping(tabId, selector, iso, format) {
  const formatted = isoToFormat(iso, format);
  await debuggerFocus(tabId, selector);
  await debuggerAttach(tabId);
  let noegle = null;
  try {
    // R126 + R127 (Astra i model, Opus i Chrome): et datofelt, hvis fokushaandtering flytter fokus til et andet felt, fik det
    // andet felts tekst slettet og datoen skrevet dér. Fokus tjekkes nu foer HVER skrivende handling (marker alt, slet,
    // indsaet); er det flyttet eller ukendt, stoppes der straks, og svaret siger hvad der naaede at blive aendret og hvor.
    noegle = await feltFoer(tabId);
    const stop = async (trin) => {
      const f = await fokusPaaFelt(tabId, selector);
      if (f.status === 'ja') return null;
      const aendret = await feltAendringer(tabId, selector, noegle);
      return { ok: false, focusMoved: f.status === 'nej', focusUnknown: f.status === 'ukendt', step: trin,
        focused: f.status === 'nej' ? { tag: f.tag, id: f.id } : null, changed: aendret };
    };
    let s;
    if ((s = await stop('select-all'))) return s;
    await markerAltAttached(tabId);
    if ((s = await stop('delete'))) return s;
    await sletMarkeretAttached(tabId);
    if ((s = await stop('typing'))) return s;
    await cdpSend(tabId, 'Input.insertText', { text: formatted });
    // Tab flytter blot fokus videre. Har siden selv flyttet fokus efter datoen (et felt, der hopper videre), sendes den ikke.
    if ((await fokusPaaFelt(tabId, selector)).status === 'ja') {
      await tastParAttached(tabId, { key: 'Tab', code: 'Tab', ...tastkodeFelter(9) }, { key: 'Tab', code: 'Tab', ...tastkodeFelter(9) });
    }
  } finally {
    if (noegle) await evalAttached(tabId, `delete window[${JSON.stringify(noegle)}]`).catch(() => {});
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

  // Naar filvaelgeren aldrig aabnede, er det ene af to: siden aabnede den slet ikke, eller
  // den aabnede som OS-dialog uden for siden. Det andet kan ingen browser-udvidelse naa - CDP
  // ser kun det der sker i fanen. Det er den ENE af vores 26 vaegge der aerligt ligger uden for
  // browseren, og derfor det ene sted en henvisning til et skrivebords-vaerktoej er sand.
  if (!opened) return { ok: false, error: 'picker-did-not-open',
    note: 'The file picker never opened in the page. Either the trigger does not open one, ' +
          'or it opened as an operating-system dialog outside the page - which no browser ' +
          'extension can reach, this one included. If you have desktop-level tools in this ' +
          'session (an OS automation MCP server such as computer-mcp), that dialog is theirs ' +
          'to drive. Otherwise ask the user to pick the file.' };

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
        await tastParAttached(tabId, { key, code: key, ...tastkodeFelter(fysiskTast(key).vk) }, { key, code: key, ...tastkodeFelter(fysiskTast(key).vk) });
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
      hint: 'The field is a plain <select>. Use browser_select_option instead - ' +
            'set_combobox is for dropdowns built from div/li with a listbox.',
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
      // FUNDET 13/9 af BAADE Astra og Fable, uafhaengigt: her stod `await debuggerClick(...)`
      // og svaret blev kastet vaek. `klikLandede()` er den faelles regel som click, click_xy
      // og select_option allerede bruger - set_combobox var det ene sted der ikke spurgte.
      // Landede klikket ikke, gik soegeteksten i det felt der HAVDE fokus, og vi ventede
      // wait_ms for saa at sige 'no-options-rendered'. En bivirkning i et fremmed felt,
      // meldt som sidens skyld. Et UVIST klik stopper os ikke - kun et maalt nej.
      const aabneKlik = await debuggerClick(tabId, inputEl.x, inputEl.y);
      if (aabneKlik && aabneKlik.landed === false && !klikLandede(aabneKlik)) {
        results.push({ value: val, ok: false, error: 'click-did-not-open-list',
          note: 'The click meant to open the dropdown never reached the page, so the list cannot ' +
                'appear. Something may be covering the field (cookie banner, overlay), or the tab ' +
                'is in the background, where Chrome does not deliver mouse input. Call browser_dismiss_overlays ' +
                'or browser_switch_tab and try again.' });
        continue;
      }
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

      // FUNDET 13/9 af Astra: naar listen ikke kom, svarede vi 'no-options-rendered' - som
      // peger paa siden. Men vejen hertil gaar gennem to CDP-kommandoer der KVITTERER uden
      // at love levering (klikket der aabner feltet, og selve skrivningen). Landede de ikke,
      // er det ikke siden der mangler muligheder.
      //
      // Vi kan ikke maale klikket uden at bygge et bevis til. Feltet KAN vi laese. Og kun paa
      // et rigtigt inputfelt: peger vaelgeren paa en indpakning, er en tom textContent intet
      // bevis, saa den sag forbliver unknown og gaar den lange vej som foer.
      const efterSkrift = await debuggerEval(tabId, `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el || !('value' in el)) return null;
        return el.value;
      })()`).catch(() => null);
      if (efterSkrift === '') {
        results.push({ value: val, ok: false, error: 'search-text-not-delivered', query,
          note: 'The field was empty after the search text was sent, so it never arrived. ' +
                'The page is not missing options - it was never asked. The tab may be in the ' +
                'background, where Chrome does not deliver mouse or keyboard input. Call browser_switch_tab ' +
                'and try again.' });
        continue;
      }

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

    const FIL = 'input[type="file"]';
    const candidates = [];
    // R93 (Astra, maalt med sideudtrykket): et filfelt valgt direkte (#target) blev sprunget over, og soeskendet #other fik
    // filen. R94 (Astra, maalt i model): ogsaa ét felt i en faelles forælder (<div><input id=avatar><button id=add>) fik
    // filen, uden at knappen blev klikket - et felt i naerheden beviser ikke, at det er knappens. Nu kun feltet selv eller et
    // felt INDE i maalet; ellers klikkes maalet, og den filvaelger, det selv aabner, afgoer feltet (strategi 2) - ogsaa naar
    // knappen blot kalder .click() paa et skjult felt ved siden af.
    if (target.matches && target.matches(FIL)) candidates.push(target);
    if (candidates.length === 0) candidates.push(...target.querySelectorAll(FIL));
    // #67 (arasmileska, MAALT 13/10 i headless Chrome): her stod en sidste udvej - ethvert filfelt paa siden. Med en
    // «Add photo»-knap, der laver sit eget felt ved klik, fik et ANDET felt paa siden filen, og svaret var ok:true. Saa
    // filvaelger-vejen (strategi 2), som knappen selv aabner, proeves nu i stedet.
    if (candidates.length === 0) return JSON.stringify({ found: false });

    // Tag the first viable input with a unique data-attribute so we can re-query reliably
    const tag = '__bmcp_drop_target_' + Math.random().toString(36).slice(2, 10);
    candidates[0].setAttribute('data-bmcp-drop-tag', tag);
    return JSON.stringify({ found: true, tag, accept: candidates[0].accept || '', multiple: !!candidates[0].multiple,
      input: (${filFeltNavn.toString()})(candidates[0]) });
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
        await debuggerEval(tabId, `(${armerFilSkiftISiden.toString()})(document.querySelector(${JSON.stringify(taggedSel)}), ${JSON.stringify(inputInfo.tag)})`).catch(() => {});
        await cdpSend(tabId, 'DOM.setFileInputFiles', {
          nodeId: queryResult.nodeId,
          files: fileList,
        });
        // Laeses HER, mens maerket stadig sidder - `finally` nedenfor fjerner det.
        const vedhaeftet = await laesVedhaeftedeFiler(tabId, taggedSel);
        const skift = await debuggerEval(tabId, `(${laesFilSkiftISiden.toString()})(${JSON.stringify(inputInfo.tag)})`)
          .then((j) => (j ? JSON.parse(j) : null)).catch(() => null);
        result = fildSvar(vedhaeftet, fileList,
          { method: 'hidden-input', files: fileList, accept: inputInfo.accept, input: inputInfo.input }, skift);
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
      const filAdgang = await filAdgangsSvar(caughtError);
      if (filAdgang) return { ok: false, method: 'hidden-input', ...filAdgang };
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

  // #67: filfelterne andre steder paa siden naevnes, men faar ikke filen - kun agenten kan vide, om et af dem er det rigtige.
  const andre = await debuggerEval(tabId, `JSON.stringify([...document.querySelectorAll('input[type="file"]')].slice(0, 10).map(${filFeltNavn.toString()}))`)
    .then((j) => JSON.parse(j || '[]')).catch(() => []);
  return {
    ok: false,
    error: 'no-file-input-found',
    hint: 'No <input type="file"> at the target, and clicking the target opened no file chooser. The trigger element may not open a file dialog at all — check the selector.' +
      (andre.length ? ' The page has other file inputs, listed in other_file_inputs. None of them got the file, because nothing ties them to this target. If one is the right field, pass its `selector` - a CSS selector that matched that field alone when the tool looked, or null when none did.' : ''),
    ...(andre.length ? { other_file_inputs: andre } : {}),
  };
}

// Et filfelt beskrevet, saa agenten kan se HVILKET felt der fik filen (#67). `selector` er en gyldig CSS-selector, der
// rammer netop dette felt (id, name, eller en sti af :nth-of-type fra naermeste forfader med id) - ellers null, fx for et
// felt uden for dokumentet. `description` siger altid hvor det er. R93 (Astra og Opus, maalt): beskrivelsen blev sendt som
// selector («Uncaught»), og de skjulte felter paa X og Facebook har typisk hverken id eller name. Selvstaendig.
function filFeltNavn(i) {
  const alle = [...document.querySelectorAll('input[type="file"]')];
  const nr = alle.indexOf(i);
  const hvor = nr >= 0 ? 'file input ' + (nr + 1) + ' of ' + alle.length + ' on the page'
    : 'a file input the page\'s document does not list (outside the document, or inside a shadow root)';
  const rammer = (sel) => { try { const m = document.querySelectorAll(sel); return m.length === 1 && m[0] === i; } catch (e) { return false; } };
  let selector = null;
  if (nr >= 0) {
    const kandidater = [];
    if (i.id) kandidater.push('#' + CSS.escape(i.id));
    if (i.name) kandidater.push('input[type="file"][name="' + CSS.escape(String(i.name)) + '"]');
    // Stien fra naermeste forfader med id, og - hvis det id ikke er entydigt (R94, Opus) - hele stien fra <html>.
    const sti = (medId) => {
      const dele = [];
      for (let n = i; n && n.nodeType === 1; n = n.parentElement) {
        if (medId && n !== i && n.id) { dele.unshift('#' + CSS.escape(n.id)); break; }
        let k = 1;
        for (let b = n.previousElementSibling; b; b = b.previousElementSibling) if (b.tagName === n.tagName) k++;
        dele.unshift(n.tagName.toLowerCase() + ':nth-of-type(' + k + ')');
      }
      return dele.join(' > ');
    };
    kandidater.push(sti(true), sti(false));
    selector = kandidater.find(rammer) || null;
  }
  return { selector, description: hvor + (i.id ? ', id "' + i.id + '"' : '') + (i.name ? ', name "' + i.name + '"' : '') };
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
          finish({ ok: false, error: 'file-chooser-without-node', detail: 'Chrome fired fileChooserOpened but supplied no backendNodeId.', note: 'The dialog exists, but not as an element in the page, so it cannot be filled from here. If you have desktop-level tools in this session (an OS automation MCP server such as computer-mcp), that dialog is theirs to drive.' });
          return;
        }
        // #67: ogsaa her afgoer feltet svaret, ikke kvitteringen - og en side, der laeser filen og rydder feltet, ses.
        // Feltet er tit skabt af knappen og ligger uden for dokumentet, saa det naas gennem sin node, ikke en selector.
        // Funktionerne sendes som kildetekst i selve kaldet (ingen eval i siden, saa en streng CSP stopper det ikke).
        const iFeltet = async (kilde, noegle) => {
          const { object } = await cdpSend(tabId, 'DOM.resolveNode', { backendNodeId });
          const r = await cdpSend(tabId, 'Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
            functionDeclaration: `function (key) { return (${kilde})(this, key); }`, arguments: [{ value: noegle }] });
          return r?.result?.value;
        };
        const LAES_FELTET = `(el, key) => JSON.stringify({ antal: el.files ? el.files.length : 0,
          navne: el.files ? [...el.files].map((f) => f.name) : [], input: (${filFeltNavn.toString()})(el),
          skift: JSON.parse((${laesFilSkiftISiden.toString()})(key) || 'null') })`;
        const noegle = '__bmcp_valg_' + Math.random().toString(36).slice(2, 10);
        const armeret = iFeltet(armerFilSkiftISiden.toString(), noegle).catch(() => false);
        armeret.then(() => cdpSend(tabId, 'DOM.setFileInputFiles', { backendNodeId, files: fileList }))
          .then(async () => {
            const laest = await iFeltet(LAES_FELTET, noegle).then((j) => JSON.parse(j)).catch(() => null);
            finish(fildSvar(laest && { antal: laest.antal, navne: laest.navne }, fileList,
              { method: 'native-chooser-intercepted', files: fileList, mode: eventParams.mode, ...(laest ? { input: laest.input } : {}) },
              laest && laest.skift));
          })
          .catch(async e => {
            const m = e?.message || String(e);
            const filAdgang = await filAdgangsSvar(m);
            finish(filAdgang ? { ok: false, method: 'native-chooser-intercepted', ...filAdgang } : { ok: false, error: 'setFileInputFiles-failed', detail: m });
          });
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

// ── Agentens JavaScript: KUN gennem chrome.debugger (1.31.0) ─────────────────────────────────────────────────────────────
// Chrome Web Stores MV3-regler: kode, der ikke ligger i pakken, maa kun koeres gennem et API, der er lavet til det (Debugger
// API eller User Scripts API), og «exemptions apply solely to the specific section of code covered by these APIs». Til og med
// 1.30.3 gik browser_execute_script foerst gennem chrome.scripting og en streng kompileret i ISOLATED og MAIN, og
// browser_select_frame kun den vej (R129b, Astra og Opus uafhaengigt). Nu gaar begge vaerktoejer gennem Runtime.evaluate i
// sidens eller framens standardkontekst: koden ser sidens egne globale variabler som i MAIN, og sidens CSP stopper den ikke.
// Ingen streng kompileres i udvidelsen selv (test/agentkode-debugger.test.mjs holder det fast).
const FRAME_TEKST_UDTRYK = 'document.body.innerText.slice(0, 5000)';
const AGENTKODE_KASTEDE = 'The code threw an error (or did not compile). It is not run again automatically: anything it did before the error has already happened.';

// Fejlen fra Runtime.evaluate (exceptionDetails) som besked og navn - samme form som en fanget Error: «boom», «TypeError».
function agentKodeFejl(ex) {
  const e = (ex && ex.exception) || {};
  const navn = e.className || undefined;
  if (typeof e.description === 'string' && e.description) {
    let besked = e.description.split('\n')[0];
    if (navn && besked.startsWith(navn + ': ')) besked = besked.slice(navn.length + 2);
    return { besked, navn };
  }
  if ('value' in e) return { besked: String(e.value), navn };   // throw 'tekst' eller et tal
  return { besked: (ex && ex.text) || 'Script exception', navn };
}

// R137: serveren venter selv 15 s laengere end dette budget paa de to vaerktoejer (KALD_FRIST_MS + AGENTKODE_MARGEN_MS i
// mcp-server/index.js): maalt 19/10 naaede svaret ved budgettet ikke serveren inden 30 s, naar en side navigerede 50-200
// gange i sekundet. Faar serveren alligevel intet svar, svarer den selv no-answer med sent:'unknown'.
// Hele vaerktoejskaldet har serverens standardbudget (SERVER_FRIST_MS minus svarets hjemrejse), regnet fra udvidelsen MODTOG kaldet
// (onMessage, foer sessionsgendannelse og adoption). R132/R133 (Astra): fristen gaelder forarbejdet, den sidste
// afsendelseskontrol (efter tilslutningen i cdpSend) og svaret; oprydningen koerer videre efter svaret uden at holde det.
// R134 (Astra): trin-for-trin-fristerne kunne ikke holde svaret inden for budgettet - tilslutning, gentilslutning,
// sessionsgendannelse, getSessionTab og getAllFrames kan vente uden graense. Derfor ét ydre Promise.race om hele kaldet
// (onMessage, AGENTKODE_METODER): naar budgettet er brugt, svares der straks og sandt om, hvorvidt agentkoden er sendt.
// En vagt { sendt, lukket } foelger kaldet: cdpSend saetter sendt lige foer agentkoden gaar til Chrome, og racen saetter
// lukket, naar den har svaret - derefter sender cdpSend aldrig agentkoden. budget er et objekt, saa proever kan korte det.
const AGENTKODE_FRIST = { budget: SERVER_FRIST_MS - SVARETS_HJEMREJSE_MS };
const AGENTKODE_METODER = new Set(['execute_script', 'select_frame']);
function agentKodeSlut(start) { return start + AGENTKODE_FRIST.budget; }

// kontekst: {} = hovedsidens standardkontekst; { sessionId, uniqueContextId } = en bestemt frame (sessionId for en OOPIF).
// R133 (Astra): CDP's numeriske executionContextId kan genbruges paa tvaers af processer ved navigation; uniqueContextId kan
// ikke, og et forsvundet svarer «uniqueContextId not found» (maalt 19/10, Chrome 155) i stedet for at ramme en anden kontekst.
// slut: kaldets sluttid (agentKodeSlut); uden det faar koden cdpFrist's frist.
async function koerAgentKode(tabId, kode, { sessionId = null, uniqueContextId = null } = {}, slut = null, vagt = null) {
  const p = { expression: '(' + kode + '\n)', returnByValue: true, awaitPromise: true };
  if (uniqueContextId != null) p.uniqueContextId = uniqueContextId;
  // R135 (Astra): «sendt» er ét sted - vagten, som cdpSend saetter LIGE foer Runtime.evaluate gaar til Chrome (efter cdpSends
  // egen tilslutning). En lokal markering foer cdpSend sagde «MAY already have run», naar den tilslutning fejlede og intet
  // var sendt. Uden en ydre vagt faar kaldet sin egen.
  const v = vagt || { sendt: false, lukket: false };
  let raw, fejl = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await debuggerAttach(tabId);
      if (slut != null && slut - Date.now() <= 0) { fejl = 'the call had used its time before the code could be sent'; break; }
      raw = await cdpSend(tabId, 'Runtime.evaluate', p, sessionId, slut, v);
      break;
    } catch (e) {
      fejl = String(e?.message || e);
      // R132 (maalt i Opus' karrusel): forsvandt konteksten, foer Chrome slog den op, er udtrykket aldrig oversat eller
      // koert - V8 afviser kaldet ved opslaget. Saa er intet koert, og kalderen maa gerne proeve igen.
      if (/Cannot find context with specified id|uniqueContextId not found/i.test(fejl)) { v.sendt = false; break; }
      // MAALT 10/9 af Astra: faldt debuggeren af EFTER at koden var sendt, koerte en gentagelse BRUGERENS kode igen - op til
      // fire gange. Vi kan ikke se, om et vilkaarligt script muterer. Er det sendt, gentages det ikke; kun en fejl FOER
      // afsendelsen proeves igen. (Samme regel som for Runtime.evaluate i cdpSend.)
      if (v.sendt) break;
      if (e && e.ikkeSendt) break;   // tiden slap op foer afsendelsen
      if (!/detach|attach|gone|given id|not attached/i.test(fejl)) break;
    }
    await new Promise((r) => setTimeout(r, 200 + attempt * 200));
  }
  const sendt = v.sendt;
  if (raw && raw.exceptionDetails) {
    const { besked, navn } = agentKodeFejl(raw.exceptionDetails);
    return { ok: false, error: besked, ...(navn ? { name: navn } : {}), method: 'debugger', note: AGENTKODE_KASTEDE };
  }
  // FIX (2026-07-16): paa nogle sider falder debuggeren af midt i kaldet, og sendCommand svarer `undefined` i stedet for at
  // afvise. Et svar UDEN result er derfor ikke et tomt resultat. Et result af typen undefined er derimod kodens eget svar.
  if (raw && raw.result) return { result: raw.result.value, method: 'debugger' };
  if (!sendt) {
    const e = new Error('The code was not run (nothing was sent): ' + (fejl || 'the Chrome debugger could not attach to the tab'));
    e.ikkeSendt = true;
    throw e;
  }
  throw new Error('The code was sent to the page, but no answer came back (' + (fejl || 'empty debugger response: ' + JSON.stringify(raw)) +
    '). It MAY already have run. It is not repeated automatically - call again only if it is safe to run twice.');
}

// ── Hvilken debugger-frame ER udvidelsens frame? Et engangsmaerke i framens dokument (R132, Astra og Opus) ───────────────
// 866c49a parrede paa adresse og position, 5b66c97 paa placering (plads i window.frames). Begge kunne koere agentens kode i
// en SOESKENDE-frame med et normalt svar: Chromium melder OOPIF-maal i en udokumenteret raekkefoelge, og en side, der
// fjerner én frame og tilfoejer en anden mellem de to maalinger, giver en anden frame samme plads (Opus' karrusel, maalt i
// Chrome: 4-31 af 40 forkerte ved 26-261 udskiftninger i sekundet). Placering er ikke identitet.
// Nu er beviset et tilfaeldigt engangsmaerke:
//   1. udvidelsen saetter maerket i udvidelsens ISOLATED-verden i netop den valgte frame (chrome.scripting, frameIds) -
//      Chrome selv vaelger dokumentet ud fra udvidelsens frameId;
//   2. debuggeren ser udvidelsens egen isolerede verden i hver frame (Runtime.executionContextCreated, type isolated, origin
//      chrome-extension://<vores id>; maalt 19/10 i Chrome 155, ogsaa i OOPIF og i lukkede shadow roots) og spoerger hver af
//      dem, om den har maerket (callFunctionOn med maerket som ARGUMENT - ingen streng bygges);
//   3. kun den kontekst, der har maerket, er det dokument; agentens kode koerer i samme frames standardkontekst (isDefault)
//      fra samme melding. Maerket fjernes bagefter.
// Siden kan hverken se eller saette maerket: det ligger i udvidelsens isolerede verden, ikke i DOM'en.
// handling 0 = saet, 1 = har framen maerket?, 2 = fjern.
function frameMaerke(handling, maerke) {
  const m = globalThis.__bmcpFrameMaerker || (globalThis.__bmcpFrameMaerker = new Set());
  // R134 (Opus): adressen paa det dokument, maerket blev sat i - framen kan have navigeret siden getAllFrames.
  if (handling === 0) { m.add(maerke); return String(location.href); }
  if (handling === 2) { m.delete(maerke); return true; }
  return m.has(maerke);
}

function nytFrameMaerke() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// Fejl ved framevalget. varig = et nyt forsoeg giver samme svar (agenten skal ikke gaa i ring); ellers kan det hjaelpe.
function frameFejl(besked, varig) {
  const e = new Error(besked);
  e.varig = varig;
  return e;
}

// Et loefte, der hoeist maa vente til sluttiden; derefter en forbigaaende fejl (intet er sendt endnu i opslaget).
function inden(loefte, slut, hvad) {
  if (slut == null) return loefte;
  const rest = slut - Date.now();
  if (rest <= 0) return Promise.reject(frameFejl(`the call ran out of time while ${hvad}`, false));
  let ur;
  return Promise.race([loefte, new Promise((_, afvis) => { ur = setTimeout(() => afvis(frameFejl(`the call ran out of time while ${hvad}`, false)), rest); })])
    .finally(() => clearTimeout(ur));
}

async function maerkFramen(tabId, frameId, maerke, handling, slut = null) {
  try {
    const [r] = await inden(chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: 'ISOLATED', func: frameMaerke, args: [handling, maerke] }),
      slut, 'marking the frame');
    if (!r || (handling === 0 ? typeof r.result !== 'string' : r.result !== true)) throw new Error('no answer from the frame');
    return r.result;
  } catch (e) {
    if (e && e.varig !== undefined) throw e;
    const m = String(e?.message || e);
    // «Cannot access contents of ...»: udvidelsen maa ikke koere i den frame (fx en anden udvidelses side) - varigt.
    throw frameFejl(`the extension could not mark the frame (${m})`, /cannot access|permission/i.test(m));
  }
}

// Alle kontekster i en session, som Runtime.enable melder dem. Runtime.enable melder kun de eksisterende kontekster, naar
// domaenet ikke allerede er slaaet til (maalt 19/10), saa det slaas fra foerst og fra igen bagefter; en kontekst kan stadig
// bruges efter Runtime.disable (maalt 19/10). chrome.debugger lover ikke, at haendelserne kommer foer svaret, saa der ventes,
// til der ikke kommer flere. executionContextsCleared (R133, Astra) toemmer listen: alle kendte kontekster er vaek.
async function konteksterISession(tabId, sid, slut = null) {
  const ctx = new Map();
  const lyt = (kilde, metode, ep) => {
    if (kilde.tabId !== tabId || (kilde.sessionId || null) !== sid) return;
    if (metode === 'Runtime.executionContextCreated' && ep && ep.context) ctx.set(ep.context.id, ep.context);
    if (metode === 'Runtime.executionContextDestroyed' && ep) ctx.delete(ep.executionContextId);
    if (metode === 'Runtime.executionContextsCleared') ctx.clear();
  };
  chrome.debugger.onEvent.addListener(lyt);
  try {
    await cdpSend(tabId, 'Runtime.disable', {}, sid, slut).catch(() => {});
    await cdpSend(tabId, 'Runtime.enable', {}, sid, slut);
    let foer = -1;
    for (let i = 0; i < 10 && ctx.size !== foer && (slut == null || Date.now() + 50 < slut); i++) {
      foer = ctx.size;
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    chrome.debugger.onEvent.removeListener(lyt);
    // Oprydning: ikke bundet af kaldets sluttid (intet agentarbejde), og den holder ikke svaret, hvis den haenger.
    cdpSend(tabId, 'Runtime.disable', {}, sid).catch(() => {});
  }
  return [...ctx.values()];
}

// Frames fra andre domaener (OOPIF) er egne maal i debuggeren. Target.setAutoAttach med flatten:true (Chrome 125+)
// tilslutter dem som sessioner under fanens tilslutning og melder dem med Target.attachedToTarget - ogsaa inde i hinanden.
// Auto-attach slaas foerst fra: staar det allerede til, melder Chrome ikke de tilsluttede igen (maalt 19/10).
// Ét niveau ad gangen, alle sessioner paa niveauet samtidig (R133, Opus G: 45 fremmede frames tog 2,5-2,8 s, og et loft paa 40
// sessioner lod frames i de fremmede frames' egne fremmede boern ude). R134 (Astra): et loft paa 500 gav en falsk permanent
// fejl - det er fjernet; kun kaldets tid begraenser soegningen, og en soegning, der ikke blev faerdig, er forbigaaende.
async function tilknytFremmedeFrames(tabId, slut = null) {
  const alle = [];
  let niveau = [null];
  await cdpSend(tabId, 'Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }, null, slut).catch(() => {});
  while (niveau.length) {
    const nye = [];
    const fra = new Set(niveau);
    const lyt = (kilde, metode, ep) => {
      if (kilde.tabId !== tabId || !fra.has(kilde.sessionId || null) || metode !== 'Target.attachedToTarget') return;
      if (ep && ep.sessionId && ep.targetInfo && ep.targetInfo.type === 'iframe') nye.push(ep.sessionId);
    };
    chrome.debugger.onEvent.addListener(lyt);
    try {
      await Promise.all(niveau.map((sid) => cdpSend(tabId, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid, slut).catch(() => {})));
      await inden(new Promise((r) => setTimeout(r, 100)), slut, 'attaching frames from other sites');   // haendelserne naar udvidelsen hver for sig
    } finally {
      chrome.debugger.onEvent.removeListener(lyt);
    }
    alle.push(...nye);
    niveau = nye;
  }
  return alle;
}

// Kontekster i sessionen, hvis udvidelses-verden har maerket -> [{ sid, standard }]. Opslag og koersel bruger uniqueId.
async function findMaerket(tabId, sid, maerke, slut = null) {
  const egen = 'chrome-extension://' + chrome.runtime.id;
  const ctxs = await konteksterISession(tabId, sid, slut);
  const fund = [];
  for (const c of ctxs) {
    if (!c.auxData || c.auxData.isDefault || c.origin !== egen || !c.uniqueId) continue;
    const r = await cdpSend(tabId, 'Runtime.callFunctionOn', { functionDeclaration: frameMaerke.toString(), uniqueContextId: c.uniqueId,
      arguments: [{ value: 1 }, { value: maerke }], returnByValue: true }, sid, slut).catch((e) => { if (e && e.ikkeSendt) throw frameFejl(e.message, false); return null; });
    if (!r || !r.result || r.result.value !== true) continue;
    fund.push({ sid, standard: ctxs.find((d) => d.auxData && d.auxData.isDefault === true && d.auxData.frameId === c.auxData.frameId) || null });
  }
  return fund;
}

// Fanens igangvaerende oprydning (maerke og auto-attach) fra et tidligere kald. Et nyt kald venter kort paa den, saa et sent
// «auto-attach fra» ikke kobler det nye kalds frame-sessioner af.
const fanensOprydning = new Map();

// Udvidelsens frame (webNavigation) -> { kontekst: { sessionId, uniqueContextId }, ryd, adresse }. Alle frames, ogsaa
// hovedsiden, findes ved maerket. ryd() fjerner maerket og slaar auto-attach fra igen; den afventes ikke af svaret.
async function findFrameKontekst(tabId, frames, valgt, slut = null) {
  // R135 (Astra): ogsaa hovedsiden (frame 0) faar maerket - saa er frame_url dokumentets egen adresse, og navigerer siden
  // mellem getAllFrames og koersel, er uniqueContextId vaek, og intet koeres.
  const forrige = fanensOprydning.get(tabId);
  if (forrige) await inden(forrige, slut == null ? Date.now() + 1000 : Math.min(slut, Date.now() + 1000), 'waiting for the previous call to clean up').catch(() => {});
  try { await inden(debuggerAttach(tabId), slut, 'attaching the debugger'); } catch (e) { throw frameFejl(String(e?.message || e), false); }
  const maerke = nytFrameMaerke();
  const adresse = await maerkFramen(tabId, valgt.frameId, maerke, 0, slut);
  let tilknyttet = false;
  const ryd = () => {
    const opr = (async () => {
      await maerkFramen(tabId, valgt.frameId, maerke, 2).catch(() => {});
      if (tilknyttet) await cdpSend(tabId, 'Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
    })();
    fanensOprydning.set(tabId, opr);
    opr.finally(() => { if (fanensOprydning.get(tabId) === opr) fanensOprydning.delete(tabId); });
    return opr;
  };
  try {
    let fund = await findMaerket(tabId, null, maerke, slut);
    if (!fund.length) {
      tilknyttet = true;
      const sessioner = await tilknytFremmedeFrames(tabId, slut);
      fund = (await Promise.all(sessioner.map((sid) => findMaerket(tabId, sid, maerke, slut)))).flat();
    }
    if (fund.length > 1) throw frameFejl(`${fund.length} debugger contexts carry the frame's mark (frame ${valgt.frameId})`, false);
    if (!fund.length) throw frameFejl(`frame ${valgt.frameId} (${valgt.url}) was not found in the debugger (it may have navigated or closed)`, false);
    if (!fund[0].standard || !fund[0].standard.uniqueId) throw frameFejl(`the frame has no default execution context in the debugger (frame ${valgt.frameId})`, false);
    return { kontekst: { sessionId: fund[0].sid, uniqueContextId: fund[0].standard.uniqueId }, ryd, adresse };
  } catch (e) {
    ryd().catch(() => {});
    throw e;
  }
}

async function dispatch(port, method, params, modtaget = Date.now(), vagt = null) {
  if (erInput(method)) noterInput(port);   // 1.34 (#89): foer kaldet koerer - en fane, det aabner, er «ny» for get_new_tab
  switch (method) {
    case 'navigate': {
      const session = getSession(port);
      // R73 (Astra, maalt i model): med new_tab og eget_vindue oprettede getSessionTab() stadig en tom about:blank, foer vinduet
      // blev aabnet med adressen - to faner i sessionen. Et eget vindue bruger ikke sessionens fane, saa der hentes ingen.
      const egetVindue = !!(params.new_tab && params.eget_vindue);
      // R110/R111: loftet starter HER, foer sessionsopslaget. Opslaget afventes til ende: det kan ikke afbrydes uden at
      // efterlade arbejde, der kan sende adressen (en fane oprettes med den) eller aendre sessionen bagefter (R111 Astra 1-2,
      // Opus N1). Haenger det helt, er serverens egen frist paa 30 s graensen. Succes svares aldrig efter loftet.
      const navSlut = Date.now() + NAV_FRISTER.loft;
      let tab = null;
      if (!egetVindue) {
        try {
          tab = await getSessionTab(port, false, params.url);
        } catch (e) {
          // R113: et struktureret svar - intet er sendt, og agenten skal vide, at sessionen skiftede.
          if (e && e.sessionSkiftet) {
            return { ok: false, error: 'session-changed', sent: false, requested_url: String(params.url), detail: e.message,
              note: NAV_NOTER['session-changed'] };
          }
          if (!(e && e.ingenAktiv)) throw e;
          // 1.33 (privat rapport 3.2): uden en aktiv fane vaelges der ikke en anden. new_tab beholder alle sessionens sider og
          // aabner bare en ny - den gaar videre med tab = null.
          if (!params.new_tab) {
            return { ok: false, error: 'no-active-tab', sent: false, requested_url: String(params.url), detail: e.message,
              note: NAV_NOTER['no-active-tab'] };
          }
        }
      }
      // R111 (b): brugte opslaget fristen, og er intet sendt endnu, svares der nu - med en kendt boks, hvis der er en.
      if (tab && !tab.oprettetMedUrl && Date.now() >= navSlut - navForbehold()) {
        const kendt = !params.new_tab && dialogFaner.get(tab.id)?.boks;
        if (kendt) {
          return { ok: false, error: 'dialog-open', sent: false, tab_id: tab.id, requested_url: String(params.url),
            ...dialogFelter(kendt), pending_url: dialogFaner.get(tab.id)?.pendingUrl ?? null, note: NAV_NOTER['dialog-open'] };
        }
        return { ok: false, error: 'tab-not-responding', sent: false, requested_url: String(params.url),
          detail: 'Chrome did not report the session\'s tabs within the time limit', note: NAV_NOTER['session-langsom'] };
      }
      // R73 (Astra, maalt i model): en ny fane, hvis adresse var faerdigindlaest, mens fanen blev lagt i sessionens gruppe, naaede
      // sin eneste 'complete' foer lytteren herunder fandtes, og navigate ventede de fulde 15 sekunder. For en fane uden en
      // tidligere side (ny eller pladsholder) proeves tilstanden derfor ogsaa, saa snart lytteren er sat.
      let nyFane = !!(tab && tab.oprettetMedUrl);

      // Always reuse the active tab — navigate in place, don't create new tabs
      // Only create new tab if explicitly requested via new_tab param
      if (tab && tab.oprettetMedUrl) {
        // Sessionen havde ingen fane: getSessionTab() oprettede den med adressen, saa der er intet at skifte.
      } else if (params.new_tab) {
        // EKSPERIMENT 19/9 (vindues-hypotesen, 1.30). Hele vores fejlklasse kommer af at
        // Chrome ikke leverer Input.* til en fane der ikke er den viste i sit vindue - og
        // maalingen 19/9 viste at det er en klasse konkurrenterne IKKE har, fordi de koerer
        // deres egen browser. Faar en session sit EGET vindue, er dens fane altid den viste
        // dér, uden at stjaele brugerens fokus. Saa ville klassen forsvinde.
        //
        // Det kunne ikke maales foer: vores egen kode fokuserer vinduet naar den aktiverer
        // fanen, saa tilstanden "synlig i sit eget vindue, men ikke fokuseret" kunne ikke
        // opnaas. `chrome.windows.create({ focused: false })` er praecis den tilstand.
        // ⚠️ Tilvalg, ikke standard: om Chrome leverer input dér er PRAECIS det ubesvarede
        // spoergsmaal. Ingen adfaerd aendrer sig for nogen der ikke beder om det.
        if (params.eget_vindue) {
          // ⚠️ RETTET 9/10 (R57, Opus maalte i Chrome): fanen blev flyttet tilbage i sessionens gruppe i det FOERSTE
          // vindue (addTabToSession -> chrome.tabs.group), og navigate-svaret meldte alligevel det nye vindues id. 19/9-
          // og 21/9-maalingerne laeste netop det svar, saa tilstand B var sandsynligvis en baggrundsfane. Om et ufokuseret
          // vindue faar input i desktop-Chrome er derfor UMAALT. Den oprindelige konklusion herunder staar som historik.
          // ⛔ MAALT 19/9 og FALSIFICERET: et eget vindue UDEN fokus leverer nul taster,
          // praecis som en baggrundsfane. Det er ikke fanens synlighed i sit vindue der
          // afgoer det - det er om VINDUET har operativsystemets fokus.
          // (test/aerlighed/RESULTAT-vindueshypotesen-2026-09-19.md)
          //
          // Men det gav funktionen et bedre formaal end det den blev bygget til. Paa en
          // maskine med flere skaerme kan vinduet placeres paa en skaerm mennesket ikke
          // kigger paa OG faa fokus dér: saa leverer Chrome input, uden at noget daekker
          // det brugeren arbejder i. Det er forskellen paa "kan ikke koere uden at tage
          // skaermen" og "koerer et andet sted".
          const spec = { url: params.url, focused: !!params.fokuser };
          // ⛔ 26/9 (fuld review, maalt): en position som tekst ("-1920") blev tavst udeladt, og
          // vinduet aabnede MED fokus paa Chromes standardplads - brugerens skaerm. Tal som tekst
          // laeses nu som tal; et felt der slet ikke er et tal, afviser vinduet i stedet for at
          // lade Chrome vaelge pladsen.
          for (const [ind, ud] of [['vindue_x', 'left'], ['vindue_y', 'top'],
                                   ['vindue_bredde', 'width'], ['vindue_hoejde', 'height']]) {
            const raa = params[ind];
            if (raa == null) continue;
            const tal = typeof raa === 'string' && raa.trim() !== '' ? Number(raa) : raa;
            if (!Number.isFinite(tal)) {
              return { ok: false, error: `eget_vindue: ${ind} must be a number, got ${JSON.stringify(raa)}. `
                + 'No window was opened - without a position Chrome picks the spot, usually in front of the user.' };
            }
            spec[ud] = Math.round(tal);
          }
          const vindue = await chrome.windows.create(spec);
          tab = vindue.tabs && vindue.tabs[0];
          if (!tab) return { ok: false, error: 'eget_vindue: Chrome created a window with no tab' };
          await addTabToSession(port, tab.id, { gruppe: false });
          skiftAktiv(getSession(port), tab.id);
          persistSessions();

          // ⛔ MAALT 21/9 mod rigtig Chrome: her stod `placeret: { left: spec.left }` og
          // `fokuseret: !!params.fokuser` - altsaa det der blev BEDT om, ikke det der skete.
          // Vaerktoejet svarede fokuseret:true, og Chrome havde ikke givet vinduet fokus.
          //
          // Det er praecis den fejlklasse /learn/tools-that-lie handler om - «rapporterede de
          // tal den blev SPURGT om» - og den ramte den ene funktion der findes for at holde
          // koersler vaek fra menneskets skaerm. En koersel kunne tro den laa et andet sted.
          //
          // Vinduet laeses nu tilbage fra Chrome, og svaret siger om det landede som bedt.
          // R57 (Opus): svaret meldte vinduets id fra create(), ogsaa da fanen var flyttet til et andet vindue, og 19/9- og
          // 21/9-maalingerne laeste netop det felt. Fanens faktiske vindue laeses nu tilbage.
          const fane = await chrome.tabs.get(tab.id).catch(() => null);
          const iEgetVindue = fane?.windowId === vindue.id;
          // R61 (Astra): fokus, position og note skal komme fra det vindue fanen ER i - ikke fra det nye, hvis den er flyttet.
          let faktisk = iEgetVindue || fane?.windowId == null ? vindue : null;
          try { faktisk = await chrome.windows.get(fane?.windowId ?? vindue.id); } catch (e) { /* beholder create-svaret */ }
          const bedtOm = { left: spec.left ?? null, top: spec.top ?? null };
          const landede = {
            left: Number.isFinite(faktisk?.left) ? faktisk.left : null,
            top: Number.isFinite(faktisk?.top) ? faktisk.top : null,
          };
          const somBedt = (bedtOm.left == null || bedtOm.left === landede.left)
            && (bedtOm.top == null || bedtOm.top === landede.top);
          return { ok: true, url: params.url, tabId: tab.id, windowId: fane?.windowId ?? null,
            eget_vindue: iEgetVindue,
            // Chromes eget svar, ikke parameteret vi sendte.
            fokuseret: !!faktisk?.focused,
            placeret: bedtOm.left != null || bedtOm.top != null ? landede : null,
            placeret_som_bedt: bedtOm.left != null || bedtOm.top != null ? somBedt : null,
            bedt_om: bedtOm.left != null || bedtOm.top != null ? bedtOm : null,
            // ⛔ Advar ogsaa naar KUN fokus blev naegtet. Foer stod der intet i det tilfaelde -
            // kun den ene boolean, modsagt af prosaen ved siden af. Fundet af et modstander-review.
            advarsel: !iEgetVindue
              ? `The tab is not in its own window: Chrome put it in window ${fane?.windowId ?? 'unknown'}. `
                + 'Treat it as an ordinary session tab.'
              : (params.fokuser && !faktisk?.focused)
              ? 'Focus was refused by Chrome. Input tools may not reach this window - read landed in their '
                + 'answers, and do not assume this run is off the user\'s screen.'
              : ((bedtOm.left != null || bedtOm.top != null) && !somBedt
                ? `The window was asked for ${JSON.stringify(bedtOm)} but Chrome put it at `
                  + `${JSON.stringify(landede)}. Do not assume the run is off the user's screen.`
                : (params.fokuser && bedtOm.left == null && bedtOm.top == null
                  ? 'Focus with no position: Chrome chose where the window went, usually in front of '
                    + 'the user, and it now has their keyboard focus.'
                  : undefined)),
            // ⛔ Ogsaa prosaen skal komme fra maalingen. Foerste rettelse gjorde `fokuseret`
            // aerlig, men lod `note` staa paa `params.fokuser` - saa svaret sagde
            // «fokuseret: false» og «The window has focus» i SAMME nyttelast.
            note: faktisk?.focused
              ? 'The window has focus, so Chrome delivers input to it. Focus is exclusive: while this window ' +
                'has it, whatever the person types goes here - even on another display. Use it only on a ' +
                'machine nobody is typing on.'
              : (params.fokuser
                ? 'You asked for focus and Chrome did not give it. Whether Chrome delivers mouse and keyboard input '
                  + 'to a window without focus is unmeasured in desktop Chrome; read landed in each input tool\'s answer.'
                : 'The window has no focus. Whether Chrome delivers mouse and keyboard input to it is unmeasured in '
                  + 'desktop Chrome; read landed in each input tool\'s answer. Pass fokuser:true, and place it with vindue_x.'),
          };
        }
        // getSessionTab() above hands a fresh session its empty about:blank placeholder.
        // new_tab means "keep the current page"; an empty placeholder is not a page anyone
        // keeps. Measured 2026-10-04: navigate(new_tab) as a session's first call left that
        // about:blank in the group for the session's whole life. Use it instead.
        const isPlaceholder = tab && (tab.url === 'about:blank' ||
          (tab.url === '' && tab.pendingUrl === 'about:blank'));
        nyFane = true;
        if (isPlaceholder) {
          await chrome.tabs.update(tab.id, { url: params.url });
        } else {
          tab = await chrome.tabs.create({ url: params.url, active: false });
          await addTabToSession(port, tab.id);
        }
      } else {
        // #69 (1.30.3): en eksisterende fane gaar gennem dialog-koordinatoren - ejerskab, Page.enable-port, svar paa
        // «Leave site?» og dom fra Chromes Closed. R75/R76's regler for en 'complete' bor nu i navigerSomEjer.
        return await navigerIFanen(port, session, tab, params, navSlut);
      }

      // Wait for load. A 'complete' can be the about:blank placeholder's OWN load
      // (getSessionTab() created it a moment ago), not the URL we asked for. Measured
      // 2026-10-05: taking it made a session's first navigate answer url "about:blank", and
      // checking the url in the event's tab snapshot was not enough against real Chrome. So
      // each 'complete' is confirmed against the tab as it is NOW.
      const awaitingRealUrl = !String(params.url).startsWith('about:');
      // R111 (a): en fane, getSessionTab() oprettede MED adressen, er sendt - den bevises inden for loftet, ellers er svaret
      // navigation-unconfirmed. Andre nye faner (new_tab) venter som foer.
      const somSendt = !!(tab && tab.oprettetMedUrl);
      let bevisFane = null;   // fanen, som beviset saa den - successvaret bygger paa den, ikke paa et nyt opslag (R112)
      const loadedNow = async () => {
        const now = await chrome.tabs.get(tab.id).catch(() => null);
        // En about:-adresse: der er intet at vente paa (R74) - men fanen skal findes, og dens tilstand bruges i svaret.
        if (!awaitingRealUrl) { if (now) bevisFane = now; return somSendt ? !!now : true; }
        if (!now) return !somSendt;   // tab gone - nothing left to wait for (but nothing proven either)
        const nuUrl = String(now.url || '');
        if (now.status !== 'complete' || nuUrl.startsWith('about:blank')) return false;
        // R112 (maalt i Chrome 15/10): en adresse, der svarer 204, efterlader den oprettede fane TOM ('') og 'complete' - det
        // er intet bevis. (En download lukker fanen i headless Chrome.) En omdirigering er: i den oprettede fane ses intet
        // 'loading', foer lytteren sidder, saa fanen bevises af, at den staar 'complete' paa en rigtig adresse.
        if (somSendt && nuUrl === '') return false;
        bevisFane = now;
        return true;
      };
      const bevist = await new Promise(resolve => {
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timer);
          resolve(ok);
        };
        // (R76's regel for en eksisterende fane bor nu i navigerSomEjer; her er fanen ny eller en pladsholder.)
        const listener = (tabId, info) => {
          if (tabId !== tab.id) return;
          if (info.status !== 'complete') return;
          loadedNow().then((ok) => { if (ok) finish(true); });
        };
        chrome.tabs.onUpdated.addListener(listener);
        const timer = setTimeout(() => finish(false), somSendt ? Math.max(0, navSlut - navForbehold() - Date.now()) : 15000);
        // R74 (Astra, maalt i model): ogsaa en about:-adresse (der er intet at vente paa) proeves straks; foer ventede den paa
        // en 'complete', der kunne vaere kommet, foer lytteren fandtes.
        if (nyFane) loadedNow().then((ok) => { if (ok) finish(true); });
      });

      // Set as active tab for this session
      skiftAktiv(session, tab.id);
      persistSessions();
      // R112 (Astra 1, Opus N-a): et EKSPLICIT tjek af fristen foer succes - et bevis, der vandt over en udloebet timer (fordi
      // sessionsarbejdet brugte fristen), er stadig efter loftet.
      if (somSendt && (!bevist || Date.now() >= navSlut - navForbehold())) {
        const nu = await venteMedFrist(chrome.tabs.get(tab.id).catch(() => null), Math.max(0, navSlut - Date.now()));
        // R112 (Opus OP3): ingen dialogtilstand for en fane, der allerede er lukket.
        if (nu !== null) dialogFane(tab.id).pendingUrl = String(params.url);
        return { ok: false, error: 'navigation-unconfirmed', sent: true, may_complete_later: true, tab_id: tab.id,
          requested_url: String(params.url), pending_url: String(params.url),
          url: nu && nu !== FRIST_UDLOEB ? nu.url ?? null : null, note: NAV_NOTER['navigation-unconfirmed'] };
      }
      const updated = somSendt ? bevisFane : await chrome.tabs.get(tab.id);

      // Check for CAPTCHA after navigation (for a tab created with the address: inside the limit, like the current tab)
      const captcha = somSendt ? await venteMedFrist(detectCaptcha(tab.id), Math.max(0, navSlut - Date.now())) : await detectCaptcha(tab.id);
      const result = { ...(somSendt ? { ok: true } : {}), title: updated.title, url: updated.url, tab_id: tab.id, session: session.label };
      if (captcha === FRIST_UDLOEB) result.captcha_checked = false;
      if (captcha && captcha.found) {
        result.captcha_detected = captcha.types.join(', ');
        result.hint = `CAPTCHA detected: ${captcha.types.join(', ')}. Use browser_solve_captcha to handle it.`;
      } else if (captcha && captcha.invisible) result.captcha_invisible = captcha.invisible.join(', ');
      // 1.33 (privat rapport 5.9): en ny fane aabnes i baggrunden, og svaret sagde det ikke - som switch_tab siger synligheden.
      // (Hertil naar kun en ny fane: navigate i den aktive fane svarer fra navigerIFanen.)
      if (updated && updated.active === false) {
        result.active = false;
        result.active_note = 'The new tab opened in the background: it is not the active tab in its window. Call ' +
          'browser_switch_tab before key presses, hover, the mouse wheel or coordinate clicks; read landed in their answers.';
      }
      return result;
    }

    case 'get_page_content': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot access chrome:// pages');
      const format = params.format || 'text';
      // MAALT 17/9 mod Stripe Dashboard: `format:'html'` svarede 1.042.782 tegn, og der var
      // ingen maade at bede om mindre. Vaerktoejet var dermed ubrugeligt praecis paa de store,
      // indloggede apps hvor det er mest vaerd. To ting mangler: en vej til en DEL af siden,
      // og en oevre graense der SIGER at den skar. En tavs afkortning er samme fejlklasse som
      // resten af denne udgivelse: et svar der ser helt ud uden at vaere det.
      const vaelger = params.selector || null;
      const maxTegn = Number(params.max_chars) > 0 ? Number(params.max_chars) : 30000;
      const scriptResult = await safeExecuteScript(tab.id, (fmt, sel) => {
        const rod = sel ? document.querySelector(sel) : null;
        if (sel && !rod) return { fundet: false };
        const n = rod || document.documentElement;
        return { fundet: true, tekst: fmt === 'html' ? n.outerHTML : (rod ? rod.innerText : document.body.innerText) };
      }, [format, vaelger]);

      let raa;
      if (!scriptResult.cspBlocked) {
        if (scriptResult.result && scriptResult.result.fundet === false) {
          return { ok: false, error: 'Element not found: ' + vaelger,
            note: 'Without a match the answer would be the whole page, and you would think you read what you asked for.' };
        }
        raa = scriptResult.result ? scriptResult.result.tekst : undefined;
      } else {
        const udtryk = vaelger
          ? `(() => { const el = document.querySelector(${JSON.stringify(vaelger)}); if (!el) return null; ` +
            `return ${format === 'html' ? 'el.outerHTML' : 'el.innerText'}; })()`
          : (format === 'html' ? 'document.documentElement.outerHTML' : 'document.body.innerText');
        raa = await debuggerEval(tab.id, udtryk);
        if (vaelger && raa == null) return { ok: false, error: 'Element not found: ' + vaelger, method: 'debugger' };
      }

      const metode = scriptResult.cspBlocked ? { method: 'debugger' } : {};
      const tekst = typeof raa === 'string' ? raa : String(raa ?? '');
      if (tekst.length > maxTegn) {
        return {
          content: tekst.slice(0, maxTegn), url: tab.url, title: tab.title, ...metode,
          afkortet: true, tegn_i_alt: tekst.length,
          note: `The page is ${tekst.length} characters; here are the first ${maxTegn}. Fetch the part you need ` +
                'with `selector`, or raise `max_chars` if you really need all of it.',
        };
      }
      return { content: tekst, url: tab.url, title: tab.title, ...metode };
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

      // #11 (1.30.2 skive 9): listen blev rullet med scrollTop/scrollBy. Det udloeser `scroll`, aldrig `wheel`, saa et feed
      // der henter flere raekker paa hjulet (Threads, X) hentede intet, og reached_end blev sand ved bunden af det der
      // allerede var tegnet. Nu rulles der med rigtige hjul gennem debuggeren, naar fanen er den aktive i sit vindue - ogsaa
      // ved bunden, for det er dér et feed henter. I en baggrundsfane leverer Chrome ikke hjul (maalt 11/9), og et hjul der
      // falder paa fristen, lander senere som en ekstra rulning (maalt 19/9) - saa dér rulles der med script, og svaret siger det.
      const erAktiv = async () => { try { const f = await chrome.tabs.get(tab.id); return !!f && f.active === true; } catch { return false; } };
      const BAGGRUND = 'The tab is not the active one in its window, so the list was scrolled without wheel events (Chrome does ' +
        'not deliver them there). A feed that loads more rows on wheel may have stopped early, and reached_end then only means the ' +
        'bottom of what loaded without them: call browser_switch_tab and run again.';
      let hjul = await erAktiv();
      let note = hjul ? null : BAGGRUND;
      const metoder = new Set();

      // R62 (Opus, maalt i Chrome): en skjult side (en baggrundsfane) faar hverken scroll-events, IntersectionObserver-kald
      // eller animation frames. Script-rulningen flytter siden, men intet hentes eller tegnes - en virtualiseret liste gav 20
      // af 300 raekker med reached_end:true. Var siden skjult i en runde, kan enden ikke vaere naaet.
      const SKJULT = 'The page was hidden (a background tab or a minimized window), and a hidden page gets no scroll events, IntersectionObserver ' +
        'callbacks or animation frames. Lists that load or render rows while you scroll stop at what is already there, so ' +
        'reached_end is false. Call browser_switch_tab and run again. If its answer still says visibility: hidden, the ' +
        'window is covered or minimized and switching tabs cannot fix it: ask the user (browser_ask_user), and only then ' +
        'call browser_switch_tab with bring_to_front: true.';
      let varSkjult = false;
      const seen = new Set();
      let stable = 0, rounds = 0, atEnd = false, bundRunder = 0, stilleHjul = 0;
      let lastHeight = null, lastPos = null;
      const MAX_ROUNDS = 300; // backstop: a list that never stabilises must not spin forever

      while (seen.size < maxRows && rounds < MAX_ROUNDS) {
        rounds++;
        const r = await safeExecuteScript(tab.id, (rs, cs, keep, medScript) => {
          const rows = Array.from(document.querySelectorAll(rs));
          const texts = rows
            .map(el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(t => t.length > 0);

          // Scroll the row's own scrollable ancestor - scrolling window does nothing when the
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
          // R62 (Astra, maalt i model): en kort liste i en fast boks, der endnu ikke flyder over, blev ikke fundet - saa gik
          // hjulet til vinduets midte, uden for listen, og feedet hentede aldrig. Anden runde: den naermeste boks med
          // overflow auto/scroll, der er lavere end vinduet.
          if (!c && rows.length) {
            let p = rows[0].parentElement;
            while (p && p !== document.documentElement) {
              const s = getComputedStyle(p);
              if (/(auto|scroll)/.test(s.overflowY) && p.clientHeight > 0 && p.clientHeight < window.innerHeight) { c = p; break; }
              p = p.parentElement;
            }
          }
          const step = keep || (c ? c.clientHeight : window.innerHeight) * 0.85;
          const pos = c ? c.scrollTop : window.scrollY;
          const height = c ? c.scrollHeight : document.documentElement.scrollHeight;
          const atBottom = c
            ? c.scrollTop + c.clientHeight >= c.scrollHeight - 4
            : window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
          // Hjulet rammer det element der ligger under punktet, saa det sendes midt i det synlige stykke af listen.
          let point = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
          if (c) {
            const b = c.getBoundingClientRect();
            const x0 = Math.max(0, b.left), x1 = Math.min(window.innerWidth, b.right);
            const y0 = Math.max(0, b.top), y1 = Math.min(window.innerHeight, b.bottom);
            if (x1 > x0 && y1 > y0) point = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
          }
          if (medScript) { if (c) c.scrollTop = pos + step; else window.scrollBy(0, step); }
          return { texts, pos, height, atBottom, step, point, container: !!c, skjult: document.visibilityState === 'hidden' };
        }, [rowSel, containerSel, params.scroll_step || 0, !hjul]);

        if (r.cspBlocked) throw new Error('extract_list: this page blocks script injection — use screenshots instead');
        const data = r.result || { texts: [] };
        if (data.skjult) varSkjult = true;
        metoder.add(hjul ? 'wheel' : 'script');
        const before = seen.size;
        for (const t of data.texts) seen.add(t);
        const nye = seen.size - before;
        const voksede = lastHeight !== null && data.height > lastHeight;
        // Flyttede sidste rundes hjul overhovedet listen? To stille runder uden for bunden: hjulet rammer ikke listen
        // (et overlay, et punkt uden for den), saa resten rulles med script.
        if (hjul && lastPos !== null && data.pos === lastPos && !data.atBottom) {
          if (++stilleHjul >= 2) {
            hjul = false;
            stable = 0;   // en ny rullemaade faar sine egne runder
            note = 'Wheel events did not move the list, so it was scrolled with a script instead. A feed that loads more ' +
              'rows on wheel may have stopped early.';
          }
        } else stilleHjul = 0;
        // MAALT i Chrome 9/10: en liste der beholder alle sine raekker i DOM, stoppede midt i det allerede hentede, fordi
        // rulningen gennem dem talte som «ingen nye raekker». En liste der flyttede sig, er paa vej mod bunden.
        const flyttede = lastPos !== null && data.pos !== lastPos;
        lastHeight = data.height;
        lastPos = data.pos;
        // En liste der vokser uden nye raekker endnu (en loader der foerst laegger pladsholdere ind), er stadig i gang.
        if (nye === 0 && !voksede && !flyttede) stable++; else stable = 0;
        // reached_end kun naar listen stod paa bunden, intet nyt kom og den ikke voksede - stable_rounds runder i traek.
        // R62 (Astra): runden hvor listen NAAEDE bunden, talte som en runde den stod paa bunden - med stable_rounds 1 sluttede
        // koerslen dér, foer et hjul ved bunden havde faaet feedet til at hente.
        if (data.atBottom && nye === 0 && !voksede && !flyttede) bundRunder++; else bundRunder = 0;
        if (bundRunder >= stableNeeded) { atEnd = true; break; }
        // Ingen nye raekker i stable_rounds runder uden for bunden: stop, men uden at kalde det enden. Staar listen paa
        // bunden, afgoer reglen ovenfor det, saa et feed der henter ved bunden faar sine runder.
        if (stable >= stableNeeded && bundRunder === 0) break;
        if (!data.texts.length && rounds > 2) break; // selector matches nothing — fail fast

        if (hjul && !(await erAktiv())) { hjul = false; stable = 0; note = BAGGRUND; }
        if (hjul) {
          try {
            await debuggerAttach(tab.id);
            const trin = Math.max(1, Math.ceil(Math.abs(data.step) / 300));
            for (let i = 0; i < trin; i++) {
              await cdpSend(tab.id, 'Input.dispatchMouseEvent', {
                type: 'mouseWheel', x: Math.round(data.point.x), y: Math.round(data.point.y), deltaX: 0, deltaY: data.step / trin,
              });
              if (i < trin - 1) await new Promise(res => setTimeout(res, 80));
            }
          } catch (e) {
            hjul = false;
            stable = 0;
            note = `A wheel event failed (${e?.message || e}), so the rest of the list was scrolled with a script. A feed that ` +
              'loads more rows on wheel may have stopped early.';
          }
        }
        await new Promise(res => setTimeout(res, waitMs));
      }

      // R62 (Opus): max_rows skar ikke raekkerne til - den sidste runde kunne laegge flere til.
      const raekker = [...seen].slice(0, maxRows);
      // MAALT i Chrome 9/10: en selektor der intet fandt, gav count 0 med reached_end:true - den tomme side «stod paa bunden».
      if (!seen.size) {
        return { rows: [], count: 0, rounds, reached_end: false, truncated: false,
          error: 'no-rows', note: `The selector ${rowSel} matched no rows with text on the page. Check the selector.` };
      }
      return {
        rows: raekker,
        count: raekker.length,
        rounds,
        reached_end: atEnd && !varSkjult,
        truncated: seen.size >= maxRows,
        scroll_method: metoder.size > 1 ? 'wheel, then script' : [...metoder][0] || (hjul ? 'wheel' : 'script'),
        ...(varSkjult ? { note: SKJULT } : note ? { note } : {}),
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
      const { foersteMs, samletMs, haevMs = 0 } = skaermbilledeFrister();
      const budgetSlut = Date.now() + samletMs;
      // MAALT 11/9 af Astra (e2e runde 2), tre fejl i den haevede runde: reservationen blev trukket fra IGEN (reserven fik
      // 0 ms), `debuggerAttach` laa uden for fristloebet (en gentilslutning paa 12,5 s bar kaeden over 30 s), og haevningen
      // startede nye optagelser og smed de igangvaerende vaek - 1.29.0 fik netop svar fra dem der allerede loeb.
      const igangvaerende = [];   // alle optagelser der stadig kan svare, paa tvaers af runder
      const tryCapture = async ({ sidsteUdvej = false } = {}) => {
        const reserveret = sidsteUdvej ? 0 : haevMs;   // kun foerste runde holder tid fri til haevningen
        const denneRunde = [];
        const optag = (p) => {
          const kald = cdpSend(tab.id, 'Page.captureScreenshot', p);
          kald.catch(() => {});   // et svar efter budgettet er ligegyldigt
          igangvaerende.push(kald);
          denneRunde.push(kald);
          return kald;
        };
        const medFrist = async (loefte, ms) => {
          let ur;
          try {
            return await Promise.race([
              loefte,
              new Promise((_, afvis) => {
                const frist = Math.max(0, ms);
                ur = setTimeout(() => afvis(cdpFristFejl(`CDP did not respond within ${frist} ms: Page.captureScreenshot`)), frist);
              }),
            ]);
          } catch (e) {
            if (e && typeof e === 'object' && erCdpFrist(e)) e.ingenNyRunde = true;
            throw e;
          } finally {
            clearTimeout(ur);
          }
        };
        // Tilslutningen skal ogsaa ligge inde i budgettet: en gentilslutning kan tage lang tid paa et haevet vindue.
        await medFrist(debuggerAttach(tab.id), budgetSlut - reserveret - Date.now());
        const standard = optag({ format: 'png' });
        try {
          const shot = await medFrist(standard, Math.min(foersteMs, budgetSlut - reserveret - Date.now()));
          return { image: 'data:image/png;base64,' + shot.data };
        } catch (foersteFejl) {
          // fromSurface:false proeves ogsaa efter en frist: i 1.29.0 var det netop fristen der naaede hertil, og den
          // leverede billedet. Men efter en frist startes ingen runde mere, uanset hvordan reserven fejler.
          // MAALT 11/9 af Astra (efterproevning af f084d1b): standardoptagelsen lykkedes efter 11 s, reserven fejlede, og
          // fristen paa 10 s havde kasseret standardbilledet. Standardoptagelsen loeber derfor videre efter sin frist, og
          // den af de to der lykkes foerst inden for budgettet, vinder.
          optag({ format: 'png', fromSurface: false, captureBeyondViewport: false });
          try {
            // Den haevede runde er sidste udvej paa en tildaekket skaerm og skal have tid tilbage (haevMs) - ellers naar
            // 1.29.0's eneste virkende vej aldrig frem (Fable, e2e 11/9).
            // MAALT 12/9 af Astra: alle igangvaerende optagelser laa i den SAMME Promise.any, saa et gammelt billede fra
            // foer haevningen kunne svare foerst og vinde - selv om siden havde aendret sig imens. Rundens EGNE optagelser
            // afgoer nu svaret; de aeldre taeller stadig med, men kun hvis rundens egne ikke naar frem.
            let shot;
            let aeldreBillede = false;
            try {
              shot = await medFrist(Promise.any(denneRunde), budgetSlut - reserveret - Date.now());
            } catch (rundeFejl) {
              const aeldre = igangvaerende.filter((k) => !denneRunde.includes(k));
              if (!aeldre.length) throw rundeFejl;
              // Et aeldre billede der ALLEREDE er kommet, svarer i samme oejeblik - ogsaa naar budgettet er brugt op.
              shot = await medFrist(Promise.any(aeldre), budgetSlut - Date.now());
              aeldreBillede = true;   // kun den haevede runde har aeldre optagelser at falde tilbage paa
            }
            // R126 (Opus): reserven leverede det aeldre billede uden at sige det. Det kan vise siden, som den var foer
            // vinduet blev haevet - agenten skal vide det, foer den handler paa det.
            return { image: 'data:image/png;base64,' + shot.data,
              ...(aeldreBillede ? { stale: true, note: 'This picture was taken before the window was raised, because a new ' +
                'one did not arrive in time. The page may have changed since; take another screenshot if it matters.' } : {}) };
          } catch (andenFejl) {
            const fejl = andenFejl instanceof AggregateError ? andenFejl.errors[andenFejl.errors.length - 1] : andenFejl;
            if (foersteFejl?.ingenNyRunde && fejl && typeof fejl === 'object') fejl.ingenNyRunde = true;
            throw fejl;
          }
        }
      };

      const withViewport = async (shot) => {
        const viewport = await screenshotViewport(tab.id, shot?.image, budgetSlut - Date.now());
        return viewport ? { ...shot, viewport } : shot;
      };

      // Attempt 1 — focus-neutral. Handles the vast majority (background-but-visible window).
      try {
        return await withViewport(await tryCapture());
      } catch (firstErr) {
        // 10/9 (Astra, R2) stod her: en frist betyder at kompositoren ikke svarede, saa en ny runde fordobler kun
        // ventetiden. MAALT 11/9 af Fable: paa en TILDAEKKET skaerm haenger begge optagelser netop indtil vinduet haeves -
        // 1.29.0 leverede dér et billede efter 16,7 s, hvor HEAD gav op. Budgettet (haevMs) holder kaeden under serverens
        // 30 s, saa den sidste udvej maa proeves uanset om fejlen var en frist.
        // Er budgettet brugt, er der ikke tid til en runde med haevet vindue foer serverens 30 s. (haevMs ovenfor er netop
        // den tid der blev holdt fri til den her runde.)
        if (budgetSlut - Date.now() <= 0) throw firstErr;
        // 14/10 (Gustav: «den bliver ved med at tage min computer»): loeftningen nedenfor gav kun fokus tilbage til et
        // ANDET Chrome-vindue - sad han i VS Code, blev Chrome staaende foran ham. Den sker nu kun med bring_to_front: true.
        if (params.bring_to_front !== true) {
          // Kun den tavse optagelse, som et tildaekket vindue giver (frist eller «image readback failed»), er window-covered.
          // En anden fejl (fx CDP nede) meldes som den er - den ville en loeftning heller ikke hjaelpe paa.
          if (!(erCdpFrist(firstErr) || /image readback failed/i.test(String(firstErr?.message || '')))) throw firstErr;
          return {
            ok: false, error: 'window-covered', detail: String(firstErr?.message || firstErr),
            note: 'Chrome produced no picture, which usually means its window is covered by other windows or minimized. ' +
              'The screenshot was not taken, so as not to pull Chrome in front of the user. Read the page with ' +
              'browser_get_page_content instead. Only if the user agrees (ask with browser_ask_user), call again with ' +
              'bring_to_front: true: Chrome is then raised for the picture and stays in front.',
          };
        }
        // Both methods failed → the window is genuinely OCCLUDED (covered by other windows),
        // so Chrome\'s compositor produced no frames. LAST RESORT ONLY: raise the window to
        // de-occlude it, capture, then RESTORE the user\'s previously-focused window. This
        // focus-steal happens ONLY in the covered case, and only when the caller asked for it (bring_to_front).
        const prev = await chrome.windows.getLastFocused().catch(() => null);
        try {
          await chrome.windows.update(tab.windowId, { focused: true, state: 'normal' });
          await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
          await new Promise(r => setTimeout(r, 250)); // let it composite
          return await withViewport(await tryCapture({ sidsteUdvej: true }));   // resten af budgettet - der er ikke en runde mere efter denne
        } catch (secondErr) {
          throw new Error(
            `Screenshot failed after focus-neutral AND raised attempts. ` +
            `First: ${firstErr?.message || firstErr}. Raised: ${secondErr?.message || secondErr}. ` +
            `If both say "image readback failed" the GPU compositor is not producing frames — ` +
            `disable Chrome hardware acceleration (chrome://settings/system) as a last resort.`
          );
        } finally {
          // Give focus back to the user\'s previous Chrome window (best-effort; getLastFocused
          // only sees Chrome windows, so a non-Chrome IDE can't be re-focused programmatically).
          if (prev && prev.id != null && prev.id !== tab.windowId) {
            await chrome.windows.update(prev.id, { focused: true }).catch(() => {});
          }
        }
      }
    }

    case 'execute_script': {
      const start = modtaget;
      // v1.26: accept `script` as alias for `code` - the historic param-name mismatch caused
      // silent "unserializable"/undefined failures that read as "execute_script is broken".
      if (params.code == null && typeof params.script === 'string') params.code = params.script;
      if (typeof params.code !== 'string' || !params.code.trim()) {
        return { ok: false, error: 'Missing code. Pass a JavaScript EXPRESSION in `code` (e.g. an IIFE: (() => {...; return x;})()). `return ...` at top level is invalid - the handler wraps code in parentheses.' };
      }
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot execute scripts on chrome:// pages');
      // 1.31.0: kun gennem debuggeren, i hovedsidens standardkontekst (sidens egne globale variabler, som MAIN foer).
      // Til og med 1.30.3 stod her to forsoeg gennem chrome.scripting med strengkompilering (ISOLATED og MAIN) foer
      // debuggeren - se koerAgentKode for hvorfor de er vaek, og for beskyttelsen mod at koere koden to gange.
      return koerAgentKode(tab.id, params.code, {}, agentKodeSlut(start), vagt);
    }

    case 'click': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');

      // Wrap full click flow (incl. resolveElement) so debugger failures in EITHER
      // resolveElement (text-selectors use debuggerEval) OR debuggerClick trigger
      // the scripting-fallback. v1.21.2: previously only debuggerClick was wrapped,
      // leaving text-selector clicks unrecoverable when debugger was user-blocked.
      try {
        let el = await resolveElement(tab.id, params.selector);
        if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
        // Elementet findes, men har ingen udstraekning — at klikke ville ramme (0,0),
        // altsaa et HELT andet element end det der blev bedt om. Sig det i stedet.
        if (el.hidden) {
          return {
            ok: false,
            error: 'Element found but not visible (0x0) - a click would hit the page corner: ' + params.selector,
            hidden: true,
            tag: el.tag,
          };
        }
        // R57: et andet element ligger over maalets midtpunkt (overlay, backdrop, en anden dialog) - musen ville ramme det.
        if (el.covered) return daekketSvar(params.selector, el);

        // Primary path: debugger mouse events (isTrusted=true, works on React/Angular SPAs)
        const clickResult = await debuggerClick(tab.id, el.x, el.y, true);
        if (clickResult && clickResult.blokeret) return vagtSvar(params.selector, el, clickResult);
        if (clickResult && clickResult.fremmedRamme) return vagtSvar(params.selector, el, { blokeret: clickResult.fremmedRamme, iFremmedRamme: true, trykNaaet: clickResult.trykNaaet });
        if (clickResult && clickResult.vaek) return vaekSvar(params.selector, el);
        if (clickResult && clickResult.ikkeArmeret) return ikkeArmeretSvar(params.selector, el);
        return {
          method: el.method || 'debugger',
          tag: el.tag,
          text: el.text,
          // MAALT 21/8: `landed` blev allerede beregnet inde i debuggerClick og smidt vaek,
          // saa `click` svarede ok:true selv naar siden slet ikke reagerede. Nu foelger den med:
          // landed=false betyder "eventet blev sendt, men intet handler tog imod det".
          ...(clickResult || {}),
          // MAALT 9/9 (issue #19, fjerde gang samme fejlklasse efter select_option og fill):
          // `ok: true` stod hardkodet, og `landed` blev spredt ind bagefter. Klikket svarede
          // altsaa ja og nej i samme aandedrag, og en agent laeser `ok`.
          // Et element der forsvandt ER en virkning — derfor tæller `detached` som landet.
          // MAALT 12/9 af Astra (N1): `ok` stod FOER settle-vaerdien her og i click_xy, hvor select_option var immun -
          // saa et svar fra siden kunne bestemme vaerktoejets egen dom. Ikke naabart i dag, men det er samme klasse som
          // lige blev lukket for noten, og de tre steder var indbyrdes uens. Vaerktoejets vurdering staar nu sidst.
          ok: klikLandede(clickResult),
          ...(uvisVurdering(clickResult) || {}),
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
            ok: false, error: e.message, maybe_landed: true, method: 'debugger',
            note: 'The mouse click was sent, but the debugger detached afterwards. The click MAY have landed, ' +
                  'so it is not repeated. Check the page before clicking again.',
          };
        }
        // MAALT 11/9 i Chrome for Testing: en fane i baggrunden faar ikke Input.* - musebevaegelsen udloeber FOER
        // trykket er sendt. Intet klik kan vaere landet (trykSendt er falsk, se ovenfor), saa script-klikket er sikkert.
        const inputFristFoerTryk = erCdpFrist(e) && /: Input\./.test(e?.message || '');
        if (inputFristFoerTryk || /Debugger detached|Debugger attach failed|not attached/i.test(e?.message || '')) {
          // Ingen "ny adresse = klikket navigerede"-regel her. Astra (efterproevning af c1496d4): en UAFHAENGIG navigation
          // fjernede rammen foer scriptet koerte, og reglen svarede ok:true med nul handlinger. En afvisning beviser ikke at
          // scriptet koerte, og en ny adresse beviser ikke at det var klikket.
          const r = await scriptingClick(tab.id, params.selector);
          if (r.reason === 'covered') return daekketSvar(params.selector, r, 'scripting-fallback');
          if (r.reason === 'hidden') {
            return { ok: false, method: 'scripting-fallback', hidden: true, tag: r.tag,
              error: 'Element found but not visible (0x0) - a click would hit the page corner: ' + params.selector };
          }
          if (r.ok && !inputFristFoerTryk) {
            if (klikLandede(r)) return { ok: true, method: 'scripting-fallback', tag: r.tag, landed: true };
            // MAALT 17/9 mod Stripe Dashboard: her stod et bart `ok: true` naar klikket ikke var bevist, med
            // begrundelsen "samme svar som 1.29.0". Efter en time med "Debugger attach failed ... ghost" svarede
            // vaerktoejet {ok:true, tag:'DIV'} paa «Create key» - knappen blev aldrig trykket, siden stod uaendret.
            // Nabogrenen nedenfor kraevede allerede bevis; denne var bare aldrig blevet rettet.
            //
            // ⛔ Svaret er IKKE ok:false. Astra maalte 12/9 at en menu der aabner paa mousedown ellers meldes
            // mislykket, og saa klikker agenten igen og lukker den. Det er det TREDJE udfald, som resten af
            // klassen bruger: sendt, virkning unknown.
            const unknown = uvisVurdering(r);
            return {
              ok: true, method: 'scripting-fallback', tag: r.tag, landed: null, maybe_landed: true,
              note: (unknown?.note ? unknown.note + ' ' : '') +
                    'The debugger was blocked, so the click was sent with a script. The page showed no measurable ' +
                    'effect, so it is unknown whether it worked - some pages require a real click. Check the page ' +
                    'before clicking again.',
            };
          }
          if (r.ok) {
            // Sign-off 11/9 (Astra og Fable): paa en baggrundsfane svarede reserven ok:true, ogsaa naar siden intet gjorde
            // (handler der kraever isTrusted). 1.29.0 svarede med en fejl. Nu kraever ok samme bevis som de andre klikveje.
            // Viste siden ingen reaktion, er klikket alligevel sendt - saa det meldes som "kan vaere landet", ikke gentag blindt.
            if (klikLandede(r)) {
              return {
                ok: true, method: 'scripting-fallback', tag: r.tag, landed: true,
                note: 'The tab was in the background, so mouse events did not arrive. The click was performed with a script instead.',
              };
            }
            return {
              ok: false, method: 'scripting-fallback', tag: r.tag, landed: false, maybe_landed: true, error: e.message,
              note: 'The tab was in the background, so mouse events did not arrive. A script click was sent, but the click itself ' +
                    'produced no visible effect: either the page requires a real click, or the click worked without a visible change. Check the page, ' +
                    'and call browser_switch_tab and click again only if nothing happened.',
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
        let el = await resolveElement(tab.id, params.selector);
        if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
        // R61 (Opus, maalt i Chrome): fill text= klikkede paa overlayet og svarede ok:true.
        if (el.covered) return daekketSvar(params.selector, el);
        const fillKlik = await debuggerClick(tab.id, el.x, el.y, true);
        if (fillKlik && fillKlik.blokeret) return vagtSvar(params.selector, el, fillKlik);
        if (fillKlik && fillKlik.fremmedRamme) return vagtSvar(params.selector, el, { blokeret: fillKlik.fremmedRamme, iFremmedRamme: true, trykNaaet: fillKlik.trykNaaet });
        if (fillKlik && fillKlik.vaek) return vaekSvar(params.selector, el);
        if (fillKlik && fillKlik.ikkeArmeret) return ikkeArmeretSvar(params.selector, el);
        await new Promise(r => setTimeout(r, 100));
        // R50: kun disabled foer skrivningen; readonly kan forsvinde ved fokus (se debuggerFill).
        if (await fieldBlocked(tab.id, null) === 'disabled') return fieldBlockedAnswer('disabled', 'debugger');
        const levering = await debuggerType(tab.id, params.value);
        // MAALT 13/9 (Astras hul-audit): her stod `ok:true` uden at nogen havde set feltet.
        // Css-grenen laeser allerede vaerdien tilbage og skelner tomt fra fordoblet fra
        // formateret; tekst-grenen gjorde ikke. Et klik der landede paa noget andet end et
        // felt, eller en baggrundsfane der slugte tasterne, gav samme ja.
        const efterTekst = await debuggerEval(tab.id,
          '(() => { const a = document.activeElement; return a && "value" in a ? String(a.value) : null; })()')
          .catch(() => undefined);
        if (efterTekst === undefined || efterTekst === null) {
          // R139 (Opus, MAALT): ogsaa et ulaeseligt felt faar at vide, hvordan linjeskiftene blev skrevet (udeladt eller mellemrum).
          return medLinjeskift({ ok: true, method: 'debugger', unknown: true,
            note: 'The text was written, but the field could not be read afterwards, so it is unknown whether ' +
                  'it landed. Read the field with browser_execute_script if it matters.' }, params.value, levering ? levering.linjeskift : null);
        }
        if (efterTekst === String(params.value)) return { ok: true, method: 'debugger', value: efterTekst, actual: efterTekst };
        const spaerret = await fieldBlocked(tab.id, null);
        if (spaerret) return fieldBlockedAnswer(spaerret, 'debugger');
        const ls = levering ? levering.linjeskift : null;
        if (efterTekst === '' && kunLinjeskift(params.value)) return kunLinjeskiftSvar({ method: 'debugger' }, ls);
        if (efterTekst === '') {
          return medLinjeskift(tomtFeltSvar({ method: 'debugger' }, levering ? levering.landed : null,
            'The field was empty after the write, and the tool saw no key arrive. The click may not have hit a field, or the ' +
            'tab is in the background, where Chrome does not deliver keystrokes. Check the page before typing again (an ' +
            'editor can hide keys from the tool); if nothing happened there, call browser_switch_tab and try again.'), params.value, ls);
        }
        return medLinjeskift({ ok: true, method: 'debugger', differs: true, value: efterTekst, actual: efterTekst,
          note: 'The field contains something other than what was typed. The page has probably formatted ' +
                'the value - or something was already there.' }, params.value, ls);
      }

      // Always use debugger for input/textarea — React/Angular/Vue need real keyboard events
      try {
        const efterFyld = await debuggerFill(tab.id, parsed.selector, params.value);
        if (efterFyld?.blocked) return fieldBlockedAnswer(efterFyld.blocked, 'debugger');
        return medLinjeskift(fyldSvar(efterFyld?.value, params.value, { method: 'debugger' },
                        efterFyld?.rammeHoerte, efterFyld?.tasterLanded, efterFyld?.linjeskift), params.value, efterFyld?.linjeskift);
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
        const fristUdloeb = erCdpFrist(e);
        if (fristUdloeb) await new Promise((r) => setTimeout(r, 400));
        // MAALT 11/9 af Astra (R5 F1): feltet laeses FOER reserveloesningen skriver. Det er det der skiller en
        // side der afviste vaerdien (feltet stod stille) fra en side der formaterede den (feltet aendrede sig).
        const foer = await laesFelt();
        if (fristUdloeb && foer === params.value) {
          return { ok: true, method: 'debugger', note: 'landed despite the timeout' };
        }
        // Fallback to executeScript if debugger fails
        const scriptResult = await safeExecuteScript(tab.id, (sel, val) => {
          const el = document.querySelector(sel);
          if (!el) return { ok: false, error: 'Element not found: ' + sel };
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          el.focus();
          // R50 (Astra, MAALT): reservevejen skrev med setteren i et readonly-felt og svarede ok:true.
          if (el.disabled || (el.matches && el.matches(':disabled'))) return { ok: false, blocked: 'disabled' };
          if (el.readOnly) return { ok: false, blocked: 'readonly' };
          // Use nativeInputValueSetter to bypass React controlled input
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(el, val); else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        }, [parsed.selector, params.value]);
        if (scriptResult.cspBlocked) return { ok: false, error: e.message, method: 'debugger' };
        if (scriptResult.result?.blocked) return fieldBlockedAnswer(scriptResult.result.blocked, 'fallback');
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
              ok: false, method: 'fallback', error: fordoblet ? 'field-doubled' : 'field-cleared',
              expected: v, actual: endelig,
              note: 'A delayed key press from the debugger attempt landed after the fallback.',
            };
          }
          // Anden runde: "OLD" efter fill("NEW") blev kaldt formatering. Tredje og fjerde runde: hver regel for
          // "det er bare formatering" havde huller ("5" -> "15", "1.5" -> "15", Unicode-minus, "+45" -> "+1 45").
          // Femte runde (R5 F1): at melde ENHVER afvigelse som fejl gjorde korrekt formatering ("1.234,50 kr",
          // "+45 12 34 56 78") til ok:false, hvor 1.29.0 sagde ok. Skellet maales nu i stedet for at gaettes:
          //   stod feltet stille (foer === efter)  -> unknown, og det siges: afviger + uaendret (se nedenfor)
          //   aendrede det sig til noget andet     -> ok:true, men differs:true med den faktiske vaerdi
          // Kalderen faar altsaa aldrig en tavs succes paa en anden vaerdi end den der blev skrevet.
          // Sign-off 11/9 (Astra og Fable, begge reproduceret): feltet viste allerede "1.234,50 kr", fill("1234.5")
          // blev formateret tilbage til praecis det samme, og svaret var "siden tog ikke imod vaerdien" (1.29.0: ok).
          // Foer = efter kan ikke skelne en afvisning fra en vaerdi der allerede stod der i sidens format.
          // Kun en toemning der ikke skete er entydig: intet format goer "" til noget andet.
          if (typeof foer === 'string' && endelig === foer) {
            if (!v) {
              return {
                ok: false, method: 'fallback', error: 'field-shows-other', expected: v, actual: endelig,
                note: 'The field was meant to be cleared, but shows the same as before.',
              };
            }
            return {
              ok: true, method: 'fallback', value: endelig, differs: true, unchanged: true, expected: v, actual: endelig,
              note: 'The field showed the same before and after the write. Either the value was already there in the page\'s own ' +
                    'format, or the page did not accept it. Check `actual` before moving on.',
            };
          }
          return {
            ok: true, method: 'fallback', value: endelig, differs: true, expected: v, actual: endelig,
            ...(typeof foer === 'string' ? {} : { foer_ukendt: true }),
            note: 'The field changed, but shows different text than what was written - for example formatting ' +
                  '("5,00 kr", "+45 12 34 56 78") or a truncation. Check `actual` if the exact value matters.',
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
            const maskeret = await setDateMaskedTyping(tab.id, params.selector, iso, fmt);
            if (maskeret && (maskeret.focusMoved || maskeret.focusUnknown)) {
              const v0 = await readBackValue(tab.id, params.selector).catch(() => null);
              const trin = { 'select-all': 'selecting the field\'s text', delete: 'deleting it', typing: 'typing the date' }[maskeret.step] || maskeret.step;
              const aendret = maskeret.changed;
              // Foer den foerste skrivende handling har vaerktoejet intet skrevet - uanset om felterne kunne laeses.
              const hvad = maskeret.step === 'select-all' ? 'Nothing was cleared or typed.'
                : aendret === null || aendret === undefined ? 'What had been changed by then could not be read.'
                : aendret.length === 0 ? 'Nothing was cleared or typed.'
                  : 'Changed so far: ' + aendret.map((c) => `${c.target ? 'the date field' : (c.tag + (c.id ? '#' + c.id : ''))} ` +
                    `(before ${JSON.stringify(c.value_before)}, now ${JSON.stringify(c.value)})`).join('; ') + '.';
              const hvor = maskeret.focused ? ` (${maskeret.focused.tag}${maskeret.focused.id ? '#' + maskeret.focused.id : ''})` : '';
              return { ok: false, error: maskeret.focusMoved ? 'focus-moved' : 'focus-unknown', step: maskeret.step,
                current_value: v0, value_before: info.value, field_changed: v0 !== null && v0 !== info.value,
                ...(maskeret.focused ? { focused: maskeret.focused } : {}), ...(aendret ? { changed: aendret } : {}),
                note: (maskeret.focusMoved
                  ? `Before ${trin}, focus was no longer on the field: the page moved it to another element${hvor}. `
                  : `Before ${trin}, where focus is could not be read. `) +
                  `The tool stopped there, so nothing more was typed. ${hvad} Check how the page wants the date entered ` +
                  '(a date picker, perhaps), and use browser_click or browser_fill on that.' };
            }
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
              return { ok: true, method: 'masked', value: v, format: fmt.order.join(fmt.sep), note: 'landed despite an error while sending' };
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
        // R125 (Opus, MAALT i Chrome): kalenderens klik kunne kaste (frist paa en skjult fane), og kaldet endte som en raa
        // fejl - mens den maskerede vej allerede havde skrevet i feltet. Fejlen er nu et svar, der siger hvad feltet indeholder.
        let r;
        try { r = await setDatePicker(tab.id, params.selector, iso); } catch (e) { r = { ok: false, error: e.message }; }
        await new Promise(r2 => setTimeout(r2, 200));
        const v = await readBackValue(tab.id, params.selector).catch(() => null);
        tried.push({ path: 'picker', ...r, value: v });
        if (r.ok && valueLooksLikeIso(v, iso, kendtFormat)) return { ok: true, method: 'picker', value: v, navAttempts: r.navAttempts };
      }

      const visibleErrors = await collectVisibleErrors(tab.id, params.selector).catch(() => []);
      const finalValue = await readBackValue(tab.id, params.selector).catch(() => null);
      // R125: et fejlsvar maa ikke efterlade en halvt skrevet vaerdi uden at sige det.
      const aendret = finalValue !== null && finalValue !== info.value;
      return {
        ok: false,
        error: 'all-paths-failed',
        tried,
        current_value: finalValue,
        value_before: info.value,
        ...(aendret ? { field_changed: true,
          note: `No path set the date, but the field no longer holds what it did before (before: ${JSON.stringify(info.value)}, ` +
                `now: ${JSON.stringify(finalValue)}): a path wrote part of a value. Correct the field before trying again.` } : {}),
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
      // FUNDET 13/9 af Astra: vagten var `!params.values && !params.value`, og `![]` er falsk.
      // En tom liste slap igennem, loekken koerte nul gange, og `[].every(...)` er sandt - saa
      // vaerktoejet svarede ok:true uden at have roert siden overhovedet.
      const values = Array.isArray(params.values) ? params.values
        : (params.value !== undefined && params.value !== null && params.value !== '' ? [params.value] : []);
      if (values.length === 0) {
        return { ok: false, error: 'value or values required',
          note: 'Provide at least one value. An empty list is not a performed action.' };
      }
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
      // R173: hoejst 60 s - serveren venter tilsvarende (se index.js).
      const timeout = Math.min(Number(params.timeout) || 10000, 60000);
      const sel = params.selector;
      // 1.33 (privat rapport 2.1): standard er «synlig»; state: 'attached' venter som foer kun paa, at det findes paa siden.
      // R173 (Opus): en ukendt state (fx Playwrights 'hidden' eller 'detached') betoed stille «visible» - en agent, der ventede
      // paa, at en spinner forsvandt, fik found:true, mens den snurrede.
      if (params.state != null && params.state !== 'visible' && params.state !== 'attached') {
        throw new Error(`state must be "visible" or "attached", not ${JSON.stringify(params.state)}. browser_wait waits for ` +
          'something to appear; to wait for something to go away, poll browser_get_page_content or browser_execute_script.');
      }
      const kunPaaSiden = params.state === 'attached';
      const p = parseSelector(sel);
      const start = Date.now();
      let sidst = null;
      while (Date.now() - start < timeout) {
        // Text-based selectors use debugger directly
        let r, method;
        if (p.type === 'text') {
          r = await debuggerEval(tab.id, `(${ventMaal})(null, ${JSON.stringify(p.text)}, ${JSON.stringify(p.tag)})`);
          method = 'debugger';
        } else {
          const scriptResult = await safeExecuteScript(tab.id, ventMaal, [p.selector, null, null]);
          if (scriptResult.cspBlocked) {
            r = await debuggerEval(tab.id, `(${ventMaal})(${JSON.stringify(p.selector)}, null, null)`);
            method = 'debugger';
          } else r = scriptResult.result;
        }
        if (r) sidst = r;
        if (r && (kunPaaSiden ? r.paaSiden : r.synlig)) {
          return { found: true, visible: !!r.synlig, ...(method ? { method } : {}) };
        }
        await new Promise(r => setTimeout(r, 500));
      }
      if (sidst && sidst.paaSiden && !kunPaaSiden) {
        return { found: false, on_page_but_hidden: true, note: 'The selector matches something on the page, but nothing ' +
          'that can be seen: it is display:none, visibility:hidden, opacity 0, smaller than 2 px, or moved outside the page. ' +
          'Pass state: "attached" to wait only for it to exist.' };
      }
      return { found: false };
    }

    case 'press_key': {
      // EKSPERIMENT 21/8: aktiverer IKKE fanen. Kommentaren her sagde at Chrome ellers
      // sender tastetrykket til den aktive fane — det maales nu i stedet for at antages.
      const tab = await getSessionTab(port, false);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      // R125 (Opus, MAALT i Chrome): "Space" er ikke en DOM-key - siden fik e.key "", leveringsbeviset ventede paa "Space", og
      // svaret var key-not-delivered, selv om keydown 32 landede. Mellemrumstasten er " " (code "Space"), som paa et tastatur:
      // i et felt skriver den et mellemrum.
      const key = params.key === 'Space' ? ' ' : params.key; // e.g. "Enter", "Tab", "Escape", "ArrowDown"
      let modifiers = (params.ctrl ? 2 : 0) | (params.alt ? 1 : 0) | (params.shift ? 8 : 0) | (params.meta ? 4 : 0);

      // v1.22: Chrome requires windowsVirtualKeyCode for navigation/system keys to trigger scroll/form-submit behavior.
      // #76: tastkode, code og Shift kommer fra den faelles fysiskTast (samme regel som fill's tegn-for-tegn-skrivning).
      // #68 (arasmileska, MAALT 13/10 i headless Chrome paa macOS): ctrl/meta+a sendte `text: 'a'` og ingen tastkode. Paa
      // Windows indsatte Chrome et «a»; paa macOS skete intet - og svaret var landed:true begge steder. En genvej har ingen
      // tekst, bogstaver og cifre faar deres tastkode, og de fem redigeringsgenveje sendes som Chromes egen kommando:
      // kun `commands` udloeste markeringen paa macOS (uden: markering 3-3, med: 0-3, baade med Cmd og Ctrl).
      const genvej = !!(params.ctrl || params.meta || params.alt);
      const etTegn = typeof key === 'string' && [...key].length === 1;   // R125: ét kodepunkt - ogsaa "😀"
      const stort = etTegn ? key.toUpperCase() : '';
      const bogstav = etTegn && stort >= 'A' && stort <= 'Z';
      const ciffer = etTegn && key >= '0' && key <= '9';
      // #76 (arasmileska, MAALT i aegte headless Chrome): tegnsaetning fik ingen tastkode (keyCode 0) og code = selve tegnet,
      // som Chrome ikke kender - et tag-felt, der lytter paa keyCode 188, fik aldrig sit komma. Se fysiskTast. En eksplicit
      // code vinder; et tegn uden for US-layoutet faar ingen code.
      const fysisk = fysiskTast(key);
      const vkParams = tastkodeFelter(fysisk.vk);
      const kode = params.code || fysisk.code;
      if (fysisk.shift) modifiers |= 8;   // #76: det skiftede tegn holder Shift nede
      // #76: Chromes egen Enter baerer text "\r" - uden den kommer intet keypress (13). En genvej faar stadig ingen tekst (#68).
      const tekst = genvej ? '' : key === 'Enter' ? '\r' : etTegn ? key : '';
      const REDIGERING = { A: 'selectAll', C: 'copy', X: 'cut', V: 'paste', Z: 'undo', Y: 'redo' };
      // R93 (Astra, laest i Chromium): med Shift er det en anden genvej (Ctrl+Shift+V = indsaet uden formatering). Kun
      // Shift+Z (redo) faar en kommando; andre Shift-kombinationer gaar til Chromes egen tastbinding (paa Windows/Linux).
      let kommando = (params.ctrl || params.meta) && !params.alt && bogstav && (!params.shift || stort === 'Z')
        ? REDIGERING[stort] : undefined;
      if (kommando === 'undo' && params.shift) kommando = 'redo';

      // MAALT 10/9 af Astra: keyDown og keyUp stod i samme try. Timede keyDown ud — og det
      // kan det, selv naar tasten LANDEDE (Enter der sender en formular) — blev keyUp aldrig
      // sendt. En tast der kun er trykket ned, er en tast der haenger. Nu sendes keyUp altid,
      // og svaret siger om nedtrykket fejlede i stedet for at kaste raat.
      await debuggerAttach(tab.id);
      // Armeres FOER trykket. Fejler injektionen, bliver svaret unknown - aldrig et falskt ja.
      const bevisId = await armerTastBevis(tab.id, key).catch(() => null);
      let tastFejl = null;
      try {
        try {
          await cdpSend(tab.id, 'Input.dispatchKeyEvent', {
            type: 'keyDown',
            key,
            code: kode,
            modifiers,
            text: tekst,
            ...(key === 'Enter' && tekst ? { unmodifiedText: tekst } : {}),
            ...vkParams,
            ...(kommando ? { commands: [kommando] } : {}),
          });
        } catch (e) { tastFejl = e; }
        try {
          await cdpSend(tab.id, 'Input.dispatchKeyEvent', {
            type: 'keyUp',
            key,
            code: kode,
            modifiers,
            ...vkParams,
          });
        } catch (e) { if (!tastFejl) tastFejl = e; }
      } finally {
        await debuggerDetach(tab.id);
      }
      if (tastFejl) {
        const frist = erCdpFrist(tastFejl);
        return {
          ok: false, key, error: tastFejl.message,
          ...(frist ? { maybe_landed: true,
            note: 'Chrome did not acknowledge in time. The key may still have worked ' +
                  '(for example a form that was submitted) - check the page before pressing again.' } : {}),
        };
      }
      // Vaerktoejets egen dom SIDST, som i click: kvitteringen fra Chrome er ikke et bevis.
      const bevis = bevisId ? await laesTastBevis(tab.id, bevisId) : { landed: null };
      if (bevis.landed === true) {
        return { ok: true, key, landed: true, ...(kommando ? { shortcut: kommando } : {}),
          ...(bevis.navigeret ? { note: 'The page navigated on the key press.' } : {}) };
      }
      if (bevis.landed === null) {
        return { ok: true, key, landed: null, maybe_landed: true, ...(kommando ? { shortcut: kommando } : {}),
          note: 'The key was sent, but whether the page received it could not be read. ' +
                'Check the page before pressing again.' };
      }
      return { ok: false, key, landed: false, error: 'key-not-delivered',
        note: 'Chrome acknowledged the keystroke, but no listener in the tab received it. The tab is ' +
              'probably in the background, and Chrome does not deliver mouse or keyboard input to a tab that is not ' +
              'the visible one in its window. Call browser_switch_tab and press again.' };
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
      // MAALT 19/9: et hjul der faldt paa fristen i en baggrundsfane blev leveret SENERE, da
      // fanen kom frem - en ekstra rulning ingen havde bedt om. Reproduceret: 0 -> 300 via
      // reserveloesningen, og efter switch_tab stod siden paa 600 uden et nyt kald.
      // Vi kan ikke afbryde en CDP-kommando vi har opgivet. Men vi kan lade vaere med at sende
      // den: er fanen ikke den aktive i sit vindue, leverer Chrome beviseligt ikke Input.* dertil
      // (maalt 11/9), saa hjulet er spildt uanset. Vi springer det over, ruller aerligt med
      // scrollTo, og siger hvorfor - i stedet for at efterlade et spoegelse i koeen.
      // ⚠️ Kun paa det vi HAR maalt. Om en AKTIV fane i et daekket vindue faar input, ved vi
      // ikke, saa den behandles som foer: send hjulet og lad fristen doemme.
      let springHjulOver = false;
      try {
        const f = await chrome.tabs.get(tab.id);
        springHjulOver = !!f && f.active === false;
      } catch { springHjulOver = false; }
      try {
        // MAALT 19/9: foerste rettelse skrev en GENVEJ her - egen scrollTo, eget svar. To
        // proever fangede den med det samme: den svarede ok:true selv naar rulningen fejlede,
        // og rapporterede den oenskede position frem for den faktiske. En parallel sti ved
        // siden af den aerlige er en ny loegn, ikke en rettelse. Nu kastes der i stedet, saa
        // den reserveloesning der ALLEREDE er bevist aerlig, goer arbejdet.
        if (springHjulOver) {
          throw new Error('the tab is not the active one in its window: Chrome does not deliver wheel events there, ' +
            'and a wheel sent now would land when the tab came forward - as an extra scroll you did not ask for. ' +
            'It was therefore not sent at all. A feed that loads on wheel hears NOTHING here; call browser_switch_tab first.');
        }
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
            ok: false, method: 'fallback', error: 'scroll-unknown', start_unknown: true, wheel_error: e.message,
            hint: 'The wheel call did not answer, and the start position could not be read, so the page MAY have ' +
                  'scrolled. Read window.scrollY with browser_execute_script, then scroll the remainder.',
          };
        }
        const landede = await debuggerEval(tab.id, `(() => {
          const foer = { x: window.scrollX, y: window.scrollY };
          window.scrollTo(${startX} + ${dx}, ${startY} + ${dy});
          return { foer, efter: { x: window.scrollX, y: window.scrollY } };
        })()`).catch((fejl) => ({ fejl: fejl?.message || String(fejl) }));

        if (!landede || landede.fejl) {
          return {
            ok: false, method: 'fallback', error: 'scroll-failed',
            wheel_error: e.message,
            fallback_fejl: landede?.fejl || 'the fallback did not answer',
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
        // Astra (efterproevning af cf5b98a): en animation der gik frem, tilbage og foerst naaede maalet efter 1,6 s, fik
        // svaret ok:false "siden flyttede sig ikke" (1.29.0: ok:true). En rulning der ER sendt, meldes aldrig som fiasko.
        // Kan bevaegelsen ikke ses inden for ventetiden, er svaret unknown - samme aerlighed som maaske_landet paa klik.
        return {
          ok: true,
          method: 'fallback', fallback_reason: e.message,
          position: landede.efter, foer: landede.foer,
          ...(flyttede || alleredeFremme ? {} : {
            unknown: true,
            note: 'The scroll was sent, but the position was unchanged when we answered: either a smooth scroll is still running, ' +
                  'or the bottom has been reached. Read window.scrollY with browser_execute_script if the exact position matters.',
          }),
        };
      }
      // MAALT 13/9 (Astras hul-audit): her stod `ok:true, scrolled:{x:dx,y:dy}` - altsaa det
      // vaerktoejet BAD om, ikke det siden endte paa. Kvitteringen fra hjulet er ikke et bevis;
      // et element der sluger hjulet, en side der allerede er i bunden, eller en baggrundsfane
      // giver samme falske ja. Reservevejen laeser allerede positionen; den gode sti gjorde ikke.
      const slut = await debuggerEval(tab.id, '({x: window.scrollX, y: window.scrollY})').catch(() => null);
      if (!slut || typeof slut.y !== 'number') {
        return { ok: true, scrolled: { x: dx, y: dy }, method: 'mouseWheel-stepped', unknown: true,
          note: 'The scroll was sent, but the position could not be read afterwards. Read window.scrollY ' +
                'with browser_execute_script if the exact position matters.' };
      }
      const rykkede = !startKendt || slut.x !== startX || slut.y !== startY;
      const iMaal = startKendt && slut.x === startX + dx && slut.y === startY + dy;
      return { ok: true, method: 'mouseWheel-stepped', position: slut,
        ...(startKendt ? { foer: { x: startX, y: startY } } : {}),
        ...(rykkede || iMaal ? {} : {
          unknown: true,
          note: 'The scroll was sent, but the page was in the same place when we answered: either a smooth ' +
                'scroll is still running, the bottom has been reached, or the tab is in the background. Read ' +
                'window.scrollY with browser_execute_script if the position matters.',
        }) };
    }

    // ── v1.26 "superior" tools ──────────────────────────────────────────────
    // to the MCP server — only lengths and shape booleans. Born from the 2026-07-27
    // Azure-secret night: the agent must be able to move a credential from page to
    // field without the value ever entering the LLM context or transcript.

    case 'double_click': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      let el = await resolveElement(tab.id, params.selector);
      if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
      if (el.covered) return daekketSvar(params.selector, el);   // R57: musen ville ramme det der ligger oeverst
      await debuggerAttach(tab.id);
      const { x, y } = el;
      // R64: vagten binder haendelserne til maalet; kan den ikke armeres, bruges fanebeviset som foer.
      const vagtD = await armerMaalVagt(tab.id, x, y, VAGT_KLIK);
      if (vagtD && vagtD.daekket) return vagtSvar(params.selector, el, { blokeret: vagtD.daekket, foerSendt: true });
      if (vagtD && vagtD.vaek) return vaekSvar(params.selector, el);
      if (!vagtD || !vagtD.armet) { await debuggerDetach(tab.id); return ikkeArmeretSvar(params.selector, el); }
      let laestD = null;
      try {
        await cdpSend(tab.id, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await new Promise(r => setTimeout(r, 30));
        // Proper dblclick: two press/release pairs with escalating clickCount.
        await dispatchTaalmodigt(tab.id, { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
        await dispatchTaalmodigt(tab.id, { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
        await new Promise(r => setTimeout(r, 40));
        await dispatchTaalmodigt(tab.id, { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 2 });
        await dispatchTaalmodigt(tab.id, { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 2 });
        if (vagtD && vagtD.armet) laestD = await laesMaalVagt(tab.id, x, y);
      } finally {
        if (vagtD && vagtD.armet && !laestD) await laesMaalVagt(tab.id);   // R65: aldrig en efterladt vagt
      }
      const db = vagtBevis(laestD, ['dblclick']);
      if (db.blokeret) return vagtSvar(params.selector, el, db);
      return haendelsesSvar(db, 'double-click-not-delivered',
        { double_clicked: db.landed === true, tag: el.tag, text: el.text });
    }

    case 'right_click': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      let el = await resolveElement(tab.id, params.selector);
      if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
      // R66 (Opus, maalt i Chrome): et hoejreklik klikker ikke en kontrol inde i maalet - contextmenu bobler gennem maalet.
      if (el.covered && !el.covered.inside) return daekketSvar(params.selector, el);   // R57: musen ville ramme det der ligger oeverst
      await debuggerAttach(tab.id);
      const { x, y } = el;
      const vagtR = await armerMaalVagt(tab.id, x, y, VAGT_KLIK, 10000, true);   // R64, som double_click
      if (vagtR && vagtR.daekket) return vagtSvar(params.selector, el, { blokeret: vagtR.daekket, foerSendt: true });
      if (vagtR && vagtR.vaek) return vaekSvar(params.selector, el);
      if (!vagtR || !vagtR.armet) { await debuggerDetach(tab.id); return ikkeArmeretSvar(params.selector, el); }
      let laestR = null;
      try {
        await cdpSend(tab.id, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await new Promise(r => setTimeout(r, 30));
        await dispatchTaalmodigt(tab.id, { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
        await dispatchTaalmodigt(tab.id, { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
        if (vagtR && vagtR.armet) laestR = await laesMaalVagt(tab.id, x, y);
      } finally {
        if (vagtR && vagtR.armet && !laestR) await laesMaalVagt(tab.id);   // R65: aldrig en efterladt vagt
      }
      const hb2 = vagtBevis(laestR, ['contextmenu']);
      if (hb2.blokeret) return vagtSvar(params.selector, el, hb2);
      const svarH = haendelsesSvar(hb2, 'right-click-not-delivered',
        { right_clicked: hb2.landed === true, tag: el.tag, text: el.text });
      // Den gamle note gaelder stadig naar haendelsen LANDEDE: Chromes egen menu aabner ikke via CDP.
      if (svarH.landed === true) svarH.note = 'the contextmenu event landed; Chrome\'s own menu does not open through CDP - menus built inside the page (OWA, web apps) do';
      return svarH;
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
            ok: false, error: e.message, maybe_landed: true, clicked_at: { x: params.x, y: params.y },
            note: 'The mouse click was sent, but the debugger failed afterwards. The click MAY have landed, ' +
                  'so it is not repeated. Check the page before clicking again.',
          };
        }
        throw e;
      }
      return {
        clicked_at: { x: params.x, y: params.y },
        ...(klik || {}),
        // Samme som click: vaerktoejets egen dom og et unknown klik staar sidst, saa siden ikke kan overskrive dem.
        ok: klikLandede(klik),
        ...(uvisVurdering(klik) || {}),
      };
    }

    case 'reattach_debugger': {
      // Ghost-attach recovery without full extension reload: force detach + fresh attach.
      const tab = await getSessionTab(port);
      // R109 (Opus 2e): en kendt, aaben boks kan ikke besvares af vaerktoejerne efter frakoblingen (Chrome viser den ikke
      // til en ny debugger, maalt F7) - svaret siger det.
      const kendtBoks = dialogFaner.get(tab.id)?.boks || null;
      try { await chrome.debugger.detach({ tabId: tab.id }); } catch {}
      // R108 (Astra 4): Chrome sender intet onDetach for vores egen frakobling, saa dialogtilstanden ugyldiggoeres her.
      debuggerAttached.delete(tab.id);
      dialogFaneMistet(tab.id, false);
      await new Promise(r => setTimeout(r, 150));
      await debuggerAttach(tab.id);
      return { ok: true, reattached: true, tab_id: tab.id,
        ...(kendtBoks ? { warning: `A ${kendtBoks.type} dialog was open on this tab. After reattaching, the tools cannot ` +
          'answer it (Chrome does not show it to the new debugger): navigate and handle_dialog will answer tab-not-responding ' +
          'until it is gone. Ask the user (browser_ask_user) to answer it in Chrome.' } : {}) };
    }

    case 'hover': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      let el = await resolveElement(tab.id, params.selector);
      if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
      // R66 (Opus, maalt i Chrome): hover klikker ikke en kontrol inde i maalet (en menu-li med sit link, et kort med et
      // billedlink) - mouseover og :hover gaelder ogsaa maalet. Kun noget foran maalet er en daekning.
      if (el.covered && !el.covered.inside) return daekketSvar(params.selector, el);   // R57: musen ville ramme det der ligger oeverst
      await debuggerAttach(tab.id);
      // ANTAGET 13/9 af Fable, MAALT 18/9 i flow-spaerren: Blink fyrer `mouseover` KUN naar
      // elementet under markoeren SKIFTER. Hover to gange paa det samme, eller klik og hover
      // saa det samme, og anden gang giver kun `mousemove`. Beviset lyttede kun paa mouseover,
      // saa en helt almindelig raekkefoelge svarede "ikke leveret" - et falsk NEJ, som faar
      // agenten til at skifte fane og proeve igen paa noget der virkede.
      // R64: vagten binder haendelserne til maalet; kan den ikke armeres, bruges fanebeviset som foer.
      const vagtH = await armerMaalVagt(tab.id, el.x, el.y, VAGT_HOVER, (params.duration || 500) + 10000, true);
      if (vagtH && vagtH.daekket) { await debuggerDetach(tab.id); return vagtSvar(params.selector, el, { blokeret: vagtH.daekket, foerSendt: true, hover: true }); }
      if (vagtH && vagtH.vaek) { await debuggerDetach(tab.id); return vaekSvar(params.selector, el); }
      const hoverBevis = vagtH && vagtH.armet ? null : await armerHaendelsesBevis(tab.id, ['mouseover', 'mousemove']).catch(() => null);
      let vagtLaest = null;
      try {
        await cdpSend(tab.id, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: el.x, y: el.y,
        });
        // Hold hover for duration (default 500ms) so menus/tooltips appear
        await new Promise(r => setTimeout(r, params.duration || 500));
        if (vagtH && vagtH.armet) vagtLaest = await laesMaalVagt(tab.id, el.x, el.y);
      } finally {
        if (vagtH && vagtH.armet && !vagtLaest) await laesMaalVagt(tab.id);   // R65: aldrig en efterladt vagt
        await debuggerDetach(tab.id);
      }
      const hb = vagtH && vagtH.armet ? vagtBevis(vagtLaest, ['mouseover', 'mousemove'])
        : hoverBevis ? await laesHaendelsesBevis(tab.id, hoverBevis) : { landed: null };
      if (hb.blokeret) return vagtSvar(params.selector, el, { ...hb, hover: true });
      return haendelsesSvar(hb, 'hover-not-delivered', { tag: el.tag, text: el.text });
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
        return { ok: false, error: 'Missing `option` (the text or the value of the choice to select).' };
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
        // FUNDET 17/9 af Hronom paa issue #19: her stod tekstens LAENGDE som bevis. To fejl faldt ud
        // af det. Et accepteret valg hvis label skifter "Alfa" -> "Beta" er lige saa langt, saa
        // aftrykket var identisk og svaret blev "rullet tilbage". Og en urelateret status der gik
        // 9 -> 10 aendrede laengden, saa svaret blev "valget landede". Hash lukker den foerste.
        const aftryk = `(function(el){
          const t = el.form ? el.form.innerText : document.body.innerText;
          let h = 2166136261;
          for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
          return el.options.length + '|' + (h >>> 0);
        })(document.querySelector(${JSON.stringify(params.selector)}))`;

        const valg = await debuggerEval(tab.id, `
          (function() {
            const sel = document.querySelector(${JSON.stringify(params.selector)});
            if (!sel) return JSON.stringify({ found: false, error: 'select not found' });
            const oensket = ${JSON.stringify(oensket)};
            const opt = Array.from(sel.options).find(o => o.value === oensket)
                     || Array.from(sel.options).find(o => o.text.trim() === oensket)
                     || Array.from(sel.options).find(o => o.text.includes(oensket));
            if (!opt) {
              return JSON.stringify({ found: false, error: 'No option matched: ' + oensket,
                available: Array.from(sel.options).map(o => o.text.trim()).slice(0, 25) });
            }
            const foer = ${aftryk};
            // MAALT 19/9 i aerligheds-selen: her tabte vi mod Playwright paa et STYRET select.
            // En komponent der laegger en value-saetter paa INSTANSEN (ikke React - det var vores egen
            // fixtur, trukket tilbage 21/9 paa /learn/tools-that-lie) kan rulle en naiv tilskrivning tilbage, saa
            // \`sel.value = x\` skriver den gamle vaerdi igen og komponenten hoerer aldrig noget.
            // Prototypens saetter gaar uden om instansen og har praecis samme betydning.
            // ⛔ Vi vidste det allerede: fem andre steder i denne fil saetter vaerdier netop saadan
            // (fill, clear, set_date, combobox). select_option var det eneste sted uden grebet - en forsigtighed.
            // Prototypen hentes fra elementet, ikke fra et globalt navn: udtrykket koeres ogsaa
            // i kontekster hvor HTMLSelectElement ikke findes, og der skal det falde tilbage - ikke kaste.
            const saetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel) || {}, 'value')?.set;
            if (saetter) saetter.call(sel, opt.value); else sel.value = opt.value;
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return JSON.stringify({ found: true, wanted: opt.value, actual: sel.value, text: opt.text.trim(), foer });
          })()
        `);
        let r; try { r = JSON.parse(valg); } catch { r = null; }
        if (!r) return { ok: false, type: 'native_select', error: 'Could not read the result of the selection' };
        if (!r.found) return { ok: false, type: 'native_select', error: r.error, available: r.available };

        if (r.actual === r.wanted) return { ok: true, type: 'native_select', selected: r.text, value: r.actual };

        // Feltet holder ikke vaerdien. Giv rammen tid til at gen-rendere, og se saa efter
        // om NOGET andet aendrede sig. Gjorde det det, blev valget taget imod.
        // MAALT 28/9 paa Railway (backlog 1.30.2 #11): ét kig efter 150 ms kaldte et valg «rullet tilbage»,
        // som siden gemte asynkront - en frisk indlaesning viste det gemt. Derfor kigges der igen i op til
        // ~2,2 s og stoppes ved foerste tegn (vaerdien staar der, eller siden aendrede sig). Et felt der
        // VIRKELIG afviser valget, koster de 2,2 s og er stadig «rullet tilbage».
        const laesEfter = async () => {
          const efter = await debuggerEval(tab.id, `
            (function() {
              const sel = document.querySelector(${JSON.stringify(params.selector)});
              if (!sel) return JSON.stringify({ value: null, aftryk: null });
              return JSON.stringify({ value: sel.value, aftryk: ${aftryk} });
            })()
          `);
          try { return JSON.parse(efter); } catch { return null; }
        };
        let e = null;
        for (const vent of [150, 250, 400, 600, 800]) {
          await new Promise((res) => setTimeout(res, vent));
          e = await laesEfter();
          if (!e || !e.aftryk || !r.foer || e.value === r.wanted || e.aftryk !== r.foer) break;
        }

        if (e && e.value === r.wanted) {
          return { ok: true, type: 'native_select', selected: r.text, value: e.value };
        }
        // En bedre hash lukker IKKE det andet hul: en urelateret aendring paa siden ser stadig ud
        // som en reaktion. Derfor er det her det TREDJE udfald og ikke et selvsikkert ja - samme
        // regel som den custom-gren der ligger 40 linjer nede, og samme ordforraad som resten af
        // klassen. Hronom bad selv om praecis det: "a distinct unverified outcome".
        if (e && e.aftryk && r.foer && e.aftryk !== r.foer) {
          const unknown = uvisVurdering({ landed: null, unverified: true },
            'The selection was sent, and the page changed - but the change does not prove it WAS the selection: ' +
            'something else on the page may have moved at the same time. A controlled component can also reset ' +
            'the field and store the selection elsewhere, which is correct behaviour. Read the page instead of selecting again.');
          return {
            ok: true, type: 'native_select', landed: null, selected: r.text, value: e.value, ...unknown,
            note: `The field reset itself to "${e.value}", and the page changed - but the change ` +
                  'does not prove it was the selection. ' + unknown.note,
          };
        }
        // Kunne aftrykket slet ikke laeses, er det ogsaa unknown. Her stod et haardt "rullet tilbage".
        if (!e || !e.aftryk || !r.foer) {
          const unknown = uvisVurdering({ landed: null, unverified: true });
          return { ok: true, type: 'native_select', landed: null, selected: r.text,
                   value: e ? e.value: r.actual, ...unknown };
        }
        return { ok: false, type: 'native_select', landed: false,
          error: `The selection was rolled back: set "${r.wanted}", the field is on "${e ? e.value: r.actual}", ` +
                 'and nothing else on the page changed.' };
      }

      // Custom dropdown (Angular Material, React Select, etc.)
      // Step 1: Click the trigger to open
      let trigger = await resolveElement(tab.id, params.selector);
      if (!trigger) return { ok: false, error: 'Dropdown trigger not found: ' + params.selector };
      // R61 (Opus, maalt i Chrome): select_option klikkede paa overlayet og svarede selected.
      if (trigger.covered) return daekketSvar(params.selector, trigger);
      const udloeserKlik = await debuggerClick(tab.id, trigger.x, trigger.y, true);
      // R66 (Opus, maalt i Chrome): en dropdown, der aabner paa mousedown med en usynlig backdrop (MUI), fik slippet paa
      // backdroppen, og svaret var covered, mens listen stod aaben. Naaede trykket udloeseren, fortsaettes til valget.
      // R67 (Astra, maalt i model): `delvis` betoed kun, at trykket passerede window - en lytter kunne have stoppet det foer
      // udloeseren. Videre gaar det nu kun, naar trykket NAAEDE udloeseren.
      const udloeserDelvis = !!(udloeserKlik && udloeserKlik.blokeret && udloeserKlik.delvis && udloeserKlik.trykNaaet);
      if (udloeserKlik && udloeserKlik.blokeret && !udloeserDelvis) return vagtSvar(params.selector, trigger, udloeserKlik);
      if (udloeserKlik && udloeserKlik.fremmedRamme) return vagtSvar(params.selector, trigger, { blokeret: udloeserKlik.fremmedRamme, iFremmedRamme: true, trykNaaet: udloeserKlik.trykNaaet });
      if (udloeserKlik && udloeserKlik.vaek) return vaekSvar(params.selector, trigger);
      if (udloeserKlik && udloeserKlik.ikkeArmeret) return ikkeArmeretSvar(params.selector, trigger);
      // R68 (Opus, maalt i Chrome): et udloeserklik, der aabnede en dialog, gik videre til at lede efter valget paa den
      // frosne side og endte efter 19 s i en bar CDP-fejl - efter at handlingen var sket. Nu stoppes der straks.
      if (udloeserKlik && udloeserKlik.dialog) {
        return { ok: false, error: 'A dialog opened when the dropdown was clicked, so no option was looked for.', trigger_clicked: true,
          landed: null, maybe_landed: true, note: (uvisVurdering(udloeserKlik) || {}).note };
      }
      // R68 (Astra, maalt i model): udloeserens tryk blev stoppet (af en lytter foer eller efter vagten), svaret var uvist og
      // ikke blokeret - og vaerktoejet klikkede alligevel et valg. Naaede trykket ikke udloeseren, aabnes intet valg.
      // R69 (Astra, maalt i model): et svar UDEN trykNaaet (vagten var vaek, efterkontrollen fejlede eller gav intet) gik
      // stadig videre. Videre kraever nu positivt bevis: trykket naaede udloeseren, eller klikket landede.
      if (udloeserKlik && !udloeserKlik.trykNaaet && !klikLandede(udloeserKlik)) {
        return { ok: false, error: udloeserKlik.trykNaaet === false ? 'The click on the dropdown did not reach it, so no option was clicked.'
          : 'Whether the click on the dropdown reached it cannot be told, so no option was clicked.', landed: udloeserKlik.landed === false ? false : null,
          ...(uvisVurdering(udloeserKlik) || {}) };
      }

      // Step 2: Wait for options to appear
      await new Promise(r => setTimeout(r, params.wait || 300));

      // Step 3: Find and click the option by text
      const option = await resolveElement(tab.id, `text=${oensket}`);
      if (!option) {
        return { ok: false, error: 'Option not found: ' + oensket,
          ...(udloeserDelvis ? { trigger_clicked: true, maybe_landed: true,
            note: 'The trigger was pressed, but the page moved the rest of the click elsewhere, and the option was not found; the list may still be open.' }
            // R67 (Opus, maalt i Chrome): et uvist udloeserklik (fx et slip, der udfoerte noget andet) forsvandt i et bart nej.
            : udloeserKlik && udloeserKlik.landed === null ? { trigger_clicked: true, landed: null, maybe_landed: true,
              note: 'The click on the dropdown may have done something else: ' + ((uvisVurdering(udloeserKlik) || {}).note || 'it was not confirmed.') }
            // R68 (Astra): ogsaa et udloeserklik, der landede, siges - listen kan staa aaben.
            : { trigger_clicked: true, note: 'The dropdown was clicked, but the option was not found; the list may still be open.' }) };
      }
      // R64 (Astra, maalt i model): kun udloeseren blev tjekket for daekning - et valg under en fremmed knap blev klikket, og
      // svaret sagde selected. Valget tjekkes nu ogsaa; udloeseren ER klikket, saa svaret siger at listen kan staa aaben.
      if (option.covered) {
        const svar = daekketSvar(`text=${oensket}`, option);
        svar.note = 'The dropdown was opened, but its option is covered: ' + svar.note + ' The list may still be open.';
        return { ...svar, trigger_clicked: true };
      }
      const valgKlik = await debuggerClick(tab.id, option.x, option.y, true);
      if (valgKlik && valgKlik.vaek) return { ...vaekSvar(`text=${oensket}`, option), trigger_clicked: true };
      // R71 (Astra): udloeseren ER klikket - noten maa ikke sige, at intet blev gjort.
      if (valgKlik && valgKlik.ikkeArmeret) return { ...ikkeArmeretSvar(`text=${oensket}`, option), trigger_clicked: true,
        note: 'The dropdown was clicked, but the click on the option could not be checked in the page, so it was not sent; the list may still be open. Check the state before trying again.' };
      if (valgKlik && valgKlik.fremmedRamme) return { ...vagtSvar(`text=${oensket}`, option, { blokeret: valgKlik.fremmedRamme, iFremmedRamme: true, trykNaaet: valgKlik.trykNaaet }), trigger_clicked: true };
      if (valgKlik && valgKlik.blokeret) {
        const svar = vagtSvar(`text=${oensket}`, option, valgKlik);
        svar.note = 'The dropdown was opened, but its option is covered: ' + svar.note + ' The list may still be open.';
        return { ...svar, trigger_clicked: true };
      }

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
        // MAALT 12/9 af Astra: her stod fejlteksten paa ALT der ikke var bevist landet - ogsaa naar koden lige havde
        // regnet ud at den IKKE ved det. En skarp benaegtelse oven paa en uvished er mindre aerlig end ingen tekst.
        ...(uvisVurdering(valgKlik)
          || (!klikLandede(valgKlik)
            ? { error: 'The click on the option was not accepted by the page: ' + oensket }
            : {})),
      };
    }

    case 'handle_dialog': {
      // R175 (Astra, MAALT): bindingen gjaldt fra efter faneopslaget - en genindlaesning, mens det foerste opslag ventede, og et
      // skift vaek og tilbage, mens Page.enable ventede, slap igennem. Fanens dokumentgeneration tages nu FOER foerste ventetid,
      // og sessionens skifttaeller skal vaere uaendret, naar der armeres eller svares.
      // R176 (Astra, MAALT): skifttaelleren og «den kendte boks» blev ogsaa taget efter opslaget - et skift vaek og tilbage under
      // det foerste opslag, og en ny sides boks, der kom imens, slap igennem. Alt tages nu foer foerste ventetid.
      const sessFoer = getSession(port);
      const aktivFoer = sessFoer.activeTabId;
      const genFoer = aktivFoer != null ? (dialogFaner.get(aktivFoer)?.dokGen || 0) : null;
      const kendtFoer = aktivFoer != null ? (dialogFaner.get(aktivFoer)?.boks || null) : null;
      const skiftFoer = sessFoer.skiftNr || 0;
      const tab = await getSessionTab(port);
      // Har opslaget selv valgt fanen (ingen aktiv fane foer kaldet), er dets eget skift ikke et skift under kaldet.
      const skiftEfterOpslag = tab.id === aktivFoer ? skiftFoer : (sessFoer.skiftNr || 0);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const action = params.action === 'dismiss' ? 'dismiss' : 'accept';
      const promptText = params.text || '';
      const vent = params.wait === true;              // gammel, blokerende adfaerd
      // 1.33 (privat rapport 4.2): 60 s uden loft blev til 10 s som standard og hoejst 30 s. En armering er til klikket lige
      // efter - ikke en staaende regel paa fanen.
      const oensket = Number(params.timeout) > 0 ? Number(params.timeout) : DIALOG_ARMERING.standard;
      const levetid = Math.min(oensket, DIALOG_ARMERING.loft);
      const forlad = params.leave_page === true;
      const s = dialogFane(tab.id);
      // R174 (Astra, MAALT): et nyt dokument, der aabnede en confirm, mens dette kald ventede paa tilknytning og port, blev
      // besvaret direkte med accept. Dokumentgenerationen fra kaldets start afgoer: er den skiftet, svares og armeres der ikke.
      const startGen = tab.id === aktivFoer ? genFoer : (s.dokGen || 0);
      const fanenSkiftet = () => (sessFoer.skiftNr || 0) !== skiftEfterOpslag;
      const sideSkiftet = () => (s.dokGen || 0) !== startGen || fanenSkiftet();
      const sideSvar = (nu) => (fanenSkiftet()
        ? { ok: false, error: 'session-changed', armed: false,
            note: 'The session\'s active tab changed while this call waited (another call switched tabs), so nothing was ' +
              'answered or armed. Check the tabs with browser_list_tabs, then arm again right before the action that opens the dialog.' }
        : { ok: false, error: 'page-changed', armed: false, url: nu ? nu.url : null,
            note: 'The page in this tab changed while this call waited, so nothing was answered or armed. Read the tab, then ' +
              'arm again right before the action that opens the dialog.' });
      const foerKendt = tab.id === aktivFoer ? kendtFoer : null;   // en boks, der stod aaben, da kaldet kom, hoerer til siden, agenten saa
      const svarAaben = (boks) => (boks !== foerKendt && sideSkiftet() ? sideSvar(null) : besvarAabenBoks(tab.id, boks, action, promptText, forlad));

      // #69 (1.30.3): en SET boks, der staar aaben, besvares straks gennem koordinatoren - uden Page.enable, som haenger,
      // mens en boks staar aaben (maalt F4). Dommen kommer fra Closed.
      if (s.boks) return await svarAaben(s.boks);

      await debuggerAttach(tab.id);
      // R108 (Astra 5): en boks, koordinatoren saa aabne under tilknytningen, besvares nu - porten ville haenge bag den.
      if (s.boks) return await svarAaben(s.boks);
      // #69 (MAALT 13/10 i headless Chrome): staar en boks allerede aaben, svarer fanen ikke, og her kom Chromes noegne
      // «CDP did not respond within 8000 ms: Page.enable». En boks, der kom frem foer nogen lyttede, kan ikke besvares
      // gennem CDP - svaret siger det, og hvad der kan goeres.
      let portFejl = null;
      try {
        // 1.30.3: samme port som navigate - Page.enable inden for NAV_FRISTER.port, ellers svarer fanen ikke.
        const r = await venteMedFrist(cdpSend(tab.id, 'Page.enable', {}), NAV_FRISTER.port);
        if (r === FRIST_UDLOEB) throw cdpFristFejl(`CDP did not respond within ${NAV_FRISTER.port} ms: Page.enable`);
      } catch (e) {
        if (!erCdpFrist(e)) throw e;
        portFejl = e;
      }
      // R108 (Astra 5): ogsaa naar porten loeb ud - en boks, der blev kendt imens, er grunden, og den kan besvares.
      if (portFejl && s.boks) return await svarAaben(s.boks);
      if (portFejl) {
        const e = portFejl;
        // R174 (Opus, MAALT i Chrome 155): raadet her sagde, at browser_close_tab springer prompten over. Det holder for en alert
        // og en confirm, men mens «Leave site?» staar aaben, lukker Chrome ikke fanen.
        return { ok: false, error: 'tab-not-responding', detail: e.message,
          note: 'Chrome did not answer on this tab. A common cause is a dialog that is already open - an alert, a confirm or ' +
                'a "Leave site?" prompt that appeared before anything was listening. Such a dialog cannot be answered from ' +
                'here: ask the user to answer it in Chrome. An alert or a confirm also goes away if the tab is closed with ' +
                'browser_close_tab (anything unsaved on the page is lost); while "Leave site?" is open, Chrome does not close ' +
                'the tab. Next time, arm browser_handle_dialog before the action that opens it.' };
      }
      // R176 (Opus): armeringen bindes til hovedrammens dokument (loaderId), se loaderTjek.
      const loader = await hovedLoader(tab.id);
      // Astra R107 (maalt i model): en boks, der aabnede, mens Page.enable ventede, gav armed:true med 0 svar. Tilstanden
      // tjekkes derfor IGEN efter porten, foer der armeres.
      if (s.boks) return await svarAaben(s.boks);
      // R173 (Astra): et nyt dokument, mens tilknytningen og porten ventede, ses ikke af afvaebningen (der var intet at
      // afvaebne). Skiftede adressen imens, armeres der ikke.
      const nu = await chrome.tabs.get(tab.id).catch(() => null);
      const uden = (u) => String(u || '').split('#')[0];
      if (!nu || uden(nu.url) !== uden(tab.url) || sideSkiftet()) return sideSvar(nu);
      afvaebnDialog(tab.id, 'a new arming took over this tab');   // kun én ad gangen

      let opfyld;
      const svar = new Promise((resolve) => { opfyld = resolve; });
      const timer = setTimeout(() => {
        afvaebnDialog(tab.id);
        opfyld({ ok: false, error: `No dialog appeared within ${levetid} ms` });
      }, levetid);

      // Koordinatoren forbruger armeringen, naar boksen aabner, og opfylder loeftet, naar Chrome melder boksen lukket.
      armeredeDialoger.set(tab.id, { timer, action, accept: action === 'accept', text: promptText, leave: forlad,
        udloeb: Date.now() + levetid, opfyld, loader });
      dialogLoefter.set(tab.id, svar);

      if (vent) return await svar;

      // Armeret. Debuggeren bliver siddende — frakobler vi her, doer lytteren med den.
      return {
        ok: true,
        armed: true,
        action,
        expires_in_ms: levetid,
        ...(oensket > levetid ? { timeout_capped_from: oensket } : {}),
        ...(action === 'accept' ? { leave_page: forlad } : {}),
        note: (action === 'accept' && !forlad
          ? 'The next alert, confirm or prompt on this tab is accepted automatically. A "Leave site?" is not: the page may ' +
            'hold unsaved work, so ask the user (browser_ask_user) and arm again with leave_page: true if they agree. '
          : 'The next dialog on this tab is handled automatically. ') +
          (oensket > levetid ? `The arming lasts at most ${DIALOG_ARMERING.loft} ms. ` : '') + 'Now click whatever opens it.',
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
      // R55 (Opus, MAALT i Chrome): uden credentials:'omit' bar kaldet brugerens cookies til enhver https-adresse og
      // gemte svarets cookies i profilen - uden fane og uden for sessionens sider. Det er netop hvad get_cookies og
      // set_cookies afviser. Et API-kald bruger et token i headers; brugerens cookies foelger ikke med og gemmes ikke.
      const options = {
        method: params.method || 'GET',
        headers: params.headers || {},
        credentials: 'omit',
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
          error: 'domain-missing',
          hint: 'Give `domain`. Without it the call would return EVERY cookie in the profile — ' +
                'including from pages that have nothing to do with the task.',
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
          ok: false, error: 'cookie-store-unknown',
          hint: 'The tab is an incognito window, and Chrome did not report its cookie store. Nothing was read - otherwise ' +
                'the regular profile\'s cookies would be returned instead.',
        };
      }
      const vaertsnavne = sider.map((x) => x.vaert);
      // Argumentet normaliseres som fanens adresse - "bücher.example" ER xn--bcher-kva.example.
      let d = params.domain.trim().toLowerCase().replace(/^\.+/, '');
      try { if (d) d = new URL('http://' + d + '/').hostname; } catch {}
      const slaegt = (a, b) => a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
      if (!d || !vaertsnavne.some((h) => slaegt(h, d))) {
        return {
          ok: false, error: 'domain-not-in-session', domain: d, aabne: vaertsnavne,
          hint: 'Cookies can only be read for http(s) pages this session has open. Navigate to ' +
                'the page first - then the agent cannot read cookies from anything it is not working with.',
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
      // MAALT 11/9 af Opus og Fable (e2e-review): laesningen er begraenset til sessionens egne sider, men skrivningen satte
      // cookies paa ETHVERT domaene - ogsaa sider sessionen aldrig har aabnet (og butikkens begrundelse lovede det modsatte).
      // Samme regel begge veje: kun de http(s)-vaerter sessionen har aabne.
      // MAALT 11/9 (e2e runde 2): slaegtskabet blev laest BEGGE veje, saa en cookie til et uaabnet UNDERdomaene slap
      // igennem (Astra), adressen kom fra kalderen i stedet for sessionens side (Opus), og en inkognitofane skrev i den
      // almindelige profils lager (Opus). Reglen er nu laesningens: cookiens domaene skal vaere vaerten selv eller et
      // overdomaene vaerten faar cookies fra, adressen bygges af sidens egen oprindelse (saa Chrome haandhaever bl.a.
      // public suffix), og lageret foelger fanen.
      const saetSession = getSession(port);
      let saetUkendtLager = false;
      let saetLagre = null;
      try { saetLagre = await chrome.cookies.getAllCookieStores(); } catch {}
      const saetSider = [];
      for (const id of saetSession.tabIds) {
        const t = await chrome.tabs.get(id).catch(() => null);
        try {
          const u = new URL(t?.url || '');
          if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname) continue;
          const storeId = (saetLagre || []).find((l) => (l.tabIds || []).includes(id))?.id;
          if (t.incognito && !storeId) { saetUkendtLager = true; continue; }
          saetSider.push({ u, vaert: u.hostname.toLowerCase(), storeId });
        } catch {}
      }
      if (!saetSider.length && saetUkendtLager) {
        return {
          ok: false, error: 'cookie-store-unknown',
          hint: 'The tab is an incognito window, and Chrome did not report its cookie store. Nothing was written - otherwise ' +
                'the cookie would land in the regular profile instead.',
        };
      }
      // Sidens vaert faar cookies fra sig selv og fra sine overdomaener - ikke fra et underdomaene den ikke har aabnet.
      // MAALT 12/9 af Astra: `find` tog den FOERSTE fane der endte paa domaenet, saa en aaben a.example.com vandt over en
      // lige saa aaben example.com - og adressen blev derefter bygget af den forkerte vaert. Den noejagtige vaert vinder nu.
      // Slaegtskabs-stien (sidens vaert faar cookies fra sit overdomaene) kraever at kalderen SELV har sagt `domain`:
      // uden `domain` er cookien host-only, og saa kan oensket ikke opfyldes fra et underdomaene.
      const saetSideFor = (cd, eksplicitDomaene) =>
        saetSider.find((s) => s.vaert === cd)
        || (eksplicitDomaene ? saetSider.find((s) => s.vaert.endsWith('.' + cd)) : undefined);
      const results = [];
      const cookieList = Array.isArray(params.cookies) ? params.cookies : [params];
      for (const c of cookieList) {
        let cd = String(c.domain || '').trim().toLowerCase().replace(/^\.+/, '');
        if (!cd && c.url) { try { cd = new URL(c.url).hostname.toLowerCase(); } catch {} }
        try { if (cd) cd = new URL('http://' + cd + '/').hostname; } catch {}
        const side = cd ? saetSideFor(cd, Boolean(String(c.domain || '').trim())) : null;
        if (!side) {
          results.push({
            ok: false, name: c.name, error: 'domain-not-in-session', domain: cd || null,
            aabne: saetSider.map((s) => s.vaert),
            hint: 'Cookies can only be set for http(s) pages this session has open, and only for the page\'s own domain ' +
                  'or - if you supply domain yourself - a parent domain it receives cookies from. Navigate to the page first.',
          });
          continue;
        }
        try {
          const cookie = await chrome.cookies.set({
            // Adressen bygges af sessionens egen side - saa Chrome selv haandhaever sine domaeneregler (public suffix osv.).
            url: side.u.origin + (typeof c.path === 'string' && c.path.startsWith('/') ? c.path : '/'),
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path || '/',
            secure: c.secure !== false,
            httpOnly: c.httpOnly || false,
            sameSite: c.sameSite || 'lax',
            ...(side.storeId ? { storeId: side.storeId } : {}),
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
      // R57 (Opus, maalt i Chrome): paa Chromes fejlside og paa sider udvidelsen ikke maa tegne paa (about:blank,
      // chrome-extension://) kastede kaldet Chromes raa fejltekst - EFTER at fanen var aktiveret og en notifikation
      // oprettet, som aldrig blev ryddet. Derfor tjekkes fanen nu foer den aktiveres, og intet vises, naar spoergsmaalet
      // ikke kan tegnes.
      const tab0 = await getSessionTab(port);
      const adresse = tab0.url || tab0.pendingUrl || '';
      const vist = adresse.split(/[?#]/)[0] || 'an empty tab';
      const timeout = Number(params.timeout) || 120000;
      const fields = Array.isArray(params.fields) ? params.fields : [];
      const hasFields = fields.length > 0;
      const session = getSession(port);
      // En prompt med felter hoerer til det site, fanen staar paa. Uden et http(s)-origin kan svaret ikke bindes til
      // noget, saa den stilles ikke (R51).
      const origin = hasFields ? askOrigin(adresse) : null;
      if (hasFields && !origin) {
        throw new Error('browser_ask_user with fields needs the tab to be on a web page (http or https) or a local file, ' +
          'so the answer can be tied to that address. Navigate to the page first, or ask without fields.');
      }
      if (!/^(https?|file):/i.test(adresse)) {
        throw new Error(`browser_ask_user draws the question in the tab, and the tab shows ${vist}, where the extension ` +
          'cannot draw. Navigate to a web page or a local file first. Nothing was shown to the user.');
      }
      // R61 (Astra): «Nothing was shown» er kun sandt, naar fejlsiden opdages FOER fanen aktiveres.
      const fejlside = (vist2 = 'Nothing was shown to the user.') => new Error(`The tab shows Chrome's error page: ${vist} did ` +
        `not load, so the question cannot be drawn there. Navigate to a page that loads, then ask again. ${vist2}`);
      const rammer = await chrome.webNavigation.getAllFrames({ tabId: tab0.id }).catch(() => null);
      if (Array.isArray(rammer) && rammer.some((f) => f.frameId === 0 && f.errorOccurred)) throw fejlside();
      const tab = await getSessionTab(port, true);

      // Activate tab + alert badge
      await chrome.tabs.update(tab.id, { active: true });
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
      const notifId = 'mcp-ask-' + Date.now();
      // R57 (Opus): clear() kunne koere, foer create() var faerdig, og saa blev notifikationen staaende for et spoergsmaal,
      // agenten allerede havde opgivet. Rydningen venter nu paa oprettelsen.
      const notifKlar = Promise.resolve(chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: `${session.label} - Action Required`,
        message: params.message,
        requireInteraction: true,
        silent: false,
        priority: 2,
      })).catch(() => {});

      // A newer question in the same tab replaces the old one. Before, the old prompt was
      // removed from the page but its caller was left waiting until the server gave up.
      for (const ask of [...pendingAsks.values()]) {
        if (ask.tabId === tab.id) ask.finish({ acknowledged: false, action: 'replaced', values: {} });
      }

      // MAALT 21/8: her stod `params.title` raat. Skemaet siger at title er VALGFRI
      // med standarden "Agent360 - Action Required", men udelades den, er vaerdien
      // undefined — og chrome.scripting.executeScript afviser hele kaldet med
      // "Error at property 'args': Error at index 1: Value is unserializable".
      // Altsaa styrtede human-in-the-loop-vaerktoejet hver gang en agent fulgte sit
      // eget skema. Det blev aldrig fanget, fordi ask_user stod som "springes over"
      // i flowtesten — den eneste der kunne have set det.
      //
      // Alle vaerdier tvinges nu til serialiserbare vaerdier, og standarden
      // anvendes der hvor den er lovet.
      const askId = 'ask-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      const spec = {
        askId,
        message: String(params.message ?? ''),
        title: String(params.title ?? 'Agent360 - Action Required'),
        fields: fields.map((f) => ({
          name: String(f?.name ?? ''),
          label: String(f?.label ?? f?.name ?? ''),
          type: String(f?.type ?? 'text'),
        })),
        hasFields: Boolean(hasFields),
        sessionLabel: String(session.label ?? 'Claude'),
        deadline: Date.now() + timeout,
        origin,
      };

      let finish;
      const answered = new Promise((resolve) => {
        let timer;
        finish = (result) => {
          if (!pendingAsks.has(askId)) return;
          pendingAsks.delete(askId);
          clearTimeout(timer);
          if (result.action !== 'done' && result.action !== 'skip') eraseAskPrompt(tab.id, askId);
          // Restore badge
          const count = sessions.size;
          chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
          chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
          notifKlar.then(() => chrome.notifications.clear(notifId)).catch(() => {});
          resolve(result);
        };
        timer = setTimeout(() => finish({ acknowledged: false, action: 'timeout', values: {} }), timeout);
      });
      const ask = { tabId: tab.id, spec, finish, origin };
      pendingAsks.set(askId, ask);

      try {
        await drawAskPrompt(ask, false);
      } catch (e) {
        finish({ acknowledged: false, action: 'error', values: {} });
        // Fejlsiden kan ogsaa opstaa mellem tjekket og tegningen.
        if (/showing error page/i.test(e?.message || '')) {
          throw fejlside('The tab had already been made active and a notification posted; the notification is removed as soon as it exists.');
        }
        throw e;
      }
      return answered;
    }

    case 'select_frame': {
      const start = modtaget;
      const slut = agentKodeSlut(start);
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot access chrome:// pages');
      const frameIndex = params.frame_index ?? 0;
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      if (!frames || frameIndex >= frames.length) {
        return { error: `Frame ${frameIndex} not found. Available: ${frames?.length || 0} frames`, frames: frames?.map((f, i) => ({ index: i, url: f.url })) };
      }
      const valgt = frames[frameIndex];
      // Som i execute_script (v1.26): accepter `script` som alias for `code`. Samme navne-uoverensstemmelse har foer
      // faaet vaerktoejer til at se brudte ud i tavshed.
      if (params.code == null && typeof params.script === 'string') params.code = params.script;
      // 1.31.0: kun gennem debuggeren, i framens STANDARDkontekst (framens egne globale variabler, som MAIN foer). Uden
      // kode laeses framens tekst med et fast udtryk fra pakken - ingen streng bygges eller kompileres i udvidelsen.
      const code = params.code || FRAME_TEKST_UDTRYK;
      let maal;
      try {
        maal = await findFrameKontekst(tab.id, frames, valgt, slut);
      } catch (e) {
        // Er framen vaek i mellemtiden, er fejlen forbigaaende, uanset hvad opslaget sagde. Opslaget er ogsaa bundet af tiden.
        const findes = !!(e && e.varig) && await inden(Promise.resolve().then(() => chrome.webNavigation.getFrame({ tabId: tab.id, frameId: valgt.frameId })),
          Math.min(slut, Date.now() + 300), 'checking the frame').catch(() => null);
        const varig = !!(e && e.varig) && !!findes;
        return { ok: false, error: 'frame-not-reachable', sent: false, retry: !varig, frame_url: valgt.url, detail: String(e?.message || e),
          note: varig
            ? 'Nothing was run. The extension may not run in this frame, so it cannot be identified through the Chrome ' +
              'debugger, and calling again will give the same answer. Work with it from the page instead (browser_execute_script, ' +
              'or tools such as browser_click and browser_get_page_content).'
            : 'Nothing was run. The frame was not found, or the search was incomplete when the call ran out of time (the frame ' +
              'may still be loading, or it navigated, closed or was replaced). Call browser_list_frames and try once more.' };
      }
      try {
        // frame_url er adressen paa det dokument, maerket blev sat i (og koden koerte i) - ikke getAllFrames' aeldre bud.
        return { ...(await koerAgentKode(tab.id, code, maal.kontekst, slut, vagt)), frame_url: maal.adresse || valgt.url };
      } catch (e) {
        // Framens kontekst forsvandt, mellem den blev fundet og koden blev sendt (fx en side, der udskifter sine frames):
        // intet er koert, og et nyt forsoeg kan lykkes.
        if (e && e.ikkeSendt) {
          return { ok: false, error: 'frame-not-reachable', sent: false, retry: true, frame_url: maal.adresse || valgt.url, detail: e.message,
            note: 'Nothing was run; the frame changed or the call ran out of time before the code could be sent. Call ' +
                  'browser_list_frames and try once more.' };
        }
        throw e;
      } finally {
        // Oprydningen (maerket, auto-attach) koerer videre efter svaret og holder det ikke (R133, Astra).
        maal.ryd().catch(() => {});
      }
    }

    case 'list_frames': {
      const tab = await getSessionTab(port);
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      return { frames: frames?.map((f, i) => ({ index: i, url: f.url, frame_id: f.frameId, parent_frame_id: f.parentFrameId })) || [] };
    }

    case 'get_new_tab': {
      // 1.34 (#89): se nyeFaner ved onCreated. Kun faner aabnet fra sessionens egne faner, og - uden tab_id - kun siden dens sidste
      // input. Brugerens faner og andre sessioners kommer aldrig i betragtning, saa der er intet not-ours-svar med et fremmed fane-id.
      const vent = Math.min(Math.max(Number(params.wait_ms ?? 3000) || 0, 0), 10000);
      const session = getSession(port);
      const giv = async (id) => {
        let tab;
        try { tab = await chrome.tabs.get(id); } catch { nyeFaner.delete(id); return null; }
        await addTabToSession(port, id);
        nyeFaner.delete(id);
        return { id: tab.id, url: tab.url, title: tab.title };
      };
      if (params.tab_id != null) {
        const e = nyeFaner.get(params.tab_id);
        if (!e || e.session !== session) {
          return { error: 'not-a-new-tab-of-yours', note: 'Only a tab that one of your own tabs opened, that is still open and has not been ' +
            'handed to you yet, can be chosen here. A tab the user opened is theirs. Use browser_navigate(new_tab: true) to open one.' };
        }
        const svar = await giv(params.tab_id);
        if (svar) return svar;
        return { error: 'tab-closed', tab_id: params.tab_id, note: 'That tab closed before it could be handed to you. ' +
          'Call browser_get_new_tab without tab_id to see the tabs that are still open.' };
      }
      const sidenInput = () => {
        const nr = session.inputNr || 0;
        let id = null;
        for (const [t, e] of nyeFaner) if (e.session === session && e.input === nr) id = t;   // den nyeste
        return id;
      };
      const slut = Date.now() + vent;
      for (;;) {
        const id = sidenInput();
        if (id != null) { const svar = await giv(id); if (svar) return svar; continue; }
        if (Date.now() >= slut) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const tidligere = [];
      for (const [t, e] of [...nyeFaner]) {
        if (e.session !== session) continue;
        try { const tab = await chrome.tabs.get(t); tidligere.push({ id: tab.id, url: tab.url, title: tab.title }); }
        catch { nyeFaner.delete(t); }
      }
      return {
        error: 'no-new-tab-yet', waited_ms: vent, earlier_new_tabs: tidligere.slice(-5),
        note: 'No tab has opened from your tabs since your last click, key press, script or list choice. If the page opens ' +
          'it a moment later, call again (wait_ms waits up to 10 s). A popup blocker can stop a tab when the click went ' +
          'through a script. earlier_new_tabs are tabs your tabs opened before that; pass one as tab_id if it is the one you meant.',
      };
    }

    case 'set_group_label': {
      // #91 (1.34): agenten navngiver sin fanegruppe, saa brugeren kan se hvilken gruppe der hoerer til hvilken opgave. Navnet staar
      // paa sessionen (som gruppen tegnes ud fra), og maerket egetNavn faar gendannelsen til at beholde det. Tomt navn = standard.
      const session = getSession(port);
      const farve = params.color == null || params.color === '' ? null : String(params.color).toLowerCase();
      if (farve != null && !GRUPPE_FARVER.includes(farve)) {
        return { error: 'bad-color', colors: GRUPPE_FARVER, note: 'Chrome tab groups only have these colours. Nothing was changed.' };
      }
      const navn = String(params.label ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30).trim();
      if (navn) {
        session.label = navn;
        session.egetNavn = true;
        if (farve) session.color = farve;
      } else {
        session.label = `Claude ${session.nummer}`;
        session.egetNavn = false;
        session.color = farve || SESSION_COLORS[((session.nummer || 1) - 1) % SESSION_COLORS.length];
      }
      let anvendt = false;
      if (session.groupId != null) {
        try { await chrome.tabGroups.update(session.groupId, { title: session.label, color: session.color }); anvendt = true; }
        catch { /* gruppen er vaek; naeste gruppe tegnes med navnet */ }
      }
      persistSessions();
      return { ok: true, label: session.label, color: session.color, applied: anvendt,
        ...(anvendt ? {} : { note: 'Your session has no tab group yet; the name is used when its first tab is grouped.' }) };
    }

    case 'switch_tab': {
      const session = getSession(port);
      if (!session.tabIds.has(params.tab_id)) {
        throw new Error(`Tab ${params.tab_id} does not belong to this session (${session.label})`);
      }
      // 14/10 (Gustav: «den bliver ved med at tage min computer»): MAALT i transskripterne - to underagenter kaldte
      // switch_tab 125 gange paa 8 minutter, og hvert kald hev Chrome frem foran det program han arbejdede i. Vinduet
      // tages derfor KUN frem med bring_to_front: true. Fanen goeres stadig aktiv i sit vindue, saa den kan modtage mus og
      // taster. (MAALT 14/10 i headless Chrome: en regel om ikke at skifte fane i brugerens eget vindue fik fire klik-tilfaelde
      // til at fejle, fordi fanen saa aldrig blev aktiv. Agentens egen fane i sit eget vindue: navigate med eget_vindue.)
      // 31/8-laeren staar ved magt: et tildaekket vindue er 'hidden', og Chrome struber dets timere. Svaret siger det
      // derfor (visibility), i stedet for at tage skaermen for at undgaa det.
      const foran = params.bring_to_front === true;
      let tab = await chrome.tabs.get(params.tab_id);
      if (tab.active !== true) tab = (await chrome.tabs.update(tab.id, { active: true })) || tab;
      let vinduesFokus = null;   // null = ikke forsoegt
      if (foran) {
        try {
          await chrome.windows.update(tab.windowId, { focused: true });
          vinduesFokus = true;
        } catch (e) {
          // Vinduet kan vaere lukket eller paa et andet Space. Fanen er stadig aktiv;
          // svaret siger aerligt at den ikke kunne bringes frem.
          vinduesFokus = false;
        }
      }
      skiftAktiv(session, tab.id);
      persistSessions();
      let synlighed = null;
      try {
        const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.visibilityState });
        synlighed = r?.result ?? null;
      } catch { /* en side scripts ikke maa naa (chrome://, butikken): synligheden er ukendt */ }
      const svar = { id: tab.id, url: tab.url, title: tab.title, windowFocused: vinduesFokus, visibility: synlighed };
      // Husets maaling (README «The agent keeps pulling a tab in front of me»): taster, hover, koordinatklik og udfyldning
      // af et felt fundet ved tekst lander kun, naar Chrome har styresystemets fokus. Uden den saetning sender vaerktoejernes
      // «call browser_switch_tab and try again» agenten i ring.
      if (vinduesFokus !== true) {
        svar.note = (synlighed === 'hidden'
          ? 'The page is hidden (its window is covered or minimized), and Chrome slows timers in hidden pages, so a page ' +
            'that is still building can be read half-done: wait for the content you need with browser_wait. A list that ' +
            'loads while scrolling (browser_extract_list) stops early in a hidden page; if the page has to be visible, ask ' +
            'the user (browser_ask_user) and only then call again with bring_to_front: true. '
          : '') +
          'Chrome was left where it is, not brought in front of the user. Navigating, reading, screenshots, scripts and ' +
          'clicks by selector work like this. Key presses, hover, coordinate clicks and fields found by text may not land ' +
          'while Chrome is not in front: read landed in their answers. If one of them answers that nothing landed, ask the ' +
          'user (browser_ask_user) and only then call again with bring_to_front: true.';
      }
      return svar;
    }

    case 'close_tab': {
      const session = getSession(port);
      const tabId = params.tab_id;
      if (!session.tabIds.has(tabId)) {
        throw new Error(`Tab ${tabId} does not belong to this session (${session.label})`);
      }
      // Maerk lukningen som agentens egen. Ellers laeser onRemoved den tomme session som
      // "brugeren er faerdig" og lukker serveren ned midt i samtalen (MAALT 22/8).
      // 1.33 (privat rapport 3.1, MAALT paa 1.30.1): var fanen den sidste i Chromes sidste vindue, lukkede vinduet - og paa
      // Windows og Linux hele Chrome, saa naeste kald fik «extension not connected». Nu bliver en tom fane staaende i vinduet,
      // og svaret siger det. Lukningen afvises ikke: serveren lukker selv en partitions faner gennem close_tab.
      // R173 (Astra, MAALT): et afvist opslag eller en afvist oprettelse blev slugt, og fanen blev lukket alligevel; og to
      // samtidige lukninger saa begge to faner og lukkede dem begge. Nu standser en fejl lukningen (intet lukkes), og
      // lukningerne koerer én ad gangen, saa den anden ser vinduet, som det er efter den foerste.
      // R174 (Opus, MAALT i Chrome 155): chrome.tabs.remove svarer aldrig, naar siden viser «Leave site?» eller er travl - og med
      // én faelles koe stoppede én saadan lukning alle close_tab i alle sessioner. Koeen daekker nu kun tjekket af vinduet og den
      // tomme fane og slippes, saa snart fjernelsen er SENDT; faner under lukning taelles ikke med som tilbage i vinduet.
      const forbered = async () => {
        let holdtAaben = false;
        const fane = await chrome.tabs.get(tabId);
        // R173 (Opus, MAALT i rigtig Chrome): et popup- eller app-vindue holder ogsaa Chrome i live, ikke kun et normalt.
        const vinduer = await chrome.windows.getAll({ populate: true, windowTypes: ['normal', 'popup', 'app'] });
        const andre = (w) => (w.tabs || []).some((t) => t.id !== tabId && !fanerUnderLukning.has(t.id));
        const mit = vinduer.find((w) => w.id === fane.windowId);
        if (!(mit && andre(mit)) && !vinduer.some((w) => w.id !== fane.windowId && andre(w))) {
          await chrome.tabs.create({ windowId: fane.windowId, url: 'about:blank', active: false });
          // Staar en anden fane i vinduet stadig og venter paa at blive lukket, er det ikke sikkert, at denne var den sidste.
          holdtAaben = (mit && (mit.tabs || []).some((t) => t.id !== tabId && fanerUnderLukning.has(t.id))) ? 'ventende' : true;
        }
        agentLukkedeFaner.add(tabId);
        fanerUnderLukning.add(tabId);
        const fjern = chrome.tabs.remove(tabId);
        const ryd = () => fanerUnderLukning.delete(tabId);
        fjern.then(ryd, ryd);
        return { holdtAaben, fjern };
      };
      // R176 (Astra, MAALT): fristen begyndte efter forberedelsen, saa et kald kunne vare laengere end serverens 5 s.
      const slut = Date.now() + LUK_FANE.ms;
      const tur = fanelukninger.then(forbered);
      fanelukninger = tur.catch(() => {});
      const { holdtAaben, fjern } = await tur;
      if (await venteMedFrist(fjern, Math.max(0, slut - Date.now())) === FRIST_UDLOEB) {
        // R176 (Astra, MAALT i modellen): en udloebet frist er ikke bevis for, at lukningen er opgivet - fjernelsen gik igennem
        // 400 ms senere, og en lukning af den anden fane imens havde regnet med, at denne holdt vinduet aabent: nul faner.
        // Fanen bliver derfor «under lukning», til Chrome svarer. Prisen er i hoejst en unoedig tom fane (R175, Opus), aldrig et
        // lukket Chrome.
        return { ok: false, error: 'tab-not-closed', tab_id: tabId, ...(holdtAaben ? { kept_window_open: true } : {}),
          note: `Chrome did not close the tab within ${LUK_FANE.ms} ms: the page may be asking "Leave site?" (it may hold ` +
            'unsaved work) or be busy, and the tab is still open. The close may still happen later, if the prompt is answered ' +
            'with Leave. Ask the user (browser_ask_user) to look at the tab.' +
            (holdtAaben ? ' An empty tab was already left in the window, because this looked like the last tab.' : '') };
      }
      session.tabIds.delete(tabId);
      const varAktiv = session.activeTabId === tabId;
      if (varAktiv) session.activeTabId = null;
      persistSessions();
      // R173 (Opus): efter at agenten lukkede sin aktive fane, svarer naeste kald no-active-tab - det skal staa i svaret.
      return { ok: true, remaining: session.tabIds.size, ...(varAktiv && session.tabIds.size ? { active_tab: null,
        active_note: 'This was the session\'s active tab, so the session has no active tab now: call browser_switch_tab ' +
          'with the tab to continue in (browser_list_tabs lists them) before the next call.' } : {}),
        ...(holdtAaben ? { kept_window_open: true,
        note: holdtAaben === 'ventende'
          ? 'An empty tab was left in this window: the only other tab in Chrome is still being closed (its close has not ' +
            'finished), and if it goes, Chrome would close and disconnect the extension.'
          : 'This was the last tab in Chrome\'s last window, so an empty tab was left in that window: closing it would ' +
            'have closed Chrome and disconnected the extension.' } : {}) };
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
        const result = await clickCaptchaGridCells(tab.id, cells, params.grid);
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
          return { ok: false, error: 'DOM.getDocument returned no root element' };
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
          return { ok: false, error: 'No file given. Use `files` (array) or `file` (a single path).' };
        }
        // #67: samme fejlklasse som drop_file - en side, der laeser filen og rydder feltet, gav file-not-attached.
        const noegle = '__bmcp_upload_' + Math.random().toString(36).slice(2, 10);
        await evalAttached(tab.id, `(${armerFilSkiftISiden.toString()})(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(noegle)})`).catch(() => {});
        await cdpSend(tab.id, 'DOM.setFileInputFiles', {
          nodeId: nodeId,
          files: files,
        });

        await debuggerDetach(tab.id);
        // Vaerktoejets egen dom SIDST, som i click og press_key: kvitteringen er ikke et bevis.
        const vedhaeftet = await laesVedhaeftedeFiler(tab.id, selector);
        const skift = await debuggerEval(tab.id, `(${laesFilSkiftISiden.toString()})(${JSON.stringify(noegle)})`)
          .then((j) => (j ? JSON.parse(j) : null)).catch(() => null);
        return fildSvar(vedhaeftet, files, { files: files, input: info }, skift);
      } catch (e) {
        try { await debuggerDetach(tab.id); } catch {}
        const filAdgang = await filAdgangsSvar(e.message);
        if (filAdgang) return { ok: false, ...filAdgang };
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

// Koeres i siden (se detectCaptcha). Selvstaendig, saa den kan proeves uden en browser (test/captcha-fund.test.mjs).
function captchaFund() {
  const res = { found: false, types: [] };

  // 1.33 (privat rapport 2.2, MAALT af begge bedoemmere): en anchor-ramme med size=invisible (det usynlige maerke) blev
  // meldt som recaptcha_v2_checkbox, og navigate bad om browser_solve_captcha paa en side uden noget at loese. Nu er en
  // usynlig reCAPTCHA en oplysning (invisible), ikke et fund; et afkrydsningsfelt og en billedudfordring taeller kun,
  // naar de kan ses - reCAPTCHA indlaeser udfordringens ramme skjult paa forhaand.
  const kanSes = (el) => {
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10 || r.right + window.scrollX <= 0 || r.bottom + window.scrollY <= 0) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.visibility === 'hidden' || st.visibility === 'collapse' || parseFloat(st.opacity) === 0) return false;
    }
    return true;
  };
  const ankre = [...document.querySelectorAll('iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]')];
  const usynligt = (f) => /[?&]size=invisible(&|$)/.test(f.getAttribute('src') || '');
  const recaptchaAnchor = ankre.find((f) => !usynligt(f) && kanSes(f));
  if (recaptchaAnchor) {
    res.found = true;
    res.types.push('recaptcha_v2_checkbox');
    const container = document.querySelector('.g-recaptcha');
    if (container) res.sitekey = container.getAttribute('data-sitekey');
  }

  // reCAPTCHA v2 — image challenge iframe
  const recaptchaChallenge = [...document.querySelectorAll('iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"]')].find(kanSes);
  if (recaptchaChallenge) {
    res.found = true;
    if (!res.types.includes('recaptcha_v2_checkbox')) res.types.push('recaptcha_v2_image');
    res.types.push('recaptcha_v2_challenge_visible');
    // Get iframe dimensions for grid clicking
    const rect = recaptchaChallenge.getBoundingClientRect();
    res.challengeFrame = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  // Usynlig reCAPTCHA (maerket eller en anchor med size=invisible): meldes, saa tilstedevaerelsen ikke skjules, men er
  // ikke et fund - der er intet at klikke.
  const usynlige = [];
  if (!recaptchaAnchor && !recaptchaChallenge && (document.querySelector('.grecaptcha-badge') || ankre.some(usynligt))) {
    usynlige.push('recaptcha');
  }

  // hCaptcha. R174 (Opus, MAALT i Chrome): et usynligt hCaptcha (data-size=invisible) gav found:true - samme klasse som 2.2.
  // Et fund kraever en ramme eller et felt, der kan ses; et usynligt felt taeller ikke.
  const hc = [...document.querySelectorAll('iframe[src*="hcaptcha.com"], .h-captcha')];
  if (hc.length) {
    if (hc.some((el) => kanSes(el) && el.getAttribute('data-size') !== 'invisible')) {
      res.found = true;
      res.types.push('hcaptcha');
      const container = document.querySelector('.h-captcha');
      if (container) res.sitekey = container.getAttribute('data-sitekey');
    } else usynlige.push('hcaptcha');
  }

  // Cloudflare Turnstile. R174 (Opus, MAALT i Chrome): et skjult Turnstile (appearance interaction-only) gav found:true.
  const ts = [...document.querySelectorAll('iframe[src*="challenges.cloudflare.com"], .cf-turnstile')];
  if (ts.length) {
    if (ts.some(kanSes)) {
      res.found = true;
      res.types.push('cloudflare_turnstile');
      const container = document.querySelector('.cf-turnstile');
      if (container) res.sitekey = container.getAttribute('data-sitekey');
    } else usynlige.push('turnstile');
  }
  if (usynlige.length) {
    res.invisible = usynlige;
    res.invisible_note = 'An invisible CAPTCHA (' + usynlige.join(', ') + ') is on this page: there is nothing to click, it checks the visit in the background. If the page still blocks you, ask the user with browser_ask_user.';
  }

  // Cloudflare challenge page (5-second interstitial)
  if (document.title.includes('Just a moment') || document.querySelector('#challenge-running')) {
    res.found = true;
    res.types.push('cloudflare_challenge_page');
    res.note = 'Cloudflare challenge page. It may clear by itself: wait 5-10 seconds with browser_wait and detect again, and if it does not clear, ask the user with browser_ask_user.';
  }

  // FunCaptcha / Arkose Labs
  const funcaptcha = document.querySelector('#FunCaptcha, iframe[src*="funcaptcha"], iframe[src*="arkoselabs"]');
  if (funcaptcha) {
    res.found = true;
    res.types.push('funcaptcha');
  }

  if (!res.found) res.note = res.invisible ? 'No CAPTCHA to solve on this page.' : 'No CAPTCHA detected on this page.';
  res.pageUrl = window.location.href;
  return res;
}

async function detectCaptcha(tabId) {
  try {
    await debuggerAttach(tabId);
    const { result } = await cdpSend(tabId, 'Runtime.evaluate', {
      expression: `(${captchaFund})()`,
      returnByValue: true,
    });
    await debuggerDetach(tabId);
    return result.value;
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
        // 1.33 (2.2): aldrig det usynlige maerkes anchor - det er intet afkrydsningsfelt.
        const iframe = [...document.querySelectorAll('iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]')]
          .find((f) => !/[?&]size=invisible(&|$)/.test(f.getAttribute('src') || ''));
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

async function clickCaptchaGridCells(tabId, cells, grid) {
  // 8/10 (1.30.2 skive 1b): gitteret blev gaettet ud fra de valgte celler, saa et 4x4-gitter med fx [8]
  // blev klikket som 3x3. Agenten har lige set udfordringen paa sit skaermbillede og kan sige det selv.
  if (grid === null) grid = undefined; // null betyder udeladt (R39)
  // R40 (Astra): et decimalt indeks som 3.9 gav et klik uden for gitteret og clicked: true.
  if (!Array.isArray(cells) || cells.some(c => !Number.isInteger(c))) {
    return { clicked: false, error: `cells must be whole numbers (0-indexed grid cells), not ${JSON.stringify(cells)}` };
  }
  if (grid !== undefined && grid !== 3 && grid !== 4) {
    return { clicked: false, error: `grid must be 3 or 4 (the size of the image grid you see), not ${JSON.stringify(grid)}` };
  }
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
    const cols = grid ?? (cells.some(c => c >= 9) ? 4 : 3);
    const rows = cols;
    const cellSize = gridSize / cols;

    const maxCell = cols * rows - 1;
    // R39/R40: en celle uden for gitteret er en fejl i kaldet, ikke noget der tavst springes over -
    // med eller uden opgivet grid (indeks 16 er aldrig gyldigt, et negativt heller ikke).
    if (cells.some(c => c < 0 || c > maxCell)) {
      await debuggerDetach(tabId);
      return { clicked: false, error: `Cell indices ${JSON.stringify(cells.filter(c => c < 0 || c > maxCell))} do not fit a ${cols}x${rows} grid (valid range: 0-${maxCell})` };
    }
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
      gridFrom: grid ? 'given' : 'guessed from the cell indices; pass grid: 3 or 4 to say which grid you see',
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
chrome.runtime.onInstalled.addListener(async (detaljer) => {
  // Foerst: aeldre udgaver gemte parametre (adgangskoder, cookie-vaerdier) i historikken.
  await rensHandlingslog();
  // ⛔ Ved en NY installation findes der ingen gammel bro at erstatte - den eneste bro er den
  // der lige nu er ved at blive bygget. At lukke den er praecis det der efterlod broen
  // halvdoed for en ny bruger (maalt 24/9). Saa ved installation: vent paa den, og faerdig.
  if (detaljer?.reason === 'install') {
    await ensureOffscreen().catch(console.error);
    return;
  }
  // Ved opdatering og genindlaesning ER den gamle bro foraeldet. Luk og byg gaar gennem koeen,
  // saa en halvfaerdig bro aldrig lukkes midt i sin opbygning (26/9).
  await chrome.storage.local.set({ offscreenGenskabt: 0, offscreenPauseTil: 0 });
  genbygOffscreen().catch(console.error);
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
      let gen = null;
      if (iHukommelsen) {
        if (iHukommelsen.tabIds.size > 0) return;   // den arbejder igen — lad den vaere
        gen = iHukommelsen.gen ?? null;
      } else {
        const { sessions: gemte } = await chrome.storage.local.get({ sessions: {} });
        const gemt = gemte[String(port)];
        if (!gemt) return;                          // sessionen er reelt vaek
        if ((gemt.tabIds || []).length > 0) return; // den arbejder igen
        gen = typeof gemt.gen === 'string' ? gemt.gen : null;
      }
      // 1.32 (S4): bestillingen gaelder den forbindelse, der ejede sessionen - ikke den, der har porten, naar beskeden naar frem.
      frivilligtFrigivet.set(port, gen);
      chrome.runtime.sendMessage({ type: 'terminate_mcp_session', port, gen }).catch(() => {});
    })().catch(() => {});
  }
});
