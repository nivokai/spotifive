// Composants réutilisés par les pages : pochettes, listes de titres, cartes, menus.

import { mediaUrl } from './api.js';
import * as player from './player.js';
import * as router from './router.js';
import * as store from './store.js';
import { askText, el, fmtTime, icon, openMenu, toast } from './ui.js';

const CHUNK = 120;

// ---------- Pochette ----------

export function art(url, { fallback = 'note', contain = false, size = 22 } = {}) {
  const box = el('div', { class: `art${contain ? ' contain' : ''}` }, icon(fallback, size));
  const src = mediaUrl(url);
  if (src) {
    const img = el('img', { alt: '', loading: 'lazy', decoding: 'async', draggable: false, referrerPolicy: 'no-referrer' });
    // Image introuvable : on la retire, l'icône de remplacement reste visible dessous.
    img.addEventListener('error', () => img.remove());
    img.addEventListener('load', () => box.classList.add('has-img'));
    img.src = src;
    box.append(img);
  }
  return box;
}

const trackArt = (track, large = false) =>
  art(large ? track.artwork || track.thumb : track.thumb || track.artwork, {
    fallback: track.live ? 'radio' : 'note',
    contain: Boolean(track.live),
    size: large ? 40 : 20,
  });

// ---------- Marqueurs « en cours » et « aimé » ----------

function setCurrentMark(node, id, playing) {
  const active = node.dataset.track === id;
  node.classList.toggle('is-current', active);
  node.classList.toggle('is-playing', active && playing);
}

function setLikeMark(button) {
  const liked = store.isLiked(button.dataset.like);
  const label = liked ? 'Retirer des titres aimés' : 'Ajouter aux titres aimés';
  button.classList.toggle('is-liked', liked);
  button.title = label;
  button.setAttribute('aria-label', label);
}

/** Met à jour le surlignage du titre en cours partout dans la fenêtre. */
export function markCurrent() {
  const id = player.current()?.id;
  const playing = player.isPlaying();
  for (const node of document.querySelectorAll('[data-track]')) setCurrentMark(node, id, playing);
}

/** Met à jour tous les boutons cœur. */
export function markLikes() {
  for (const button of document.querySelectorAll('[data-like]')) setLikeMark(button);
}

export function likeButton(track) {
  const button = el(
    'button',
    {
      class: 'icon-btn like',
      dataset: { like: track.id },
      onclick: (event) => {
        event.stopPropagation();
        store.toggleLike(track);
      },
    },
    icon('heart', 18),
  );
  setLikeMark(button);
  return button;
}

// ---------- Menu d'un titre ----------

export async function newPlaylistFlow(track) {
  const name = await askText({ title: 'Nouvelle playlist', placeholder: 'Nom de la playlist', confirm: 'Créer' });
  if (!name) return null;
  const created = store.createPlaylist(name);
  if (track) {
    store.addToPlaylist(created.id, track);
    toast(`Ajouté à « ${name} »`);
  }
  return created;
}

export function trackMenu(track, anchor, { extra = [], onClose } = {}) {
  const liked = store.isLiked(track.id);
  openMenu(
    anchor,
    [
      {
        label: 'Lire ensuite',
        icon: 'play',
        action: () => {
          player.playNext(track);
          toast('Sera lu juste après');
        },
      },
      {
        label: "Ajouter à la file d'attente",
        icon: 'queue',
        action: () => {
          player.enqueue(track);
          toast("Ajouté à la file d'attente");
        },
      },
      { separator: true },
      {
        label: liked ? 'Retirer des titres aimés' : 'Ajouter aux titres aimés',
        icon: 'heart',
        action: () => store.toggleLike(track),
      },
      ...extra,
      { separator: true },
      { heading: 'Ajouter à une playlist' },
      ...store.get().playlists.map((playlist) => ({
        label: playlist.name,
        icon: 'list',
        action: () =>
          toast(
            store.addToPlaylist(playlist.id, track)
              ? `Ajouté à « ${playlist.name} »`
              : `Déjà dans « ${playlist.name} »`,
          ),
      })),
      { label: 'Nouvelle playlist…', icon: 'plus', action: () => newPlaylistFlow(track) },
    ],
    { onClose },
  );
}

/** Lance une liste à partir d'un titre ; un clic sur le titre déjà en cours fait pause / lecture. */
function playFrom(tracks, position) {
  if (player.current()?.id === tracks[position].id) player.toggle();
  else player.playList(tracks, position);
}

// ---------- Liste de titres ----------

function row(tracks, position, options) {
  const track = tracks[position];
  const openRowMenu = (anchor) => {
    node.classList.add('menu-open');
    trackMenu(track, anchor, {
      extra: options.menu ? options.menu(track) : [],
      onClose: () => node.classList.remove('menu-open'),
    });
  };
  const more = el(
    'button',
    {
      class: 'icon-btn',
      title: "Plus d'actions",
      'aria-label': "Plus d'actions",
      onclick: (event) => {
        event.stopPropagation();
        openRowMenu(more);
      },
    },
    icon('more', 18),
  );
  const node = el(
    'div',
    {
      class: 'row',
      tabIndex: 0,
      dataset: { track: track.id },
      onclick: () => playFrom(tracks, position),
      onkeydown: (event) => {
        if (event.key === 'Enter' && event.target === node) playFrom(tracks, position);
      },
      oncontextmenu: (event) => {
        event.preventDefault();
        openRowMenu({ x: event.clientX, y: event.clientY });
      },
    },
    el(
      'div',
      { class: 'idx' },
      el('span', { text: String(position + 1) }),
      icon('play', 15),
      el('div', { class: 'eq' }, el('i'), el('i'), el('i')),
    ),
    trackArt(track),
    el(
      'div',
      { class: 'meta' },
      el('div', { class: 'title', text: track.title }),
      el('div', { class: 'artist' }, track.live && [el('span', { class: 'live-tag', text: 'DIRECT' }), ' '], track.artist),
    ),
    el('div', { class: 'extra', text: track.album || track.info || '' }),
    likeButton(track),
    el('div', { class: 'dur', text: fmtTime(track.duration) }),
    more,
  );
  setCurrentMark(node, player.current()?.id, player.isPlaying());
  return node;
}

/**
 * Liste de titres. Les lignes sont créées par paquets au fil du défilement,
 * pour qu'une bibliothèque de plusieurs milliers de titres s'affiche instantanément.
 * `limit` n'affiche que les premiers titres, tout en gardant la liste entière pour la lecture.
 */
export function trackList(tracks, options = {}) {
  const total = Math.min(tracks.length, options.limit ?? Infinity);
  const list = el('div', { class: 'tracks' });
  const sentinel = el('div', { class: 'sentinel' });
  let rendered = 0;

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) grow();
    },
    { root: document.getElementById('view'), rootMargin: '800px 0px' },
  );

  function grow() {
    const fragment = document.createDocumentFragment();
    const end = Math.min(total, rendered + CHUNK);
    for (; rendered < end; rendered += 1) fragment.append(row(tracks, rendered, options));
    list.insertBefore(fragment, sentinel);
    observer.unobserve(sentinel);
    if (rendered < total) observer.observe(sentinel);
    else sentinel.remove();
  }

  list.append(sentinel);
  grow();
  return list;
}

// ---------- Cartes ----------

/** Carte d'un album ou d'une playlist en ligne : ouvre sa page. */
export function collectionCard(collection) {
  return el(
    'button',
    { class: 'card', onclick: () => router.navigate({ name: 'collection', id: collection.id }) },
    art(collection.artwork, { fallback: 'list', size: 40 }),
    el('div', { class: 'card-title', text: collection.title }),
    el('div', { class: 'card-sub', text: collection.subtitle }),
  );
}

/** Carte d'un titre ou d'une radio : lance la lecture de la liste à partir de là. */
export function playCard(tracks, position) {
  const track = tracks[position];
  const cover = trackArt(track, true);
  cover.append(el('span', { class: 'card-play' }, icon('play', 18)));
  const node = el(
    'button',
    {
      class: `card${track.live ? ' station' : ''}`,
      dataset: { track: track.id },
      onclick: () => playFrom(tracks, position),
      oncontextmenu: (event) => {
        event.preventDefault();
        trackMenu(track, { x: event.clientX, y: event.clientY });
      },
    },
    cover,
    el('div', { class: 'card-title', text: track.title }),
    el('div', { class: 'card-sub', text: track.artist }),
  );
  setCurrentMark(node, player.current()?.id, player.isPlaying());
  return node;
}

export const cards = (nodes, oneRow = false) => el('div', { class: `cards${oneRow ? ' one-row' : ''}` }, nodes);

// ---------- Mise en page ----------

export function section(title, body, action) {
  return el('section', null, el('div', { class: 'section-head' }, el('h2', { text: title }), action), body);
}

export function chips(items, active, onPick) {
  return el(
    'div',
    { class: 'chips' },
    items.map((item) =>
      el('button', {
        class: `chip${item.value === active ? ' is-active' : ''}`,
        text: item.label,
        onclick: () => onPick(item.value),
      }),
    ),
  );
}

export function emptyState(iconName, title, text, action) {
  return el('div', { class: 'empty' }, icon(iconName, 44), el('h3', { text: title }), text && el('p', { text }), action);
}

export const skeletonRows = (count = 8) =>
  el('div', null, Array.from({ length: count }, () => el('div', { class: 'skeleton line' })));

export const skeletonCards = (count = 6) =>
  el('div', { class: 'cards one-row' }, Array.from({ length: count }, () => el('div', { class: 'skeleton tile' })));

/**
 * Remplit une zone avec le résultat d'un chargement.
 * En cas d'échec, affiche l'erreur et un bouton pour réessayer.
 */
export async function fill(slot, loader, build) {
  try {
    const data = await loader();
    slot.replaceChildren(...[build(data)].flat(Infinity).filter(Boolean));
  } catch (error) {
    slot.replaceChildren(
      emptyState(
        'globe',
        'Chargement impossible',
        String(error),
        el('button', { class: 'btn', text: 'Réessayer', onclick: () => fill(slot, loader, build) }),
      ),
    );
  }
}
