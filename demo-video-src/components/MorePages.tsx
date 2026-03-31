import React from "react";
import { useCurrentFrame, spring, useVideoConfig, interpolate } from "remotion";

// Cookie banner that gets auto-dismissed
export const CookieBannerPage: React.FC<{ bannerVisible: boolean }> = ({
  bannerVisible,
}) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      background: "#fff",
      fontFamily: "system-ui, sans-serif",
      position: "relative",
    }}
  >
    <div
      style={{
        background: "#f0f0f0",
        padding: "16px 24px",
        borderBottom: "1px solid #ddd",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 700, color: "#333" }}>
        🏢 Enterprise SaaS Dashboard
      </div>
    </div>
    <div style={{ padding: 24, color: "#666", fontSize: 14 }}>
      <div>Welcome back. Your dashboard is loading...</div>
    </div>

    {bannerVisible && (
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: "#1e293b",
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: "2px solid #3b82f6",
        }}
      >
        <div style={{ color: "#e2e8f0", fontSize: 13 }}>
          🍪 Vi bruger cookies. Acceptér for at fortsætte.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div
            style={{
              padding: "8px 20px",
              background: "#3b82f6",
              color: "#fff",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Acceptér alle
          </div>
          <div
            style={{
              padding: "8px 20px",
              background: "#334155",
              color: "#94a3b8",
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            Indstillinger
          </div>
        </div>
      </div>
    )}
  </div>
);

// Railway deploy dashboard
export const RailwayDashboard: React.FC<{ status: string }> = ({ status }) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      background: "#13111C",
      fontFamily: "system-ui, sans-serif",
      color: "#fff",
    }}
  >
    <div
      style={{
        padding: "12px 20px",
        borderBottom: "1px solid #2a2733",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span style={{ fontSize: 16, fontWeight: 600 }}>🚂 Railway</span>
      <span style={{ color: "#8b8798", fontSize: 13 }}>
        agent360dk / Sales
      </span>
    </div>
    <div style={{ padding: 20 }}>
      <div
        style={{
          background: "#1C1A27",
          borderRadius: 8,
          border: "1px solid #2a2733",
          padding: 16,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            marginBottom: 12,
          }}
        >
          Agent360 Backend
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background:
                status === "deploying"
                  ? "#f59e0b"
                  : status === "success"
                  ? "#22c55e"
                  : "#8b8798",
            }}
          />
          <span
            style={{
              color:
                status === "deploying"
                  ? "#f59e0b"
                  : status === "success"
                  ? "#22c55e"
                  : "#8b8798",
            }}
          >
            {status === "deploying"
              ? "Deploying..."
              : status === "success"
              ? "Deploy successful ✓"
              : "Ready"}
          </span>
        </div>
      </div>
    </div>
  </div>
);

// LinkedIn profile page
export const LinkedInPage: React.FC<{ messageTyped: string }> = ({
  messageTyped,
}) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      background: "#f3f2ef",
      fontFamily: "system-ui, sans-serif",
    }}
  >
    <div
      style={{
        background: "#fff",
        padding: "8px 20px",
        borderBottom: "1px solid #e0dfdc",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span style={{ color: "#0a66c2", fontSize: 22, fontWeight: 700 }}>
        in
      </span>
      <div
        style={{
          background: "#eef3f8",
          borderRadius: 4,
          padding: "6px 12px",
          flex: 1,
          fontSize: 13,
          color: "#666",
        }}
      >
        Search
      </div>
    </div>
    <div style={{ padding: "20px 32px", display: "flex", gap: 20 }}>
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          border: "1px solid #e0dfdc",
          padding: 20,
          flex: 1,
        }}
      >
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "#0a66c2",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 700,
              fontSize: 18,
            }}
          >
            LH
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: "#191919" }}>
              Lars Hansen
            </div>
            <div style={{ fontSize: 12, color: "#666" }}>
              VP Sales @ Novo Nordisk
            </div>
          </div>
        </div>

        {/* Message box */}
        <div
          style={{
            border: "1px solid #0a66c2",
            borderRadius: 8,
            padding: 12,
            fontSize: 13,
            color: "#191919",
            minHeight: 60,
            background: "#f8faff",
          }}
        >
          {messageTyped || (
            <span style={{ color: "#999" }}>Write a message...</span>
          )}
        </div>
      </div>
    </div>
  </div>
);

// Network monitoring view
export const NetworkMonitor: React.FC<{
  requests: { url: string; status: number; time: string }[];
}> = ({ requests }) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      background: "#0d1117",
      fontFamily: "SF Mono, Menlo, monospace",
      fontSize: 12,
      color: "#e6edf3",
      padding: 16,
    }}
  >
    <div
      style={{
        borderBottom: "1px solid #30363d",
        paddingBottom: 8,
        marginBottom: 8,
        display: "flex",
        gap: 40,
        color: "#8b949e",
        fontSize: 11,
      }}
    >
      <span style={{ width: 250 }}>URL</span>
      <span style={{ width: 60 }}>Status</span>
      <span>Time</span>
    </div>
    {requests.map((req, i) => (
      <div
        key={i}
        style={{
          display: "flex",
          gap: 40,
          padding: "4px 0",
          borderBottom: "1px solid #21262d",
        }}
      >
        <span style={{ width: 250, color: "#58a6ff" }}>
          {req.url.slice(0, 35)}
        </span>
        <span
          style={{
            width: 60,
            color: req.status < 400 ? "#3fb950" : "#f85149",
          }}
        >
          {req.status}
        </span>
        <span style={{ color: "#8b949e" }}>{req.time}</span>
      </div>
    ))}
  </div>
);
