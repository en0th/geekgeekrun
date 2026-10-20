// Shared by the startup probe and browser workers. Unknown errors never invalidate cookies.
export function classifyBossLoginResponse(httpStatus, body) {
  const message = typeof body?.message === 'string' ? body.message.slice(0, 240) : ''
  if (!httpStatus || httpStatus >= 500)
    return { status: 'unknown', detail: httpStatus ? `BOSS服务暂时不可用（HTTP ${httpStatus}）` : '未能收到BOSS登录状态响应，请检查网络后重试' }
  if (httpStatus === 403 || httpStatus === 429 || [31, 37].includes(Number(body?.code)) ||
      /安全[验校]证|安全校验|验证码|滑块|环境.{0,8}异常|访问.{0,8}(频繁|受限)|操作.{0,8}频繁|captcha|too many requests/i.test(message))
    return { status: 'restricted', detail: message || 'BOSS限制了访问，请先在浏览器中完成验证或稍后重试' }
  if (httpStatus === 401 || Number(body?.code) === 7 ||
      /未登录|登录.{0,8}(失效|过期)|请.{0,4}(重新|先)?登录|not logged in|login required/i.test(message))
    return { status: 'invalid', detail: message || 'BOSS登录状态已失效，请重新登录' }
  if (httpStatus >= 200 && httpStatus < 300 && (body?.code === 0 || body?.code === '0') &&
      typeof body?.zpData?.encryptUserId === 'string' && body.zpData.encryptUserId.trim())
    return { status: 'valid', detail: '' }
  return { status: 'unknown', detail: message || `暂时无法确认BOSS登录状态（HTTP ${httpStatus}），登录凭证已保留` }
}

export function bossLoginError(result) {
  const error = new Error(result.status === 'invalid' ? 'LOGIN_STATUS_INVALID' :
    result.status === 'restricted' ? 'LOGIN_STATUS_RESTRICTED' : 'LOGIN_STATUS_UNKNOWN')
  error.detail = result.detail
  return error
}
