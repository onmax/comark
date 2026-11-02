<script setup lang="ts">
import loader from '@monaco-editor/loader'
import { language as mdc } from '@nuxtlabs/monarch-mdc'
import { transform } from '@comark/content-mapper'
import type { Span } from '@comark/content-mapper'
import { useDebounceFn } from '@vueuse/core'
import { comarkRegistryDeclaration, describeTypeProblems } from '~/utils/typecheck'
import type { ComponentTypes, TypeProblem } from '~/utils/typecheck'

const {
  language = 'mdc',
  readOnly = false,
  components,
} = defineProps<{
  language?: string
  readOnly?: boolean
  /** Type-checks the Markdown against these components and marks what doesn't match. */
  components?: Record<string, ComponentTypes>
}>()

const emit = defineEmits<{
  problems: [problems: (TypeProblem & { line: number })[]]
}>()

const model = defineModel<string>({
  type: String,
  required: true,
})

const editorContainer = useTemplateRef('editorContainer')
let editor: any = null
let monaco: any | null = null
const colorMode = useColorMode()
const CUSTOM_DARK_THEME = 'comark-dark'
const theme = computed<string>(() => (colorMode.value === 'dark' ? CUSTOM_DARK_THEME : 'vs-light'))
const loaded = ref(false)

function defineComarkDarkTheme(monaco: any): void {
  monaco.editor.defineTheme(CUSTOM_DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0a0a0a',
      'editor.foreground': '#e5e5e5',
      'editor.lineHighlightBackground': '#17171700',
      'editor.lineHighlightBorder': '#ffffff08',
      'editor.selectionBackground': '#404040',
      'editor.inactiveSelectionBackground': '#26262680',
      'editorLineNumber.foreground': '#525252',
      'editorLineNumber.activeForeground': '#a3a3a3',
      'editorCursor.foreground': '#facc15',
      'editorIndentGuide.background': '#262626',
      'editorIndentGuide.activeBackground': '#404040',
      'editor.selectionHighlightBackground': '#26262680',
      'editorBracketMatch.background': '#40404040',
      'editorBracketMatch.border': '#525252',
      'editorWidget.background': '#0a0a0a',
      'editorWidget.border': '#171717',
      'editorSuggestWidget.background': '#0a0a0a',
      'editorSuggestWidget.border': '#171717',
      'editorSuggestWidget.selectedBackground': '#262626',
      'textCodeBlock.background': '#262626',
      'input.background': '#171717',
      'input.border': '#262626',
      'scrollbarSlider.background': '#26262680',
      'scrollbarSlider.hoverBackground': '#404040',
      'scrollbarSlider.activeBackground': '#525252',
    },
  })
}

onMounted(async () => {
  monaco = await loader.init()

  // Register the MDC language
  monaco.languages.register({ id: 'mdc' })
  monaco.languages.setMonarchTokensProvider('mdc', mdc)

  // Prime worker-backed languages so fenced blocks (json / json-render) can embed them
  monaco.editor.createModel('', 'json').dispose()

  // Define custom dark theme matching the website
  defineComarkDarkTheme(monaco)

  editor = monaco.editor.create(editorContainer.value, {
    value: model.value,
    language: language,
    theme: theme.value,
    automaticLayout: true,
    // The pane clips its overflow, which would cut hovers and suggestions off at its edge.
    fixedOverflowWidgets: true,
    readOnly: readOnly,
    minimap: {
      enabled: false,
    },
    fontSize: 14,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    roundedSelection: false,
    padding: {
      top: 8,
    },
    bracketPairColorization: {
      enabled: true,
    },
    formatOnPaste: true,
    formatOnType: true,
  })

  editor.onDidChangeModelContent(() => {
    model.value = editor.getValue()
    if (components) checkDebounced()
  })

  monaco.editor.setTheme(theme.value)
  loaded.value = true

  if (components) startTypecheck(components)
})

onBeforeUnmount(() => {
  editor?.dispose()
  typecheckDisposables.forEach((disposable) => disposable.dispose())
})

// The mapper turns the Markdown into TypeScript in a hidden model, Monaco's
// TypeScript worker checks it, and the problems are mapped back as markers.
const typecheckDisposables: { dispose: () => void }[] = []
let virtualModel: any = null
let problemDecorations: any = null
let highlightDecorations: any = null
let checkVersion = 0

function startTypecheck(types: Record<string, ComponentTypes>) {
  const ts = monaco.typescript
  ts.typescriptDefaults.setCompilerOptions({
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    lib: ['esnext'],
  })
  typecheckDisposables.push(
    ts.typescriptDefaults.addExtraLib(comarkRegistryDeclaration(types), 'file:///comark-registry.d.ts')
  )
  virtualModel = monaco.editor.createModel('', 'typescript', monaco.Uri.parse('file:///comark-document.ts'))
  typecheckDisposables.push(virtualModel)
  problemDecorations = editor.createDecorationsCollection()
  highlightDecorations = editor.createDecorationsCollection()
  check()
}

async function check() {
  if (!editor || !virtualModel || !components) return
  const version = ++checkVersion
  const markdown = editor.getValue()
  const mapped = transform(markdown)
  virtualModel.setValue(mapped.text)

  const worker = await (await monaco.typescript.getTypeScriptWorker())(virtualModel.uri)
  const uri = virtualModel.uri.toString()
  const diagnostics = [...(await worker.getSyntacticDiagnostics(uri)), ...(await worker.getSemanticDiagnostics(uri))]
  if (version !== checkVersion) return

  const markdownModel = editor.getModel()
  const problems = describeTypeProblems(markdown, mapped, diagnostics, components)
  // Decorations rather than markers: a marker's hover is plain text, and a decoration's
  // is Markdown, so the names and values in each message show as code.
  problemDecorations.set(
    problems.map((problem) => ({
      range: squiggleRange(problem.span),
      options: {
        className: 'squiggly-error',
        hoverMessage: { value: problem.message },
        overviewRuler: {
          color: { id: 'editorOverviewRuler.errorForeground' },
          position: monaco.editor.OverviewRulerLane.Right,
        },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    }))
  )
  highlightDecorations.clear()
  emit(
    'problems',
    problems.map((problem) => ({ ...problem, line: markdownModel.getPositionAt(problem.span[0]).lineNumber }))
  )
}

const checkDebounced = useDebounceFn(check, 300)

function toRange([start, end]: Span) {
  const model = editor.getModel()
  const from = model.getPositionAt(start)
  const to = model.getPositionAt(end)
  return {
    startLineNumber: from.lineNumber,
    startColumn: from.column,
    endLineNumber: to.lineNumber,
    endColumn: to.column,
  }
}

// A span with nothing in it, like the props of `::alert` written without any, would draw
// no squiggle, so it marks the word it touches, as Monaco does for markers.
function squiggleRange(span: Span) {
  const range = toRange(span)
  if (span[0] !== span[1]) return range
  const model = editor.getModel()
  const position = model.getPositionAt(span[0])
  const word = model.getWordAtPosition(position) ?? model.getWordAtPosition(model.getPositionAt(span[0] - 1))
  if (!word) return { ...range, endColumn: range.startColumn + 1 }
  return { ...range, startColumn: word.startColumn, endColumn: word.endColumn }
}

watch(model, (newCode) => {
  if (editor && editor.getValue() !== newCode) {
    editor.setValue(newCode)
  }
})

watch(
  () => language,
  (newLanguage) => {
    if (monaco && editor) {
      const model = editor.getModel()
      if (model) {
        monaco.editor.setModelLanguage(model, newLanguage === 'vue' ? 'mdc' : newLanguage)
      }
    }
  }
)

watch(theme, (newTheme) => {
  if (monaco) {
    monaco.editor.setTheme(newTheme)
  }
})

defineExpose({
  /** Selects a span of the Markdown and scrolls it into view. */
  reveal(span: Span) {
    if (!editor) return
    const range = toRange(span)
    editor.setSelection(range)
    editor.revealRangeInCenterIfOutsideViewport(range)
    editor.focus()
  },
  /** Highlights a span of the Markdown, or clears the highlight. */
  highlight(span?: Span) {
    highlightDecorations?.set(
      span ? [{ range: squiggleRange(span), options: { className: 'comark-problem-highlight' } }] : []
    )
  },
  scrollToBottom() {
    if (!editor) return
    const lineCount = editor.getModel()?.getLineCount() ?? 1
    editor.revealLine(lineCount)
  },
})
</script>

<template>
  <div class="relative h-full w-full bg-white dark:bg-[#0a0a0a]">
    <div
      v-if="!loaded"
      class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-6 animate-spin text-primary"
      />
      <span class="text-sm">Loading editor...</span>
    </div>
    <div
      ref="editorContainer"
      class="h-full w-full"
    />
  </div>
</template>

<style>
.comark-problem-highlight {
  background: color-mix(in oklch, var(--ui-error) 30%, transparent);
  border-radius: 2px;
}
</style>
