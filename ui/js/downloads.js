// Téléchargements pour l'écoute hors ligne.
// Seuls les titres que leur source autorise à télécharger sont proposés (le backend le revérifie).
// Les fichiers arrivent dans Musique\Spotifive puis apparaissent dans « Fichiers locaux ».

import { call, on } from './api.js';
import { plural, toast } from './ui.js';

const MAX_PARALLEL = 2;

/** Titres en attente ou en cours : identifiant → { track, state, received, total }. */
const jobs = new Map();
const listeners = new Set();
const libraryListeners = new Set();
let running = 0;
let batch = { done: 0, existing: 0, failed: 0 };
let emitQueued = false;

export const canDownload = (track) => Boolean(track?.downloadable) && !track.live && track.source !== 'local';
export const isQueued = (id) => jobs.has(id);
export const list = () => [...jobs.values()];

/** Prévient à chaque changement de la liste ou de la progression. */
export function subscribe(listener) {
  listeners.add(listener);
}

/** Prévient avec la bibliothèque locale mise à jour, une fois une série de téléchargements terminée. */
export function onLibrary(listener) {
  libraryListeners.add(listener);
}

function emit() {
  for (const listener of listeners) listener();
}

function emitSoon() {
  if (emitQueued) return;
  emitQueued = true;
  requestAnimationFrame(() => {
    emitQueued = false;
    emit();
  });
}

/** Met un ou plusieurs titres en file de téléchargement. Renvoie le nombre réellement ajouté. */
export function download(tracks) {
  const added = [].concat(tracks).filter((track) => canDownload(track) && !jobs.has(track.id));
  for (const track of added) jobs.set(track.id, { track, state: 'waiting', received: 0, total: null });
  if (added.length) {
    emit();
    pump();
  }
  return added.length;
}

function pump() {
  for (const job of jobs.values()) {
    if (running >= MAX_PARALLEL) break;
    if (job.state === 'waiting') run(job);
  }
}

async function run(job) {
  const { track } = job;
  running += 1;
  job.state = 'running';
  emit();
  try {
    const outcome = await call('download_track', {
      request: { id: track.id, title: track.title, artist: track.artist, album: track.album || null },
    });
    if (outcome.status === 'exists') batch.existing += 1;
    else batch.done += 1;
  } catch (error) {
    batch.failed += 1;
    toast(`« ${track.title} » : ${error}`, 'error');
  }
  running -= 1;
  jobs.delete(track.id);
  if (jobs.size) pump();
  else await finish();
  emit();
}

async function finish() {
  const { done, existing, failed } = batch;
  batch = { done: 0, existing: 0, failed: 0 };
  if (done) {
    try {
      const library = await call('downloads_finish');
      for (const listener of libraryListeners) listener(library);
    } catch (error) {
      toast(String(error), 'error');
    }
    toast(`${plural(done, 'titre téléchargé', 'titres téléchargés')} : à retrouver dans Fichiers locaux`);
  } else if (existing && !failed) {
    toast(existing > 1 ? 'Ces titres sont déjà téléchargés' : 'Ce titre est déjà téléchargé');
  }
}

on('download://progress', (progress) => {
  const job = jobs.get(progress.id);
  if (!job) return;
  job.received = progress.received;
  job.total = progress.total;
  emitSoon();
});
