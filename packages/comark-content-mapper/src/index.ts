import { scan } from './scan.ts'
import type { Problem, Props, Span } from './scan.ts'

export { scan } from './scan.ts'
export type { Component, Problem, Prop, PropValue, Props, Scan, Span } from './scan.ts'

/** `[virtualStart, virtualLength, originalStart, originalLength, kind, features?]`, in UTF-16 code units, as TypeScript's content mapper protocol sends it. */
export type Mapping = [number, number, number, number, 0 | 1 | 2, number?]

export interface Transformed {
  /** TypeScript that type-checks the document. */
  text: string
  mappings: Mapping[]
  /** Syntax problems found before type checking, such as invalid YAML. */
  problems: Problem[]
}

const VERBATIM = 0 as const
const ATOM = 1 as const
// Definition and references only: TypeScript's default for a zero-length anchor.
const ANCHOR_FEATURES = 8 | 64

const PRELUDE = `import type { ComarkComponents as Components, ComarkComponentSlots as Slots, ComarkFrontmatter as Frontmatter } from 'comark'
declare const components: Components
declare function component<Props>(type: Props): (props: Props) => void
declare function slot<Name extends string>(component: Name, slot: Name extends keyof Slots ? Slots[Name] : string): void
export {}
`

/**
 * Turns a Comark document into TypeScript that checks its frontmatter against
 * `ComarkFrontmatter`, each component's props against `ComarkComponents`, and
 * each slot against `ComarkComponentSlots`, with every check mapped back to
 * the Markdown it came from. It has no Node.js dependencies, so it also runs in
 * a browser next to an in-page TypeScript checker.
 */
export function transform(source: string): Transformed {
  const { frontmatter, components, problems } = scan(source)
  let text = ''
  const mappings: Mapping[] = []

  const append = (code: string) => (text += code)
  const map = (code: string, span: Span, kind: 0 | 1 = ATOM) => {
    mappings.push(
      span[0] === span[1]
        ? [text.length, code.length, span[0], 0, ATOM, ANCHOR_FEATURES]
        : [text.length, code.length, span[0], span[1] - span[0], kind]
    )
    text += code
  }
  // Text that reads the same in Markdown and TypeScript maps verbatim, so the
  // editor can complete and rename inside it.
  const mapped = (span: Span, code: string) =>
    map(code, span, source.slice(span[0], span[1]) === code ? VERBATIM : ATOM)

  const writeProps = ({ span, props }: Props, frontmatter = false) => {
    // The braces map to the whole props block, so a missing required prop points at it.
    map('{', span)
    for (const prop of props) {
      mapped(prop.nameSpan, isIdentifier(prop.name) ? prop.name : JSON.stringify(prop.name))
      append(': ')
      const { value } = prop
      if (value.kind === 'literal') {
        mapped(prop.valueSpan, value.json)
        // Keeps `type: info` the literal "info", so a binding to it fits a prop typed `'info' | 'warning'`.
        if (frontmatter && /^("|-?\d|true$|false$)/.test(value.json)) append(' as const')
      } else if (value.kind === 'frontmatter') {
        // `frontmatter.items.1` reads index 1, which TypeScript writes `frontmatter.items[1]`.
        mapped(value.span, source.slice(...value.span).replace(/\.(\d+)/g, '[$1]'))
      } else append('undefined as any')
      append(', ')
    }
    map('}', span)
  }

  append(PRELUDE)
  append('const frontmatter = ')
  writeProps(frontmatter ?? { span: [0, 0], props: [] }, true)
  append(' ')
  // TypeScript reports a missing field on `satisfies`, so it maps to the opening `---`,
  // or to the start of a file with no frontmatter, where it keeps every feature.
  if (frontmatter) map('satisfies', [frontmatter.span[0], frontmatter.span[0] + 3])
  else {
    mappings.push([text.length, 'satisfies'.length, 0, 0, ATOM])
    append('satisfies')
  }
  append(' Frontmatter\n')

  for (const component of components) {
    append('component(components')
    if (isIdentifier(component.name)) {
      append('.')
      mapped(component.nameSpan, component.name)
    } else {
      map(`[${JSON.stringify(component.name)}]`, component.nameSpan)
    }
    append(')(')
    writeProps(component.props)
    append(')\n')
    for (const slot of component.slots) {
      append(`slot(${JSON.stringify(component.name)}, `)
      map(JSON.stringify(slot.name), slot.span)
      append(')\n')
    }
  }

  return { text, mappings, problems }
}

/**
 * Maps a range of the TypeScript from {@link transform} back to the Markdown.
 * Returns `undefined` for code the mapper wrote with no source, like the prelude.
 */
export function toSource(mappings: Mapping[], start: number, end: number): Span | undefined {
  const at = (offset: number, edge: 'start' | 'end') => {
    for (const [virtualStart, virtualLength, originalStart, originalLength, kind] of mappings) {
      const inside =
        offset >= virtualStart &&
        (edge === 'start' ? offset < virtualStart + virtualLength : offset <= virtualStart + virtualLength)
      if (!inside) continue
      if (kind === VERBATIM) return originalStart + offset - virtualStart
      return edge === 'start' ? originalStart : originalStart + originalLength
    }
  }
  const from = at(start, 'start')
  if (from === undefined) return undefined
  // An empty range belongs to the mapping it starts in; its end could land in the one before.
  if (end === start) return [from, from]
  return [from, Math.max(from, at(end, 'end') ?? from)]
}

function isIdentifier(name: string) {
  return /^[a-z_$][\w$]*$/i.test(name)
}
