import { createProgressEngine } from './progress-engine.js';
import { createVideoScrubber } from './video-scrubber.js';
import { createFrameScrubber, frameUrls } from './frame-scrubber.js';
import { createDemoScrubber } from './demo-scrubber.js';

const CONFIG = {
  /**
   * 'video'  — scrub assets/video.mp4 (see tools/encode.sh for the encode that
   *            makes this smooth; a normal export will not be).
   * 'frames' — scrub a preloaded JPEG sequence. Heavier, but flawless anywhere.
   * 'demo'   — procedural canvas, no assets needed.
   *
   * 'video' silently falls back to 'demo' if the file is missing, so the page
   * is never broken while you are still cutting footage.
   */
  mode: 'video',

  videoSrc: 'assets/video.mp4',

  /** Frame rate of the encoded file. Keep in sync with tools/encode.sh. */
  videoFps: 8,

  /**
   * 'progressive'  — interactive as soon as metadata lands, scrubbing over the
   *                  network while the file downloads in the background, then
   *                  swapped to memory mid-session. Best time-to-interactive.
   * 'buffer-first' — download everything, then reveal. Every seek is instant
   *                  from the first one, at the cost of staring at a loader.
   *                  Worth it only for small files on fast connections.
   */
  videoStrategy: 'progressive',

  framePattern: 'assets/frames/frame_%04d.jpg',
  frameCount: 180,

  /**
   * How hard the scroll is eased, 0..1 per frame at 60Hz.
   * 0.06 = heavy, cinematic, noticeable glide after you stop.
   * 0.12 = the sweet spot for most footage.
   * 0.25 = tight and responsive, close to raw scroll.
   */
  smoothing: 0.12,
};

const stage = document.querySelector('[data-stage]');
const track = document.querySelector('[data-track]');
const video = document.querySelector('[data-video]');
const canvas = document.querySelector('[data-canvas]');
const loader = document.querySelector('[data-loader]');
const loaderBar = document.querySelector('[data-loader-bar]');
const loaderText = document.querySelector('[data-loader-text]');
const progressBar = document.querySelector('[data-progress-bar]');
const overlays = Array.from(document.querySelectorAll('[data-in]')).map((el) => ({
  el,
  start: Number(el.dataset.in),
  end: Number(el.dataset.out),
}));

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

boot();

async function boot() {
  let scrubber = null;

  try {
    scrubber = await createScrubber(CONFIG.mode);
  } catch (error) {
    console.warn(`[scroll-video] ${CONFIG.mode} mode unavailable, using demo mode.`, error);
    scrubber = await createScrubber('demo');
  }

  hideLoader();

  createProgressEngine({
    track,
    // Reduced-motion users get the scroll position applied directly: still
    // scroll-driven, but with no easing that keeps moving on its own.
    smoothing: prefersReducedMotion ? 1 : CONFIG.smoothing,
    onUpdate(progress) {
      scrubber.seek(progress);
      progressBar.style.transform = `scaleX(${progress})`;
      updateOverlays(progress);
    },
  });
}

async function createScrubber(mode) {
  if (mode === 'video') {
    stage.dataset.render = 'video';
    return createVideoScrubber({
      video,
      src: CONFIG.videoSrc,
      fps: CONFIG.videoFps,
      strategy: CONFIG.videoStrategy,
      freeze: createFreezeOverlay(),
      // In progressive mode the loader is already gone by the time this fires,
      // so buffering reports to the console rather than the UI.
      onLoadProgress: CONFIG.videoStrategy === 'buffer-first' ? setLoadProgress : undefined,
      onBuffered: () => console.info('[scroll-video] buffered to memory; seeks are now instant.'),
    });
  }

  if (mode === 'frames') {
    stage.dataset.render = 'canvas';
    return createFrameScrubber({
      canvas,
      urls: frameUrls(CONFIG.framePattern, CONFIG.frameCount),
      onLoadProgress: setLoadProgress,
    });
  }

  stage.dataset.render = 'canvas';
  setLoadProgress(1);
  return createDemoScrubber({ canvas });
}

/**
 * Swapping the video's source makes the element go momentarily blank. This
 * paints the last good frame onto the canvas that video mode leaves unused,
 * shows it for the duration of the swap, and takes it away afterwards — so the
 * upgrade from streamed to in-memory playback is invisible.
 */
function createFreezeOverlay() {
  const ctx = canvas.getContext('2d', { alpha: false });

  return {
    capture(sourceVideo) {
      if (!sourceVideo.videoWidth) return;
      // Reveal before measuring: video mode leaves the canvas display:none,
      // and a hidden element reports zero size. Nothing repaints between this
      // line and the drawImage below, so no blank frame escapes.
      stage.dataset.freeze = 'true';

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);

      const scale = Math.max(
        canvas.width / sourceVideo.videoWidth,
        canvas.height / sourceVideo.videoHeight
      );
      const w = sourceVideo.videoWidth * scale;
      const h = sourceVideo.videoHeight * scale;
      ctx.drawImage(sourceVideo, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    },
    release() {
      delete stage.dataset.freeze;
    },
  };
}

/**
 * Each overlay owns a slice of the timeline and fades through it: in over the
 * first quarter of its band, held through the middle, out over the last
 * quarter. Driving this from the same progress value as the video is what keeps
 * captions locked to the footage instead of drifting a frame behind it.
 */
function updateOverlays(progress) {
  for (const { el, start, end } of overlays) {
    const span = end - start;
    const local = (progress - start) / span;

    let opacity = 0;
    if (local >= 0 && local <= 1) {
      opacity = local < 0.25 ? local / 0.25 : local > 0.75 ? (1 - local) / 0.25 : 1;
    }

    const eased = opacity * opacity * (3 - 2 * opacity); // smoothstep
    el.style.opacity = eased;
    el.style.transform = `translate3d(0, ${(1 - eased) * 28}px, 0)`;
    el.style.visibility = eased < 0.01 ? 'hidden' : 'visible';
  }
}

function setLoadProgress(fraction) {
  const percent = Math.round(fraction * 100);
  loaderBar.style.transform = `scaleX(${fraction})`;
  loaderText.textContent = `${percent}%`;
}

function hideLoader() {
  loader.dataset.done = 'true';
  document.body.dataset.ready = 'true';
  setTimeout(() => loader.remove(), 700);
}
