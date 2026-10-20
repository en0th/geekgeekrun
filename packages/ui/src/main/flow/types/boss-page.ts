// The BOSS page exposes these Vue 2 component fields. Keep the browser boundary
// explicit instead of assigning framework internals to every DOM Element.
export interface BossVueElement<T> extends HTMLElement { __vue__: T }

export interface BossUserInfo { encryptUserId: string }
export interface BossContact { encryptBossId: string; name: string; title?: string }
export interface BossJobDetail {
  securityId?: string
  jobInfo: { encryptId: string; positionName?: string }
  bossInfo?: { activeTimeDesc?: string }
}

export interface BossConversation {
  encryptJobId?: string
  bothTalked?: boolean
}

export interface BossChatMessage {
  mid: number
  isSelf: boolean
  text: string
  type: 'text' | 'image' | 'resume'
  style?: 'sent' | 'received'
  status?: number
  time?: number
  bizType?: number
  image?: { originImage?: { url?: string; width?: number; height?: number } }
}

export interface BossChatScroller {
  scrollToIndex(index: number): void
  scrollToBottom(): void
}
