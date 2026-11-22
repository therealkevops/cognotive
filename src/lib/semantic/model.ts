/** The embedding model: BGE small (English), 8-bit, served from /models (see scripts/fetch-semantic-assets.mjs). */
export const MODEL_NAME = "Xenova/bge-small-en-v1.5";
export const MODEL_ID = "bge-small-en-v1.5-q8";
/** BGE expects queries (not passages) to start with this. */
export const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
/** About what a first download costs: the model and the runtime. */
export const DOWNLOAD_MB = 48;
/**
 * Below this, a passage that only matches by meaning isn't related enough to
 * show. Unrelated text scores around 0.45 to 0.55 with this model.
 */
export const MIN_SCORE = 0.58;
