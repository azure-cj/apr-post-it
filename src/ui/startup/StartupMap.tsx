import { useEffect, useRef, useState } from 'react';
import { fitMap, GLOW_CENTRE, project, type Frame, type MapPoint } from './geo';

/** The whole cascade: the last dot has arrived by then. */
export const CASCADE_MS = 800;
/** How long one dot takes to fade in. The rest of the cascade is the spread of start times. */
const DOT_FADE_MS = 150;
/** Radii at the reference size (a 750px-tall map, as at 1366×768). */
const RADIUS_MIN = 1.2;
const RADIUS_MAX = 2.0;
const REFERENCE_HEIGHT = 750;

interface Colours {
  readonly dot: string;
}

/**
 * Draws the map at `elapsed` ms into the cascade: the glow, then every dot
 * that has started arriving. `Infinity` draws the finished map.
 * Returns how many dots were drawn.
 */
export function drawMap(
  ctx: CanvasRenderingContext2D,
  points: readonly MapPoint[],
  width: number,
  height: number,
  elapsed: number,
  colours: Colours,
): number {
  ctx.clearRect(0, 0, width, height);
  const frame = fitMap(width, height);
  if (frame.height <= 0 || points.length === 0) return 0;
  drawGlow(ctx, frame, colours.dot);

  const scale = Math.max(0.75, frame.height / REFERENCE_HEIGHT);
  const spread = CASCADE_MS - DOT_FADE_MS;
  ctx.fillStyle = colours.dot;
  let drawn = 0;
  for (const p of points) {
    const arrived = elapsed === Infinity ? 1 : Math.min(1, Math.max(0, (elapsed - p.delay * spread) / DOT_FADE_MS));
    if (arrived <= 0) continue;
    const { x, y } = project(p.lat, p.lng, frame);
    ctx.globalAlpha = p.opacity * arrived;
    ctx.beginPath();
    ctx.arc(x, y, (RADIUS_MIN + (RADIUS_MAX - RADIUS_MIN) * p.size) * scale, 0, Math.PI * 2);
    ctx.fill();
    drawn++;
  }
  ctx.globalAlpha = 1;
  return drawn;
}

/** A soft gold light behind Metro Manila. */
function drawGlow(ctx: CanvasRenderingContext2D, frame: Frame, colour: string): void {
  const { x, y } = project(GLOW_CENTRE.lat, GLOW_CENTRE.lng, frame);
  const radius = frame.height * 0.26;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, withAlpha(colour, 0.17));
  glow.addColorStop(0.55, withAlpha(colour, 0.06));
  glow.addColorStop(1, withAlpha(colour, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

/** "#e0b84a" at `alpha`, as rgba(): canvas gradients take no CSS variables. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return `rgba(224, 184, 74, ${alpha})`;
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`;
}

export interface StartupMapProps {
  readonly points: readonly MapPoint[];
  /** Draw every dot at once, with no cascade. */
  readonly reducedMotion: boolean;
}

/**
 * Every listing as a gold dot on one canvas, sharp at any devicePixelRatio.
 * The dots cascade in over CASCADE_MS the first time there are any; a later
 * list (the fresh one after the saved one) joins the same cascade, or appears
 * at once once it is over. Decorative: the screen says the count in words.
 */
export function StartupMap({ points, reducedMotion }: StartupMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startedAt = useRef<number | null>(null);
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

    const draw = (elapsed: number) => drawMap(context, points, size.width, size.height, elapsed, colours);
    if (reducedMotion || points.length === 0) {
      draw(Infinity);
      return undefined;
    }
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    startedAt.current ??= now();
    const start = startedAt.current;
    let frame = 0;
    const tick = () => {
      const elapsed = now() - start;
      if (elapsed >= CASCADE_MS) {
        draw(Infinity);
        return;
      }
      draw(elapsed);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [points, size, reducedMotion]);

  return <canvas ref={canvasRef} className="startup__map" aria-hidden="true" />;
}
