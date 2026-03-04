/**
 * PlatformAdapter — the main port in the hexagonal architecture.
 *
 * Each deployment target (Node.js, Cloudflare Workers, Nitro) implements
 * this interface. The rest of the codebase programs against the interface
 * instead of checking booleans like `hasCloudflarePlugin`.
 */

export interface BuildContext {
  /** Vite project root (absolute path). */
  root: string;
  /** Absolute path to dist/ output. */
  distDir: string;
  /** Whether this is an App Router project. */
  hasAppDir: boolean;
  /** Vite environment config for the current environment. */
  envConfig: any;
}

export interface PlatformAdapter {
  /** Platform identifier. */
  readonly name: "node" | "cloudflare" | "nitro";

  /**
   * If true, all dependencies are bundled (no SSR externals).
   * Cloudflare Workers and Nitro bundle everything; Node.js does not.
   */
  readonly bundlesAllDeps: boolean;

  /**
   * If true, generate a client build manifest for post-build injection.
   */
  readonly needsClientManifest: boolean;

  /**
   * Packages to externalize from the RSC environment.
   * Node.js externalizes satori, @resvg/resvg-js, yoga-wasm-web;
   * bundled platforms return an empty array.
   */
  rscExternals(): string[];

  /**
   * Post-build hook called after all environments are built.
   * Used by Cloudflare to inject globals into the worker entry.
   */
  onBuildComplete?(ctx: BuildContext): Promise<void>;

  /**
   * Extra environment variables for the Pages Router client env.
   */
  pagesRouterClientEnv?(): Record<string, unknown>;
}
