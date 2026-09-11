import "./index.css";
import { Composition } from "remotion";
import { Demo } from "./Demo";
import { Hero, HERO_DURATION } from "./Hero";
import { StoreShots, STORE_COUNT, PromoTile, MarqueeTile } from "./Store";
import { OgImage, GithubSocial } from "./Social";

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
      {/* Chrome Web Store-billeder: ét pr. frame, 1280x800 (butikkens format). */}
      <Composition
        id="Store"
        component={StoreShots}
        durationInFrames={STORE_COUNT}
        fps={1}
        width={1280}
        height={800}
      />
      {/* Butikkens smaa brik (soegeresultater) og marquee (featuring) */}
      <Composition id="PromoTile" component={PromoTile} durationInFrames={1} fps={1} width={440} height={280} />
      {/* Delingsbilledet (Open Graph, 1200x630) og GitHubs forhaandsbillede (1280x640) - ét motiv, to formater. */}
      <Composition id="OgImage" component={OgImage} durationInFrames={1} fps={1} width={1200} height={630} />
      <Composition id="GithubSocial" component={GithubSocial} durationInFrames={1} fps={1} width={1280} height={640} />
      <Composition id="MarqueeTile" component={MarqueeTile} durationInFrames={1} fps={1} width={1400} height={560} />
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
