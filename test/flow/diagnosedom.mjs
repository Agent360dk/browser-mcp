/**
 * Hvad selv-diagnosen SKAL sige i flow-spaerren - som en ren funktion, saa den kan proeves uden Chrome.
 *
 * To maal, to domme:
 *  - Kandidaten (PR, udgivelse): kun én udvidelse, samme version som serveren, dommen 'current'/'unknown'.
 *  - Det udgivne i udgivelsesvinduet (haandkoersel med BMCP_UDVIDELSE_KILDE, butikkens udvidelse AELDRE end
 *    serveren): dommen er SANDT 'outdated', og raadet skal naevne butikkens gennemgang.
 *    MAALT 28/9 run 36413655181 (butik 1.30.0 + server 1.30.1): 51 OK, 1 FEJL - netop denne dom, som var sand.
 *    (backlog 1.30.2 #12)
 * Lempelsen gaelder KUN naar det udgivne maales og udvidelsen er aeldre; kandidatens gate er uaendret.
 */
export function sammenlign(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export function diagnoseFejl(data, { publiceretUdvidelse = false } = {}) {
  const miljoe = data?.environment || {};
  const forbundne = miljoe.extensions_connected || [];
  const aktiv = forbundne.filter((e) => e.active);
  const ext = aktiv[0]?.version, srv = miljoe.mcp_server_version;
  const fejl = [];
  if (forbundne.length !== 1) {
    fejl.push(`${forbundne.length} Browser MCP-udvidelser forbundet - slaa de andre fra, ellers testes ikke kandidaten`);
  }
  const vindue = Boolean(publiceretUdvidelse && ext && srv && sammenlign(ext, srv) < 0);
  if (vindue) {
    if (data?.verdict !== 'outdated') {
      fejl.push(`udgivelsesvinduet (butik ${ext} < server ${srv}): dommen skal vaere 'outdated', fik ${data?.verdict}`);
    }
    const raad = (data?.fix_steps || []).join(' ');
    if (!/Chrome Web Store/.test(raad) || !/review/i.test(raad)) {
      fejl.push(`udgivelsesvinduet: raadet naevner ikke butikkens gennemgang: ${raad.slice(0, 160)}`);
    }
  } else {
    if (!['current', 'unknown'].includes(data?.verdict)) {
      fejl.push(`forkert dom: ${data?.verdict} - udvidelsen er foraeldet, i konflikt eller ikke forbundet`);
    }
    if (!(aktiv.length === 1 && ext === srv)) {
      fejl.push(`udvidelsen er ${ext}, serveren er ${srv} - indlaes kandidaten`);
    }
  }
  return { fejl, vindue };
}
