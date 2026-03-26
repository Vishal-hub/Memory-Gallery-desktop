const { embedText } = require('./ai-service');

const SIMILARITY_THRESHOLD = 0.22;
const MAX_RESULTS = 100;

function toFloat32(src) {
  if (!src) return null;
  if (src instanceof Float32Array) return src;
  if (Buffer.isBuffer(src) || src instanceof Uint8Array) {
    if (src.byteLength < 4) return null;
    return new Float32Array(src.buffer, src.byteOffset, src.byteLength / 4);
  }
  return null;
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function searchSemanticVectors(db, textQuery) {
  try {
    const searchBuffer = await embedText(textQuery);
    if (!searchBuffer) return [];

    const queryVec = toFloat32(searchBuffer);
    if (!queryVec) return [];
    const dims = queryVec.length;

    const rows = db.prepare(
      'SELECT path, embedding FROM media_items WHERE embedding IS NOT NULL AND is_missing = 0'
    ).all();

    const results = [];
    let worstKept = -Infinity;

    for (let r = 0; r < rows.length; r++) {
      const rowVec = toFloat32(rows[r].embedding);
      if (!rowVec || rowVec.length !== dims) continue;

      const sim = cosineSimilarity(queryVec, rowVec);
      if (sim <= SIMILARITY_THRESHOLD) continue;

      if (results.length < MAX_RESULTS) {
        results.push({ path: rows[r].path, similarity: sim });
      } else {
        if (sim <= worstKept) continue;
        results.push({ path: rows[r].path, similarity: sim });
      }

      if (results.length >= MAX_RESULTS * 2) {
        results.sort((a, b) => b.similarity - a.similarity);
        results.length = MAX_RESULTS;
        worstKept = results[MAX_RESULTS - 1].similarity;
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    if (results.length > MAX_RESULTS) results.length = MAX_RESULTS;

    return results.map((r) => r.path);
  } catch (error) {
    console.error('Vector Search failed:', error);
    return [];
  }
}

module.exports = { searchSemanticVectors };
