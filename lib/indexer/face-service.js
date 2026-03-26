const { detectFaces, alignFace, embedFace, loadImageAsRGB } = require('./face-models');

/**
 * Detects faces in an image using SCRFD and produces identity embeddings
 * via MobileFaceNet (ArcFace w600k). Returns an array of { box, embedding }
 * where box is [x1, y1, x2, y2] and embedding is a normalized 512-dim Buffer.
 */
async function processFaces(filePath) {
  console.log(`[FaceService] Processing: ${filePath}`);
  try {
    const faces = await detectFaces(filePath, 6);
    console.log(`[FaceService] SCRFD detected ${faces.length} face(s)`);

    if (faces.length === 0) return [];

    const imageData = loadImageAsRGB(filePath);
    if (!imageData) {
      console.error(`[FaceService] Could not load image: ${filePath}`);
      return [];
    }

    const results = [];
    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];
      const [x1, y1, x2, y2] = face.bbox;
      const faceW = x2 - x1;
      const faceH = y2 - y1;

      if (faceW < 50 || faceH < 50) {
        console.log(`[FaceService] Face ${i}: too small (${Math.round(faceW)}x${Math.round(faceH)}), skipping`);
        continue;
      }

      if (!face.landmarks || face.landmarks.length < 5) {
        console.log(`[FaceService] Face ${i}: no landmarks, skipping alignment`);
        continue;
      }

      console.log(`[FaceService] Face ${i}: score=${face.score.toFixed(3)}, bbox=${Math.round(x1)},${Math.round(y1)} ${Math.round(faceW)}x${Math.round(faceH)}`);

      const alignedRgb = alignFace(imageData, face.landmarks);
      if (!alignedRgb) {
        console.log(`[FaceService] Face ${i}: alignment failed, skipping`);
        continue;
      }

      const embedding = await embedFace(alignedRgb);
      if (!embedding) {
        console.log(`[FaceService] Face ${i}: embedding failed`);
        continue;
      }

      results.push({
        box: [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)],
        embedding,
      });
      console.log(`[FaceService] Embedded face ${i} (512 dims, MobileFaceNet)`);
    }

    console.log(`[FaceService] Result: ${results.length} identity fingerprints from ${filePath}`);
    return results;
  } catch (err) {
    console.error(`[FaceService] ERROR for ${filePath}:`, err);
    return [];
  }
}

module.exports = {
  processFaces,
};
