/**
 * Detect which platform adapter to use based on the Vite plugin list.
 */
import type { PlatformAdapter } from "../core/platform.js";
import { NodeAdapter } from "./node.js";
import { CloudflareAdapter } from "./cloudflare.js";
import { NitroAdapter } from "./nitro.js";

export function detectPlatform(pluginsFlat: any[]): PlatformAdapter {
  const hasCloudflarePlugin = pluginsFlat.some(
    (p: any) => p && typeof p === "object" && typeof p.name === "string" && (
      p.name === "vite-plugin-cloudflare" || p.name.startsWith("vite-plugin-cloudflare:")
    ),
  );

  if (hasCloudflarePlugin) {
    return new CloudflareAdapter();
  }

  const hasNitroPlugin = pluginsFlat.some(
    (p: any) => p && typeof p === "object" && typeof p.name === "string" && (
      p.name === "nitro" || p.name.startsWith("nitro:")
    ),
  );

  if (hasNitroPlugin) {
    return new NitroAdapter();
  }

  return new NodeAdapter();
}
