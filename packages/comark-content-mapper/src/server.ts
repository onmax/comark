import { runContentMapper } from 'ts-content-mapper'
import { transform } from './index.ts'

runContentMapper({
  diagnosticSource: 'comark',
  // `transform` works in JavaScript string offsets.
  positionEncoding: 'utf-16',
  transform: ({ content }) => {
    const { text, mappings, problems } = transform(content)
    return {
      text,
      extension: '.ts',
      mappings,
      diagnostics: problems.map(({ message, span, code }) => ({
        messageText: message,
        start: span[0],
        length: span[1] - span[0],
        code,
      })),
    }
  },
})
