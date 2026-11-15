// Point d'entrée : relie la barre latérale, la recherche, le lecteur, la file d'attente et les raccourcis.

import { isTauri } from './api.js';
import { art, likeButton, markCurrent, markLikes, newPlaylistFlow, trackMenu } from './components.js';
import * as player from './player.js';
import * as router from './router.js';
import * as store from './store.js';
import { closeMenu, debounce, el, fmtTime, icon, setIcon, toast } from './ui.js';
import * as updates from './updates.js';
import './views.js';
import './catalogue.js';

const $ = (id) => document.getElementById(id);

// ---------- Icônes des boutons fixes ----------

for (const [id, name, size] of [
  ['new-playlist', 'plus', 18],
  ['nav-back', 'back', 18],
  ['nav-forward', 'forward', 18],
  ['open-settings', 'settings', 18],
  ['queue-close', 'close', 18],
  ['btn-prev', 'prev', 20],
  ['btn-next', 'next', 20],
  ['btn-queue', 'queue', 20],
]) {
  setIcon($(id), name, size);
}
document.querySelector('.search-icon').append(icon('search', 18));

// ---------- Barre latérale ----------

const NAV = [
  { name: 'home', label: 'Accueil', icon: 'home' },
  { name: 'catalogue', label: 'Tout le catalogue', icon: 'globe' },
  { name: 'radios', label: 'Radios', icon: 'radio' },
  { name: 'likes', label: 'Titres aimés', icon: 'heart' },
  { name: 'local', label: 'Fichiers locaux', icon: 'folder' },
];

function renderNav() {
  const route = router.route();
  const active = route?.name === 'trending' ? 'home' : route?.name;
  $('nav-main').replaceChildren(
    ...NAV.map((item) =>
      el(
        'button',
        { class: `nav-item${item.name === active ? ' is-active' : ''}`, onclick: () => router.navigate({ name: item.name }) },
        icon(item.icon, 20),
        el('span', { text: item.label }),
      ),
    ),
  );

  const playlists = store.get().playlists;
  $('nav-playlists').replaceChildren(
    ...(playlists.length
      ? playlists.map((playlist) =>
          el(
            'button',
            {
              class: `nav-item thin${route?.name === 'playlist' && route.id === playlist.id ? ' is-active' : ''}`,
              title: playlist.name,
              onclick: () => router.navigate({ name: 'playlist', id: playlist.id }),
            },
            icon('list', 18),
            el('span', { text: playlist.name }),
          ),
        )
      : [el('div', { class: 'nav-empty', text: 'Crée ta première playlist avec le bouton +' })]),
  );

  $('nav-back').disabled = !router.canGoBack();
  $('nav-forward').disabled = !router.canGoForward();
}

$('new-playlist').addEventListener('click', async () => {
  const created = await newPlaylistFlow();
  if (created) router.navigate({ name: 'playlist', id: created.id });
});
$('nav-back').addEventListener('click', router.back);
$('nav-forward').addEventListener('click', router.forward);
$('open-settings').addEventListener('click', () => router.navigate({ name: 'settings' }));

// ---------- Recherche ----------

const searchInput = $('search-input');

function runSearch() {
  const query = searchInput.value.trim();
  if (query.length < 2) return;
  router.navigate({ name: 'search', q: query }, { replace: router.route()?.name === 'search' });
}

searchInput.addEventListener('input', debounce(runSearch, 320));
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') runSearch();
  if (event.key === 'Escape') searchInput.blur();
});

router.onChange((route) => {
  renderNav();
  markCurrent();
  if (document.activeElement !== searchInput) searchInput.value = route.name === 'search' ? route.q : '';
});

// ---------- Lecteur ----------

const seekBar = $('seek');
const volumeBar = $('volume');
let seeking = false;

const setFill = (slider) => {
  const span = slider.max - slider.min || 1;
  slider.style.setProperty('--fill', `${((slider.value - slider.min) / span) * 100}%`);
};

function renderTrack() {
  const track = player.current();
  $('now-title').textContent = track ? track.title : 'Rien en lecture';
  $('now-artist').textContent = track ? track.artist : 'Choisis un titre pour commencer';
  $('now-title').title = track ? track.title : '';

  const cover = track
    ? art(track.thumb || track.artwork, { fallback: track.live ? 'radio' : 'note', contain: Boolean(track.live), size: 24 })
    : art(null, { size: 24 });
  cover.id = 'now-art';
  $('now-art').replaceWith(cover);

  const like = track ? likeButton(track) : el('button', { hidden: true });
  like.id = 'now-like';
  $('now-like').replaceWith(like);

  seekBar.disabled = !track || Boolean(track.live);
  markCurrent();
  renderQueue();
}

function renderState() {
  const button = $('btn-play');
  const loading = player.isLoading();
  const playing = player.isPlaying();
  const label = playing || loading ? 'Pause' : 'Lecture';
  setIcon(button, loading ? 'spinner' : playing ? 'pause' : 'play', 18);
  button.classList.toggle('is-loading', loading);
  button.title = label;
  button.setAttribute('aria-label', label);
  markCurrent();
}

function renderTime() {
  if (seeking) return;
  const track = player.current();
  const total = player.duration();
  const position = player.position();
  if (track?.live) {
    $('time-current').textContent = 'DIRECT';
    $('time-total').textContent = '';
    seekBar.value = 0;
  } else {
    $('time-current').textContent = fmtTime(position) || '0:00';
    $('time-total').textContent = fmtTime(total) || '0:00';
    seekBar.value = total ? (position / total) * 1000 : 0;
  }
  setFill(seekBar);
}

function renderModes() {
  const { shuffle, repeat } = player.modes();
  const shuffleButton = $('btn-shuffle');
  const repeatButton = $('btn-repeat');
  setIcon(shuffleButton, 'shuffle', 18);
  shuffleButton.classList.toggle('is-on', shuffle);
  shuffleButton.setAttribute('aria-pressed', String(shuffle));
  setIcon(repeatButton, repeat === 'one' ? 'repeatOne' : 'repeat', 18);
  repeatButton.classList.toggle('is-on', repeat !== 'off');
  repeatButton.title = { off: 'Répéter', all: 'Répéter toute la liste', one: 'Répéter ce titre' }[repeat];
}

function renderVolume() {
  const { level, muted } = player.volume();
  const silent = muted || level === 0;
  setIcon($('btn-mute'), silent ? 'mute' : 'volume', 20);
  $('btn-mute').title = silent ? 'Rétablir le son' : 'Couper le son';
  volumeBar.value = muted ? 0 : Math.round(level * 100);
  setFill(volumeBar);
}

$('btn-play').addEventListener('click', player.toggle);
$('btn-next').addEventListener('click', () => player.next());
$('btn-prev').addEventListener('click', player.prev);
$('btn-shuffle').addEventListener('click', player.toggleShuffle);
$('btn-repeat').addEventListener('click', player.cycleRepeat);
$('btn-mute').addEventListener('click', player.toggleMute);

seekBar.addEventListener('input', () => {
  seeking = true;
  setFill(seekBar);
  $('time-current').textContent = fmtTime((seekBar.value / 1000) * player.duration()) || '0:00';
});
seekBar.addEventListener('change', () => {
  player.seek(seekBar.value / 1000);
  seeking = false;
});
volumeBar.addEventListener('input', () => player.setVolume(volumeBar.value / 100));
volumeBar.addEventListener('wheel', (event) => {
  event.preventDefault();
  player.setVolume(player.volume().level + (event.deltaY < 0 ? 0.05 : -0.05));
}, { passive: false });

$('player').addEventListener('contextmenu', (event) => {
  const track = player.current();
  if (!track || !event.target.closest('.now')) return;
  event.preventDefault();
  trackMenu(track, { x: event.clientX, y: event.clientY });
});

// ---------- File d'attente ----------

const queuePanel = $('queue');

function queueItem(track, position, isCurrent) {
  return el(
    'div',
    {
      class: `q-item${isCurrent ? ' is-current' : ''}`,
      onclick: () => (isCurrent ? player.toggle() : player.jump(position)),
    },
    art(track.thumb || track.artwork, { fallback: track.live ? 'radio' : 'note', contain: Boolean(track.live), size: 18 }),
    el('div', { style: { minWidth: '0' } }, el('div', { class: 'title', text: track.title }), el('div', { class: 'artist', text: track.artist })),
    !isCurrent &&
      el(
        'button',
        {
          class: 'icon-btn',
          title: 'Retirer de la file',
          'aria-label': 'Retirer de la file',
          onclick: (event) => {
            event.stopPropagation();
            player.removeAt(position);
          },
        },
        icon('close', 16),
      ),
  );
}

function renderQueue() {
  if (queuePanel.hidden) return;
  const list = player.queue();
  const index = player.index();
  const nodes = [];
  if (list[index]) nodes.push(el('div', { class: 'queue-label', text: 'En cours' }), queueItem(list[index], index, true));
  const upcoming = list.length - index - 1;
  if (list[index] && upcoming > 0) {
    nodes.push(el('div', { class: 'queue-label', text: `À suivre · ${upcoming}` }));
    // Au-delà de 150 titres, la suite s'affichera au fur et à mesure de la lecture.
    for (let i = index + 1; i < Math.min(list.length, index + 151); i += 1) nodes.push(queueItem(list[i], i, false));
  }
  if (!nodes.length) nodes.push(el('div', { class: 'nav-empty', text: 'La file est vide. Lance un titre pour la remplir.' }));
  $('queue-list').replaceChildren(...nodes);
}

function toggleQueue(force) {
  queuePanel.hidden = force === undefined ? !queuePanel.hidden : !force;
  $('btn-queue').classList.toggle('is-on', !queuePanel.hidden);
  renderQueue();
}

$('btn-queue').addEventListener('click', () => toggleQueue());
$('queue-close').addEventListener('click', () => toggleQueue(false));

// ---------- Mises à jour ----------

updates.subscribe(({ info, installing, progress }) => {
  const slot = $('update-slot');
  if (!info) return slot.replaceChildren();
  const percent = progress?.total ? Math.round((progress.downloaded / progress.total) * 100) : null;
  slot.replaceChildren(
    el(
      'div',
      { class: 'update-card' },
      el('strong', { text: `Version ${info.version} disponible` }),
      installing
        ? [
            el('p', { text: percent == null ? 'Téléchargement…' : `Téléchargement… ${percent} %` }),
            el('div', { class: 'progress' }, el('i', { style: { width: `${percent ?? 4}%` } })),
          ]
        : [
            el('p', { text: 'Spotifive redémarrera tout seul une fois la mise à jour installée.' }),
            el(
              'button',
              {
                class: 'btn primary small',
                onclick: () => updates.install().catch((error) => toast(String(error), 'error')),
              },
              icon('download', 16),
              'Installer',
            ),
          ],
    ),
  );
});

// ---------- Raccourcis clavier et confort ----------

window.addEventListener('keydown', (event) => {
  const typing = event.target.matches?.('input, textarea, select');
  const key = event.key;

  if (isTauri && (key === 'F5' || (event.ctrlKey && key.toLowerCase() === 'r'))) return event.preventDefault();
  if (event.ctrlKey && (key.toLowerCase() === 'k' || key.toLowerCase() === 'f')) {
    event.preventDefault();
    searchInput.focus();
    return searchInput.select();
  }
  if (event.altKey && key === 'ArrowLeft') return router.back();
  if (event.altKey && key === 'ArrowRight') return router.forward();
  // Dans un champ de saisie, les touches gardent leur rôle habituel (déplacer le curseur, écrire).
  if (typing) return;
  // Sur la page du catalogue, le lecteur de Spotifive est masqué : ses raccourcis ne doivent rien déclencher.
  if (router.route()?.name === 'catalogue') return;
  if (event.ctrlKey && key === 'ArrowRight') return player.next();
  if (event.ctrlKey && key === 'ArrowLeft') return player.prev();
  if (event.ctrlKey || event.altKey || event.metaKey) return;

  if (key === ' ' && !event.target.closest?.('button')) {
    event.preventDefault();
    player.toggle();
  } else if (key === 'ArrowRight') player.seekBy(5);
  else if (key === 'ArrowLeft') player.seekBy(-5);
  else if (key.toLowerCase() === 'm') player.toggleMute();
  else if (key === 'Escape' && !queuePanel.hidden) toggleQueue(false);
});

// Après un clic à la souris, on rend le clavier à la fenêtre : Espace refait bien lecture / pause.
window.addEventListener('click', (event) => {
  if (event.detail > 0) event.target.closest?.('button')?.blur();
});

// Boutons latéraux de la souris : page précédente / suivante.
window.addEventListener('mouseup', (event) => {
  if (event.button === 3) router.back();
  if (event.button === 4) router.forward();
});

// Pas de menu « navigateur » au clic droit, sauf dans les champs de saisie.
window.addEventListener('contextmenu', (event) => {
  if (!event.target.matches?.('input')) event.preventDefault();
});

// ---------- Abonnements ----------

player.subscribe((kind) => {
  if (kind === 'track') renderTrack();
  else if (kind === 'state') renderState();
  else if (kind === 'time') renderTime();
  else if (kind === 'queue') renderQueue();
  else if (kind === 'modes') renderModes();
  else if (kind === 'volume') renderVolume();
});

store.subscribe((kind) => {
  const name = router.route()?.name;
  if (kind === 'likes') {
    markLikes();
    if (name === 'likes') router.refresh();
  } else if (kind === 'playlists') {
    closeMenu();
    renderNav();
    if (name === 'playlist') router.refresh();
  }
});

// ---------- Démarrage ----------

function renderPlayer() {
  renderTrack();
  renderState();
  renderTime();
  renderModes();
  renderVolume();
}

// Premier affichage immédiat, puis second passage une fois les réglages relus sur le disque.
renderPlayer();
renderNav();
await store.init();
player.init();
renderPlayer();
router.navigate({ name: 'home' });

// Recherche d'une mise à jour peu après le lancement, puis toutes les six heures.
const lookForUpdate = () => updates.check().catch(() => {});
setTimeout(lookForUpdate, 3000);
setInterval(lookForUpdate, 6 * 60 * 60 * 1000);
