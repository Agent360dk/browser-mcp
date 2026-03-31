import React from "react";
import { useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

interface TerminalLine {
  text: string;
  type: "command" | "output" | "success" | "info" | "error";
  delay: number; // frame to start appearing
}

interface TerminalProps {
  lines: TerminalLine[];
  title?: string;
  typingSpeed?: number; // chars per frame
}

const COLORS = {
  command: "#a5d6ff",
  output: "#e6edf3",
  success: "#3fb950",
  info: "#8b949e",
  error: "#f85149",
  prompt: "#7ee787",
  bg: "#0d1117",
  titleBar: "#161b22",
  border: "#30363d",
};

export const Terminal: React.FC<TerminalProps> = ({
  lines,
  title = "claude — Claude Code",
  typingSpeed = 1.2,
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
      {/* Title bar */}
      <div
        style={{
          background: COLORS.titleBar,
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
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
        <span
          style={{
            color: "#8b949e",
            fontSize: 13,
            fontFamily: "SF Mono, Menlo, monospace",
            marginLeft: 8,
          }}
        >
          {title}
        </span>
      </div>

      {/* Terminal body */}
      <div
        style={{
          background: COLORS.bg,
          flex: 1,
          padding: "16px 20px",
          fontFamily: "SF Mono, Menlo, Consolas, monospace",
          fontSize: 14,
          lineHeight: 1.7,
          overflow: "hidden",
        }}
      >
        {lines.map((line, i) => {
          if (frame < line.delay) return null;

          const framesIntoLine = frame - line.delay;
          const isCommand = line.type === "command";

          // Commands type out, other lines appear instantly
          const visibleChars = isCommand
            ? Math.floor(framesIntoLine * typingSpeed)
            : line.text.length;

          const displayText = line.text.slice(0, visibleChars);
          const isTyping = isCommand && visibleChars < line.text.length;

          return (
            <div key={i} style={{ display: "flex", minHeight: 24 }}>
              {isCommand && (
                <span style={{ color: COLORS.prompt, marginRight: 8 }}>
                  {"❯ "}
                </span>
              )}
              <span style={{ color: COLORS[line.type] }}>
                {displayText}
                {isTyping && (
                  <span
                    style={{
                      opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0,
                      color: "#58a6ff",
                      fontWeight: "bold",
                    }}
                  >
                    ▊
                  </span>
                )}
              </span>
            </div>
          );
        })}

        {/* Blinking cursor at bottom when idle */}
        {(() => {
          const lastLine = lines[lines.length - 1];
          if (!lastLine) return null;
          const lastLineEnd =
            lastLine.delay +
            (lastLine.type === "command"
              ? Math.ceil(lastLine.text.length / typingSpeed)
              : 0);
          if (frame > lastLineEnd + 5) {
            return (
              <div style={{ display: "flex", minHeight: 24 }}>
                <span style={{ color: COLORS.prompt, marginRight: 8 }}>
                  {"❯ "}
                </span>
                <span
                  style={{
                    opacity: Math.sin(frame * 0.2) > 0 ? 1 : 0,
                    color: "#58a6ff",
                  }}
                >
                  ▊
                </span>
              </div>
            );
          }
          return null;
        })()}
      </div>
    </div>
  );
};
