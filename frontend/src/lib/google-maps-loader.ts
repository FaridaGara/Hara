let configuredApiKey: string | null = null;

export async function loadGoogleMaps(apiKey: string) {
  if (!apiKey) throw new Error("Map unavailable");
  const loader = await import("@googlemaps/js-api-loader");
  if (configuredApiKey && configuredApiKey !== apiKey) throw new Error("Map already configured");
  if (!configuredApiKey) {
    loader.setOptions({ key: apiKey, v: "weekly", language: "az", region: "AZ" });
    configuredApiKey = apiKey;
  }
  return loader;
}
