/**
 * The flyer (1.1.8): an optional picture of the listing to post, page 1 the
 * flyer, then pages of the photos that don't fit on it, then, if asked for, a
 * satellite map with the "somewhere in here" ring. Made only from the text
 * Copy takes, so nothing below the line goes on it.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toBlob } from 'html-to-image';
import { flyerContent, FLYER_DEALS, laterPages, LOOKS, OFFICE_DEALS, PER_PAGE_CHOICES, POSTER_SIZE_ORDER, POSTER_SIZES, type FlyerDeal, type FlyerLook, type PerPage, type PosterSize } from '@/core/flyer';
import { UserFacingError, type Photo, type PropertyDetail } from '@/core/types';
import { Button } from '../../../components';
import { sentenceOf, useApp } from '../../../state';
import { Dialog } from '../../manager/Dialog';
import { FlyerPage, MAP_BOX, PAGE_H, PAGE_W, pageHeight, type FlyerModel, type FlyerPageKind, type MapState } from './FlyerPages';
import { drawLocationMap } from './locationMap';
import './Flyer.css';

export interface FlyerDialogProps {
  readonly detail: PropertyDetail;
  /** The text Copy takes. */
  readonly text: string;
  readonly onClose: () => void;
}

type Status = { readonly tone: 'ok' | 'fail' | 'busy'; readonly text: string; readonly folder?: string } | null;
const LOOK_ORDER: readonly FlyerLook[] = ['framed', 'big', 'light', 'poster'];

export function FlyerDialog({ detail, text, onClose }: FlyerDialogProps) {
  const app = useApp();
  const content = useMemo(() => flyerContent(text, detail), [text, detail]);
  // A virtual office post is a plan, not a property: its own deals, and no map, since it has no position (D42).
  const office = content.virtualOffice;
  const photos = detail.photos;

  const [look, setLook] = useState<FlyerLook>('framed');
  const [picked, setPicked] = useState<readonly string[]>(() => photos.slice(0, LOOKS.framed.photos).map((p) => p.id));
  const [per, setPer] = useState<PerPage>(4);
  const [page, setPage] = useState(0);
  const [kind, setKind] = useState(content.kind);
  const [deal, setDeal] = useState<FlyerDeal>(content.deal);
  const [title, setTitle] = useState(content.title);
  const [place, setPlace] = useState(content.place ?? '');
  const [on, setOn] = useState({ size: content.size !== null, lease: content.lease !== null, sale: content.sale !== null, place: content.place !== null });
  const [highlightsOn, setHighlightsOn] = useState<readonly boolean[]>(() => content.highlights.map((_, i) => i < 4));
  const [withMap, setWithMap] = useState(false);
  const [posterSize, setPosterSize] = useState<PosterSize>('feed');
  const [priceBadge, setPriceBadge] = useState(false);
  const poster = look === 'poster';
  // The poster is one picture: no map page with it.
  const mapOn = withMap && !poster;
  const [maps, setMaps] = useState<Partial<Record<FlyerLook, MapState>>>({});
  const [status, setStatus] = useState<Status>(null);
  const [working, setWorking] = useState<'copy' | 'save' | null>(null);
  const busy = working !== null;
  const copyRef = useRef<HTMLButtonElement>(null);

  // ---- the photos, as pixels the page can be made from (a Drive link can't be drawn on a canvas) ----
  const [data, setData] = useState<ReadonlyMap<string, string>>(new Map());
  const failed = useRef(new Map<string, string>());
  const loading = useRef(new Map<string, Promise<string>>());
  const byId = useMemo(() => new Map(photos.map((p, i) => [p.id, { photo: p, label: `Photo ${i + 1}` }])), [photos]);
  const load = useCallback(
    (id: string): Promise<string> => {
      const known = loading.current.get(id);
      if (known) return known;
      const item = byId.get(id);
      if (!item) return Promise.reject(new UserFacingError('That photo is no longer in the folder.'));
      const job = app.platform.photoData(item.photo.url, item.label).then(
        (src) => {
          setData((before) => new Map(before).set(id, src));
          return src;
        },
        (err: unknown) => {
          failed.current.set(id, sentenceOf(err));
          loading.current.delete(id);
          throw err;
        },
      );
      loading.current.set(id, job);
      return job;
    },
    [app.platform, byId],
  );
  useEffect(() => {
    for (const id of picked) void load(id).catch(() => undefined);
  }, [picked, load]);
  const srcOf = (id: string) => data.get(id) ?? byId.get(id)?.photo.thumb ?? '';

  // ---- the location map: the ring once, then a picture per look (each look's box is its own shape) ----
  const ring = useRef<Promise<readonly (readonly [number, number])[]> | null>(null);
  useEffect(() => {
    if (!withMap || look === 'poster' || maps[look]) return;
    setMaps((before) => ({ ...before, [look]: { status: 'loading' } }));
    ring.current ??= app.tracker.locationRing(detail.id).then((r) => r.ring);
    const box = MAP_BOX[look];
    ring.current
      .then((points) => drawLocationMap(points, box.w, box.h))
      .then(
        (shot) => setMaps((before) => ({ ...before, [look]: { status: 'ready', shot } })),
        (err: unknown) => {
          ring.current = null;
          setMaps((before) => ({ ...before, [look]: { status: 'failed', message: sentenceOf(err) } }));
        },
      );
  }, [withMap, look, maps, app.tracker, detail.id]);
  const mapState: MapState = maps[look] ?? { status: 'loading' };

  // ---- what goes where ----
  const max = LOOKS[look].highlights;
  const model: FlyerModel = {
    look,
    kind: kind.trim() || content.kind,
    deal,
    title: title.trim() || content.title,
    place: on.place && place.trim() ? place.trim() : null,
    shortPlace: on.place && place.trim() ? place.split(',').map((p) => p.trim()).filter(Boolean).slice(-2).join(', ') : null,
    size: on.size ? content.size : null,
    sizeLabel: content.sizeLabel,
    lease: on.lease && deal !== 'For sale' ? content.lease : null,
    sale: on.sale && deal !== 'For lease' ? content.sale : null,
    highlights: content.highlights.filter((_, i) => highlightsOn[i]).slice(0, max),
    numbers: content.numbers,
    email: content.email,
    facebook: content.facebook,
    posterSize,
    priceBadge,
    virtualOffice: office,
  };
  const pageH = pageHeight(model);

  const pagesFor = (srcs: (id: string) => string, forLook: FlyerLook = look): FlyerPageKind[] => {
    const coverCount = Math.min(LOOKS[forLook].photos, picked.length);
    const later = laterPages(picked, forLook, per);
    const map = withMap && forLook !== 'poster';
    const total = 1 + later.length + (map ? 1 : 0);
    return [
      { type: 'cover', photos: picked.slice(0, coverCount).map(srcs) },
      ...later.map((ids, i) => ({ type: 'photos' as const, photos: ids.map(srcs), no: i + 2, total })),
      ...(map ? [{ type: 'map' as const, map: mapState, no: total, total }] : []),
    ];
  };
  const pages = pagesFor(srcOf);
  const shown = Math.min(page, pages.length - 1);
  const coverCount = Math.min(LOOKS[look].photos, picked.length);

  // ---- making the pictures ----
  const exportRoot = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  /** Every page as a PNG, 1080 wide (1350 tall, or the poster's shape), made from the full photos. */
  const render = async (only?: number): Promise<Uint8Array[]> => {
    if (picked.length === 0) throw new UserFacingError(poster ? 'Pick a photo for the poster.' : 'Pick at least one photo for the flyer.');
    if (mapOn && mapState.status !== 'ready') {
      throw new UserFacingError(mapState.status === 'loading' ? 'The map is still loading. Try again in a moment.' : 'The map page has no map. Turn it off, or try again.');
    }
    const ids = only === undefined ? picked : idsOnPage(only);
    for (const id of ids) {
      try {
        await load(id);
      } catch {
        throw new UserFacingError(`${byId.get(id)?.label ?? 'A photo'} couldn't be loaded: ${failed.current.get(id) ?? 'try again'}`);
      }
    }
    setExporting(true);
    try {
      await nextFrame();
      await nextFrame();
      const root = exportRoot.current;
      if (!root) throw new UserFacingError('The flyer could not be made. Close it and try again.');
      const nodes = [...root.querySelectorAll<HTMLElement>(':scope > .fl')];
      const chosen = only === undefined ? nodes : [nodes[only]!];
      await Promise.all(chosen.flatMap((n) => [...n.querySelectorAll('img')].map((img) => (typeof img.decode === 'function' ? img.decode().catch(() => undefined) : undefined))));
      const out: Uint8Array[] = [];
      for (const node of chosen) {
        const blob = await toBlob(node, { width: PAGE_W, height: pageH, pixelRatio: 2, cacheBust: false });
        if (!blob) throw new UserFacingError('The flyer could not be made. Try again.');
        out.push(new Uint8Array(await blob.arrayBuffer()));
      }
      return out;
    } finally {
      setExporting(false);
    }
  };

  const idsOnPage = (i: number): readonly string[] => {
    if (i === 0) return picked.slice(0, coverCount);
    return laterPages(picked, look, per)[i - 1] ?? [];
  };

  const copy = async () => {
    if (busy) return;
    setWorking('copy');
    setStatus({ tone: 'busy', text: `Making page ${shown + 1}…` });
    try {
      const [png] = await render(shown);
      await app.platform.copyImage(png!, `Page ${shown + 1}`);
      setStatus({ tone: 'ok', text: poster ? 'Poster copied. Paste it into Facebook with Ctrl+V, then add the photos.' : `Page ${shown + 1} copied. Paste it into Facebook with Ctrl+V.` });
    } catch (err) {
      setStatus({ tone: 'fail', text: sentenceOf(err) });
    } finally {
      setWorking(null);
    }
  };

  const save = async () => {
    if (busy) return;
    setWorking('save');
    setStatus({ tone: 'busy', text: poster ? 'Making the poster…' : pages.length > 1 ? `Making ${pages.length} pages…` : 'Making the flyer…' });
    try {
      const pngs = await render();
      // "00 Poster" sorts before every photo in the folder, so it goes up first.
      const folder = await app.platform.saveImages(
        detail.name,
        pngs.map((png, i) => ({ name: poster ? '00 Poster.png' : pngs.length > 1 ? `Flyer ${i + 1}.png` : 'Flyer.png', png })),
      );
      setStatus({
        tone: 'ok',
        text: poster ? 'Poster saved first in the photos folder. Post it first, then the photos.' : pngs.length > 1 ? `${pngs.length} pages saved with the photos.` : 'Flyer saved with the photos.',
        folder,
      });
    } catch (err) {
      setStatus({ tone: 'fail', text: sentenceOf(err) });
    } finally {
      setWorking(null);
    }
  };

  // ---- choosing photos ----
  const toggle = (id: string) => {
    // The poster takes one photo: a click makes it the one, and keeps the others' order for the other looks.
    if (poster) {
      makeBig(id);
      setStatus(null);
      return;
    }
    setPicked((before) => (before.includes(id) ? before.filter((x) => x !== id) : [...before, id]));
    setStatus(null);
  };
  const makeBig = (id: string) => setPicked((before) => [id, ...before.filter((x) => x !== id)]);
  const later = laterPages(picked, look, per);
  const plan = poster
    ? picked.length === 0
      ? 'Pick the photo for the poster.'
      : 'The poster uses the Big photo. Click another to use it instead.'
    : picked.length === 0
      ? 'Pick at least one photo.'
      : later.length === 0
        ? `The flyer, with ${count(coverCount, 'photo')}.`
        : `The flyer with ${count(coverCount, 'photo')}, then ${picked.length - coverCount} more on ${later.length === 1 ? 'page 2' : `pages 2 to ${later.length + 1}`}.`;
  const highlightCount = content.highlights.filter((_, i) => highlightsOn[i]).length;

  return (
    <Dialog
      title="Flyer"
      size="wide"
      className="flyer"
      onClose={onClose}
      busy={busy}
      initialFocus={copyRef}
      actions={
        <>
          <p className="flyer__safe meta">Only the text Copy takes: nothing below the line.</p>
          <Button onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button onClick={() => void save()} busy={working === 'save'} disabled={picked.length === 0 || working === 'copy'}>
            {poster ? 'Save the poster' : pages.length > 1 ? `Save all ${pages.length} pages` : 'Save the flyer'}
          </Button>
          <Button ref={copyRef} variant="primary" nudge onClick={() => void copy()} busy={working === 'copy'} disabled={picked.length === 0 || working === 'save'}>
            {pages.length > 1 ? `Copy page ${shown + 1}` : 'Copy image'}
          </Button>
        </>
      }
    >
      <div className="flyer__body">
        <div className="flyer__stage">
          <p className="flyer__note meta">{poster ? `Made at ${POSTER_SIZES[posterSize].made}.` : "Made at 1080 × 1350, the shape Facebook's feed shows whole."}</p>
          <div className="flyer__paper">
            <Scaled width={PAGE_W * (pageH > PAGE_H ? 0.6 : 0.8)} height={pageH}>
              <FlyerPage model={model} page={pages[shown]!} />
            </Scaled>
          </div>
          <div className="flyer__pager" role="group" aria-label="Pages">
            {pages.map((p, i) => (
              <button
                key={i}
                type="button"
                className="flyer__pg"
                aria-current={i === shown || undefined}
                aria-label={i === 0 ? 'Page 1, the flyer' : p.type === 'map' ? `Page ${i + 1}, the map` : `Page ${i + 1}, photos`}
                onClick={() => setPage(i)}
              >
                <Scaled width={48} height={pageH}>
                  <FlyerPage model={model} page={p} />
                </Scaled>
                <span>{i + 1}</span>
              </button>
            ))}
          </div>
          {status ? (
            <p className={`flyer__status flyer__status--${status.tone}`} role="status">
              {status.text}
              {status.folder ? (
                <Button variant="link" onClick={() => void app.platform.open(status.folder!)}>
                  Open folder
                </Button>
              ) : null}
            </p>
          ) : (
            <p className="flyer__status" role="status" />
          )}
        </div>

        <div className="flyer__panel">
          <section className="flyer__grp" aria-labelledby="flyer-look">
            <h3 id="flyer-look">Look</h3>
            <div className="flyer__looks">
              {LOOK_ORDER.map((l) => (
                <button key={l} type="button" className="flyer__look" aria-pressed={look === l} onClick={() => setLook(l)}>
                  <span className="flyer__mini">
                    <Scaled width={80}>
                      <FlyerPage model={{ ...model, look: l, posterSize: 'feed', highlights: content.highlights.filter((_, i) => highlightsOn[i]).slice(0, LOOKS[l].highlights) }} page={pagesFor(srcOf, l)[0]!} />
                    </Scaled>
                  </span>
                  {LOOKS[l].name}
                </button>
              ))}
            </div>
            {poster ? (
              <div className="flyer__row">
                <span className="flyer__per">
                  Size
                  <span className="flyer__seg" role="group" aria-label="Poster size">
                    {POSTER_SIZE_ORDER.map((s) => (
                      <button key={s} type="button" aria-pressed={posterSize === s} onClick={() => setPosterSize(s)}>
                        {POSTER_SIZES[s].name}
                      </button>
                    ))}
                  </span>
                </span>
                {model.lease || model.sale ? (
                  <label className="flyer__check flyer__check--inline">
                    <input type="checkbox" checked={priceBadge} onChange={(e) => setPriceBadge(e.target.checked)} />
                    <span>Price badge</span>
                  </label>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="flyer__grp" aria-labelledby="flyer-photos">
            <h3 id="flyer-photos">
              Photos to post <small>{picked.length} of {photos.length}</small>
            </h3>
            <div className="flyer__row">
              {poster ? null : (
                <>
                  <Button size="small" onClick={() => setPicked(photos.map((p) => p.id))}>
                    All {photos.length}
                  </Button>
                  <Button size="small" onClick={() => setPicked((before) => before.slice(0, LOOKS[look].photos))}>
                    Flyer only
                  </Button>
                </>
              )}
              {poster ? null : <span className="flyer__per">
                Later pages
                <span className="flyer__seg" role="group" aria-label="Photos on each later page">
                  {PER_PAGE_CHOICES.map((n) => (
                    <button key={n} type="button" aria-pressed={per === n} onClick={() => setPer(n)}>
                      {n}
                    </button>
                  ))}
                </span>
              </span>}
            </div>
            <p className="flyer__plan">{plan}</p>
            <div className="flyer__picks">
              {photos.map((photo: Photo, i) => {
                const k = picked.indexOf(photo.id);
                const cover = k >= 0 && k < coverCount;
                const label = k < 0 ? `Photo ${i + 1}: not on the flyer. Click to add it.` : `Photo ${i + 1}: number ${k + 1}${cover ? ', on the flyer' : ''}. Click to take it out.`;
                return (
                  <span key={photo.id} className={`flyer__pick${k >= 0 ? ' is-in' : ''}${cover ? ' is-cover' : ''}`}>
                    <button type="button" aria-pressed={k >= 0} aria-label={label} title={label} onClick={() => toggle(photo.id)}>
                      <img src={photo.thumb} alt="" loading="lazy" />
                      {k >= 0 ? <span className="flyer__no">{k === 0 ? 'Big' : k + 1}</span> : null}
                    </button>
                    {k > 0 ? (
                      <button type="button" className="flyer__star" aria-label={`Make photo ${i + 1} the big one`} title="Make it the big one" onClick={() => makeBig(photo.id)}>
                        ★
                      </button>
                    ) : null}
                  </span>
                );
              })}
            </div>
            <p className="flyer__hint meta">
              {poster ? 'Post the poster first, then the photos.' : "Click a photo to add it or take it out. The numbers are the order they're posted in."}
            </p>
          </section>

          <section className="flyer__grp" aria-labelledby="flyer-heading">
            <h3 id="flyer-heading">Heading</h3>
            <input className="flyer__in" aria-label="What it is" value={kind} onChange={(e) => setKind(e.target.value)} />
            <span className="flyer__seg flyer__seg--full" role="group" aria-label={office ? 'Deal' : 'Sale or lease'}>
              {(office ? OFFICE_DEALS : FLYER_DEALS).map((d) => (
                <button key={d} type="button" aria-pressed={deal === d} onClick={() => setDeal(d)}>
                  {d}
                </button>
              ))}
            </span>
            {look === 'big' ? <input className="flyer__in" aria-label="Title, for Big photo" value={title} onChange={(e) => setTitle(e.target.value)} /> : null}
          </section>

          <section className="flyer__grp" aria-labelledby="flyer-facts">
            <h3 id="flyer-facts">
              From the post <small>{max === 0 ? `${LOOKS[look].name} shows no highlights` : `${Math.min(highlightCount, max)} of ${max} highlights fit`}</small>
            </h3>
            <ul className="flyer__facts">
              {content.size ? <Fact label={content.sizeLabel} value={`${content.size} sqm`} checked={on.size} onChange={(v) => setOn({ ...on, size: v })} /> : null}
              {content.lease ? (
                <Fact label={office ? 'Price' : 'For lease'} value={`${content.lease.amount} ${content.lease.unit}`.trim()} checked={on.lease} off={deal === 'For sale'} onChange={(v) => setOn({ ...on, lease: v })} />
              ) : null}
              {content.sale ? (
                <Fact label="For sale" value={`${content.sale.amount} ${content.sale.unit}`} checked={on.sale} off={deal === 'For lease'} onChange={(v) => setOn({ ...on, sale: v })} />
              ) : null}
              <li>
                <label>
                  <input type="checkbox" checked={on.place} onChange={(e) => setOn({ ...on, place: e.target.checked })} />
                  <span>
                    <span className="flyer__k">Place</span>
                    <input className="flyer__in flyer__in--inline" aria-label="Place" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Town, province" />
                  </span>
                </label>
              </li>
              {content.highlights.length > 0 ? <li className="flyer__sub">Highlights</li> : null}
              {content.highlights.map((h, i) => {
                const before = content.highlights.slice(0, i).filter((_, j) => highlightsOn[j]).length;
                return (
                  <Fact
                    key={h}
                    value={h}
                    checked={highlightsOn[i] ?? false}
                    off={Boolean(highlightsOn[i]) && before >= max}
                    onChange={(v) => setHighlightsOn((all) => all.map((x, j) => (j === i ? v : x)))}
                  />
                );
              })}
            </ul>
          </section>

          {poster || office ? null : <section className="flyer__grp" aria-labelledby="flyer-map">
            <h3 id="flyer-map">Location map</h3>
            <label className="flyer__check">
              <input type="checkbox" checked={withMap} onChange={(e) => setWithMap(e.target.checked)} />
              <span>
                Add a satellite map page
                <span className="flyer__k">A red ring around the area, never the exact spot. The address is shared after they inquire.</span>
              </span>
            </label>
            {withMap && mapState.status === 'failed' ? (
              <p className="flyer__hint flyer__hint--fail">
                {mapState.message}{' '}
                <Button variant="link" onClick={() =>
                    setMaps((before) => {
                      const next = { ...before };
                      delete next[look];
                      return next;
                    })
                  }>
                  Try again
                </Button>
              </p>
            ) : null}
          </section>}
        </div>
      </div>

      {/* The pages at full size, off screen, made from the full photos: what Copy and Save turn into pictures. */}
      {exporting ? (
        <div className="flyer__export" ref={exportRoot} aria-hidden="true">
          {pagesFor((id) => data.get(id) ?? '').map((p, i) => (
            <FlyerPage key={i} model={model} page={p} />
          ))}
        </div>
      ) : null}
    </Dialog>
  );
}

function Fact({ label, value, checked, off, onChange }: { readonly label?: string; readonly value: string; readonly checked: boolean; readonly off?: boolean; readonly onChange: (on: boolean) => void }) {
  return (
    <li className={off ? 'is-off' : undefined}>
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>
          {label ? <span className="flyer__k">{label}</span> : null}
          {value}
          {off && checked ? <span className="flyer__k">Doesn't fit</span> : null}
        </span>
      </label>
    </li>
  );
}

/** A page, scaled down to `width`. */
function Scaled({ width, height = PAGE_H, children }: { readonly width: number; readonly height?: number; readonly children: ReactNode }) {
  const s = width / PAGE_W;
  return (
    <span className="flyer__scaled" style={{ width, height: height * s }}>
      <span style={{ transform: `scale(${s})` }}>{children}</span>
    </span>
  );
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
