// Browser-only refinement for the alpha mask returned by IMG.LY.
// RGB stays crisp; each tile is processed at the actual preview/export resolution.
const TILE_SIZE = 512;
const MAX_BLUR_RADIUS = 3.2;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function boxBlur(alpha, width, height, radius) {
  if (!radius) return alpha;
  const horizontal = new Uint8Array(alpha.length);
  const output = new Uint8Array(alpha.length);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    const firstEnd = Math.min(width - 1, radius);
    for (let x = 0; x <= firstEnd; x++) sum += alpha[row + x];
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      horizontal[row + x] = Math.round(sum / (right - left + 1));
      const removeX = x - radius;
      const addX = x + radius + 1;
      if (removeX >= 0) sum -= alpha[row + removeX];
      if (addX < width) sum += alpha[row + addX];
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    const firstEnd = Math.min(height - 1, radius);
    for (let y = 0; y <= firstEnd; y++) sum += horizontal[y * width + x];
    for (let y = 0; y < height; y++) {
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height - 1, y + radius);
      output[y * width + x] = Math.round(sum / (bottom - top + 1));
      const removeY = y - radius;
      const addY = y + radius + 1;
      if (removeY >= 0) sum -= horizontal[removeY * width + x];
      if (addY < height) sum += horizontal[addY * width + x];
    }
  }
  return output;
}

function smoothAlpha(alpha, width, height, amount) {
  if (amount <= 0) return alpha;
  const lowerRadius = Math.floor(amount);
  const upperRadius = Math.ceil(amount);
  const fraction = amount - lowerRadius;
  const lower = boxBlur(alpha, width, height, lowerRadius);
  if (fraction === 0) return lower;
  const upper = boxBlur(alpha, width, height, upperRadius);
  const blended = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) blended[i] = Math.round(lower[i] * (1 - fraction) + upper[i] * fraction);
  return blended;
}

function processTile(image, outputWidth, outputHeight, x, y, tileWidth, tileHeight, settings, radius) {
  const padding = Math.ceil(radius) + (settings.cleanup ? 1 : 0);
  const left = Math.max(0, x - padding);
  const top = Math.max(0, y - padding);
  const right = Math.min(outputWidth, x + tileWidth + padding);
  const bottom = Math.min(outputHeight, y + tileHeight + padding);
  const maskWidth = right - left;
  const maskHeight = bottom - top;
  const sourceScaleX = (image.naturalWidth || image.width) / outputWidth;
  const sourceScaleY = (image.naturalHeight || image.height) / outputHeight;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = maskWidth;
  maskCanvas.height = maskHeight;
  const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!maskContext) throw new Error('Canvas browser tidak tersedia.');
  maskContext.imageSmoothingEnabled = true;
  maskContext.imageSmoothingQuality = 'high';
  maskContext.drawImage(
    image,
    left * sourceScaleX,
    top * sourceScaleY,
    maskWidth * sourceScaleX,
    maskHeight * sourceScaleY,
    0,
    0,
    maskWidth,
    maskHeight,
  );

  const frame = maskContext.getImageData(0, 0, maskWidth, maskHeight);
  const pixelCount = maskWidth * maskHeight;
  const originalAlpha = new Uint8Array(pixelCount);
  const refinedAlpha = new Uint8Array(pixelCount);
  const cutoff = clamp(Number(settings.tolerance) || 0, 0, 100) / 100 * 0.42 * 255;
  for (let pixel = 0, offset = 3; pixel < pixelCount; pixel++, offset += 4) {
    const alpha = frame.data[offset];
    originalAlpha[pixel] = alpha;
    refinedAlpha[pixel] = alpha <= cutoff ? 0 : alpha;
  }

  if (settings.cleanup && maskWidth > 2 && maskHeight > 2) {
    const beforeCleanup = refinedAlpha.slice();
    for (let row = 1; row < maskHeight - 1; row++) {
      const rowOffset = row * maskWidth;
      for (let column = 1; column < maskWidth - 1; column++) {
        const pixel = rowOffset + column;
        const alpha = beforeCleanup[pixel];
        if (alpha === 0 || alpha >= 224) continue;
        let supportedNeighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const neighborRow = pixel + dy * maskWidth;
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx !== 0 || dy !== 0) && beforeCleanup[neighborRow + dx] >= 24) supportedNeighbors++;
          }
        }
        // Remove weak isolated flecks while retaining supported antialiased edges and fine detail.
        if (alpha < 26 || supportedNeighbors < 2) refinedAlpha[pixel] = 0;
      }
    }
  }

  const ratioAlpha = new Uint8Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const original = originalAlpha[pixel];
    ratioAlpha[pixel] = original ? Math.round(refinedAlpha[pixel] * 255 / original) : 0;
  }
  const smoothedAlpha = smoothAlpha(ratioAlpha, maskWidth, maskHeight, radius);
  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel++, offset += 4) {
    frame.data[offset] = 255;
    frame.data[offset + 1] = 255;
    frame.data[offset + 2] = 255;
    frame.data[offset + 3] = smoothedAlpha[pixel];
  }
  maskContext.putImageData(frame, 0, 0);

  return {
    canvas: maskCanvas,
    sourceX: x - left,
    sourceY: y - top,
    width: tileWidth,
    height: tileHeight,
  };
}

export function drawRefinedImage(context, image, settings, width, height) {
  if (!width || !height) throw new Error('Ukuran ekspor tidak valid.');
  const smoothness = clamp(Number(settings.smoothness) || 0, 0, 100);
  const radius = smoothness / 100 * MAX_BLUR_RADIUS;
  context.save();
  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = 'source-over';
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  for (let y = 0; y < height; y += TILE_SIZE) {
    const tileHeight = Math.min(TILE_SIZE, height - y);
    for (let x = 0; x < width; x += TILE_SIZE) {
      const tileWidth = Math.min(TILE_SIZE, width - x);
      const tile = processTile(image, width, height, x, y, tileWidth, tileHeight, settings, radius);
      context.save();
      context.globalCompositeOperation = 'destination-in';
      context.beginPath();
      context.rect(x, y, tileWidth, tileHeight);
      context.clip();
      context.drawImage(tile.canvas, tile.sourceX, tile.sourceY, tile.width, tile.height, x, y, tile.width, tile.height);
      context.restore();
    }
  }
  context.restore();
}
