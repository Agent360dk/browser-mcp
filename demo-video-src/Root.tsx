import "./index.css";
import { Composition } from "remotion";
import { Demo } from "./Demo";

// Short version for README GIF
const DemoShort: React.FC = () => {
  // Import scenes directly — just the 3 best
  return null; // placeholder, built separately
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Demo"
        component={Demo}
        durationInFrames={1190}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
