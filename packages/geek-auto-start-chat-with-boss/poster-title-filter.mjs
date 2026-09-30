export const DEFAULT_POSTER_HR_TITLE_REG_EXP_STR =
  'HR|HRBP|HRG|Recruiter|Talent Acquisition|招聘|人事|人力|人资'

// an empty rule means "use the default" rather than "filter nothing", since configs created
// before this option existed have no rule and the UI only shows the default as a placeholder
export function resolvePosterHrTitleRegExpStr(posterHrTitleRegExpStr) {
  return posterHrTitleRegExpStr?.trim?.() || DEFAULT_POSTER_HR_TITLE_REG_EXP_STR
}

export function buildPosterHrTitleRegExp({ isPosterHrFilterEnabled, posterHrTitleRegExpStr }) {
  if (!isPosterHrFilterEnabled) {
    return null
  }
  try {
    return new RegExp(resolvePosterHrTitleRegExpStr(posterHrTitleRegExpStr), 'im')
  } catch {
    return null
  }
}

export function testIfPosterTitleSuit(bossInfo, { isPosterHrFilterEnabled, posterHrTitleRegExpStr }) {
  const posterHrTitleRegExp = buildPosterHrTitleRegExp({
    isPosterHrFilterEnabled,
    posterHrTitleRegExpStr,
  })
  if (!isPosterHrFilterEnabled || !posterHrTitleRegExp) {
    return true
  }
  const posterTitle = bossInfo?.title?.trim?.() ?? ''
  if (!posterTitle) {
    return false
  }
  return posterHrTitleRegExp.test(posterTitle)
}
