// Petites briques d'interface : création d'éléments, icônes, messages, menus, fenêtres.
// Tout texte venant d'Internet passe par textContent : jamais de HTML injecté.

export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : String(child));
  }
  return node;
}

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M7 4.6v14.8a1 1 0 0 0 1.5.86l12.3-7.4a1 1 0 0 0 0-1.72L8.5 3.74A1 1 0 0 0 7 4.6z"/>',
  pause: '<rect x="6" y="4" width="4.2" height="16" rx="1"/><rect x="13.8" y="4" width="4.2" height="16" rx="1"/>',
  next: '<path d="M5 5.2v13.6a.8.8 0 0 0 1.25.66L16 13V18.5a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-13a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1V11L6.25 4.54A.8.8 0 0 0 5 5.2z"/>',
  prev: '<path d="M19 5.2v13.6a.8.8 0 0 1-1.25.66L8 13V18.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1V11l9.75-6.46A.8.8 0 0 1 19 5.2z"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/>',
  repeatOne: '<path d="m17 2 4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3M11 10.5l1.5-1v5"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.7 5.3a9.5 9.5 0 0 1 0 13.4"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6"/>',
  queue: '<path d="M3 6h18M3 12h11M3 18h11M18 12.5v7l4.5-3.5z"/>',
  more: '<circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  forward: '<path d="m9 18 6-6-6-6"/>',
  settings: '<path d="M4 6h9M18 6h2M4 12h2M11 12h9M4 18h7M16 18h4"/><circle cx="15.5" cy="6" r="2.2"/><circle cx="8.5" cy="12" r="2.2"/><circle cx="13.5" cy="18" r="2.2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  note: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  spinner: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  archive: '<path d="M3 5h18v4H3zM5 9v10h14V9M10 13h4"/>',
};

const FILLED = new Set(['play', 'pause', 'next', 'prev', 'more']);

export function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  if (FILLED.has(name)) {
    svg.setAttribute('fill', 'currentColor');
  } else {
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

export function setIcon(node, name, size) {
  if (node.dataset.icon === name) return;
  node.dataset.icon = name;
  node.replaceChildren(icon(name, size));
}

/** Durée en secondes → `3:07` ou `1:02:45`. Vide si inconnue. */
export function fmtTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function plural(count, one, many) {
  return `${count} ${count > 1 ? many : one}`;
}

export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ---------- Messages éphémères ----------

export function toast(message, kind = 'info') {
  const host = document.getElementById('toasts');
  const node = el('div', { class: `toast ${kind}`, text: message });
  host.append(node);
  while (host.children.length > 3) host.firstChild.remove();
  setTimeout(() => node.classList.add('out'), 3600);
  setTimeout(() => node.remove(), 4000);
}

// ---------- Menu contextuel ----------

const menu = document.getElementById('menu');
let menuCleanup = null;

export function closeMenu() {
  if (!menuCleanup) return;
  menuCleanup();
  menuCleanup = null;
}

/**
 * Ouvre un menu près d'un élément ou d'un point `{ x, y }`.
 * Entrées : `{ label, icon, action, danger }`, `{ separator: true }` ou `{ heading }`.
 */
export function openMenu(anchor, items, { onClose } = {}) {
  closeMenu();
  menu.replaceChildren(
    ...items.map((item) => {
      if (item.separator) return el('div', { class: 'menu-sep' });
      if (item.heading) return el('div', { class: 'menu-head', text: item.heading });
      return el(
        'button',
        {
          class: `menu-item${item.danger ? ' danger' : ''}`,
          role: 'menuitem',
          onclick: () => {
            closeMenu();
            item.action();
          },
        },
        item.icon && icon(item.icon, 18),
        el('span', { text: item.label }),
      );
    }),
  );
  menu.hidden = false;

  const rect = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const { offsetWidth: width, offsetHeight: height } = menu;
  let left = anchor.getBoundingClientRect ? rect.right - width : rect.left;
  let top = rect.bottom + 4;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const onPointer = (event) => {
    if (!menu.contains(event.target)) closeMenu();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') closeMenu();
  };
  // Les écouteurs sont posés après le clic qui ouvre le menu, pour qu'il ne le referme pas aussitôt.
  let cancelled = false;
  setTimeout(() => {
    if (cancelled) return;
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('blur', closeMenu);
    document.getElementById('view').addEventListener('scroll', closeMenu, { passive: true });
  });
  menuCleanup = () => {
    cancelled = true;
    menu.hidden = true;
    window.removeEventListener('pointerdown', onPointer, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', closeMenu);
    window.removeEventListener('blur', closeMenu);
    document.getElementById('view').removeEventListener('scroll', closeMenu);
    onClose?.();
  };
  menu.querySelector('.menu-item')?.focus({ preventScroll: true });
}

// ---------- Fenêtres de dialogue ----------

const modal = document.getElementById('modal');

function showDialog(build) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const finish = (value) => {
      modal.hidden = true;
      modal.replaceChildren();
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.({ preventScroll: true });
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish(null);
      }
    };
    const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, build(finish));
    modal.replaceChildren(dialog);
    modal.hidden = false;
    modal.onpointerdown = (event) => {
      if (event.target === modal) finish(null);
    };
    window.addEventListener('keydown', onKey, true);
    (dialog.querySelector('input') || dialog.querySelector('.btn.primary, .btn.danger'))?.focus();
  });
}

/** Demande un texte. Renvoie le texte saisi, ou `null` si annulé. */
export function askText({ title, value = '', placeholder = '', confirm = 'Valider' }) {
  return showDialog((finish) => {
    const input = el('input', { class: 'field', type: 'text', value, placeholder, maxLength: 80, spellcheck: false });
    const submit = () => {
      const text = input.value.trim();
      if (text) finish(text);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
    setTimeout(() => input.select());
    return [
      el('h2', { text: title }),
      input,
      el(
        'div',
        { class: 'dialog-actions' },
        el('button', { class: 'btn', text: 'Annuler', onclick: () => finish(null) }),
        el('button', { class: 'btn primary', text: confirm, onclick: submit }),
      ),
    ];
  });
}

/** Demande une confirmation. Renvoie `true` si acceptée. */
export async function askConfirm({ title, message, confirm = 'Confirmer', danger = false }) {
  const answer = await showDialog((finish) => [
    el('h2', { text: title }),
    el('p', { text: message }),
    el(
      'div',
      { class: 'dialog-actions' },
      el('button', { class: 'btn', text: 'Annuler', onclick: () => finish(null) }),
      el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, text: confirm, onclick: () => finish(true) }),
    ),
  ]);
  return answer === true;
}
