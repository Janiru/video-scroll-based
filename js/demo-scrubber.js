/**
 * A procedural stand-in so the page is scrollable before you have any footage.
 *
 * It exposes the same { seek(progress) } shape as the real scrubbers, which is
 * the point: you can feel the scroll smoothing on its own, with no decoder in
 * the way, and know that anything janky later came from the video and not from
 * the engine.
 */

export function createDemoScrubber({ canvas }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let dpr = 1;
  let progress = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    render();
  }

  function render() {
    const { width: w, height: h } = canvas;
    const cx = w / 2;
    const cy = h / 2;

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, `hsl(${220 + progress * 120}, 45%, 8%)`);
    bg.addColorStop(1, '#050505');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // A tunnel of rings pulled toward the camera by progress.
    const rings = 26;
    const depth = progress * rings;
    ctx.lineWidth = 1.5 * dpr;
    for (let i = 0; i < rings; i++) {
      const z = (i - depth) % rings;
      const t = (z + rings) % rings / rings; // 0 = at camera, 1 = far away
      const radius = Math.max(w, h) * 0.9 * Math.pow(1 - t, 2.2);
      if (radius < 1) continue;

      const fade = Math.sin(Math.PI * t);
      ctx.strokeStyle = `hsla(${200 + progress * 140 + i * 4}, 90%, 65%, ${fade * 0.5})`;
      ctx.beginPath();
      for (let a = 0; a <= 64; a++) {
        const angle = (a / 64) * Math.PI * 2 + progress * 3 + i * 0.15;
        const wobble = 1 + Math.sin(angle * 3 + i) * 0.06;
        const x = cx + Math.cos(angle) * radius * wobble;
        const y = cy + Math.sin(angle) * radius * wobble * 0.62;
        a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 3 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    seek(p) {
      progress = Math.max(0, Math.min(p, 1));
      render();
    },
    destroy() {
      window.removeEventListener('resize', resize);
    },
  };
}
