// The translation engine contract. Everything in the pipeline depends ONLY on
// this interface — never on a concrete provider — so swapping Google for DeepL,
// Google Cloud, or Claude later is a single-file change with no ripple effects.

export interface TranslateOptions {
  /** Source language code (BCP-47, e.g. "en"). */
  from: string
  /** Target language code (e.g. "fr"). */
  to: string
}

export interface TranslationEngine {
  /** Stable identifier persisted on translations (e.g. "google-free"). */
  readonly id: string

  /**
   * Translate a batch of independent text segments, preserving order and count:
   * output[i] is the translation of input[i]. Implementations should handle
   * their own batching/throttling/retry internally. Empty strings pass through.
   * A null element means that one segment could not be translated (e.g. a
   * provider partial-failure) — callers fall back to the source text for it
   * rather than failing the whole batch.
   */
  translateBatch(texts: string[], opts: TranslateOptions): Promise<(string | null)[]>
}
