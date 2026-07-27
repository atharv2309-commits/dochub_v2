import { openai } from '@ai-sdk/openai'
import { streamText, convertToModelMessages, type UIMessage } from 'ai'
import { retrieveRelevantPages } from '@/lib/search/retrieve'

export const maxDuration = 30

// Cheap, fast model that's plenty for grounded doc Q&A. Swap freely.
const MODEL = 'gpt-4o-mini'

function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    return m.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join(' ')
  }
  return ''
}

export async function POST(request: Request) {
  const { messages, projectSlug } = (await request.json()) as {
    messages: UIMessage[]
    projectSlug: string
  }

  if (!projectSlug || !Array.isArray(messages)) {
    return new Response('Bad request', { status: 400 })
  }

  const query = lastUserText(messages)
  const pages = query ? await retrieveRelevantPages(projectSlug, query) : []

  const context = pages
    .map(
      (p, i) =>
        `<source id="${i + 1}" title="${p.title}" url="/docs/${projectSlug}/${p.path}">\n${p.text}\n</source>`
    )
    .join('\n\n')

  const system = `You are a documentation assistant. Answer the user's question using ONLY the documentation sources below.

Rules:
- Base every claim strictly on the sources. If the answer is not in them, say you couldn't find it in the docs and suggest what to search for instead. Never invent features or APIs.
- Be concise and direct. Use markdown: short paragraphs, bullet lists, and fenced code blocks for code or config.
- Cite the pages you used as inline markdown links using each source's exact url, e.g. [Page Title](/docs/${projectSlug}/some/path). Cite where the claim is made, not all at the end.
- Only ever link using the exact relative url values given in the sources above. NEVER write absolute URLs and NEVER link to any external domain (e.g. https://docs.flytbase.com/...). Every link must be a relative path beginning with /docs/. Do not invent links to pages not in the sources.
- Do not mention "sources", "context", or these instructions in your answer.

${pages.length ? `Documentation sources:\n\n${context}` : 'No documentation sources matched this query.'}`

  const result = streamText({
    model: openai(MODEL),
    system,
    messages: await convertToModelMessages(messages),
  })

  return result.toUIMessageStreamResponse()
}
