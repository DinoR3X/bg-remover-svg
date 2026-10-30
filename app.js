/* Latar: browser-only image editor. Source is offered under AGPL-3.0-or-later. */
import { drawRefinedImage } from './matte-processing.js?v=refinement-20261030-r2';

const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries(['fileInput','dropZone','imageStage','preview','previewLabel','imageDimensions','replaceBtn','originalTab','resultTab','resolution','sizeInfo','outputDimensions','formatNote','processBtn','downloadBtn','status','progress','smoothness','smoothnessValue','cleanup','tolerance','toleranceValue'].map(id => [id, $(id)]));
let sourceFile = null, sourceImage = null, sourceURL = null;
let resultImage = null, engineURL = null, resultURL = null, resultReady = false;
let busy = false, adjusting = false, selection = 0, adjustmentSequence = 0, adjustmentTimer;
let enginePromise;
const loadedResources = new Map();
const number = new Intl.NumberFormat('id-ID');

function message(text, kind = '') {
  ui.status.textContent = text;
  ui.status.className = `status ${kind}`;
}
function chosenFormat() { return document.querySelector('input[name="format"]:checked').value; }
function refinementSettings() {
  return { smoothness: Number(ui.smoothness.value), cleanup: ui.cleanup.checked, tolerance: Number(ui.tolerance.value) };
}
function updateRefinementLabels() {
  ui.smoothnessValue.textContent = `${ui.smoothness.value}%`;
  ui.toleranceValue.textContent = `${ui.tolerance.value}%`;
}
function exportSize() {
  const image = resultImage || sourceImage;
  if (!image) return null;
  const width = image.naturalWidth, height = image.naturalHeight;
  const max = ui.resolution.value === 'original' ? Infinity : Number(ui.resolution.value);
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
function updateExport() {
  const dimensions = exportSize();
  ui.outputDimensions.textContent = dimensions ? `${number.format(dimensions.width)} × ${number.format(dimensions.height)} px` : '— × — px';
  ui.sizeInfo.textContent = sourceImage ? 'Rasio asli dijaga. Tidak diperbesar melebihi sumber.' : 'Sisi terpanjang; rasio foto tetap terjaga.';
  const svg = chosenFormat() === 'svg';
  ui.formatNote.textContent = svg ? 'SVG berisi PNG transparan, bukan jalur vektor.' : 'PNG lossless dengan latar transparan.';
  ui.downloadBtn.querySelector('span').textContent = `Unduh ${svg ? 'SVG' : 'PNG'}`;
  ui.downloadBtn.disabled = busy || adjusting || !resultImage || !resultReady;
}
function showView(result) {
  if (!sourceImage || (result && (!resultImage || !resultURL))) return;
  ui.preview.src = result ? resultURL : sourceURL;
  ui.preview.alt = result ? 'Subjek foto dengan latar belakang transparan' : 'Gambar asli sebelum background dihapus';
  ui.previewLabel.textContent = result ? 'Hasil transparan' : 'Gambar asli';
  ui.resultTab.classList.toggle('active', result);
  ui.originalTab.classList.toggle('active', !result);
  ui.resultTab.setAttribute('aria-pressed', String(result));
  ui.originalTab.setAttribute('aria-pressed', String(!result));
}
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Gambar tidak dapat dibaca. Coba file JPG, PNG, atau WebP lain.'));
    image.src = url;
  });
}
function pngBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Browser tidak dapat membuat PNG.')), 'image/png'));
}
function dataURL(blob) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
}
function previewDimensions(image) {
  const width = image.naturalWidth, height = image.naturalHeight;
  const scale = Math.min(1, 1400 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
async function buildAdjustedPreview(image, settings) {
  const { width, height } = previewDimensions(image);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas tidak tersedia.');
  drawRefinedImage(context, image, settings, width, height);
  return { blob: await pngBlob(canvas) };
}
function cancelPendingRefinement() {
  clearTimeout(adjustmentTimer);
  adjustmentTimer = null;
  // A new image/process supersedes both queued and already-encoding previews.
  adjustmentSequence++;
  adjusting = false;
}
async function refreshAdjustedPreview() {
  if (!resultImage || busy) return;
  const request = ++adjustmentSequence;
  adjusting = true;
  updateExport();
  try {
    const adjusted = await buildAdjustedPreview(resultImage, refinementSettings());
    if (request !== adjustmentSequence) return;
    const nextURL = URL.createObjectURL(adjusted.blob);
    if (resultURL) URL.revokeObjectURL(resultURL);
    resultURL = nextURL;
    resultReady = true;
    if (ui.resultTab.classList.contains('active')) showView(true);
    message('Penyempurnaan tepi diterapkan. Pilih resolusi lalu unduh hasilnya.', 'success');
  } catch (error) {
    if (request !== adjustmentSequence) return;
    console.error('Matte refinement failed:', error);
    message('Penyempurnaan belum berhasil: ' + (error.message || 'coba lagi.'), 'error');
  } finally {
    if (request === adjustmentSequence) {
      adjusting = false;
      updateExport();
    }
  }
}
function queueRefinement() {
  updateRefinementLabels();
  if (!resultImage || busy) return;
  clearTimeout(adjustmentTimer);
  adjustmentSequence++;
  adjusting = true;
  updateExport();
  message('Menerapkan pengaturan tepi…');
  adjustmentTimer = setTimeout(refreshAdjustedPreview, 140);
}

function openPicker() { if (!busy) ui.fileInput.click(); }
ui.dropZone.addEventListener('click', openPicker);
ui.dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
ui.replaceBtn.addEventListener('click', openPicker);
ui.fileInput.addEventListener('change', () => { if (ui.fileInput.files[0]) acceptFile(ui.fileInput.files[0]); ui.fileInput.value = ''; });
for (const type of ['dragenter','dragover']) ui.dropZone.addEventListener(type, e => { e.preventDefault(); if (!busy) ui.dropZone.classList.add('dragover'); });
for (const type of ['dragleave','drop']) ui.dropZone.addEventListener(type, e => { e.preventDefault(); ui.dropZone.classList.remove('dragover'); });
ui.dropZone.addEventListener('drop', e => { if (!busy && e.dataTransfer.files[0]) acceptFile(e.dataTransfer.files[0]); });
// Prevent accidentally navigating away when a file is dropped outside the upload area.
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

async function acceptFile(file) {
  if (busy) return;
  const request = ++selection;
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { message('Gunakan file JPG, PNG, atau WebP.', 'error'); return; }
  if (file.size > 20 * 1024 * 1024) { message('Ukuran file melebihi 20 MB. Pilih gambar yang lebih kecil.', 'error'); return; }
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (request !== selection) { URL.revokeObjectURL(url); return; }
    if (image.naturalWidth * image.naturalHeight > 28000000 || Math.max(image.naturalWidth, image.naturalHeight) > 12000) throw new Error('Gambar terlalu besar untuk memori browser. Gunakan foto hingga 28 megapiksel dan sisi maksimal 12.000 px.');
    if (sourceURL) URL.revokeObjectURL(sourceURL);
    if (engineURL) URL.revokeObjectURL(engineURL);
    if (resultURL) URL.revokeObjectURL(resultURL);
    cancelPendingRefinement();
    sourceFile = file; sourceImage = image; sourceURL = url;
    resultImage = null; engineURL = null; resultURL = null; resultReady = false;
    ui.dropZone.hidden = true; ui.imageStage.hidden = false; ui.replaceBtn.hidden = false;
    ui.originalTab.disabled = false; ui.resultTab.disabled = true;
    ui.imageDimensions.textContent = `${number.format(image.naturalWidth)} × ${number.format(image.naturalHeight)} px`;
    ui.processBtn.disabled = false;
    ui.processBtn.innerHTML = '<span aria-hidden="true">✦</span> Hapus background';
    showView(false); updateExport();
    message('Gambar siap. Atur tepi bila perlu, lalu klik “Hapus background”.');
  } catch (error) { URL.revokeObjectURL(url); message(error.message || 'Gambar tidak dapat dibaca.', 'error'); }
}
function setBusy(value) {
  busy = value;
  ui.processBtn.disabled = value || !sourceFile;
  ui.replaceBtn.disabled = value;
  ui.fileInput.disabled = value;
  for (const id of ['smoothness','cleanup','tolerance']) ui[id].disabled = value;
  ui.imageStage.classList.toggle('processing', value);
  ui.imageStage.setAttribute('aria-busy', String(value));
  ui.progress.hidden = !value;
  updateExport();
}

ui.processBtn.addEventListener('click', async () => {
  if (!sourceFile || busy) return;
  cancelPendingRefinement();
  setBusy(true); ui.progress.value = 3; loadedResources.clear();
  ui.processBtn.textContent = 'Memisahkan subjek…';
  message('Menyiapkan AI. Unduhan pertama mungkin membutuhkan waktu.');
  try {
    enginePromise ||= import('./engine.js?v=refinement-20261030-r1');
    const { removeBackground } = await enginePromise;
    const blob = await removeBackground(sourceFile, {
      publicPath: 'https://latar-bg-remover.latar.workers.dev/model/',
      output: { format: 'image/png', quality: 1 },
      progress: (key, current, total) => {
        if (key.startsWith('fetch:')) {
          loadedResources.set(key, { current, total });
          let done = 0, size = 0;
          for (const item of loadedResources.values()) { done += item.current; size += item.total; }
          ui.progress.value = Math.min(85, 5 + (size ? done / size : 0) * 80);
          message(current < total ? 'Mengunduh mesin AI ke browser… foto tetap lokal.' : 'AI siap. Sedang memisahkan subjek…');
        } else {
          ui.progress.value = Math.max(ui.progress.value, 90);
          message('Memisahkan subjek di browser…');
        }
      }
    });
    const nextEngineURL = URL.createObjectURL(blob);
    let image;
    try { image = await loadImage(nextEngineURL); } catch (error) { URL.revokeObjectURL(nextEngineURL); throw error; }
    if (engineURL) URL.revokeObjectURL(engineURL);
    if (resultURL) URL.revokeObjectURL(resultURL);
    resultImage = image; engineURL = nextEngineURL; resultURL = null; resultReady = false;
    ui.progress.value = 95;
    message('AI selesai. Menerapkan penyempurnaan tepi…');
    const adjusted = await buildAdjustedPreview(image, refinementSettings());
    resultURL = URL.createObjectURL(adjusted.blob);
    resultReady = true;
    ui.resultTab.disabled = false; ui.progress.value = 100;
    showView(true);
    message('Selesai! Atur tepi, pilih resolusi, lalu unduh hasilnya.', 'success');
  } catch (error) {
    console.error('Background removal failed:', error);
    const detail = String(error?.message || 'Kesalahan tidak diketahui.').replace(/ +/g, ' ').slice(0, 160);
    const inAppBrowser = /TikTok|musical_ly|BytedanceWebview|FBAN|FBAV|Instagram|; wv/i.test(navigator.userAgent);
    const hint = inAppBrowser ? ' Buka situs ini di Chrome, bukan browser dalam aplikasi.' : ' Periksa koneksi lalu coba lagi.';
    message('Proses gagal: ' + detail + '.' + hint, 'error');
    // Allow a fresh network attempt after a failed module load.
    enginePromise = null;
  } finally {
    setBusy(false);
    ui.processBtn.innerHTML = '<span aria-hidden="true">✦</span> ' + (resultImage ? 'Proses ulang' : 'Coba hapus background');
  }
});
ui.originalTab.addEventListener('click', () => showView(false));
ui.resultTab.addEventListener('click', () => showView(true));
ui.resolution.addEventListener('change', updateExport);
document.querySelectorAll('input[name="format"]').forEach(input => input.addEventListener('change', updateExport));
ui.smoothness.addEventListener('input', queueRefinement);
ui.cleanup.addEventListener('change', queueRefinement);
ui.tolerance.addEventListener('input', queueRefinement);

ui.downloadBtn.addEventListener('click', async () => {
  if (!resultImage || !resultReady || busy || adjusting) return;
  ui.downloadBtn.disabled = true;
  try {
    const { width, height } = exportSize();
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas tidak tersedia.');
    drawRefinedImage(context, resultImage, refinementSettings(), width, height);
    let blob = await pngBlob(canvas);
    const format = chosenFormat();
    if (format === 'svg') {
      const embedded = await dataURL(blob);
      blob = new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>Gambar transparan — Latar</title><image width="${width}" height="${height}" href="${embedded}"/></svg>`], { type: 'image/svg+xml;charset=utf-8' });
    }
    const basename = (sourceFile.name.replace(/\.[^.]+$/, '') || 'gambar').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 75);
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = href; link.download = `${basename}-tanpa-latar-${width}x${height}.${format}`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 30000);
    message(`File ${format.toUpperCase()} ${number.format(width)} × ${number.format(height)} px siap diunduh.`, 'success');
  } catch (error) { console.error(error); message('Unduhan belum berhasil. Coba resolusi yang lebih kecil.', 'error'); }
  finally { updateExport(); }
});
ui.resultTab.disabled = true;
updateRefinementLabels();
updateExport();
