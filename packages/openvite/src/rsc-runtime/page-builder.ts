// @ts-nocheck — this module runs inside the Vite RSC environment where
// openvite/* and next/* aliases are resolved at runtime, not by tsc.
/**
 * Page element builder for App Router.
 *
 * Builds the nested layout + page component tree for a matched route,
 * including metadata head tags, error boundaries, not-found boundaries,
 * templates, parallel slots, and layout segment providers.
 */
import { createElement, Suspense, Fragment } from "react";
import { ErrorBoundary, NotFoundBoundary } from "openvite/error-boundary";
import { LayoutSegmentProvider } from "openvite/layout-segment-context";
import {
  MetadataHead,
  mergeMetadata,
  resolveModuleMetadata,
  ViewportHead,
  mergeViewport,
  resolveModuleViewport,
} from "openvite/metadata";
import { markDynamicUsage } from "next/headers";
import { makeThenableParams } from "./helpers.js";

export interface PageBuilderContext {
  rootNotFoundComponent: any;
  globalErrorComponent: any;
}

export async function buildPageElement(
  route: any,
  params: Record<string, any>,
  opts: any,
  searchParams: URLSearchParams | null,
  ctx: PageBuilderContext,
): Promise<any> {
  const PageComponent = route.page?.default;
  if (!PageComponent) {
    return createElement("div", null, "Page has no default export");
  }

  // Resolve metadata and viewport from layouts and page
  const metadataList: any[] = [];
  const viewportList: any[] = [];
  for (const layoutMod of route.layouts) {
    if (layoutMod) {
      const meta = await resolveModuleMetadata(layoutMod, params);
      if (meta) metadataList.push(meta);
      const vp = await resolveModuleViewport(layoutMod, params);
      if (vp) viewportList.push(vp);
    }
  }
  if (route.page) {
    const pageMeta = await resolveModuleMetadata(route.page, params);
    if (pageMeta) metadataList.push(pageMeta);
    const pageVp = await resolveModuleViewport(route.page, params);
    if (pageVp) viewportList.push(pageVp);
  }
  const resolvedMetadata = metadataList.length > 0 ? mergeMetadata(metadataList) : null;
  const resolvedViewport = viewportList.length > 0 ? mergeViewport(viewportList) : null;

  const asyncParams = makeThenableParams(params);
  const pageProps: Record<string, any> = { params: asyncParams };
  if (searchParams) {
    const spObj: Record<string, any> = {};
    let hasSearchParams = false;
    if (searchParams.forEach) {
      searchParams.forEach((v: string, k: string) => {
        hasSearchParams = true;
        if (k in spObj) {
          spObj[k] = Array.isArray(spObj[k]) ? spObj[k].concat(v) : [spObj[k], v];
        } else {
          spObj[k] = v;
        }
      });
    }
    if (hasSearchParams) markDynamicUsage();
    pageProps.searchParams = makeThenableParams(spObj);
  }
  let element = createElement(PageComponent, pageProps);

  // Metadata + viewport head tags
  {
    const headElements: any[] = [];
    headElements.push(createElement("meta", { charSet: "utf-8" }));
    if (resolvedMetadata) headElements.push(createElement(MetadataHead, { metadata: resolvedMetadata }));
    const effectiveViewport = resolvedViewport ?? { width: "device-width", initialScale: 1 };
    headElements.push(createElement(ViewportHead, { viewport: effectiveViewport }));
    element = createElement(Fragment, null, ...headElements, element);
  }

  // Loading Suspense boundary
  if (route.loading?.default) {
    element = createElement(Suspense, { fallback: createElement(route.loading.default) }, element);
  }

  // Leaf error boundary
  {
    const lastLayoutError = route.errors ? route.errors[route.errors.length - 1] : null;
    if (route.error?.default && route.error !== lastLayoutError) {
      element = createElement(ErrorBoundary, { fallback: route.error.default, children: element });
    }
  }

  // Not-found boundary
  {
    const NotFoundComponent = route.notFound?.default ?? ctx.rootNotFoundComponent;
    if (NotFoundComponent) {
      element = createElement(NotFoundBoundary, {
        fallback: createElement(NotFoundComponent),
        children: element,
      });
    }
  }

  // Templates (innermost first)
  if (route.templates) {
    for (let i = route.templates.length - 1; i >= 0; i--) {
      const TemplateComponent = route.templates[i]?.default;
      if (TemplateComponent) {
        element = createElement(TemplateComponent, { children: element, params });
      }
    }
  }

  // Layouts with per-layout error/notFound boundaries and parallel slots
  for (let i = route.layouts.length - 1; i >= 0; i--) {
    if (route.errors && route.errors[i]?.default) {
      element = createElement(ErrorBoundary, { fallback: route.errors[i].default, children: element });
    }

    const LayoutComponent = route.layouts[i]?.default;
    if (LayoutComponent) {
      // Per-layout NotFoundBoundary
      {
        const LayoutNotFound = route.notFounds?.[i]?.default;
        if (LayoutNotFound) {
          element = createElement(NotFoundBoundary, {
            fallback: createElement(LayoutNotFound),
            children: element,
          });
        }
      }

      const layoutProps: Record<string, any> = { children: element, params: makeThenableParams(params) };

      // Parallel slots
      if (route.slots) {
        for (const [slotName, slotMod] of Object.entries(route.slots) as any[]) {
          const targetIdx = slotMod.layoutIndex >= 0 ? slotMod.layoutIndex : route.layouts.length - 1;
          if (i !== targetIdx) continue;

          let SlotPage: any = null;
          let slotParams = params;

          if (opts && opts.interceptSlot === slotName && opts.interceptPage) {
            SlotPage = opts.interceptPage.default;
            slotParams = opts.interceptParams || params;
          } else {
            SlotPage = slotMod.page?.default || slotMod.default?.default;
          }

          if (SlotPage) {
            let slotElement = createElement(SlotPage, { params: makeThenableParams(slotParams) });
            const SlotLayout = slotMod.layout?.default;
            if (SlotLayout) {
              slotElement = createElement(SlotLayout, {
                children: slotElement,
                params: makeThenableParams(slotParams),
              });
            }
            if (slotMod.loading?.default) {
              slotElement = createElement(Suspense, { fallback: createElement(slotMod.loading.default) }, slotElement);
            }
            if (slotMod.error?.default) {
              slotElement = createElement(ErrorBoundary, { fallback: slotMod.error.default, children: slotElement });
            }
            layoutProps[slotName] = slotElement;
          }
        }
      }

      element = createElement(LayoutComponent, layoutProps);

      const layoutDepth = route.layoutSegmentDepths ? route.layoutSegmentDepths[i] : 0;
      element = createElement(LayoutSegmentProvider, { depth: layoutDepth }, element);
    }
  }

  // Global error boundary
  if (ctx.globalErrorComponent) {
    element = createElement(ErrorBoundary, {
      fallback: ctx.globalErrorComponent,
      children: element,
    });
  }

  return element;
}
