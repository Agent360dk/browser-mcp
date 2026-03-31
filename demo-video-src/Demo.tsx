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

// Layout: terminal left, browser right
const SplitLayout: React.FC<{
  terminal: React.ReactNode;
  browser: React.ReactNode;
}> = ({ terminal, browser }) => (
  <AbsoluteFill
    style={{
      background: "#0a0a0a",
      padding: 32,
      display: "flex",
      flexDirection: "row",
      gap: 20,
    }}
  >
    <div style={{ flex: 1, display: "flex" }}>{terminal}</div>
    <div style={{ flex: 1.2, display: "flex" }}>{browser}</div>
  </AbsoluteFill>
);

// ── Scene 1: Navigate to Stripe (0-210 frames = 7 sec) ──────────────────

const Scene1Navigate: React.FC = () => {
  const frame = useCurrentFrame();

  const showLoading = frame >= 40 && frame < 90;
  const showDashboard = frame >= 90;

  return (
    <SplitLayout
      terminal={
        <Terminal
          lines={[
            { text: 'browser_navigate("https://dashboard.stripe.com/apikeys")', type: "command", delay: 5 },
            { text: '→ Navigating to Stripe...', type: "info", delay: 40 },
            { text: '✓ Title: "API keys — Stripe Dashboard"', type: "success", delay: 90 },
            { text: '  URL: dashboard.stripe.com/apikeys', type: "output", delay: 95 },
            { text: '  Session: Claude 1 (blue)', type: "info", delay: 100 },
            { text: "", type: "output", delay: 110 },
            { text: 'browser_get_page_content()', type: "command", delay: 120 },
            { text: '✓ Found: sk_live_••••4242', type: "success", delay: 155 },
          ]}
        />
      }
      browser={
        <Browser url="dashboard.stripe.com/apikeys">
          {showLoading && <StripeDashboard loading />}
          {showDashboard && <StripeDashboard />}
          {!showLoading && !showDashboard && (
            <div
              style={{
                width: "100%",
                height: "100%",
                background: "#f6f8fa",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#999",
                fontSize: 14,
                fontFamily: "system-ui, sans-serif",
              }}
            >
              New Tab
            </div>
          )}
        </Browser>
      }
    />
  );
};

// ── Scene 2: Click + Fill on Google Cloud (210-450 = 8 sec) ──────────────

const Scene2ClickFill: React.FC = () => {
  const frame = useCurrentFrame();

  const field1Filled = frame >= 70;
  const field2Filled = frame >= 120;
  const field3Filled = frame >= 160;
  const highlightIdx = frame < 70 ? 0 : frame < 120 ? 1 : frame < 160 ? 2 : -1;

  const fields = [
    {
      label: "App name *",
      value: field1Filled ? "Agent360" : "",
      filled: field1Filled,
    },
    {
      label: "User support email *",
      value: field2Filled ? "gustav@agent360.dk" : "",
      filled: field2Filled,
    },
    {
      label: "Audience",
      value: field3Filled ? "External" : "",
      filled: field3Filled,
    },
  ];

  return (
    <SplitLayout
      terminal={
        <Terminal
          lines={[
            { text: 'click("text=Get started")', type: "command", delay: 5 },
            { text: "✓ Clicked: A tag, method: debugger", type: "success", delay: 30 },
            { text: "", type: "output", delay: 35 },
            { text: 'fill("input[name=app_name]", "Agent360")', type: "command", delay: 40 },
            { text: "✓ Filled, method: debugger", type: "success", delay: 70 },
            { text: "", type: "output", delay: 75 },
            { text: 'fill("input[type=email]", "gustav@agent360.dk")', type: "command", delay: 85 },
            { text: "✓ Filled, method: debugger", type: "success", delay: 120 },
            { text: "", type: "output", delay: 125 },
            { text: 'select_option("select[name=audience]", "External")', type: "command", delay: 130 },
            { text: "✓ Selected: External", type: "success", delay: 160 },
            { text: "", type: "output", delay: 165 },
            { text: 'click("text=Create")', type: "command", delay: 175 },
            { text: "✓ OAuth consent created!", type: "success", delay: 200 },
          ]}
        />
      }
      browser={
        <Browser url="console.cloud.google.com/auth/branding">
          <GoogleOAuthForm fields={fields} highlightIndex={highlightIdx} />
        </Browser>
      }
    />
  );
};

// ── Scene 3: Human-in-the-loop 2FA (450-660 = 7 sec) ────────────────────

const Scene3HumanInLoop: React.FC = () => {
  const frame = useCurrentFrame();

  const showOverlay = frame >= 60;
  const showCode = frame >= 120;
  const showSuccess = frame >= 150;

  return (
    <SplitLayout
      terminal={
        <Terminal
          lines={[
            { text: 'browser_navigate("https://app.hubspot.com")', type: "command", delay: 5 },
            { text: "→ HubSpot requires 2FA...", type: "info", delay: 35 },
            { text: "", type: "output", delay: 40 },
            { text: 'ask_user("Please enter the 2FA code from your authenticator")', type: "command", delay: 45 },
            { text: "⏳ Waiting for user response...", type: "info", delay: 60 },
            ...(showCode
              ? [
                  { text: '✓ User entered: 847291', type: "success" as const, delay: 120 },
                  { text: "", type: "output" as const, delay: 125 },
                  { text: 'fill("#otp-input", "847291")', type: "command" as const, delay: 130 },
                  { text: 'press_key("Enter")', type: "command" as const, delay: 145 },
                ]
              : []),
            ...(showSuccess
              ? [
                  { text: "✓ 2FA verified — logged in!", type: "success" as const, delay: 155 },
                ]
              : []),
          ]}
        />
      }
      browser={
        <Browser url="app.hubspot.com/login/2fa">
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "#f5f8fa",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <div
              style={{
                background: "#fff",
                borderRadius: 8,
                padding: 32,
                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                textAlign: "center",
                width: 300,
              }}
            >
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: "#ff7a59",
                  marginBottom: 16,
                }}
              >
                HubSpot
              </div>
              <div style={{ fontSize: 14, color: "#33475b", marginBottom: 16 }}>
                Enter your 2FA code
              </div>
              <div
                style={{
                  border: "2px solid #cbd6e2",
                  borderRadius: 4,
                  padding: "12px",
                  fontSize: 24,
                  letterSpacing: 8,
                  color: "#33475b",
                  fontFamily: "SF Mono, monospace",
                  textAlign: "center",
                }}
              >
                {showCode ? "847291" : "______"}
              </div>
            </div>
          </div>

          <AskUserOverlay
            message="Please enter the 2FA code from your authenticator app"
            title="HubSpot — 2FA Required"
            fieldLabel="2FA Code"
            fieldValue={showCode ? "847291" : ""}
            visible={showOverlay && !showSuccess}
            sessionLabel="Claude 1"
          />
        </Browser>
      }
    />
  );
};

// ── Scene 4: Multi-session (660-870 = 7 sec) ────────────────────────────

const Scene4MultiSession: React.FC = () => {
  const frame = useCurrentFrame();

  const tabGroups = [
    { label: "Claude 1", color: "#3b82f6", active: frame < 90 },
    { label: "Claude 2", color: "#22c55e", active: frame >= 90 && frame < 150 },
    { label: "Claude 3", color: "#f59e0b", active: frame >= 150 },
  ];

  const activeSession =
    frame < 90 ? "stripe" : frame < 150 ? "hubspot" : "slack";

  return (
    <SplitLayout
      terminal={
        <Terminal
          title="3 Claude sessions running"
          lines={[
            { text: "Session overview:", type: "info", delay: 5 },
            { text: "  Claude 1 (blue)  → Extracting Stripe API key", type: "output", delay: 15 },
            { text: "  Claude 2 (green) → Setting up HubSpot integration", type: "output", delay: 25 },
            { text: "  Claude 3 (amber) → Posting to Slack #sales-alerts", type: "output", delay: 35 },
            { text: "", type: "output", delay: 45 },
            { text: "All sessions isolated — separate tabs, separate state.", type: "info", delay: 55 },
            { text: "", type: "output", delay: 65 },
            { text: "✓ Stripe: sk_live_••••4242 saved to vault", type: "success", delay: 80 },
            { text: "✓ HubSpot: pat-na1-•••• connected", type: "success", delay: 110 },
            { text: "✓ Slack: Message posted to #sales-alerts", type: "success", delay: 160 },
          ]}
        />
      }
      browser={
        <Browser
          url={
            activeSession === "stripe"
              ? "dashboard.stripe.com/apikeys"
              : activeSession === "hubspot"
              ? "app.hubspot.com/settings"
              : "app.slack.com/client/T0123/C0456"
          }
          tabGroups={tabGroups}
        >
          {activeSession === "stripe" && <StripeDashboard />}
          {activeSession === "hubspot" && <HubSpotDashboard />}
          {activeSession === "slack" && <SlackPage />}
        </Browser>
      }
    />
  );
};

// ── Title card ───────────────────────────────────────────────────────────

const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = spring({ frame, fps, config: { damping: 15 } });

  return (
    <AbsoluteFill
      style={{
        background: "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
      }}
    >
      <div
        style={{
          fontSize: 48,
          fontWeight: 800,
          color: "#fff",
          fontFamily: "system-ui, -apple-system, sans-serif",
          opacity: fadeIn,
          transform: `translateY(${interpolate(fadeIn, [0, 1], [20, 0])}px)`,
        }}
      >
        Agent360 Browser MCP
      </div>
      <div
        style={{
          fontSize: 20,
          color: "#8b949e",
          fontFamily: "system-ui, sans-serif",
          opacity: interpolate(frame, [15, 30], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Control your real Chrome from Claude Code — 21 tools
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 16,
          opacity: interpolate(frame, [30, 50], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        {[
          "CSP Bypass",
          "Text Selectors",
          "Human-in-the-Loop",
          "Multi-Session",
        ].map((tag, i) => (
          <div
            key={i}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              border: "1px solid #30363d",
              color: "#58a6ff",
              fontSize: 13,
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {tag}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ── End card ─────────────────────────────────────────────────────────────

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = spring({ frame, fps, config: { damping: 15 } });

  return (
    <AbsoluteFill
      style={{
        background: "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
      }}
    >
      <div
        style={{
          fontSize: 36,
          fontWeight: 700,
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
          opacity: fadeIn,
        }}
      >
        github.com/Agent360dk/browser-mcp
      </div>
      <div
        style={{
          fontSize: 16,
          color: "#8b949e",
          fontFamily: "SF Mono, monospace",
          opacity: interpolate(frame, [15, 30], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        npx agent360-browser-mcp
      </div>
      <div
        style={{
          fontSize: 14,
          color: "#58a6ff",
          fontFamily: "system-ui, sans-serif",
          marginTop: 8,
          opacity: interpolate(frame, [25, 40], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        MIT License — Free & Open Source
      </div>
    </AbsoluteFill>
  );
};

// ── Main Composition ─────────────────────────────────────────────────────

export const Demo: React.FC = () => {
  return (
    <AbsoluteFill>
      {/* Title: 0-90 (3 sec) */}
      <Sequence from={0} durationInFrames={90}>
        <TitleCard />
      </Sequence>

      {/* Scene 1: Navigate to Stripe: 90-300 (7 sec) */}
      <Sequence from={90} durationInFrames={210}>
        <Scene1Navigate />
      </Sequence>

      {/* Scene 2: Click + Fill: 300-540 (8 sec) */}
      <Sequence from={300} durationInFrames={240}>
        <Scene2ClickFill />
      </Sequence>

      {/* Scene 3: Human-in-the-loop: 540-750 (7 sec) */}
      <Sequence from={540} durationInFrames={210}>
        <Scene3HumanInLoop />
      </Sequence>

      {/* Scene 4: Multi-session: 750-960 (7 sec) */}
      <Sequence from={750} durationInFrames={210}>
        <Scene4MultiSession />
      </Sequence>

      {/* End card: 960-1050 (3 sec) */}
      <Sequence from={960} durationInFrames={90}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
