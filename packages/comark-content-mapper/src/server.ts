import { runContentMapper } from 'ts-content-mapper'
import { transform } from './index.ts'

runContentMapper({
  diagnosticSource: 'comark',
  transform: ({ content }, { positionEncoding }) => transform(content, positionEncoding),
})
