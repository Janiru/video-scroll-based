/**
 * Scrubs an HTMLVideoElement from a 0..1 progress value.
 *
 * Two rules make this smooth, and skipping either one is where the usual
 * tutorial version falls apart:
 *
 * 1. Seeks should be answered from memory, not from the network.
 * 2. Never have more than one seek in flight. Assigning `currentTime` while a
 *    seek is still resolving makes the browser queue or drop work, which reads
 *    as stutter. We hold the newest requested time and issue it when the
 *    previous seek reports back.
 *
 * Rule 1 used to mean "download the whole file before showing anything", which
 * bought smoothness at the cost of a long stare at a loading bar. The
 * 'progressive' strategy below gets both: the page goes interactive as soon as
 * metadata arrives and scrubs over the network, while the full file downloads
 * in the background and is swapped in mid-session without a visible seam.
 */

export async function createVideoScrubber({
  video,
  src,
  fps = 30,
  strategy = 'progressive',
  freeze = null,
  onLoadProgress,
  onBuffered,
}) {
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
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
  document.documentElement.addEventListener('touchstart', unlock, { passive: true });

  // Ignore sub-frame requests; they cost a seek and show the same picture.
  // Must match the encoded rate — guessing high wastes seeks, guessing low
  // drops frames the file actually has.
  const frameStep = 1 / fps;

  let seeking = false;
  let queued = null;
  let watchdog = 0;
  let swapping = false;
  let wanted = 0;
  let blobUrl = null;

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
    // Mid-swap the element is reloading and its currentTime is meaningless.
    // Remember where we should be and jump there once the new source is live.
    if (swapping) return;
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

  async function attach(url, preload) {
    video.preload = preload;
    video.src = url;
    video.load();
    await once(video, 'loadedmetadata');
  }

  if (strategy === 'buffer-first') {
    blobUrl = await bufferToBlobUrl(src, onLoadProgress);
    await attach(blobUrl, 'auto');
  } else {
    // `metadata` rather than `auto`: the browser fetches only what it needs to
    // seek, leaving the bandwidth for our own full download instead of racing
    // it for the same bytes.
    await attach(src, 'metadata');
  }

  // Nudge the first frame out of the decoder so the stage is not blank.
  video.currentTime = 0.001;
  await once(video, 'seeked').catch(() => {});

  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;

  /** Swaps the streamed source for the in-memory one without a visible seam. */
  async function upgrade() {
    let url;
    try {
      url = await bufferToBlobUrl(src, onLoadProgress);
    } catch (error) {
      // Streaming still works; we just never get the memory-speed upgrade.
      console.warn('[scroll-video] background buffering failed, staying on network.', error);
      return;
    }

    const resumeAt = video.currentTime;
    swapping = true;
    clearTimeout(watchdog);
    seeking = false;
    queued = null;

    // Hold the current frame on a canvas so the reload cannot flash black.
    if (freeze) freeze.capture(video);

    try {
      blobUrl = url;
      await attach(url, 'auto');
      video.currentTime = resumeAt;
      await once(video, 'seeked').catch(() => {});
    } finally {
      swapping = false;
      if (freeze) freeze.release();
    }

    request(wanted); // Catch up to wherever the user scrolled during the swap.
    if (onBuffered) onBuffered();
  }

  if (strategy === 'progressive') {
    // Deliberately not awaited: the page is already usable.
    upgrade();
  }

  return {
    duration,
    seek(progress) {
      wanted = Math.max(0, Math.min(progress, 1)) * duration;
      request(wanted);
    },
    destroy() {
      clearTimeout(watchdog);
      video.removeEventListener('seeked', settle);
      document.documentElement.removeEventListener('touchstart', unlock);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
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
  return URL.createObjectURL(
    new Blob(chunks, { type: response.headers.get('content-type') || 'video/mp4' })
  );
}

function once(el, event) {
  return new Promise((resolve, reject) => {
    const ok = (e) => {
      el.removeEventListener('error', bad);
      resolve(e);
    };
    const bad = (e) => {
      el.removeEventListener(event, ok);
      reject(new Error(`${event} failed`));
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}
