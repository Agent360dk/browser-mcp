/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";
import { enableTailwind } from '@remotion/tailwind-v4';

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig(enableTailwind);

// Remotion 4.0.545 henter Chrome 158. Fra Chrome 155 tager GPU-processen selv macOS' privatlivs-ansvar
// (featuren MacDisclaimGpuTccResponsibility), og så nægter macOS den at læse Chromes egen mappe, når mappen ligger på et
// eksternt drev: «icudtl.dat not found in bundle», GPU-processen dør, og renderingen stopper (målt 21/11-2026).
// Slået fra kun her, til lokal rendering af vores egne kompositioner. Chrome 144 (Remotion 4.0.442) havde ikke featuren.
if (process.platform === "darwin") {
  Config.setChromiumFeatures({ MacDisclaimGpuTccResponsibility: false });
}
