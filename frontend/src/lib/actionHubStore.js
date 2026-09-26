/**
 * Action Hub data in Cloud Firestore.
 *
 *   responders/{id}           registered people (photo as a small data URL)
 *   plans/{planId}            one needs list per risk area
 *   tasks/{number}            assigned tasks, numbered from 1001
 *   tasks/{number}/updates/*  progress updates, with optional proof photo and location
 *   counters/tasks            { next } for the task numbers
 *
 * Every open page listens live, so an assignment or an update made on one
 * device appears on every other within a second or two. The shapes written
 * here must match firestore.rules at the repo root.
 */
import { useEffect, useState } from 'react'
import { firebaseConfigured, getFirestoreReady } from './firebase'

export const FIRST_TASK_NUMBER = 1001
const now = () => new Date().toISOString()

/** Live responders, tasks and plans. `status`: off (no config) | loading | ready | error. */
export function useActionHubData() {
  const [state, setState] = useState(() => ({
    status: firebaseConfigured ? 'loading' : 'off',
    error: null,
    responders: [],
    tasks: [],
    plans: [],
  }))

  useEffect(() => {
    if (!firebaseConfigured) return undefined
    let unsubscribes = []
    let cancelled = false
    const loaded = new Set()
    getFirestoreReady()
      .then(({ db, fs }) => {
        if (cancelled) return
        const listen = (key, ref) =>
          fs.onSnapshot(
            ref,
            (snapshot) => {
              loaded.add(key)
              const rows = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
              setState((prev) => ({ ...prev, [key]: rows, status: loaded.size === 3 ? 'ready' : prev.status }))
            },
            (error) => setState((prev) => ({ ...prev, status: 'error', error: readable(error) })),
          )
        unsubscribes = [
          listen('responders', fs.query(fs.collection(db, 'responders'), fs.orderBy('name'))),
          listen('tasks', fs.query(fs.collection(db, 'tasks'), fs.orderBy('number', 'desc'))),
          listen('plans', fs.collection(db, 'plans')),
        ]
      })
      .catch((error) => !cancelled && setState((prev) => ({ ...prev, status: 'error', error: error.message })))
    return () => {
      cancelled = true
      unsubscribes.forEach((stop) => stop())
    }
  }, [])

  return state
}

function readable(error) {
  if (error?.code === 'permission-denied') {
    return 'Firestore refused access. Publish the rules in firestore.rules (Firebase console → Firestore → Rules) and enable Anonymous sign-in.'
  }
  if (error?.code === 'failed-precondition') return `Firestore is not ready: ${error.message}`
  return error?.message ?? 'Firestore request failed.'
}

async function run(write) {
  try {
    return await write(await getFirestoreReady())
  } catch (error) {
    throw new Error(readable(error), { cause: error })
  }
}

export function createResponder(data) {
  return run(async ({ db, fs }) => {
    const ref = await fs.addDoc(fs.collection(db, 'responders'), { ...data, createdAt: now(), updatedAt: now() })
    return ref.id
  })
}

export function savePlan(planId, plan) {
  return run(({ db, fs }) => fs.setDoc(fs.doc(db, 'plans', planId), { ...plan, createdAt: now() }))
}

/** Creates a task with the next number (a transaction, so two coordinators never get the same one). */
export function createTask(fields) {
  return run(({ db, fs }) =>
    fs.runTransaction(db, async (tx) => {
      const counterRef = fs.doc(db, 'counters', 'tasks')
      const counter = await tx.get(counterRef)
      const number = counter.exists() ? counter.data().next : FIRST_TASK_NUMBER
      tx.set(counterRef, { next: number + 1 })
      tx.set(fs.doc(db, 'tasks', String(number)), {
        ...fields,
        number,
        status: 'assigned',
        createdAt: now(),
        updatedAt: now(),
        lastNote: '',
        proofCount: 0,
        lastLocation: null,
      })
      return number
    }),
  )
}

/** A responder's progress update: stored in the task's history, and the task's status moves on. */
export function submitUpdate(task, { status, note, photo, location, by }) {
  return run(async ({ db, fs }) => {
    const batch = fs.writeBatch(db)
    const taskRef = fs.doc(db, 'tasks', task.id)
    batch.set(fs.doc(fs.collection(taskRef, 'updates')), {
      status,
      note: note ?? '',
      photo: photo ?? '',
      lat: location?.lat ?? null,
      lon: location?.lon ?? null,
      by: by ?? '',
      at: now(),
    })
    batch.update(taskRef, {
      status,
      updatedAt: now(),
      lastNote: note ?? '',
      proofCount: (task.proofCount ?? 0) + (photo ? 1 : 0),
      lastLocation: location ? { lat: location.lat, lon: location.lon } : task.lastLocation ?? null,
    })
    await batch.commit()
  })
}

/** Live history of one task's updates, oldest first. */
export function useTaskUpdates(taskId, enabled = true) {
  const [updates, setUpdates] = useState(null)
  useEffect(() => {
    if (!enabled || !firebaseConfigured || !taskId) return undefined
    let stop = () => {}
    let cancelled = false
    getFirestoreReady()
      .then(({ db, fs }) => {
        if (cancelled) return
        stop = fs.onSnapshot(fs.query(fs.collection(db, 'tasks', taskId, 'updates'), fs.orderBy('at')), (snapshot) =>
          setUpdates(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))),
        )
      })
      .catch(() => setUpdates([]))
    return () => {
      cancelled = true
      stop()
    }
  }, [taskId, enabled])
  return updates
}

/**
 * A picked image, shrunk to at most `maxSide` px and re-encoded as JPEG, as a
 * data URL: small enough for a Firestore document (1 MB limit).
 */
export function imageToDataUrl(file, maxSide = 320, quality = 0.8) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) {
      reject(new Error('Choose an image file.'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the image.'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('Could not read the image.'))
      image.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(image.width * scale)
        canvas.height = Math.round(image.height * scale)
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      image.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}
