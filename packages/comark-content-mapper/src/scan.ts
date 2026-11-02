import { kebabCase } from 'comark/utils'
import { JSON_SCHEMA, load } from 'js-yaml'
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

const RE_BLOCK_OPEN = /^(:{2,})[ \t]*([a-z$][\w$.-]*)/i
const RE_BLOCK_CLOSE = /^(:{2,})\s*$/
const RE_NAME = /^[a-z$][\w$-]*/i
const RE_FENCE = /^(`{3,}|~{3,})/
const RE_YAML_FENCE = /^(`{3}|~{3})ya?ml \[props\]$/
const RE_PROP_NAME = /^:?[a-z_][\w-]*$/i
const RE_FRONTMATTER_PATH = /^frontmatter(\.([a-z_$][\w$]*|\d+))+$/i
// A blockquote's `>` or a list item's marker, which Comark reads blocks inside of.
const RE_CONTAINER = /^(?:>[ \t]?|(?:[-*+]|\d{1,9}[.)])[ \t]+)/
// Mirrors the characters `comark/plugins/components` accepts before an inline `:name`.
const INLINE_PREV = new Set([' ', '\t', '*', '_', '[', ']', '}', ')', '>'])
const BRACKETS: Record<string, string> = { '[': ']', '{': '}', '(': ')' }
const QUOTES = new Set(['"', "'", '`'])

interface Line {
  start: number
  /** Offset of the first character after indentation, `>` markers, and list markers. */
  text: number
  end: number
  /** Columns of indentation before any list marker. */
  indent: number
  /** Whether the line starts a list item. */
  item: boolean
}

/**
 * Finds the components, slots, props, and frontmatter of a Comark document,
 * with their offsets in the source. It reads the same syntax as Comark's
 * parser, but only as far as a type check needs: Markdown in between is skipped.
 */
export function scan(source: string): Scan {
  const lines = splitLines(source)
  const result: Scan = { components: [], problems: [] }
  const stack: { colons: number; component: Component; line: number }[] = []
  let index = 0

  const text = (line: Line) => source.slice(line.text, line.end)

  if (lines.length && /^---\s*$/.test(source.slice(lines[0].start, lines[0].end))) {
    const close = lines.findIndex((line, i) => i > 0 && /^---\s*$/.test(source.slice(line.start, line.end)))
    if (close !== -1) {
      result.frontmatter = readYaml(source, lines[0], lines[close], result.problems, false)
      index = close + 1
    }
  }

  // Inline code can span lines of a paragraph, and four columns of indentation
  // past a blank line are code; neither holds components.
  let previous: 'blank' | 'code' | 'text' = 'blank'
  let listColumn = 0
  let resume = -1

  for (; index < lines.length; index++) {
    const line = lines[index]
    const content = text(line)

    if (line.text === line.end && !line.item) {
      previous = 'blank'
      continue
    }
    if (line.item) listColumn = line.text - line.start
    else if (line.indent < listColumn && previous === 'blank') listColumn = 0
    if (!line.item && line.indent - listColumn >= 4 && previous !== 'text') {
      previous = 'code'
      continue
    }
    previous = 'text'

    if (resume > line.end) continue
    if (resume >= line.start) {
      const found = scanInline(source, resume, line.end, paragraphEnd(source, lines, index), -1)
      result.components.push(...found.components)
      resume = found.resume
      continue
    }

    const yamlFence = stack.length ? content.match(RE_YAML_FENCE) : null
    if (yamlFence) {
      const end = lines.findIndex((l, i) => i > index && text(l) === yamlFence[1])
      if (end !== -1) {
        mergeProps(stack.at(-1)!.component, readYaml(source, line, lines[end], result.problems, true))
        index = end
        continue
      }
    }

    const fence = content.match(RE_FENCE)
    if (fence) {
      index = skipFence(lines, index, fence[1], text)
      previous = 'blank'
      continue
    }

    const top = stack.at(-1)
    if (content.trim() === '---' && top && top.line === index - 1) {
      const end = lines.findIndex((l, i) => i > index && text(l).trim() === '---')
      if (end !== -1) {
        mergeProps(top.component, readYaml(source, line, lines[end], result.problems, true))
        top.line = -1
        index = end
        continue
      }
    }

    const close = content.match(RE_BLOCK_CLOSE)
    if (close) {
      const at = stack.findLastIndex((open) => open.colons === close[1].length)
      if (at !== -1) stack.length = at
      continue
    }

    const open = content.match(RE_BLOCK_OPEN)
    if (open) {
      const nameEnd = line.text + open[0].length
      const nameStart = nameEnd - open[2].length
      const component: Component = {
        name: kebabCase(open[2]),
        nameSpan: [nameStart, nameEnd],
        props: { span: [nameStart, nameEnd], props: [] },
        slots: [],
      }
      const { label, props } = readParams(source, nameEnd, line.end)
      if (label) result.components.push(...scanInline(source, label[0], label[1], label[1], -1).components)
      if (props) component.props = props
      result.components.push(component)
      stack.push({ colons: open[1].length, component, line: index })
      continue
    }

    if (top && content[0] === '#' && content[1] !== ' ' && content[1] !== '#') {
      const name = content.slice(1).match(RE_NAME)?.[0]
      const after = name ? readParams(source, line.text + 1 + name.length, line.end) : undefined
      // `#aside text` is a heading-less paragraph to Comark, not a slot.
      if (name && after?.rest === line.end) {
        const start = line.text + 1
        top.component.slots.push({ name: kebabCase(name), span: [start, start + name.length] })
        continue
      }
    }

    const found = scanInline(source, line.text, line.end, paragraphEnd(source, lines, index), line.text)
    result.components.push(...found.components)
    resume = found.resume
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
    let indent = 0
    let item = false
    for (;;) {
      while (text < lineEnd && (source[text] === ' ' || source[text] === '\t')) {
        if (!item) indent += source[text] === '\t' ? 4 - (indent % 4) : 1
        text++
      }
      const container = source.slice(text, lineEnd).match(RE_CONTAINER)
      if (!container) break
      if (container[0][0] === '>') indent = 0
      else item = true
      text += container[0].length
    }
    lines.push({ start, text, end: lineEnd, indent, item })
    start = end + 1
  }
  return lines
}

/** The end of the paragraph a line starts, where a code span would have to close. */
function paragraphEnd(source: string, lines: Line[], index: number) {
  const blank = lines.findIndex((line, i) => i > index && line.text === line.end)
  return blank === -1 ? source.length : lines[blank].start
}

function skipFence(lines: Line[], index: number, marker: string, text: (line: Line) => string) {
  const closer = new RegExp(`^\\${marker[0]}{${marker.length},}\\s*$`)
  for (let i = index + 1; i < lines.length; i++) {
    if (closer.test(text(lines[i]))) return i
  }
  return lines.length
}

/**
 * Finds inline components between `from` and `to`. `lineStart` is where the
 * line starts, so a component alone on it reads as Comark's block shorthand.
 * Returns where scanning should resume when a code span runs past `to`.
 */
function scanInline(source: string, from: number, to: number, paragraph: number, lineStart: number) {
  const components: Component[] = []
  let at = from
  while (at < to) {
    const char = source[at]
    if (char === '\\') {
      at += 2
      continue
    }
    if (char === '`') {
      const ticks = source.slice(at).match(/^`+/)![0]
      const close = findTicks(source, ticks, at + ticks.length, paragraph)
      if (close === -1) {
        at += ticks.length
        continue
      }
      at = close + ticks.length
      if (at > to) return { components, resume: at }
      continue
    }
    if (char !== ':' || (at > from && !INLINE_PREV.has(source[at - 1]))) {
      at++
      continue
    }
    const name = source.slice(at + 1, to).match(RE_NAME)?.[0]
    const nameStart = at + 1
    const nameEnd = nameStart + (name?.length ?? 0)
    // `:smile:` is an emoji shortcode, not a component.
    if (!name || source[nameEnd] === ':') {
      at++
      continue
    }
    // Alone on its line, `:name` is Comark's block shorthand, which allows spaces like `::name` does.
    const block = readParams(source, nameEnd, to)
    const shorthand = at === lineStart && block.rest === to
    const { label, props } = shorthand ? block : readParams(source, nameEnd, to, false)
    const component: Component = {
      name: shorthand ? kebabCase(name) : name,
      nameSpan: [nameStart, nameEnd],
      props: props ?? { span: [nameStart, nameEnd], props: [] },
      slots: [],
    }
    components.push(component)
    if (label) components.push(...scanInline(source, label[0], label[1], label[1], -1).components)
    at = props ? props.span[1] : label ? label[1] + 1 : nameEnd
  }
  return { components, resume: -1 }
}

/** Finds a run of exactly `ticks` backticks, the closer of a code span. */
function findTicks(source: string, ticks: string, from: number, end: number) {
  for (let at = source.indexOf(ticks, from); at !== -1 && at < end; at = source.indexOf(ticks, at + 1)) {
    const after = at + ticks.length
    if (source[at - 1] !== '`' && source[after] !== '`') return at
    while (source[at + 1] === '`') at++
  }
  return -1
}

/**
 * Reads what follows a component's name: an optional `[label]` and `{props}`.
 * Block params allow spaces between them, as `parseBlockParams` trims; inline
 * ones don't. `rest` is the offset after them and any trailing spaces.
 */
function readParams(source: string, at: number, end: number, spaced = true) {
  const skip = () => {
    if (spaced) while (at < end && (source[at] === ' ' || source[at] === '\t')) at++
  }
  let label: Span | undefined
  let props: Props | undefined
  skip()
  if (source[at] === '[') {
    const close = closeBracket(source, at, end)
    if (close !== -1) {
      label = [at + 1, close]
      at = close + 1
      skip()
    }
  }
  if (source[at] === '{' && source[at + 1] !== '{') {
    props = readProps(source, at, end)
    at = props.span[1]
  }
  while (at < end && (source[at] === ' ' || source[at] === '\t')) at++
  return { label, props, rest: at }
}

/** The offset of the `]` that closes the `[` at `at`, or -1. */
function closeBracket(source: string, at: number, end: number) {
  let depth = 0
  for (let i = at; i < end; i++) {
    if (source[i] === '\\') i++
    else if (source[i] === '[') depth++
    else if (source[i] === ']' && --depth === 0) return i
  }
  return -1
}

/** Reads `{key="value" :bound="1" flag .class #id}` like `searchProps` in `comark/internal/parse/syntax/props`, keeping offsets. */
function readProps(source: string, open: number, end: number): Props {
  const props: Prop[] = []
  let at = open + 1

  // `searchUntil`: up to a stop character, past escapes, and past balanced brackets when asked.
  const until = (stops: string, brackets = false) => {
    while (at < end) {
      at++
      if (source[at] === '\\') at += 2
      if (brackets && BRACKETS[source[at]]) {
        const from = at
        if (bracket(BRACKETS[source[at]])) continue
        at = from
      }
      if (stops.includes(source[at])) break
    }
  }
  const bracket = (close: string): boolean => {
    while (at < end) {
      at++
      if (QUOTES.has(source[at])) until(source[at])
      else if (BRACKETS[source[at]]) {
        if (!bracket(BRACKETS[source[at]])) return false
      } else if (source[at] === close) return true
    }
    return false
  }

  while (at < end) {
    const char = source[at]
    if (char === '\\') at += 2
    else if (char === '}') {
      at++
      break
    } else if (char === ' ') at++
    else if (char === '.') until(' #.}', true)
    else if (char === '#') until(' #.}')
    else {
      const nameStart = at
      while (at < end && !' }='.includes(source[++at]));
      const name = source.slice(nameStart, at).trim()
      const nameSpan: Span = [nameStart + (name.startsWith(':') ? 1 : 0), nameStart + name.length]
      let value: PropValue = { kind: 'literal', json: 'true' }
      let valueSpan = nameSpan
      if (source[at] === '=') {
        const valueStart = ++at
        if (BRACKETS[source[at]]) {
          bracket(BRACKETS[source[at]])
          at++
        } else if (QUOTES.has(source[at])) {
          until(source[at])
          at++
        } else {
          at--
          until(' }')
        }
        valueSpan = [valueStart, Math.min(at, end)]
        value = toValue(name.startsWith(':'), source.slice(...valueSpan), valueStart)
      }
      if (RE_PROP_NAME.test(name)) setProp(props, { name: name.replace(/^:/, ''), nameSpan, value, valueSpan })
    }
  }
  return { span: [open, Math.min(at, end)], props }
}

/** Sets a prop the way repeated attributes do in Comark: the last one wins. */
function setProp(props: Prop[], prop: Prop) {
  const existing = props.findIndex((p) => p.name === prop.name)
  if (existing !== -1) props.splice(existing, 1)
  props.push(prop)
}

/** Adds YAML props to a component's inline ones, overwriting those with the same name. */
function mergeProps(component: Component, yaml: Props) {
  const hasInline = component.props.span !== component.nameSpan && component.props.props.length
  for (const prop of yaml.props) setProp(component.props.props, prop)
  if (!hasInline) component.props.span = yaml.span
}

function toValue(bound: boolean, raw: string, start: number): PropValue {
  const quoted = raw.length > 1 && QUOTES.has(raw[0]) && raw.at(-1) === raw[0]
  const text = quoted ? raw.slice(1, -1) : raw
  // Comark's `processAttributes` reads an unbound `{…}` or `[…]` as JSON too.
  if (!bound && !/^(\{[\s\S]*\}|\[[\s\S]*\])$/.test(text)) return { kind: 'literal', json: JSON.stringify(text) }
  try {
    return { kind: 'literal', json: JSON.stringify(JSON.parse(text)) }
  } catch {
    if (!bound) return { kind: 'literal', json: JSON.stringify(text) }
    if (!RE_FRONTMATTER_PATH.test(text)) return { kind: 'unknown' }
    const from = start + (quoted ? 1 : 0)
    return { kind: 'frontmatter', span: [from, from + text.length] }
  }
}

/**
 * Reads the YAML between two delimiter lines as props, mapping each key and value back to the source.
 * Values come from js-yaml's JSON schema, as Comark reads them; `yaml` only gives the offsets.
 */
function readYaml(source: string, open: Line, close: Line, problems: Problem[], component: boolean): Props {
  const start = open.end + 1
  const yaml = source.slice(start, close.start)
  const doc = parseDocument(yaml)
  const props: Prop[] = []
  const span: Span = [open.text, close.end]

  for (const error of doc.errors) {
    problems.push({
      message: `Invalid YAML: ${error.message.split(' at line ')[0]}.`,
      span: [start + error.pos[0], start + error.pos[1]],
      code: 1,
    })
  }
  let values: Record<string, unknown>
  try {
    values = (load(yaml, { schema: JSON_SCHEMA }) ?? {}) as Record<string, unknown>
  } catch (error) {
    const { reason, mark } = error as { reason?: string; mark?: { position: number } }
    const at = start + (mark?.position ?? 0)
    if (!doc.errors.length) problems.push({ message: `Invalid YAML: ${reason}.`, span: [at, at], code: 1 })
    return { span, props }
  }

  if (isMap(doc.contents)) {
    for (const pair of doc.contents.items) {
      if (!isScalar(pair.key) || !pair.key.range) continue
      const key = String(pair.key.value)
      const nameSpan: Span = [start + pair.key.range[0], start + pair.key.range[1]]
      const range = (pair.value as { range?: [number, number, number] } | null)?.range
      const valueSpan: Span = range ? [start + range[0], start + range[1]] : nameSpan
      const value = values[key]
      // A component's `:key: frontmatter.x` is a binding, as `:key="frontmatter.x"` is inline.
      if (component && key.startsWith(':')) {
        if (typeof value !== 'string') continue
        const name = key.slice(1)
        setProp(props, {
          name,
          nameSpan: [nameSpan[0] + 1, nameSpan[1]],
          value: toValue(true, source.slice(...valueSpan), valueSpan[0]),
          valueSpan,
        })
        continue
      }
      let json: string | undefined
      try {
        json = JSON.stringify(value ?? null)
      } catch {}
      setProp(props, {
        name: key,
        nameSpan,
        value: json === undefined ? { kind: 'unknown' } : { kind: 'literal', json },
        valueSpan,
      })
    }
  }

  return { span, props }
}
