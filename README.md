# Spotifive

Lecteur de musique de bureau, gratuit, écrit en Rust avec [Tauri](https://tauri.app).

Spotifive ne diffuse que de la musique dont l'écoute gratuite est autorisée :

| Source | Contenu |
| --- | --- |
| **YouTube Music** (page « Tout le catalogue ») | Tout le catalogue mondial, titres entiers : le site officiel affiché dans l'application, avec ses publicités |
| **Audius** | Titres et playlists publiés par les artistes eux-mêmes |
| **Radio Browser** | Des dizaines de milliers de radios en direct, dans tous les pays |
| **Internet Archive** | Albums de netlabels en licence libre et concerts dont l'enregistrement est autorisé |
| **Fichiers locaux** | La musique déjà présente sur le PC (MP3, FLAC, M4A, OGG, Opus, WAV) |

Le catalogue commercial n'est accessible gratuitement et légalement que par les services financés par la publicité.
Spotifive affiche donc le site officiel de YouTube Music dans une zone de sa fenêtre, tel quel : rien n'est copié,
téléchargé ni modifié, et les publicités restent en place. Cette page n'a accès à aucune commande de l'application,
et ses titres ne rejoignent pas les playlists ni la file d'attente de Spotifive.

Sources écartées après lecture de leurs conditions : l'API de Deezer (réservée à un usage privé non distribué).

## Fonctions

- Recherche unique sur toutes les sources, interrogées en parallèle
- Tendances par genre, radios par pays et par style
- Titres aimés, playlists, file d'attente, lecture aléatoire et répétition
- Bibliothèque locale analysée sur tous les cœurs du processeur, avec index sur disque
- Touches multimédia du clavier et raccourcis
- Mise à jour automatique signée

## Organisation

```
src-tauri/           Backend Rust
  src/sources/       Audius, Internet Archive, Radio Browser
  src/catalogue.rs   Page YouTube Music intégrée à la fenêtre
  src/library.rs     Bibliothèque locale (étiquettes, pochettes, index)
  src/store.rs       Sauvegarde des favoris, playlists et réglages
  src/updater.rs     Mise à jour automatique
ui/                  Interface (HTML, CSS, JavaScript sans framework)
dev/                 Aperçu de l'interface dans un navigateur, avec de fausses données
scripts/release.ps1  Publication d'une nouvelle version
```

## Développer

Il faut [Rust](https://rustup.rs), les Build Tools C++ de Visual Studio et Node.js.

```bash
npm install
```

```bash
npm run dev
```

Pour travailler sur l'interface seule, sans compiler le Rust :

```bash
node dev/serve.mjs
```

Tests du backend :

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Publier une mise à jour

```powershell
.\scripts\release.ps1 -Version 0.2.0 -Notes "Ce qui change dans cette version"
```

Le script change le numéro de version, compile, signe l'installeur, puis crée la version sur GitHub
avec l'installeur et un fichier `latest.json`. Chaque application installée lit ce fichier au démarrage
(et toutes les six heures) : si la version est plus récente, elle propose de l'installer et redémarre toute seule.

### La clé de signature

Les mises à jour sont signées avec une clé privée rangée **hors du projet** :

```
%USERPROFILE%\.tauri\spotifive.key
%USERPROFILE%\.tauri\spotifive.key.password
```

- Sauvegarde ces deux fichiers en lieu sûr. Si tu les perds, tu ne pourras plus publier de mise à jour
  pour les applications déjà installées.
- Ne les publie jamais : quiconque les possède peut envoyer une fausse mise à jour à tous les utilisateurs.

La clé publique correspondante est dans `src-tauri/tauri.conf.json`.
