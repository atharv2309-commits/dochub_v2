import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { withMultiColumn } from '@blocknote/xl-multi-column'
import { calloutBlockSpec } from './blocks/CalloutBlock'
import { embedBlockSpec } from './blocks/EmbedBlock'

// Base schema with our custom blocks, then wrapped with multi-column support
// (adds `columnList` + `column` blocks for side-by-side layout / grouped images).
export const schema = withMultiColumn(
  BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      callout: calloutBlockSpec(),
      embed: embedBlockSpec(),
    },
  })
)

export type EditorSchema = typeof schema
