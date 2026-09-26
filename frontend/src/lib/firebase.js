/**
 * Firebase for the Action Hub: Cloud Firestore, with every visitor signed in
 * anonymously so the security rules (firestore.rules at the repo root) can
 * require a signed-in user.
 *
 * The web config comes from VITE_FIREBASE_* variables (frontend/.env.local,
 * or the build environment). It identifies the project and is not a secret:
 * access is controlled by the security rules, not by hiding these values.
 * The SDK is loaded on first use, so it never weighs on the other pages.
 */
const env = import.meta.env ?? {}

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

/** The four values the SDK cannot work without. */
export const REQUIRED_KEYS = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']
export const firebaseConfigured = REQUIRED_KEYS.every((key) => Boolean(env[key]))

let ready = null

/**
 * The Firestore instance and its module, once the visitor is signed in.
 * Resolves `{ db, fs, uid }`; rejects with a readable message when the
 * config is missing or anonymous sign-in is turned off.
 */
export function getFirestoreReady() {
  if (!firebaseConfigured) return Promise.reject(new Error('Firebase is not configured.'))
  if (!ready) {
    ready = (async () => {
      const [{ initializeApp, getApps }, auth, fs] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore'),
      ])
      const app = getApps()[0] ?? initializeApp(firebaseConfig)
      const authInstance = auth.getAuth(app)
      try {
        const { user } = authInstance.currentUser ? { user: authInstance.currentUser } : await auth.signInAnonymously(authInstance)
        return { db: fs.getFirestore(app), fs, uid: user.uid }
      } catch (error) {
        const code = error?.code ?? ''
        throw new Error(
          code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation'
            ? 'Anonymous sign-in is turned off. In the Firebase console, open Authentication → Sign-in method and enable Anonymous.'
            : code === 'auth/unauthorized-domain'
              ? `This site's domain is not authorised. Add it under Authentication → Settings → Authorised domains.`
              : `Could not sign in to Firebase (${code || error?.message || 'unknown error'}).`,
          { cause: error },
        )
      }
    })()
    // A failed start can be retried (for example after enabling anonymous sign-in).
    ready.catch(() => {
      ready = null
    })
  }
  return ready
}
