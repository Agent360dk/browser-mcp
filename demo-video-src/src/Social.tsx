import React from "react";
import { AbsoluteFill } from "remotion";

// Delingsbilledet (Open Graph) og GitHubs forhaandsbillede.
//
// MAALT 11/9-2026: det billede der laa live paa browsermcp.dev - og som blev vist hver gang linket blev delt - sagde
// "34 tools" og "by agent360.eu". Begge dele var forkerte, og de havde staaet siden juni, fordi ingen vagt kan laese en
// JPEG. Billedet bygges derfor herfra, og `test/billedkilder-tal.test.mjs` holder tallet op mod mcp-server/tools.js.

const BG = "#0B0A12";
const INK = "#E8E6F0";
const DIM = "#8C88A0";
const BLUE = "#4B82F7";
const GREEN = "#4ADE80";
const SANS = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const Maerke: React.FC<{ size: number }> = ({ size }) => (
  <div style={{
    width: size, height: size, borderRadius: size * 0.26,
    background: "linear-gradient(150deg, #5B8DEF 0%, #3B6FE0 100%)",
    display: "flex", alignItems: "center", justifyContent: "center",
    color: "#fff", fontSize: size * 0.52, fontWeight: 700,
  }}>✦</div>
);

const Chip: React.FC<{ children: React.ReactNode; skala: number }> = ({ children, skala }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: 9 * skala,
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 99, padding: `${10 * skala}px ${18 * skala}px`,
    fontSize: 21 * skala, color: INK, fontWeight: 500,
  }}>
    <span style={{ width: 9 * skala, height: 9 * skala, borderRadius: 99, background: GREEN }} />
    {children}
  </div>
);

// Ét motiv, to formater: 1200x630 (Open Graph) og 1280x640 (GitHub).
export const Social: React.FC<{ bredde?: number }> = ({ bredde = 1200 }) => {
  const skala = bredde / 1200;
  return (
    <AbsoluteFill style={{
      background: `radial-gradient(120% 120% at 78% 62%, #12306B 0%, ${BG} 62%)`,
      fontFamily: SANS, color: INK, padding: `${62 * skala}px ${72 * skala}px`, justifyContent: "space-between",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 * skala }}>
          <Maerke size={62 * skala} />
          <div style={{ fontSize: 34 * skala, fontWeight: 700, letterSpacing: "-0.02em" }}>Browser MCP</div>
        </div>
        <div style={{
          border: "1px solid rgba(74,222,128,0.35)", borderRadius: 99,
          padding: `${10 * skala}px ${22 * skala}px`, fontSize: 21 * skala, color: GREEN,
        }}>Open source · MIT · Free</div>
      </div>

      <div>
        <div style={{ fontSize: 68 * skala, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.08 }}>
          Your AI can&apos;t use a browser.
        </div>
        <div style={{ fontSize: 68 * skala, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.08, color: BLUE }}>
          Until now.
        </div>
        <div style={{ fontSize: 26 * skala, color: DIM, marginTop: 18 * skala }}>
          Your real, signed-in Chrome — driven by Claude Code, Codex, Cursor or VS Code.
        </div>
      </div>

      <div style={{ display: "flex", gap: 14 * skala, flexWrap: "wrap" }}>
        <Chip skala={skala}>40 tools</Chip>
        <Chip skala={skala}>Up to 20 sessions</Chip>
        <Chip skala={skala}>Your logins &amp; 2FA</Chip>
        <Chip skala={skala}>Asks before it guesses</Chip>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 14 * skala, fontSize: 26 * skala }}>
        <span style={{ color: BLUE, fontWeight: 700 }}>browsermcp.dev</span>
        <span style={{ color: DIM }}>by agent360.dk</span>
      </div>
    </AbsoluteFill>
  );
};

export const OgImage: React.FC = () => <Social bredde={1200} />;
export const GithubSocial: React.FC = () => <Social bredde={1280} />;
