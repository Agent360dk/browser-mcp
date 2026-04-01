import "./index.css";
import { Composition } from "remotion";
import { Demo } from "./Demo";

// 100 + 90 + 255 + 255 + 235 + 235 + 215 + 235 + 140 = 1760 (~59 sec)
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Demo"
        component={Demo}
        durationInFrames={1760}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
