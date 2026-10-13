// Electron backgroundMaterial is supported only on Windows 11 22H2 and newer.
// Unsupported platforms get an opaque window; renderer glass never needs this API.
export function nativeWindowMaterial(platform, release = '') {
  if (platform === 'darwin') return { vibrancy: 'sidebar', visualEffectState: 'active', backgroundColor: '#00000000' }
  const build = Number(String(release).split('.')[2])
  if (platform === 'win32' && Number.isFinite(build) && build >= 22621)
    return { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' }
  return { backgroundColor: '#ffffff' }
}
