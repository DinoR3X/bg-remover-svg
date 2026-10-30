// Browser-only IMG.LY engine entry point.
// Keep inference on CPU for compatibility with mobile browsers; images are passed
// directly to the local engine and are never sent to a processing server.
import { removeBackground as removeBackgroundWithIMGly } from './engine-core.js';

const ENGINE_DEFAULTS = {
  device: 'cpu',
  model: 'isnet_fp16',
  proxyToWorker: false,
  output: { format: 'image/png', quality: 1 },
};

export function removeBackground(image, options = {}) {
  return removeBackgroundWithIMGly(image, {
    ...options,
    ...ENGINE_DEFAULTS,
    // Keep the PNG default while allowing the caller to pass output options.
    output: { ...ENGINE_DEFAULTS.output, ...options.output },
  });
}
