// Faux backend pour prévisualiser l'interface dans un simple navigateur (node dev/serve.mjs).
// Il n'est jamais chargé dans l'application : celle-ci parle au vrai backend Rust.
// Ajoute `?update` à l'adresse pour voir l'encart de mise à jour.

const COVER = 'https://archive.org/services/img/inautumnalfog_chapter_II';
const AUDIO = 'https://archive.org/download/inautumnalfog_chapter_II/01_Munarheim_-_Herbst.mp3';

const NAMES = [
  ['Herbst', 'Munarheim'], ['Nachtwind über den Feldern', 'Waldgeflüster'], ['A Very Long Track Title That Should Be Cut Off Cleanly', 'An Artist With A Rather Long Name'],
  ['Brume', 'Lueur'], ['Sillage', 'Les Heures Bleues'], ['Cendres', 'Vesper'], ['Orage lent', 'Atlas Nord'], ['Lisière', 'Fauve'],
  ['Minuit moins une', 'Corail'], ['Derniers feux', 'Halo'], ['Écume', 'Mistral'], ['Racines', 'Sève'],
];

const track = (i, extra = {}) => ({
  id: `archive:demo/${i}`,
  source: 'archive',
  title: NAMES[i % NAMES.length][0],
  artist: NAMES[i % NAMES.length][1],
  album: 'In Autumnal Fog',
  duration: 133 + i * 17,
  artwork: i % 4 === 3 ? null : COVER,
  thumb: i % 4 === 3 ? null : COVER,
  url: AUDIO,
  mirrors: [],
  info: 'Ambient',
  live: false,
  ...extra,
});

const station = (i) => ({
  id: `radio:demo-${i}`,
  source: 'radio',
  title: ['101 Smooth Jazz', 'Radio Démo', 'Une Radio Au Nom Extrêmement Long Pour Tester', 'FIP Démo', 'Nova Démo', 'Classique Démo'][i % 6],
  artist: 'France · jazz, pop',
  duration: null,
  artwork: i % 2 ? null : 'http://101smoothjazz.com/favicon.ico',
  thumb: i % 2 ? null : 'http://101smoothjazz.com/favicon.ico',
  url: 'http://jking.cdnstream1.com/b22139_128mp3',
  mirrors: [],
  info: 'MP3 128 kbps',
  live: true,
});

const collection = (i) => ({
  id: `archive:demo-album-${i}`,
  source: 'archive',
  kind: i % 2 ? 'playlist' : 'album',
  title: ['In Autumnal Fog', 'Nuits claires', 'Sélection de la semaine', 'Un titre d’album vraiment très long'][i % 4],
  subtitle: 'Skeksis Netlabel Project',
  artwork: i % 3 === 2 ? null : COVER,
  count: 12,
});

const tracks = (count) => Array.from({ length: count }, (_, i) => track(i));
const stations = (count) => Array.from({ length: count }, (_, i) => station(i));
const collections = (count) => Array.from({ length: count }, (_, i) => collection(i));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let library = { folders: [], tracks: [] };
const handlers = new Map();
const emit = (event, payload) => handlers.get(event)?.forEach((handler) => handler({ payload }));

const commands = {
  app_info: () => ({ version: '0.1.0-apercu' }),
  home: () => ({ trending: tracks(30), playlists: collections(10), radios: stations(12), errors: [] }),
  search_all: ({ query }) =>
    query.toLowerCase() === 'rien'
      ? { tracks: [], playlists: [], albums: [], radios: [], errors: [] }
      : { tracks: tracks(14), playlists: collections(4), albums: collections(6), radios: stations(5), errors: [] },
  audius_trending: () => tracks(40),
  audius_resolve: ({ id }) => track(0, { id: `audius:${id}` }),
  collection_detail: ({ id }) => ({ collection: { ...collection(0), id }, tracks: tracks(12) }),
  radio_search: () => stations(24),
  radio_click: () => null,
  // Dans l'aperçu, la page YouTube Music n'existe pas : la zone réservée affiche ce message.
  catalogue_show: () => {
    throw new Error('Aperçu : YouTube Music ne s’affiche que dans la vraie application.');
  },
  catalogue_bounds: () => null,
  catalogue_hide: () => null,
  catalogue_pause: () => null,
  catalogue_nav: () => null,
  library_get: () => library,
  library_add_folder: async () => {
    for (let done = 100; done <= 400; done += 100) {
      await wait(250);
      emit('library://progress', { done, total: 400 });
    }
    library = {
      folders: [...library.folders, `C:\\Users\\demo\\Music\\Dossier ${library.folders.length + 1}`],
      tracks: Array.from({ length: 400 }, (_, i) => track(i, { id: `local:demo/${i}`, source: 'local', info: null })),
    };
    return library;
  },
  library_remove_folder: ({ folder }) => {
    const folders = library.folders.filter((known) => known !== folder);
    library = { folders, tracks: folders.length ? library.tracks : [] };
    return library;
  },
  library_rescan: async () => {
    await wait(400);
    return library;
  },
  state_load: () => JSON.parse(localStorage.getItem('spotifive-apercu') || 'null'),
  state_save: ({ state }) => localStorage.setItem('spotifive-apercu', JSON.stringify(state)),
  update_check: () => (location.search.includes('update') ? { version: '0.2.0', current: '0.1.0', notes: null } : null),
  update_install: async () => {
    for (let downloaded = 0; downloaded <= 100; downloaded += 10) {
      await wait(200);
      emit('update://progress', { downloaded, total: 100 });
    }
    throw new Error('Aperçu : installation simulée');
  },
};

export async function invoke(command, args = {}) {
  await wait(250);
  if (!commands[command]) throw new Error(`Commande inconnue : ${command}`);
  return commands[command](args);
}

export function listen(event, handler) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(handler);
  return Promise.resolve(() => handlers.get(event).delete(handler));
}

export const fileSrc = (path) => path;
