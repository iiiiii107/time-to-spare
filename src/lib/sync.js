import { clone, storage, withDefaults } from './storage.js';

/* Sync, by way of a Google account.

   Signing in with Google gives every person their own private calendar: the
   data lives under their own user id and the security rules make that the only
   place they can read or write. Nobody — including whoever owns the site — can
   see anyone else's events.

   The same Firebase project as 10 Minutes to Spare, and the same account, but
   its own document — see the path below.

   The whole app state is one Firestore document. It's small (kilobytes), it
   always changes as a unit, and one document means one read on open, one
   listener for live updates, and no chance of half a sync arriving. Firestore's
   own cache keeps it working offline; changes queue and go up when you're back.

   The SDK is loaded on demand, so if sync isn't configured — or you never sign
   in — none of it is downloaded. */

/** Config comes from the environment, as one JSON blob copied from Firebase. */
function readConfig() {
  const raw = import.meta.env.VITE_FIREBASE_CONFIG;
  if (!raw) return null;
  try {
    const config = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return config?.apiKey && config?.projectId ? config : null;
  } catch {
    console.warn('VITE_FIREBASE_CONFIG is not valid JSON — sync stays off.');
    return null;
  }
}

const config = readConfig();

/** True when the site was built with a Firebase project attached. */
export function syncConfigured() {
  return config !== null;
}

let sdk = null;

/** Loads and starts Firebase once, then hands back the same handles. */
async function firebase() {
  if (sdk) return sdk;

  const [app, auth, firestore] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
  ]);

  const instance = app.getApps().length ? app.getApp() : app.initializeApp(config);

  // Persistent cache: the app opens and works with no connection, and several
  // tabs share one copy rather than fighting over the lock.
  let db;
  try {
    db = firestore.initializeFirestore(instance, {
      localCache: firestore.persistentLocalCache({
        tabManager: firestore.persistentMultipleTabManager(),
      }),
    });
  } catch {
    db = firestore.getFirestore(instance);
  }

  sdk = { app, auth, firestore, instance, db, authInstance: auth.getAuth(instance) };
  return sdk;
}

/* ---------- the account ---------- */

const account = new EventTarget();
let currentUser = null;
let watching = false;
let lastError = null;

/** The signed-in user, or null. Only ever id, name, email and photo. */
export function currentAccount() {
  return currentUser;
}

/**
 * Why sync isn't working, in words worth showing someone — a database that
 * hasn't been created yet, rules that say no, a connection that isn't there.
 * Null when nothing has gone wrong.
 */
export function syncError() {
  return lastError;
}

function describe(err) {
  const message = String(err?.message || err);
  if (/has not been used in project|is disabled/i.test(message)) {
    return 'The database has not been created yet — make it in the Firebase console, then reload.';
  }
  if (err?.code === 'permission-denied' || /permission/i.test(message)) {
    return 'The database refused the write — check the security rules have been published.';
  }
  if (err?.code === 'unavailable' || /offline|network/i.test(message)) {
    return 'No connection to the database. Your changes are saved here and will go up when it is back.';
  }
  return 'Sync could not start. Your calendar is safe in this browser.';
}

/** Fires 'change' whenever the signed-in account changes. */
export function onAccountChange(fn) {
  account.addEventListener('change', fn);
  return () => account.removeEventListener('change', fn);
}

function announce() {
  account.dispatchEvent(new CustomEvent('change'));
}

/**
 * Picks the session back up on load, so signing in is a once-per-device thing.
 * Safe to call when sync isn't configured — it just does nothing.
 */
export async function restoreSession() {
  if (!config || watching) return;
  watching = true;

  const { auth, authInstance } = await firebase();

  // A redirect sign-in (phones, where popups get blocked) lands back here.
  try {
    await auth.getRedirectResult(authInstance);
  } catch (err) {
    console.warn('Sign-in did not complete.', err);
  }

  auth.onAuthStateChanged(authInstance, async (user) => {
    if (user) {
      currentUser = {
        uid: user.uid,
        name: user.displayName,
        email: user.email,
        photo: user.photoURL,
      };
      try {
        await storage.use(createCloudStorage(user.uid));
        lastError = null;
      } catch (err) {
        // Signed in, but the database won't have us. Stay on this browser
        // rather than losing the app — and say plainly what went wrong.
        console.warn('Sync could not start.', err);
        lastError = describe(err);
        await storage.use(null);
      }
    } else {
      currentUser = null;
      lastError = null;
      await storage.use(null);
    }
    announce();
  });
}

/** Google sign-in. Tries a popup, falls back to a redirect where popups die. */
export async function signIn() {
  if (!config) throw new Error('Sync is not set up for this site.');

  const { auth, authInstance } = await firebase();
  await restoreSession();

  const provider = new auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(authInstance, provider);
  } catch (err) {
    const fallback = [
      'auth/popup-blocked',
      'auth/popup-closed-by-user',
      'auth/cancelled-popup-request',
      'auth/operation-not-supported-in-this-environment',
    ];
    if (fallback.includes(err?.code)) {
      await auth.signInWithRedirect(authInstance, provider);
      return;
    }
    throw err;
  }
}

/** Signs out and goes back to this browser's own copy. */
export async function signOutOfSync() {
  const { auth, authInstance } = await firebase();
  await auth.signOut(authInstance);
}

/* ---------- the cloud backend ---------- */

/**
 * One document, `users/{uid}/app/calendar`, holding the whole state.
 * Same four methods as the local backend, so `storage` can't tell them apart.
 */
export function createCloudStorage(uid) {
  const listeners = new Set();
  let cached = null;
  let stop = null;
  let writing = 0;

  async function ref() {
    const { firestore, db } = await firebase();
    /* 'calendar', not 'state'.

       10 Minutes to Spare writes to users/{uid}/app/state in this same
       project. Sharing the path would have had each app overwrite the other
       every time you opened it — the two live side by side under one account,
       so they need a document each. */
    return { f: firestore, doc: firestore.doc(db, 'users', uid, 'app', 'calendar') };
  }

  /** Starts the live listener. Another device's change lands here. */
  async function watch() {
    if (stop) return;
    const { f, doc } = await ref();
    stop = f.onSnapshot(doc, (snap) => {
      // Our own write comes back as an echo; we already have that state.
      if (snap.metadata.hasPendingWrites || writing > 0) return;
      if (!snap.exists()) return;
      cached = withDefaults(JSON.parse(snap.data().payload || '{}'));
      listeners.forEach((fn) => fn(cached));
    }, (err) => console.warn('Sync listener stopped.', err));
  }

  return {
    kind: 'cloud',

    async load() {
      const { f, doc } = await ref();
      const snap = await f.getDoc(doc);

      if (snap.exists()) {
        cached = withDefaults(JSON.parse(snap.data().payload || '{}'));
      } else {
        // First sign-in on this account: whatever is already in this browser
        // becomes the starting point, so nothing you've entered is lost.
        cached = withDefaults(clone(await storage.local.load()));
        await this.save(cached);
      }

      watch();
      return cached;
    },

    async save(state) {
      // No fan-out here: whoever called save already holds this state, and the
      // snapshot echo is filtered out below.
      cached = state;

      const { f, doc } = await ref();
      writing += 1;
      try {
        // setDoc resolves once it's in the local cache, and Firestore sends it
        // on whenever there's a connection — offline saves are never lost.
        await f.setDoc(doc, {
          payload: JSON.stringify(state),
          updatedAt: f.serverTimestamp(),
        });
      } catch (err) {
        console.warn('Could not sync — it will go up when you are back online.', err);
      } finally {
        writing -= 1;
      }
    },

    subscribe(fn) {
      listeners.add(fn);
      watch();
      return () => listeners.delete(fn);
    },

    async exportAll() {
      return JSON.stringify(cached ?? (await this.load()), null, 2);
    },

    async importAll(json) {
      await this.save(withDefaults(JSON.parse(json)));
    },

    close() {
      stop?.();
      stop = null;
      listeners.clear();
    },
  };
}
