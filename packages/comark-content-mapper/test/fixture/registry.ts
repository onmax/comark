import type {} from 'comark'
declare module 'comark' {
  interface ComarkComponents {
    alert: { type: 'info' | 'warning' }
    card: { title: string; tags?: string[] }
    icon: { name: string; size?: number }
    'u-button': { label: string }
  }
  interface ComarkComponentSlots {
    card: 'default' | 'footer'
  }
  interface ComarkFrontmatter {
    title: string
  }
}
