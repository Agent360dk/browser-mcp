import React from "react";
import { useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

// Glowing highlight box around an element
export const GlowHighlight: React.FC<{
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  color?: string;
}> = ({ x, y, width, height, visible, color = "#3b82f6" }) => {
  const frame = useCurrentFrame();

  if (!visible) return null;

  const pulse = 0.6 + Math.sin(frame * 0.15) * 0.4;

  return (
    <div
      style={{
        position: "absolute",
        left: x - 3,
        top: y - 3,
        width: width + 6,
        height: height + 6,
        borderRadius: 6,
        border: `2px solid ${color}`,
        boxShadow: `0 0 ${12 * pulse}px ${color}80, inset 0 0 ${8 * pulse}px ${color}20`,
        pointerEvents: "none",
        zIndex: 50,
      }}
    />
  );
};

// Animated cursor that moves between positions with smooth easing
export const AnimatedCursor: React.FC<{
  positions: { x: number; y: number; frame: number }[];
}> = ({ positions }) => {
  const frame = useCurrentFrame();

  if (!positions.length || frame < positions[0].frame) return null;

  let x = positions[0].x;
  let y = positions[0].y;

  for (let i = 0; i < positions.length - 1; i++) {
    const curr = positions[i];
    const next = positions[i + 1];
    if (frame >= curr.frame && frame <= next.frame) {
      const t = (frame - curr.frame) / (next.frame - curr.frame);
      const ease = 1 - Math.pow(1 - t, 3); // ease out cubic
      x = curr.x + (next.x - curr.x) * ease;
      y = curr.y + (next.y - curr.y) * ease;
      break;
    }
    if (frame > next.frame) {
      x = next.x;
      y = next.y;
    }
  }

  // Last position
  const last = positions[positions.length - 1];
  if (frame > last.frame) {
    x = last.x;
    y = last.y;
  }

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 0,
        height: 0,
        zIndex: 99,
        pointerEvents: "none",
      }}
    >
      <svg
        width="18"
        height="22"
        viewBox="0 0 18 22"
        style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.6))" }}
      >
        <path
          d="M1 1L16 11L9 13L6 20L1 1Z"
          fill="white"
          stroke="black"
          strokeWidth="1.2"
        />
      </svg>
    </div>
  );
};

// Click ripple effect
export const ClickRipple: React.FC<{
  x: number;
  y: number;
  triggerFrame: number;
}> = ({ x, y, triggerFrame }) => {
  const frame = useCurrentFrame();
  const elapsed = frame - triggerFrame;

  if (elapsed < 0 || elapsed > 20) return null;

  const scale = interpolate(elapsed, [0, 20], [0, 2.5]);
  const opacity = interpolate(elapsed, [0, 20], [0.7, 0]);

  return (
    <div
      style={{
        position: "absolute",
        left: x - 15,
        top: y - 15,
        width: 30,
        height: 30,
        borderRadius: "50%",
        border: "2px solid #3b82f6",
        transform: `scale(${scale})`,
        opacity,
        pointerEvents: "none",
        zIndex: 98,
      }}
    />
  );
};

// Crossfade scene label — overlays on top of content, fades quickly
export const SceneLabel: React.FC<{
  text: string;
  subtext?: string;
  number: number;
}> = ({ text, subtext, number }) => {
  const frame = useCurrentFrame();

  // Fast: appear in 3 frames, hold for 20, fade in 10
  const fadeIn = interpolate(frame, [0, 3], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [22, 32], [1, 0], { extrapolateRight: "clamp" });
  const opacity = Math.min(fadeIn, fadeOut);

  if (frame > 32) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: `rgba(10, 10, 10, ${opacity * 0.92})`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        zIndex: 200,
      }}
    >
      <div
        style={{
          fontSize: 13,
          color: "#3b82f6",
          fontFamily: "SF Mono, monospace",
          fontWeight: 600,
          opacity,
          letterSpacing: 2,
        }}
      >
        {String(number).padStart(2, "0")}
      </div>
      <div
        style={{
          fontSize: 36,
          fontWeight: 700,
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
          opacity,
          transform: `translateY(${interpolate(opacity, [0, 1], [8, 0])}px)`,
        }}
      >
        {text}
      </div>
      {subtext && (
        <div
          style={{
            fontSize: 15,
            color: "#8b949e",
            fontFamily: "system-ui, sans-serif",
            opacity: opacity * 0.8,
          }}
        >
          {subtext}
        </div>
      )}
    </div>
  );
};

// Takeaway overlay — appears at bottom of scene to reinforce the key point
export const Takeaway: React.FC<{
  text: string;
  startFrame: number;
}> = ({ text, startFrame }) => {
  const frame = useCurrentFrame();
  const elapsed = frame - startFrame;

  if (elapsed < 0) return null;

  const fadeIn = Math.min(elapsed / 8, 1);
  const slideUp = Math.max(0, 6 - elapsed * 0.8);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 150,
        opacity: fadeIn,
        background: `rgba(10, 10, 10, ${fadeIn * 0.75})`,
      }}
    >
      <div
        style={{
          background: "rgba(15, 23, 42, 0.95)",
          border: "1px solid #1e3a5f",
          borderRadius: 12,
          padding: "16px 40px",
          fontSize: 20,
          color: "#93c5fd",
          fontFamily: "system-ui, sans-serif",
          fontWeight: 500,
          transform: `translateY(${slideUp}px)`,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          textAlign: "center",
          maxWidth: 700,
        }}
      >
        {text}
      </div>
    </div>
  );
};

// Connection line — visual link between terminal command and browser action
export const ConnectionPulse: React.FC<{
  visible: boolean;
}> = ({ visible }) => {
  const frame = useCurrentFrame();

  if (!visible) return null;

  const pulse = 0.5 + Math.sin(frame * 0.2) * 0.5;

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: 40,
        height: 2,
        background: `rgba(59, 130, 246, ${pulse * 0.6})`,
        borderRadius: 1,
        boxShadow: `0 0 8px rgba(59, 130, 246, ${pulse * 0.4})`,
        zIndex: 10,
      }}
    />
  );
};
