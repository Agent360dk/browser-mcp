import React from "react";
import {
  AbsoluteFill,
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

export const HERO_DURATION = 450; // 15s @ 30fps

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
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        overflow: "hidden",
        border: `1px solid ${frame >= T.capResolve && frame < T.lockupAt ? `${C.green}66` : "#2a3340"}`,
        boxShadow: "0 12px 44px rgba(0,0,0,0.55)",
      }}
    >
      {/* real-chrome top bar (light) */}
      <div style={{ background: C.chromeTab, padding: "8px 12px 0", display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex", gap: 6, marginRight: 10 }}>
          <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#ff5f57" }} />
          <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#febc2e" }} />
          <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#28c840" }} />
        </div>
        <div
          style={{
            background: C.chromeActive,
            borderRadius: "10px 10px 0 0",
            padding: "8px 16px",
            fontSize: 13,
            color: "#3c4043",
            fontFamily: SANS,
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 -1px 4px rgba(0,0,0,0.06)",
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.green }} />
          Dashboard
        </div>
      </div>
      <div
        style={{
          background: C.chromeActive,
          padding: "8px 14px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderBottom: "1px solid #e3e5e8",
        }}
      >
        <div style={{ color: "#9aa0a6", fontSize: 17, letterSpacing: 5, fontFamily: SANS }}>‹ › ⟳</div>
        <div
          style={{
            flex: 1,
            background: C.chromeUrl,
            borderRadius: 16,
            padding: "7px 14px",
            fontSize: 13,
            color: "#3c4043",
            fontFamily: SANS,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          🔒 app.dashboard.com/revenue
        </div>
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
      </div>

      {/* page content (relative — cursor + ripples are panel-local) */}
      <div style={{ flex: 1, background: "#f8f9fb", position: "relative", overflow: "hidden" }}>
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
      </div>
    </div>
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
const EndLockup: React.FC = () => {
  const frame = useCurrentFrame();
  const start = T.lockupAt;
  const op = fadeWindow(frame, start, start + 16, 436, 449);
  if (op <= 0.001) return null;
  const dim = op * 0.95; // P1-D: dark backdrop so panels don't bleed through
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
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
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
          <span style={{ color: C.amber }}>★</span> Free &amp; open source — build it with us · github.com/Agent360dk/browser-mcp
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// Hero
// ===========================================================================
export const Hero: React.FC = () => {
  const frame = useCurrentFrame();
  const seam = fadeWindow(frame, 0, 12, 440, 450); // seamless loop via black dip
  // P1-D: blur + darken the panels behind the end-lockup
  const lockFade = clampInterp(frame, [T.lockupAt - 4, T.lockupAt + 22], [1, 0.12]);
  const lockBlur = clampInterp(frame, [T.lockupAt - 4, T.lockupAt + 22], [0, 9]);

  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 50% 0%, ${C.bg1}, ${C.bg0})` }}>
      <AbsoluteFill style={{ opacity: seam * lockFade, filter: `blur(${lockBlur}px)` }}>
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

      <AbsoluteFill style={{ opacity: seam }}>
        <EndLockup />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
