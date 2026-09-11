"""Finder forkerte tal og falske loefter i en katalogtekst om Browser MCP by Agent360.

Bruges af dominans-audit.py paa de kataloger den allerede henter (mcp.so, punkpeye, PulseMCP).

MAALT 11/9-2026: mcp.so viste "34 tools", "MIT, local-only" og "~80% reCAPTCHA-checkbox solve", og
punkpeye viste "34 tools, up to 10 concurrent sessions". Auditten kiggede kun efter navnet, saa intet
blev fanget i to maaneder. Kun rene tal og faste formuleringer tjekkes - ingen gaet om betydning.
"""
import re

LOEFTER = [
    (re.compile(r"\blocal-only\b", re.I), "local-only"),
    (re.compile(r"100%\s*local", re.I), "100% local"),
    (re.compile(r"nothing[^.\"]{0,40}leaves (your|the) machine", re.I), "nothing leaves your machine"),
]
PROCENT = re.compile(r"(\d{1,3})\s*%[^.\n]{0,40}?(captcha|solve|pass rate)", re.I)
VAERKTOEJER = re.compile(r"\b(\d{1,3})\s+(?:browser\s+)?tools\b", re.I)
SESSIONER = re.compile(r"\bup to (\d{1,3}) (?:concurrent|parallel)", re.I)


def katalog_fejl(tekst, vaerktoejer, sessioner):
    """Returnerer en liste af fund (tom liste = intet forkert fundet).

    Er et facit ukendt (None - kilden kunne ikke hentes), tjekkes det tal ikke: et gaettet facit ville opdigte fund.
    """
    fund = []
    for m in VAERKTOEJER.finditer(tekst or ""):
        if vaerktoejer is not None and int(m.group(1)) != vaerktoejer:
            fund.append("vaerktoejstal %s (rigtigt: %s)" % (m.group(1), vaerktoejer))
    for m in SESSIONER.finditer(tekst or ""):
        if sessioner is not None and int(m.group(1)) != sessioner:
            fund.append("sessionstal %s sessions (rigtigt: %s)" % (m.group(1), sessioner))
    for m in PROCENT.finditer(tekst or ""):
        fund.append("CAPTCHA-procent %s%% (intet maalt tal findes)" % m.group(1))
    for regel, navn in LOEFTER:
        if regel.search(tekst or ""):
            fund.append("loefte: %s" % navn)
    # Samme fund kan staa flere gange paa en side (meta, og:, brødtekst) - ét fund pr. slags er nok.
    return sorted(set(fund))
