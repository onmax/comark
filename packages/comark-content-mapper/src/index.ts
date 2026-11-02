import { MappedCodeBuilder } from 'ts-content-mapper'
import type { PositionEncoding, TransformResult } from 'ts-content-mapper'
import { scan } from './scan.ts'
import type { Props, Span } from './scan.ts'

export { scan } from './scan.ts'
export type { Component, Problem, Prop, PropValue, Props, Scan, Span } from './scan.ts'

const PRELUDE = `import type { ComarkComponents as Components, ComarkComponentSlots as Slots, ComarkFrontmatter as Frontmatter } from 'comark'
declare const components: Components
declare function component<Props>(type: Props, props: NoInfer<Props>): void
declare function slot<Name extends string>(component: Name, slot: Name extends keyof Slots ? Slots[Name] : string): void
export {}
`

/**
 * Turns a Comark document into TypeScript that checks its frontmatter against
 * `ComarkFrontmatter`, each component's props against `ComarkComponents`, and
 * each slot against `ComarkComponentSlots`, with every check mapped back to
 * the Markdown it came from.
 */
export function transform(source: string, positionEncoding: PositionEncoding = 'utf-16'): TransformResult {
  const { frontmatter, components, problems } = scan(source)
  const code = new MappedCodeBuilder(source, { positionEncoding })
  // Text that reads the same in Markdown and TypeScript maps verbatim, so the
  // editor can complete and rename inside it.
  const mapped = (span: Span) => (text: string) =>
    source.slice(span[0], span[1]) === text
      ? code.appendVerbatim(span[0], span[1])
      : code.appendAtom(text, span[0], span[1])

  code.append(PRELUDE)
  code.append('const frontmatter = ')
  writeProps(code, frontmatter ?? { span: [0, 0], props: [] }, mapped)
  code.append(' satisfies Frontmatter\n')

  for (const component of components) {
    code.append('component(components')
    if (isIdentifier(component.name)) code.append('.')
    mapped(component.nameSpan)(isIdentifier(component.name) ? component.name : `[${JSON.stringify(component.name)}]`)
    code.append(', ')
    writeProps(code, component.props, mapped)
    code.append(')\n')
    for (const slot of component.slots) {
      code.append(`slot(${JSON.stringify(component.name)}, `)
      mapped(slot.span)(JSON.stringify(slot.name))
      code.append(')\n')
    }
  }

  return {
    ...code.build('.ts'),
    diagnostics: problems.map(({ message, span, code: number }) => ({
      messageText: message,
      start: offset(source, span[0], positionEncoding),
      length: offset(source, span[1], positionEncoding) - offset(source, span[0], positionEncoding),
      code: number,
    })),
  }
}

function writeProps(
  code: MappedCodeBuilder,
  { span, props }: Props,
  mapped: (span: Span) => (text: string) => unknown
) {
  // The braces map to the whole props block, so a missing required prop points at it.
  const brace = (text: string) =>
    span[0] === span[1] ? code.appendAnchored(text, span[0]) : code.appendAtom(text, span[0], span[1])
  brace('{')
  for (const prop of props) {
    mapped(prop.nameSpan)(isIdentifier(prop.name) ? prop.name : JSON.stringify(prop.name))
    code.append(': ')
    const { value } = prop
    if (value.kind === 'literal') mapped(prop.valueSpan)(value.json)
    else if (value.kind === 'frontmatter') code.appendVerbatim(value.span[0], value.span[1])
    else code.append('undefined as any')
    code.append(', ')
  }
  brace('}')
}

function isIdentifier(name: string) {
  return /^[a-z_$][\w$]*$/i.test(name)
}

function offset(source: string, index: number, encoding: PositionEncoding) {
  return encoding === 'utf-8' ? Buffer.byteLength(source.slice(0, index)) : index
}
