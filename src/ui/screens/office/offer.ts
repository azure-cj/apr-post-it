/**
 * The virtual office offer and how it fills the designs. The sample is the real offer, from the
 * "2026 V3.0 NEW VIRTUAL OFFICE" posting doc and posters on the Drive.
 */
export interface Offer {
  city: string;
  headline: string;
  tagline: string;
  sub: string;
  p1name: string; p1price: number; p1incl: string;
  p2name: string; p2price: number; p2incl: string;
  p3name: string; p3price: number; p3incl: string;
  custom: string;
  feature: 'p1' | 'p2' | 'p3';
  incl: string;
  cta: string;
  phones: string;
  email: string;
  theme: 'black' | 'navy' | 'emerald' | 'wine';
  tone: 'classic' | 'champagne' | 'bronze' | 'rose';
  folds: boolean;
  photo: { a: string; b: string };
  focus: { ax: number; ay: number; bx: number; by: number };
}

export const PHOTO_DEFAULT = { a: 'vo:alpha-office-a', b: 'vo:prestige-boardroom' };

export const SAMPLE: Offer = {
  city: 'Ortigas',
  headline: 'Elevate your business with a *virtual office*',
  tagline: 'Strong presence, *less overhead.*',
  sub: 'For entrepreneurs, startups and professionals who want a strong business presence without the high overhead.',
  p1name: 'Premier Access',
  p1price: 2899,
  p1incl: 'Use of prestigious business address\nShared coworking space, once a month\nMail receiving and handling\nCompany name on digital signage\nInternet access during coworking',
  p2name: 'Premier Prestige',
  p2price: 3499,
  p2incl: 'Use of prestigious business address\nShared coworking space, once a month\nMail handling\nCompany name on digital signage\nComplimentary internet access\nFree water\nAdmin printing, 10 pages\nBoard room once a month',
  p3name: 'Alpha Premier',
  p3price: 4999,
  p3incl: 'Use of prestigious business address\nFront desk reception\nMail receiving and handling\nComplimentary internet access\nFree drinking water\nAdmin printing, up to 10 pages a month\nBoard room twice a month\nCEO’s office for contract signing',
  custom: 'Custom plans, tailored to your needs',
  feature: 'p3',
  incl: 'Prestigious {city} business address\nMail handling and reception\nMeeting rooms and coworking spaces\nDigital signage for your brand\nHigh-speed internet and utilities',
  cta: 'Inquire or book a viewing',
  phones: '0927 555 5803 / 0915 888 9482 / 0921 217 4555',
  email: 'realty@alphapremiergroup.com',
  theme: 'black',
  tone: 'classic',
  folds: false,
  photo: { ...PHOTO_DEFAULT },
  focus: { ax: 50, ay: 50, bx: 50, by: 50 },
};

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const peso = (n: number) => (Number(n) > 0 ? '₱' + Number(n).toLocaleString('en-PH') : '');

export interface Plan { k: 'p1' | 'p2' | 'p3'; name: string; price: number; incl: string[] }

export function plansOf(o: Offer): Plan[] {
  const lines = (s: string) => withCity(o, s).split('\n').map((x) => x.trim()).filter(Boolean);
  return (['p1', 'p2', 'p3'] as const)
    .map((k) => ({ k, name: o[`${k}name`], price: Number(o[`${k}price`]) || 0, incl: lines(o[`${k}incl`]) }))
    .filter((p) => p.name || p.price);
}
const withCity = (o: Offer, s: string) => String(s ?? '').replaceAll('{city}', o.city || '');

const ICONS = [
  '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
];

/** Once: copy the shared pieces (swoosh, badge, phone bar, ticks, arrows) into each design. */
export function decorate(root: HTMLElement) {
  const tpl = (id: string) => (root.querySelector(`#${id}`) as HTMLTemplateElement).content.firstElementChild!.cloneNode(true) as Element;
  root.querySelectorAll<HTMLElement>('[data-deco]').forEach((art) => art.dataset.deco!.split(' ').forEach((d) => art.append(tpl('t-' + d))));
  root.querySelectorAll('[data-tick]').forEach((i) => i.replaceWith(tpl('t-tick')));
  root.querySelectorAll('[data-arrow]').forEach((i) => i.replaceWith(tpl('t-arrow')));
}

/** Fill every design from the offer. */
export function fill(root: HTMLElement, o: Offer) {
  const rich = (s: string) => esc(withCity(o, s)).replace(/\*(.+?)\*/g, '<span class="gold-text">$1</span>');
  const ps = plansOf(o);
  const featured = ps.find((p) => p.k === o.feature) ?? ps[ps.length - 1] ?? { k: 'p1', name: '', price: 0, incl: [] };
  const prices = ps.map((p) => p.price).filter((n) => n > 0);
  const lowest = prices.length ? Math.min(...prices) : 0;
  const lists: Record<string, string[]> = {
    incl: withCity(o, o.incl).split('\n').map((x) => x.trim()).filter(Boolean),
    feature: featured.incl,
  };
  const values: Record<string, () => string> = {
    city: () => esc(o.city),
    headline: () => rich(o.headline),
    tagline: () => rich(o.tagline),
    sub: () => esc(withCity(o, o.sub)),
    from: () => peso(lowest),
    'feature-name': () => esc(featured.name),
    'feature-price': () => peso(featured.price),
    custom: () => esc(o.custom),
    email: () => esc(o.email),
    cta: () => esc(o.cta),
    phones: () => esc(o.phones),
    'phone-lines': () => String(o.phones).split('/').map((p) => esc(p.trim())).join('<br>'),
    'city-address': () => esc(`Prestigious ${o.city} business address`),
    'city-address-use': () => esc(`Register and get mail at your ${o.city} address.`),
    explain: () => esc(`A virtual office gives your business a real ${o.city} address to register, receive mail and meet clients, while you work from anywhere.`),
  };
  const tick = () => (root.querySelector('#t-tick') as HTMLTemplateElement).content.firstElementChild!.cloneNode(true);

  root.querySelectorAll<HTMLElement>('.tri').forEach((t) => t.classList.toggle('folds', !!o.folds));
  root.querySelectorAll<HTMLElement>('[data-k]').forEach((el) => { el.innerHTML = (values[el.dataset.k!] ?? (() => ''))(); });
  root.querySelectorAll<HTMLElement>('[data-show]').forEach((el) => { el.hidden = !(values[el.dataset.show!] ?? (() => ''))(); });

  const fk = featured.k;
  root.querySelectorAll<HTMLElement>('[data-plans]').forEach((box) => {
    const v = box.dataset.plans;
    if (v === 'duo') {
      box.innerHTML = ps.map((p) => `<div><small>${esc(p.name)}</small><b>${peso(p.price)}</b><span>a month</span></div>`).join('<i></i>');
      box.style.gridTemplateColumns = ps.map(() => '1fr').join(' 2px ');
    } else if (v === 'cards') {
      box.innerHTML = ps.map((p) => `<div class="card${p.k === fk ? ' best' : ''}"><h3>${esc(p.name)}</h3><div class="amt"><span${p.k === fk ? ' class="gold-text"' : ''}>${peso(p.price)}</span><small>a month</small></div><ul>${p.incl.slice(0, 4).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>${p.incl.length > 4 ? `<div class="more">+ ${p.incl.length - 4} more</div>` : ''}</div>`).join('');
    } else {
      box.innerHTML = ps.map((p) => `<div class="plan${p.k === fk ? ' best' : ''}"><small>${esc(p.name)}</small><b${p.k === fk ? ' class="gold-text"' : ''}>${peso(p.price)}<small>a month</small></b></div>`).join('');
    }
  });
  root.querySelectorAll<HTMLElement>('[data-list]').forEach((ul) => {
    const n = Number(ul.dataset.max) || 5;
    ul.innerHTML = '';
    (lists[ul.dataset.list!] ?? lists.incl!).slice(0, n).forEach((t) => {
      const li = document.createElement('li');
      if (!ul.hasAttribute('data-plain')) li.append(tick());
      li.append(document.createTextNode(t));
      ul.append(li);
    });
  });
  root.querySelectorAll<HTMLElement>('[data-inline]').forEach((el) => {
    el.innerHTML = lists.incl!.slice(0, Number(el.dataset.max) || 5).map((t) => `<span>${esc(t)}</span>`).join('');
  });
  root.querySelectorAll<HTMLElement>('[data-tiles]').forEach((box) => {
    box.innerHTML = lists.incl!.slice(0, 4).map((t, i) => `<div class="tile"><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#1a1205" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[i]}</svg></span><p>${esc(t)}</p></div>`).join('');
  });
}
