// Mise à jour automatique : vérification, téléchargement, installation.

import { call, on } from './api.js';

const listeners = new Set();
const status = { info: null, installing: false, progress: null };

function emit() {
  for (const listener of listeners) listener(status);
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const current = () => status;

/** Interroge le serveur. Renvoie la mise à jour disponible, ou `null` si tout est à jour. */
export async function check() {
  status.info = await call('update_check');
  emit();
  return status.info;
}

/** Télécharge et installe : l'application redémarre toute seule à la fin. */
export async function install() {
  if (status.installing) return;
  status.installing = true;
  status.progress = null;
  emit();
  try {
    await call('update_install');
  } catch (error) {
    status.installing = false;
    emit();
    throw error;
  }
}

on('update://progress', (progress) => {
  status.progress = progress;
  emit();
});
