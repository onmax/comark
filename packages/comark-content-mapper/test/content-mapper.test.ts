import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const tsc = fileURLToPath(new URL('../node_modules/typescript7/bin/tsc', import.meta.url))
const fixture = fileURLToPath(new URL('./fixture', import.meta.url))

async function check(project: string) {
  const result = await promisify(execFile)(process.execPath, [
    tsc,
    '-p',
    `${fixture}/${project}`,
    '--runExternalCode',
  ]).catch((error: { stdout: string }) => error)
  return result.stdout.trim().split('\n')
}

it('reports props, slots, and frontmatter that do not match the registry, at their place in the Markdown', async () => {
  expect(await check('tsconfig.json')).toMatchInlineSnapshot(`
    [
      "test/fixture/invalid.md(2,1): error TS2322: Type 'number' is not assignable to type 'string'.",
      "test/fixture/invalid.md(5,9): error TS2322: Type '"nope"' is not assignable to type '"info" | "warning"'.",
      "test/fixture/invalid.md(8,27): error TS2322: Type 'number' is not assignable to type 'string'.",
      "test/fixture/invalid.md(9,2): error TS2345: Argument of type '"aside"' is not assignable to parameter of type '"default" | "footer"'.",
      "test/fixture/invalid.md(12,19): error TS2322: Type 'string' is not assignable to type 'number'.",
    ]
  `)
}, 60_000)

// TypeScript stops before type checking when a mapper reports a problem, so this one has its own project.
it('reports YAML it cannot read', async () => {
  expect(await check('tsconfig.yaml.json')).toMatchInlineSnapshot(`
    [
      "test/fixture/broken-yaml.md(3,1): error comark1: Invalid YAML: Flow sequence in block collection must be sufficiently indented and end with a ].",
    ]
  `)
}, 60_000)
