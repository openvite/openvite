/**
 * Node.js platform adapter — the default.
 *
 * Node.js externalizes native packages from the RSC environment
 * and does not bundle all dependencies.
 */
import type { PlatformAdapter } from "../core/platform.js";

export class NodeAdapter implements PlatformAdapter {
  readonly name = "node" as const;
  readonly bundlesAllDeps = false;
  readonly needsClientManifest = false;

  rscExternals(): string[] {
    return ["satori", "@resvg/resvg-js", "yoga-wasm-web"];
  }
}
