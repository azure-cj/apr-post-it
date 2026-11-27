/**
 * Virtual office: the month's virtual office posts, posters and brochure, made from one offer. The
 * designs fill the page; Edit opens the offer's editor beside them. Copy image puts the chosen design
 * on the clipboard for a post; Save PNG puts it in Downloads\APG Post-It\Virtual office. The offer
 * and photo choices are kept on this PC, uploads in this window's IndexedDB. Nothing reaches a server.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { toBlob } from 'html-to-image';
import { Button, Chip, TextInput } from '../../components';
import { sentenceOf, useApp, useNotify } from '../../state';
import logo from '../../../assets/realty-on-dark.webp';
import designsHtml from './designs.html?raw';
import './designs.css';
import './VirtualOfficeScreen.css';
import { decorate, fill, peso, plansOf, PHOTO_DEFAULT, SAMPLE, type Offer } from './offer';

const KEY = 'postit.virtualOffice';
/** Where Save PNG puts the designs: Downloads\APG Post-It\Virtual office. */
export const VO_FOLDER = 'Virtual office';
const load = (): Offer => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Offer>;
    return { ...SAMPLE, ...saved, photo: { ...PHOTO_DEFAULT, ...saved.photo }, focus: { ...SAMPLE.focus, ...saved.focus } };
  } catch {
    return SAMPLE;
  }
};

interface Photo { id: string; url: string; name: string }
// The office's own photos, from the posters on the Drive.
const PICS = import.meta.glob<string>('../../../assets/vo/*.jpg', { eager: true, import: 'default' });
const ORDER = ['alpha-office-a', 'prestige-boardroom', 'access-coworking', 'alpha-office-b', 'alpha-office-c', 'boardroom-wide', 'coworking-wide', 'coworking-sign', 'ceo-office', 'reception'];
const BUILT_IN: Photo[] = ORDER.map((n) => ({ id: 'vo:' + n, url: PICS[`../../../assets/vo/${n}.jpg`] ?? '', name: n.replace(/-/g, ' ') }));
const DESIGNS = designsHtml.replaceAll('{{logo}}', logo);

// ---- uploads: this window's IndexedDB, on this PC
const db: Promise<IDBDatabase | null> = new Promise((resolve) => {
  try {
    const req = indexedDB.open('postit-virtual-office', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  } catch {
    resolve(null);
  }
});
async function store(mode: IDBTransactionMode) {
  const d = await db;
  return d ? d.transaction('photos', mode).objectStore('photos') : null;
}
/** Uploads are shown from data: links: the picture-maker uses them as they are, where a blob: link would have to be fetched. */
const dataUrl = (blob: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(blob); });
const done = <T,>(req: IDBRequest<T>) => new Promise<T>((ok, no) => { req.onsuccess = () => ok(req.result); req.onerror = () => no(req.error); });

/** Big phone photos are shrunk to 2400 px on the long side before they are kept. */
async function shrink(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return file;
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob((b) => ok(b!), 'image/jpeg', 0.9));
}

const TABS = [
  { key: 'offer', label: 'Offer' },
  { key: 'plans', label: 'Plans' },
  { key: 'photos', label: 'Photos' },
  { key: 'contact', label: 'Contact' },
  { key: 'look', label: 'Look' },
] as const;
type Tab = (typeof TABS)[number]['key'];
const THEMES = [
  { v: 'black', label: 'Black', css: '#0e0e0e' },
  { v: 'navy', label: 'Navy', css: '#111f36' },
  { v: 'emerald', label: 'Emerald', css: '#10241b' },
  { v: 'wine', label: 'Wine', css: '#2a1418' },
] as const;
const TONES = [
  { v: 'classic', label: 'Classic gold', css: 'linear-gradient(135deg,#f6e7a9,#d9b25a,#a8822f)' },
  { v: 'champagne', label: 'Champagne', css: 'linear-gradient(135deg,#fbf1d3,#e6cf98,#b9995a)' },
  { v: 'bronze', label: 'Bronze', css: 'linear-gradient(135deg,#f3d3a1,#c98f4a,#8a5a24)' },
  { v: 'rose', label: 'Rose gold', css: 'linear-gradient(135deg,#f8dcd0,#d9a38f,#9c6452)' },
] as const;

function Area({ label, hint, value, onChange, rows = 5 }: { label: string; hint?: ReactNode; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="field vo-area">
      <span className="field__label">{label}</span>
      <textarea className="field__input" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function VirtualOfficeScreen() {
  const app = useApp();
  const notify = useNotify();
  const [o, setO] = useState<Offer>(load);
  const [tab, setTab] = useState<Tab>('offer');
  const [plan, setPlan] = useState<'p1' | 'p2' | 'p3'>('p1');
  const [pick, setPick] = useState('lead-post');
  const [slot, setSlot] = useState<'a' | 'b'>('a');
  const [uploads, setUploads] = useState<Photo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<'copy' | 'save' | null>(null);
  const [editing, setEditing] = useState(false); // the editor shows only when asked for
  const editBtn = useRef<HTMLButtonElement>(null);
  const designs = useRef<HTMLDivElement>(null); // carries the theme and photo variables for both below
  const strip = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const set = useCallback(<K extends keyof Offer>(k: K, v: Offer[K]) => setO((p) => ({ ...p, [k]: v })), []);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* not kept */ }
  }, [o]);

  // Uploads read back once.
  useEffect(() => {
    void (async () => {
      try {
        const s = await store('readonly');
        const recs = (s ? await done(s.getAll()) : []) as { id: string; name: string; blob: Blob }[];
        const sorted = recs.sort((x, y) => (x.id < y.id ? 1 : -1));
        setUploads(await Promise.all(sorted.map(async (r) => ({ id: r.id, name: r.name, url: await dataUrl(r.blob) }))));
      } catch { /* none */ }
      setLoaded(true);
    })();
  }, []);
  const all = [...uploads, ...BUILT_IN];
  const photoOf = (k: 'a' | 'b') => all.find((p) => p.id === o.photo[k]) ?? BUILT_IN.find((p) => p.id === PHOTO_DEFAULT[k])!;
  useEffect(() => {
    // A removed upload falls back to the default photo.
    if (!loaded) return;
    (['a', 'b'] as const).forEach((k) => {
      if (!all.some((p) => p.id === o.photo[k])) setO((p) => ({ ...p, photo: { ...p.photo, [k]: PHOTO_DEFAULT[k] } }));
    });
  });

  // The 12 designs live in the thumbnail row; the chosen one is copied to the stage after every change.
  useLayoutEffect(() => {
    const el = strip.current!;
    el.innerHTML = DESIGNS;
    decorate(el);
    el.querySelectorAll<HTMLElement>('figure').forEach((f) => {
      f.tabIndex = 0;
      f.setAttribute('role', 'button');
      const title = f.querySelector('figcaption b')?.textContent ?? f.dataset.name!;
      f.setAttribute('aria-label', title);
      f.querySelector('figcaption')!.innerHTML = `<span>${title}</span>`;
    });
  }, []);

  const fit = useCallback(() => {
    // Thumbnails: all the same height. The stage: as big as fits both ways.
    strip.current?.querySelectorAll<HTMLElement>('.frame').forEach((frame) => {
      const art = frame.firstElementChild as HTMLElement;
      const scale = 78 / art.offsetHeight;
      art.style.transform = `scale(${scale})`;
      frame.style.width = `${art.offsetWidth * scale}px`;
      frame.style.height = '78px';
    });
    const box = stage.current;
    const art = box?.querySelector<HTMLElement>('.art');
    if (box && art) {
      const scale = Math.min(box.clientWidth / art.offsetWidth, box.clientHeight / art.offsetHeight);
      art.style.transform = `scale(${scale})`;
      const holder = art.parentElement as HTMLElement;
      holder.style.width = `${art.offsetWidth * scale}px`;
      holder.style.height = `${art.offsetHeight * scale}px`;
    }
  }, []);

  useLayoutEffect(() => {
    const host = designs.current!;
    const el = strip.current!;
    fill(el, o);
    host.dataset.theme = o.theme;
    host.dataset.tone = o.tone;
    (['a', 'b'] as const).forEach((k) => {
      host.style.setProperty('--photo-' + k, `url("${photoOf(k).url}")`);
      host.style.setProperty(`--${k}-x`, o.focus[`${k}x`] + '%');
      host.style.setProperty(`--${k}-y`, o.focus[`${k}y`] + '%');
    });
    el.querySelectorAll<HTMLElement>('figure').forEach((f) => f.setAttribute('aria-pressed', String(f.dataset.name === pick)));
    const src = el.querySelector<HTMLElement>(`figure[data-name="${pick}"] .art`);
    if (src) {
      const copy = src.cloneNode(true) as HTMLElement;
      copy.style.transform = '';
      const holder = document.createElement('div');
      holder.className = 'vo__stage-art';
      holder.append(copy);
      stage.current!.replaceChildren(holder);
    }
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, pick, uploads]); // not on other renders, so a save in progress keeps its copy

  // The page fills the window below its header; each side scrolls on its own if it must.
  useEffect(() => {
    const size = () => {
      const b = body.current;
      if (!b) return;
      const narrow = window.innerWidth < 960;
      b.style.height = narrow ? '' : `${Math.max(520, window.innerHeight - b.getBoundingClientRect().top - (window.scrollY ? 0 : 0) - 20)}px`;
      fit();
    };
    size();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(size);
    ro.observe(document.documentElement);
    if (stage.current) ro.observe(stage.current); // opening or closing the editor resizes it
    void document.fonts?.ready.then(size);
    return () => ro.disconnect();
  }, [fit]);

  // Thumbnails choose the design.
  useEffect(() => {
    const el = strip.current!;
    const choose = (e: Event) => {
      const f = (e.target as HTMLElement).closest<HTMLElement>('figure');
      if (!f) return;
      if (e instanceof globalThis.KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      setPick(f.dataset.name!);
    };
    el.addEventListener('click', choose);
    el.addEventListener('keydown', choose);
    return () => { el.removeEventListener('click', choose); el.removeEventListener('keydown', choose); };
  }, []);

  const figure = () => strip.current?.querySelector<HTMLElement>(`figure[data-name="${pick}"]`);
  const caption = () => {
    const f = figure();
    return f ? { title: f.getAttribute('aria-label') ?? pick, ratio: Number(f.dataset.ratio) || 1 } : { title: pick, ratio: 1 };
  };
  const [meta, setMeta] = useState({ title: 'Lead post', size: '' });
  useEffect(() => {
    const art = stage.current?.querySelector<HTMLElement>('.art');
    const r = caption().ratio;
    setMeta({ title: caption().title, size: art ? `${art.offsetWidth * r} × ${art.offsetHeight * r} px` : '' });
  }, [pick]);

  // The chosen design at its full size, as a PNG.
  const render = async () => {
    const art = stage.current?.querySelector<HTMLElement>('.art');
    if (!art) throw new Error('Pick a design first.');
    await document.fonts?.ready;
    const blob = await toBlob(art, { width: art.offsetWidth, height: art.offsetHeight, pixelRatio: caption().ratio, style: { transform: 'none' }, cacheBust: true });
    if (!blob) throw new Error('That design could not be made. Try again.');
    return new Uint8Array(await blob.arrayBuffer());
  };
  const fileName = () => `${caption().title}.png`;

  // Straight to the clipboard, ready to paste into a post.
  const copyPng = async () => {
    if (busy) return;
    setBusy('copy');
    try {
      await app.platform.copyImage(await render(), caption().title);
      notify(`${caption().title} copied. Paste it into your post with Ctrl+V.`);
    } catch (err) {
      notify(sentenceOf(err), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const savePng = async () => {
    if (busy) return;
    setBusy('save');
    try {
      const folder = await app.platform.saveImages(VO_FOLDER, [{ name: fileName(), png: await render() }]);
      notify(
        <>
          {fileName()} saved.{' '}
          <Button variant="link" onClick={() => void app.platform.open(folder)}>Open the folder</Button>
        </>,
      );
    } catch (err) {
      notify(sentenceOf(err), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const choose = (id: string) => setO((p) => ({ ...p, photo: { ...p.photo, [slot]: id }, focus: { ...p.focus, [`${slot}x`]: 50, [`${slot}y`]: 50 } }));
  const upload = async (files: FileList | null) => {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/'));
    const added: Photo[] = [];
    for (const f of list) {
      try {
        const blob = await shrink(f);
        const rec = { id: `up:${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: f.name, blob };
        try { const s = await store('readwrite'); if (s) await done(s.put(rec)); } catch { /* this window only */ }
        added.push({ id: rec.id, name: rec.name, url: await dataUrl(blob) });
      } catch {
        notify(`Couldn’t open ${f.name}.`);
      }
    }
    if (added.length) {
      setUploads((u) => [...added.reverse(), ...u]);
      choose(added[0]!.id);
      notify(added.length === 1 ? 'Photo added.' : `${added.length} photos added.`);
    }
  };
  const remove = async (p: Photo) => {
    try { const s = await store('readwrite'); if (s) await done(s.delete(p.id)); } catch { /* gone from this window anyway */ }
    setUploads((u) => u.filter((x) => x.id !== p.id));
  };

  const onTabKey = (e: KeyboardEvent, i: number) => {
    let to = i;
    if (e.key === 'ArrowRight') to = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') to = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[to]!.key);
    tabRefs.current[to]?.focus();
  };

  const plans = plansOf(o);

  // Opening the editor puts focus on its tabs; closing it puts focus back on Edit.
  const opened = useRef(false);
  useEffect(() => {
    if (editing) tabRefs.current[TABS.findIndex((t) => t.key === tab)]?.focus();
    else if (opened.current) editBtn.current?.focus();
    opened.current = editing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  return (
    <div className="page vo">
      <header className="page-header vo__header">
        <h1 className="page-header__title" tabIndex={-1}>Virtual office</h1>
        <p className="page-header__description">Edit the offer once. Every design follows.</p>
      </header>

      <div className={`vo__body${editing ? ' vo__body--editing' : ''}`} ref={body}>
        {editing ? (
        <aside
          className="card card--tight vo__editor"
          id="vo-editor"
          aria-label="Edit the offer"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } }}
        >
          <div className="vo__tabs" role="tablist" aria-label="Edit">
            {TABS.map((t, i) => (
              <button
                key={t.key}
                ref={(el) => { tabRefs.current[i] = el; }}
                type="button"
                role="tab"
                id={`vo-tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls="vo-panel"
                tabIndex={tab === t.key ? 0 : -1}
                className={`vo__tab${tab === t.key ? ' vo__tab--on' : ''}`}
                onClick={() => setTab(t.key)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="vo__panel" role="tabpanel" id="vo-panel" aria-labelledby={`vo-tab-${tab}`}>
            {tab === 'offer' ? (
              <div className="vo__fields">
                <TextInput label="City or building" value={o.city} onChange={(e) => set('city', e.target.value)} />
                <TextInput label="Headline" value={o.headline} onChange={(e) => set('headline', e.target.value)} hint="Put words in *stars* to make them gold." />
                <TextInput label="Poster line" value={o.tagline} onChange={(e) => set('tagline', e.target.value)} />
                <Area label="Short description" rows={3} value={o.sub} onChange={(v) => set('sub', v)} />
                <Area label="What you get, one per line" rows={5} value={o.incl} onChange={(v) => set('incl', v)} hint="The first 3 to 5 show. {city} becomes the city." />
              </div>
            ) : null}

            {tab === 'plans' ? (
              <div className="vo__fields">
                <div className="vo__chips" role="group" aria-label="Plan to edit">
                  {(['p1', 'p2', 'p3'] as const).map((k, i) => (
                    <Chip key={k} selected={plan === k} onSelectedChange={() => setPlan(k)}>{o[`${k}name`] || `Plan ${i + 1}`}</Chip>
                  ))}
                </div>
                <div className="vo__row">
                  <TextInput label="Plan name" value={o[`${plan}name`]} onChange={(e) => set(`${plan}name`, e.target.value)} />
                  <TextInput label="₱ a month" type="number" min={0} step={50} value={o[`${plan}price`] || ''} onChange={(e) => set(`${plan}price`, Number(e.target.value))} />
                </div>
                <Area label="Inclusions, one per line" rows={7} value={o[`${plan}incl`]} onChange={(v) => set(`${plan}incl`, v)} />
                <label className="vo__check">
                  <input type="radio" name="vo-feature" checked={o.feature === plan} onChange={() => set('feature', plan)} />
                  Feature this plan
                  <span className="vo__muted">{o.feature === plan ? '(shown in black on Plans)' : `(now: ${o[`${o.feature}name`]})`}</span>
                </label>
                <TextInput label="Custom plan line" value={o.custom} onChange={(e) => set('custom', e.target.value)} />
                <p className="vo__muted">Prices start from {peso(Math.min(...plans.map((p) => p.price).filter(Boolean)))} on the other designs.</p>
              </div>
            ) : null}

            {tab === 'photos' ? (
              <div className="vo__fields">
                <div className="vo__slots" role="group" aria-label="Which photo to change">
                  {(['a', 'b'] as const).map((k) => (
                    <button key={k} type="button" className="vo__slot" aria-pressed={slot === k} onClick={() => setSlot(k)}>
                      <span className="vo__slot-pic" style={{ backgroundImage: `url("${photoOf(k).url}")` }} />
                      {k === 'a' ? 'Main photo' : 'Second photo'}
                    </button>
                  ))}
                </div>
                <ul className="vo__lib" aria-label="Photos">
                  {all.map((p) => {
                    const used = (['a', 'b'] as const).filter((k) => o.photo[k] === p.id);
                    return (
                      <li key={p.id}>
                        <button type="button" className={`vo__pic${used.length ? ' vo__pic--used' : ''}`} style={{ backgroundImage: `url("${p.url}")` }} onClick={() => choose(p.id)} aria-label={`${p.name}${used.length ? ', in use' : ''}`} title={p.name}>
                          {used.length ? <span className="vo__tags">{used.map((k) => <i key={k}>{k === 'a' ? 'Main' : '2nd'}</i>)}</span> : null}
                          {p.id.startsWith('up:') ? <span className="vo__up">Uploaded</span> : null}
                        </button>
                        {p.id.startsWith('up:') ? (
                          <button type="button" className="vo__rm" aria-label={`Remove ${p.name}`} onClick={() => void remove(p)}>×</button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
                <Button block size="small" onClick={() => fileRef.current?.click()}>Upload photos</Button>
                <div className="vo__row">
                  <label className="field">
                    <span className="field__label">Left ↔ right</span>
                    <input type="range" min={0} max={100} value={o.focus[`${slot}x`]} onChange={(e) => setO((p) => ({ ...p, focus: { ...p.focus, [`${slot}x`]: Number(e.target.value) } }))} />
                  </label>
                  <label className="field">
                    <span className="field__label">Up ↔ down</span>
                    <input type="range" min={0} max={100} value={o.focus[`${slot}y`]} onChange={(e) => setO((p) => ({ ...p, focus: { ...p.focus, [`${slot}y`]: Number(e.target.value) } }))} />
                  </label>
                </div>
                <p className="vo__muted">Uploads stay on this PC. The others are from the Drive posters.</p>
              </div>
            ) : null}

            {tab === 'contact' ? (
              <div className="vo__fields">
                <TextInput label="Call to action" value={o.cta} onChange={(e) => set('cta', e.target.value)} />
                <TextInput label="Phone numbers" value={o.phones} onChange={(e) => set('phones', e.target.value)} hint="Separate numbers with /" />
                <TextInput label="Email" value={o.email} onChange={(e) => set('email', e.target.value)} />
              </div>
            ) : null}

            {tab === 'look' ? (
              <div className="vo__fields">
                <fieldset className="vo__choice">
                  <legend className="field__label">Background</legend>
                  <div className="vo__swatches">
                    {THEMES.map((t) => (
                      <button key={t.v} type="button" className="vo__swatch" style={{ background: t.css }} aria-label={t.label} title={t.label} aria-pressed={o.theme === t.v} onClick={() => set('theme', t.v)} />
                    ))}
                  </div>
                </fieldset>
                <fieldset className="vo__choice">
                  <legend className="field__label">Gold</legend>
                  <div className="vo__swatches">
                    {TONES.map((t) => (
                      <button key={t.v} type="button" className="vo__swatch" style={{ background: t.css }} aria-label={t.label} title={t.label} aria-pressed={o.tone === t.v} onClick={() => set('tone', t.v)} />
                    ))}
                  </div>
                </fieldset>
                <label className="vo__check">
                  <input type="checkbox" checked={o.folds} onChange={(e) => set('folds', e.target.checked)} /> Show the brochure’s fold lines
                </label>
                <Button variant="link" onClick={() => { setO((p) => ({ ...SAMPLE, photo: { ...PHOTO_DEFAULT }, focus: { ...SAMPLE.focus }, folds: p.folds })); notify('Back to the Drive’s offer.'); }}>
                  Back to the Drive’s offer
                </Button>
              </div>
            ) : null}
          </div>
        </aside>
        ) : null}

        <section className="vo-designs vo__preview" ref={designs} aria-label="Designs">
          <div className="vo__strip" ref={strip} aria-label="Choose a design" />
          <div className="vo__bar">
            <p><b>{meta.title}</b> <span className="vo__muted">{meta.size}</span></p>
            <span className="vo__actions">
              <Button
                ref={editBtn}
                size="small"
                aria-expanded={editing}
                aria-controls="vo-editor"
                onClick={() => setEditing(!editing)}
              >
                {editing ? 'Done' : 'Edit'}
              </Button>
              <Button size="small" busy={busy === 'save'} disabled={busy === 'copy'} onClick={() => void savePng()}>
                {busy === 'save' ? 'Saving…' : 'Save PNG'}
              </Button>
              <Button variant="primary" size="small" busy={busy === 'copy'} disabled={busy === 'save'} onClick={() => void copyPng()}>
                {busy === 'copy' ? 'Copying…' : 'Copy image'}
              </Button>
            </span>
          </div>
          <div className="vo__stage" ref={stage} />
        </section>
      </div>
    </div>
  );
}
