// Page « Tout le catalogue » : le site officiel YouTube Music affiché dans l'application.
// Le backend pose une vraie page web par-dessus la zone réservée ici ; ce module lui indique
// où se placer, la masque quand on change de page et quand un menu doit passer devant.

import { call } from './api.js';
import * as player from './player.js';
import * as router from './router.js';
import { el, icon, onOverlay } from './ui.js';

let holder = null;
let visible = false;
let covered = false;
let syncQueued = false;

const observer = new ResizeObserver(queueSync);

function bounds() {
  const rect = holder.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/** Recale la page web sur sa zone, au plus une fois par image affichée. */
function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => {
    syncQueued = false;
    if (visible && !covered && holder?.isConnected) call('catalogue_bounds', { bounds: bounds() }).catch(() => {});
  });
}

function failure(error) {
  holder.replaceChildren(
    el(
      'div',
      { class: 'empty' },
      icon('globe', 44),
      el('h3', { text: 'YouTube Music ne s’est pas ouvert' }),
      el('p', { text: String(error) }),
      el('button', { class: 'btn', text: 'Réessayer', onclick: () => open(null) }),
    ),
  );
}

async function open(query) {
  if (router.route()?.name !== 'catalogue') return;
  visible = true;
  document.body.classList.add('web-open');
  observer.disconnect();
  observer.observe(holder);
  // Un seul son à la fois : on met le lecteur de Spotifive en pause en entrant ici.
  player.pause();
  try {
    await call('catalogue_show', { bounds: bounds(), query: query || null });
  } catch (error) {
    failure(error);
    return;
  }
  // Si on a changé de page pendant l'ouverture, ou si un menu est ouvert, la page doit rester masquée.
  if (router.route()?.name !== 'catalogue') hide();
  else if (covered) call('catalogue_hide').catch(() => {});
  else queueSync();
}

function hide() {
  visible = false;
  document.body.classList.remove('web-open');
  observer.disconnect();
  call('catalogue_hide').catch(() => {});
}

const navigate = (action) => () => call('catalogue_nav', { action }).catch(() => {});

router.register('catalogue', (route) => {
  holder = el(
    'div',
    { class: 'web-holder' },
    el('div', { class: 'web-loading' }, icon('spinner', 30), el('p', { text: 'Ouverture de YouTube Music…' })),
  );
  const button = (name, label, action) =>
    el('button', { class: 'icon-btn', title: label, 'aria-label': label, onclick: navigate(action) }, icon(name, 18));

  // La zone doit être en place dans la fenêtre avant d'en mesurer la position.
  requestAnimationFrame(() => open(route.q));

  return el(
    'div',
    { class: 'web-page' },
    el(
      'div',
      { class: 'web-bar' },
      button('back', 'Page précédente de YouTube Music', 'back'),
      button('forward', 'Page suivante de YouTube Music', 'forward'),
      button('home', 'Accueil de YouTube Music', 'home'),
      button('refresh', 'Recharger', 'reload'),
      el(
        'div',
        { class: 'web-note' },
        el('strong', { text: 'YouTube Music' }),
        ' · tout le catalogue, titres entiers, gratuit avec les publicités de YouTube',
      ),
    ),
    holder,
  );
});

router.onChange((route) => {
  if (route.name !== 'catalogue' && visible) hide();
});

// Un menu ou une fenêtre de dialogue doit passer devant : la page web s'efface le temps qu'il soit ouvert.
onOverlay((open) => {
  covered = open;
  if (!visible) return;
  if (open) call('catalogue_hide').catch(() => {});
  else call('catalogue_show', { bounds: bounds(), query: null }).catch(() => {});
});

window.addEventListener('resize', queueSync);
