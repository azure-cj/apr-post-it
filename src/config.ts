/**
 * The web app link built into this version of the app, so nobody types it.
 *
 * Where it comes from: the Apps Script project, Deploy → Manage deployments.
 * Copy the Web app URL that ends in /exec and paste it into PASTED_SCRIPT_URL
 * below, or put it in a `.env.local` file beside package.json as
 *
 *     VITE_SCRIPT_URL=https://script.google.com/macros/s/…/exec
 *
 * before building. VITE_SCRIPT_URL wins when both are set.
 *
 * How to keep it stable: when the script changes, open Deploy → Manage
 * deployments, edit the existing deployment (the pencil) and pick "New
 * version". That keeps the same /exec link. Deploy → New deployment makes a
 * new link, and every installed copy of the app would need rebuilding.
 *
 * The link is not a secret: on its own it does nothing. Each person's key is
 * the secret, and that is never built in; people paste their own at sign-in.
 *
 * Empty means no link is built in: sign-in then asks for the link as well as
 * the key, as in development and in the tests.
 */
const PASTED_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwWTEWS4OJ43wxj0YAlFax1re27Yl6uML4mvxxC4fTYv1VV6UtOfKs3IncOxCThkNjg/exec';

const fromEnv = typeof import.meta.env.VITE_SCRIPT_URL === 'string' ? import.meta.env.VITE_SCRIPT_URL.trim() : '';

/** The web app's /exec link for this build, or '' when none is built in. */
export const BUILT_IN_SCRIPT_URL: string = fromEnv || PASTED_SCRIPT_URL.trim();

/**
 * The server version this app was built against: SERVER_VERSION at the top of
 * server/Code.gs, which ping sends. Change both together (a test holds them
 * equal). A server older than this is told to be redeployed (serverVersionStatus).
 */
export const EXPECTED_SERVER_VERSION = '2026-11-13.1';
