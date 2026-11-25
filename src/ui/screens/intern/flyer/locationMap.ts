/**
 * The flyer's location map (1.1.8): a satellite photo with the red "somewhere
 * in here" ring from the server, drawn with MapLibre off screen and kept as a
 * JPEG. It only ever gets the ring, never the listing's own spot
 * (apg-gis docs/BROCHURE-MAP.md, rules 3 and 6).
 *
 * MapLibre is loaded only when someone asks for a map, so the app starts as fast as before.
 */

import type { StyleSpecification } from 'maplibre-gl';
import { UserFacingError } from '@/core/types';
// MapLibre's worker, as a file of its own: bundled, MapLibre can't find it by itself (as in APG GIS).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

type LngLat = readonly [number, number];

/** What APG GIS's live map uses. Its terms for printed and posted pictures are to be checked before these go out. */
const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const IMAGERY_CREDIT = 'Imagery © Esri, Maxar, Earthstar Geographics';
const NAMES = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const RED = '#e53935';
const WAIT_MS = 25_000;

export interface MapShot {
  /** A JPEG, as a data URL, at twice the size asked for. */
  readonly src: string;
  /** Metres on the ground per CSS pixel of the picture, for the scale bar. */
  readonly metresPerPx: number;
}

/** Draws the ring on satellite at `width` × `height` CSS px (made at twice that), and returns the picture. */
export async function drawLocationMap(ring: readonly LngLat[], width: number, height: number): Promise<MapShot> {
  const { Map: MapLibre, setWorkerUrl } = await import('maplibre-gl');
  setWorkerUrl(workerUrl);
  const top = ring.reduce((a, b) => (b[1] > a[1] ? b : a));
  const coordinates = [ring.map((p) => [p[0], p[1]])];
  const style: StyleSpecification = {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      photo: { type: 'raster', tiles: [IMAGERY], tileSize: 256, maxzoom: 19 },
      names: { type: 'vector', url: NAMES },
      area: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } } },
      tag: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [top[0], top[1]] } } },
    },
    layers: [
      // A little darker and less saturated, so the ring and the names stand out (as on APG GIS).
      { id: 'photo', type: 'raster', source: 'photo', paint: { 'raster-brightness-max': 0.85, 'raster-saturation': -0.15 } },
      { id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': RED, 'fill-opacity': 0.12 } },
      { id: 'area-halo', type: 'line', source: 'area', paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.85 } },
      { id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': RED, 'line-width': 3.5 } },
      // Cities and towns only: a village's or a street's name could name the spot (rule 6).
      {
        id: 'towns',
        type: 'symbol',
        source: 'names',
        'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': 13 },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.6 },
      },
      {
        id: 'tag',
        type: 'symbol',
        source: 'tag',
        layout: { 'text-field': 'Approximate location', 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-anchor': 'bottom', 'text-offset': [0, -0.4], 'text-allow-overlap': true },
        paint: { 'text-color': '#ffffff', 'text-halo-color': RED, 'text-halo-width': 2.4 },
      },
    ],
  };

  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, { position: 'fixed', left: '-20000px', top: '0', width: `${width}px`, height: `${height}px` });
  document.body.appendChild(box);
  const map = new MapLibre({
    container: box,
    style,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    pixelRatio: 2,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  try {
    const lngs = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    // The ring fills a bit over half the frame: enough around it to see the town and the roads.
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: Math.round(Math.min(width, height) * 0.2), maxZoom: 16.5, animate: false },
    );
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new UserFacingError('The satellite map took too long to load. Check the internet and try again.')), WAIT_MS);
      map.once('idle', () => {
        clearTimeout(timer);
        done();
      });
    });
    const lat = map.getCenter().lat;
    const metresPerPx = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
    return { src: map.getCanvas().toDataURL('image/jpeg', 0.9), metresPerPx };
  } finally {
    map.remove();
    box.remove();
  }
}

/** A scale bar about `maxPx` long at most: a round distance and its length in px. */
export function scaleBar(metresPerPx: number, maxPx = 110): { readonly label: string; readonly px: number } {
  const steps = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000, 20_000, 50_000];
  let best = steps[0]!;
  for (const m of steps) if (m / metresPerPx <= maxPx) best = m;
  return { label: best >= 1000 ? `${best / 1000} km` : `${best} m`, px: best / metresPerPx };
}
