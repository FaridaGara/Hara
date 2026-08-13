import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "today.hara.app",
  appName: "HARA",
  webDir: "capacitor-web",
  backgroundColor: "#00000000",
  loggingBehavior: "debug",
  android: {
    backgroundColor: "#00000000",
    webContentsDebuggingEnabled: false,
    resolveServiceWorkerRequests: false,
  },
  server: {
    url: "https://www.hara.today",
    androidScheme: "https",
    cleartext: false,
    errorPath: "offline.html",
  },
  plugins: {
    SystemBars: {
      insetsHandling: "css",
      style: "LIGHT",
      hidden: false,
      animation: "NONE",
    },
  },
};

export default config;
