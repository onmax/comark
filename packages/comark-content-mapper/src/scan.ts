import { kebabCase } from 'comark/utils'
import { isMap, isScalar, parseDocument } from 'yaml'

/** `[start, end)` offsets into the Markdown source. */
export type Span = [start: number, end: number]

export type PropValue =
  /** A JavaScript literal, as JSON. */
  | { kind: 'literal'; json: string }
  /** `:prop="frontmatter.a.b"`: a binding the renderer reads from this file's frontmatter. */
  | { kind: 'frontmatter'; span: Span }
  /** A binding to render data the file can't see, such as `data.user`. */
  | { kind: 'unknown' }

export interface Prop {
  name: string
  nameSpan: Span
  value: PropValue
  valueSpan: Span
}

export interface Props {
  /** The `{...}` or YAML block the props came from, or the component name when there are none. */
  span: Span
  props: Prop[]
}

export interface Component {
  /** The tag Comark gives the node: block names are kebab-cased, inline names kept. */
  name: string
  nameSpan: Span
  props: Props
  slots: { name: string; span: Span }[]
}

export interface Problem {
  message: string
  span: Span
  code: number
}

export interface Scan {
  frontmatter?: Props
  components: Component[]
  problems: Problem[]
}

const RE_BLOCK_OPEN = /^(:{2,})([a-z$][\w$.-]*)/i
const RE_BLOCK_CLOSE = /^(:{2,})\s*$/
const RE_SLOT = /^#([a-z$][\w$-]*)/i
const RE_FENCE = /^(`{3,}|~{3,})/
const RE_YAML_PROPS = /^(---|(`{3,}|~{3,})ya?ml \[props\])\s*$/
const RE_PROP_NAME = /^:?[a-z_][\w-]*$/i
const RE_FRONTMATTER_PATH = /^frontmatter(\.[a-z_$][\w$]*)+$/i
// Mirrors the characters `comark/plugins/components` accepts before an inline `:name`.
const INLINE_PREV = new Set([' ', '\t', '*', '_', '[', ']', '}', ')', '>'])

interface Line {
  start: number
  /** Offset of the first non-space character. */
  text: number
  end: number
}

/**
 * Finds the components, slots, props, and frontmatter of a Comark document,
 * with their offsets in the source. It reads the same syntax as Comark's
 * parser, but only as far as a type check needs: Markdown in between is skipped.
 */
export function scan(source: string): Scan {
  const lines = splitLines(source)
  const result: Scan = { components: [], problems: [] }
  const stack: { colons: number; component: Component }[] = []
  let index = 0

  const text = (line: Line) => source.slice(line.text, line.end)

  if (lines.length && /^---\s*$/.test(text(lines[0]))) {
    const close = lines.findIndex((line, i) => i > 0 && /^---\s*$/.test(text(line)))
    if (close !== -1) {
      result.frontmatter = readYaml(source, lines[0], lines[close], result.problems)
      index = close + 1
    }
  }

  for (; index < lines.length; index++) {
    const line = lines[index]
    const content = text(line)

    const fence = content.match(RE_FENCE)
    if (fence) {
      index = skipFence(lines, index, fence[1], text)
      continue
    }

    const close = content.match(RE_BLOCK_CLOSE)
    if (close) {
      const at = stack.findLastIndex((open) => open.colons === close[1].length)
      if (at !== -1) stack.length = at
      continue
    }

    const open = content.match(RE_BLOCK_OPEN)
    if (open) {
      const nameStart = line.text + open[1].length
      const nameEnd = nameStart + open[2].length
      const component: Component = {
        name: kebabCase(open[2]),
        nameSpan: [nameStart, nameEnd],
        props: { span: [nameStart, nameEnd], props: [] },
        slots: [],
      }
      let at = skipBrackets(source, nameEnd, line.end)
      if (source[at] === '{') component.props = readProps(source, at, line.end)

      const next = lines[index + 1]
      const yaml = next && text(next).match(RE_YAML_PROPS)
      if (yaml) {
        const closer = yaml[2] ?? '---'
        const end = lines.findIndex((l, i) => i > index + 1 && text(l).startsWith(closer) && text(l).trim() === closer)
        if (end !== -1) {
          component.props = readYaml(source, next, lines[end], result.problems)
          index = end
        }
      }

      result.components.push(component)
      stack.push({ colons: open[1].length, component })
      continue
    }

    const slot = content.match(RE_SLOT)
    if (slot && stack.length) {
      const start = line.text + 1
      stack.at(-1)!.component.slots.push({ name: slot[1], span: [start, start + slot[1].length] })
      continue
    }

    result.components.push(...scanInline(source, line))
  }

  return result
}

function splitLines(source: string): Line[] {
  const lines: Line[] = []
  let start = 0
  while (start <= source.length) {
    let end = source.indexOf('\n', start)
    if (end === -1) end = source.length
    const lineEnd = source[end - 1] === '\r' ? end - 1 : end
    let text = start
    while (text < lineEnd && (source[text] === ' ' || source[text] === '\t')) text++
    lines.push({ start, text, end: lineEnd })
    start = end + 1
  }
  return lines
}

function skipFence(lines: Line[], index: number, marker: string, text: (line: Line) => string) {
  for (let i = index + 1; i < lines.length; i++) {
    const content = text(lines[i])
    if (content.startsWith(marker[0].repeat(marker.length)) && content.replace(/[`~]/g, '').trim() === '') return i
  }
  return lines.length
}

function scanInline(source: string, line: Line): Component[] {
  const components: Component[] = []
  let at = line.text
  while (at < line.end) {
    const char = source[at]
    if (char === '`') {
      const ticks = source.slice(at).match(/^`+/)![0]
      const close = source.indexOf(ticks, at + ticks.length)
      if (close === -1 || close > line.end) break
      at = close + ticks.length
      continue
    }
    if (char !== ':' || (at > line.text && !INLINE_PREV.has(source[at - 1]))) {
      at++
      continue
    }
    const name = source.slice(at + 1, line.end).match(/^[a-z$][\w$-]*/i)?.[0]
    const nameStart = at + 1
    const nameEnd = nameStart + (name?.length ?? 0)
    // `:smile:` is an emoji shortcode, not a component.
    if (!name || source[nameEnd] === ':') {
      at++
      continue
    }
    const component: Component = {
      name,
      nameSpan: [nameStart, nameEnd],
      props: { span: [nameStart, nameEnd], props: [] },
      slots: [],
    }
    at = skipBrackets(source, nameEnd, line.end)
    if (source[at] === '{' && source[at + 1] !== '{') {
      component.props = readProps(source, at, line.end)
      at = component.props.span[1]
    }
    components.push(component)
  }
  return components
}

/** Skips a `[label]` at `at`, returning the offset after it. */
function skipBrackets(source: string, at: number, end: number) {
  if (source[at] !== '[') return at
  let depth = 0
  for (let i = at; i < end; i++) {
    if (source[i] === '\\') i++
    else if (source[i] === '[') depth++
    else if (source[i] === ']' && --depth === 0) return i + 1
  }
  return at
}

/** Reads `{key="value" :bound="1" flag .class #id}` like `comark/internal/parse/syntax/props`, keeping offsets. */
function readProps(source: string, open: number, end: number): Props {
  const props: Prop[] = []
  let at = open + 1
  while (at < end && source[at] !== '}') {
    const char = source[at]
    if (char === ' ' || char === '\t') {
      at++
    } else if (char === '\\') {
      at += 2
    } else if (char === '.' || char === '#') {
      at = until(source, at + 1, end, ' }')
    } else {
      const nameStart = at
      at = until(source, at, end, ' }=')
      const name = source.slice(nameStart, at)
      const nameSpan: Span = [nameStart + (name.startsWith(':') ? 1 : 0), at]
      let value: PropValue = { kind: 'literal', json: 'true' }
      let valueSpan: Span = nameSpan
      if (source[at] === '=') {
        const valueStart = at + 1
        at = readValue(source, valueStart, end)
        valueSpan = [valueStart, at]
        value = toValue(name.startsWith(':'), source.slice(valueStart, at), valueStart)
      }
      if (RE_PROP_NAME.test(name)) props.push({ name: name.replace(/^:/, ''), nameSpan, value, valueSpan })
    }
  }
  return { span: [open, Math.min(at + 1, end)], props }
}

function until(source: string, at: number, end: number, stops: string) {
  while (at < end && !stops.includes(source[at])) at++
  return at
}

function readValue(source: string, at: number, end: number) {
  const quote = source[at]
  if (quote === '"' || quote === "'" || quote === '`') {
    const close = source.indexOf(quote, at + 1)
    return close === -1 || close >= end ? end : close + 1
  }
  if (quote === '[' || quote === '{') {
    const pairs: Record<string, string> = { '[': ']', '{': '}' }
    const stack: string[] = []
    for (let i = at; i < end; i++) {
      if (source[i] === '"' || source[i] === "'") i = Math.max(source.indexOf(source[i], i + 1), i)
      else if (pairs[source[i]]) stack.push(pairs[source[i]])
      else if (source[i] === stack.at(-1) && (stack.pop(), !stack.length)) return i + 1
    }
    return end
  }
  return until(source, at, end, ' }')
}

function toValue(bound: boolean, raw: string, start: number): PropValue {
  const quoted = /^(['"`]).*\1$/s.test(raw)
  const text = quoted ? raw.slice(1, -1) : raw
  if (!bound) return { kind: 'literal', json: JSON.stringify(text) }
  try {
    return { kind: 'literal', json: JSON.stringify(JSON.parse(text)) }
  } catch {
    if (!RE_FRONTMATTER_PATH.test(text)) return { kind: 'unknown' }
    const from = start + (quoted ? 1 : 0)
    return { kind: 'frontmatter', span: [from, from + text.length] }
  }
}

/** Reads the YAML between two delimiter lines as props, mapping each key and value back to the source. */
function readYaml(source: string, open: Line, close: Line, problems: Problem[]): Props {
  const start = open.end + 1
  const doc = parseDocument(source.slice(start, close.start))
  const props: Prop[] = []

  for (const error of doc.errors) {
    problems.push({
      message: `Invalid YAML: ${error.message.split(' at line ')[0]}.`,
      span: [start + error.pos[0], start + error.pos[1]],
      code: 1,
    })
  }

  if (isMap(doc.contents)) {
    const values = doc.toJS() as Record<string, unknown>
    for (const pair of doc.contents.items) {
      if (!isScalar(pair.key) || !pair.key.range) continue
      const nameSpan: Span = [start + pair.key.range[0], start + pair.key.range[1]]
      const range = (pair.value as { range?: [number, number, number] } | null)?.range
      const valueSpan: Span = range ? [start + range[0], start + range[1]] : nameSpan
      const json = JSON.stringify(values[String(pair.key.value)] ?? null)
      props.push({ name: String(pair.key.value), nameSpan, value: { kind: 'literal', json }, valueSpan })
    }
  }

  return { span: [open.text, close.end], props }
}
