/**
 * Foraeldre-vagten — hvornaar er en proces i kaeden faktisk doed?
 *
 * Ligger i sit eget modul UDEN sideeffekter, saa den kan importeres og koeres i en
 * test. `index.js` starter en WebSocket-server, forbinder MCP-transporten og saetter
 * timere op ved import — den kan ikke importeres af en test uden at haenge. Derfor
 * blev vagt-logikken tidligere kun grepped efter som tekst, og en regex kan ikke se
 * om FORTOLKNINGEN af en fejl er rigtig.
 *
 * MAALT 22/8 mod en levende server:
 *
 *     [MCP] vagt-kaede: 1
 *     [MCP] Chrome extension connected on port 9882
 *     [MCP] Proces 1 i kaeden doede — chatten bag denne server er vaek
 *
 * Pid 1 er launchd. Den doede ikke. `process.kill(1, 0)` kaster EPERM for en
 * almindelig bruger, og koden tolkede ENHVER exception som doed. Vagten der skulle
 * frigive tomme porte draebte i stedet levende chats fem sekunder efter opstart.
 */

/**
 * @param pid   processen der skal tjekkes
 * @param kill  injicerbar for test; default er den aegte process.kill
 * @returns true KUN naar processen beviseligt ikke findes
 */
export function ledErDoedt(pid, kill = process.kill.bind(process)) {
  try {
    kill(pid, 0);          // signal 0 = findes processen?
    return false;          // svarede uden fejl → lever
  } catch (e) {
    // ESRCH ("no such process") er den ENESTE fejl der betyder doed.
    // EPERM betyder at processen LEVER og bare ejes af en anden bruger.
    // Alt andet er ukendt, og paa tvivl draeber vi ikke: at lukke en levende chat
    // ned er en vaerre fejl end at holde en port lidt for laenge.
    if (e?.code === 'ESRCH') return true;
    return false;
  }
}

/**
 * Gaar kaeden op fra `start` til roden. Hvert led hentes med ét `ps`-kald.
 * Doer et vilkaarligt led, er forbindelsen til den chat der ejer os brudt.
 *
 * @param start    pid at gaa op fra
 * @param laesPpid injicerbar for test; skal returnere forældrens pid eller null
 */
export function forfaedreKaede(start, laesPpid) {
  const kaede = [];
  let p = start;
  for (let i = 0; i < 12 && p > 1; i++) {
    kaede.push(p);
    const naeste = laesPpid(p);
    if (!Number.isFinite(naeste) || naeste <= 1 || naeste === p) break;
    p = naeste;
  }
  return kaede;
}
