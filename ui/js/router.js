// Navigation entre les pages, avec historique (retour / suivant).

const views = new Map();
const backStack = [];
const forwardStack = [];
const listeners = new Set();
let current = null;

export function register(name, render) {
  views.set(name, render);
}

export const route = () => current;
export const canGoBack = () => backStack.length > 0;
export const canGoForward = () => forwardStack.length > 0;

export function onChange(listener) {
  listeners.add(listener);
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function show(target) {
  current = target;
  const host = document.getElementById('view');
  let node;
  try {
    node = views.get(target.name)(target);
  } catch (error) {
    console.error(error);
    node = document.createElement('div');
    node.className = 'page';
    node.textContent = `Cette page n'a pas pu s'afficher : ${error.message || error}`;
  }
  host.replaceChildren(node);
  host.scrollTop = 0;
  for (const listener of listeners) listener(target);
}

/** Affiche une page. `replace` remplace la page courante au lieu d'empiler dans l'historique. */
export function navigate(target, { replace = false } = {}) {
  if (current && same(current, target)) return;
  if (current && !replace) {
    backStack.push(current);
    if (backStack.length > 60) backStack.shift();
    forwardStack.length = 0;
  }
  show(target);
}

export function back() {
  if (!backStack.length) return;
  forwardStack.push(current);
  show(backStack.pop());
}

export function forward() {
  if (!forwardStack.length) return;
  backStack.push(current);
  show(forwardStack.pop());
}

/** Redessine la page courante (après un changement de données). */
export function refresh() {
  if (!current) return;
  const host = document.getElementById('view');
  const scroll = host.scrollTop;
  show(current);
  host.style.scrollBehavior = 'auto';
  host.scrollTop = scroll;
  host.style.scrollBehavior = '';
}
