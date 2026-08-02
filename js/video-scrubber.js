/**
 * Scrubs an HTMLVideoElement from a 0..1 progress value.
 *
 * Two rules make this smooth, and skipping either one is where the usual
 * tutorial version falls apart:
 *
 * 1. Buffer the whole file into memory first. A streamed video answers a seek
 *    with a range request; a blob URL answers it from RAM.
 * 2. Never have more than one seek in flight. Assigning `currentTime` while a
 *    seek is still resolving makes the browser queue or drop work, which reads
 *    as stutter. We hold the newest requested time and issue it when the
 *    previous seek reports back.
 */

export async function createVideoScrubber({ video, src, fps = 30, onLoadProgress }) {
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');

  // iOS will not paint a frame from a video that has never been played by a
  // user gesture. One silent play/pause on first touch unlocks it.
  const unlock = () => {
    const p = video.play();
    if (p && p.then) p.then(() => video.pause()).catch(() => {});
    else video.pause();
  };
  document.documentElement.addEventListener('touchstart', unlock, {
    once: true,
    passive: true,
  });

  const blobUrl = await bufferToBlobUrl(src, onLoadProgress);
  video.src = blobUrl;
  video.load();
  await once(video, 'loadedmetadata');

  // Nudge the first frame out of the decoder so the stage is not blank.
  video.currentTime = 0.001;
  await once(video, 'seeked').catch(() => {});

  const duration = Number.isFinite(video.duration) ? video.duration : 1;
  // Ignore sub-frame requests; they cost a seek and show the same picture.
  // Must match the encoded rate — guessing high wastes seeks, guessing low
  // drops frames the file actually has.
  const frameStep = 1 / fps;

  let seeking = false;
  let queued = null;
  let watchdog = 0;

  function settle() {
    clearTimeout(watchdog);
    seeking = false;
    if (queued !== null) {
      const next = queued;
      queued = null;
      request(next);
    }
  }

  video.addEventListener('seeked', settle);

  function request(time) {
    if (seeking) {
      queued = time;
      return;
    }
    if (Math.abs(video.currentTime - time) < frameStep / 2) return;

    seeking = true;
    // If a seek lands on the frame already displayed some browsers never fire
    // `seeked`. Without this the scrubber would deadlock on that one frame.
    watchdog = setTimeout(settle, 250);
    video.currentTime = time;
  }

  return {
    duration,
    seek(progress) {
      request(Math.max(0, Math.min(progress, 1)) * duration);
    },
    destroy() {
      clearTimeout(watchdog);
      video.removeEventListener('seeked', settle);
      URL.revokeObjectURL(blobUrl);
    },
  };
}

async function bufferToBlobUrl(src, onLoadProgress) {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Could not load ${src} (${response.status})`);

  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body && response.body.getReader ? response.body.getReader() : null;

  // No streaming reader available (or no length header): still works, just
  // without a real percentage.
  if (!reader) {
    const blob = await response.blob();
    if (onLoadProgress) onLoadProgress(1);
    return URL.createObjectURL(blob);
  }

  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onLoadProgress && total) onLoadProgress(received / total);
  }
  if (onLoadProgress) onLoadProgress(1);
  return URL.createObjectURL(new Blob(chunks, { type: response.headers.get('content-type') || 'video/mp4' }));
}

function once(el, event) {
  return new Promise((resolve, reject) => {
    const ok = (e) => {
      el.removeEventListener('error', bad);
      resolve(e);
    };
    const bad = (e) => {
      el.removeEventListener(event, ok);
      reject(e);
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}
