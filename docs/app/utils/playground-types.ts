import { componentNames } from './components-manifest'
import { readComponentTypes } from './typecheck'
import type { ComponentTypes } from './typecheck'

const sources = import.meta.glob<string>('../components/playground/*.vue', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// Nuxt UI registers these as global `Prose*` components, so Markdown can use them without the manifest.
const nuxtUiProse = [
  'accordion',
  'accordion-item',
  'badge',
  'callout',
  'card',
  'card-group',
  'caution',
  'code-collapse',
  'code-group',
  'code-preview',
  'code-tree',
  'collapsible',
  'field',
  'field-group',
  'icon',
  'kbd',
  'note',
  'prompt',
  'steps',
  'tabs',
  'tabs-item',
  'tip',
  'warning',
]

/**
 * Props and slots of every component the playground renders. The playground's
 * own components are typed from their source; Nuxt UI's are known by name only,
 * so their props aren't checked.
 */
export const playgroundComponentTypes: Record<string, ComponentTypes> = Object.fromEntries([
  ...nuxtUiProse.map((name) => [name, {}]),
  ...componentNames.map((name) => {
    const source = sources[`../components/playground/${name}.vue`]
    return [name, source ? readComponentTypes(source) : {}]
  }),
])
