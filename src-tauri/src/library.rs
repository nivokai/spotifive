//! Bibliothèque locale : les fichiers audio déjà présents sur le PC.
//!
//! L'analyse lit les étiquettes de tous les fichiers en parallèle (un fil par cœur) et
//! garde un index sur disque : au lancement suivant, seuls les fichiers modifiés sont relus.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use lofty::picture::MimeType;
use lofty::prelude::*;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

use crate::error::{AppError, Result};
use crate::model::Track;

/// Formats que le lecteur intégré sait décoder.
const AUDIO_EXTENSIONS: [&str; 8] = ["mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav"];

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    path: String,
    mtime: u64,
    size: u64,
    title: String,
    artist: String,
    album: Option<String>,
    track_no: Option<u32>,
    duration: Option<f64>,
    cover: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Index {
    folders: Vec<String>,
    entries: Vec<Entry>,
}

#[derive(Debug, Serialize)]
pub struct LibraryView {
    folders: Vec<String>,
    tracks: Vec<Track>,
}

#[derive(Clone, Serialize)]
struct ScanProgress {
    done: usize,
    total: usize,
}

pub struct Library {
    index_path: PathBuf,
    covers_dir: PathBuf,
    index: Mutex<Index>,
}

impl Library {
    pub fn open(data_dir: &Path) -> Self {
        let index_path = data_dir.join("library.json");
        let covers_dir = data_dir.join("covers");
        let index = fs::read(&index_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self { index_path, covers_dir, index: Mutex::new(index) }
    }

    /// Autorise la fenêtre à lire les dossiers de musique choisis (et eux seuls).
    pub fn grant_access(&self, app: &AppHandle) {
        let scope = app.asset_protocol_scope();
        let _ = fs::create_dir_all(&self.covers_dir);
        let _ = scope.allow_directory(&self.covers_dir, true);
        for folder in &self.index.lock().unwrap().folders {
            let _ = scope.allow_directory(folder, true);
        }
    }

    fn view(&self) -> LibraryView {
        let index = self.index.lock().unwrap();
        LibraryView {
            folders: index.folders.clone(),
            tracks: index.entries.iter().map(to_track).collect(),
        }
    }

    fn save(&self) -> Result<()> {
        let bytes = serde_json::to_vec(&*self.index.lock().unwrap())?;
        let temp = self.index_path.with_extension("json.tmp");
        fs::write(&temp, bytes)?;
        fs::rename(&temp, &self.index_path)?;
        Ok(())
    }

    /// Ajoute un dossier à la bibliothèque s'il n'y est pas, autorise sa lecture, puis réanalyse.
    pub(crate) fn include_folder(&self, app: &AppHandle, folder: &Path) -> Result<LibraryView> {
        app.asset_protocol_scope()
            .allow_directory(folder, true)
            .map_err(|error| AppError::msg(format!("Accès au dossier refusé : {error}")))?;
        let folder_text = folder.to_string_lossy().into_owned();
        {
            let mut index = self.index.lock().unwrap();
            if !index.folders.contains(&folder_text) {
                index.folders.push(folder_text);
            }
        }
        self.rescan(app)?;
        Ok(self.view())
    }

    fn rescan(&self, app: &AppHandle) -> Result<()> {
        let (folders, previous) = {
            let index = self.index.lock().unwrap();
            (index.folders.clone(), index.entries.clone())
        };
        let entries = scan(&folders, &previous, &self.covers_dir, |done, total| {
            let _ = app.emit("library://progress", ScanProgress { done, total });
        });
        self.index.lock().unwrap().entries = entries;
        self.save()
    }
}

fn to_track(entry: &Entry) -> Track {
    Track {
        id: format!("local:{}", entry.path),
        source: "local".into(),
        title: entry.title.clone(),
        artist: entry.artist.clone(),
        album: entry.album.clone(),
        duration: entry.duration,
        artwork: entry.cover.clone(),
        thumb: entry.cover.clone(),
        url: Some(entry.path.clone()),
        mirrors: Vec::new(),
        info: None,
        live: false,
        downloadable: false,
    }
}

fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| AUDIO_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn scan(
    folders: &[String],
    previous: &[Entry],
    covers_dir: &Path,
    on_progress: impl Fn(usize, usize) + Sync,
) -> Vec<Entry> {
    let mut paths: Vec<PathBuf> = folders
        .iter()
        .flat_map(|folder| {
            WalkDir::new(folder)
                .into_iter()
                .filter_map(|item| item.ok())
                .filter(|item| item.file_type().is_file() && is_audio(item.path()))
                .map(|item| item.into_path())
        })
        .collect();
    paths.sort();
    paths.dedup();

    let cache: HashMap<&str, &Entry> = previous.iter().map(|entry| (entry.path.as_str(), entry)).collect();
    let total = paths.len();
    let done = AtomicUsize::new(0);

    let mut entries: Vec<Entry> = paths
        .par_iter()
        .filter_map(|path| {
            let entry = read_entry(path, &cache, covers_dir);
            let count = done.fetch_add(1, Ordering::Relaxed) + 1;
            if count % 25 == 0 || count == total {
                on_progress(count, total);
            }
            entry
        })
        .collect();

    entries.sort_by_cached_key(|entry| {
        (
            entry.artist.to_lowercase(),
            entry.album.as_deref().unwrap_or("").to_lowercase(),
            entry.track_no.unwrap_or(u32::MAX),
            entry.title.to_lowercase(),
        )
    });
    entries
}

fn read_entry(path: &Path, cache: &HashMap<&str, &Entry>, covers_dir: &Path) -> Option<Entry> {
    let meta = fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0);
    let size = meta.len();
    let path_text = path.to_str()?.to_string();

    // Fichier inchangé depuis la dernière analyse : on réutilise l'index.
    if let Some(known) = cache.get(path_text.as_str()) {
        let cover_ok = known.cover.as_deref().map(|cover| Path::new(cover).exists()).unwrap_or(true);
        if known.mtime == mtime && known.size == size && cover_ok {
            return Some((*known).clone());
        }
    }

    let fallback_title = path.file_stem().and_then(|stem| stem.to_str()).unwrap_or("Sans titre").to_string();
    let mut entry = Entry {
        path: path_text,
        mtime,
        size,
        title: fallback_title,
        artist: "Artiste inconnu".into(),
        album: None,
        track_no: None,
        duration: None,
        cover: None,
    };

    // Un fichier aux étiquettes illisibles reste listé, avec son nom de fichier pour titre.
    if let Ok(tagged) = lofty::read_from_path(path) {
        let seconds = tagged.properties().duration().as_secs_f64();
        entry.duration = (seconds > 0.0).then_some(seconds);
        if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
            let clean = |value: Option<std::borrow::Cow<'_, str>>| {
                value.map(|text| text.trim().to_string()).filter(|text| !text.is_empty())
            };
            if let Some(title) = clean(tag.title()) {
                entry.title = title;
            }
            if let Some(artist) = clean(tag.artist()) {
                entry.artist = artist;
            }
            entry.album = clean(tag.album());
            entry.track_no = tag.track();
            entry.cover = tag.pictures().first().and_then(|picture| {
                let extension = match picture.mime_type() {
                    Some(MimeType::Png) => "png",
                    Some(MimeType::Gif) => "gif",
                    Some(MimeType::Bmp) => "bmp",
                    _ => "jpg",
                };
                save_cover(covers_dir, picture.data(), extension)
            });
        }
    }
    Some(entry)
}

/// Écrit la pochette une seule fois par image : tous les titres d'un album partagent le fichier.
fn save_cover(covers_dir: &Path, data: &[u8], extension: &str) -> Option<String> {
    if data.is_empty() {
        return None;
    }
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    let target = covers_dir.join(format!("{:016x}.{extension}", hasher.finish()));
    if !target.exists() {
        // Deux fils peuvent écrire la même image en même temps : le contenu est identique.
        let _ = fs::write(&target, data);
    }
    target.exists().then(|| target.to_string_lossy().into_owned())
}

pub(crate) async fn blocking<T, F>(task: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| AppError::msg(format!("Tâche interrompue : {error}")))?
}

#[tauri::command]
pub async fn library_get(library: State<'_, Arc<Library>>) -> Result<LibraryView> {
    let library = library.inner().clone();
    blocking(move || Ok(library.view())).await
}

/// Ouvre le sélecteur de dossier puis analyse le dossier choisi. `None` si annulé.
#[tauri::command]
pub async fn library_add_folder(
    app: AppHandle,
    window: tauri::WebviewWindow,
    library: State<'_, Arc<Library>>,
) -> Result<Option<LibraryView>> {
    let library = library.inner().clone();
    blocking(move || {
        // Rattaché à la fenêtre principale : le sélecteur s'ouvre devant elle, jamais derrière.
        let picker = app.dialog().file().set_parent(&window).set_title("Choisir un dossier de musique");
        let Some(picked) = picker.blocking_pick_folder() else {
            return Ok(None);
        };
        let folder = picked
            .into_path()
            .map_err(|error| AppError::msg(format!("Dossier inutilisable : {error}")))?;
        library.include_folder(&app, &folder).map(Some)
    })
    .await
}

#[tauri::command]
pub async fn library_remove_folder(
    app: AppHandle,
    library: State<'_, Arc<Library>>,
    folder: String,
) -> Result<LibraryView> {
    let library = library.inner().clone();
    blocking(move || {
        library.index.lock().unwrap().folders.retain(|known| known != &folder);
        library.rescan(&app)?;
        Ok(library.view())
    })
    .await
}

#[tauri::command]
pub async fn library_rescan(app: AppHandle, library: State<'_, Arc<Library>>) -> Result<LibraryView> {
    let library = library.inner().clone();
    blocking(move || {
        library.rescan(&app)?;
        Ok(library.view())
    })
    .await
}
