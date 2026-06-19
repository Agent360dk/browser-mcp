import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { AnimatedCursor, ClickRipple, GlowHighlight } from "./components/Effects";

/**
 * Hero loop — "Where headless dies."
 * Muted, seamless ~15s autoplay-hero loop. Split-screen:
 *   LEFT  = a headless browser (Playwright/Puppeteer) — hits a login wall, fails
 *           the SAME captcha, gets BLOCKED.
 *   RIGHT = Browser MCP driving your REAL, already-logged-in Chrome — beats the
 *           captcha challenge, fills a field, extracts data LOCALLY.
 *
 * v2 changes (review-driven):
 *  - CAPTCHA is now the dramatic central beat: a real 3x3 challenge grid is
 *    beaten on the right while the SAME grid fails red on the left, synchronized.
 *  - "SOLVED." caption lands on the exact green-verify frame (185).
 *  - End-lockup z-fix (panels blurred + darkened behind the wordmark).
 *  - Open-source / build-with-us signal on the end-card.
 */

export const HERO_DURATION = 1108; // ~37s @ 30fps — split → email-auth → no-API → multi-session → mission

// ---- shared color language -------------------------------------------------
const C = {
  bg0: "#0a0e14",
  bg1: "#0d1117",
  ink: "#e6edf3",
  sub: "#8b949e",
  blue: "#3b82f6",
  green: "#22c55e",
  red: "#ef4444",
  amber: "#f59e0b",
  chromeTab: "#dee1e6",
  chromeActive: "#ffffff",
  chromeUrl: "#f1f3f4",
};

const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "'SF Mono', Menlo, Consolas, monospace";

// ===== key timeline (shared by both panels so they stay synchronized) =======
const T = {
  navEnd: 16,
  loginAt: 16,
  capAppear: 96, // checkbox card appears (both panels)
  capClick: 126, // checkbox clicked
  capGrid: 138, // 3x3 challenge expands
  capTile1: 150,
  capTile2: 162,
  capTile3: 174,
  capResolve: 185, // RIGHT goes green / LEFT goes red — the decisive frame
  capHide: 232, // right grid fades after holding the green state
  fieldFocus: 238,
  typeStart: 244,
  resultAt: 272,
  toastAt: 312,
  lockupAt: 352,
};

// ease helper
const clampInterp = (
  frame: number,
  range: [number, number],
  out: [number, number],
) =>
  interpolate(frame, range, out, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const fadeWindow = (
  frame: number,
  inStart: number,
  inEnd: number,
  outStart: number,
  outEnd: number,
) => {
  const fin = clampInterp(frame, [inStart, inEnd], [0, 1]);
  const fout = clampInterp(frame, [outStart, outEnd], [1, 0]);
  return Math.min(fin, fout);
};

// ===========================================================================
// Top instruction bar — anchors that Claude is driving both browsers.
// Pre-filled ~55% so the open is fast (review P2-B).
// ===========================================================================
const InstructionBar: React.FC = () => {
  const frame = useCurrentFrame();
  const pre = '❯ Claude:  "Pull this month\'s ';
  const rest = 'revenue from the dashboard"';
  const full = pre + rest;
  const chars = pre.length + Math.floor(clampInterp(frame, [2, 22], [0, rest.length]));
  const text = full.slice(0, chars);
  const typing = chars < full.length;
  return (
    <div
      style={{
        height: 64,
        margin: "0 60px",
        background: "#11161f",
        border: `1px solid #232a36`,
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        padding: "0 22px",
        fontFamily: MONO,
        fontSize: 22,
        color: "#a5d6ff",
        boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
      }}
    >
      <span>{text}</span>
      {typing && (
        <span style={{ marginLeft: 2, color: "#58a6ff", opacity: Math.sin(frame * 0.4) > 0 ? 1 : 0 }}>
          ▊
        </span>
      )}
    </div>
  );
};

// ===========================================================================
// Panel label chip
// ===========================================================================
const PanelLabel: React.FC<{ text: string; sub: string; color: string; icon: string }> = ({
  text,
  sub,
  color,
  icon,
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, paddingLeft: 4 }}>
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: 9,
        background: `${color}22`,
        border: `1px solid ${color}66`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 18,
      }}
    >
      {icon}
    </div>
    <div>
      <div style={{ fontFamily: SANS, fontSize: 20, fontWeight: 700, color: C.ink }}>{text}</div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: C.sub, marginTop: 1 }}>{sub}</div>
    </div>
  </div>
);

// ===========================================================================
// CAPTCHA challenge — checkbox -> 3x3 image grid -> verified(green)/failed(red)
// Rendered identically in both panels; `mode` decides the outcome.
// Internal layout is fixed (W=340) so cursor waypoints can be aligned.
// ===========================================================================
const CAP_W = 340;
const TILE = 102;
const TILE_GAP = 6;
const GRID_TOP = 52; // header height inside the grid card
const TILE_EMOJI = ["", "🚦", "", "🚦", "", "", "", "🚦", ""]; // diagonal-ish lights
const PASS_TILES = [1, 3, 7]; // indices the agent selects

const CaptchaChallenge: React.FC<{ mode: "pass" | "fail" }> = ({ mode }) => {
  const frame = useCurrentFrame();
  if (frame < T.capAppear) return null;

  const appear = clampInterp(frame, [T.capAppear, T.capAppear + 8], [0, 1]);
  const checked = frame >= T.capClick;
  const showGrid = frame >= T.capGrid;
  const resolved = frame >= T.capResolve;
  const pass = mode === "pass";

  // pass: grid fades out after holding green; fail: stays
  const hideOp = pass ? clampInterp(frame, [T.capHide, T.capHide + 14], [1, 0]) : 1;
  const op = Math.min(appear, hideOp);
  if (op <= 0.001) return null;

  // fail shake around resolve
  const shake = !pass && frame >= T.capResolve && frame < T.capResolve + 16 ? Math.sin(frame * 1.7) * 4 : 0;

  // pre-grid: the classic "I'm not a robot" checkbox card
  if (!showGrid) {
    return (
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 150,
          transform: `translateX(-50%) scale(${interpolate(appear, [0, 1], [0.96, 1])})`,
          width: CAP_W,
          background: "#f9f9f9",
          border: "1px solid #d3d3d3",
          borderRadius: 6,
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          opacity: op,
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 4,
            border: `2px solid ${checked ? "#4285f4" : "#c1c1c1"}`,
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {checked && (
            <div
              style={{
                width: 16,
                height: 16,
                border: "2px solid #4285f4",
                borderRightColor: "transparent",
                borderRadius: "50%",
                transform: `rotate(${(frame - T.capClick) * 30}deg)`,
              }}
            />
          )}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 16, color: "#444" }}>I'm not a robot</div>
        <div style={{ marginLeft: "auto", textAlign: "center", fontSize: 10, color: "#9aa0a6", lineHeight: 1.05 }}>
          re
          <br />
          CAPTCHA
        </div>
      </div>
    );
  }

  // grid challenge
  const gridIn = clampInterp(frame, [T.capGrid, T.capGrid + 8], [0, 1]);
  const tileShownAt = [T.capTile1, T.capTile2, T.capTile3];
  const selCount = pass ? tileShownAt.filter((f) => frame >= f).length : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: 96,
        transform: `translateX(calc(-50% + ${shake}px)) scale(${interpolate(gridIn, [0, 1], [0.94, 1])})`,
        width: CAP_W,
        background: "#fff",
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: "0 12px 36px rgba(0,0,0,0.28)",
        opacity: op,
        border: resolved ? `2px solid ${pass ? C.green : C.red}` : "1px solid #d3d3d3",
      }}
    >
      {/* challenge prompt header */}
      <div style={{ background: pass ? "#4285f4" : resolved ? C.red : "#4285f4", padding: "10px 14px", color: "#fff", fontFamily: SANS }}>
        <div style={{ fontSize: 12, opacity: 0.9 }}>Select all images with</div>
        <div style={{ fontSize: 19, fontWeight: 700 }}>traffic lights</div>
      </div>
      {/* 3x3 tiles */}
      <div style={{ padding: 8, display: "grid", gridTemplateColumns: `repeat(3, ${TILE}px)`, gap: TILE_GAP }}>
        {TILE_EMOJI.map((emo, i) => {
          const selectedOrder = PASS_TILES.indexOf(i);
          const selected = pass && selectedOrder > -1 && selCount > selectedOrder;
          return (
            <div
              key={i}
              style={{
                width: TILE,
                height: TILE,
                background: i % 2 === 0 ? "#cfd8dc" : "#b0bec5",
                borderRadius: 3,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 34,
                position: "relative",
              }}
            >
              {emo}
              {selected && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(66,133,244,0.45)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      background: "#fff",
                      color: "#4285f4",
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                    }}
                  >
                    ✓
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* footer / verdict */}
      <div style={{ padding: "8px 14px 12px", display: "flex", alignItems: "center" }}>
        {resolved ? (
          <div
            style={{
              fontFamily: SANS,
              fontSize: 16,
              fontWeight: 700,
              color: pass ? C.green : C.red,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {pass ? "✓ Verified" : "✗ Verification failed"}
          </div>
        ) : (
          <div
            style={{
              marginLeft: "auto",
              background: "#4285f4",
              color: "#fff",
              fontFamily: SANS,
              fontSize: 14,
              fontWeight: 600,
              padding: "8px 18px",
              borderRadius: 5,
            }}
          >
            Verify
          </div>
        )}
      </div>
    </div>
  );
};

// ===========================================================================
// LEFT — headless browser that fails the same captcha
// ===========================================================================
const HeadlessPanel: React.FC = () => {
  const frame = useCurrentFrame();

  const loginOp = clampInterp(frame, [T.loginAt, T.loginAt + 10], [0, 1]);
  const blockedAt = T.capResolve + 14; // banner after the captcha fails
  const blocked = frame >= blockedAt;
  const redPulse = frame >= T.capResolve ? 0.4 + Math.abs(Math.sin(frame * 0.08)) * 0.6 : 0;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        overflow: "hidden",
        border: `1px solid ${frame >= T.capResolve ? `${C.red}88` : "#2a3340"}`,
        boxShadow:
          frame >= T.capResolve
            ? `0 0 ${22 * redPulse}px ${C.red}55, 0 10px 40px rgba(0,0,0,0.5)`
            : "0 10px 40px rgba(0,0,0,0.5)",
        filter: blocked ? "saturate(0.8)" : "none",
      }}
    >
      {/* headless chrome — cold, robotic */}
      <div
        style={{
          background: "#161b22",
          padding: "12px 18px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid #232a36",
        }}
      >
        <span style={{ fontSize: 14 }}>🤖</span>
        <div
          style={{
            flex: 1,
            background: "#0d1117",
            borderRadius: 6,
            padding: "6px 12px",
            fontSize: 14,
            color: "#6b7685",
            fontFamily: MONO,
          }}
        >
          headless · no session
        </div>
      </div>

      {/* page */}
      <div style={{ flex: 1, background: "#0b0f15", position: "relative", overflow: "hidden" }}>
        {/* login wall (recedes once the captcha grid is up) */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            opacity: loginOp * clampInterp(frame, [T.capGrid - 6, T.capGrid + 6], [1, 0.18]),
          }}
        >
          <div style={{ fontSize: 38 }}>🔒</div>
          <div style={{ fontFamily: SANS, fontSize: 23, color: "#c9d1d9", fontWeight: 600 }}>
            Sign in to continue
          </div>
        </div>

        {/* same captcha — fails */}
        <CaptchaChallenge mode="fail" />

        {/* blocked banner */}
        {blocked && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              background: `${C.red}1f`,
              borderTop: `2px solid ${C.red}`,
              padding: "14px 0",
              textAlign: "center",
              fontFamily: SANS,
              fontSize: 19,
              fontWeight: 700,
              color: "#fca5a5",
              opacity: clampInterp(frame, [blockedAt, blockedAt + 8], [0, 1]),
            }}
          >
            ⛔ Blocked — bot detected
          </div>
        )}
      </div>
    </div>
  );
};

// ===========================================================================
// ChromeFrame — one realistic, reusable Chrome window (used by S1/S2/S3)
// ===========================================================================
const NavIcon: React.FC<{ d: string; poly?: string }> = ({ d, poly }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#5f6368" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {poly && <polyline points={poly} />}
    <path d={d} />
  </svg>
);

const ChromeFrame: React.FC<{
  url: string;
  tabs?: { label: string; color?: string; active?: boolean }[];
  profile?: boolean;
  accent?: string | null;
  contentBg?: string;
  children: React.ReactNode;
}> = ({ url, tabs, profile, accent, contentBg = "#f8f9fb", children }) => {
  const tabList = tabs ?? [{ label: url.replace(/^https?:\/\//, "").split("/")[0], color: C.green, active: true }];
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        overflow: "hidden",
        border: `1px solid ${accent ? `${accent}88` : "#c9ced6"}`,
        boxShadow: accent ? `0 0 30px ${accent}33, 0 18px 52px rgba(0,0,0,0.5)` : "0 18px 52px rgba(0,0,0,0.5)",
      }}
    >
      {/* tab strip */}
      <div style={{ background: "#d6dae0", padding: "9px 12px 0", display: "flex", alignItems: "flex-end", gap: 5 }}>
        <div style={{ display: "flex", gap: 7, margin: "0 14px 9px 4px" }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c }} />
          ))}
        </div>
        {tabList.map((t, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 16px",
              borderRadius: "10px 10px 0 0",
              background: t.active ? C.chromeActive : "rgba(255,255,255,0.32)",
              color: t.active ? "#3c4043" : "#5f6368",
              fontFamily: SANS,
              fontSize: 13,
              maxWidth: 230,
              boxShadow: t.active ? "0 -1px 5px rgba(0,0,0,0.08)" : "none",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.color ?? "#9aa0a6", flexShrink: 0 }} />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.label}</span>
          </div>
        ))}
      </div>
      {/* toolbar */}
      <div style={{ background: C.chromeActive, padding: "8px 14px", display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid #e3e5e8" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <NavIcon d="M15 18l-6-6 6-6" />
          <NavIcon d="M9 18l6-6-6-6" />
          <NavIcon d="M3.5 9a9 9 0 0 1 14.85-3.36L23 10" poly="23 4 23 10 17 10" />
        </div>
        <div
          style={{
            flex: 1,
            background: C.chromeUrl,
            borderRadius: 16,
            padding: "7px 14px",
            fontSize: 13,
            color: "#3c4043",
            fontFamily: SANS,
            display: "flex",
            alignItems: "center",
            gap: 8,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <span style={{ fontSize: 11 }}>🔒</span> {url}
        </div>
        {profile && (
          <div
            style={{
              width: 28,
              height: 28,
              flexShrink: 0,
              borderRadius: "50%",
              background: "linear-gradient(135deg,#3b82f6,#22c55e)",
              color: "#fff",
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            A
          </div>
        )}
      </div>
      {/* content */}
      <div style={{ flex: 1, background: contentBg, position: "relative", overflow: "hidden" }}>{children}</div>
    </div>
  );
};

// Floating "tool running" badge — names the tool as the browser performs it
const ToolBadge: React.FC<{ name: string; done?: boolean }> = ({ name, done }) => (
  <div
    style={{
      position: "absolute",
      top: 18,
      right: 18,
      display: "flex",
      alignItems: "center",
      gap: 8,
      background: "#0d1117",
      border: `1px solid ${done ? `${C.green}88` : "#2a3340"}`,
      borderRadius: 9,
      padding: "8px 14px",
      fontFamily: MONO,
      fontSize: 15,
      color: done ? "#7ee787" : "#a5d6ff",
      boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
      zIndex: 60,
    }}
  >
    <span>{done ? "✓" : "🔧"}</span>
    {name}
  </div>
);

// ===========================================================================
// RIGHT — Browser MCP driving your real Chrome (success)
// ===========================================================================
const ChromePanel: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const dashOp = clampInterp(frame, [T.loginAt, T.loginAt + 12], [0, 1]);

  // typed period (after captcha)
  const typed = "April 2026";
  const typedChars = Math.floor(clampInterp(frame, [T.typeStart, T.typeStart + 26], [0, typed.length]));

  // result count-up
  const resultProg = clampInterp(frame, [T.resultAt, T.resultAt + 30], [0, 1]);
  const revenue = Math.round(resultProg * 48230);
  const resultVisible = frame >= T.resultAt;
  const fmt = (n: number) => "$" + n.toLocaleString("en-US");

  const toastSpring = spring({ frame: frame - T.toastAt, fps, config: { damping: 14 } });
  const toastOut = clampInterp(frame, [T.lockupAt - 14, T.lockupAt - 2], [1, 0]);

  // panel-local cursor: idle -> checkbox -> 3 tiles -> verify -> field
  const panelCenter = 435; // ~ half of ~870 content width
  const gridLeft = panelCenter - CAP_W / 2;
  const tileC = (col: number, row: number) => ({
    x: gridLeft + 8 + col * (TILE + TILE_GAP) + TILE / 2,
    y: 96 + GRID_TOP + 8 + row * (TILE + TILE_GAP) + TILE / 2,
  });
  const t1 = tileC(1, 0); // index1
  const t2 = tileC(0, 1); // index3
  const t3 = tileC(1, 2); // index7
  const checkboxPt = { x: panelCenter, y: 168 };
  const verifyPt = { x: panelCenter + CAP_W / 2 - 50, y: 96 + GRID_TOP + 8 + 3 * (TILE + TILE_GAP) + 22 };
  const fieldPt = { x: 150, y: 486 };

  const cursorPos = [
    { frame: 78, x: panelCenter + 220, y: 110 },
    { frame: T.capClick - 2, x: checkboxPt.x, y: checkboxPt.y },
    { frame: T.capTile1, x: t1.x, y: t1.y },
    { frame: T.capTile2, x: t2.x, y: t2.y },
    { frame: T.capTile3, x: t3.x, y: t3.y },
    { frame: T.capResolve, x: verifyPt.x, y: verifyPt.y },
    { frame: T.fieldFocus, x: fieldPt.x, y: fieldPt.y },
    { frame: 320, x: fieldPt.x, y: fieldPt.y },
  ];

  return (
    <ChromeFrame
      url="app.dashboard.com/revenue"
      tabs={[{ label: "Dashboard", color: C.green, active: true }]}
      profile
      accent={frame >= T.capResolve && frame < T.lockupAt ? C.green : null}
    >
        {/* dashboard scaffold */}
        <div style={{ opacity: dashOp, padding: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{ fontFamily: SANS, fontSize: 15, color: "#5f6368" }}>Welcome back, Alex</div>
            <span style={{ fontSize: 12, color: C.green, background: `${C.green}1a`, padding: "2px 8px", borderRadius: 20 }}>
              ● signed in
            </span>
          </div>
          <div style={{ fontFamily: SANS, fontSize: 26, fontWeight: 700, color: "#202124" }}>Revenue</div>

          {/* period field */}
          <div style={{ marginTop: 22, fontFamily: SANS, fontSize: 13, color: "#5f6368" }}>Billing period</div>
          <div
            style={{
              marginTop: 6,
              width: 240,
              background: "#fff",
              border: `1px solid ${frame >= T.fieldFocus && frame < T.resultAt ? C.blue : "#dadce0"}`,
              borderRadius: 8,
              padding: "10px 12px",
              fontFamily: SANS,
              fontSize: 15,
              color: "#202124",
              boxShadow: frame >= T.fieldFocus && frame < T.resultAt ? `0 0 0 3px ${C.blue}22` : "none",
            }}
          >
            {typedChars > 0 ? typed.slice(0, typedChars) : <span style={{ color: "#bdc1c6" }}>Select period…</span>}
            {frame >= T.typeStart && typedChars < typed.length && (
              <span style={{ opacity: Math.sin(frame * 0.4) > 0 ? 1 : 0, color: C.blue }}>|</span>
            )}
          </div>

          {/* result */}
          {resultVisible && (
            <div style={{ marginTop: 24 }}>
              <div style={{ fontFamily: SANS, fontSize: 13, color: "#5f6368" }}>Total revenue · April 2026</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 2 }}>
                <div style={{ fontFamily: SANS, fontSize: 52, fontWeight: 800, color: "#202124", letterSpacing: -1 }}>
                  {fmt(revenue)}
                </div>
                {frame >= T.resultAt + 26 && (
                  <div style={{ fontFamily: MONO, fontSize: 13, color: "#5f6368" }}>↑ 12% MoM</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* extracted-data snippet (fills the result area; ringed by the glow) */}
        {frame >= T.resultAt + 14 && (
          <div
            style={{
              position: "absolute",
              left: 24,
              top: 300,
              width: 310,
              height: 92,
              background: "#fff",
              border: "1px solid #e3e5e8",
              borderRadius: 10,
              padding: "12px 16px",
              fontFamily: MONO,
              fontSize: 14,
              lineHeight: 1.5,
              color: "#3c4043",
              boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
              opacity: clampInterp(frame, [T.resultAt + 14, T.resultAt + 26], [0, 1]),
            }}
          >
            <div style={{ color: "#9aa0a6", fontSize: 11, marginBottom: 4, fontFamily: SANS }}>Extracted → your machine</div>
            <div>
              <span style={{ color: "#22863a" }}>"period"</span>: <span style={{ color: "#005cc5" }}>"April 2026"</span>,
            </div>
            <div>
              <span style={{ color: "#22863a" }}>"revenue"</span>: <span style={{ color: "#005cc5" }}>48230</span>
            </div>
          </div>
        )}
        {/* glow ring on the extracted data */}
        <GlowHighlight x={24} y={300} width={310} height={92} visible={frame >= T.resultAt + 26 && frame < T.toastAt + 24} color={C.green} />

        {/* the captcha (success) */}
        <CaptchaChallenge mode="pass" />

        {/* cursor + ripples (panel-local) */}
        <AnimatedCursor positions={cursorPos} />
        <ClickRipple x={checkboxPt.x} y={checkboxPt.y} triggerFrame={T.capClick} />
        <ClickRipple x={t1.x} y={t1.y} triggerFrame={T.capTile1} />
        <ClickRipple x={t2.x} y={t2.y} triggerFrame={T.capTile2} />
        <ClickRipple x={t3.x} y={t3.y} triggerFrame={T.capTile3} />
        <ClickRipple x={verifyPt.x} y={verifyPt.y} triggerFrame={T.capResolve} />

        {/* success toast (staggered after the number lands; out before lockup) */}
        {frame >= T.toastAt && (
          <div
            style={{
              position: "absolute",
              right: 22,
              bottom: 22,
              background: C.green,
              borderRadius: 10,
              padding: "12px 18px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontFamily: SANS,
              fontSize: 15,
              fontWeight: 600,
              color: "#05230f",
              opacity: Math.min(toastSpring, toastOut),
              transform: `translateY(${interpolate(toastSpring, [0, 1], [16, 0])}px)`,
              boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
            }}
          >
            <span style={{ fontWeight: 800 }}>✓</span>
            Extracted — stays on your machine
          </div>
        )}
    </ChromeFrame>
  );
};

// ===========================================================================
// Captions (bottom-center, one at a time; semantics: red=fail, green=win)
// ===========================================================================
const CAPTIONS: { text: string; color: string; in: number; out: number }[] = [
  { text: "WHERE HEADLESS DIES", color: C.red, in: 20, out: 90 },
  { text: "ALREADY LOGGED IN", color: C.blue, in: 96, out: 134 },
  { text: "SAME CAPTCHA", color: "#cbd5e1", in: 140, out: 173 },
  { text: "SOLVED.", color: C.green, in: 186, out: 236 },
  { text: "EXTRACTED LOCALLY", color: C.green, in: 282, out: 344 },
];

const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{ height: 90, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {CAPTIONS.map((c, i) => {
        const op = fadeWindow(frame, c.in, c.in + 9, c.out, c.out + 9);
        if (op <= 0.001) return null;
        const y = interpolate(op, [0, 1], [10, 0]);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              fontFamily: SANS,
              fontSize: 42,
              fontWeight: 800,
              letterSpacing: 2,
              color: "#fff",
              opacity: op,
              transform: `translateY(${y}px)`,
              textShadow: `0 2px 18px ${c.color}66`,
              textAlign: "center",
            }}
          >
            {c.text}
            <div style={{ height: 3, width: 56, background: c.color, margin: "10px auto 0", borderRadius: 2, opacity: op }} />
          </div>
        );
      })}
    </div>
  );
};

// ===========================================================================
// End lockup — product name + open-source/build-with-us signal
// ===========================================================================
const SceneClose: React.FC = () => {
  const frame = useCurrentFrame();
  const start = 8;
  const op = fadeWindow(frame, start, start + 16, 144, 159); // local frames; fade to black at the loop seam
  if (op <= 0.001) return null;
  const dim = op; // full dark backdrop (own scene)
  const chips = ["CAPTCHA solving", "Multi-session", "Human-in-the-loop", "Open source · MIT"];
  const rise = interpolate(op, [0, 1], [16, 0]);
  return (
    <AbsoluteFill style={{ background: `rgba(7,10,16,${dim})`, alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", opacity: op, transform: `translateY(${rise}px)` }}>
        <div style={{ fontFamily: SANS, fontSize: 34, fontWeight: 800, color: "#fff", letterSpacing: 0.5 }}>
          Browser MCP
        </div>
        <div style={{ fontFamily: SANS, fontSize: 22, color: C.sub, fontWeight: 500, marginTop: 8 }}>
          Claude controls
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 70,
            fontWeight: 800,
            letterSpacing: -1,
            marginTop: 0,
            background: "linear-gradient(90deg,#60a5fa,#22c55e)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          your real Chrome
        </div>
        <div style={{ fontFamily: SANS, fontSize: 19, color: C.sub, marginTop: 14 }}>
          The open browser layer for AI agents
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
          {chips.map((c, i) => {
            const lead = i === 0;
            return (
              <div
                key={i}
                style={{
                  fontFamily: SANS,
                  fontSize: 18,
                  color: lead ? "#bbf7d0" : "#cbd5e1",
                  background: lead ? `${C.green}1f` : "#11161f",
                  border: `1px solid ${lead ? `${C.green}88` : "#2a3340"}`,
                  borderRadius: 30,
                  padding: "10px 20px",
                  opacity: clampInterp(frame, [start + 8 + i * 4, start + 20 + i * 4], [0, 1]),
                }}
              >
                {c}
              </div>
            );
          })}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 19, color: "#7ee787", marginTop: 28 }}>npx @agent360/browser-mcp</div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 17,
            color: "#9aa6b2",
            marginTop: 12,
            opacity: clampInterp(frame, [start + 28, start + 42], [0, 1]),
          }}
        >
          <span style={{ color: C.amber }}>★</span> MIT · free · yours to fork — build it with us · github.com/Agent360dk/browser-mcp
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// Hero
// ===========================================================================
// Scene 1 — the proven split-screen (headless dies + captcha). Local frames = absolute (Sequence from=0).
const SceneSplit: React.FC = () => {
  const frame = useCurrentFrame();
  const vis = fadeWindow(frame, 0, 12, 348, 372); // fade in from black, crossfade out into Scene 2

  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 50% 0%, ${C.bg1}, ${C.bg0})` }}>
      <AbsoluteFill style={{ opacity: vis }}>
        <div style={{ paddingTop: 40 }}>
          <InstructionBar />
        </div>
        <div style={{ flex: 1, display: "flex", gap: 36, padding: "26px 60px 0" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <PanelLabel text="Headless browser" sub="Playwright · Puppeteer" color={C.red} icon="🤖" />
            <HeadlessPanel />
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <PanelLabel text="Browser MCP" sub="your real Chrome" color={C.green} icon="🌐" />
            <ChromePanel />
          </div>
        </div>
        <Captions />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// Big bottom caption for the appended scenes (local-frame)
const SceneCaption: React.FC<{ text: string; color: string; appear: number }> = ({ text, color, appear }) => {
  const frame = useCurrentFrame();
  const op = clampInterp(frame, [appear, appear + 10], [0, 1]);
  return (
    <div style={{ position: "absolute", bottom: 54, left: 0, right: 0, textAlign: "center", opacity: op }}>
      <span
        style={{
          fontFamily: SANS,
          fontSize: 44,
          fontWeight: 800,
          letterSpacing: 2,
          color: "#fff",
          textShadow: `0 2px 18px ${color}66`,
        }}
      >
        {text}
      </span>
      <div style={{ height: 3, width: 60, background: color, margin: "12px auto 0", borderRadius: 2 }} />
    </div>
  );
};

// Scene (email-auth) — the strongest "doesn't stop": reads the emailed code from your Gmail and continues the login
const SceneEmailAuth: React.FC = () => {
  const frame = useCurrentFrame();
  const vis = fadeWindow(frame, 0, 12, 188, 206); // dur 208

  const onGmail = frame >= 44 && frame < 114;
  const code = "729481";
  const codeChars = Math.floor(clampInterp(frame, [120, 156], [0, code.length]));
  const signedIn = frame >= 168;

  const tools = [
    { name: "browser_switch_tab", in: 36, doneAt: 70, out: 78 },
    { name: "browser_get_page_content", in: 78, doneAt: 110, out: 118 },
    { name: "browser_fill", in: 118, doneAt: 162, out: 208 },
  ];
  const active = tools.find((t) => frame >= t.in && frame < t.out);

  const tabs = [
    { label: "Acme — Sign in", color: "#3b82f6", active: !onGmail },
    { label: "Gmail — Inbox", color: "#ea4335", active: onGmail },
  ];

  const inbox = [
    { from: "Acme Security", subj: "Your verification code", snip: "Your code is 729481 — expires in 10 minutes", hot: true },
    { from: "GitHub", subj: "[browser-mcp]", snip: "someone starred your repository", hot: false },
    { from: "Figma", subj: "Weekly digest", snip: "3 files updated in your team", hot: false },
  ];

  const c1 = fadeWindow(frame, 16, 26, 102, 112); // "EMAILED A CODE?"
  const c2 = fadeWindow(frame, 118, 128, 196, 206); // "IT READS YOUR GMAIL."
  const capBase: React.CSSProperties = {
    position: "absolute",
    bottom: 54,
    left: 0,
    right: 0,
    textAlign: "center",
  };
  const capText = (color: string): React.CSSProperties => ({
    fontFamily: SANS,
    fontSize: 44,
    fontWeight: 800,
    letterSpacing: 2,
    color: "#fff",
    textShadow: `0 2px 18px ${color}66`,
  });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: vis }}>
      <div style={{ width: 1240, height: 600, marginBottom: 44 }}>
        <ChromeFrame url={onGmail ? "mail.google.com/u/0/#inbox" : "acme.app/login/verify"} tabs={tabs} profile>
          {onGmail ? (
            <div style={{ height: "100%", background: "#fff" }}>
              {inbox.map((m, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 16,
                    padding: "18px 26px",
                    borderBottom: "1px solid #eee",
                    background: m.hot ? "#fffbeb" : "#fff",
                    alignItems: "center",
                  }}
                >
                  <div style={{ width: 9, height: 9, borderRadius: "50%", background: m.hot ? "#ea4335" : "#dadce0", flexShrink: 0 }} />
                  <div style={{ width: 190, flexShrink: 0, fontFamily: SANS, fontSize: 16, fontWeight: m.hot ? 700 : 500, color: "#202124" }}>{m.from}</div>
                  <div style={{ fontFamily: SANS, fontSize: 16, color: "#202124", whiteSpace: "nowrap", overflow: "hidden" }}>
                    <span style={{ fontWeight: m.hot ? 700 : 600 }}>{m.subj}</span>
                    <span style={{ color: "#5f6368" }}> — {m.snip}</span>
                  </div>
                </div>
              ))}
              <GlowHighlight x={18} y={10} width={1160} height={62} visible={frame >= 84 && frame < 114} color={C.amber} />
            </div>
          ) : (
            <div style={{ padding: 48, height: "100%" }}>
              <div style={{ fontFamily: SANS, fontSize: 28, fontWeight: 700, color: "#202124" }}>Verify it's you</div>
              <div style={{ marginTop: 10, fontFamily: SANS, fontSize: 16, color: "#5f6368" }}>Enter the 6-digit code we emailed you</div>
              <div style={{ display: "flex", gap: 12, marginTop: 30 }}>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: 58,
                      height: 66,
                      border: `2px solid ${signedIn ? C.green : i === codeChars && frame >= 120 ? C.blue : "#dadce0"}`,
                      borderRadius: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: SANS,
                      fontSize: 30,
                      fontWeight: 700,
                      color: "#202124",
                      background: "#fff",
                    }}
                  >
                    {i < codeChars ? code[i] : ""}
                  </div>
                ))}
              </div>
              {signedIn && (
                <div style={{ marginTop: 30, display: "flex", alignItems: "center", gap: 10, fontFamily: SANS, fontSize: 18, fontWeight: 700, color: C.green }}>
                  <span>✓</span> Signed in — without you lifting a finger
                </div>
              )}
            </div>
          )}
          {active && <ToolBadge name={active.name} done={frame >= active.doneAt} />}
        </ChromeFrame>
      </div>
      {c1 > 0.001 && (
        <div style={{ ...capBase, opacity: c1 }}>
          <span style={capText(C.red)}>OTHER AGENTS STOP AT THE EMAIL CODE</span>
          <div style={{ height: 3, width: 60, background: C.red, margin: "12px auto 0", borderRadius: 2 }} />
        </div>
      )}
      {c2 > 0.001 && (
        <div style={{ ...capBase, opacity: c2 }}>
          <span style={capText(C.green)}>IT READS YOUR GMAIL & CONTINUES</span>
          <div style={{ height: 3, width: 60, background: C.green, margin: "12px auto 0", borderRadius: 2 }} />
        </div>
      )}
    </AbsoluteFill>
  );
};

// Scene 2 — the case APIs CAN'T do: a legacy portal with NO public API, driven like a human
const SceneBreadth: React.FC = () => {
  const frame = useCurrentFrame();
  const vis = fadeWindow(frame, 0, 12, 190, 206); // dur 208

  // each tool is a visible browser action + a floating named badge
  const tools = [
    { name: "browser_navigate", in: 8, doneAt: 42, out: 56 },
    { name: "browser_fill", in: 56, doneAt: 98, out: 104 },
    { name: "browser_click", in: 104, doneAt: 140, out: 146 },
    { name: "browser_get_page_content", in: 146, doneAt: 186, out: 202 },
  ];
  const active = tools.find((t) => frame >= t.in && frame < t.out);

  const pageOp = clampInterp(frame, [12, 36], [0, 1]);
  const ref = "PO-4821";
  const refChars = Math.floor(clampInterp(frame, [64, 92], [0, ref.length]));
  const submitted = frame >= 132;
  const resultShown = frame >= 150;

  const fieldPt = { x: 250, y: 140 };
  const savePt = { x: 110, y: 214 };
  const cursorPos = [
    { frame: 50, x: 760, y: 120 },
    { frame: 64, x: fieldPt.x, y: fieldPt.y },
    { frame: 104, x: fieldPt.x, y: fieldPt.y },
    { frame: 122, x: savePt.x, y: savePt.y },
    { frame: 202, x: savePt.x, y: savePt.y },
  ];

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: vis }}>
      <div style={{ width: 1240, height: 600, marginBottom: 44 }}>
        <ChromeFrame url="supplier-portal.acme-intl.com/orders/new" tabs={[{ label: "Supplier Portal", color: "#f59e0b", active: true }]} profile>
          <div style={{ opacity: pageOp, height: "100%", display: "flex" }}>
            {/* legacy portal form the agent operates */}
            <div style={{ flex: 1, padding: 40 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ fontFamily: SANS, fontSize: 26, fontWeight: 700, color: "#202124" }}>Submit order</div>
                <span
                  style={{
                    fontFamily: SANS,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#92400e",
                    background: "#fef3c7",
                    border: "1px solid #fcd34d",
                    borderRadius: 20,
                    padding: "3px 12px",
                  }}
                >
                  🔌 No public API
                </span>
              </div>
              <div style={{ marginTop: 26, fontFamily: SANS, fontSize: 14, color: "#5f6368" }}>Order reference</div>
              <div
                style={{
                  marginTop: 6,
                  width: 420,
                  background: "#fff",
                  border: `1px solid ${active?.name === "browser_fill" ? C.blue : "#dadce0"}`,
                  borderRadius: 8,
                  padding: "12px 14px",
                  fontFamily: SANS,
                  fontSize: 16,
                  color: "#202124",
                  boxShadow: active?.name === "browser_fill" ? `0 0 0 3px ${C.blue}22` : "none",
                }}
              >
                {refChars > 0 ? ref.slice(0, refChars) : <span style={{ color: "#bdc1c6" }}>Enter reference…</span>}
                {frame >= 64 && refChars < ref.length && <span style={{ color: C.blue }}>|</span>}
              </div>
              <div
                style={{
                  marginTop: 30,
                  width: 160,
                  background: submitted ? C.green : "#1a73e8",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "12px 0",
                  textAlign: "center",
                  fontFamily: SANS,
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                {submitted ? "✓ Submitted" : "Submit order"}
              </div>
            </div>
            {/* result: done what no API could */}
            {resultShown && (
              <div style={{ width: 440, padding: "40px 40px 40px 0" }}>
                <div
                  style={{
                    background: "#0d1117",
                    borderRadius: 12,
                    padding: 22,
                    opacity: clampInterp(frame, [150, 168], [0, 1]),
                    boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
                  }}
                >
                  <div style={{ fontFamily: SANS, fontSize: 14, color: "#7ee787", marginBottom: 10 }}>
                    ✓ Order PO-4821 submitted · receipt.pdf saved
                  </div>
                  <div style={{ fontFamily: SANS, fontSize: 13, color: "#8b949e", lineHeight: 1.5 }}>
                    This portal has no API, no webhook, no connector.
                    <br />
                    The agent just used it — like you would.
                  </div>
                </div>
              </div>
            )}
          </div>
          {active && <ToolBadge name={active.name} done={frame >= active.doneAt} />}
          <AnimatedCursor positions={cursorPos} />
          <ClickRipple x={savePt.x} y={savePt.y} triggerFrame={122} />
        </ChromeFrame>
      </div>
      <SceneCaption text="NO API?  NO PROBLEM." color={C.green} appear={18} />
    </AbsoluteFill>
  );
};

// Scene 3 — multi-session flex: many isolated, color-coded sessions in one Chrome
const SceneMultiSession: React.FC = () => {
  const frame = useCurrentFrame();
  const vis = fadeWindow(frame, 0, 12, 146, 162); // dur 164
  const groups = [
    { label: "Supplier portal", color: "#3b82f6", active: true },
    { label: "Insurer dashboard", color: "#22c55e" },
    { label: "Internal admin", color: "#f59e0b" },
  ];
  const tasks = [
    { color: "#3b82f6", site: "Supplier portal", action: "Filing 12 orders", doneAt: 64 },
    { color: "#22c55e", site: "Insurer dashboard", action: "Pulling claim status", doneAt: 82 },
    { color: "#f59e0b", site: "Internal admin", action: "Updating records", doneAt: 100 },
  ];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: vis }}>
      <div style={{ width: 1340, height: 560, marginBottom: 40 }}>
        <ChromeFrame url="chrome — 3 logged-in tools · no integrations" tabs={groups} profile>
          <div style={{ display: "flex", height: "100%" }}>
            {tasks.map((t, i) => {
              const done = frame >= t.doneAt;
              return (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    borderLeft: i ? "1px solid #eceef1" : "none",
                    borderTop: `3px solid ${t.color}`,
                    padding: 28,
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 11, height: 11, borderRadius: "50%", background: t.color }} />
                    <span style={{ fontFamily: SANS, fontSize: 18, fontWeight: 700, color: "#202124" }}>{t.site}</span>
                  </div>
                  <div style={{ fontFamily: SANS, fontSize: 15, color: "#5f6368" }}>{t.action}…</div>
                  <div
                    style={{
                      marginTop: "auto",
                      fontFamily: SANS,
                      fontSize: 15,
                      fontWeight: 700,
                      color: done ? "#16a34a" : "#9aa0a6",
                    }}
                  >
                    {done ? "✓ done" : "running…"}
                  </div>
                </div>
              );
            })}
          </div>
        </ChromeFrame>
      </div>
      <SceneCaption text="TEN AGENTS. ZERO COLLISIONS." color={C.green} appear={16} />
    </AbsoluteFill>
  );
};

// ===========================================================================
// Hero — master timeline: split → breadth → multi-session → mission close
// ===========================================================================
export const Hero: React.FC = () => {
  const frame = useCurrentFrame();
  const seam = fadeWindow(frame, 0, 10, 1096, 1108); // global black dip at the loop seam

  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 50% 0%, ${C.bg1}, ${C.bg0})` }}>
      <AbsoluteFill style={{ opacity: seam }}>
        <Sequence from={0} durationInFrames={372}>
          <SceneSplit />
        </Sequence>
        <Sequence from={372} durationInFrames={208}>
          <SceneEmailAuth />
        </Sequence>
        <Sequence from={580} durationInFrames={156}>
          <SceneClose />
        </Sequence>
        <Sequence from={736} durationInFrames={208}>
          <SceneBreadth />
        </Sequence>
        <Sequence from={944} durationInFrames={164}>
          <SceneMultiSession />
        </Sequence>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
