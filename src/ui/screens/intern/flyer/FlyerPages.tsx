/**
 * The flyer's pages (1.1.8), drawn from docs/mockups/flyer.html: three looks,
 * each with its first page (the flyer), its photo pages, and an optional
 * location map page. Every page is 540 x 675 here and made at 1080 x 1350.
 */

import { useId, type CSSProperties, type ReactNode } from 'react';
import { POSTER_SIZES, rects, type FlyerDeal, type FlyerLook, type FlyerPrice, type PosterSize, type Rect } from '@/core/flyer';
import logo from '@/assets/realty-on-dark.webp';
import { IMAGERY_CREDIT, scaleBar, type MapShot } from './locationMap';
import './Flyer.pages.css';

export const PAGE_W = 540;
export const PAGE_H = 675;

/** What the person chose to show, already filtered: a fact that's off is null or left out. */
export interface FlyerModel {
  readonly look: FlyerLook;
  readonly kind: string;
  readonly deal: FlyerDeal;
  readonly title: string;
  readonly place: string | null;
  readonly shortPlace: string | null;
  readonly size: string | null;
  readonly sizeLabel: string;
  readonly lease: FlyerPrice | null;
  readonly sale: FlyerPrice | null;
  readonly highlights: readonly string[];
  readonly numbers: readonly string[];
  readonly email: string | null;
  /** The poster's: its Facebook page, its shape, and whether the price goes on it as a badge. */
  readonly facebook?: string | null;
  readonly posterSize?: PosterSize;
  readonly priceBadge?: boolean;
  /** A virtual office post (D42): there is no site to view, so the contact strip asks them to inquire. */
  readonly virtualOffice?: boolean;
}

/** How tall a page of this model is, laid out (540 wide). */
export const pageHeight = (m: Pick<FlyerModel, 'look' | 'posterSize'>): number => (m.look === 'poster' ? POSTER_SIZES[m.posterSize ?? 'feed'].h : PAGE_H);

export type FlyerPageKind =
  | { readonly type: 'cover'; readonly photos: readonly string[] }
  | { readonly type: 'photos'; readonly photos: readonly string[]; readonly no: number; readonly total: number }
  | { readonly type: 'map'; readonly map: MapState; readonly no: number; readonly total: number };

export type MapState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly shot: MapShot }
  | { readonly status: 'failed'; readonly message: string };

/** Where the map goes on each look's map page: the same box its photo pages use. */
export const MAP_BOX: Readonly<Record<FlyerLook, Rect>> = {
  framed: { x: 30, y: 128, w: 480, h: 463 },
  big: { x: 0, y: 0, w: 540, h: 613 },
  light: { x: 35, y: 129, w: 470, h: 449 },
  // The poster has no map page; this is never drawn.
  poster: { x: 0, y: 0, w: 540, h: 540 },
};

export function FlyerPage({ model, page }: { readonly model: FlyerModel; readonly page: FlyerPageKind }) {
  if (model.look === 'poster') return <Poster m={model} photo={page.type === 'map' ? undefined : page.photos[0]} />;
  if (model.look === 'framed') {
    if (page.type === 'cover') return <FramedCover m={model} photos={page.photos} />;
    return (
      <FramedMore m={model} no={`${page.no}/${page.total}`} map={page.type === 'map'}>
        {page.type === 'photos' ? (
          rects(page.photos.length, 26, 124, 488, PAGE_H - 64 - 16 - 124, 12).map((r, i) => (
            <div key={i} className="frame" style={at(r)}>
              <Ph src={page.photos[i]!} />
            </div>
          ))
        ) : (
          <div className="frame" style={at({ x: 26, y: 124, w: 488, h: PAGE_H - 64 - 16 - 124 })}>
            <MapBox map={page.map} box={{ x: 4, y: 4, w: MAP_BOX.framed.w, h: MAP_BOX.framed.h }} />
          </div>
        )}
      </FramedMore>
    );
  }
  if (model.look === 'big') {
    if (page.type === 'cover') return <BigCover m={model} photos={page.photos} />;
    return (
      <BigMore m={model} no={page.no} total={page.total}>
        {page.type === 'photos' ? (
          rects(page.photos.length, 0, 0, PAGE_W, PAGE_H - 62, 3).map((r, i) => (
            <div key={i} className="tile" style={at(r)}>
              <img src={page.photos[i]} alt="" />
            </div>
          ))
        ) : (
          <MapBox map={page.map} box={MAP_BOX.big} />
        )}
      </BigMore>
    );
  }
  if (page.type === 'cover') return <LightCover m={model} photos={page.photos} />;
  return (
    <LightMore m={model} no={page.no} total={page.total} map={page.type === 'map'}>
      {page.type === 'photos' ? (
        rects(page.photos.length, 30, 124, 480, PAGE_H - 124 - 92, 14).map((r, i) => (
          <div key={i} className="tile w" style={at(r)}>
            <img src={page.photos[i]} alt="" />
          </div>
        ))
      ) : (
        <div className="tile w" style={at({ x: 30, y: 124, w: 480, h: PAGE_H - 124 - 92 })}>
          <MapBox map={page.map} box={{ x: 0, y: 0, w: MAP_BOX.light.w, h: MAP_BOX.light.h }} />
        </div>
      )}
    </LightMore>
  );
}

// ---------------------------------------------------------------- pieces

const at = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

function Ph({ src, className }: { readonly src: string; readonly className?: string }) {
  return (
    <div className={`ph${className ? ` ${className}` : ''}`}>
      <img src={src} alt="" />
    </div>
  );
}

/** The roof of the Realty logo alone, cut from the whole logo (626 x 374; roof at 154, 17, 313 x 238). */
function Roof({ h }: { readonly h: number }) {
  const s = h / 238;
  return (
    <span className="roof" style={{ width: 313 * s, height: h }}>
      <img src={logo} alt="" style={{ width: 626 * s, left: -154 * s, top: -17 * s }} />
    </span>
  );
}

function MapBox({ map, box }: { readonly map: MapState; readonly box: Rect }) {
  const bar = map.status === 'ready' ? scaleBar(map.shot.metresPerPx) : null;
  return (
    <div className="mapbox" style={at(box)}>
      {map.status === 'ready' ? (
        <>
          <img src={map.shot.src} alt="" />
          <span className="north">
            ↑<br />N
          </span>
          {bar ? (
            <span className="scale" style={{ width: bar.px }}>
              {bar.label}
              <i />
            </span>
          ) : null}
          <span className="credit">{IMAGERY_CREDIT}</span>
        </>
      ) : (
        <span className="wait">{map.status === 'loading' ? 'Drawing the satellite map…' : map.message}</span>
      )}
    </div>
  );
}

const Check = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <path d="m2 5.3 2 2L8 3" fill="none" stroke="#1a1408" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Pin = () => (
  <svg width="12" height="15" viewBox="0 0 12 15" aria-hidden="true">
    <path d="M6 0a6 6 0 0 0-6 6c0 4.5 6 9 6 9s6-4.5 6-9a6 6 0 0 0-6-6Zm0 8.3a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6Z" fill="#e0b84a" />
  </svg>
);

/** The company's gold arc. Each copy gets its own gradient id: a hidden copy's id would hide the others' arcs. */
function Arc() {
  const id = `arc${useId().replace(/:/g, '')}`;
  return (
    <svg className="arc" viewBox="0 0 300 170" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#e0b84a" stopOpacity="0" />
          <stop offset=".35" stopColor="#f2d377" />
          <stop offset="1" stopColor="#b98a26" />
        </linearGradient>
      </defs>
      <path d="M30 0C110 78 210 118 300 120" stroke={`url(#${id})`} strokeWidth="3.2" />
      <path d="M92 0C160 54 236 84 300 88" stroke={`url(#${id})`} strokeWidth="1.2" opacity=".55" />
    </svg>
  );
}

const sizeIsLong = (size: string) => size.length > 5;
const contactLine = (m: FlyerModel) => (m.numbers.length > 0 ? m.numbers.join(' · ') : (m.email ?? 'Alpha Premier Realty'));
/** What the contact strip asks for: a viewing, or for a virtual office, which has no site to view, an inquiry. */
const forWhat = (m: FlyerModel) => (m.virtualOffice ? 'to inquire' : 'for a viewing');
const prices = (m: FlyerModel) => [m.lease && { ...m.lease, key: 'lease' }, m.sale && { ...m.sale, key: 'sale' }].filter((p): p is FlyerPrice & { key: string } => Boolean(p));

// ---------------------------------------------------------------- A · Framed

function FramedFoot({ m, slim, no }: { readonly m: FlyerModel; readonly slim?: boolean; readonly no?: string }) {
  return (
    <div className={`foot${slim ? ' slim' : ''}`}>
      <div>
        <small>{m.numbers.length > 0 ? `Call or text ${forWhat(m)}` : `Message us ${forWhat(m)}`}</small>
        <b>{contactLine(m)}</b>
        {!slim && m.email && m.numbers.length > 0 ? <span className="mail">{m.email}</span> : null}
      </div>
      {no ? <span className="pgno">{no}</span> : null}
    </div>
  );
}

function FramedCover({ m, photos }: { readonly m: FlyerModel; readonly photos: readonly string[] }) {
  const one = photos.length <= 1;
  const money = prices(m);
  return (
    <div className="fl fa">
      <Arc />
      <div className="badge">
        <Roof h={30} />
        <em>REALTY</em>
      </div>
      <div className="deal">{m.deal}</div>
      <h2 style={{ fontSize: m.kind.length > 11 ? 40 : 52 }}>{m.kind}</h2>
      {m.place ? (
        <div className="where">
          <Pin />
          {m.place}
        </div>
      ) : null}
      {photos[0] ? (
        <div className={`frame f1${one ? ' only' : ''}`}>
          <Ph src={photos[0]} />
        </div>
      ) : null}
      {!one && photos[1] ? (
        <div className="frame f2">
          <Ph src={photos[1]} />
        </div>
      ) : null}
      {!one && photos[2] ? (
        <div className="frame f3">
          <Ph src={photos[2]} />
        </div>
      ) : null}
      {money.length > 0 ? (
        <div className={`tag${money.length > 1 ? ' duo' : ''}`}>
          {money.map((p) => (
            <div key={p.key}>
              <b>{p.amount}</b>
              {p.unit ? <span>{p.unit}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {m.size ? (
        <div className="seal" style={{ left: one ? 400 : 290 }}>
          <b className={sizeIsLong(m.size) ? 'long' : undefined}>{m.size}</b>
          <span>SQM</span>
          <small>{m.sizeLabel.toUpperCase()}</small>
        </div>
      ) : null}
      {m.highlights.length > 0 ? (
        <div className="ft">
          <h4>What you get</h4>
          <ul>
            {m.highlights.map((h) => (
              <li key={h}>
                <i>
                  <Check />
                </i>
                {h}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <FramedFoot m={m} />
    </div>
  );
}

function FramedMore({ m, no, map, children }: { readonly m: FlyerModel; readonly no: string; readonly map: boolean; readonly children: ReactNode }) {
  // Beside the map, only the town and province: the ring shouldn't be narrowed down by the words over it.
  const where = map ? (m.shortPlace ? `${m.shortPlace} · exact address on inquiry` : null) : m.place;
  return (
    <div className="fl fa more">
      <Arc />
      <div className="badge">
        <Roof h={24} />
      </div>
      <div className="deal">{m.deal}</div>
      <div className="mk">{m.kind}</div>
      {where ? (
        <div className="where">
          <Pin />
          {where}
        </div>
      ) : null}
      {children}
      <FramedFoot m={m} slim no={no} />
    </div>
  );
}

// ---------------------------------------------------------------- B · Big photo

function BigCover({ m, photos }: { readonly m: FlyerModel; readonly photos: readonly string[] }) {
  const stats = [
    m.size ? (
      <div key="size" className="stat">
        <b>
          {m.size}
          <small>sqm</small>
        </b>
        <span>{m.sizeLabel}</span>
      </div>
    ) : null,
    m.lease ? (
      <div key="lease" className="stat money">
        <b>
          {m.lease.amount}
          {m.lease.unit === 'per sqm' ? <small>/sqm</small> : m.lease.unit === 'a month' ? <small>/mo</small> : m.lease.unit === 'a year' ? <small>/yr</small> : null}
        </b>
        <span>{m.virtualOffice ? 'Price' : 'For lease'}</span>
      </div>
    ) : null,
    m.sale ? (
      <div key="sale" className="stat money">
        <b>{m.sale.amount}</b>
        <span>For sale</span>
      </div>
    ) : null,
  ].filter(Boolean);
  return (
    <div className="fl fb">
      {photos[0] ? <Ph src={photos[0]} className="hero" /> : null}
      <div className="shade" />
      <div className="brand">
        <Roof h={34} />
        <div>
          <b>Alpha Premier Realty</b>
          <small>and Construction Services</small>
        </div>
      </div>
      <span className="deal">{m.deal}</span>
      <div className="kind">
        {m.kind}
        {m.shortPlace ? ` · ${m.shortPlace}` : ''}
      </div>
      <h2>{m.title}</h2>
      {stats.length > 0 ? <div className="stats">{stats}</div> : null}
      {m.highlights.length > 0 ? (
        <ul className="hl" style={{ top: stats.length > 0 ? 488 : 420 }}>
          {m.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      ) : null}
      <div className="foot">
        <div>
          <small>{m.virtualOffice ? 'To inquire, call or text' : 'For a viewing, call or text'}</small>
          <b>Alpha Premier Realty</b>
        </div>
        <div className="nums">
          {(m.numbers.length > 0 ? m.numbers : m.email ? [m.email] : []).map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BigMore({ m, no, total, children }: { readonly m: FlyerModel; readonly no: number; readonly total: number; readonly children: ReactNode }) {
  return (
    <div className="fl fb more">
      {children}
      <div className="chip">
        <Roof h={18} />
        Alpha Premier Realty
      </div>
      <span className="pgpill">
        {no} / {total}
      </span>
      <div className="foot slim">
        <div className="k2">
          <small>
            {m.kind} · {m.deal}
          </small>
          <b>{m.shortPlace ?? ''}</b>
        </div>
        <div className="nums">{contactLine(m)}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- C · Light

function LightCover({ m, photos }: { readonly m: FlyerModel; readonly photos: readonly string[] }) {
  const money = prices(m);
  return (
    <div className="fl fc">
      <div className="bars" />
      <div className="hatch" />
      <div className="corner" />
      <div className="brand">
        <Roof h={30} />
        <b>Alpha Premier Realty</b>
      </div>
      <div className="hd">
        <span className="k">{m.kind}</span>
        <span className="d">{m.deal}</span>
      </div>
      {money.length > 0 ? (
        <div className="money">
          {money.map((p, i) => (
            <span key={p.key}>
              {i > 0 ? <span> · </span> : null}
              {p.amount} {p.unit ? <span>{p.unit}</span> : null}
            </span>
          ))}
        </div>
      ) : null}
      {photos[0] ? <Ph src={photos[0]} className="big" /> : null}
      {photos[1] ? <Ph src={photos[1]} className="small" /> : null}
      {m.size ? (
        <div className="badge">
          <b className={`gold-text${sizeIsLong(m.size) ? ' long' : ''}`}>{m.size}</b>
          <span>SQM</span>
        </div>
      ) : null}
      <div className="info">
        <h5>CONTACT US:</h5>
        <p>
          {m.numbers.map((n) => (
            <span key={n}>
              {n}
              <br />
            </span>
          ))}
          {m.email ? <small>{m.email}</small> : null}
        </p>
        {m.shortPlace ? (
          <>
            <h5>LOCATION:</h5>
            <p>{m.shortPlace}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}

function LightMore({ m, no, total, map, children }: { readonly m: FlyerModel; readonly no: number; readonly total: number; readonly map: boolean; readonly children: ReactNode }) {
  return (
    <div className="fl fc more">
      <div className="bars" />
      <div className="brand">
        <Roof h={26} />
        <b>Alpha Premier Realty</b>
      </div>
      <div className="mk">
        {m.kind} <em>{map ? 'near here' : m.deal.toLowerCase()}</em>
      </div>
      {m.shortPlace ? <div className="sub2">{map ? `${m.shortPlace} · exact address on inquiry` : m.shortPlace}</div> : null}
      {children}
      <div className="foot2">
        <h5>CONTACT US:</h5>
        {contactLine(m)}
      </div>
      <div className="pgbox">
        {no}/{total}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- D · Poster

/** Where things go on each shape: the brand, the deal line, the headline and its size, where the photo is whole, and the contact strip. */
const POSTER_LAYOUT: Readonly<Record<PosterSize, { brand: number; deal: number; head: number; font: number; photo: number; foot: number; text: number }>> = {
  feed: { brand: 22, deal: 74, head: 92, font: 60, photo: 168, foot: 108, text: 13 },
  square: { brand: 18, deal: 62, head: 78, font: 52, photo: 140, foot: 96, text: 12.5 },
  story: { brand: 46, deal: 140, head: 164, font: 72, photo: 280, foot: 156, text: 16 },
};

/** The headline as big as fits on one line, 492 wide: Montserrat Black in capitals is up to about 0.82 of its size a letter (W, M and O are wide). */
const headlineSize = (text: string, most: number) => Math.max(28, Math.min(most, Math.floor(492 / (Math.max(text.length, 1) * 0.84))));

const PhoneIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1Z" fill="#e0b84a" />
  </svg>
);
const MailIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm9 7.2L4.2 7H4v.6l8 5.3 8-5.3V7h-.2L12 12.2Z" fill="#e0b84a" />
  </svg>
);
const FbIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z" fill="#e0b84a" />
  </svg>
);

function Poster({ m, photo }: { readonly m: FlyerModel; readonly photo: string | undefined }) {
  const size = m.posterSize ?? 'feed';
  const h = POSTER_SIZES[size].h;
  const L = POSTER_LAYOUT[size];
  const headline = m.kind.toUpperCase();
  // The whole place when it fits beside the deal, else the town and province.
  const where = m.place && m.place.length <= (size === 'story' ? 26 : 34) ? m.place : m.shortPlace;
  const money = m.priceBadge ? prices(m) : [];
  // The photo starts under the headline and fades in from there, so the words sit on the dark and the photo rises out of it.
  const fade = Math.round(L.font * 1.1);
  const photoTop = L.photo - fade;
  const mask = `linear-gradient(180deg, transparent 0, #000 ${fade}px)`;
  const rows = [
    m.numbers.length > 0 ? { key: 'tel', icon: <PhoneIcon />, text: m.numbers.join('  ·  ') } : null,
    m.email ? { key: 'mail', icon: <MailIcon />, text: m.email } : null,
    m.facebook ? { key: 'fb', icon: <FbIcon />, text: m.facebook } : null,
  ].filter((r) => r !== null);
  return (
    <div className={`fl fp fp--${size}`} style={{ height: h }}>
      {photo ? (
        <div className="ph hero" style={{ top: photoTop, height: h - L.foot - photoTop, WebkitMaskImage: mask, maskImage: mask }}>
          <img src={photo} alt="" />
        </div>
      ) : null}
      <div className="glow" style={{ height: L.photo + 40 }} />
      <div className="brand" style={{ top: L.brand }}>
        <Roof h={size === 'story' ? 34 : 26} />
        <b>Alpha Premier Realty</b>
      </div>
      <div className="deal" style={{ top: L.deal, fontSize: L.text }}>
        <span>{m.deal}</span>
        {where ? <em>{where}</em> : null}
      </div>
      <h2 style={{ top: L.head, fontSize: headlineSize(headline, L.font) }}>{headline}</h2>
      {m.size ? (
        <div className="chip" style={{ bottom: L.foot + 18, fontSize: L.text }}>
          <b>{m.size} sqm</b> {m.sizeLabel.toLowerCase()}
        </div>
      ) : null}
      {money.length > 0 ? (
        <div className="price" style={{ bottom: L.foot + 16 }}>
          {money.map((p) => (
            <div key={p.key}>
              <b>{p.amount}</b>
              {p.unit ? <span>{p.unit}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="foot" style={{ height: L.foot, fontSize: L.text }}>
        <div className="reach">
          <small>{m.numbers.length > 0 ? `Call or message ${forWhat(m)}` : `Message us ${forWhat(m)}`}</small>
          {rows.length > 0 ? (
            rows.map((r) => (
              <span key={r.key} className={`row ${r.key}`}>
                {r.icon}
                {r.text}
              </span>
            ))
          ) : (
            <span className="row">Alpha Premier Realty</span>
          )}
        </div>
        <img className="logo" src={logo} alt="" style={{ height: L.foot - (size === 'story' ? 52 : 36) }} />
      </div>
    </div>
  );
}
