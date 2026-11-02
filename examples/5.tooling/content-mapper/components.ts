import type {} from 'comark'

export interface AlertProps {
  type: 'info' | 'warning' | 'danger'
  title?: string
}

// Any renderer works: the registry takes props types, wherever they come from.
export function Badge(props: { color?: 'green' | 'red'; count: number }) {
  return `<span class="badge badge-${props.color ?? 'green'}">${props.count}</span>`
}

declare module 'comark' {
  interface ComarkComponents {
    alert: AlertProps
    badge: Parameters<typeof Badge>[0]
    card: { title: string; icon?: string }
  }

  interface ComarkComponentSlots {
    card: 'default' | 'footer'
  }

  interface ComarkFrontmatter {
    title: string
    draft?: boolean
  }
}
