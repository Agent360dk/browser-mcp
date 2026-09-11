import React from "react";
import { AbsoluteFill, useCurrentFrame, staticFile, Img } from "remotion";

/**
 * Chrome Web Store-billeder - 1280x800, ét slide pr. frame. Engelsk, som butikken.
 *
 * Foerste udgave (8/9 formiddag) var fem tekstplakater. Googles egen vejledning til
 * store listings siger at skaermbilleder skal "demonstrate the actual user experience,
 * focusing on the core features and content" - plakater goer ikke det, og de tre
 * billeder der laa i butikken i forvejen (fra 3. maj) var skaermbilleder af WEBSITET,
 * altsaa samme fejl en generation tidligere.
 *
 * Derfor er popup'en, sessions-kortene, handlings-loggen og menneske-i-loopet-dialogen
 * her gengivet fra extensionens EGEN markup og CSS (popup.html og den overlay-kode der
 * bygges i background.js), ikke tegnet paa fri haand. Aendrer produktets UI sig, skal
 * de her aendres med - det er prisen for at vise produktet i stedet for at paastaa det.
 */

const BG = "#0E0D14";
const CARD = "#17161F";
const LINE = "#26242F";
const INK = "#E8E6F0";
const DIM = "#8C88A0";
const ACCENT = "#7C6BFF";
const GREEN = "#4ADE80";
const AMBER = "#FBBF24";

const SANS = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ backgroundColor: BG, fontFamily: SANS, color: INK, padding: "56px 64px", justifyContent: "center" }}>
    {children}
  </AbsoluteFill>
);

const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color }) => (
  <div style={{ fontFamily: MONO, fontSize: 14, letterSpacing: "0.18em", textTransform: "uppercase", color: color ?? ACCENT, fontWeight: 700, marginBottom: 16 }}>
    {children}
  </div>
);

const H: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size }) => (
  <h1 style={{ fontSize: size ?? 50, lineHeight: 1.08, letterSpacing: "-0.025em", fontWeight: 800, margin: 0 }}>{children}</h1>
);

const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 21, lineHeight: 1.5, color: DIM, margin: "16px 0 0", maxWidth: 620 }}>{children}</p>
);

/* ── Extensionens egen popup, gengivet fra popup.html ──────────────────────── */

const P = {
  body: { width: 320, fontFamily: SANS, background: "#0f172a", color: "#e2e8f0", padding: 16 } as React.CSSProperties,
  h1: { fontSize: 13, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 } as React.CSSProperties,
  status: { display: "flex", alignItems: "center", gap: 8, padding: 10, borderRadius: 8, background: "#1e293b", marginBottom: 8 } as React.CSSProperties,
  dot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 } as React.CSSProperties,
  sectionTitle: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "#475569", margin: "10px 0 4px", fontWeight: 600 } as React.CSSProperties,
  card: { padding: "8px 10px", background: "#1e293b", borderRadius: 8, borderLeft: "3px solid" } as React.CSSProperties,
  log: { background: "#1e293b", borderRadius: 8, padding: "6px 10px" } as React.CSSProperties,
  entry: { fontSize: 10, padding: "2px 0", borderBottom: "1px solid #0f172a", display: "flex", gap: 6, alignItems: "baseline" } as React.CSSProperties,
};

const SESSION_COLOR: Record<string, string> = {
  blue: "#3b82f6", green: "#22c55e", yellow: "#eab308", red: "#ef4444",
  pink: "#ec4899", purple: "#a855f7", cyan: "#06b6d4", orange: "#f97316",
};

const PopupChrome: React.FC<{ children: React.ReactNode; scale?: number }> = ({ children, scale = 1.55 }) => (
  <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", boxShadow: "0 24px 70px rgba(0,0,0,0.55)", borderRadius: 10, overflow: "hidden" }}>
    <div style={P.body}>
      <div style={P.h1}><span style={{ color: "#3b82f6" }}>Agent360</span>&nbsp;Browser MCP</div>
      {children}
    </div>
  </div>
);

const Status: React.FC<{ on: boolean; label: string }> = ({ on, label }) => (
  <div style={P.status}>
    <div style={{ ...P.dot, background: on ? "#22c55e" : "#ef4444", boxShadow: on ? "0 0 6px #22c55e" : undefined }} />
    <span style={{ fontSize: 12 }}>{label}</span>
  </div>
);

const SessionCard: React.FC<{ label: string; color: string; port: number; tabs: string[] }> = ({ label, color, port, tabs }) => (
  <div style={{ ...P.card, borderLeftColor: SESSION_COLOR[color] }}>
    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: SESSION_COLOR[color] }}>
      {label} <span style={{ fontWeight: "normal", fontSize: 10, color: "#64748b" }}>port {port}</span>
    </div>
    <div style={{ fontSize: 10, color: "#94a3b8" }}>
      {tabs.map((t) => (
        <div key={t} style={{ marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>• {t}</div>
      ))}
    </div>
  </div>
);

const LogEntry: React.FC<{ time: string; method: string; session: string; sensitive?: boolean }> = ({ time, method, session, sensitive }) => (
  <div style={P.entry}>
    <span style={{ color: "#475569", minWidth: 45 }}>{time}</span>
    <span style={{ fontWeight: 500, color: sensitive ? "#f59e0b" : "#22c55e" }}>{method}</span>
    <span style={{ fontSize: 9, color: "#64748b" }}>{session}</span>
  </div>
);

/* ── 1. To halvdele - popup'ens egen opsætnings-tilstand ───────────────────── */

const Halves: React.FC = () => (
  <Frame>
    <div style={{ display: "flex", gap: 56, alignItems: "center" }}>
      <div style={{ flex: 1 }}>
        <Eyebrow color={AMBER}>Read first · two parts</Eyebrow>
        <H>The store can only give you one half.</H>
        <Sub>
          Browser MCP is this extension <b style={{ color: INK }}>plus</b> a local server. Without the
          second half the icon stays red - so the extension says so itself, and hands you the command.
        </Sub>
        <div style={{ marginTop: 26, fontSize: 18, color: DIM }}>
          One command, once. Chrome cannot install from npm, and npm cannot install a Chrome extension.
        </div>
      </div>
      <div style={{ width: 500, height: 520, position: "relative", flex: "none" }}>
        <PopupChrome>
          <Status on={false} label="Not connected - no MCP server found" />
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderLeft: "3px solid #f59e0b", borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <p style={{ fontSize: 11, lineHeight: 1.5, color: "#94a3b8", marginBottom: 8 }}>
              <b style={{ color: "#e2e8f0" }}>This extension is only half of Browser MCP.</b> It needs a
              local MCP server to talk to - the Chrome Web Store cannot install that part. Register it
              once, then restart your agent. Claude Code:
            </p>
            <code style={{ display: "block", background: "#0f172a", borderRadius: 6, padding: 8, fontFamily: MONO, fontSize: 10, color: "#22c55e", wordBreak: "break-all", marginBottom: 6 }}>
              claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest
            </code>
            <div style={{ display: "flex", gap: 6 }}>
              {["Copy command", "Setup guide"].map((t) => (
                <div key={t} style={{ flex: 1, padding: 6, borderRadius: 6, background: "#334155", color: "#e2e8f0", fontSize: 11, textAlign: "center" }}>{t}</div>
              ))}
            </div>
          </div>
          <div style={P.sectionTitle}>Sessions</div>
          <div style={{ fontSize: 11, color: "#475569", textAlign: "center", padding: 12, background: "#1e293b", borderRadius: 8 }}>No tabs claimed yet</div>
        </PopupChrome>
      </div>
    </div>
  </Frame>
);

/* ── 2. Mange agenter, én browser - popup + ægte fanebånd ──────────────────── */

const Parallel: React.FC = () => (
  <Frame>
    <Eyebrow>What nothing else does</Eyebrow>
    <H>Twenty agents. One signed-in browser.</H>
    <Sub>
      Each chat claims its own colour-coded tab group and can only see its own tabs.
      Playwright MCP&apos;s own docs: concurrent clients on one profile <i>conflict</i>.
    </Sub>
    <div style={{ marginTop: 26, borderRadius: 10, border: `1px solid ${LINE}`, overflow: "hidden", boxShadow: "0 18px 50px rgba(0,0,0,0.45)" }}>
      <Img src={staticFile("fanegrupper.png")} style={{ width: "100%", display: "block" }} />
    </div>
    <div style={{ display: "flex", gap: 44, marginTop: 24, alignItems: "flex-start" }}>
      <div style={{ width: 390, flex: "none" }}>
        <PopupChrome scale={1.16}>
          <Status on label="Connected - 4 active sessions" />
          <div style={P.sectionTitle}>Sessions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <SessionCard label="Claude 6" color="purple" port={9876} tabs={["app.hubspot.com"]} />
            <SessionCard label="Claude 1" color="blue" port={9877} tabs={["github.com"]} />
            <SessionCard label="Claude 2" color="green" port={9878} tabs={["console.cloud.google.com"]} />
            <SessionCard label="Claude 8" color="orange" port={9879} tabs={["dashboard.stripe.com"]} />
          </div>
        </PopupChrome>
      </div>
      <div style={{ flex: 1, paddingTop: 6 }}>
        <div style={{ fontSize: 19, color: DIM, lineHeight: 1.55 }}>
          Above: a real Chrome tab strip, four agent sessions at once. Left: the extension
          showing who owns what.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 22 }}>
          {[
            ["Each session sees only its own tabs", "One agent cannot read or close another's work."],
            ["Your logins are shared, your work is not", "One signed-in profile, twenty separate desks."],
            ["Close a chat, its tabs go with it", "No orphan windows piling up."],
          ].map(([t, d]) => (
            <div key={t} style={{ background: CARD, border: `1px solid ${LINE}`, borderLeft: `3px solid ${ACCENT}`, borderRadius: "0 8px 8px 0", padding: "11px 16px" }}>
              <div style={{ fontSize: 17, fontWeight: 600 }}>{t}</div>
              <div style={{ fontSize: 15, color: DIM, marginTop: 2 }}>{d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </Frame>
);

/* ── 3. Menneske i loopet - dialogen fra background.js ─────────────────────── */

const HumanInLoop: React.FC = () => (
  <Frame>
    <div style={{ display: "flex", gap: 56, alignItems: "center" }}>
      <div style={{ flex: 1 }}>
        <Eyebrow color={GREEN}>You stay in the loop</Eyebrow>
        <H>It asks you. It never guesses.</H>
        <Sub>
          Passwords, one-time codes, anything sensitive - the agent stops and puts the
          question on the page in front of you. Nothing is typed until you answer.
        </Sub>
        <div style={{ marginTop: 26, fontSize: 18, color: DIM }}>
          And if the code lands in your own Gmail tab, it can read it from there instead of asking.
        </div>
      </div>
      <div style={{ width: 560, flex: "none" }}>
        <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: `1px solid ${LINE}`, boxShadow: "0 24px 70px rgba(0,0,0,0.6)" }}>
          {/* Siden bagved, daempet - som dialogens egen rgba(0,0,0,0.6)-baggrund goer det */}
          <div style={{ background: "#F6F6F8", padding: "14px 18px", borderBottom: "1px solid #E3E3EA", display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 5 }}>
              {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <div key={c} style={{ width: 10, height: 10, borderRadius: 99, background: c }} />)}
            </div>
            <div style={{ flex: 1, background: "#FFF", border: "1px solid #E3E3EA", borderRadius: 99, padding: "5px 12px", fontSize: 12, color: "#5A5A6B", fontFamily: MONO }}>
              app.hubspot.com/login/verify
            </div>
          </div>
          <div style={{ position: "relative", background: "#FFFFFF" }}>
            {/* Siden bagved: en almindelig login-verifikation, saa daempningen betyder noget */}
            <div style={{ padding: "34px 44px", opacity: 1 }}>
              <div style={{ width: 132, height: 15, background: "#D8D8E2", borderRadius: 4 }} />
              <div style={{ width: 300, height: 26, background: "#C6C6D4", borderRadius: 5, marginTop: 26 }} />
              <div style={{ width: 380, height: 12, background: "#E2E2EA", borderRadius: 4, marginTop: 16 }} />
              <div style={{ width: 250, height: 12, background: "#E2E2EA", borderRadius: 4, marginTop: 9 }} />
              <div style={{ width: 420, height: 40, background: "#F1F1F6", border: "1px solid #DEDEE7", borderRadius: 7, marginTop: 26 }} />
              <div style={{ width: 420, height: 40, background: "#F1F1F6", border: "1px solid #DEDEE7", borderRadius: 7, marginTop: 12 }} />
              <div style={{ width: 138, height: 38, background: "#FF7A59", borderRadius: 7, marginTop: 22 }} />
            </div>
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
          </div>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 40px" }}>
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 24, color: "#e2e8f0", boxShadow: "0 20px 60px rgba(0,0,0,0.5)", width: "100%" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#3b82f6", marginBottom: 4 }}>Agent360 - Action Required</div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 12 }}>Claude 1</div>
              <div style={{ fontSize: 13, color: "#cbd5e1", marginBottom: 16, lineHeight: 1.5 }}>
                HubSpot sent a 6-digit code to your email. Paste it here and I will finish signing in.
              </div>
              <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4, marginTop: 8 }}>Verification code</label>
              <div style={{ width: "100%", padding: "8px 10px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#475569", fontSize: 13 }}>
                Verification code
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <div style={{ flex: 1, padding: 10, background: "#3b82f6", color: "#fff", borderRadius: 6, fontSize: 13, textAlign: "center", fontWeight: 500 }}>Submit</div>
                <div style={{ flex: 1, padding: 10, background: "#334155", color: "#94a3b8", borderRadius: 6, fontSize: 13, textAlign: "center" }}>✗ Skip</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Frame>
);

/* ── 4. Handlings-loggen - det der gør de brede tilladelser til at bære ────── */

const Trust: React.FC = () => (
  <Frame>
    <div style={{ display: "flex", gap: 56, alignItems: "center" }}>
      <div style={{ flex: 1 }}>
        <Eyebrow color={GREEN}>Runs locally · MIT · no account</Eyebrow>
        <H>Every action, written down.</H>
        <Sub>
          The extension keeps a log of what the agent did, and marks the sensitive ones
          amber. It talks to one thing only: a server on 127.0.0.1 that you started.
        </Sub>
        <div style={{ marginTop: 26, fontSize: 18, color: DIM }}>
          No account, no telemetry, and nothing is sent to us.
        </div>
      </div>
      <div style={{ width: 500, flex: "none", height: 430 }}>
        <PopupChrome scale={1.5}>
          <Status on label="Connected - 1 active session" />
          <div style={P.sectionTitle}>Action Log</div>
          <div style={P.log}>
            <LogEntry time="14:22:07" method="navigate" session="Claude 1" />
            <LogEntry time="14:22:09" method="get_page_content" session="Claude 1" />
            <LogEntry time="14:22:11" method="click" session="Claude 1" />
            <LogEntry time="14:22:14" method="ask_user" session="Claude 1" sensitive />
            <LogEntry time="14:22:31" method="fill" session="Claude 1" sensitive />
            <LogEntry time="14:22:33" method="screenshot" session="Claude 1" />
            <LogEntry time="14:22:36" method="extract_list" session="Claude 1" />
          </div>
        </PopupChrome>
      </div>
    </div>
  </Frame>
);

/* ── 5. Hvad det er ────────────────────────────────────────────────────────── */

const What: React.FC = () => (
  <Frame>
    <Eyebrow color={GREEN}>Free forever · MIT · open source</Eyebrow>
    <H>Your real Chrome. 40 tools.</H>
    <Sub>
      Navigate, click, fill, read, screenshot - plus the things headless browsers cannot
      do, because it is the browser you are already signed into.
    </Sub>
    <div style={{ display: "flex", gap: 16, marginTop: 40 }}>
      {[
        ["40", "tools"],
        ["20", "concurrent sessions"],
        ["9", "built-in integrations"],
        ["$0", "forever"],
      ].map(([n, l]) => (
        <div key={l} style={{ flex: 1, background: CARD, border: `1px solid ${LINE}`, borderRadius: 12, padding: "22px 24px" }}>
          <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", fontFamily: MONO, color: ACCENT }}>{n}</div>
          <div style={{ fontSize: 17, color: DIM, marginTop: 4 }}>{l}</div>
        </div>
      ))}
    </div>
    <div style={{ display: "flex", gap: 14, marginTop: 26, flexWrap: "wrap" }}>
      {["Reads 2FA codes from your Gmail", "Solves CAPTCHAs", "Handles iframes", "Uploads files",
        "Reads cookies & localStorage", "Watches the network tab", "Asks before anything sensitive"].map((t) => (
        <div key={t} style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 99, padding: "9px 18px", fontSize: 16, color: DIM }}>{t}</div>
      ))}
    </div>
    <div style={{ marginTop: 30, fontSize: 18, color: DIM }}>
      Works with Claude Code, Codex, Cursor, VS Code and Windsurf.
    </div>
  </Frame>
);

const SCENES = [Halves, Parallel, HumanInLoop, Trust, What];

export const StoreShots: React.FC = () => {
  const frame = useCurrentFrame();
  const Scene = SCENES[Math.min(frame, SCENES.length - 1)];
  return <Scene />;
};

export const STORE_COUNT = SCENES.length;

/* ── Butikkens ANDRE billedfelter ──────────────────────────────────────────────
 * 440x280 "small promo tile" vises i soegeresultater og paa kategorisiderne - det
 * er det billede folk ser FOER de klikker ind. Googles raad: lidt tekst, virker i
 * halv stoerrelse, samme brand-elementer. 1400x560 "marquee" bruges kun hvis
 * butikken featurer en udvidelse, men uden den kan man ikke blive featured.
 */

const TileMark: React.FC<{ size: number }> = ({ size }) => (
  <div style={{
    width: size, height: size, borderRadius: size * 0.26, flex: "none",
    background: "linear-gradient(135deg, #2563eb 0%, #60a5fa 100%)",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 8px 24px rgba(37,99,235,0.35)",
  }}>
    <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="#fff">
      <path d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2z" />
      <path d="M18.5 14.5l.7 2.2 2.3.8-2.3.8-.7 2.2-.7-2.2-2.3-.8 2.3-.8.7-2.2z" opacity=".85" />
      <path d="M5.5 15.5l.5 1.6 1.7.6-1.7.6-.5 1.6-.5-1.6L3.3 18l1.7-.6.5-1.9z" opacity=".7" />
    </svg>
  </div>
);

export const PromoTile: React.FC = () => (
  <AbsoluteFill style={{
    background: "linear-gradient(150deg, #12111A 0%, #1A1830 100%)",
    fontFamily: SANS, color: INK, padding: 30, justifyContent: "center",
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <TileMark size={52} />
      <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
        Browser MCP
      </div>
    </div>
    <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.2, marginTop: 20 }}>
      Your AI drives your<br />real, signed-in Chrome.
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
      {["40 tools", "Multi-session", "MIT · local"].map((t) => (
        <div key={t} style={{
          background: "rgba(124,107,255,0.14)", border: "1px solid rgba(124,107,255,0.4)",
          borderRadius: 99, padding: "5px 12px", fontSize: 12.5, color: "#C4BAFF", fontWeight: 600,
        }}>{t}</div>
      ))}
    </div>
  </AbsoluteFill>
);

export const MarqueeTile: React.FC = () => (
  <AbsoluteFill style={{
    background: "linear-gradient(120deg, #12111A 0%, #1C1A34 60%, #12111A 100%)",
    fontFamily: SANS, color: INK, padding: "0 90px", flexDirection: "row",
    alignItems: "center", justifyContent: "space-between",
  }}>
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 26 }}>
        <TileMark size={74} />
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>Browser MCP</div>
      </div>
      <div style={{ fontSize: 54, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.12 }}>
        Your AI drives your real,<br />signed-in Chrome.
      </div>
      <div style={{ fontSize: 22, color: DIM, marginTop: 20 }}>
        Twenty agents, one browser. 40 tools. MIT, runs on your machine.
      </div>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 330 }}>
      {[["Claude 6", "purple"], ["Claude 1", "blue"], ["Claude 2", "green"], ["Claude 8", "orange"]].map(([l, c]) => (
        <div key={l} style={{
          background: "#1e293b", borderRadius: 9, borderLeft: `4px solid ${SESSION_COLOR[c]}`,
          padding: "13px 16px", fontSize: 17, fontWeight: 600, color: SESSION_COLOR[c],
        }}>{l}</div>
      ))}
    </div>
  </AbsoluteFill>
);
