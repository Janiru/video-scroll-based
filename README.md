# Scroll-driven video

A pinned video whose playhead is bound to the scrollbar. No dependencies — no
jQuery, no GSAP, no ScrollTrigger.

```bash
./tools/serve.py
# open http://localhost:8123
```

Use that server rather than `python3 -m http.server`: the stdlib one does not
implement HTTP Range requests, and seeking a streamed video needs them. Every
real static host (GitHub Pages, Netlify, S3, nginx) supports ranges, so this is
a dev-only gap.

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

If your source is already all-intra, skip the encode — re-compressing only costs
you a generation of quality. Check with:

```bash
ffprobe -v error -select_streams v:0 -show_entries frame=key_frame \
  -of csv=p=0 your.mp4 | sort | uniq -c
```

The committed `assets/video.mp4` is such a file: 1920×1080, 66 frames, 66
keyframes, no audio, 8 fps, 6.6 MB, used as delivered.

**Do not skip the encode step.** It is the single biggest factor in how this
feels, bigger than any JavaScript in here. A normal export places a keyframe
every few seconds, so seeking to an arbitrary time forces the decoder to decode
forward from the last keyframe — dozens of frames of work for one scroll event.
`tools/encode.sh` produces an all-intra file (`-g 1`) where every frame is a
keyframe, so every seek is exactly one decode.

Guidelines that matter more than they look:

| Knob | Aim for | Why |
| --- | --- | --- |
| Duration | 5–15s | The whole file ends up held in memory. |
| File size | under ~15 MB | It downloads in the background; smaller means memory-speed sooner. |
| Frame rate | 24–30fps | Below ~15fps the stepping is visible under a slow scroll; above 30 you pay bytes for detail scrubbing cannot resolve. |
| Width | 1280–1920 | Scaled to `cover` anyway. |
| Audio | none | Stripped by the encoder; it can never play here. |

Shoot or cut for it: locked-off camera, slow continuous motion, no hard cuts.
Cuts read as glitches when the viewer controls the speed.

## Loading

`videoStrategy` in [js/main.js](js/main.js):

- **`progressive`** (default) — the page is interactive as soon as the metadata
  arrives, which for a faststart file is the first ~1 KB rather than the whole
  download. Scrubbing runs over the network via range requests while the full
  file is fetched in the background, then the source is swapped to an in-memory
  copy mid-session. The swap holds the current frame on a canvas so it does not
  flash.
- **`buffer-first`** — download everything, then reveal. Every seek is instant
  from the very first one, at the cost of a loading bar. Reasonable only for
  small files.

Progressive costs a little bandwidth: the media element's range requests overlap
the background fetch. `Cache-Control` on the dev server (and on any sane host)
keeps that overlap small.

## Frame count sets the ceiling

Smoothness is bounded by how many distinct frames exist. Easing cannot invent
picture that is not in the file — it only controls how the playhead travels
between frames that are.

Divide `--scroll-length` by the frame count to see what you are asking for. The
committed video has 66 frames over `400vh`, so a new frame lands every ~6vh of
scroll. That reads as smooth at a normal scroll speed and slightly stepped if
you drag the scrollbar slowly. Lengthening `--scroll-length` makes this *worse*,
not better — it spreads the same frames over more pixels.

If you want it perfectly fluid, re-export the source at 24fps and the ceiling
rises with the frame count.

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
- `videoFps` — must match the encoded rate (currently `8`).
- `videoStrategy` — `'progressive'` or `'buffer-first'`, see above.

Top of [css/style.css](css/style.css):

- `--scroll-length` — how much scrolling the sequence is spread across (`400vh`).
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
- Memory scales with file size, since the video ends up buffered as a blob. This
  is the deliberate trade for instant seeks — respect the size budget above.
- In progressive mode the first few seconds scrub over the network, so seeks are
  slower until the background download finishes. On a slow connection that
  window is longer.
- `prefers-reduced-motion` disables the easing and applies scroll position
  directly.
