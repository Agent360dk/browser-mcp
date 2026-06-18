import "./index.css";
import { Composition } from "remotion";
import { Demo } from "./Demo";
import { Hero, HERO_DURATION } from "./Hero";

// 100 + 90 + 255 + 255 + 235 + 235 + 215 + 235 + 140 = 1760 (~59 sec)
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Hero"
        component={Hero}
        durationInFrames={HERO_DURATION}
        fps={30}
        width={1920}
        height={1080}
      />
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
