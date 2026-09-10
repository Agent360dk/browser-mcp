# Browser MCP - Wishlist

This is the public list of features people have asked for. Open and curated by Agent360.

## How to add a wish

- **Easy:** [Open a wish issue](https://github.com/Agent360dk/browser-mcp/issues/new?template=wish.yml) - fill the form, we'll triage and roll it in.
- **Faster:** Ask Claude in your session to "submit a wish for browser-mcp to do X" - it knows the format.
- **PR directly:** Edit this file and open a pull request with your bullet under **🟡 Wanted**.

When a wish gets implemented, it moves to **✅ Shipped** with the version it landed in.

---

## 🟡 Wanted

- **Profile pairing - bind one MCP server to one Chrome profile**
  ([#10](https://github.com/Agent360dk/browser-mcp/issues/10)). With the extension active in
  two profiles (work + personal), both connect to every server in the port range and which
  one wins is a race. An opt-in token (`AGENT360_TOKEN`) would let two MCP entries target two
  profiles deliberately. Accepted, not scheduled - say so on the issue if you need it.
  *Note on the security framing: the current `Origin` check proves "some Chrome extension",
  not which profile, and a local program can set that header itself. An opt-in token doesn't
  change that for users who leave it off - the value here is profile pairing, not auth.*

- [💡 Submit a wish →](https://github.com/Agent360dk/browser-mcp/issues/new?template=wish.yml)

---

## 🚧 Landet på `main`, endnu ikke udgivet

Rettelserne herunder er lavet, testet og committet, men **ingen udgivelse har fundet sted endnu**,
så de er ikke i den udvidelse eller den npm-pakke du har. Står her fordi det er ærligere end at
lade dem stå under «Shipped» - hvilket de gjorde ved en fejl indtil 9/9.

- **Skærmbilledet kunne fotografere din egen fane.** Fejlede CDP-optagelsen, faldt koden tilbage
  på `captureVisibleTab`, som fotograferer den *synlige* fane, ikke agentens. Et tjek før og efter
  kunne ikke udelukke at du skiftede fane imellem, så reserveløsningen er fjernet helt: billedet
  kommer fra agentens egen fane, eller kaldet fejler. En frist giver ét forsøg, ikke en ny runde.
- **`browser_scroll` med pixels ramte 30-sekunders-loftet hver gang.** CDP's hjulafsendelse indfrier
  aldrig sit løfte, og reserveløsningen lå i et `catch` den aldrig nåede. Nu 1,5 sekund, og
  reserveløsningen ruller mod en målposition. Kan startpositionen ikke læses, ruller den ikke igen -
  den siger det i stedet for at risikere at rulle dobbelt.
- **`browser_click` sagde ja uden bevis og kunne klikke to gange.** Reserveløsningen fyrede både
  `dispatchEvent('click')` og `el.click()`, så dropdowns åbnede og lukkede igen ([#19]). Nu ét klik,
  og `ok` afgøres af om siden ændrede sig, også afkrydsninger og feltværdier. Navigerer siden, tæller
  det som landet; en anden fejl svares som uvist. Fejler debuggeren efter at museknappen er sendt,
  klikkes der ikke igen, og knappen slippes altid. `click`, `click_xy` og `select_option` bruger samme regel.
- **`fill`, `set_date` og `execute_script` sagde ja til noget andet.** `fill` kunne efterlade `XX`
  eller en afvist værdi og svare ok; nu meldes et felt der viser noget andet end det skrevne,
  med den faktiske værdi - også når det blot er formatering, fordi hver regel for det blev omgået.
  `set_date` godkendte `20/12/2026` som 2. januar; nu læses datoen efter feltets format.
  `execute_script` kunne køre din kode to gange og afventede ikke et Promise.
- **Taster kunne sidde fast.** Timede et tastetryk ud efter at være landet, blev tasten aldrig
  sluppet. Nu slippes den altid, også i udfyldning og kalendere.
- **Agenten kunne nå ting der ikke var dens.** `get_new_tab` adopterede faner du selv åbnede.
  `get_cookies` kunne læse cookies fra ethvert domæne, også via en fane på `https://com/`, en
  `file:`-fane eller den forkerte profil i inkognito; nu kun det Chrome ville sende til sessionens egne
  sider. `upload_file` sendte vilkårlige filstier videre; nu kun almindelige filer inde i arbejdsmappen,
  ikke via symlinks, mapper eller hardlinks. Et skærmbillede med `path` skriver heller ikke gennem et link.
- **Et muterende CDP-udtryk kunne køre fire gange.** `Runtime.evaluate` stod på retry-listen, men
  flere af vores egne udtryk muterer - settle-udtrykket fyrer selve klikket. Nu gentages det ikke.
- **`set_combobox` brugte 8,5 sekunder på at sige nej** til en almindelig `<select>` den aldrig
  kunne betjene. Nu genkendes den straks, og svaret navngiver `browser_select_option`.
- **Én frist på alle CDP-kald brækkede tre ting**, og er nu delt pr. kald: skærmbilledet kunne bruge
  over 30 sekunder, og `execute_script` blev kappet fra 30 til 8 sekunder.
- **Serverens egen instruks løj** om skærmbilleder, og ni sider sagde 34, 41 eller 42 værktøjer.
  Begge rettet, og docs-gaten kender de formuleringer nu.

---

## ✅ Shipped

- **IKKE UDGIVET - v1.29.1. Punkterne herunder ligger på `main` og venter en udgivelse.**
  (Stod fejlagtigt som shipped fra 8/9 til 9/9. Fem fejl af samme familie: værktøjet sagde ét og
  gjorde et andet.)
  Fundet ved at køre værktøjerne mod en ægte React-formular, ikke ved at læse koden.
  - `select_option` meldte **fiasko om valg der lykkedes.** Vagten læste feltet synkront
    efter hændelsen - men et styret felt der arbejder ser præcis sådan ud: det gemmer
    valget et andet sted og nulstiller sig selv. Nu tages et aftryk af siden, og rollback
    meldes kun når *intet andet* ændrede sig.
  - `fill` **skrev ovenpå i stedet for at erstatte.** To kald gav
    `"test@example.dkanden@example.dk"` - og begge svarede ok. Cmd+A og Backspace tømmer
    ikke et styret felt. Nu læses feltet tilbage efter rydningen.
  - **Brugerens lukning af sidste fane frigav ikke porten** når Chromes baggrundsproces
    sov. Halvdelen af hele frigivelsens præmis virkede kun når processen tilfældigvis var
    vågen. Fælden: `restoreSessions()` dropper netop den session man skal handle på.
  - **Første kald efter en binding sendte folk hen for at geninstallere** en udvidelse der
    virkede fint. Nu måles «er døren lige åbnet?» ved kaldets begyndelse - ikke bagefter,
    hvor gentagelserne selv har brugt femten sekunder.
  - **Fanegruppen mistede navn og farve** ved hver frigivelse. Pladsen huskes nu på chattens
    pid, ikke på porten - men kun hvis den er ledig, så navnekollisionen ikke vender tilbage.

- **v1.29.0 (2026-09-07) - porten tages ved brug, ikke ved opstart.** Målt samme dag:
  37 kørende servere, alle 20 porte i spændet optaget, 17 chats helt uden browser. To
  årsager der forstærkede hinanden - hver chat tog en port ved opstart, også de mange der
  aldrig rørte browseren; og en chat der tabte portkapløbet prøvede aldrig igen.
  - Porten bindes ved **første browser-kald**, og hvert kald prøver igen hvis det forrige
    ikke fik en. Udvidelsen genscanner spændet hvert 2. sekund, så en port der åbnes sent
    findes af sig selv.
  - Lukker **agenten** sin sidste fane, slippes porten efter **5 minutter uden faner** -
    aflyst hvis der kommer en ny. Før stod porten reserveret i op til fire timer, fordi
    nedlukningen kun udløstes når et *menneske* lukkede fanen. Serverens egen instruks
    siger «ALWAYS close tabs when done», så den dokumenterede god-praksis slog
    oprydningen ihjel.
  - `terminate` **slipper porten i stedet for at lukke processen**, så en chat der er
    færdig kl. 10 stadig kan bruge browseren kl. 10:40.
  - Fejlbeskeden ved fuldt spænd beder ikke længere om en genstart - den er ikke nødvendig.

- **IKKE UDGIVET - v1.26.0, og tre af punkterne blev aldrig bygget.**
  Stod som shipped fra 27/7 til 9/9. Der findes hverken en git-tag eller en npm-udgivelse for
  1.26.0, og **de tre udklipsholder-værktøjer eksisterer ingen steder** - hverken i
  `mcp-server/tools.js` eller i udvidelsen. De blev annonceret som en «SECRET-SAFE clipboard
  bridge» til at flytte kodeord uden om samtalen; havde nogen stolet på den beskrivelse, ville
  de have stolet på noget der ikke var der. Fjernet frem for skrevet om.
  De fire nedenfor **findes** i koden, men er landet i senere udgivelser, ikke i en 1.26.0:
  - `browser_double_click` - true dblclick (OWA month-view opened inline-rename on two single clicks)
  - `browser_right_click` - page-level context menus
  - `browser_click_xy` - raw-coordinate escape hatch for unselectable custom widgets (Azure portal dialogs)
  - `browser_reattach_debugger` - ghost-attach recovery without extension reload
  - `browser_execute_script` now accepts `script` as alias for `code` + fails loudly with guidance instead of silent undefined

---

## Not in scope

Things we've intentionally decided **not** to do (so you don't have to ask twice):

- **Firefox support** ([#8](https://github.com/Agent360dk/browser-mcp/issues/8)). Not a
  manifest port. The extension makes 61 Chrome Debugger Protocol calls across 17 distinct CDP
  methods, and that is where the value sits - trusted input events, dialog handling,
  cross-origin frames. Firefox's remote protocol isn't CDP, so this is a rewrite of the
  interaction layer maintained in parallel, indefinitely, by one person. If Firefox ships
  meaningful CDP compatibility, the answer changes.

- **Usage monetization via a third-party SDK** ([#9](https://github.com/Agent360dk/browser-mcp/issues/9)).
  MIT, local, no telemetry. That stays.

## 📋 TODO - samlet, tages løbende

Felt-fundene herunder, som handlingspunkter. Rækkefølgen er efter hvad der koster mest
at undvære, ikke efter nummer.

**Fra to uafhængige reviews af port-arbejdet 7/9 - seks fund lukket, disse står åbne:**

- [ ] **Forældede `frigiv-<port>`-alarmer overlever portgenbrug.** Dør en chat inden fristen
  udløber, ryddes alarmen aldrig; tager en anden chat porten, kan den fyre mod dens session.
  Størrelses-tjekket fanger det, så værste udfald er selvhelbredende - men koblingen bør væk.
- [ ] **Faner strander hvis `chrome.tabs.remove()` fejler i `releaseSession`.** Fejlen sluges,
  og sessionen slettes alligevel. Præ-eksisterende, men nås nu ad en hyppigere vej.
- [ ] **~120 mislykkede bindingsforsøg pr. værktøjskald når hele spændet er optaget** (målt).
  **Bevidst ikke rettet:** kaskaden ER mekanismen der lader en sultet chat få en port i det
  øjeblik en bliver fri. At dæmpe den ville svække selve rettelsen for at spare noget der
  hverken koster ventetid eller hukommelse. Noteret som kendt støj.

**Målt 31/8-2026 under live-test af forbrugeragenten.dk - tre ting kostede reelt tid:**

- [ ] **Udvidelsen skal genindlæses i Chrome, før fane-fokus-rettelsen virker.** Svaret fra
  `switch_tab` mangler stadig `windowFocused`, altså kører den gamle kode. Symptomet er at
  ALT timer ud efter 30 s i en baggrundsfane. Omvejen der virker: `computer-mcp` →
  `app focus "Google Chrome"` før hvert kald. Det skal ikke være nødvendigt.
  **Reproduceret 7/9:** `browser_screenshot` returnerede et billede af et HELT andet
  vindues fane - ikke sessionens egen. Værktøjsbeskrivelsen lover «the tab is
  auto-activated before capture»; det skete ikke. Et skærmbillede af den forkerte side
  er værre end ingen, fordi der drages konklusioner af det.
- [ ] **`browser_fill` føjer til i stedet for at erstatte** (allerede noteret) - men her kostede
  det to ekstra runder, fordi feltet så indeholdt adressen to gange. Forslag: ryd feltet som
  standard, med `append: true` som tilvalg.
- [ ] **React-styrede `<select>` kan slet ikke drives - fem metoder proevet, alle fejlede.**
  Maalt 1/9 paa forbrugeragenten.dk's penge-tilbage-formular. Proevet: `browser_select_option`
  (svarer `ok:true` med rigtig vaerdi - men React's `onChange` fyrer aldrig), native
  value-setter + `dispatchEvent('change')`, samme plus nulstilling af `_valueTracker`,
  `browser_click` + `ArrowDown`, og `browser_click` paa selve `<option>`. Feltets DOM-vaerdi
  aendrer sig hver gang; komponentens `useState` hoerer det aldrig. Det blokerede en hel
  e2e-test af en formular. **Vaerktoejet svarer `ok:true` mens intet er sket - det er
  vaerre end en fejl.** Forslag: verificér effekten (aendrede den omkringliggende UI sig?)
  og svar `ok:false` hvis ikke, som `browser_select_option` allerede goer for rollback.
- [ ] **React-styrede felter opdaterer ikke komponentens egen tilstand.** Både den native
  value-setter og `browser_fill` sætter DOM-værdien, mens knappen forbliver deaktiveret,
  fordi React's `useState` aldrig hører om det. Det er den enkeltfejl der oftest stopper en
  formular-test. Forslag: et `browser_react_fill` der bruger den native setter OG udsender
  `input`+`change` med `bubbles`, eller dokumentér tast-omvejen ét sted.
- [ ] **`browser_navigate` timer ud når siden straks redirecter til et andet domæne.** `/tak`
  sender videre til app-domænet; værktøjet venter på den URL man bad om, og opgiver.
  Navigationen LYKKES - svaret lyver. Forslag: løs op ved første `load`, uanset slut-URL.

- [ ] **#1 · Udrul `switch_tab`-vinduesfokus** - FIXET ER SKREVET og testet (3 mutationer,
      alle fanget). Ligger i `extension/background.js` i dev-checkout. Den kørende kopi er
      `~/Downloads/browser-mcp-AKTIV/background.js` og har det IKKE. Kræver kopiering +
      genindlæsning i `chrome://extensions`. **Højest værdi: uden den læses Google-apps
      halvt renderede, og der drages forkerte konklusioner af dem.**
- [ ] **#4 · `fill` erstatter ikke, den tilføjer** - brug native value-setter, eller gør
      `append: true` til et eksplicit tilvalg. Nuværende adfærd er næsten aldrig den ønskede.
- [ ] **#2 + #5 · Angular Material-checkboxes** - host-elementet reagerer ikke; det indre
      element varierer mellem Googles egne tabeller (`.particle-ripple-container` vs
      `.mat-checkbox-container`). En løsning bør prøve det inderste klikbare barn generelt.
- [ ] **#7 · Sessioner er isolerede uden vej imellem** - `list_tabs` viser kun egen session,
      `switch_tab` afviser på tværs, og der er intet `list_sessions`. Kostede en opgave 30/8
      fordi det nødvendige login lå i den anden session.
- [ ] **#6 · Vandret klipning måles ikke** - elementer uden for viewporten får gyldige
      koordinater, klikket sendes i blinde. Scroll ind, eller returnér `offscreen: true`.
- [ ] **#8 · Googles Closure-formularer** - ingen kendt løsning. Værd at dokumentere som
      kendt grænse, så man stopper i stedet for at bruge tredive kald.
- [ ] **#3 · Trusted Types i iframes** - laveste prioritet, veldokumenteret grænse.

---

## Målt mod Google Ads (22/8-2026)

Tre huller fundet under en rigtig opgave - annoncørverificering, konverterings-opsætning
og pausering af en kampagne. Alle tre kostede tid, og det første kostede en fejldiagnose.

### 1. `switch_tab` fokuserer ikke VINDUET - diagnosen, ikke symptomet · **hoej** · FIX SKREVET

Symptomet blev beskrevet her i maaneder som "klik lander ikke naar fanen er skjult".
Det var ikke aarsagen. 31/8-2026 blev den fundet i koden:

```js
case 'switch_tab': {
  const tab = await chrome.tabs.update(params.tab_id, { active: true });
  ...
```

Det goer fanen aktiv INDE I sit vindue. `document.hasFocus()` bliver sand - men
`document.visibilityState` forbliver `hidden` saa laenge vinduet ligger bagved.
Chrome struber timere i skjulte faner, saa Angular-apps (Google Ads, GA4, Search
Console) aldrig renderer faerdigt.

**Konsekvensen er vaerre end "klik virker ikke".** Sider bliver laest HALVT BYGGET,
og der drages forkerte konklusioner af dem. 31/8 konkluderede jeg at tre GA4-
ejendomme laa paa en utilgaengelig konto - de laa lige for; jeg havde bare laest en
halvt renderet vaelger. Den fejl kostede en time og en forkert melding til brugeren.

**Fix (skrevet, testet, mutationsbevist - 3 mutationer, alle fanget):**
```js
await chrome.windows.update(tab.windowId, { focused: true });
```
i try/catch, og svaret baerer `windowFocused: true|false` saa kalderen kan se om
synligheden faktisk blev sikret. Test i `test/fanevalg.test.mjs`.

**VIGTIG afgraensning - laes foer du udvider fixet:** `background.js:337` siger
ordret *"screenshot/press_key run constantly, so we must NOT
chrome.windows.update({focused:true})"*, og linje 347 saetter bevidst `state:
'normal'` UDEN `focused`. Det er rigtigt: browseren maa ikke springe frem ved hvert
skaermbillede. `switch_tab` er den eneste undtagelse, fordi den udtrykker en
eksplicit hensigt om at se fanen. Udvid IKKE fixet til de hyppige vaerktoejer.

**Udestaar:** fixet ligger i dev-checkout'et. Den koerende kopi er
`~/Downloads/browser-mcp-AKTIV/background.js` (Load Unpacked) og har det ikke -
den skal opdateres og udvidelsen genindlaeses foer det virker.

**Tredje bekraeftelse 30/8 - og den dyreste konsekvens hidtil:** samme moenster paa en
helt almindelig `<button onclick="...">` paa en lokal fixture: `ok: true`, men
`landed: false, fallbackFired: true`, 5,3 sek. Fanen var lige aabnet med
`new_tab: true` og var ikke aktiveret.

Konsekvensen er stoerre end et manglende klik. Et syntetisk klik baerer **ikke user
activation**. Alt hvad browseren gater paa aegte brugerhandling fejler derfor tavst,
mens vaerktoejet melder `ok: true`:

  - WebAuthn / sikkerhedsnoegle (`navigator.credentials.get`)
  - `navigator.clipboard.write`
  - popups, fuldskaerm, lyd-afspilning

MAALT 30/8: forsoeg paa at komme igennem npm's 2FA strandede her. Knappen blev
"klikket" (`ok: true`), men prompten kom aldrig - fordi fallbacken er syntetisk.
Uden `landed`-flaget ville det have lignet at npm's side var i stykker.

**Skaerpet forslag:** `click` boer aktivere fanen foerst (jf. ovenfor) OG svaret boer
sige eksplicit naar kun fallbacken fyrede, fx `user_activation: false`, saa kalderen
ved at user-activation-gated API'er ikke vil virke.

### 2. Angular Material-checkboxes kan ikke markeres · **høj**

Google Ads' kampagnetabel bruger `<mat-checkbox role="checkbox">` uden `<input>`.
Den reagerer **hverken** på trusted klik på host-elementet (`landed: true`, men
`aria-checked` blev ved med at være `false`), på syntetisk klik, eller på mellemrum
når elementet har fokus.

**Det der virker:** klik på det indre `.particle-ripple-container`. Fem forsøg gik
til spilde før det blev fundet - pausering af en kampagne var reelt umulig imens.

**Forslag:** når `click` rammer en `[role=checkbox]`/`[role=switch]` og `aria-checked`
ikke ændrer sig, så prøv automatisk det inderste klikbare barn og rapportér hvad der virkede.

### 3. Trusted Types blokerer `execute_script` i iframes · **lav**

`payments.google.com`-iframen (annoncørverificering) afviser al JS-evaluering:
*"Evaluating a string as JavaScript violates this document's Trusted Type assignment
requirements."* Ikke noget vi kan omgå - det er sidens egen politik.

Klik og `upload_file` virker fint der, fordi de går gennem fejlfindings-API'et.
Kun læsning af DOM'en kræver skærmbillede.

**Forslag:** returnér en tydeligere fejl der siger "brug screenshot/click i stedet for
execute_script på denne frame", frem for den rå Trusted-Types-besked.


### 4. `fill` tilfoejer i stedet for at erstatte · **hoej**

`browser_fill` paa et felt der allerede har tekst giver begge dele. Konkret ramt to
gange 22/8: feltet indeholdt "Indsend kundeformular", jeg fyldte "Formular udfyldt
(tag)" i, og resultatet blev `Indsend kundeformularFormular udfyldt (tag)`.

Maatte ryddes med en native value-setter foerst:

```js
const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
s.call(input, ''); input.dispatchEvent(new Event('input', {bubbles:true}));
```

**Forslag:** ryd feltet foer der skrives, eller tilfoej `append: true` som
eksplicit tilvalg. Den nuvaerende adfaerd er naesten aldrig den oenskede.

### 5. Checkbox-varianter · **middel**

Punkt 2 ovenfor loeses ved at klikke det indre element - men hvilket indre element
varierer mellem Googles egne tabeller:

| Tabel | Virkende klikmaal |
|---|---|
| Kampagner | `.particle-ripple-container` |
| Konverteringshandlinger | `.mat-checkbox-container` |

Begge ligger inde i `<mat-checkbox role="checkbox">`, og host-elementet reagerer
paa ingen af dem. En loesning boer proeve begge - og generelt det inderste
klikbare barn - frem for at antage én struktur.

**Bemaerk ogsaa:** i konverteringstabellen er bulk-"Rediger" *deaktiveret* naar
raekkerne er "standardmaal paa kontoniveau". Det er ikke en browser-mcp-fejl, men
det er vaerd at vide at en markeret raekke ikke altid kan redigeres.


### 6. Vandret klipning maales ikke · **lav**

Samme session: et element laa paa `x: 3523` i et vindue paa `vw: 3420` - altsaa
uden for skaermen til hoejre. `resolveElement` gav gyldige koordinater, og klikket
blev sendt til et punkt uden for viewporten, hvor `elementFromPoint` returnerer
`null`. Resultatet var endnu et `landed: false` uden forklaring.

**Forslag:** naar et elements midtpunkt falder uden for viewporten, saa scroll det
ind (inkl. vandret, og i alle scrollende forfaedre) foer klikket - eller returnér
en distinkt fejl `offscreen: true` i stedet for at klikke i blinde.


### 7. Sessioner er isolerede - og der er ingen vej imellem dem · **middel**

Fundet 30/8. `browser_list_tabs` viste en tom liste i session "Claude 2", mens en
tidligere del af samme opgave havde arbejdet i session "Claude 1" med et logget-ind
Meta Business. `browser_switch_tab` afviser tvaers af sessioner:

    Error: Tab 338958198 does not belong to this session (Claude 2)

Der findes intet `list_sessions` og ingen maade at skifte til en anden session.
Konsekvensen var konkret: den login der skulle bruges laa i den anden session, og
opgaven kunne ikke faerdiggoeres - ikke fordi adgangen manglede, men fordi den laa
et sted vaerktoejet ikke kunne naa.

**Forslag:** enten et `list_sessions`/`attach_session`, eller at `list_tabs` viser
fanerne i ALLE sessioner (med session-navn) saa man i det mindste kan se at det man
skal bruge findes et andet sted.


### 8. Googles Closure-formularer kan ikke betjenes · **hoej**

Fundet 31/8 i Search Console (`search.google.com/search-console/welcome`). Feltet
til webadresse kan fyldes ad ALLE veje - native value-setter + input/change,
`browser_fill`, ægte OS-indsaet med cmd+V, og ægte tastetryk (jeg skrev et 'a' og
saa vaerdien aendre sig). Men submit-knappen forbliver `aria-disabled="true"` med
klassen `RDPZE`, og Enter submitter ikke.

Knappens tilstand er altsaa IKKE drevet af feltets indhold paa nogen maade vi kan
naa. Flowet lykkedes én gang tidligt i sessionen og kunne aldrig reproduceres.

Det her er en anden fejlklasse end punkt 2 og 5 (Angular Material, hvor et indre
element skulle rammes). Her rammer vi det rigtige element, inputtet lander, og
UI'en reagerer alligevel ikke.

**Forslag:** ingen kendt loesning fra vaerktoejets side - men det er vaerd at
kende graensen, saa man ikke bruger tredive kald paa at proeve. Naar en Google-
Closure-formular ikke aktiverer sin knap efter et ægte tastetryk, saa stop og
giv opgaven videre. Overvej en `browser_about`-note om kendte uframbare flader.


---

_Last updated: 2026-08-22 · Maintained by [@Agent360dk](https://github.com/Agent360dk)_


## Målt mod npm-udgivelse (30/8-2026)

### 7. `navigate` deler 30-sekunders budget med alt andet · **hoej**

`index.js` giver `ask_user`, `solve_captcha` og `extract_list` deres egne budgetter.
Alt andet - inklusive `navigate` - faar 30000 ms.

MAALT i en Chrome med 86 faner, samme session, samme URL-type:

    navigate (new_tab)   21.293 ms   ok
    navigate (new_tab)   27.982 ms   ok
    navigate (new_tab)   30.355 ms   TIMEOUT
    navigate (samme fane) 30.095 ms  TIMEOUT

Den ligger paa graensen. Udfaldet afhaenger af hvor travlt browseren har, saa den
samme kommando lykkes og fejler skiftevis - og fejlen ligner "browseren er i stykker"
i stedet for "den var 400 ms for langsom".

**Forslag:** giv `navigate` sit eget budget (60-90 sek), eller lad kalderen saette det.
Og naar den timer ud: naevn antallet af aabne faner i fejlen, saa aarsagen er synlig.

### 8. `list_tabs` kan ikke se ud over sin egen session - og tier om det · **middel**

`browser_list_tabs` har `inputSchema: { properties: {} }`. Et `{ all: true }` bliver
**tavst ignoreret** og svaret er `{"tabs": []}` for en frisk session.

Det goer diagnose umulig indefra: da navigation begyndte at time ud, kunne jeg ikke se
om Chrome var stoppet til, om der laa en fastfrossen dialog, eller hvor mange faner der
var. Jeg maatte gaa uden om vaerktoejet (AppleScript) for at finde ud af at der var 86.

Og jeg naaede en forkert konklusion undervejs - at mine egne testkoersler havde fyldt
browseren. Maalingen viste 84 fremmede faner og 2 af mine.

**Forslag:** enten et `all: true` der faktisk virker (eller en `browser_diagnose`), ELLER
en fejl ved ukendte parametre. Et tavst ignoreret flag er vaerre end ingen flag.

### 9. Bar tekst som selektor giver "Element not found" · **lav**

`browser_click { selector: "Use security key" }` -> `Element not found`.
Knappen fandtes, med praecis den `innerText`.

Aarsagen: tekst-matchning kraever praefiks (`text=...` eller `tag:text(...)`). Uden det
falder den igennem til `document.querySelector("Use security key")` - ugyldig CSS.
Dokumentationen er korrekt; fejlbeskeden er det ikke.

**Forslag:** ser selektoren ud som fritekst (mellemrum, ingen CSS-tegn), saa sig
"ugyldig CSS-selektor - mente du `text=Use security key`?" i stedet for "Element not found".

### 10. To-faktor kan ikke automatiseres - og skal ikke kunne · **ikke en fejl**

Skrevet ned saa ingen bruger tid paa det igen.

En sikkerhedsnoegle (WebAuthn/Touch ID) kraever et fysisk tryk paa hardware. Der findes
ingen vej udenom med browser-automatik, og det er hele pointen. Dertil blokerer Claude
Codes egen sikkerhedsklassifikator forsoeg paa at klikke i et 2FA-flow - med rette.

**Hvad der DOG kan automatiseres:** alt frem til porten. Aabne siden, laese den, finde
knapperne, bekraefte at brugeren er genkendt. Stop der, og sig praecist hvad mennesket
skal trykke paa.
