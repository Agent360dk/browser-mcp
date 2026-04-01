import React from "react";
import {
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
  Sequence,
  AbsoluteFill,
} from "remotion";
import { Terminal } from "./components/Terminal";
import { Browser, AskUserOverlay } from "./components/Browser";
import {
  StripeDashboard,
  GoogleOAuthForm,
  HubSpotDashboard,
  SlackPage,
} from "./components/PageContent";
import { LinkedInPage, RailwayDashboard, NetworkMonitor } from "./components/MorePages";
import { SceneLabel, AnimatedCursor, ClickRipple, GlowHighlight, Takeaway } from "./components/Effects";

// ── Layout ───────────────────────────────────────────────────────────────

const SplitLayout: React.FC<{
  terminal: React.ReactNode;
  browser: React.ReactNode;
  label?: string;
}> = ({ terminal, browser, label }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Content fades in AFTER scene label disappears (label ends at frame 32)
  const fadeIn = spring({ frame: Math.max(0, frame - 28), fps, config: { damping: 12 } });

  return (
    <AbsoluteFill
      style={{
        background: "#0a0a0a",
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {label && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            opacity: interpolate(frame, [32, 42], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6" }} />
          <span style={{ color: "#58a6ff", fontSize: 13, fontFamily: "SF Mono, monospace", fontWeight: 500 }}>
            {label}
          </span>
        </div>
      )}
      <div style={{ flex: 1, display: "flex", gap: 16, opacity: fadeIn }}>
        <div style={{ flex: 1, display: "flex" }}>{terminal}</div>
        <div style={{ flex: 1.2, display: "flex", position: "relative" }}>{browser}</div>
      </div>
    </AbsoluteFill>
  );
};

// ── Scene 1: Navigate to Stripe ──────────────────────────────────────────

const Scene1Navigate: React.FC = () => {
  const frame = useCurrentFrame();
  const showLoading = frame >= 25 && frame < 60;
  const showDashboard = frame >= 60;

  return (
    <>
      <SceneLabel number={1} text="Navigate" subtext="Open any URL in your real Chrome" />
      <Takeaway text="Your real browser. Already logged in. No re-auth needed." startFrame={130} />
      <SplitLayout
        label="Uses your real cookies & logins — no re-authentication needed"
        terminal={
          <Terminal
            lines={[
              { text: 'browser_navigate("https://dashboard.stripe.com/apikeys")', type: "command", delay: 10 },
              { text: "→ Navigating...", type: "info", delay: 25 },
              { text: '✓ "API keys — Stripe Dashboard"', type: "success", delay: 60 },
              { text: "  Already logged in — real Chrome session", type: "info", delay: 66 },
              { text: "", type: "output", delay: 74 },
              { text: "browser_get_page_content()", type: "command", delay: 78 },
              { text: '✓ Found: sk_live_••••4242', type: "success", delay: 105 },
              { text: "  → Saved to Agent360 vault", type: "info", delay: 112 },
            ]}
          />
        }
        browser={
          <Browser url="dashboard.stripe.com/apikeys">
            {showLoading && <StripeDashboard loading />}
            {showDashboard && (
              <>
                <StripeDashboard />
                {frame >= 110 && (
                  <div style={{
                    position: "absolute", bottom: 24, right: 24,
                    background: "#22c55e", color: "#fff", padding: "10px 20px", borderRadius: 8,
                    fontSize: 14, fontWeight: 600, fontFamily: "system-ui",
                    boxShadow: "0 4px 16px rgba(34,197,94,0.4)",
                  }}>
                    ✓ API key extracted and saved to vault
                  </div>
                )}
              </>
            )}
            {!showLoading && !showDashboard && (
              <div style={{ width: "100%", height: "100%", background: "#f6f8fa", display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: 14, fontFamily: "system-ui" }}>
                New Tab
              </div>
            )}
          </Browser>
        }
      />
    </>
  );
};

// ── Scene 2: Click + Fill on Google Cloud ────────────────────────────────

const Scene2ClickFill: React.FC = () => {
  const frame = useCurrentFrame();
  const field1Filled = frame >= 55;
  const field2Filled = frame >= 90;
  const field3Filled = frame >= 120;
  const highlightIdx = frame < 55 ? 0 : frame < 90 ? 1 : frame < 120 ? 2 : -1;

  return (
    <>
      <SceneLabel number={2} text="Click + Fill" subtext="Works on Google, Stripe, Slack (CSP bypass)" />
      <Takeaway text="Chrome Debugger API bypasses CSP. Text selectors — no CSS needed." startFrame={160} />
      <SplitLayout
        label='text selectors: click("text=Get started") — no CSS selectors needed'
        terminal={
          <Terminal
            lines={[
              { text: 'click("text=Get started")', type: "command", delay: 10 },
              { text: "✓ Clicked via debugger (CSP bypass)", type: "success", delay: 32 },
              { text: "", type: "output", delay: 37 },
              { text: 'fill("[name=app_name]", "Agent360")', type: "command", delay: 40 },
              { text: "✓ Typed via real keystrokes", type: "success", delay: 55 },
              { text: "", type: "output", delay: 60 },
              { text: 'fill("[type=email]", "gustav@agent360.dk")', type: "command", delay: 65 },
              { text: "✓ Filled", type: "success", delay: 90 },
              { text: "", type: "output", delay: 95 },
              { text: 'select_option("[name=audience]", "External")', type: "command", delay: 98 },
              { text: "✓ Dropdown: External", type: "success", delay: 120 },
              { text: "", type: "output", delay: 125 },
              { text: 'click("text=Create")', type: "command", delay: 130 },
              { text: "✓ OAuth consent created!", type: "success", delay: 148 },
            ]}
          />
        }
        browser={
          <Browser url="console.cloud.google.com/auth/branding">
            <GoogleOAuthForm
              fields={[
                { label: "App name *", value: field1Filled ? "Agent360" : "", filled: field1Filled },
                { label: "User support email *", value: field2Filled ? "gustav@agent360.dk" : "", filled: field2Filled },
                { label: "Audience", value: field3Filled ? "External" : "", filled: field3Filled },
              ]}
              highlightIndex={highlightIdx}
            />
          </Browser>
        }
      />
    </>
  );
};

// ── Scene 3: Human-in-the-loop 2FA ───────────────────────────────────────

const Scene3HumanInLoop: React.FC = () => {
  const frame = useCurrentFrame();
  const showOverlay = frame >= 40;
  const showTypingDots = frame >= 75 && frame < 100; // user is typing...
  const showCode = frame >= 100;
  const overlayDismissed = frame >= 115; // overlay stays 15 frames after code
  const showSuccess = frame >= 125;

  return (
    <>
      <SceneLabel number={3} text="Human-in-the-loop" subtext="2FA, CAPTCHA, OAuth — the agent asks, you answer" />
      <Takeaway text="Agent pauses for 2FA/CAPTCHA. You answer, it continues." startFrame={155} />
      <SplitLayout
        label="browser_ask_user — overlay with sound notification"
        terminal={
          <Terminal
            lines={[
              { text: 'navigate("https://app.hubspot.com")', type: "command", delay: 10 },
              { text: "→ 2FA required", type: "info", delay: 28 },
              { text: "", type: "output", delay: 33 },
              { text: 'ask_user("Enter 2FA code")', type: "command", delay: 35 },
              { text: "🔔 Overlay shown + notification", type: "info", delay: 42 },
              { text: "⏳ Waiting for user...", type: "info", delay: 48 },
              { text: "  User is typing...", type: "info", delay: 75 },
              { text: "", type: "output", delay: 100 },
              { text: '✓ User entered: "847291"', type: "success", delay: 100 },
              { text: 'fill("#otp", "847291")', type: "command", delay: 110 },
              { text: 'press_key("Enter")', type: "command", delay: 120 },
              { text: "✓ Logged in!", type: "success", delay: 125 },
              { text: "", type: "output", delay: 132 },
              { text: "browser_get_page_content()", type: "command", delay: 135 },
              { text: '✓ "HubSpot Dashboard — Contacts"', type: "success", delay: 148 },
            ]}
          />
        }
        browser={
          <Browser url="app.hubspot.com/login/2fa">
            <div style={{ width: "100%", height: "100%", background: "#f5f8fa", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
              <div style={{ background: "#fff", borderRadius: 8, padding: 32, boxShadow: "0 2px 8px rgba(0,0,0,0.1)", textAlign: "center", width: 300 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#ff7a59", marginBottom: 16 }}>HubSpot</div>
                <div style={{ fontSize: 14, color: "#33475b", marginBottom: 16 }}>Two-factor authentication</div>
                <div style={{ border: `2px solid ${showCode ? "#22c55e" : "#cbd6e2"}`, borderRadius: 4, padding: 12, fontSize: 24, letterSpacing: 8, color: "#33475b", fontFamily: "SF Mono, monospace" }}>
                  {showCode ? "847291" : "______"}
                </div>
              </div>
            </div>
            <AskUserOverlay
              message="Enter the 2FA code from your authenticator app"
              title="HubSpot — 2FA Required"
              fieldLabel="2FA Code"
              fieldValue={showCode ? "847291" : showTypingDots ? "84..." : ""}
              visible={showOverlay && !overlayDismissed}
            />
            {showSuccess && (
              <div style={{
                position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                background: "#22c55e", color: "#fff", padding: "14px 32px", borderRadius: 8,
                fontSize: 18, fontWeight: 600, fontFamily: "system-ui",
                boxShadow: "0 4px 24px rgba(34,197,94,0.5)",
              }}>
                ✓ Authenticated — Dashboard Loading
              </div>
            )}
          </Browser>
        }
      />
    </>
  );
};

// ── Scene 4: LinkedIn contenteditable ────────────────────────────────────

const Scene4LinkedIn: React.FC = () => {
  const frame = useCurrentFrame();
  const messageText = "Hi Lars — saw your post about AI in sales. We built a voice agent that books 20+ meetings/month for teams like yours. Got 15 min for a demo?";
  const typingStart = 42;
  const visibleChars = Math.min(Math.floor((frame - typingStart) * 2.0), messageText.length);
  const typedMessage = frame >= typingStart ? messageText.slice(0, Math.max(0, visibleChars)) : "";
  const sent = frame >= 130;

  return (
    <>
      <SceneLabel number={4} text="Rich Text Editors" subtext="LinkedIn, Slack, Notion — contenteditable" />
      <Takeaway text="Types in LinkedIn, Slack, Notion — human-like cadence, no detection." startFrame={140} />
      <SplitLayout
        label="Types via execCommand — rich editors update correctly"
        terminal={
          <Terminal
            lines={[
              { text: 'navigate("linkedin.com/in/lars-hansen")', type: "command", delay: 10 },
              { text: '✓ "Lars Hansen — VP Sales"', type: "success", delay: 28 },
              { text: "", type: "output", delay: 33 },
              { text: 'click("text=Message")', type: "command", delay: 35 },
              { text: "✓ Composer opened", type: "success", delay: 42 },
              { text: "", type: "output", delay: 46 },
              { text: 'fill("[contenteditable]", "Hi Lars...")', type: "command", delay: 48 },
              { text: "  human-like cadence (30-120ms)...", type: "info", delay: 52 },
              { text: "✓ 127 chars typed", type: "success", delay: 110 },
              { text: "", type: "output", delay: 115 },
              { text: 'press_key("Enter", { meta: true })', type: "command", delay: 118 },
              { text: "✓ Message sent!", type: "success", delay: 130 },
            ]}
          />
        }
        browser={
          <Browser url="linkedin.com/in/lars-hansen">
            <LinkedInPage messageTyped={typedMessage} />
            {sent && (
              <div style={{
                position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                background: "#22c55e", color: "#fff", padding: "14px 32px", borderRadius: 8,
                fontSize: 18, fontWeight: 600, fontFamily: "system-ui",
                boxShadow: "0 4px 24px rgba(34,197,94,0.5)",
              }}>
                ✓ Message Sent
              </div>
            )}
          </Browser>
        }
      />
    </>
  );
};

// ── Scene 5: Network Wait ────────────────────────────────────────────────

const Scene5Network: React.FC = () => {
  const frame = useCurrentFrame();
  const deployStatus = frame < 30 ? "idle" : frame < 110 ? "deploying" : "success";
  const requests = [
    ...(frame >= 55 ? [{ url: "POST /api/v1/deployments/create", status: 202, time: "142ms" }] : []),
    ...(frame >= 75 ? [{ url: "GET  /api/v1/deployments/status", status: 200, time: "89ms" }] : []),
    ...(frame >= 95 ? [{ url: "GET  /api/v1/deployments/logs", status: 200, time: "234ms" }] : []),
    ...(frame >= 115 ? [{ url: "GET  /api/v1/health", status: 200, time: "12ms" }] : []),
  ];

  return (
    <>
      <SceneLabel number={5} text="Network Monitoring" subtext="Wait for API calls — no race conditions" />
      <Takeaway text="Monitors real network traffic. No more 'element not found' race conditions." startFrame={145} />
      <SplitLayout
        label="wait_for_network — real Chrome DevTools Protocol"
        terminal={
          <Terminal
            lines={[
              { text: 'click("text=Deploy")', type: "command", delay: 10 },
              { text: "✓ Deploy triggered", type: "success", delay: 25 },
              { text: "", type: "output", delay: 30 },
              { text: 'wait_for_network("deployments")', type: "command", delay: 33 },
              { text: "⏳ Monitoring...", type: "info", delay: 45 },
              { text: "  → POST /create — 202", type: "output", delay: 55 },
              { text: "  → GET /status — 200", type: "output", delay: 75 },
              { text: "  → GET /logs — 200", type: "output", delay: 95 },
              { text: "  → GET /health — 200", type: "output", delay: 115 },
              { text: "✓ Deploy complete!", type: "success", delay: 120 },
              { text: "", type: "output", delay: 125 },
              { text: "browser_get_page_content()", type: "command", delay: 128 },
              { text: '✓ "Deploy successful — service healthy"', type: "success", delay: 138 },
            ]}
          />
        }
        browser={
          <Browser url="railway.com/project/agent360dk">
            <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
              <div style={{ flex: 1 }}><RailwayDashboard status={deployStatus} /></div>
              {requests.length > 0 && (
                <div style={{ height: 140, borderTop: "1px solid #30363d" }}>
                  <NetworkMonitor requests={requests} />
                </div>
              )}
            </div>
          </Browser>
        }
      />
    </>
  );
};

// ── Scene 6: Multi-session ───────────────────────────────────────────────

const Scene6MultiSession: React.FC = () => {
  const frame = useCurrentFrame();
  const tabGroups = [
    { label: "Claude 1", color: "#3b82f6", active: frame < 55 },
    { label: "Claude 2", color: "#22c55e", active: frame >= 55 && frame < 100 },
    { label: "Claude 3", color: "#f59e0b", active: frame >= 100 },
  ];
  const active = frame < 55 ? "stripe" : frame < 100 ? "hubspot" : "slack";

  return (
    <>
      <SceneLabel number={6} text="Multi-Session" subtext="Up to 10 Claude instances, isolated tab groups" />
      <Takeaway text="10 Claude instances. Isolated tabs. No cross-session interference." startFrame={130} />
      <SplitLayout
        label="Each session gets its own color-coded Chrome Tab Group"
        terminal={
          <Terminal
            title="3 Claude Code sessions running"
            lines={[
              { text: "Active sessions:", type: "info", delay: 10 },
              { text: "  🔵 Claude 1 → Stripe: API key", type: "output", delay: 18 },
              { text: "  🟢 Claude 2 → HubSpot: CRM", type: "output", delay: 25 },
              { text: "  🟡 Claude 3 → Slack: alerts", type: "output", delay: 32 },
              { text: "", type: "output", delay: 42 },
              { text: "Isolated — no interference", type: "info", delay: 45 },
              { text: "", type: "output", delay: 52 },
              { text: "✓ Stripe: key saved to vault", type: "success", delay: 55 },
              { text: "✓ HubSpot: CRM connected", type: "success", delay: 85 },
              { text: "✓ Slack: alert posted", type: "success", delay: 115 },
            ]}
          />
        }
        browser={
          <Browser
            url={active === "stripe" ? "dashboard.stripe.com" : active === "hubspot" ? "app.hubspot.com" : "app.slack.com"}
            tabGroups={tabGroups}
          >
            {active === "stripe" && <StripeDashboard />}
            {active === "hubspot" && <HubSpotDashboard />}
            {active === "slack" && <SlackPage />}
          </Browser>
        }
      />
    </>
  );
};

// ── Hook — 2 beats before title card ─────────────────────────────────────

const Hook: React.FC = () => {
  const frame = useCurrentFrame();

  // Beat 1: "Your AI can't use a browser." (frame 0-50) — instant visible
  const beat1Opacity = interpolate(frame, [0, 3, 42, 50], [0, 1, 1, 0], { extrapolateRight: "clamp" });

  // Beat 2: "Until now." (frame 48-92) — quick in, clean out
  const beat2Opacity = interpolate(frame, [48, 53, 82, 92], [0, 1, 1, 0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: "#0a0a0a", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{
        position: "absolute",
        fontSize: 48, fontWeight: 700, color: "#fff", fontFamily: "system-ui",
        opacity: beat1Opacity,
      }}>
        Your AI can't use a browser.
      </div>
      <div style={{
        position: "absolute",
        fontSize: 56, fontWeight: 800, color: "#3b82f6", fontFamily: "system-ui",
        opacity: beat2Opacity,
      }}>
        Until now.
      </div>
    </AbsoluteFill>
  );
};

// ── Title Card (original v7) ─────────────────────────────────────────────

const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = spring({ frame: frame + 8, fps, config: { damping: 12 } });

  return (
    <AbsoluteFill style={{ background: "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
      <div style={{
        fontSize: 56, fontWeight: 800, color: "#fff", fontFamily: "system-ui",
        opacity: fadeIn, transform: `translateY(${interpolate(fadeIn, [0, 1], [15, 0])}px)`,
      }}>
        Agent360 Browser MCP
      </div>
      <div style={{
        fontSize: 22, color: "#8b949e", fontFamily: "system-ui",
        opacity: interpolate(frame, [8, 20], [0, 1], { extrapolateRight: "clamp" }),
      }}>
        Control your real Chrome from Claude Code
      </div>
      <div style={{
        fontSize: 15, color: "#3b82f6", fontFamily: "SF Mono, monospace", marginTop: 6,
        opacity: interpolate(frame, [18, 30], [0, 1], { extrapolateRight: "clamp" }),
      }}>
        21 tools · Your real logins · CSP bypass · Human-in-the-loop
      </div>
      <div style={{
        display: "flex", gap: 14, marginTop: 20,
        opacity: interpolate(frame, [28, 42], [0, 1], { extrapolateRight: "clamp" }),
      }}>
        {[
          { icon: "🔐", text: "Real cookies & sessions" },
          { icon: "🛡️", text: "Google, Stripe, Slack" },
          { icon: "🤝", text: "Agent asks, you answer" },
        ].map((item, i) => (
          <div key={i} style={{
            padding: "10px 18px", borderRadius: 10, border: "1px solid #1e293b",
            background: "#111827", display: "flex", alignItems: "center", gap: 10,
            color: "#e6edf3", fontSize: 14, fontFamily: "system-ui",
          }}>
            <span style={{ fontSize: 18 }}>{item.icon}</span>
            {item.text}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ── End Card ─────────────────────────────────────────────────────────────

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = spring({ frame: frame + 5, fps, config: { damping: 12 } });

  const oneLiner = "git clone https://github.com/Agent360dk/browser-mcp && cd browser-mcp && ./install.sh";
  const visibleChars = Math.min(Math.floor(Math.max(0, frame - 30) * 1.8), oneLiner.length);
  const typedCmd = frame >= 30 ? oneLiner.slice(0, visibleChars) : "";
  const cursorVisible = frame >= 30 && visibleChars < oneLiner.length;

  return (
    <AbsoluteFill style={{ background: "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
      <div style={{ fontSize: 26, color: "#8b949e", fontFamily: "system-ui", opacity: fadeIn, marginBottom: -8 }}>
        Stop copy-pasting between tabs.
      </div>
      <div style={{ fontSize: 38, fontWeight: 700, color: "#fff", fontFamily: "system-ui", opacity: fadeIn }}>
        Let your AI do it.
      </div>
      <div style={{
        background: "#0d1117", border: "1px solid #30363d", borderRadius: 12,
        padding: "18px 24px", maxWidth: 880, width: "85%",
        fontFamily: "SF Mono, Menlo, monospace", fontSize: 15,
        opacity: interpolate(frame, [12, 22], [0, 1], { extrapolateRight: "clamp" }),
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}>
        <span style={{ color: "#7ee787" }}>❯ </span>
        <span style={{ color: "#a5d6ff" }}>{typedCmd}</span>
        {cursorVisible && <span style={{ color: "#58a6ff", opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0 }}>▊</span>}
      </div>
      <div style={{
        display: "flex", gap: 28, marginTop: 6,
        opacity: interpolate(frame, [20, 35], [0, 1], { extrapolateRight: "clamp" }),
      }}>
        {["1. Clone repo", "2. Load in Chrome", "3. claude mcp add"].map((step, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, color: "#8b949e", fontSize: 13, fontFamily: "system-ui" }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", color: "#3b82f6", fontSize: 11, fontWeight: 700 }}>
              {i + 1}
            </div>
            {step.slice(3)}
          </div>
        ))}
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 14, marginTop: 14,
        opacity: interpolate(frame, [50, 65], [0, 1], { extrapolateRight: "clamp" }),
      }}>
        <div style={{ padding: "10px 22px", borderRadius: 8, background: "#238636", color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: "system-ui" }}>
          ⭐ Star on GitHub
        </div>
        <span style={{ color: "#8b949e", fontSize: 14, fontFamily: "system-ui" }}>
          github.com/Agent360dk/browser-mcp
        </span>
      </div>
      <div style={{ color: "#58a6ff", fontSize: 13, fontFamily: "system-ui", marginTop: 6, opacity: interpolate(frame, [60, 75], [0, 1], { extrapolateRight: "clamp" }) }}>
        MIT License · Free & Open Source
      </div>
    </AbsoluteFill>
  );
};

// ── Main Composition ─────────────────────────────────────────────────────

export const Demo: React.FC = () => {
  // S = base scene, H = hold/takeaway time added to each
  const S = 160;
  const H = 75;  // 2.5 sec hold for takeaway
  const HK = 100; // hook (2 beats, ~3.3 sec)
  const T = 90;   // title card (v7 original)
  const E = 140;  // end card

  let f = 0;
  const seq = (dur: number) => { const from = f; f += dur; return from; };

  const sH = seq(HK);          // hook
  const s0 = seq(T);           // title card
  const s1 = seq(S + 20 + H);  // navigate
  const s2 = seq(S + 20 + H);  // click+fill
  const s3 = seq(S + H);       // 2FA
  const s4 = seq(S + H);       // LinkedIn
  const s5 = seq(S - 20 + H);  // network
  const s6 = seq(S + H);       // multi-session
  const s7 = seq(E);           // end

  return (
    <AbsoluteFill>
      <Sequence from={sH} durationInFrames={HK}><Hook /></Sequence>
      <Sequence from={s0} durationInFrames={T}><TitleCard /></Sequence>
      <Sequence from={s1} durationInFrames={S + 20 + H}><Scene1Navigate /></Sequence>
      <Sequence from={s2} durationInFrames={S + 20 + H}><Scene2ClickFill /></Sequence>
      <Sequence from={s3} durationInFrames={S + H}><Scene3HumanInLoop /></Sequence>
      <Sequence from={s4} durationInFrames={S + H}><Scene4LinkedIn /></Sequence>
      <Sequence from={s5} durationInFrames={S - 20 + H}><Scene5Network /></Sequence>
      <Sequence from={s6} durationInFrames={S + H}><Scene6MultiSession /></Sequence>
      <Sequence from={s7} durationInFrames={E}><EndCard /></Sequence>
    </AbsoluteFill>
  );
};
