/**
 * openvite:google-fonts — Self-host Google Fonts during production builds.
 *
 * During production builds, fetches Google Fonts CSS + .woff2 files,
 * caches them locally in .openvite/fonts/, and rewrites font constructor
 * calls to pass _selfHostedCSS with @font-face rules pointing at local assets.
 * In dev mode, this plugin is a no-op (CDN loading is used instead).
 */
import type { Plugin } from "vite";
import type { PluginContext } from "../core/plugin-context.js";
import { parseStaticObjectLiteral } from "../core/types.js";
import { parseAst } from "vite";
import MagicString from "magic-string";
import path from "node:path";
import fs from "node:fs";

/**
 * Fetch Google Fonts CSS, download .woff2 files, cache locally, and return
 * @font-face CSS with local file references.
 */
async function fetchAndCacheFont(
  cssUrl: string,
  family: string,
  cacheDir: string,
): Promise<string> {
  const { createHash } = await import("node:crypto");
  const urlHash = createHash("md5").update(cssUrl).digest("hex").slice(0, 12);
  const fontDir = path.join(cacheDir, `${family.toLowerCase().replace(/\s+/g, "-")}-${urlHash}`);

  const cachedCSSPath = path.join(fontDir, "style.css");
  if (fs.existsSync(cachedCSSPath)) {
    return fs.readFileSync(cachedCSSPath, "utf-8");
  }

  const cssResponse = await fetch(cssUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });
  if (!cssResponse.ok) {
    throw new Error(`Failed to fetch Google Fonts CSS: ${cssResponse.status}`);
  }
  let css = await cssResponse.text();

  const urlRe = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g;
  const urls = new Map<string, string>();
  let urlMatch;
  while ((urlMatch = urlRe.exec(css)) !== null) {
    const fontUrl = urlMatch[1];
    if (!urls.has(fontUrl)) {
      const ext = fontUrl.includes(".woff2") ? ".woff2" : fontUrl.includes(".woff") ? ".woff" : ".ttf";
      const fileHash = createHash("md5").update(fontUrl).digest("hex").slice(0, 8);
      urls.set(fontUrl, `${family.toLowerCase().replace(/\s+/g, "-")}-${fileHash}${ext}`);
    }
  }

  fs.mkdirSync(fontDir, { recursive: true });
  for (const [fontUrl, filename] of urls) {
    const filePath = path.join(fontDir, filename);
    if (!fs.existsSync(filePath)) {
      const fontResponse = await fetch(fontUrl);
      if (fontResponse.ok) {
        const buffer = Buffer.from(await fontResponse.arrayBuffer());
        fs.writeFileSync(filePath, buffer);
      }
    }
    css = css.split(fontUrl).join(filePath.replace(/\\/g, "/"));
  }

  fs.writeFileSync(cachedCSSPath, css);
  return css;
}

export { fetchAndCacheFont };

export function googleFontsPlugin(_ctx: PluginContext): Plugin {
  return {
    name: "openvite:google-fonts",
    enforce: "pre",

    _isBuild: false,
    _fontCache: new Map<string, string>(),
    _cacheDir: "",

    configResolved(config) {
      (this as any)._isBuild = config.command === "build";
      (this as any)._cacheDir = path.join(config.root, ".openvite", "fonts");
    },

    transform: {
      filter: {
        id: {
          include: /\.(tsx?|jsx?|mjs)$/,
          exclude: /node_modules/,
        },
        code: "next/font/google",
      },
      async handler(code, id) {
        if (!(this as any)._isBuild) return null;
        if (id.includes("node_modules")) return null;
        if (id.startsWith("\0")) return null;
        if (!id.match(/\.(tsx?|jsx?|mjs)$/)) return null;
        if (!code.includes("next/font/google")) return null;

        const fontCallRe = /\b([A-Z][A-Za-z]*(?:_[A-Z][A-Za-z]*)*)\s*\(\s*(\{[^}]*\})\s*\)/g;

        const importRe = /import\s*\{([^}]+)\}\s*from\s*['"]next\/font\/google['"]/;
        const importMatch = code.match(importRe);
        if (!importMatch) return null;

        const importedNames = new Set(
          importMatch[1].split(",").map((s) => s.trim()).filter(Boolean),
        );

        const s = new MagicString(code);
        let hasChanges = false;

        const cacheDir = (this as any)._cacheDir as string;
        const fontCache = (this as any)._fontCache as Map<string, string>;

        let match;
        while ((match = fontCallRe.exec(code)) !== null) {
          const [fullMatch, fontName, optionsStr] = match;
          if (!importedNames.has(fontName)) continue;

          const family = fontName.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let options: Record<string, any> = {};
          try {
            const parsed = parseStaticObjectLiteral(optionsStr, parseAst);
            if (!parsed) continue;
            options = parsed as Record<string, any>;
          } catch {
            continue;
          }

          const weights = options.weight
            ? Array.isArray(options.weight) ? options.weight : [options.weight]
            : [];
          const styles = options.style
            ? Array.isArray(options.style) ? options.style : [options.style]
            : [];
          const display = options.display ?? "swap";

          let spec = family.replace(/\s+/g, "+");
          if (weights.length > 0) {
            const hasItalic = styles.includes("italic");
            if (hasItalic) {
              const pairs: string[] = [];
              for (const w of weights) { pairs.push(`0,${w}`); pairs.push(`1,${w}`); }
              spec += `:ital,wght@${pairs.join(";")}`;
            } else {
              spec += `:wght@${weights.join(";")}`;
            }
          } else if (styles.length === 0) {
            spec += `:wght@100..900`;
          }
          const params = new URLSearchParams();
          params.set("family", spec);
          params.set("display", display);
          const cssUrl = `https://fonts.googleapis.com/css2?${params.toString()}`;

          let localCSS = fontCache.get(cssUrl);
          if (!localCSS) {
            try {
              localCSS = await fetchAndCacheFont(cssUrl, family, cacheDir);
              fontCache.set(cssUrl, localCSS);
            } catch {
              continue;
            }
          }

          const matchStart = match.index;
          const matchEnd = matchStart + fullMatch.length;
          const escapedCSS = JSON.stringify(localCSS);
          const closingBrace = optionsStr.lastIndexOf("}");
          const optionsWithCSS = optionsStr.slice(0, closingBrace) +
            (optionsStr.slice(0, closingBrace).trim().endsWith("{") ? "" : ", ") +
            `_selfHostedCSS: ${escapedCSS}` +
            optionsStr.slice(closingBrace);

          const replacement = `${fontName}(${optionsWithCSS})`;
          s.overwrite(matchStart, matchEnd, replacement);
          hasChanges = true;
        }

        if (!hasChanges) return null;
        return {
          code: s.toString(),
          map: s.generateMap({ hires: "boundary" }),
        };
      },
    },
  } as Plugin & { _isBuild: boolean; _fontCache: Map<string, string>; _cacheDir: string };
}
