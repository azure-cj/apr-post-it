/**
 * A pretend web app for the browser: 25 listings, a team, a day's posts and
 * queues. With it, `npm run dev` runs the whole app with no Google behind it.
 *
 * It answers as server/apps-script/Code.gs does, and keeps its rules where a
 * screen can see them:
 * - the posting text is cut by Separators.gs itself, the file the server uses;
 * - an intern's reply has no internal text, and a document nobody has
 *   separated has none of its text at all (`withheld`);
 * - an intern sees only their own posts and queue;
 * - the cooldown counts Posted rows only, and a refusal is a sentence with the
 *   next allowed date;
 * - FB accounts are checked against the person's own list.
 *
 * Sign in with one of DEMO_KEYS. Dates are relative to today (Manila).
 */

import { splitAtSeparator_ } from '@server/Separators.gs';
import { createFakePlatform, type FakePlatform } from './fake';

export const DEMO_URL = 'https://script.google.com/macros/s/AKfycbz-demo-post-it/exec';

interface DemoPerson {
  readonly name: string;
  readonly role: 'Intern' | 'Admin';
  readonly fbAccounts: readonly string[];
}

/** The keys the demo answers to, and who each one is. */
export const DEMO_KEYS: Readonly<Record<string, DemoPerson>> = {
  intern: { name: 'Jan Dela Cruz', role: 'Intern', fbAccounts: ['APG Main', 'APG Rentals South'] },
  paolo: { name: 'Paolo Reyes', role: 'Intern', fbAccounts: [] },
  bea: { name: 'Bea Ramos', role: 'Intern', fbAccounts: ['APG Main', 'APG Rentals South'] },
  manager: { name: 'Maria Santos', role: 'Admin', fbAccounts: [] },
  admin: { name: 'Ana Reyes', role: 'Admin', fbAccounts: [] },
};

export type DemoKey = keyof typeof DEMO_KEYS;

// ------------------------------------------------------------------ the library

interface DemoListing {
  readonly name: string;
  readonly category: string;
  readonly listingType: string;
  readonly subCategory: string;
  readonly photos: number;
  /** The whole posting document, as the server reads it. Null: the folder has none. */
  readonly doc: string | null;
}

const CONDO = 'CONDO / HOUSE AND LOT';
const COMMERCIAL = 'COMMERCIAL SPACE';
const OFFICE = 'OFFICE SPACE';
const WAREHOUSE = 'WAREHOUSE';
const LEASE = 'FOR LEASE/ FOR RENT';
const SALE = 'FOR SALE';

const listings: readonly DemoListing[] = [
  {
    name: 'Verdant Hills Lot 12, Tagaytay',
    category: CONDO,
    listingType: SALE,
    subCategory: 'Lot',
    photos: 8,
    doc: `FOR SALE: 320 sqm residential lot in Verdant Hills, Tagaytay

Cool climate all year, 10 minutes to the Rotonda, near schools and the public market. Flat, buildable, with a clean title.

• Lot area: 320 sqm
• Corner lot, 12 m frontage
• Gated, with 24-hour security

Price: ₱4.2M (negotiable)
Contact: 0917 555 0142 / 0920 555 0187
Site visits by appointment. Message us to book a schedule.
---
Owner: Mrs. Lourdes Navarro, 0918 555 0199
Net to owner: ₱4.0M
Commission: 3%, split 50/50 with co-brokers`,
  },
  {
    name: 'Verdant Hills Lot 7, Tagaytay',
    category: CONDO,
    listingType: SALE,
    subCategory: 'Lot',
    photos: 6,
    doc: `FOR SALE: 280 sqm lot in Verdant Hills, Tagaytay

Inner lot on a quiet street, a short walk to the clubhouse and the chapel.

• Lot area: 280 sqm
• Slightly elevated, with a view of the ridge
• Clean title, taxes updated

Price: ₱3.6M
Contact: 0917 555 0142
---
Owner: Mr. Rodel Garcia, 0918 555 0121
Commission: 3%`,
  },
  {
    name: 'Sunrise Homes Block 3 Lot 9, Silang',
    category: CONDO,
    listingType: SALE,
    subCategory: 'House & Lot',
    photos: 10,
    doc: `FOR SALE: 3-bedroom house and lot, Sunrise Homes, Silang, Cavite

Two storeys, 150 sqm floor area on a 120 sqm lot. Ready for occupancy.

• 3 bedrooms, 2 toilet and baths
• Carport for 1 car
• 15 minutes to Aguinaldo Highway

Price: PHP 6,800,000
Bank financing and Pag-IBIG accepted.
Call or text 0917 555 0123.
━━━━━━━━━━━━━━━━━━━━
Owner: Mr. Danilo Mercado, 0919 555 0166
3% commission for agents`,
  },
  {
    name: 'Avida Towers Cityflex 1BR, BGC',
    category: CONDO,
    listingType: LEASE,
    subCategory: 'Condo',
    photos: 7,
    doc: `FOR RENT: Fully furnished 1-bedroom unit, Avida Towers Cityflex, BGC

32 sqm on the 18th floor, with a city view. Walking distance to Market Market and High Street.

• Fully furnished, with aircon, fridge and washer
• Pool, gym and function room
• No pets

Rent: ₱35,000 / month (2 months advance, 2 months deposit)
Message 0917 555 0110 for a viewing.
---
Unit owner: Ms. Kristine Yap, 0917 555 0177
Commission: one month's rent`,
  },
  {
    name: 'Casa Amara House and Lot, Antipolo',
    category: CONDO,
    listingType: SALE,
    subCategory: 'House & Lot',
    photos: 9,
    doc: `FOR SALE: Casa Amara, a 4-bedroom house and lot in Antipolo

Overlooking the Metro Manila skyline. 280 sqm lot, 220 sqm floor area.

• 4 bedrooms, a maid's room, 3 toilet and baths
• Garden and a 2-car garage
• 5 minutes to Sumulong Highway

Price: ₱12.5M
Contact: 0917 555 0156
OWNER'S DETAILS
Mr. and Mrs. Gatchalian, 0918 555 0102
Net price ₱11.8M`,
  },
  {
    name: 'Greenfield Farm Lot, Batangas',
    category: CONDO,
    listingType: 'For sale',
    subCategory: 'Lot',
    photos: 5,
    doc: `FOR SALE: 1.2 hectare farm lot in Lipa, Batangas

Planted with coffee and fruit trees, with a deep well and a small nipa hut. 20 minutes to the city proper.

• Lot area: 12,000 sqm
• Road access, near the barangay hall
• Clean title

Price: ₱18M, or ₱1,500 per sqm
Message us on this page to ask about a viewing.
=====
Owner: Mr. Arturo Medina, 0915 555 0143
Commission 5%`,
  },
  {
    // Nobody has separated this one: the owner's mobile sits at the bottom
    // with no marker above it. An intern is sent none of it (D13).
    name: 'Seaside Residences 2BR, Pasay',
    category: CONDO,
    listingType: SALE,
    subCategory: 'Condo',
    photos: 6,
    doc: `FOR SALE: 2-bedroom corner unit, Seaside Residences, Pasay

Manila Bay view, 54 sqm, near SM Mall of Asia.

• 2 bedrooms, 1 toilet and bath
• Balcony facing the bay
• With a parking slot

Price: ₱9.8M
Contact: 0917 555 0191

Mr. Edgardo Lim, 0918 555 0135. Will sign with any broker; 3 percent to whoever closes.`,
  },
  {
    name: 'Villa Rosario Unit 4B, Quezon City',
    category: CONDO,
    listingType: LEASE,
    subCategory: 'Condo',
    photos: 5,
    doc: `FOR RENT: Villa Rosario Unit 4B, Quezon City

2-bedroom townhouse-style unit, 60 sqm, near Trinoma and the MRT.

• 2 bedrooms, 1.5 baths
• Own parking slot
• Semi-furnished

Rent: ₱28,000 / month
Call 0917 555 0128 for a viewing.__ Mrs. Reyes, 0919 555 0114, prefers long-term tenants. One month to the broker.`,
  },
  {
    name: 'Ayala Westgrove Heights Lot, Silang',
    category: CONDO,
    listingType: SALE,
    subCategory: 'Lot',
    photos: 0,
    doc: `FOR SALE: 500 sqm lot, Ayala Westgrove Heights, Silang

A gated community with a golf course and a clubhouse.

• Lot area: 500 sqm
• Inner lot, near the clubhouse

Price: ₱15,000 per sqm (₱7.5M)
Contact: 0917 555 0109
---
Owner: Dr. Ramirez, 0918 555 0181`,
  },
  {
    name: 'Kapitolyo Ground Floor Retail, Pasig',
    category: COMMERCIAL,
    listingType: LEASE,
    subCategory: '',
    photos: 6,
    doc: `FOR LEASE: Ground-floor retail space on United Street, Kapitolyo, Pasig

45 sqm with a full glass frontage, on the busiest food street in Kapitolyo.

• Floor area: 45 sqm
• Own water and electric meters
• Suits a café or a small restaurant

Rent: ₱65,000 / month, VAT exclusive
Contact: 0917 555 0137 / 0920 555 0161
---
Lessor: Kapitolyo Holdings, through Mr. Tan, 0918 555 0150
Commission: 1 month`,
  },
  {
    name: 'Banawe Street Commercial Space 85 sqm',
    category: COMMERCIAL,
    listingType: LEASE,
    subCategory: '',
    photos: 4,
    doc: `FOR LEASE: 85 sqm commercial space along Banawe Street, Quezon City

Ground floor on the auto parts strip, with steady foot traffic all day.

• 85 sqm, high ceiling
• Roll-up door and a mezzanine
• 3-year minimum lease

Rent: PHP 90,000 / month
Text 0917 555 0170 for details.
__________
Owner: Mr. Sy, 0918 555 0126
1 month commission`,
  },
  {
    name: 'Marcos Highway Showroom, Antipolo',
    category: COMMERCIAL,
    listingType: SALE,
    subCategory: '',
    photos: 8,
    doc: `FOR SALE: 2-storey commercial building with a showroom along Marcos Highway, Antipolo

Lot area 400 sqm, floor area 650 sqm. Built for a car or furniture showroom.

• 20 m glass showroom frontage
• Parking for 10 cars
• Clean title, taxes updated

Price: ₱48M
Contact: 0917 555 0119
==========
Owner's contact: Mr. Bautista, 0918 555 0172
Commission 3%`,
  },
  {
    name: 'Maginhawa Food Stall Space, Quezon City',
    category: COMMERCIAL,
    listingType: LEASE,
    subCategory: '',
    photos: 3,
    doc: `FOR LEASE: Food stall space on Maginhawa Street, Quezon City

A 12 sqm stall in a food park near UP Diliman. Busiest on weekends and in the evening.

• 12 sqm, with a sink and an exhaust hood
• Shared seating for 60
• Water and electricity sub-metered

Rent: ₱18,000 / month
Contact: 0917 555 0147
1 MONTH STANDARD COMMISSION
Food park admin: Ms. Ocampo, 0918 555 0193`,
  },
  {
    // Commission wording above the separator: the check fails and Copy is blocked.
    name: 'Salcedo Village Ground Floor Unit, Makati',
    category: COMMERCIAL,
    listingType: LEASE,
    subCategory: '',
    photos: 5,
    doc: `FOR LEASE: Ground-floor unit in Salcedo Village, Makati

60 sqm on Tordesillas Street, beside the Saturday market.

• 60 sqm, with a pantry and a toilet
• Building has backup power
• Available from 1 December

Rent: ₱120,000 / month
Referral fee for co-brokers: half a month's rent.
Contact: 0917 555 0158
---
Owner: Salcedo Realty, Mr. Lopez, 0918 555 0104`,
  },
  {
    name: 'BGC Uptown Office 18F, 240 sqm',
    category: OFFICE,
    listingType: LEASE,
    subCategory: '',
    photos: 6,
    doc: `FOR LEASE: 240 sqm office on the 18th floor, Uptown Bonifacio, BGC

Fitted out and ready to move in: 30 workstations, 2 meeting rooms and a pantry.

• 240 sqm, PEZA-accredited building
• 24/7 access, with backup power
• 4 parking slots available

Rent: ₱1,150 per sqm a month
Contact: 0917 555 0164
---
Owner: Uptown Leasing Corp., Ms. Dizon, 0918 555 0117
Commission: 1 month`,
  },
  {
    name: 'Makati Salcedo Office 120 sqm',
    category: OFFICE,
    listingType: LEASE,
    subCategory: '',
    photos: 5,
    doc: `FOR LEASE: 120 sqm office in Salcedo Village, Makati

Bare unit on a high floor, with a view of the Makati skyline. A short walk to Ayala Avenue.

• 120 sqm, bare
• 2 parking slots
• Lease of at least 2 years

Rent: ₱108,000 / month
Contact: 0917 555 0175
____
Owner: Mr. Villanueva, 0918 555 0159
Commission: 1 month`,
  },
  {
    // No price in the public text: a warning, which does not block Copy.
    name: 'Ortigas Jade Drive Office Floor',
    category: OFFICE,
    listingType: SALE,
    subCategory: '',
    photos: 4,
    doc: `FOR SALE: Whole office floor on Jade Drive, Ortigas Center

620 sqm whole floor, with its own lobby and 6 parking slots. Tenanted until June, with a good yield.

• 620 sqm whole floor
• 6 parking slots
• Tenanted until June

Price upon request.
Contact: 0917 555 0182
---
Owner: Jade Holdings, Mr. Chua, 0918 555 0140
Commission 2%`,
  },
  {
    name: 'Alabang Filinvest Office Unit 1203',
    category: OFFICE,
    listingType: LEASE,
    subCategory: '',
    photos: 6,
    doc: `FOR LEASE: Office unit 1203, Filinvest City, Alabang

85 sqm, fitted out, with 12 workstations and a small meeting room.

• 85 sqm, fitted out
• 1 parking slot
• Near Festival Mall

Rent: ₱76,500 / month
Contact: 0917 555 0131
FOR AGENTS ONLY
Owner: Ms. Pascual, 0918 555 0108
One month commission, two months for a 3-year lease`,
  },
  {
    name: 'Eastwood Cyber One 6th Floor',
    category: OFFICE,
    listingType: LEASE,
    subCategory: '',
    photos: 5,
    doc: `FOR LEASE: Office space at Cyber One, Eastwood City, Quezon City

300 sqm on the 6th floor, built for a BPO, with backup power and 24/7 access.

• 300 sqm, PEZA-accredited
• 100% backup power
• Near the Eastwood mall

Rent: ₱750 per sqm a month
Contact: 0917 555 0115
===
Owner: Eastwood Holdings, Mr. Santos, 0918 555 0186`,
  },
  {
    name: 'Cubao Office Space, 3rd Floor',
    category: OFFICE,
    listingType: SALE,
    subCategory: '',
    photos: 4,
    doc: `FOR SALE: 150 sqm office on the 3rd floor, near Gateway Mall, Cubao

Corner unit with windows on two sides. Walking distance to the MRT and LRT.

• 150 sqm corner unit
• 1 parking slot
• Condominium certificate of title

Price: ₱13.5M
Contact: 0917 555 0196
---
Owner: Mr. Fernandez, 0918 555 0124
Commission 3%`,
  },
  {
    name: 'Valenzuela Warehouse 1,200 sqm',
    category: WAREHOUSE,
    listingType: LEASE,
    subCategory: '',
    photos: 7,
    doc: `FOR LEASE: 1,200 sqm warehouse in Valenzuela City

Near the NLEX Karuhatan exit, with room for 40-foot container vans.

• 1,200 sqm floor area, 9 m ceiling
• 3 loading bays
• With a 60 sqm office and toilets

Rent: ₱264,000 / month
Contact: 0917 555 0153
---
Owner: Mr. Co, 0918 555 0168
Commission: 1 month`,
  },
  {
    name: 'Carmona Industrial Warehouse, Cavite',
    category: WAREHOUSE,
    listingType: LEASE,
    subCategory: '',
    photos: 6,
    doc: `FOR LEASE: Warehouse in an industrial estate, Carmona, Cavite

2,000 sqm with an office, near the SLEX Carmona exit.

• 2,000 sqm, 10 m ceiling
• Inside a gated industrial estate
• Power: 3-phase, 500 kVA

Rent: ₱380,000 / month
Contact: 0917 555 0139
__
Owner: Carmona Estates, Ms. Uy, 0918 555 0111
Commission 1 month`,
  },
  {
    name: 'Calamba Cold Storage Warehouse',
    category: WAREHOUSE,
    listingType: SALE,
    subCategory: '',
    photos: 5,
    doc: `FOR SALE: Cold storage warehouse in Calamba, Laguna

1,500 sqm on a 3,000 sqm lot, with 4 cold rooms and a loading dock.

• 4 cold rooms, down to -25°C
• Loading dock for 2 trucks
• Clean title

Price: ₱95M
Contact: 0917 555 0145
────────────────
Owner: Mr. Tolentino, 0918 555 0189
Commission 3%`,
  },
  {
    // The folder has photos but no posting document yet.
    name: 'Meycauayan Warehouse with Office, Bulacan',
    category: WAREHOUSE,
    listingType: LEASE,
    subCategory: '',
    photos: 4,
    doc: null,
  },
  {
    name: 'Taytay Warehouse along Manila East Road',
    category: WAREHOUSE,
    listingType: LEASE,
    subCategory: '',
    photos: 6,
    doc: `FOR LEASE: Warehouse along Manila East Road, Taytay, Rizal

800 sqm with a 2-storey office, 5 minutes to Ortigas Extension.

• 800 sqm floor area
• Office of 80 sqm, with toilets
• Wide driveway for 10-wheelers

Rent: ₱160,000 / month
Contact: 0917 555 0133
[Do not post]
Owner: Mrs. Santiago, 0918 555 0162
Commission: 1 month`,
  },
];

/** A Drive-looking folder id, the same every run. */
function folderId(name: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let h = 2166136261;
  let out = '1';
  for (let i = 0; out.length < 33; i++) {
    h = Math.imul(h ^ name.charCodeAt(i % name.length) ^ i, 16777619) >>> 0;
    out += alphabet[h % alphabet.length];
  }
  return out;
}

interface Row extends DemoListing {
  readonly id: string;
  readonly issues: string;
}

const rows: readonly Row[] = listings.map((listing) => {
  const issues: string[] = [];
  if (listing.doc === null) issues.push('No document');
  else if (!splitAtSeparator_(listing.doc).found) {
    issues.push('No separator line — the whole document is treated as postable. Check it.');
  }
  if (listing.photos === 0) issues.push('No photos');
  return { ...listing, id: folderId(listing.name), issues: issues.join(' · ') };
});

const byName = new Map(rows.map((r) => [r.name, r]));
function idOf(name: string): string {
  const row = byName.get(name);
  if (!row) throw new Error(`The demo has no listing called "${name}".`);
  return row.id;
}

// ------------------------------------------------------------------ the tracker

interface PostRow {
  date: string;
  time: string;
  type: string;
  title: string;
  status: 'Posted' | 'Pending';
  fbAccount: string;
  postLink: string;
  postedBy: string;
  propertyId: string;
}

interface AssignmentRow {
  date: string;
  assignedTo: string;
  property: string;
  status: 'To post' | 'Pending' | 'Posted';
  propertyId: string;
}

const DAY_MS = 86_400_000;
const MANILA_MS = 8 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const manilaDay = (ms: number): string => new Date(ms + MANILA_MS).toISOString().slice(0, 10);
const manilaClock = (ms: number): string => new Date(ms + MANILA_MS).toISOString().slice(11, 16);
const shiftDays = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const spoken = (day: string): string => {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

let linkSerial = 7_781_200_340;
const fbLink = (account: string): string =>
  `https://www.facebook.com/groups/${account.replace(/\s+/g, '').toLowerCase()}/posts/${(linkSerial += 7_919)}/`;

/** One post, `daysAgo` before today. */
function post(today: string, daysAgo: number, time: string, name: string, by: string, account: string, status: 'Posted' | 'Pending' = 'Posted'): PostRow {
  const row = byName.get(name);
  return {
    date: shiftDays(today, -daysAgo),
    time,
    type: row ? categoryWords(row.category) : 'Group post',
    title: name,
    status,
    fbAccount: account,
    postLink: status === 'Posted' ? fbLink(account) : '',
    postedBy: by,
    propertyId: idOf(name),
  };
}

function categoryWords(category: string): string {
  const lower = category.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function seedPosts(today: string): PostRow[] {
  const jan = DEMO_KEYS['intern']!.name;
  const bea = DEMO_KEYS['bea']!.name;
  const paolo = DEMO_KEYS['paolo']!.name;
  return [
    post(today, 49, '14:05', 'Verdant Hills Lot 12, Tagaytay', jan, 'APG Main'),
    post(today, 28, '10:31', 'Verdant Hills Lot 12, Tagaytay', bea, 'APG Main'),
    post(today, 16, '15:12', 'Valenzuela Warehouse 1,200 sqm', paolo, 'APG Industrial'),
    post(today, 12, '09:48', 'Avida Towers Cityflex 1BR, BGC', jan, 'APG Rentals South'),
    post(today, 9, '11:20', 'Marcos Highway Showroom, Antipolo', bea, 'APG Main'),
    post(today, 5, '16:02', 'Calamba Cold Storage Warehouse', paolo, 'APG Industrial'),
    // Inside the cooldown, and an intern's own: Jan's screens can see it.
    post(today, 2, '13:37', 'Verdant Hills Lot 7, Tagaytay', jan, 'APG Main'),
    // Inside the cooldown, but someone else's: Jan finds out only when the server refuses it.
    post(today, 3, '10:05', 'Villa Rosario Unit 4B, Quezon City', bea, 'APG Rentals South'),
    post(today, 1, '15:44', 'Banawe Street Commercial Space 85 sqm', paolo, 'APG Main'),
    post(today, 0, '09:15', 'Sunrise Homes Block 3 Lot 9, Silang', paolo, 'APG Main'),
    post(today, 0, '09:41', 'Kapitolyo Ground Floor Retail, Pasig', jan, 'APG Main'),
    post(today, 0, '10:17', 'BGC Uptown Office 18F, 240 sqm', jan, 'APG Rentals South'),
    post(today, 0, '10:40', 'Eastwood Cyber One 6th Floor', bea, 'APG Main'),
    // Logged before the group approved it: no link yet.
    post(today, 0, '11:02', 'Casa Amara House and Lot, Antipolo', jan, 'APG Main', 'Pending'),
  ];
}

function seedAssignments(today: string): AssignmentRow[] {
  const item = (who: string, name: string, status: AssignmentRow['status'], date = today): AssignmentRow => ({
    date,
    assignedTo: DEMO_KEYS[who]!.name,
    property: name,
    status,
    propertyId: idOf(name),
  });
  return [
    // Jan's day, in the order Maria set.
    item('intern', 'Verdant Hills Lot 12, Tagaytay', 'To post'),
    item('intern', 'Kapitolyo Ground Floor Retail, Pasig', 'Posted'),
    item('intern', 'Casa Amara House and Lot, Antipolo', 'Pending'),
    item('intern', 'Makati Salcedo Office 120 sqm', 'To post'),
    item('intern', 'BGC Uptown Office 18F, 240 sqm', 'Posted'),
    item('intern', 'Valenzuela Warehouse 1,200 sqm', 'To post'),
    item('intern', 'Seaside Residences 2BR, Pasay', 'To post'),
    // Tomorrow's, already planned: not today's queue.
    item('intern', 'Cubao Office Space, 3rd Floor', 'To post', shiftDays(today, 1)),
    item('bea', 'Eastwood Cyber One 6th Floor', 'Posted'),
    item('bea', 'Alabang Filinvest Office Unit 1203', 'To post'),
    item('bea', 'Taytay Warehouse along Manila East Road', 'To post'),
    item('paolo', 'Sunrise Homes Block 3 Lot 9, Silang', 'Posted'),
    item('paolo', 'Carmona Industrial Warehouse, Cavite', 'To post'),
    item('paolo', 'Greenfield Farm Lot, Batangas', 'To post'),
    item('paolo', 'Cubao Office Space, 3rd Floor', 'To post'),
  ];
}

// ------------------------------------------------------------------ photos

/** A stand-in photo: an evening sky and a building's outline, as an image the CSP allows. */
function stillLife(category: string, n: number): string {
  const skies = [
    ['#3b3324', '#16130d'],
    ['#2c3540', '#121418'],
    ['#40302a', '#17110e'],
    ['#2f3a33', '#111512'],
  ] as const;
  const [top, bottom] = skies[n % skies.length]!;
  const shapes: Record<string, string> = {
    [CONDO]: '<path d="M170 330 320 200l150 130v110H170z"/><rect x="290" y="360" width="60" height="80" fill="#0e0c08" opacity=".5"/>',
    [COMMERCIAL]: '<rect x="120" y="230" width="400" height="210"/><rect x="150" y="300" width="340" height="110" fill="#0e0c08" opacity=".45"/>',
    [OFFICE]: '<rect x="230" y="90" width="110" height="350"/><rect x="350" y="170" width="90" height="270"/><rect x="150" y="230" width="70" height="210"/>',
    [WAREHOUSE]: '<path d="M90 440V270q230-110 460 0v170z"/><rect x="270" y="340" width="100" height="100" fill="#0e0c08" opacity=".45"/>',
  };
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">` +
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/>` +
    `<stop offset="1" stop-color="${bottom}"/></linearGradient></defs>` +
    `<rect width="640" height="480" fill="url(#s)"/>` +
    `<g fill="#f3eee4" opacity="${0.1 + (n % 3) * 0.03}">${shapes[category] ?? shapes[CONDO]}</g>` +
    `<rect y="440" width="640" height="40" fill="#0b0906" opacity=".6"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function photosOf(row: Row) {
  return Array.from({ length: row.photos }, (_, i) => {
    const id = `${row.id.slice(0, 20)}p${i + 1}`;
    return {
      id,
      name: `photo ${i + 1}`,
      url: `https://drive.google.com/uc?export=download&id=${id}`,
      thumb: stillLife(row.category, i + row.name.length),
    };
  });
}

// ------------------------------------------------------------------ the web app

export interface DemoOptions {
  /** Who is signed in when the window opens: one of DEMO_KEYS, or null for the sign-in screen. Default 'intern'. */
  readonly signedInAs?: string | null | undefined;
  /** The clock. Default Date.now. */
  readonly now?: (() => number) | undefined;
  /** Answer at once instead of at Google's pace. Default false: the waits are part of the demo. */
  readonly instant?: boolean | undefined;
  /** Draw the window's controls, which do nothing in a browser. Default false. */
  readonly windowControls?: boolean | undefined;
}

type Body = Readonly<Record<string, unknown>>;

const text = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));

export function createDemoPlatform(options: DemoOptions = {}): FakePlatform {
  const now = options.now ?? Date.now;
  const today = (): string => manilaDay(now());
  const pause = (ms: number): Promise<void> =>
    options.instant ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

  // The sheets, seeded on the day the window opened.
  const posts = seedPosts(today());
  const assignments = seedAssignments(today());

  const who = (body: Body): DemoPerson | null => DEMO_KEYS[text(body['key']).trim()] ?? null;
  const unknownKey = {
    ok: false,
    error: 'unauthorized',
    message: "That key isn't on the team. Check it was pasted whole, or ask your admin for yours.",
  };

  /** Answers as Code.gs's route() does: the key first, then the action. */
  const as =
    (wait: number, answer: (me: DemoPerson, body: Body) => unknown) =>
    async (body: Body): Promise<unknown> => {
      await pause(wait);
      const me = who(body);
      return me ? answer(me, body) : unknownKey;
    };

  const lastPosted = (propertyId: string, title: string): string | null => {
    let last: string | null = null;
    for (const p of posts) {
      const same = p.propertyId ? p.propertyId === propertyId : p.title === title;
      if (same && p.status === 'Posted' && (last === null || p.date > last)) last = p.date;
    }
    return last;
  };

  const setAssignment = (propertyId: string, assignedTo: string, status: AssignmentRow['status']): void => {
    for (let i = assignments.length - 1; i >= 0; i--) {
      const a = assignments[i]!;
      if (a.propertyId === propertyId && a.assignedTo === assignedTo && a.status !== 'Posted') {
        a.status = status;
        return;
      }
    }
  };

  const local: Record<string, string> = {
    'postit.settings': JSON.stringify({ scriptUrl: DEMO_URL, cooldownDays: 7, repostDueDays: 14 }),
  };

  return createFakePlatform({
    hasFileSystem: true,
    hasWindowControls: options.windowControls ?? false,
    key: options.signedInAs === undefined ? 'intern' : options.signedInAs,
    local,
    replies: {
      ping: as(500, (me) => ({ ok: true, name: me.name, role: me.role, fbAccounts: me.fbAccounts, time: new Date(now()).toISOString() })),

      properties: as(450, () => ({
        ok: true,
        properties: rows.map((r) => ({
          id: r.id,
          name: r.name,
          category: r.category,
          listingType: r.listingType,
          subCategory: r.subCategory,
          photoCount: r.photos,
          hasIssues: r.issues !== '',
        })),
      })),

      property: as(800, (me, body) => {
        const row = rows.find((r) => r.id === text(body['id']));
        if (!row) return { ok: false, error: `property not found: ${text(body['id'])}` };
        const canSeeInternal = me.role !== 'Intern';
        const cut = splitAtSeparator_(row.doc ?? '');
        const withheld = !cut.found && !canSeeInternal;
        return {
          ok: true,
          property: {
            id: row.id,
            name: row.name,
            category: row.category,
            listingType: row.listingType,
            subCategory: row.subCategory,
            folder: `https://drive.google.com/drive/folders/${row.id}`,
            publicText: withheld ? '' : cut.posting,
            hasInternal: cut.found,
            withheld,
            cutAt: cut.cutAt,
            issues: row.issues,
            live: row.doc !== null,
            photos: photosOf(row),
            ...(canSeeInternal ? { internalText: cut.internal } : {}),
          },
        };
      }),

      posts: as(400, (me) => ({
        ok: true,
        posts: me.role === 'Intern' ? posts.filter((p) => p.postedBy === me.name) : posts,
      })),

      assignments: as(400, (me) => ({
        ok: true,
        assignments: me.role === 'Intern' ? assignments.filter((a) => a.assignedTo === me.name) : assignments,
      })),

      logPost: as(900, (me, body) => {
        const property = text(body['property']);
        const propertyId = text(body['propertyId']);
        const fbAccount = text(body['fbAccount']);
        const missing = ['property', 'propertyId', 'fbAccount'].filter((f) => !text(body[f]));
        if (missing.length) return { ok: false, error: `missing: ${missing.join(', ')}` };

        const postedBy = me.role !== 'Intern' && text(body['postedBy']) ? text(body['postedBy']) : me.name;
        if (me.fbAccounts.length && !me.fbAccounts.includes(fbAccount)) {
          return {
            ok: false,
            error: 'forbidden',
            message: `You can post from ${me.fbAccounts.join(' or ')}, not ${fbAccount}. Pick one of yours.`,
          };
        }

        const last = lastPosted(propertyId, property);
        const day = today();
        if (last !== null) {
          const ago = daysBetween(last, day);
          if (ago < 7) {
            const next = shiftDays(last, 7);
            const by = posts.filter((p) => p.propertyId === propertyId && p.date === last).at(-1)?.postedBy ?? 'someone';
            const when = ago === 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`;
            return {
              ok: false,
              error: 'cooldown',
              lastPosted: last,
              nextAllowed: next,
              message: `Posted ${when} by ${by}. You can post it again on ${spoken(next)}.`,
            };
          }
        }

        const link = text(body['postLink']).trim();
        const status = link ? 'Posted' : 'Pending';
        posts.push({
          date: day,
          time: manilaClock(now()),
          type: text(body['type']) || 'Group post',
          title: property,
          status,
          fbAccount,
          postLink: link,
          postedBy,
          propertyId,
        });
        setAssignment(propertyId, postedBy, status);
        return { ok: true, status, date: day, time: manilaClock(now()), postedBy };
      }),

      addLink: as(700, (me, body) => {
        const link = text(body['postLink']).trim();
        if (!link) return { ok: false, error: 'missing: postLink' };
        const id = text(body['propertyId']);
        const name = text(body['property']);
        for (let i = posts.length - 1; i >= 0; i--) {
          const p = posts[i]!;
          const ours = id ? p.propertyId === id : p.title.trim() === name.trim();
          if (!ours || p.status !== 'Pending') continue;
          if (me.role === 'Intern' && p.postedBy !== me.name) continue;
          p.status = 'Posted';
          p.postLink = link;
          setAssignment(p.propertyId, p.postedBy, 'Posted');
          return { ok: true, row: i + 2 };
        }
        return { ok: false, error: 'notfound', message: 'There is no pending post for that listing. It may already have its link.' };
      }),

      saveQueue: as(900, (me, body) => {
        if (me.role === 'Intern') return { ok: false, error: 'forbidden', message: 'Your account cannot do that.' };
        const date = text(body['date']);
        const assignedTo = text(body['assignedTo']);
        const items = Array.isArray(body['items']) ? (body['items'] as readonly Body[]) : [];
        for (let i = assignments.length - 1; i >= 0; i--) {
          const a = assignments[i]!;
          if (a.date === date && a.assignedTo === assignedTo) assignments.splice(i, 1);
        }
        for (const it of items) {
          const name = text(it['property']);
          assignments.push({
            date,
            assignedTo,
            property: name,
            status: (text(it['status']) as AssignmentRow['status']) || 'To post',
            propertyId: text(it['propertyId']) || (byName.get(name)?.id ?? ''),
          });
        }
        return { ok: true, saved: items.length };
      }),

      setStatus: as(600, (me, body) => {
        const assignedTo = text(body['assignedTo']);
        if (me.role === 'Intern' && assignedTo !== me.name) {
          return { ok: false, error: 'forbidden', message: 'That is not your queue item.' };
        }
        const id = text(body['propertyId']) || (byName.get(text(body['property']))?.id ?? '');
        setAssignment(id, assignedTo, text(body['status']) as AssignmentRow['status']);
        return { ok: true };
      }),
    },
  });
}
