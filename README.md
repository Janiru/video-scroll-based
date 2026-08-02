# Scroll-driven video

A pinned video whose playhead is bound to the scrollbar. No dependencies — no
jQuery, no GSAP, no ScrollTrigger.

```bash
python3 -m http.server 8123
# open http://localhost:8123
```

A server is required: the page loads ES modules and fetches the video, and both
are blocked on `file://`.

With no footage in place it runs a procedural canvas ("demo mode") so you can
feel the scroll behaviour immediately.

## Adding your video

```bash
./tools/encode.sh path/to/your-footage.mov 1920 24 22
#                                          width fps crf
```

That writes `assets/video.mp4` and the page picks it up on reload. Match the fps
argument to your source rather than resampling, and set `videoFps` in
[js/main.js](js/main.js) to the same number — the scrubber uses it to discard
seek requests that would land on the frame already showing.

The committed `assets/video.mp4` was built from a 3840×2160 24fps source with
exactly that command: 192 frames, 192 keyframes, no audio, 14.6 MB.

**Do not skip the encode step.** It is the single biggest factor in how this
feels, bigger than any JavaScript in here. A normal export places a keyframe
every few seconds, so seeking to an arbitrary time forces the decoder to decode
forward from the last keyframe — dozens of frames of work for one scroll event.
`tools/encode.sh` produces an all-intra file (`-g 1`) where every frame is a
keyframe, so every seek is exactly one decode.

Guidelines that matter more than they look:

| Knob | Aim for | Why |
| --- | --- | --- |
| Duration | 5–15s | The entire file is held in memory. |
| File size | under ~30 MB | It downloads fully before the first frame shows. |
| Frame rate | 24–30fps | Scrubbing rarely resolves more; 60fps doubles the size for nothing. |
| Width | 1280–1920 | Scaled to `cover` anyway. |
| Audio | none | Stripped by the encoder; it can never play here. |

Shoot or cut for it: locked-off camera, slow continuous motion, no hard cuts.
Cuts read as glitches when the viewer controls the speed.

## The two failure modes this avoids

**Queued seeks.** The common implementation assigns `video.currentTime` on every
scroll event. Scroll events fire faster than a decoder can answer, so seeks pile
up and the browser starts dropping them — visible as the video lurching and
catching up. [js/video-scrubber.js](js/video-scrubber.js) keeps at most one seek
in flight and holds only the *newest* requested time, discarding anything that
went stale while the decoder was busy.

**Raw scroll input.** Scroll position arrives in chunks that do not line up with
frames, so binding it directly to a playhead looks notchy even with a perfect
encode. [js/progress-engine.js](js/progress-engine.js) eases a rendered value
toward the scroll position once per animation frame, with frame-rate independent
easing so 60Hz and 120Hz displays behave the same.

## Configuration

Top of [js/main.js](js/main.js):

- `mode` — `'video'`, `'frames'`, or `'demo'`. `'video'` falls back to `'demo'`
  if the file is missing.
- `smoothing` — `0.06` heavy and cinematic, `0.12` default, `0.25` tight and
  responsive.

Top of [css/style.css](css/style.css):

- `--scroll-length` — how much scrolling the sequence is spread across (`600vh`).
  This is the pacing control; the video duration is not.

## Frame-sequence mode

If video mode still is not clean enough on a device you care about:

```bash
./tools/extract-frames.sh path/to/your-footage.mov
# then set mode: 'frames' and frameCount in js/main.js
```

Every frame becomes a JPEG drawn to a canvas — no decoder, no seeking, identical
in every browser. It is what Apple ships on product pages. The cost is weight:
several times the bytes of the equivalent mp4, and a longer preload.

## Captions

Each `<article class="caption">` in [index.html](index.html) carries
`data-in` / `data-out` as timeline positions in 0..1:

```html
<article class="caption" data-in="0.24" data-out="0.5">
```

It fades in over the first quarter of its band, holds, and fades out over the
last quarter. They are driven from the same value as the video on the same
frame, so text never drifts behind the footage.

## Known constraints

- iOS needs one user touch before a video will paint a frame. Handled with a
  silent play/pause on first `touchstart`, but the very first frame can appear a
  moment late on iOS if the user scrolls without touching.
- Memory scales with file size, since the video is buffered as a blob. This is
  the deliberate trade for instant seeks — respect the size budget above.
- `prefers-reduced-motion` disables the easing and applies scroll position
  directly.
