// Latar asset proxy. Image inference remains entirely in the user's browser.
// Pin site source to the tested application commit to avoid stale upstream cache.
const SOURCE_REVISION = '390ee6571ec5f07f8c1e9da395325c71bee5bdb2';
const SOURCE_ROOT = 'https://raw.githubusercontent.com/DinoR3X/bg-remover-svg/' + SOURCE_REVISION + '/';
const MODEL_ROOT = 'https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/';

const SITE_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/engine.js': ['engine.js', 'text/javascript; charset=utf-8'],
  '/engine-core.js': ['engine-core.js', 'text/javascript; charset=utf-8'],
  '/matte-processing.js': ['matte-processing.js', 'text/javascript; charset=utf-8']
};

addEventListener('fetch', event => event.respondWith(handle(event.request)));

async function handle(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const path = new URL(request.url).pathname;
  let target;
  let contentType;
  let isModel = false;

  if (path.startsWith('/model/')) {
    const asset = path.slice('/model/'.length);
    if (asset === 'resources.json') {
      target = MODEL_ROOT + 'resources.json';
      contentType = 'application/json; charset=utf-8';
    } else if (/^[a-f0-9]{64}$/i.test(asset)) {
      target = MODEL_ROOT + asset;
      contentType = 'application/octet-stream';
    } else {
      return new Response('Not found', { status: 404 });
    }
    isModel = true;
  } else {
    const file = SITE_FILES[path];
    if (!file) return new Response('Not found', { status: 404 });
    target = SOURCE_ROOT + file[0];
    contentType = file[1];
  }

  try {
    const upstream = isModel
      ? await fetch(target, { cf: { cacheTtl: 31536000, cacheEverything: true } })
      : await fetch(target);
    if (!upstream.ok) {
      return new Response('Asset origin returned HTTP ' + upstream.status, {
        status: upstream.status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }

    const headers = new Headers({
      'Content-Type': contentType,
      'Cache-Control': isModel ? 'public, max-age=31536000, immutable' : 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Latar-Source-Revision': isModel ? 'imgly-1.7.0' : SOURCE_REVISION
    });
    return new Response(request.method === 'HEAD' ? null : upstream.body, { status: 200, headers });
  } catch (error) {
    return new Response('Site asset origin is temporarily unavailable.', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
}
