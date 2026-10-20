export function bindRunAccount(previousId, currentId) {
  if (typeof currentId !== 'string' || !currentId.trim())
    throw new Error('LOGIN_STATUS_UNKNOWN')
  const id = currentId.trim()
  if (previousId && previousId !== id) throw new Error('AUTO_CHAT_ACCOUNT_CHANGED')
  return id
}
