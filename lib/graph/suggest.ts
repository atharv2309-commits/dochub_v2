import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { EntityLinkKind } from '@/types/db'

// Same GEMINI_API_KEY pattern as lib/graph/audit.ts and
// app/api/analytics/generate-insights/route.ts.
const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })
const MODEL = 'gemini-2.5-flash'

// No vector DB here on purpose — this project has no Pinecone credentials
// (checked .env.local), and at ~250 pages / a handful of entities per
// project, passing the page text + entity list straight to Gemini in one
// call is simpler and correct. The separate Documentation-revamp pipeline's
// Pinecone corpus isn't reachable from this app (different repo, own creds).
const suggestionSchema = z.object({
  matches: z.array(
    z.object({
      entityName: z.string().describe('Must exactly match one of the given entity names.'),
      kind: z.enum(['text', 'media', 'both']).describe('Does the page depend on this entity via its text, its images, or both?'),
      reason: z.string().describe('One concise sentence: why this page actually relates to this entity.'),
    })
  ),
})

export interface SuggestedLink {
  entityName: string
  kind: EntityLinkKind
  reason: string
}

// Proposes which of a project's existing entities a page relates to. Only
// returns entities the model can articulate a real reason for — same
// discipline as the stale/gap audit not guessing when it isn't sure.
export async function suggestEntityLinks(opts: {
  pageTitle: string
  pageIntro: string[]
  entities: { name: string; description: string | null }[]
}): Promise<SuggestedLink[]> {
  if (opts.entities.length === 0) return []

  const { object } = await generateObject({
    model: google(MODEL),
    schema: suggestionSchema,
    prompt: `You are tagging a documentation page with the product features/UI it depends on, so that when one of those features changes, this page gets flagged for review.

Page title: "${opts.pageTitle}"
Page content:
${opts.pageIntro.join('\n\n') || '(no text content)'}

Candidate entities (only propose entities from this list, using the exact name):
${opts.entities.map((e) => `- "${e.name}"${e.description ? `: ${e.description}` : ''}`).join('\n')}

For each entity this page genuinely depends on, say whether that dependency is through the page's TEXT (it describes/explains the entity), its MEDIA (it shows a screenshot of the entity's UI), or BOTH. Only include an entity if you can give a real, specific reason — if the page just mentions a word in passing with no real dependency, leave it out. If none of the entities apply, return an empty list.`,
  })
  return object.matches
}
