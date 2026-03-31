import "./index.css";
import { Composition } from "remotion";
import { Demo } from "./Demo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Demo"
        component={Demo}
        durationInFrames={1050}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
