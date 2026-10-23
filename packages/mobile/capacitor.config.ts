import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "io.geekgeekrun.mobile",
  appName: "牛人快跑",
  webDir: "dist",
  backgroundColor: "#f5f7f5",
  server: { androidScheme: "https" },
  ios: { contentInset: "never", preferredContentMode: "mobile" },
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  plugins: { SplashScreen: { launchShowDuration: 0 } },
};
export default config;
