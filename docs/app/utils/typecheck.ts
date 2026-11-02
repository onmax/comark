import { kebabCase, pascalCase } from 'scule'
import { scan, toSource } from '@comark/content-mapper'
import type { Transformed } from '@comark/content-mapper'
import type { Span } from '@comark/content-mapper'

export interface ComponentTypes {
  /** The `defineProps` type, or `undefined` when the props are unknown and anything goes. */
  props?: string
  /** Slot names, or `undefined` when any slot goes. */
  slots?: string[]
}

export interface TypeProblem {
  message: string
  span: Span
  code: number
}

export interface MessageChain {
  messageText: string
  next?: MessageChain[]
}

export interface Diagnostic {
  start: number
  length: number
  code: number
  messageText: string | MessageChain
}

/** Reads the props and slots of a Vue SFC from its source, for components whose props are one `defineProps<{ … }>()`. */
export function readComponentTypes(sfc: string): ComponentTypes {
  const open = sfc.indexOf('defineProps<')
  let props = '{}'
  if (open !== -1) {
    let depth = 0
    const start = open + 'defineProps<'.length
    for (let i = start; i < sfc.length; i++) {
      if (sfc[i] === '<' || sfc[i] === '{' || sfc[i] === '(') depth++
      else if (sfc[i] === '}' || sfc[i] === ')') depth--
      else if (sfc[i] === '>' && sfc[i - 1] !== '=') {
        if (depth === 0) {
          props = sfc.slice(start, i)
          break
        }
        depth--
      }
    }
  }
  const template = sfc.slice(sfc.indexOf('<template'))
  const slots = [...template.matchAll(/<slot\b([^>]*)>/g)].map(
    ([, attrs]) => attrs!.match(/\bname="([^"]+)"/)?.[1] ?? 'default'
  )
  return { props, slots: [...new Set(slots)] }
}

/** Declares `comark`'s component registry for the in-browser checker, under the kebab-case and PascalCase name of each component. */
export function comarkRegistryDeclaration(components: Record<string, ComponentTypes>): string {
  const props: string[] = []
  const slots: string[] = []
  for (const [name, types] of Object.entries(components)) {
    for (const key of new Set([kebabCase(name), pascalCase(name)])) {
      props.push(
        `    ${JSON.stringify(key)}: ${types.props ? `(${types.props}) & ComarkPlaygroundAttributes` : 'Record<string, unknown>'}`
      )
      if (types.slots)
        slots.push(
          `    ${JSON.stringify(key)}: ${types.slots.map((slot) => JSON.stringify(slot)).join(' | ') || 'never'}`
        )
    }
  }
  // Vue passes these through to a component's root element, so they're valid on any component.
  return `type ComarkPlaygroundAttributes = { class?: string; id?: string; style?: string; [key: \`data-\${string}\`]: unknown; [key: \`aria-\${string}\`]: unknown }
declare module 'comark' {
  export interface ComarkComponents {
${props.join('\n')}
  }
  export interface ComarkComponentSlots {
${slots.join('\n')}
  }
  export interface ComarkFrontmatter {}
}
`
}

/**
 * Maps the checker's diagnostics back to the Markdown and words each one in
 * Comark's terms: which component, prop, or slot is wrong, and what it takes instead.
 */
export function describeTypeProblems(
  markdown: string,
  mapped: Transformed,
  diagnostics: Diagnostic[],
  components: Record<string, ComponentTypes>
): TypeProblem[] {
  const { components: found, frontmatter } = scan(markdown)
  const problems: TypeProblem[] = mapped.problems.map(({ message, span, code }) => ({ message, span, code }))
  const contains = (outer: Span, inner: Span) => outer[0] <= inner[0] && inner[1] <= outer[1]
  const names = Object.keys(components).map((name) => kebabCase(name))

  for (const diagnostic of diagnostics) {
    const span = toSource(mapped.mappings, diagnostic.start, diagnostic.start + diagnostic.length)
    if (!span) continue
    const raw = flatten(diagnostic.messageText)
    const text = markdown.slice(...span)

    const component = found.find(
      (c) => contains(c.nameSpan, span) || contains(c.props.span, span) || c.slots.some((s) => contains(s.span, span))
    )
    const prop = [...(component?.props.props ?? []), ...(frontmatter?.props ?? [])].find(
      (p) => contains(p.nameSpan, span) || contains(p.valueSpan, span)
    )
    const slot = component?.slots.find((s) => contains(s.span, span))
    // TypeScript reports a prop's own mismatch on its name and a mismatch inside its value, like
    // one item of a list, within the value, where only its own wording says which part is wrong.
    const nested = prop && !contains(prop.nameSpan, span) && contains(prop.valueSpan, span)
    // Names as the author wrote them: `::BookingCard` is `booking-card` to Comark.
    const written = component ? markdown.slice(...component.nameSpan) : ''
    const asWritten = (name: string) => (/^[A-Z]/.test(written) ? pascalCase(name) : name)
    const owner = component ? code(written) : 'The frontmatter'
    const type = raw.match(/to (?:parameter of )?type '(.+?)'\.?$/m)?.[1]
    const missing =
      raw.match(/Property '(.+?)' is missing/)?.[1]?.split(', ') ??
      raw.match(/missing the following properties from type '.+': (.+)$/m)?.[1]?.split(', ')

    let message = raw.replace(/`/g, TICK)
    if (slot) {
      const slots = (type ?? 'never') === 'never' ? [] : type!.split(' | ').map((s) => code(`#${s.replace(/"/g, '')}`))
      message = slots.length
        ? `${owner} has no ${code(`#${slot.name}`)} slot. Use ${list(slots)}.`
        : `${owner} has no named slots, so ${code(`#${slot.name}`)} goes nowhere.`
    } else if (nested) {
      const where = component ? code(prop.name) : `${code(prop.name)} in the frontmatter`
      const detail = raw.split('\n').at(-1)!.trim().replace(/`/g, TICK)
      message = `${where} has a value that doesn't match its type. ${detail}`
    } else if (missing) {
      const wanted = list(
        missing.map((p) => code(p)),
        'and'
      )
      message = `${owner} needs ${missing.length === 1 ? `a ${wanted} prop` : `${wanted} props`}.`
    } else if (
      (diagnostic.code === 2339 || diagnostic.code === 2551) &&
      component &&
      contains(component.nameSpan, span)
    ) {
      const guess = raw.match(/Did you mean '(.+)'\?/)?.[1] ?? closest(component.name, names)
      message = `No component is named ${code(written)}.${guess ? ` Did you mean ${code(asWritten(guess))}?` : ''}`
    } else if (diagnostic.code === 2339 || diagnostic.code === 2551) {
      message = `The frontmatter has no ${code(text.split('.').pop()!)}, so this binding is ${code('undefined')}.`
    } else if ((diagnostic.code === 2353 || diagnostic.code === 2561) && prop) {
      const known = Object.keys(components).find((name) => kebabCase(name) === component?.name)
      const props = known ? propNames(components[known]!.props) : []
      const guess = raw.match(/Did you mean to write '(.+)'\?/)?.[1] ?? closest(prop.name, props)
      const hint = guess
        ? ` Did you mean ${code(guess)}?`
        : props.length
          ? ` Its props are ${list(props.map((p) => code(p)))}.`
          : ''
      message = `${owner} has no ${code(prop.name)} prop.${hint}`
    } else if (diagnostic.code === 2322 && prop && type) {
      const where = component ? code(prop.name) : `${code(prop.name)} in the frontmatter`
      const bound = markdown[prop.nameSpan[0] - 1] === ':'
      const value = prop.value.kind === 'literal' ? prop.value.json : undefined
      // `servings="2"` is the string "2"; `:servings="2"` is the number. Only suggest the colon
      // when the text inside the quotes is a value of the type the prop wants.
      const unquoted = value?.startsWith('"') ? parseJson(JSON.parse(value)) : undefined
      const fits = (type === 'number' || type === 'boolean') && typeof unquoted === type
      message =
        component && !bound && fits
          ? `${where} takes ${article(type)}. Write ${code(`:${prop.name}=${value}`)} to pass one.`
          : `${where} takes ${article(type)}, not ${value === undefined ? 'this value' : code(value)}.`
    }
    problems.push({ message, span, code: diagnostic.code })
  }

  return problems.sort((a, b) => a.span[0] - b.span[0])
}

// Each message marks code with backticks, so a backtick in what the author wrote becomes a look-alike.
const TICK = '\u02CB'

function code(text: string) {
  return `\`${text.replace(/`/g, TICK)}\``
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Splits a problem's message at its backticks into text and code, for the panel and the editor's hover. */
export function typeProblemParts(message: string) {
  return message.split('`').map((text, index) => ({ text, code: index % 2 === 1 }))
}

/** The message as Markdown for Monaco's hover, with the author's text escaped so it can't become a link or markup. */
export function typeProblemMarkdown(message: string) {
  return typeProblemParts(message)
    .map(({ text, code }) => (code ? `\`${text}\`` : text.replace(/[\\`*_{}[\]()<>#+!|~-]/g, '\\$&')))
    .join('')
}

function flatten(message: string | MessageChain): string {
  if (typeof message === 'string') return message
  return [message.messageText, ...(message.next ?? []).map(flatten)].join('\n')
}

/** `number` reads better as "a number"; unions, literals, and objects stay as TypeScript writes them, as code. */
function article(type: string) {
  return /^(number|boolean|string)$/.test(type) ? `a ${type}` : code(type)
}

function propNames(props?: string) {
  return [...(props ?? '').matchAll(/^\s*([\w$-]+)\??:/gm)].map(([, name]) => name!)
}

function list(items: string[], last = 'or') {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} ${last} ${items.at(-1)}`
}

function closest(word: string, candidates: string[]) {
  let best: string | undefined
  let bestDistance = Math.max(2, Math.floor(word.length / 3)) + 1
  for (const candidate of candidates) {
    const distance = levenshtein(word, candidate)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

function levenshtein(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]!
}
