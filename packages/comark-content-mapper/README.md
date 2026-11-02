# @comark/content-mapper

Type-check Comark Markdown with TypeScript 7.1. Component props, slots, and frontmatter are checked against types you declare, by `tsc` and in your editor, with every error at its place in the `.md` file.

```txt
content/mistakes.md(6,9): error TS2322: Type '"warn"' is not assignable to type '"danger" | "info" | "warning"'.
content/mistakes.md(15,2): error TS2345: Argument of type '"sidebar"' is not assignable to parameter of type '"default" | "footer"'.
content/mistakes.md(19,3): error TS2339: Property 'callout' does not exist on type 'ComarkComponents'.
```

It is a [content mapper](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/): TypeScript hands it each `.md` file, and it returns TypeScript that checks the file, with a map back to the Markdown. It doesn't depend on a renderer, so Vue, React, Svelte, Angular, and HTML components can all be checked by the same mapper.

## Setup

Install TypeScript 7.1 and the mapper:

```sh
pnpm add -D typescript@7.1.0-beta @comark/content-mapper
```

Register it for `.md` files in `tsconfig.json`:

```jsonc
{
  "contentMappers": [{ "package": "@comark/content-mapper", "extensions": [".md"] }],
  "include": ["components.ts", "content"],
}
```

Declare your components, their slots, and your frontmatter by augmenting `comark`:

```ts
// components.ts
import type {} from 'comark'
import type { AlertProps } from './components/alert'

declare module 'comark' {
  interface ComarkComponents {
    alert: AlertProps
    card: { title: string; icon?: string }
  }
  interface ComarkComponentSlots {
    card: 'default' | 'footer'
  }
  interface ComarkFrontmatter {
    title: string
  }
}
```

The empty `import type` makes TypeScript load `comark`, which the augmentation needs.

Run the check. TypeScript starts the mapper as a separate process, so it needs `--runExternalCode`:

```sh
tsc --noEmit --runExternalCode
```

## What it checks

- **Components.** A `::name` or `:name` that isn't in `ComarkComponents` is an error. Block names are kebab-cased like Comark does, so `::UButton` is `u-button`.
- **Props.** `key="value"` is a string, `:key="3"` is the JSON value, a bare `key` is `true`, and YAML props are their YAML values, the same values a renderer receives. Missing, unknown, and mistyped props are errors. `.class` and `#id` aren't checked.
- **Bindings.** `:title="frontmatter.title"` is typed from the file's own frontmatter. Bindings to `data`, `meta`, or `props` come from the renderer, so they aren't checked.
- **Slots.** `#name` inside a component must be one of its `ComarkComponentSlots`. A component missing there accepts any slot.
- **Frontmatter.** The file's frontmatter must satisfy `ComarkFrontmatter`. Invalid YAML is reported by the mapper itself.

Fenced code and inline code are skipped, and so is `:smile:`, which is an emoji.

## Limits

- Completion inside a prop value doesn't work yet. Hover and go to definition do, on component names and props.
- When the mapper reports invalid YAML, TypeScript skips type checking until it is fixed, as it does for a syntax error.
- Props are checked as written. A renderer that renames them, like Vue turning `icon-name` into `iconName`, needs the written name in the registry.
