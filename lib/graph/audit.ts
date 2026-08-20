import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { EntityLinkStatus } from '@/types/db'

// Same GEMINI_API_KEY pattern as app/api/analytics/generate-insights/route.ts
// — @ai-sdk/google's default export reads the wrong env var name.
const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })
const MODEL = 'gemini-2.5-flash'

// A page with a dozen screenshots shouldn't balloon one Gemini call.
const MAX_CANDIDATE_IMAGES = 5

const verdictSchema = z.object({
  status: z.enum(['ok', 'stale', 'gap']),
  note: z.string().describe('One concise sentence explaining the verdict.'),
})

export interface AuditVerdict {
  status: EntityLinkStatus
  note: string
}

// Classifies whether a page's images still reflect an entity's current
// state. Two short-circuits avoid an API call entirely where the answer is
// already deterministic: no images at all is the literal "missing
// screenshot" case (a release note that should show the new UI and simply
// doesn't); no reference image means there's nothing to compare against, so
// don't penalize the page for an incomplete entity.
export async function auditPageAgainstEntity(opts: {
  entityName: string
  changeNote: string | null
  referenceImageUrl: string | null
  candidateImageUrls: string[]
}): Promise<AuditVerdict> {
  const candidates = opts.candidateImageUrls.slice(0, MAX_CANDIDATE_IMAGES)

  if (candidates.length === 0) {
    return { status: 'gap', note: 'This page has no images at all, so it cannot show the current UI.' }
  }
  if (!opts.referenceImageUrl) {
    return { status: 'ok', note: 'No reference image set for this entity — visual audit skipped.' }
  }

  const { object } = await generateObject({
    model: google(MODEL),
    schema: verdictSchema,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `You are auditing documentation screenshots for staleness after a product UI change.

Entity: "${opts.entityName}"
Change description: "${opts.changeNote ?? '(no description provided)'}"

The first image is the CURRENT/reference screenshot showing what the UI looks like now. The remaining image(s) are from a documentation page that is supposed to depict this same feature/UI.

Classify the documentation page's images as:
- "ok": at least one of them matches the current UI shown in the reference image
- "stale": they show the SAME feature but an outdated/different version of the UI
- "gap": none of them show this feature/UI at all (wrong content, unrelated screenshots)

Respond with your verdict and a one-sentence note explaining what you see.`,
          },
          { type: 'image', image: new URL(opts.referenceImageUrl) },
          ...candidates.map((url) => ({ type: 'image' as const, image: new URL(url) })),
        ],
      },
    ],
  })
  return object
}
