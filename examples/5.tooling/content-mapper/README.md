# Type-check Markdown with TypeScript 7.1

`components.ts` declares three components, a slot list, and the frontmatter. `content/guide.md` uses them correctly, and `content/mistakes.md` gets each one wrong.

```sh
pnpm install
pnpm --filter comark --filter @comark/content-mapper run build
pnpm --filter comark-content-mapper-example run check
```

```txt
content/mistakes.md(3,1): error TS2322: Type 'string' is not assignable to type 'boolean | undefined'.
content/mistakes.md(6,9): error TS2322: Type '"warn"' is not assignable to type '"danger" | "info" | "warning"'.
content/mistakes.md(10,3): error TS2741: Property 'type' is missing in type '{}' but required in type 'AlertProps'.
content/mistakes.md(14,33): error TS2353: Object literal may only specify known properties, and 'colour' does not exist in type '{ title: string; icon?: string | undefined; }'.
content/mistakes.md(15,2): error TS2345: Argument of type '"sidebar"' is not assignable to parameter of type '"default" | "footer"'.
content/mistakes.md(19,3): error TS2339: Property 'callout' does not exist on type 'ComarkComponents'.
content/mistakes.md(23,42): error TS2322: Type 'string' is not assignable to type 'number'.
content/mistakes.md(25,41): error TS2339: Property 'subtitle' does not exist on type '{ title: string; draft: string; }'.
```

An editor running the TypeScript 7.1 language server shows the same errors in the `.md` files, plus hover and go to definition on component names and props.
