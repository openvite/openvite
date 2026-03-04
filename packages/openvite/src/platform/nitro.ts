/**
 * Nitro platform adapter.
 *
 * Like Cloudflare, Nitro bundles all dependencies.
 */
import type { PlatformAdapter } from "../core/platform.js";

export class NitroAdapter implements PlatformAdapter {
  readonly name = "nitro" as const;
  readonly bundlesAllDeps = true;
  readonly needsClientManifest = false;

  rscExternals(): string[] {
    return [];
  }
}
