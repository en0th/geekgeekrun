export const checkCookieListFormat = (cookies: unknown): boolean => {
  const allExpectKeySet = new Set([
    'name',
    'value',
    'domain',
    'path',
    'secure',
    'session',
    'httpOnly'
  ])
  return Array.isArray(cookies) &&
    cookies.length > 0 &&
    cookies.every((it) => {
      if (!it || typeof it !== 'object') return false
      const currentOwnedKeySet = new Set(Object.keys(it))
      if (currentOwnedKeySet.size < allExpectKeySet.size) {
        return false
      }

      const allExpectKeyArr = [...allExpectKeySet]
      for (let i = 0; i < allExpectKeyArr.length; i++) {
        if (!currentOwnedKeySet.has(allExpectKeyArr[i])) {
          return false
        }
      }
      return true
    })
}
