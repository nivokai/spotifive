// Données de l'utilisateur : titres aimés, playlists, écoutes récentes et réglages.
// Tout est enregistré sur le disque par le backend Rust, peu après chaque changement.

import { call } from './api.js';
import { toast } from './ui.js';

const DEFAULTS = {
  likes: [],
  playlists: [],
  recent: [],
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: 'off',
  country: null,
};

const RECENT_MAX = 24;
const TRACK_FIELDS = ['id', 'source', 'title', 'artist', 'album', 'duration', 'artwork', 'thumb', 'url', 'mirrors', 'info', 'live', 'downloadable'];

let data = structuredClone(DEFAULTS);
let likedIds = new Set();
let saveTimer = null;
let saveFailed = false;
const listeners = new Set();

/** Ne garde d'un titre que les champs utiles à sa réécoute. */
function slim(track) {
  const copy = {};
  for (const field of TRACK_FIELDS) if (track[field] != null) copy[field] = track[field];
  return copy;
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await call('state_save', { state: data });
      saveFailed = false;
    } catch (error) {
      if (!saveFailed) toast(`Sauvegarde impossible : ${error}`, 'error');
      saveFailed = true;
    }
  }, 300);
}

function changed(kind) {
  persist();
  for (const listener of listeners) listener(kind);
}

export async function init() {
  try {
    const saved = await call('state_load');
    if (saved && typeof saved === 'object') data = { ...structuredClone(DEFAULTS), ...saved };
  } catch (error) {
    toast(`Lecture des données impossible : ${error}`, 'error');
  }
  for (const key of ['likes', 'playlists', 'recent']) if (!Array.isArray(data[key])) data[key] = [];
  data.playlists = data.playlists.filter((playlist) => playlist && playlist.id && Array.isArray(playlist.tracks));
  likedIds = new Set(data.likes.map((track) => track.id));
}

/** S'abonne aux changements : `likes`, `playlists`, `recent` ou `settings`. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const get = () => data;

export function set(patch) {
  Object.assign(data, patch);
  changed('settings');
}

// ---------- Titres aimés ----------

export const isLiked = (id) => likedIds.has(id);

export function toggleLike(track) {
  if (likedIds.has(track.id)) {
    likedIds.delete(track.id);
    data.likes = data.likes.filter((liked) => liked.id !== track.id);
  } else {
    likedIds.add(track.id);
    data.likes.unshift(slim(track));
  }
  changed('likes');
  return likedIds.has(track.id);
}

// ---------- Écoutes récentes ----------

export function pushRecent(track) {
  if (data.recent[0]?.id === track.id) return;
  data.recent = [slim(track), ...data.recent.filter((recent) => recent.id !== track.id)].slice(0, RECENT_MAX);
  changed('recent');
}

// ---------- Playlists ----------

export const playlist = (id) => data.playlists.find((item) => item.id === id) || null;

export function createPlaylist(name) {
  const created = { id: `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, tracks: [] };
  data.playlists.push(created);
  changed('playlists');
  return created;
}

export function renamePlaylist(id, name) {
  const target = playlist(id);
  if (!target) return;
  target.name = name;
  changed('playlists');
}

export function deletePlaylist(id) {
  data.playlists = data.playlists.filter((item) => item.id !== id);
  changed('playlists');
}

/** Ajoute un titre à une playlist. Renvoie `false` s'il y était déjà. */
export function addToPlaylist(id, track) {
  const target = playlist(id);
  if (!target || target.tracks.some((existing) => existing.id === track.id)) return false;
  target.tracks.push(slim(track));
  changed('playlists');
  return true;
}

export function removeFromPlaylist(id, trackId) {
  const target = playlist(id);
  if (!target) return;
  target.tracks = target.tracks.filter((track) => track.id !== trackId);
  changed('playlists');
}
