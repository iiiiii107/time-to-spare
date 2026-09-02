import { store } from './store.js';
import { fromGoogleList, toGoogle } from './gmerge.js';

/* Talking to Google Calendar.

   Reading is the point: your real calendar, on your own paper. Writing is
   deliberate and one event at a time — a draft goes up when you say so and
   never on its own, which is what you asked for and also what makes this safe
   to leave switched on.

   The site is static, so there is no server to hold a refresh token. Access
   tokens come from Google Identity Services and last about an hour. Once the
   permission has been granted a new one can be fetched without a prompt, so in
   practice it asks once and quietly renews after that.

   This is the same Google project and the same OAuth client as
   10 Minutes to Spare. Both apps are served from the same origin, so the
   client needed nothing added to it. */

const SCOPES = [
  // Reading every calendar you have, and the list of them.
  'https://www.googleapis.com/auth/calendar.readonly',
  // Writing the events this app creates, and only those.
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/calendar/v3';

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export function calendarConfigured() {
  return Boolean(clientId);
}

/* ---------- the access token ---------- */

let token = null;
let tokenExpires = 0;
let tokenClient = null;
let gisLoading = null;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;

  gisLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google could not be reached.'));
    document.head.append(script);
  });
  return gisLoading;
}

async function client() {
  if (tokenClient) return tokenClient;
  await loadGis();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: () => {}, // replaced per request below
  });
  return tokenClient;
}

/**
 * A usable access token.
 * @param {boolean} interactive true to let Google show its consent screen.
 *   Must be called straight from a click when true, or the popup is blocked.
 */
async function accessToken({ interactive = false } = {}) {
  if (token && Date.now() < tokenExpires - 60_000) return token;

  const gis = await client();
  return new Promise((resolve, reject) => {
    gis.callback = (response) => {
      if (response.error) {
        reject(Object.assign(new Error(response.error), { code: response.error }));
        return;
      }
      token = response.access_token;
      tokenExpires = Date.now() + Number(response.expires_in || 3600) * 1000;
      resolve(token);
    };
    try {
      // An empty prompt means "only if you don't have to ask", which works
      // once the permission has been granted before.
      gis.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    } catch (err) {
      reject(err);
    }
  });
}

/** Ask for the permission. Call this straight from a click. */
export async function connectCalendar() {
  await accessToken({ interactive: true });
  await store.updateSettings({ googleCalendar: true });
  return true;
}

export async function disconnectCalendar() {
  if (token && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(token, () => {});
    } catch {
      // Revoking is a courtesy; losing the token locally is what matters.
    }
  }
  token = null;
  tokenExpires = 0;
  await store.updateSettings({ googleCalendar: false });
  await store.setGoogleEvents([], null);
}

export function calendarConnected() {
  return store.state?.settings?.googleCalendar === true;
}

/* ---------- the calls ---------- */

async function call(path, { method = 'GET', body, bearer } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw Object.assign(
      new Error(data?.error?.message || `Google said ${response.status}`),
      { status: response.status },
    );
  }
  return response.json();
}

/** Every calendar on the account, in the order Google lists them. */
export async function listCalendars({ interactive = false } = {}) {
  const bearer = await accessToken({ interactive });
  const data = await call('/users/me/calendarList?maxResults=250', { bearer });
  return (data.items || [])
    .filter((entry) => !entry.deleted)
    .map((entry) => ({
      id: entry.id,
      name: entry.summaryOverride || entry.summary || entry.id,
      color: entry.backgroundColor || '#2F5C96',
      accessRole: entry.accessRole,
      primary: Boolean(entry.primary),
    }));
}

/**
 * Everything between two dates, from every calendar you have turned on.
 *
 * `singleEvents` makes Google expand its own recurring events, so each
 * occurrence arrives ready to draw and this app's rule engine stays out of it
 * entirely. Cancelled occurrences still come back and are dropped on the way
 * in.
 *
 * @param {string} from 'YYYY-MM-DD'
 * @param {string} to 'YYYY-MM-DD'
 */
export async function fetchEvents(from, to, { interactive = false } = {}) {
  const bearer = await accessToken({ interactive });
  const chosen = (store.state.googleCalendars || []).filter((c) => c.visible !== false);
  if (!chosen.length) return [];

  const timeMin = new Date(`${from}T00:00:00`).toISOString();
  const timeMax = new Date(`${to}T23:59:59`).toISOString();

  const pages = await Promise.all(chosen.map(async (calendar) => {
    const query = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
    });
    try {
      const data = await call(
        `/calendars/${encodeURIComponent(calendar.id)}/events?${query}`,
        { bearer },
      );
      return fromGoogleList(data.items, calendar);
    } catch (err) {
      // One calendar failing shouldn't empty the whole week.
      console.warn(`Could not read "${calendar.name}".`, err);
      return [];
    }
  }));

  return pages.flat();
}

/**
 * Send a draft up. Returns the id Google gave it, which is what makes the
 * local copy step aside from then on.
 */
export async function pushEvent(event, calendarId) {
  const bearer = await accessToken({ interactive: false });
  const target = calendarId
    || (store.state.googleCalendars || []).find((c) => c.primary)?.id
    || 'primary';

  const created = await call(`/calendars/${encodeURIComponent(target)}/events`, {
    method: 'POST',
    body: toGoogle(event),
    bearer,
  });
  return { googleId: created.id, calendarId: target };
}
