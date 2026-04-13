/**
 * ScreenCapture turns the current viewport (or a specific element) into a
 * base64 PNG suitable for feeding to a vision-capable LLM. The heavy
 * rasterization library (`modern-screenshot`) is loaded lazily via a
 * dynamic import so it never bloats the initial bundle — pages that never
 * take a screenshot only pay the cost of this small wrapper.
 *
 * If the library cannot be resolved (e.g. in a test environment), a clear
 * error is thrown so callers can fall back to DOM-only context.
 */

type DomToImageFn = (node: Node, options?: { backgroundColor?: string }) => Promise<string>

interface ModernScreenshotModule {
  domToPng?: DomToImageFn
  default?: { domToPng?: DomToImageFn }
}

export class ScreenCapture {
  private static cachedModule: ModernScreenshotModule | null = null

  async captureViewport(): Promise<string> {
    if (typeof document === 'undefined') throw new Error('ScreenCapture: no document')
    return this.captureElement(document.documentElement)
  }

  async captureElement(element: Element): Promise<string> {
    const toPng = await loadToPng()
    const dataUrl = await toPng(element, { backgroundColor: '#ffffff' })
    return dataUrl
  }

  async captureFullPage(): Promise<string> {
    if (typeof document === 'undefined') throw new Error('ScreenCapture: no document')
    return this.captureElement(document.body)
  }

  static isSupported(): boolean {
    return typeof document !== 'undefined' && typeof HTMLCanvasElement !== 'undefined'
  }
}

// Hidden from bundlers so `modern-screenshot` stays a truly optional peer.
// Using `new Function('return import(...)')` prevents Vite/Rollup/tsup from
// statically resolving the specifier — the module is only fetched at runtime
// when a screenshot is actually requested.
const dynamicImport = (specifier: string): Promise<unknown> =>
  (new Function('s', 'return import(s)') as (s: string) => Promise<unknown>)(specifier)

const loadToPng = async (): Promise<DomToImageFn> => {
  if (ScreenCapture['cachedModule']) {
    const fn = resolveFn(ScreenCapture['cachedModule'])
    if (fn) return fn
  }
  try {
    const mod = (await dynamicImport('modern-screenshot')) as ModernScreenshotModule
    ScreenCapture['cachedModule' as keyof typeof ScreenCapture] = mod as never
    const fn = resolveFn(mod)
    if (!fn) throw new Error('modern-screenshot has no domToPng export')
    return fn
  } catch (error) {
    throw new Error(
      `ScreenCapture requires the \`modern-screenshot\` package. Install it in the host app. (${
        error instanceof Error ? error.message : String(error)
      })`,
    )
  }
}

const resolveFn = (mod: ModernScreenshotModule): DomToImageFn | null => {
  if (typeof mod.domToPng === 'function') return mod.domToPng
  if (mod.default && typeof mod.default.domToPng === 'function') return mod.default.domToPng
  return null
}
