/**
 * openvite:use-cache — "use cache" directive transform.
 *
 * Detects "use cache" at file-level or function-level and wraps the
 * exports/functions with registerCachedFunction() from openvite/cache-runtime.
 */
import type { Plugin } from "vite";
import { parseAst } from "vite";
import type { PluginContext } from "../core/plugin-context.js";
import { detectPackageManager } from "../utils/project.js";
import MagicString from "magic-string";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function useCachePlugin(ctx: PluginContext): Plugin {
  return {
    name: "openvite:use-cache",

    transform: {
      filter: {
        id: {
          include: /\.(tsx?|jsx?|mjs)$/,
          exclude: /node_modules/,
        },
        code: "use cache",
      },
      async handler(code, id) {
        if (id.includes("node_modules")) return null;
        if (id.startsWith("\0")) return null;
        if (!id.match(/\.(tsx?|jsx?|mjs)$/)) return null;
        if (!code.includes("use cache")) return null;

        if (!ctx.resolvedRscTransformsPath) {
          throw new Error(
            "openvite: 'use cache' requires @vitejs/plugin-rsc to be installed.\n" +
            "Run: " + detectPackageManager(process.cwd()) + " @vitejs/plugin-rsc",
          );
        }
        const { transformWrapExport, transformHoistInlineDirective } = await import(pathToFileURL(ctx.resolvedRscTransformsPath).href);
        const ast = parseAst(code);

        const cacheDirective = (ast.body as any[]).find(
          (node: any) =>
            node.type === "ExpressionStatement" &&
            node.expression?.type === "Literal" &&
            typeof node.expression.value === "string" &&
            node.expression.value.startsWith("use cache"),
        );

        if (cacheDirective) {
          const directiveValue: string = cacheDirective.expression.value;
          const variant = directiveValue === "use cache" ? "" : directiveValue.replace("use cache:", "").replace("use cache: ", "").trim();

          const isLayoutOrTemplate = /\/(layout|template)\.(tsx?|jsx?|mjs)$/.test(id);

          const runtimeModuleUrl = pathToFileURL(path.join(ctx.shimsDir, "cache-runtime.js")).href;
          const result = transformWrapExport(code, ast as any, {
            runtime: (value: any, name: any) =>
              `(await import(${JSON.stringify(runtimeModuleUrl)})).registerCachedFunction(${value}, ${JSON.stringify(id + ":" + name)}, ${JSON.stringify(variant)})`,
            rejectNonAsyncFunction: false,
            filter: (name: any, meta: any) => {
              if (meta.isFunction === false) return false;
              if (isLayoutOrTemplate && name === "default") return false;
              return true;
            },
          });

          if (result.exportNames.length > 0) {
            const output = result.output;
            output.overwrite(cacheDirective.start, cacheDirective.end, `/* "use cache" — wrapped by openvite */`);
            return {
              code: output.toString(),
              map: output.generateMap({ hires: "boundary" }),
            };
          }

          const output = new MagicString(code);
          output.overwrite(cacheDirective.start, cacheDirective.end, `/* "use cache" — handled by openvite */`);
          return {
            code: output.toString(),
            map: output.generateMap({ hires: "boundary" }),
          };
        }

        const hasInlineCache = code.includes("use cache") && !cacheDirective;
        if (hasInlineCache) {
          const runtimeModuleUrl2 = pathToFileURL(path.join(ctx.shimsDir, "cache-runtime.js")).href;

          try {
            const result = transformHoistInlineDirective(code, ast as any, {
              directive: /^use cache(:\s*\w+)?$/,
              runtime: (value: any, name: any, meta: any) => {
                const directiveMatch = meta.directiveMatch[0];
                const variant = directiveMatch === "use cache" ? "" : directiveMatch.replace("use cache:", "").replace("use cache: ", "").trim();
                return `(await import(${JSON.stringify(runtimeModuleUrl2)})).registerCachedFunction(${value}, ${JSON.stringify(id + ":" + name)}, ${JSON.stringify(variant)})`;
              },
              rejectNonAsyncFunction: false,
            });

            if (result.names.length > 0) {
              return {
                code: result.output.toString(),
                map: result.output.generateMap({ hires: "boundary" }),
              };
            }
          } catch {
            // If hoisting fails, fall through
          }
        }

        return null;
      },
    },
  };
}
