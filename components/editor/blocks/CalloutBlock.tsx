'use client'

import { createReactBlockSpec } from '@blocknote/react'

const CALLOUT_TYPES = ['info', 'warning', 'danger', 'success'] as const
type CalloutType = typeof CALLOUT_TYPES[number]

const CALLOUT_STYLES: Record<CalloutType, { bg: string; border: string; emoji: string }> = {
  info:    { bg: 'bg-blue-500/10',   border: 'border-blue-500/30',   emoji: 'ℹ️' },
  warning: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', emoji: '⚠️' },
  danger:  { bg: 'bg-red-500/10',    border: 'border-red-500/30',    emoji: '🚨' },
  success: { bg: 'bg-green-500/10',  border: 'border-green-500/30',  emoji: '✅' },
}

export const calloutBlockSpec = createReactBlockSpec(
  {
    type: 'callout' as const,
    content: 'inline' as const,
    propSchema: {
      type: {
        default: 'info' as CalloutType,
        values: CALLOUT_TYPES,
      },
    },
  },
  {
    render: ({ block, contentRef, editor }) => {
      const calloutType = block.props.type as CalloutType
      const style = CALLOUT_STYLES[calloutType] ?? CALLOUT_STYLES.info

      return (
        <div className={`flex gap-3 p-4 rounded-lg border my-1 ${style.bg} ${style.border}`}>
          {editor.isEditable ? (
            <select
              value={calloutType}
              onChange={(e) =>
                editor.updateBlock(block, {
                  props: { type: e.target.value as CalloutType },
                })
              }
              className="appearance-none bg-transparent cursor-pointer p-0 border-none outline-none text-base flex-shrink-0 self-start mt-0.5"
              title="Callout type"
            >
              {CALLOUT_TYPES.map((t) => (
                <option key={t} value={t}>{CALLOUT_STYLES[t].emoji} {t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          ) : (
            <span className="flex-shrink-0 self-start mt-0.5">{style.emoji}</span>
          )}
          <div ref={contentRef} className="flex-1 text-sm leading-relaxed min-w-0" />
        </div>
      )
    },
  }
)
