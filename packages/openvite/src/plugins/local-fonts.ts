/**
 * openvite:local-fonts — Rewrite local font paths to Vite asset imports.
 *
 * When a source file calls localFont({ src: "./font.woff2" }), the relative
 * paths won't resolve in the browser. This plugin rewrites them into Vite
 * asset import references for both dev and prod URLs.
 */
import type { Plugin } from "vite";
import type { PluginContext } from "../core/plugin-context.js";
import MagicString from "magic-string";

export function localFontsPlugin(_ctx: PluginContext): Plugin {
  return {
    name: "openvite:local-fonts",
    enforce: "pre",

    transform: {
      filter: {
        id: {
          include: /\.(tsx?|jsx?|mjs)$/,
          exclude: /node_modules/,
        },
        code: "next/font/local",
      },
      handler(code, id) {
        if (id.includes("node_modules")) return null;
        if (id.startsWith("\0")) return null;
        if (!id.match(/\.(tsx?|jsx?|mjs)$/)) return null;
        if (!code.includes("next/font/local")) return null;
        // Skip openvite's own font-local shim
        if (id.includes("font-local")) return null;

        const importRe = /import\s+\w+\s+from\s*['"]next\/font\/local['"]/;
        if (!importRe.test(code)) return null;

        const s = new MagicString(code);
        let hasChanges = false;
        let fontImportCounter = 0;
        const imports: string[] = [];

        const fontPathRe = /((?:path|src)\s*:\s*)(['"])([^'"]+\.(?:woff2?|ttf|otf|eot))\2/g;

        let match;
        while ((match = fontPathRe.exec(code)) !== null) {
          const [fullMatch, prefix, _quote, fontPath] = match;
          const varName = `__openvite_local_font_${fontImportCounter++}`;

          imports.push(`import ${varName} from ${JSON.stringify(fontPath)};`);

          const matchStart = match.index;
          const matchEnd = matchStart + fullMatch.length;
          s.overwrite(matchStart, matchEnd, `${prefix}${varName}`);
          hasChanges = true;
        }

        if (!hasChanges) return null;

        s.prepend(imports.join("\n") + "\n");

        return {
          code: s.toString(),
          map: s.generateMap({ hires: "boundary" }),
        };
      },
    },
  } as Plugin;
}
