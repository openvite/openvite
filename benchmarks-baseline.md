# Benchmarks Baseline — openvite

Fecha: 2026-03-04
Commit: `ca65f4c` (refactor: hexagonal architecture)
Plataforma: Windows 11, Node 22, Vite 7.3.1, TypeScript 5.9
App de prueba: my-app (App Router, 2 rutas, RSC)

---

## Compilacion TSC de openvite (`npx tsc`)

| Run | Monolito (800c658) | Hexagonal (ca65f4c) | Delta |
|-----|---------------------|----------------------|-------|
| 1   | 7,851 ms            | 7,604 ms             | -247 ms |
| 2   | 7,879 ms            | 7,583 ms             | -296 ms |
| 3   | 7,997 ms            | 7,388 ms             | -609 ms |
| **Promedio** | **7,909 ms** | **7,525 ms**    | **-384 ms (-4.9%)** |

## Build de my-app (`openvite build`)

5 fases: analyze client refs, analyze server refs, build RSC, build client, build SSR.

| Run | Monolito | Hexagonal | Delta |
|-----|----------|-----------|-------|
| 1   | 5,086 ms | 5,150 ms  | +64 ms |
| 2   | 4,984 ms | 5,101 ms  | +117 ms |
| 3   | 5,073 ms | 4,922 ms  | -151 ms |
| **Promedio** | **5,048 ms** | **5,058 ms** | **+10 ms (~0%)** |

### Desglose por fase (Hexagonal, run tipico)

| Fase | Tiempo |
|------|--------|
| 1. Analyze client refs (RSC) | 608 ms |
| 2. Analyze server refs (SSR) | 129 ms |
| 3. Build RSC | 1,360 ms |
| 4. Build client | 750 ms |
| 5. Build SSR | 307 ms |
| **Total** | **~3,154 ms** (+ overhead CLI) |

## Output de build (identico byte a byte)

| Artefacto | Tamano |
|-----------|--------|
| `dist/server/index.js` (RSC bundle) | 725.87 KB |
| `dist/server/ssr/index.js` (SSR bundle) | 245.94 KB |
| `dist/client/framework-*.js` | 192.50 KB (gzip: 60.39 KB) |
| `dist/client/index-*.js` | 31.68 KB (gzip: 10.60 KB) |
| `dist/client/facade-*.js` | 1.48 KB (gzip: 0.64 KB) |

## Organizacion del codigo

| Metrica | Monolito | Hexagonal | Cambio |
|---------|----------|-----------|--------|
| `src/index.ts` | 3,714 lineas | 38 lineas | **-99.0%** |
| `src/server/app-dev-server.ts` | 2,966 lineas | 10 lineas | **-99.7%** |
| Archivo mas largo en core | 3,714 lineas | 518 lineas (`core/types.ts`) | **-86.1%** |
| Archivos .ts en src/ | 68 | 90 | +22 |
| Directorios nuevos | 0 | 4 (core/, plugins/, codegen/, platform/) | +4 |
| Plugins Vite inline | 12 (en index.ts) | 10 archivos individuales | modular |
| `hasCloudflarePlugin` en plugins | 5+ usos | 0 | eliminado |

## Tests

| Suite | Monolito | Hexagonal |
|-------|----------|-----------|
| Total tests | 2,147 pass | 2,147 pass |
| Test files | 52 | 52 |
| Skipped | 3 | 3 |
| Pre-existing failures | 1 (better-auth) | 1 (better-auth) |

## Estructura nueva

```
packages/openvite/src/
  core/           # Hexagono: tipos, contexto, interfaz PlatformAdapter, orquestador
    types.ts          518 lineas
    plugin-context.ts  68 lineas
    platform.ts        52 lineas
    plugin.ts          94 lineas

  plugins/        # 1 archivo = 1 plugin Vite
    config.ts         484 lineas  (el mas grande, config principal)
    pages-router.ts   419 lineas  (HMR + dev middleware)
    google-fonts.ts   196 lineas
    use-cache.ts      115 lineas
    image-imports.ts  105 lineas
    local-fonts.ts     67 lineas
    og-assets.ts       59 lineas
    react-canary.ts    56 lineas
    platform-build.ts  45 lineas
    image-config.ts    40 lineas

  codegen/        # Generadores de entry points (string templates)
    rsc-entry.ts     2,241 lineas
    pages-entry.ts   1,031 lineas
    ssr-entry.ts       415 lineas
    browser-entry.ts   308 lineas

  platform/       # Adapters (implementan PlatformAdapter)
    cloudflare.ts    123 lineas
    detect.ts         31 lineas
    node.ts           17 lineas
    nitro.ts          16 lineas
```
