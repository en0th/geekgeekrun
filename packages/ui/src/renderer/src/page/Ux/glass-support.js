// Native desktop translucency and the renderer's sidebar appearance are separate.
// Win10 has no Electron backgroundMaterial but still receives in-app frosted glass.
export function sidebarGlassPresentation({ nativeGlass = false, supportsBackdrop = false, reduceTransparency = false } = {}) {
  const effect = reduceTransparency || !supportsBackdrop ? 'static' : nativeGlass ? 'refracted' : 'frosted'
  return { nativeGlass: Boolean(nativeGlass), effect, refracted: effect === 'refracted' }
}
