/**
 * Turns the window scroll position into a smoothed 0..1 progress value.
 *
 * The scroll position itself is a step function: it jumps in chunks as the
 * wheel or trackpad fires, and those chunks do not line up with frames. Feeding
 * it straight into a video seek is what makes scroll-video sites feel notchy.
 * So we keep a target (raw scroll) and a value (what we render), and ease the
 * value toward the target once per animation frame.
 */

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

export function createProgressEngine({ track, smoothing = 0.12, onUpdate }) {
  let target = 0;
  let value = 0;
  let rafId = 0;
  let lastTime = 0;
  let idleSince = 0;
  let metrics = measure();

  function measure() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const top = track.getBoundingClientRect().top + scrollTop;
    // The track is taller than the viewport; the sticky stage is pinned for
    // exactly (trackHeight - viewportHeight) pixels of scrolling.
    const distance = Math.max(track.offsetHeight - window.innerHeight, 1);
    return { top, distance };
  }

  function readTarget() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    target = clamp01((scrollTop - metrics.top) / metrics.distance);
  }

  function tick(now) {
    const dt = lastTime ? Math.min(now - lastTime, 64) : 16.667;
    lastTime = now;

    // Frame-rate independent easing: the same visual speed at 60Hz and 120Hz.
    const alpha = 1 - Math.pow(1 - smoothing, dt / 16.667);
    const delta = target - value;
    value += delta * alpha;

    if (Math.abs(delta) < 0.00005) {
      value = target;
      idleSince = idleSince || now;
    } else {
      idleSince = 0;
    }

    onUpdate(value, target);

    // Park the loop when nothing is moving so we are not burning a frame
    // callback (and battery) on a page the user has stopped scrolling.
    if (idleSince && now - idleSince > 400) {
      rafId = 0;
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function wake() {
    if (rafId) return;
    lastTime = 0;
    idleSince = 0;
    rafId = requestAnimationFrame(tick);
  }

  function onScroll() {
    readTarget();
    wake();
  }

  function onResize() {
    metrics = measure();
    readTarget();
    wake();
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  readTarget();
  value = target; // Start settled — no slide-in on reload at a scrolled position.
  wake();

  return {
    get value() {
      return value;
    },
    refresh: onResize,
    destroy() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    },
  };
}
