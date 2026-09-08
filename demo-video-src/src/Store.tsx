import React from "react";
import { AbsoluteFill, useCurrentFrame, staticFile, Img } from "remotion";

/**
 * Chrome Web Store-billeder (engelsk tekst — butikken er engelsk) — 1280x800, ét pr. frame.
 *
 * MAALT 8/9-2026: de tre billeder der laa i butikken var fra 3. maj, hed ting som
 * "multi-session.png" uden at vise multi-session, og var afskaarne skaermbilleder af
 * det GAMLE website — med overskriften "Your AI can't use a browser. Until now." og
 * kommandoen `npx ... install`, som ikke registrerer serveren.
 *
 * De her viser produktet i stedet for siden, og de saetter forventningen FOER
 * installationen: to halvdele, ellers staar ikonet paa "Not connected" for evigt.
 * Det er den enkeltting der afgoer om en butiks-installation bliver en bruger.
 */

const INK = "#E8E6F0";
const DIM = "#8C88A0";
const BG = "#0E0D14";
const CARD = "#17161F";
const LINE = "#26242F";
const ACCENT = "#7C6BFF";
const GREEN = "#4ADE80";
const AMBER = "#FBBF24";

const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      backgroundColor: BG,
      fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      color: INK,
      padding: 64,
      justifyContent: "center",
    }}
  >
    {children}
  </AbsoluteFill>
);

const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color }) => (
  <div
    style={{
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 15,
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      color: color ?? ACCENT,
      marginBottom: 20,
      fontWeight: 700,
    }}
  >
    {children}
  </div>
);

const H: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size }) => (
  <h1 style={{ fontSize: size ?? 58, lineHeight: 1.08, letterSpacing: "-0.025em", fontWeight: 800, margin: 0 }}>
    {children}
  </h1>
);

const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 24, lineHeight: 1.5, color: DIM, marginTop: 22, maxWidth: 940 }}>{children}</p>
);

const Mono: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color }) => (
  <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: color ?? INK }}>
    {children}
  </span>
);

/* 1 — de to halvdele. Saetter forventningen foer installationen. */
const Halves: React.FC = () => (
  <Frame>
    <Eyebrow color={AMBER}>Read first · two parts</Eyebrow>
    <H>This extension is one half.</H>
    <Sub>
      Browser MCP is a Chrome extension <b style={{ color: INK }}>plus</b> a local server. This page can
      only give you the extension — on its own the icon sits on “Not connected” forever.
    </Sub>
    <div style={{ display: "flex", gap: 20, marginTop: 44 }}>
      {[
        { n: "1", t: "Install the extension", d: "You are here.", done: true },
        { n: "2", t: "Register the server", d: "claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest", done: false },
        { n: "3", t: "Restart your AI client", d: "The icon turns green.", done: false },
      ].map((s) => (
        <div
          key={s.n}
          style={{
            flex: 1, background: CARD, border: `1px solid ${s.done ? GREEN : LINE}`,
            borderRadius: 12, padding: "22px 24px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 99, background: s.done ? GREEN : ACCENT,
              color: BG, fontSize: 15, fontWeight: 800, display: "flex",
              alignItems: "center", justifyContent: "center",
            }}>{s.n}</div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{s.t}</div>
          </div>
          <div style={{
            fontSize: s.n === "2" ? 13 : 17, color: DIM, lineHeight: 1.45,
            fontFamily: s.n === "2" ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit",
            wordBreak: "break-word",
          }}>{s.d}</div>
        </div>
      ))}
    </div>
    <div style={{ marginTop: 30, fontSize: 18, color: DIM }}>
      Neither half can install the other. That is why it is two steps — once.
    </div>
  </Frame>
);

/* 2 — mange agenter i én indlogget browser. Det Microsoft dokumenterer at de ikke kan. */
const Parallel: React.FC = () => (
  <Frame>
    <Eyebrow>What nothing else does</Eyebrow>
    <H>Twenty agents. One signed-in browser.</H>
    <Sub>
      Every chat gets its own colour-coded tab group and can only see its own tabs.
      Playwright MCP&apos;s own docs: concurrent clients on one profile <i>conflict</i>.
    </Sub>
    <div style={{
      marginTop: 44, borderRadius: 10, border: `1px solid ${LINE}`, overflow: "hidden",
      boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
    }}>
      <Img src={staticFile("fanegrupper.png")} style={{ width: "100%", display: "block" }} />
    </div>
    <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
      {[["#8B5CF6", "Claude 6"], ["#1A73E8", "Claude 1"], ["#137333", "Claude 2"], ["#F29900", "Claude 8"]].map(
        ([c, n]) => (
          <div key={n} style={{
            flex: 1, background: CARD, border: `1px solid ${LINE}`, borderTop: `3px solid ${c}`,
            borderRadius: "0 0 8px 8px", padding: "12px 14px",
          }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{n}</div>
            <div style={{ fontSize: 14, color: DIM, marginTop: 2 }}>sees only its own tabs</div>
          </div>
        ),
      )}
    </div>
    <div style={{ marginTop: 22, fontSize: 17, color: DIM }}>
      Real Chrome tab strip — four agent sessions running side by side in one signed-in browser.
    </div>
  </Frame>
);

/* 3 — signaturøjeblikket. */
const TwoFA: React.FC = () => (
  <Frame>
    <Eyebrow>The move no API can make</Eyebrow>
    <H>The code is in your own inbox.</H>
    <Sub>It hits a login wall, reads the one-time code from your own Gmail tab, and carries on.</Sub>
    <div style={{
      marginTop: 40, background: "#0A0910", border: `1px solid ${LINE}`, borderRadius: 12,
      padding: "26px 30px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 19, lineHeight: 1.85,
    }}>
      <div style={{ color: DIM }}>❯ <Mono>browser_navigate("app.hubspot.com")</Mono></div>
      <div style={{ color: AMBER }}>  → 2FA required</div>
      <div style={{ color: DIM }}>❯ <Mono>{'browser_navigate("mail.google.com")'}</Mono></div>
      <div style={{ color: GREEN }}>  ✓ read the code: 847291</div>
      <div style={{ color: DIM }}>❯ <Mono>{'browser_fill("#otp", "847291")'}</Mono></div>
      <div style={{ color: GREEN, fontWeight: 700 }}>  ✓ signed in</div>
    </div>
    <div style={{ marginTop: 26, fontSize: 18, color: DIM }}>
      It works because it <b style={{ color: INK }}>is</b> your browser — nothing is being bypassed.
    </div>
  </Frame>
);

/* 4 — hvad man siger, naar det virker. */
const Prompts: React.FC = () => (
  <Frame>
    <Eyebrow>Say this</Eyebrow>
    <H size={52}>Nothing happens until you ask.</H>
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 38 }}>
      {[
        ["\u201cTake a screenshot of my current Chrome tab.\u201d", "Start here. An image back means both halves are talking."],
        ["\u201cOpen my Gmail and tell me who sent my last 3 emails.\u201d", "Works because it is your browser — already signed in."],
        ["\u201cPull this month\u2019s numbers from my dashboard into a table.\u201d", "Any dashboard you are logged into. No API key."],
        ["\u201cFill in this form. Stop and ask me before anything sensitive.\u201d", "You stay in the loop for passwords and payments."],
      ].map(([q, a]) => (
        <div key={q} style={{
          background: CARD, border: `1px solid ${LINE}`, borderLeft: `3px solid ${ACCENT}`,
          borderRadius: "0 10px 10px 0", padding: "16px 22px",
        }}>
          <div style={{ fontSize: 21, fontWeight: 600, marginBottom: 5 }}>{q}</div>
          <div style={{ fontSize: 17, color: DIM }}>{a}</div>
        </div>
      ))}
    </div>
  </Frame>
);

/* 5 — hvad det er. */
const What: React.FC = () => (
  <Frame>
    <Eyebrow color={GREEN}>Free · MIT · 100% local</Eyebrow>
    <H>Your real Chrome. 40 tools.</H>
    <Sub>
      Nothing leaves your machine. The server runs locally, the extension talks only to it,
      and there is no account, no telemetry and no payment.
    </Sub>
    <div style={{ display: "flex", gap: 16, marginTop: 46, flexWrap: "wrap" }}>
      {[
        ["40", "tools"],
        ["20", "concurrent sessions"],
        ["9", "built-in integrations"],
        ["$0", "forever"],
      ].map(([n, l]) => (
        <div key={l} style={{
          flex: "1 1 200px", background: CARD, border: `1px solid ${LINE}`,
          borderRadius: 12, padding: "24px 26px",
        }}>
          <div style={{
            fontSize: 46, fontWeight: 800, letterSpacing: "-0.03em",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: ACCENT,
          }}>{n}</div>
          <div style={{ fontSize: 18, color: DIM, marginTop: 4 }}>{l}</div>
        </div>
      ))}
    </div>
    <div style={{ marginTop: 34, fontSize: 19, color: DIM }}>
      Navigate · click · fill · tabs · iframes · cookies · network ·
      CAPTCHA · file upload · human-in-the-loop
    </div>
  </Frame>
);

const SCENES = [Halves, Parallel, TwoFA, Prompts, What];

export const StoreShots: React.FC = () => {
  const frame = useCurrentFrame();
  const Scene = SCENES[Math.min(frame, SCENES.length - 1)];
  return <Scene />;
};

export const STORE_COUNT = SCENES.length;
