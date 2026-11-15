// Pont entre l'interface et le backend Rust.
// Hors de l'application (aperçu dans un navigateur), un faux backend de démonstration prend le relais.

const tauri = window.__TAURI__;

export const isTauri = Boolean(tauri);

const backend = isTauri
  ? { invoke: tauri.core.invoke, listen: tauri.event.listen, fileSrc: tauri.core.convertFileSrc }
  : await import('../../dev/mock.js');

/** Appelle une commande Rust. */
export const call = (command, args) => backend.invoke(command, args);

/** Écoute un évènement émis par le backend. */
export const on = (event, handler) => backend.listen(event, (message) => handler(message.payload));

/** Transforme une adresse web ou un chemin de fichier local en adresse lisible par la fenêtre. */
export function mediaUrl(value) {
  if (!value) return null;
  return /^(https?|data|blob):/i.test(value) ? value : backend.fileSrc(value);
}
