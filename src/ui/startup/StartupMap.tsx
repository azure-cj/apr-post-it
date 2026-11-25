import { useEffect, useRef, useState } from 'react';
import { fitMap, GLOW_CENTRE, PH_BOUNDS, project, type Frame, type MapPoint } from './geo';
// The islands, faint under the dots, so the dots read as a map (scripts/ph-land.mjs).
import LAND from './ph-land.json';

/** The wave: a gold ring that spreads from Manila, uncovering the islands and lighting each listing as it passes. */
const WAVE_MS = 1000;
/** A little scatter in when a dot lights after the wave reaches it, so a city twinkles on rather than all at once. */
const SCATTER_MS = 400;
/** How long one dot takes to fade in. */
const DOT_FADE_MS = 150;
/** The whole cascade: the last dot has arrived by then. */
export const CASCADE_MS = WAVE_MS + SCATTER_MS + DOT_FADE_MS;
/** Once the dots are in, a listing sends out a soft ring every PING_EVERY_MS, each fading over PING_MS. */
const PING_EVERY_MS = 380;
const PING_MS = 1600;
/** The glow behind Manila breathes, once every BREATH_MS. */
const BREATH_MS = 3600;
/** Radii at the reference size (a 750px-tall map, as at 1366×768). */
const RADIUS_MIN = 1.2;
const RADIUS_MAX = 2.0;
const REFERENCE_HEIGHT = 750;

/** How far the wave goes, in degrees: from the glow to the farthest corner of the map. */
const REACH = Math.max(
  ...[PH_BOUNDS.south, PH_BOUNDS.north].flatMap((lat) =>
    [PH_BOUNDS.west, PH_BOUNDS.east].map((lng) => Math.hypot(lat - GLOW_CENTRE.lat, lng - GLOW_CENTRE.lng)),
  ),
);

/** How far the wave has spread `t` ms in, as a share of REACH: quick at first, easing out. */
function spread(t: number): number {
  const x = Math.min(1, Math.max(0, t / WAVE_MS));
  return 1 - (1 - x) * (1 - x);
}

/** When the wave reaches `share` of REACH, in ms: the inverse of spread(). */
function reachedAt(share: number): number {
  return WAVE_MS * (1 - Math.sqrt(1 - Math.min(1, share)));
}

interface Colours {
  readonly dot: string;
}

/**
 * Draws the map at `elapsed` ms after the screen opened: the glow, the land as
 * far as the wave has spread, the wave, every dot it has lit, and the pings.
 * `dotsAt` is when the dots' own cascade started: 0 when they came with the
 * first wave, later when the list came after it (they get a wave of their own).
 * `Infinity` draws the finished, still map. Returns how many dots were drawn.
 */
export function drawMap(
  ctx: CanvasRenderingContext2D,
  points: readonly MapPoint[],
  width: number,
  height: number,
  elapsed: number,
  colours: Colours,
  dotsAt = 0,
): number {
  ctx.clearRect(0, 0, width, height);
  const frame = fitMap(width, height);
  if (frame.height <= 0) return 0;
  const still = elapsed === Infinity;
  const scale = Math.max(0.75, frame.height / REFERENCE_HEIGHT);

  drawGlow(ctx, frame, colours.dot, elapsed);
  drawLand(ctx, frame, colours.dot, still ? 1 : spread(elapsed));
  if (!still) {
    drawWave(ctx, frame, colours.dot, elapsed, scale);
    if (dotsAt > 0) drawWave(ctx, frame, colours.dot, elapsed - dotsAt, scale);
  }
  if (points.length === 0) return 0;

  ctx.fillStyle = colours.dot;
  let drawn = 0;
  for (const p of points) {
    const arrived = still ? 1 : Math.min(1, Math.max(0, (elapsed - startOf(p)) / DOT_FADE_MS));
    if (arrived <= 0) continue;
    const { x, y } = project(p.lat, p.lng, frame);
    ctx.globalAlpha = p.opacity * arrived;
    ctx.beginPath();
    // A dot lands a little large and settles to its size.
    const radius = (RADIUS_MIN + (RADIUS_MAX - RADIUS_MIN) * p.size) * scale * (1 + 0.8 * (1 - arrived));
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    drawn++;
  }
  ctx.globalAlpha = 1;

  // The pings start once the wave has carried the dots out.
  if (!still) drawPings(ctx, points, frame, colours.dot, elapsed - dotsAt - WAVE_MS * 0.7, scale);
  return drawn;

  function startOf(p: MapPoint): number {
    const share = Math.hypot(p.lat - GLOW_CENTRE.lat, p.lng - GLOW_CENTRE.lng) / REACH;
    return dotsAt + reachedAt(share) + p.delay * SCATTER_MS;
  }
}

/** Degrees to pixels: one degree is the same size both ways. */
function perDegree(frame: Frame): number {
  return frame.height / (PH_BOUNDS.north - PH_BOUNDS.south);
}

/** A soft gold light behind Metro Manila: it grows in with the wave, then breathes. */
function drawGlow(ctx: CanvasRenderingContext2D, frame: Frame, colour: string, elapsed: number): void {
  const still = elapsed === Infinity;
  const grown = still ? 1 : spread(elapsed * 1.5);
  const breath = still ? 1 : 1 + 0.18 * Math.sin((elapsed / BREATH_MS) * Math.PI * 2);
  const strength = grown * breath;
  if (strength <= 0) return;
  const { x, y } = project(GLOW_CENTRE.lat, GLOW_CENTRE.lng, frame);
  const radius = frame.height * 0.26 * (0.8 + 0.2 * grown);
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, withAlpha(colour, 0.17 * strength));
  glow.addColorStop(0.55, withAlpha(colour, 0.06 * strength));
  glow.addColorStop(1, withAlpha(colour, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

/** The islands, as far as `shown` (a share of REACH) from the glow: a whisper of gold inside, a fine gold coast. */
function drawLand(ctx: CanvasRenderingContext2D, frame: Frame, colour: string, shown: number): void {
  if (shown <= 0) return;
  const clipped = shown < 1;
  if (clipped) {
    const { x, y } = project(GLOW_CENTRE.lat, GLOW_CENTRE.lng, frame);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, shown * REACH * perDegree(frame), 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.beginPath();
  for (const ring of LAND as readonly (readonly number[])[]) {
    for (let i = 0; i + 1 < ring.length; i += 2) {
      const { x, y } = project(ring[i + 1]!, ring[i]!, frame);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.fillStyle = withAlpha(colour, 0.06);
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(0.6, frame.height / REFERENCE_HEIGHT);
  ctx.strokeStyle = withAlpha(colour, 0.3);
  ctx.stroke();
  if (clipped) ctx.restore();
}

/** The wave `t` ms after it set out: a fine ring with a soft halo, fading as it goes. */
function drawWave(ctx: CanvasRenderingContext2D, frame: Frame, colour: string, t: number, scale: number): void {
  if (t <= 0 || t >= WAVE_MS) return;
  const radius = spread(t) * REACH * perDegree(frame);
  const fade = 1 - t / WAVE_MS;
  const { x, y } = project(GLOW_CENTRE.lat, GLOW_CENTRE.lng, frame);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = withAlpha(colour, 0.1 * fade);
  ctx.lineWidth = 8 * scale;
  ctx.stroke();
  ctx.strokeStyle = withAlpha(colour, 0.5 * fade);
  ctx.lineWidth = 1.4 * scale;
  ctx.stroke();
}

/** Rings that open out from one listing after another, `t` ms after the first: the map, alive while it waits. */
function drawPings(ctx: CanvasRenderingContext2D, points: readonly MapPoint[], frame: Frame, colour: string, t: number, scale: number): void {
  if (t < 0) return;
  ctx.lineWidth = scale;
  for (let k = Math.max(0, Math.ceil((t - PING_MS) / PING_EVERY_MS)); k * PING_EVERY_MS <= t; k++) {
    const age = (t - k * PING_EVERY_MS) / PING_MS;
    if (age >= 1) continue;
    // A golden-ratio stride, so the pings wander over the map rather than march along the list.
    const p = points[Math.floor(((k * 0.6180339887) % 1) * points.length)]!;
    const { x, y } = project(p.lat, p.lng, frame);
    const opened = 1 - (1 - age) * (1 - age);
    ctx.beginPath();
    ctx.arc(x, y, (2 + 12 * opened) * scale, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(colour, 0.55 * (1 - age) * (1 - age));
    ctx.stroke();
  }
}

/** "#e0b84a" at `alpha`, as rgba(): canvas gradients take no CSS variables. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return `rgba(224, 184, 74, ${alpha})`;
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`;
}

export interface StartupMapProps {
  readonly points: readonly MapPoint[];
  /** Draw the finished map at once, still: no wave, no breathing, no pings. */
  readonly reducedMotion: boolean;
}

/**
 * The islands and every listing as a gold dot, on one canvas, sharp at any
 * devicePixelRatio. A wave spreads from Manila as the screen opens, uncovering
 * the land and lighting the dots as it passes; a list that comes after it gets
 * a wave of its own, and a later list (the fresh one after the saved one)
 * joins at once. Then, until the screen goes, the glow breathes and the
 * listings ping. Decorative: the screen says the count in words.
 */
export function StartupMap({ points, reducedMotion }: StartupMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startedAt = useRef<number | null>(null);
  const dotsAt = useRef<number | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  // Follow the canvas's own size: the window can be resized while the screen is up.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const measure = () => {
      const box = canvas.getBoundingClientRect();
      setSize((was) => (was && was.width === box.width && was.height === box.height ? was : { width: box.width, height: box.height }));
    };
    measure();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(measure);
      observer.observe(canvas);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return undefined;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return undefined;
    const context = ctx;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(size.width * dpr);
    const pixelHeight = Math.round(size.height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colours = { dot: getComputedStyle(canvas).getPropertyValue('--gold').trim() || '#e0b84a' };

    if (reducedMotion) {
      drawMap(context, points, size.width, size.height, Infinity, colours);
      return undefined;
    }
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    startedAt.current ??= now();
    const start = startedAt.current;
    if (points.length > 0 && dotsAt.current === null) {
      const at = now() - start;
      // Dots that come while the first wave is still out ride it; later ones get a wave of their own.
      dotsAt.current = at < WAVE_MS ? 0 : at;
    }
    const cascade = dotsAt.current ?? 0;
    let frame = 0;
    const tick = () => {
      drawMap(context, points, size.width, size.height, now() - start, colours, cascade);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [points, size, reducedMotion]);

  return <canvas ref={canvasRef} className="startup__map" aria-hidden="true" />;
}
