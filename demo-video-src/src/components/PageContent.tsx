import React from "react";
import { useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

// Stripe-like dashboard mockup
export const StripeDashboard: React.FC<{ loading?: boolean }> = ({
  loading = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = spring({ frame, fps, config: { damping: 20 } });

  if (loading) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#f6f8fa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            border: "3px solid #e5e7eb",
            borderTopColor: "#635bff",
            borderRadius: "50%",
            transform: `rotate(${frame * 12}deg)`,
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#f6f8fa",
        display: "flex",
        opacity: fadeIn,
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: 200,
          background: "#0a2540",
          padding: "20px 16px",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            marginBottom: 24,
            color: "#fff",
          }}
        >
          stripe
        </div>
        {["Payments", "Balances", "Customers", "Products", "Developers"].map(
          (item, i) => (
            <div
              key={i}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: 13,
                color: i === 3 ? "#fff" : "#8898aa",
                background: i === 3 ? "rgba(255,255,255,0.1)" : "transparent",
                marginBottom: 2,
              }}
            >
              {item}
            </div>
          )
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, padding: 24 }}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: "#0a2540",
            marginBottom: 16,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          API Keys
        </div>
        <div
          style={{
            background: "#fff",
            borderRadius: 8,
            border: "1px solid #e3e8ee",
            padding: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingBottom: 12,
              borderBottom: "1px solid #e3e8ee",
              fontSize: 13,
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <span style={{ color: "#0a2540", fontWeight: 500 }}>
              Secret key
            </span>
            <span
              style={{
                color: "#635bff",
                fontFamily: "SF Mono, monospace",
                fontSize: 12,
              }}
            >
              sk_live_••••••••4242
            </span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingTop: 12,
              fontSize: 13,
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <span style={{ color: "#0a2540", fontWeight: 500 }}>
              Publishable key
            </span>
            <span
              style={{
                color: "#0a2540",
                fontFamily: "SF Mono, monospace",
                fontSize: 12,
              }}
            >
              pk_live_••••••••8888
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Google Cloud OAuth form
interface FormField {
  label: string;
  value: string;
  filled: boolean;
}

export const GoogleOAuthForm: React.FC<{
  fields: FormField[];
  highlightIndex?: number;
}> = ({ fields, highlightIndex = -1 }) => {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#fff",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Google header */}
      <div
        style={{
          background: "#1a73e8",
          padding: "16px 24px",
          color: "#fff",
          fontSize: 16,
          fontWeight: 500,
        }}
      >
        ☁ Google Cloud Console — OAuth Consent Screen
      </div>

      <div style={{ padding: "24px 32px" }}>
        <div
          style={{
            fontSize: 18,
            fontWeight: 500,
            color: "#202124",
            marginBottom: 24,
          }}
        >
          Configure OAuth consent
        </div>

        {fields.map((field, i) => (
          <div key={i} style={{ marginBottom: 20 }}>
            <div
              style={{
                fontSize: 12,
                color: "#5f6368",
                marginBottom: 6,
                fontWeight: 500,
              }}
            >
              {field.label}
            </div>
            <div
              style={{
                border: `2px solid ${
                  i === highlightIndex ? "#1a73e8" : field.filled ? "#34a853" : "#dadce0"
                }`,
                borderRadius: 4,
                padding: "10px 12px",
                fontSize: 14,
                color: field.filled ? "#202124" : "#9aa0a6",
                background: field.filled ? "#f8fff8" : "#fff",
                transition: "all 0.2s",
              }}
            >
              {field.value || field.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// HubSpot-like page (for multi-session scene)
export const HubSpotDashboard: React.FC = () => (
  <div
    style={{
      width: "100%",
      height: "100%",
      background: "#f5f8fa",
      fontFamily: "system-ui, sans-serif",
    }}
  >
    <div
      style={{
        background: "#ff7a59",
        padding: "12px 24px",
        color: "#fff",
        fontSize: 15,
        fontWeight: 600,
      }}
    >
      HubSpot — Settings → Integrations → Private Apps
    </div>
    <div style={{ padding: 24 }}>
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          border: "1px solid #ddd",
          padding: 16,
          fontSize: 13,
          color: "#33475b",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Agent360 Integration
        </div>
        <div>Access Token: pat-••••••••-••••</div>
        <div style={{ marginTop: 8, color: "#00a4bd" }}>Active ✓</div>
      </div>
    </div>
  </div>
);

// Slack-like page (for multi-session scene)
export const SlackPage: React.FC = () => (
  <div
    style={{
      width: "100%",
      height: "100%",
      background: "#1a1d21",
      fontFamily: "system-ui, sans-serif",
      display: "flex",
    }}
  >
    <div
      style={{
        width: 180,
        background: "#19171d",
        padding: "16px 12px",
        borderRight: "1px solid #2e2e2e",
      }}
    >
      <div
        style={{
          color: "#fff",
          fontSize: 15,
          fontWeight: 700,
          marginBottom: 16,
        }}
      >
        Agent360
      </div>
      {["#general", "#sales-alerts", "#meetings"].map((ch, i) => (
        <div
          key={i}
          style={{
            color: i === 1 ? "#fff" : "#9b9d9f",
            fontSize: 13,
            padding: "4px 8px",
            background: i === 1 ? "rgba(255,255,255,0.1)" : "transparent",
            borderRadius: 4,
            marginBottom: 2,
          }}
        >
          {ch}
        </div>
      ))}
    </div>
    <div style={{ flex: 1, padding: "16px 20px" }}>
      <div
        style={{
          color: "#fff",
          fontSize: 15,
          fontWeight: 600,
          borderBottom: "1px solid #2e2e2e",
          paddingBottom: 12,
          marginBottom: 12,
        }}
      >
        #sales-alerts
      </div>
      <div style={{ color: "#d1d2d3", fontSize: 13, lineHeight: 1.6 }}>
        <div>
          <strong style={{ color: "#fff" }}>JesperAI Bot</strong>{" "}
          <span style={{ color: "#616061", fontSize: 11 }}>2:14 PM</span>
        </div>
        <div>🎉 Møde booket: Lars Hansen, Novo Nordisk — torsdag kl 10</div>
      </div>
    </div>
  </div>
);
