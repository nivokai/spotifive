// Les pages de l'application.

import { call, on } from './api.js';
import {
  art,
  cards,
  chips,
  collectionCard,
  emptyState,
  fill,
  playCard,
  section,
  skeletonCards,
  skeletonRows,
  trackList,
} from './components.js';
import * as player from './player.js';
import * as router from './router.js';
import * as store from './store.js';
import { askConfirm, askText, debounce, el, fmtTime, icon, plural, toast } from './ui.js';
import * as updates from './updates.js';

const GENRES = [
  'Electronic', 'Hip-Hop/Rap', 'Pop', 'Rock', 'Lo-Fi', 'House', 'Techno', 'Jazz', 'Ambient',
  'R&B/Soul', 'Latin', 'Classical', 'Metal', 'Reggae', 'Drum & Bass', 'Folk', 'Funk',
];

const PERIODS = [
  { value: 'week', label: 'Cette semaine' },
  { value: 'month', label: 'Ce mois-ci' },
  { value: 'year', label: 'Cette année' },
];

const RADIO_TAGS = [
  { value: '', label: 'Toutes' },
  { value: 'pop', label: 'Pop' },
  { value: 'rock', label: 'Rock' },
  { value: 'jazz', label: 'Jazz' },
  { value: 'classical', label: 'Classique' },
  { value: 'electronic', label: 'Électro' },
  { value: 'hip hop', label: 'Hip-hop' },
  { value: 'chillout', label: 'Chill' },
  { value: 'news', label: 'Infos' },
  { value: '80s', label: 'Années 80' },
  { value: '90s', label: 'Années 90' },
  { value: 'metal', label: 'Metal' },
  { value: 'reggae', label: 'Reggae' },
];

const COUNTRIES = [
  ['', 'Monde entier'], ['FR', 'France'], ['BE', 'Belgique'], ['CH', 'Suisse'], ['CA', 'Canada'],
  ['LU', 'Luxembourg'], ['MA', 'Maroc'], ['DZ', 'Algérie'], ['TN', 'Tunisie'], ['SN', 'Sénégal'],
  ['CI', "Côte d'Ivoire"], ['US', 'États-Unis'], ['GB', 'Royaume-Uni'], ['DE', 'Allemagne'],
  ['ES', 'Espagne'], ['IT', 'Italie'], ['PT', 'Portugal'], ['NL', 'Pays-Bas'], ['BR', 'Brésil'], ['JP', 'Japon'],
];

const SOURCE_NAMES = { audius: 'Audius', archive: 'Internet Archive' };

// ---------- Mémoire courte : revenir sur une page déjà vue est instantané ----------

const memory = new Map();

async function cached(key, lifetime, loader) {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < lifetime) return hit.data;
  const data = await loader();
  memory.set(key, { at: Date.now(), data });
  if (memory.size > 60) memory.delete(memory.keys().next().value);
  return data;
}

const MINUTES = 60_000;

/** Pays utilisé pour les radios : celui choisi, sinon celui de la langue du système. */
function country() {
  const chosen = store.get().country;
  if (chosen != null) return chosen;
  const [language, region] = (navigator.language || '').split('-');
  const guess = (region || { fr: 'FR', de: 'DE', es: 'ES', it: 'IT', pt: 'PT', nl: 'NL', ja: 'JP' }[language] || '').toUpperCase();
  return COUNTRIES.some(([code]) => code === guess) ? guess : '';
}

const page = (...children) => el('div', { class: 'page' }, children);
const stack = (...children) => el('div', { class: 'stack' }, children);
const linkTo = (label, target) => el('button', { class: 'link', text: label, onclick: () => router.navigate(target) });

/** Bandeau qui ouvre YouTube Music dans l'application, éventuellement sur une recherche. */
function catalogueBanner(query) {
  return el(
    'button',
    { class: 'promo', onclick: () => router.navigate(query ? { name: 'catalogue', q: query } : { name: 'catalogue' }) },
    icon('globe', 30),
    el(
      'div',
      { class: 'promo-text' },
      el('strong', { text: query ? `Chercher « ${query} » dans tout le catalogue` : 'Tout le catalogue mondial' }),
      el('span', {
        text: query
          ? 'Tous les artistes et tous les titres, en entier, avec YouTube Music intégré.'
          : 'Tous les artistes et tous les titres, en entier : YouTube Music intégré, gratuit avec ses publicités.',
      }),
    ),
    el('span', { class: 'btn primary', text: query ? 'Chercher' : 'Ouvrir' }),
  );
}

function notice(errors) {
  return errors?.length ? el('div', { class: 'notice', text: `Source indisponible pour le moment — ${errors.join(' · ')}` }) : null;
}

function playActions(tracks, ...more) {
  return el(
    'div',
    { class: 'actions' },
    el('button', { class: 'btn primary', disabled: !tracks.length, onclick: () => player.playList(tracks, 0) }, icon('play', 16), 'Lire'),
    el('button', { class: 'btn', disabled: tracks.length < 2, onclick: () => player.playShuffled(tracks) }, icon('shuffle', 16), 'Aléatoire'),
    more,
  );
}

function totalDuration(tracks) {
  const seconds = tracks.reduce((sum, track) => sum + (track.duration || 0), 0);
  if (!seconds) return '';
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;
}

function hero({ cover, kind, title, sub, tracks, actions = [] }) {
  return el(
    'div',
    { class: 'hero' },
    cover,
    el(
      'div',
      { class: 'hero-text' },
      el('div', { class: 'hero-kind', text: kind }),
      el('h1', { text: title }),
      el('div', { class: 'hero-sub', text: sub }),
      playActions(tracks, ...actions),
    ),
  );
}

// ---------- Accueil ----------

router.register('home', () => {
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Bonne nuit' : hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  const recent = store.get().recent;
  const slot = stack(section('Tendances de la semaine', skeletonRows(6)), section('Playlists populaires', skeletonCards()));

  fill(
    slot,
    () => cached(`home:${country()}`, 5 * MINUTES, () => call('home', { country: country() || null })),
    (data) => [
      notice(data.errors),
      data.trending.length &&
        section(
          'Tendances de la semaine',
          [
            chips(GENRES.slice(0, 10).map((genre) => ({ value: genre, label: genre })), null, (genre) =>
              router.navigate({ name: 'trending', genre }),
            ),
            el('div', { style: { height: '10px' } }),
            trackList(data.trending, { limit: 8 }),
          ],
          linkTo('Tout voir', { name: 'trending' }),
        ),
      data.playlists.length && section('Playlists populaires', cards(data.playlists.map(collectionCard), true)),
      data.radios.length &&
        section(
          'Radios populaires',
          cards(data.radios.map((_, position) => playCard(data.radios, position)), true),
          linkTo('Toutes les radios', { name: 'radios' }),
        ),
    ],
  );

  return page(
    el('div', null, el('h1', { text: greeting }), el('p', { class: 'lead', text: 'Tout le catalogue mondial, de la musique libre, des radios et tes propres fichiers.' })),
    catalogueBanner(),
    recent.length > 0 && section('Écoutés récemment', cards(recent.map((_, position) => playCard(recent, position)), true)),
    slot,
  );
});

// ---------- Tendances ----------

router.register('trending', (route) => {
  const filters = { genre: route.genre || '', time: 'week' };
  const slot = el('div');
  const bar = el('div', { class: 'stack small' });

  function draw() {
    bar.replaceChildren(
      chips(PERIODS, filters.time, (time) => {
        filters.time = time;
        draw();
      }),
      chips([{ value: '', label: 'Tous les genres' }, ...GENRES.map((genre) => ({ value: genre, label: genre }))], filters.genre, (genre) => {
        filters.genre = genre;
        draw();
      }),
    );
    slot.replaceChildren(skeletonRows(10));
    fill(
      slot,
      () =>
        cached(`trending:${filters.genre}:${filters.time}`, 5 * MINUTES, () =>
          call('audius_trending', { genre: filters.genre || null, time: filters.time }),
        ),
      (tracks) =>
        tracks.length
          ? [playActions(tracks), el('div', { style: { height: '14px' } }), trackList(tracks)]
          : emptyState('note', 'Rien pour ce filtre', 'Essaie un autre genre ou une autre période.'),
    );
  }
  draw();

  return page(
    el('div', null, el('h1', { text: 'Tendances' }), el('p', { class: 'lead', text: 'Les titres les plus écoutés sur Audius, publiés par les artistes eux-mêmes.' })),
    bar,
    slot,
  );
});

// ---------- Recherche ----------

router.register('search', (route) => {
  const slot = stack(section('Titres', skeletonRows(6)), section('Albums et playlists', skeletonCards()));
  fill(
    slot,
    () => cached(`search:${route.q.toLowerCase()}`, 3 * MINUTES, () => call('search_all', { query: route.q })),
    (data) => {
      const found = data.tracks.length + data.playlists.length + data.albums.length + data.radios.length;
      if (!found) {
        return [
          notice(data.errors),
          emptyState('search', 'Rien dans la musique libre ni les radios', 'Le bandeau ci-dessus cherche dans tout le catalogue mondial.'),
        ];
      }
      return [
        notice(data.errors),
        data.tracks.length && section('Titres en musique libre (Audius)', trackList(data.tracks, { limit: 40 })),
        data.playlists.length && section('Playlists et albums sur Audius', cards(data.playlists.map(collectionCard))),
        data.albums.length && section('Albums sur Internet Archive', cards(data.albums.map(collectionCard))),
        data.radios.length && section('Radios', cards(data.radios.map((_, position) => playCard(data.radios, position)))),
      ];
    },
  );
  return page(el('h1', { text: `Résultats pour « ${route.q} »` }), catalogueBanner(route.q), slot);
});

// ---------- Album ou playlist en ligne ----------

router.register('collection', (route) => {
  const slot = stack(skeletonRows(8));
  fill(
    slot,
    () => cached(`collection:${route.id}`, 10 * MINUTES, () => call('collection_detail', { id: route.id })),
    ({ collection, tracks }) => [
      hero({
        cover: art(collection.artwork, { fallback: 'list', size: 56 }),
        kind: `${collection.kind === 'album' ? 'Album' : 'Playlist'} · ${SOURCE_NAMES[collection.source] || ''}`,
        title: collection.title,
        sub: [collection.subtitle, plural(tracks.length, 'titre', 'titres'), totalDuration(tracks)].filter(Boolean).join(' · '),
        tracks,
      }),
      tracks.length
        ? trackList(tracks)
        : emptyState('note', 'Aucun titre écoutable', 'Cette sélection ne contient pas de fichier audio lisible.'),
    ],
  );
  return page(slot);
});

// ---------- Radios ----------

router.register('radios', () => {
  const filters = { name: '', tag: '', country: country() };
  const slot = el('div');
  const tagBar = el('div');

  function load() {
    tagBar.replaceChildren(
      chips(RADIO_TAGS, filters.tag, (tag) => {
        filters.tag = tag;
        load();
      }),
    );
    slot.replaceChildren(skeletonCards(12));
    const key = `radios:${filters.name.toLowerCase()}:${filters.tag}:${filters.country}`;
    fill(
      slot,
      () =>
        cached(key, 10 * MINUTES, () =>
          call('radio_search', { name: filters.name || null, tag: filters.tag || null, country: filters.country || null }),
        ),
      (stations) =>
        stations.length
          ? cards(stations.map((_, position) => playCard(stations, position)))
          : emptyState('radio', 'Aucune radio trouvée', 'Essaie un autre style, un autre pays ou « Monde entier ».'),
    );
  }

  const select = el(
    'select',
    {
      class: 'field',
      'aria-label': 'Pays',
      onchange: () => {
        filters.country = select.value;
        store.set({ country: select.value });
        load();
      },
    },
    COUNTRIES.map(([code, name]) => el('option', { value: code, text: name, selected: code === filters.country })),
  );
  const search = el('input', {
    class: 'field grow',
    type: 'search',
    placeholder: 'Filtrer par nom de radio…',
    spellcheck: false,
    oninput: debounce(() => {
      filters.name = search.value.trim();
      load();
    }, 350),
  });
  load();

  return page(
    el('div', null, el('h1', { text: 'Radios' }), el('p', { class: 'lead', text: 'Des milliers de radios en direct, classées par popularité.' })),
    el('div', { class: 'toolbar' }, select, search),
    tagBar,
    slot,
  );
});

// ---------- Titres aimés ----------

router.register('likes', () => {
  const tracks = store.get().likes;
  return page(
    hero({
      cover: art(null, { fallback: 'heart', size: 64 }),
      kind: 'Bibliothèque',
      title: 'Titres aimés',
      sub: [plural(tracks.length, 'titre', 'titres'), totalDuration(tracks)].filter(Boolean).join(' · '),
      tracks,
    }),
    tracks.length
      ? trackList(tracks)
      : emptyState('heart', 'Aucun titre aimé pour l’instant', 'Clique sur le cœur d’un titre ou d’une radio pour le retrouver ici.'),
  );
});

// ---------- Playlist personnelle ----------

router.register('playlist', (route) => {
  const playlist = store.playlist(route.id);
  if (!playlist) return page(emptyState('list', 'Playlist introuvable', 'Elle a peut-être été supprimée.'));
  const { tracks } = playlist;

  const rename = async () => {
    const name = await askText({ title: 'Renommer la playlist', value: playlist.name, confirm: 'Renommer' });
    if (name) store.renamePlaylist(playlist.id, name);
  };
  const remove = async () => {
    const yes = await askConfirm({
      title: 'Supprimer la playlist ?',
      message: `« ${playlist.name} » sera supprimée définitivement. Les titres eux-mêmes ne sont pas touchés.`,
      confirm: 'Supprimer',
      danger: true,
    });
    if (!yes) return;
    store.deletePlaylist(playlist.id);
    router.navigate({ name: 'home' }, { replace: true });
    toast('Playlist supprimée');
  };

  return page(
    hero({
      cover: art(tracks[0]?.artwork || tracks[0]?.thumb, { fallback: 'list', size: 64 }),
      kind: 'Playlist',
      title: playlist.name,
      sub: [plural(tracks.length, 'titre', 'titres'), totalDuration(tracks)].filter(Boolean).join(' · '),
      tracks,
      actions: [
        el('button', { class: 'btn', onclick: rename }, icon('edit', 16), 'Renommer'),
        el('button', { class: 'btn danger', onclick: remove }, icon('trash', 16), 'Supprimer'),
      ],
    }),
    tracks.length
      ? trackList(tracks, {
          menu: (track) => [
            {
              label: 'Retirer de cette playlist',
              icon: 'trash',
              danger: true,
              action: () => store.removeFromPlaylist(playlist.id, track.id),
            },
          ],
        })
      : emptyState('list', 'Cette playlist est vide', 'Ouvre le menu « … » d’un titre, puis choisis cette playlist.'),
  );
});

// ---------- Fichiers locaux ----------

let library = null;
let scanning = false;
let scanProgress = null;
let localFilter = '';

on('library://progress', (progress) => {
  scanProgress = progress;
  const label = document.getElementById('scan-status');
  if (label) label.textContent = `Analyse… ${progress.done} / ${progress.total}`;
});

async function libraryAction(command, args) {
  if (scanning) return;
  scanning = true;
  scanProgress = null;
  router.refresh();
  try {
    const result = await call(command, args);
    if (result) library = result;
  } catch (error) {
    toast(String(error), 'error');
  } finally {
    scanning = false;
    if (router.route()?.name === 'local') router.refresh();
  }
}

router.register('local', () => {
  const body = el('div', { class: 'stack' });

  function draw() {
    // Sans dossier, seul l'écran d'accueil de la bibliothèque est utile.
    toolbar.hidden = !library?.folders.length;
    if (!library) return body.replaceChildren(skeletonRows(8));
    const needle = localFilter.toLowerCase();
    const tracks = needle
      ? library.tracks.filter((track) => `${track.title}\n${track.artist}\n${track.album || ''}`.toLowerCase().includes(needle))
      : library.tracks;

    const results = el('div');
    const drawResults = () =>
      results.replaceChildren(
        tracks.length
          ? trackList(tracks)
          : emptyState('search', 'Aucun titre ne correspond', 'Modifie ou efface le filtre.'),
      );

    if (!library.folders.length) {
      return body.replaceChildren(
        emptyState(
          'folder',
          'Ajoute ta musique',
          'Choisis un dossier de ton PC : Spotifive y trouve les fichiers MP3, FLAC, M4A, OGG, Opus et WAV, et lit leurs titres et pochettes.',
          el('button', { class: 'btn primary', disabled: scanning, onclick: () => libraryAction('library_add_folder') }, icon('plus', 16), 'Ajouter un dossier'),
        ),
      );
    }

    drawResults();
    body.replaceChildren(
      el(
        'div',
        { class: 'folders' },
        library.folders.map((folder) =>
          el(
            'div',
            { class: 'folder' },
            icon('folder', 16),
            el('span', { text: folder, title: folder }),
            el('button', { class: 'icon-btn', title: 'Retirer ce dossier', 'aria-label': 'Retirer ce dossier', disabled: scanning, onclick: () => libraryAction('library_remove_folder', { folder }) }, icon('close', 16)),
          ),
        ),
      ),
      library.tracks.length
        ? results
        : emptyState('note', 'Aucun fichier audio trouvé', 'Ces dossiers ne contiennent pas de musique dans un format lisible.'),
    );
  }

  const filter = el('input', {
    class: 'field grow',
    type: 'search',
    placeholder: 'Filtrer par titre, artiste ou album…',
    value: localFilter,
    spellcheck: false,
    oninput: debounce(() => {
      localFilter = filter.value.trim();
      draw();
    }, 200),
  });

  const count = library ? plural(library.tracks.length, 'titre', 'titres') : '';
  const toolbar = el(
    'div',
    { class: 'toolbar' },
    el('button', { class: 'btn', disabled: scanning, onclick: () => libraryAction('library_add_folder') }, icon('plus', 16), 'Ajouter un dossier'),
    el('button', { class: 'btn', disabled: scanning, onclick: () => libraryAction('library_rescan') }, icon('refresh', 16), 'Actualiser'),
    filter,
    el('span', {
      id: 'scan-status',
      class: 'link',
      text: scanning ? (scanProgress ? `Analyse… ${scanProgress.done} / ${scanProgress.total}` : 'Analyse en cours…') : count,
    }),
  );

  draw();
  if (!library) {
    call('library_get')
      .then((result) => {
        library = result;
        if (router.route()?.name === 'local') router.refresh();
      })
      .catch((error) => body.replaceChildren(emptyState('folder', 'Bibliothèque illisible', String(error))));
  }

  return page(
    el('div', null, el('h1', { text: 'Fichiers locaux' }), el('p', { class: 'lead', text: 'La musique déjà présente sur ton PC, lue directement depuis le disque.' })),
    toolbar,
    body,
  );
});

// ---------- Réglages ----------

router.register('settings', () => {
  const version = el('span', { text: '…' });
  call('app_info').then((info) => (version.textContent = info.version)).catch(() => (version.textContent = '?'));

  const status = el('p', { text: 'Spotifive vérifie les mises à jour à chaque démarrage.' });
  const button = el('button', {
    class: 'btn',
    onclick: async () => {
      button.disabled = true;
      status.textContent = 'Recherche en cours…';
      try {
        const found = await updates.check();
        status.textContent = found
          ? `La version ${found.version} est disponible : installe-la depuis l’encart en bas à gauche.`
          : 'Tu as déjà la dernière version.';
      } catch (error) {
        status.textContent = String(error);
      } finally {
        button.disabled = false;
      }
    },
  }, icon('refresh', 16), 'Rechercher une mise à jour');

  const source = (iconName, name, text) =>
    el('div', { class: 'source' }, icon(iconName, 22), el('div', null, el('strong', { text: name }), el('p', { text })));

  const keys = [
    ['Espace', 'Lecture / pause'],
    ['Ctrl + →', 'Titre suivant'],
    ['Ctrl + ←', 'Titre précédent'],
    ['→ / ←', 'Avancer / reculer de 5 secondes'],
    ['Ctrl + K', 'Aller à la recherche'],
    ['M', 'Couper / rétablir le son'],
    ['Alt + ← / →', 'Page précédente / suivante'],
  ];

  return page(
    el('h1', { text: 'Réglages' }),
    el('div', { class: 'panel' }, el('h2', null, 'Mises à jour — version ', version), status, el('div', { class: 'actions' }, button)),
    el(
      'div',
      { class: 'panel' },
      el('h2', { text: 'D’où vient la musique' }),
      el('p', { text: 'Spotifive n’utilise que des sources gratuites dont la diffusion est autorisée. Aucun titre n’est piraté.' }),
      el(
        'div',
        { class: 'sources' },
        source('globe', 'YouTube Music (Tout le catalogue)', 'Le site officiel de YouTube Music, affiché tel quel dans l’application avec ses publicités. Spotifive ne copie et ne télécharge rien ; les titres de cette page ne rejoignent pas tes playlists Spotifive.'),
        source('note', 'Audius', 'Plateforme de streaming ouverte où les artistes publient eux-mêmes leurs titres.'),
        source('radio', 'Radio Browser', 'Annuaire communautaire de radios du monde entier. Chaque radio diffuse sous sa propre licence.'),
        source('archive', 'Internet Archive', 'Albums de netlabels en licence libre et concerts dont l’enregistrement est autorisé par les artistes.'),
        source('folder', 'Fichiers locaux', 'Ta propre musique, lue depuis ton disque. Rien n’est envoyé sur Internet.'),
      ),
    ),
    el(
      'div',
      { class: 'panel' },
      el('h2', { text: 'Raccourcis clavier' }),
      el('div', { class: 'keys' }, keys.map(([key, label]) => [el('kbd', { text: key }), el('span', { text: label })])),
    ),
  );
});
