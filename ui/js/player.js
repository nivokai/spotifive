// Moteur de lecture : file d'attente, enchaînement des titres, modes aléatoire et répétition.
// Le décodage audio est confié au lecteur natif de la fenêtre (accéléré par le système).

import { call, mediaUrl } from './api.js';
import * as store from './store.js';
import { toast } from './ui.js';

const audio = document.getElementById('audio');
const listeners = new Set();
const LOAD_TIMEOUT = 15000;

const state = {
  queue: [],
  index: -1,
  playing: false,
  loading: false,
  shuffle: false,
  repeat: 'off', // off | all | one
  /** Ordre d'origine, conservé tant que le mode aléatoire est actif. */
  ordered: null,
};

let level = 0.8;
let loadToken = 0;
let failures = 0;

/** S'abonne aux évènements : `track`, `state`, `time`, `queue`, `modes`, `volume`. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(kind) {
  for (const listener of listeners) listener(kind);
}

export const current = () => state.queue[state.index] || null;
export const queue = () => state.queue;
export const index = () => state.index;
export const isPlaying = () => state.playing;
export const isLoading = () => state.loading;
export const modes = () => ({ shuffle: state.shuffle, repeat: state.repeat });
export const volume = () => ({ level, muted: audio.muted });
export const position = () => audio.currentTime || 0;

export function duration() {
  const real = audio.duration;
  if (Number.isFinite(real) && real > 0) return real;
  return current()?.duration || 0;
}

export function init() {
  const saved = store.get();
  level = Number.isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : 0.8;
  audio.volume = level * level;
  audio.muted = Boolean(saved.muted);
  state.shuffle = Boolean(saved.shuffle);
  state.repeat = ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'off';
}

function shuffled(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ---------- Chargement d'un titre ----------

/** Adresses à essayer, dans l'ordre, pour lire un titre. */
async function sourcesFor(track) {
  if (track.source === 'audius') {
    try {
      // Les adresses Audius sont signées et expirent : on en redemande une fraîche.
      const fresh = await call('audius_resolve', { id: track.id.slice('audius:'.length) });
      return [fresh.url, ...(fresh.mirrors || [])];
    } catch (error) {
      if (track.url) return [track.url, ...(track.mirrors || [])];
      throw error;
    }
  }
  return [mediaUrl(track.url), ...(track.mirrors || [])];
}

function withTimeout(promise, delay) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('délai dépassé')), delay);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function begin(position) {
  const track = state.queue[position];
  if (!track) return;
  const token = ++loadToken;
  state.index = position;
  state.loading = true;
  audio.pause();
  emit('track');
  emit('time');

  let lastError = new Error('aucune adresse de lecture');
  try {
    for (const source of await sourcesFor(track)) {
      if (token !== loadToken) return;
      if (!source) continue;
      try {
        audio.src = source;
        await withTimeout(audio.play(), LOAD_TIMEOUT);
        if (token !== loadToken) return;
        failures = 0;
        state.loading = false;
        state.playing = true;
        emit('state');
        store.pushRecent(track);
        if (track.source === 'radio') call('radio_click', { id: track.id }).catch(() => {});
        return;
      } catch (error) {
        lastError = error;
      }
    }
  } catch (error) {
    lastError = error;
  }
  if (token !== loadToken) return;

  console.warn('Lecture impossible :', track.id, lastError);
  audio.removeAttribute('src');
  audio.load();
  state.loading = false;
  state.playing = false;
  emit('state');
  failures += 1;
  toast(`Impossible de lire « ${track.title} »`, 'error');
  // On passe au suivant, sans s'acharner si plusieurs titres d'affilée échouent.
  if (failures < 3 && state.index < state.queue.length - 1) begin(state.index + 1);
}

// ---------- Commandes ----------

/** Remplace la file d'attente par une liste et démarre au titre choisi. */
export function playList(tracks, startAt = 0) {
  if (!tracks.length) return;
  const start = Math.max(0, Math.min(startAt, tracks.length - 1));
  failures = 0;
  if (state.shuffle && tracks.length > 1) {
    state.ordered = tracks.slice();
    state.queue = [tracks[start], ...shuffled(tracks.filter((_, i) => i !== start))];
    begin(0);
  } else {
    state.ordered = null;
    state.queue = tracks.slice();
    begin(start);
  }
  emit('queue');
}

/** Lit toute une liste dans un ordre aléatoire. */
export function playShuffled(tracks) {
  if (!tracks.length) return;
  if (!state.shuffle) {
    state.shuffle = true;
    store.set({ shuffle: true });
    emit('modes');
  }
  playList(tracks, Math.floor(Math.random() * tracks.length));
}

export function playNext(track) {
  if (!current()) return playList([track]);
  state.queue.splice(state.index + 1, 0, track);
  state.ordered?.push(track);
  emit('queue');
}

export function enqueue(track) {
  if (!current()) return playList([track]);
  state.queue.push(track);
  state.ordered?.push(track);
  emit('queue');
}

export function jump(position) {
  if (position === state.index || !state.queue[position]) return;
  failures = 0;
  begin(position);
  emit('queue');
}

export function removeAt(position) {
  if (position === state.index || !state.queue[position]) return;
  const [removed] = state.queue.splice(position, 1);
  if (state.ordered) state.ordered = state.ordered.filter((track) => track !== removed);
  if (position < state.index) state.index -= 1;
  emit('queue');
}

export function toggle() {
  const track = current();
  if (!track || state.loading) return;
  if (!audio.paused) {
    audio.pause();
    if (track.live) {
      // Inutile de continuer à télécharger un direct mis en pause.
      audio.removeAttribute('src');
      audio.load();
    }
  } else if (track.live || !audio.currentSrc) {
    begin(state.index);
  } else {
    audio.play().catch(() => begin(state.index));
  }
}

export function next(automatic = false) {
  if (!state.queue.length) return;
  failures = 0;
  if (state.index < state.queue.length - 1) begin(state.index + 1);
  else if (state.repeat === 'all' || !automatic) begin(0);
  else {
    state.playing = false;
    emit('state');
  }
  emit('queue');
}

export function prev() {
  const track = current();
  if (!track) return;
  if (state.index === 0 || (!track.live && audio.currentTime > 3)) {
    if (!track.live && audio.currentSrc) audio.currentTime = 0;
    return;
  }
  failures = 0;
  begin(state.index - 1);
  emit('queue');
}

/** Déplace la lecture à une fraction (0 à 1) du titre. */
export function seek(fraction) {
  const total = duration();
  if (!total || current()?.live || !audio.currentSrc) return;
  audio.currentTime = Math.max(0, Math.min(1, fraction)) * total;
  emit('time');
}

export function seekBy(seconds) {
  const total = duration();
  if (total) seek((audio.currentTime + seconds) / total);
}

export function setVolume(value) {
  level = Math.max(0, Math.min(1, value));
  // Courbe quadratique : la progression du curseur paraît régulière à l'oreille.
  audio.volume = level * level;
  if (level > 0) audio.muted = false;
  store.set({ volume: level, muted: audio.muted });
  emit('volume');
}

export function toggleMute() {
  audio.muted = !audio.muted;
  store.set({ muted: audio.muted });
  emit('volume');
}

export function toggleShuffle() {
  state.shuffle = !state.shuffle;
  const track = current();
  if (track && state.queue.length > 1) {
    if (state.shuffle) {
      state.ordered = state.queue.slice();
      state.queue = [track, ...shuffled(state.queue.filter((_, i) => i !== state.index))];
      state.index = 0;
    } else if (state.ordered) {
      state.queue = state.ordered;
      state.index = Math.max(0, state.queue.indexOf(track));
      state.ordered = null;
    }
    emit('queue');
  }
  store.set({ shuffle: state.shuffle });
  emit('modes');
}

export function cycleRepeat() {
  state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat];
  store.set({ repeat: state.repeat });
  emit('modes');
}

// ---------- Évènements du lecteur natif ----------

audio.addEventListener('play', () => {
  state.playing = true;
  emit('state');
});

audio.addEventListener('pause', () => {
  if (state.loading) return;
  state.playing = false;
  emit('state');
});

audio.addEventListener('timeupdate', () => emit('time'));
audio.addEventListener('durationchange', () => emit('time'));

audio.addEventListener('ended', () => {
  if (state.repeat === 'one') {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } else {
    next(true);
  }
});

audio.addEventListener('error', () => {
  // Pendant un chargement, l'échec est déjà géré par `begin`.
  if (state.loading || !current() || !audio.currentSrc) return;
  state.playing = false;
  emit('state');
  toast(current().live ? 'Le direct a été interrompu' : 'La lecture a été interrompue', 'error');
});

// ---------- Touches multimédia du clavier et commandes du système ----------

if ('mediaSession' in navigator) {
  const session = navigator.mediaSession;
  const bind = (action, handler) => {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Action non prise en charge par ce système : sans conséquence.
    }
  };
  bind('play', toggle);
  bind('pause', toggle);
  bind('nexttrack', () => next());
  bind('previoustrack', prev);
  bind('seekto', (details) => {
    const total = duration();
    if (total && Number.isFinite(details.seekTime)) seek(details.seekTime / total);
  });

  subscribe((kind) => {
    if (kind === 'track') {
      const track = current();
      if (!track) return;
      const art = mediaUrl(track.artwork || track.thumb);
      session.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || '',
        artwork: art ? [{ src: art }] : [],
      });
    } else if (kind === 'state') {
      session.playbackState = state.playing ? 'playing' : 'paused';
    }
  });
}
