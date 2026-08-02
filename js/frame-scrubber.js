/**
 * Scrubs a preloaded image sequence onto a canvas.
 *
 * This is the bulletproof mode — the one Apple ships on product pages. There is
 * no decoder and no seeking, so every frame costs one drawImage and the
 * scrubbing is frame-exact in every browser. The trade is weight: a few hundred
 * JPEGs is far bigger than the equivalent mp4, so keep the sequence short and
 * the resolution honest.
 */

export async function createFrameScrubber({ canvas, urls, onLoadProgress }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const frames = new Array(urls.length);

  let loaded = 0;
  await eachLimit(urls, 8, async (url, i) => {
    frames[i] = await loadImage(url);
    loaded += 1;
    if (onLoadProgress) onLoadProgress(loaded / urls.length);
  });

  let current = -1;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    draw(current < 0 ? 0 : current, true);
  }

  function draw(index, force) {
    if (!force && index === current) return;
    current = index;
    const img = frames[index];
    if (!img) return;

    // object-fit: cover, by hand.
    const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    frameCount: frames.length,
    seek(progress) {
      const p = Math.max(0, Math.min(progress, 1));
      draw(Math.min(frames.length - 1, Math.round(p * (frames.length - 1))));
    },
    destroy() {
      window.removeEventListener('resize', resize);
    },
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

async function eachLimit(items, limit, fn) {
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/** Builds ["assets/frames/frame_0001.jpg", ...] from a printf-style pattern. */
export function frameUrls(pattern, count, start = 1) {
  const match = pattern.match(/%0(\d+)d/);
  const pad = match ? Number(match[1]) : 4;
  return Array.from({ length: count }, (_, i) =>
    pattern.replace(/%0\d+d/, String(start + i).padStart(pad, '0'))
  );
}
