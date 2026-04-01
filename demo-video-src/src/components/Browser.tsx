import React from "react";
import { useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

interface BrowserProps {
  url: string;
  children: React.ReactNode;
  tabGroups?: { label: string; color: string; active?: boolean }[];
}

const COLORS = {
  bg: "#1e1e1e",
  titleBar: "#2d2d2d",
  tabBar: "#252526",
  activeTab: "#1e1e1e",
  border: "#3e3e3e",
  urlBar: "#3c3c3c",
  urlText: "#cccccc",
};

export const Browser: React.FC<BrowserProps> = ({
  url,
  children,
  tabGroups,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${COLORS.border}`,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}
    >
      {/* Tab bar with groups */}
      <div
        style={{
          background: COLORS.tabBar,
          display: "flex",
          alignItems: "center",
          padding: "6px 12px 0",
          gap: 2,
        }}
      >
        <div style={{ display: "flex", gap: 6, marginRight: 12 }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#ff5f57",
            }}
          />
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#febc2e",
            }}
          />
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#28c840",
            }}
          />
        </div>

        {tabGroups ? (
          tabGroups.map((group, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 14px",
                borderRadius: "8px 8px 0 0",
                background: group.active ? COLORS.activeTab : "transparent",
                borderTop: `2px solid ${group.color}`,
                fontSize: 12,
                color: group.active ? "#fff" : "#888",
                fontFamily: "system-ui, -apple-system, sans-serif",
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: group.color,
                }}
              />
              {group.label}
            </div>
          ))
        ) : (
          <div
            style={{
              padding: "6px 14px",
              borderRadius: "8px 8px 0 0",
              background: COLORS.activeTab,
              fontSize: 12,
              color: "#fff",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            {url.replace(/https?:\/\//, "").split("/")[0]}
          </div>
        )}
      </div>

      {/* URL bar */}
      <div
        style={{
          background: COLORS.titleBar,
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        {/* Nav buttons */}
        <div style={{ display: "flex", gap: 8, color: "#666", fontSize: 14 }}>
          <span>←</span>
          <span>→</span>
          <span>↻</span>
        </div>
        <div
          style={{
            flex: 1,
            background: COLORS.urlBar,
            borderRadius: 6,
            padding: "6px 12px",
            fontSize: 13,
            color: COLORS.urlText,
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          🔒 {url}
        </div>
      </div>

      {/* Page content */}
      <div
        style={{
          flex: 1,
          background: "#fff",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {children}
      </div>
    </div>
  );
};

// Overlay for ask_user dialog
interface AskUserOverlayProps {
  message: string;
  title?: string;
  fieldLabel?: string;
  fieldValue?: string;
  visible: boolean;
  sessionLabel?: string;
}

export const AskUserOverlay: React.FC<AskUserOverlayProps> = ({
  message,
  title = "Agent360 — Action Required",
  fieldLabel,
  fieldValue = "",
  visible,
  sessionLabel = "Claude 1",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!visible) return null;

  const slideUp = spring({ frame, fps, config: { damping: 15 } });

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: `rgba(0,0,0,${interpolate(slideUp, [0, 1], [0, 0.6])})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: "#1e293b",
          borderRadius: 12,
          padding: 24,
          maxWidth: 380,
          width: "85%",
          color: "#e2e8f0",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          transform: `translateY(${interpolate(slideUp, [0, 1], [30, 0])}px)`,
          opacity: slideUp,
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#3b82f6",
            marginBottom: 4,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 12 }}>
          {sessionLabel}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "#cbd5e1",
            marginBottom: 16,
            lineHeight: 1.5,
          }}
        >
          {message}
        </div>

        {fieldLabel && (
          <>
            <div
              style={{
                fontSize: 11,
                color: "#94a3b8",
                marginBottom: 4,
              }}
            >
              {fieldLabel}
            </div>
            <div
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 6,
                padding: "8px 10px",
                fontSize: 13,
                color: "#e2e8f0",
                marginBottom: 16,
              }}
            >
              {fieldValue || " "}
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <div
            style={{
              flex: 1,
              padding: 10,
              background: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              textAlign: "center",
              fontWeight: 500,
            }}
          >
            ✓ Done
          </div>
          <div
            style={{
              flex: 1,
              padding: 10,
              background: "#334155",
              color: "#94a3b8",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              textAlign: "center",
            }}
          >
            ✗ Skip
          </div>
        </div>
      </div>
    </div>
  );
};
