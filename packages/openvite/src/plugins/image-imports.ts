/**
 * openvite:image-imports — Transform local image imports to StaticImageData.
 *
 * When a source file imports a local image (e.g., `import hero from './hero.jpg'`),
 * this plugin transforms the default import to a StaticImageData object with
 * { src, width, height } so the next/image shim can set correct dimensions.
 */
import type { Plugin } from "vite";
import type { PluginContext } from "../core/plugin-context.js";
import { IMAGE_EXTS } from "../core/types.js";
import MagicString from "magic-string";
import path from "node:path";
import fs from "node:fs";

export function imageImportsPlugin(_ctx: PluginContext): Plugin {
  const dimCache = new Map<string, { width: number; height: number }>();

  return {
    name: "openvite:image-imports",
    enforce: "pre",

    _dimCache: dimCache,

    resolveId: {
      filter: { id: /\?openvite-meta$/ },
      handler(source, _importer) {
        if (!source.endsWith("?openvite-meta")) return null;
        const realPath = source.replace("?openvite-meta", "");
        return `\0openvite-image-meta:${realPath}`;
      },
    },

    async load(id) {
      if (!id.startsWith("\0openvite-image-meta:")) return null;
      const imagePath = id.replace("\0openvite-image-meta:", "");

      let dims = dimCache.get(imagePath);
      if (!dims) {
        try {
          const { imageSize } = await import("image-size");
          const buffer = fs.readFileSync(imagePath);
          const result = imageSize(buffer);
          dims = { width: result.width ?? 0, height: result.height ?? 0 };
          dimCache.set(imagePath, dims);
        } catch {
          dims = { width: 0, height: 0 };
        }
      }

      return `export default ${JSON.stringify(dims)};`;
    },

    transform: {
      filter: {
        id: {
          include: /\.(tsx?|jsx?|mjs)$/,
          exclude: /node_modules/,
        },
        code: new RegExp(`import\\s+\\w+\\s+from\\s+['"][^'"]+\\.(${IMAGE_EXTS})['"]`),
      },
      async handler(code, id) {
        if (id.includes("node_modules")) return null;
        if (id.startsWith("\0")) return null;
        if (!id.match(/\.(tsx?|jsx?|mjs)$/)) return null;

        const imageImportRe = new RegExp(`import\\s+(\\w+)\\s+from\\s+['"]([^'"]+\\.(${IMAGE_EXTS}))['"];?`, "g");
        if (!imageImportRe.test(code)) return null;

        imageImportRe.lastIndex = 0;

        const s = new MagicString(code);
        let hasChanges = false;

        let match;
        while ((match = imageImportRe.exec(code)) !== null) {
          const [fullMatch, varName, importPath] = match;
          const matchStart = match.index;
          const matchEnd = matchStart + fullMatch.length;

          const dir = path.dirname(id);
          const absImagePath = path.resolve(dir, importPath).replace(/\\/g, "/");

          if (!fs.existsSync(absImagePath)) continue;

          const urlVar = `__openvite_img_url_${varName}`;
          const metaVar = `__openvite_img_meta_${varName}`;
          const replacement =
            `import ${urlVar} from ${JSON.stringify(importPath)};\n` +
            `import ${metaVar} from ${JSON.stringify(absImagePath + "?openvite-meta")};\n` +
            `const ${varName} = { src: ${urlVar}, width: ${metaVar}.width, height: ${metaVar}.height };`;

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
  } as Plugin & { _dimCache: Map<string, { width: number; height: number }> };
}
