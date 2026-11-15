//! Téléchargement pour l'écoute hors ligne.
//!
//! Limité aux sources qui l'autorisent : les titres Audius dont l'artiste a activé le téléchargement,
//! et les fichiers d'Internet Archive (netlabels, concerts autorisés). L'adresse à télécharger est
//! toujours recalculée ici à partir de l'identifiant du titre : l'interface ne peut pas en imposer une.
//! Les fichiers arrivent dans `Musique\Spotifive`, dossier ajouté à la bibliothèque locale.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use lofty::config::WriteOptions;
use lofty::file::FileType;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::{Tag, TagType};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::AsyncWriteExt;

use crate::error::{AppError, Result};
use crate::library::{blocking, Library, LibraryView};
use crate::sources::{archive, audius};
use crate::Net;

const FOLDER: &str = "Spotifive";
const MAX_SIZE: u64 = 500 * 1024 * 1024;
const MAX_COVER: usize = 5 * 1024 * 1024;
const EXTENSIONS: [&str; 7] = ["mp3", "flac", "m4a", "ogg", "oga", "opus", "wav"];
/// Écart minimal, en octets, entre deux annonces de progression.
const PROGRESS_STEP: u64 = 384 * 1024;

pub struct Downloads {
    /// Client sans limite de durée totale (un gros fichier peut prendre plusieurs minutes),
    /// mais qui abandonne si le serveur ne répond plus.
    client: reqwest::Client,
    active: Mutex<HashSet<String>>,
}

impl Downloads {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("Spotifive/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(30))
            .build()
            .expect("création du client de téléchargement");
        Self { client, active: Mutex::new(HashSet::new()) }
    }
}

/// Retire le titre de la liste des téléchargements en cours, quelle que soit l'issue.
struct Active<'a> {
    set: &'a Mutex<HashSet<String>>,
    id: String,
}

impl Drop for Active<'_> {
    fn drop(&mut self) {
        self.set.lock().unwrap().remove(&self.id);
    }
}

#[derive(Debug, Deserialize)]
pub struct Request {
    id: String,
    title: String,
    artist: String,
    album: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Outcome {
    /// `done` : fichier téléchargé. `exists` : il était déjà là.
    status: &'static str,
    path: String,
}

#[derive(Clone, Serialize)]
struct Progress<'a> {
    id: &'a str,
    received: u64,
    total: Option<u64>,
}

/// Ce qu'il faut télécharger, calculé à partir de l'identifiant du titre.
struct Source {
    urls: Vec<String>,
    extension: Option<String>,
    cover: Option<String>,
}

fn folder(app: &AppHandle) -> Result<PathBuf> {
    let music = app
        .path()
        .audio_dir()
        .map_err(|error| AppError::msg(format!("Dossier Musique introuvable : {error}")))?;
    let folder = music.join(FOLDER);
    std::fs::create_dir_all(&folder)?;
    Ok(folder)
}

/// Nom de fichier sûr pour Windows à partir de l'artiste et du titre.
fn file_stem(artist: &str, title: &str) -> String {
    let (artist, title) = (artist.trim(), title.trim());
    // Beaucoup de titres s'appellent déjà « Artiste - Titre » : inutile de répéter l'artiste.
    let already_named = title.to_lowercase().starts_with(&format!("{} - ", artist.to_lowercase()));
    let raw = if artist.is_empty() || already_named { title.to_string() } else { format!("{artist} - {title}") };
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_control() || matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { ' ' } else { c })
        .collect();
    let joined = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let short: String = joined.trim_matches(['.', ' ']).chars().take(120).collect();
    let stem = short.trim_end_matches(['.', ' ']).to_string();

    let reserved = ["CON", "PRN", "AUX", "NUL"];
    let upper = stem.to_ascii_uppercase();
    let device = reserved.contains(&upper.as_str())
        || ((upper.starts_with("COM") || upper.starts_with("LPT")) && upper.len() == 4 && upper.ends_with(|c: char| c.is_ascii_digit()));
    match (stem.is_empty(), device) {
        (true, _) => "Titre".to_string(),
        (false, true) => format!("_{stem}"),
        (false, false) => stem,
    }
}

fn known_extension(extension: &str) -> Option<String> {
    let extension = extension.to_ascii_lowercase();
    EXTENSIONS.contains(&extension.as_str()).then_some(extension)
}

fn extension_from_type(content_type: &str) -> Option<&'static str> {
    let kind = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    Some(match kind.as_str() {
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/wav" | "audio/wave" | "audio/x-wav" | "audio/vnd.wave" => "wav",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/ogg" | "application/ogg" => "ogg",
        "audio/opus" => "opus",
        "audio/mp4" | "audio/x-m4a" | "audio/aac" | "audio/m4a" => "m4a",
        _ => return None,
    })
}

/// Un serveur qui répond par une page web ou un message d'erreur ne doit pas finir en « fichier audio ».
fn looks_like_audio(content_type: &str) -> bool {
    let kind = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    kind.is_empty() || kind.starts_with("audio/") || kind.ends_with("/octet-stream") || kind == "application/ogg"
}

async fn resolve(net: &Net, id: &str) -> Result<Source> {
    match id.split_once(':') {
        Some(("audius", track)) => {
            let info = audius::download_info(&net.0, track).await?;
            Ok(Source {
                urls: info.urls,
                extension: info.extension.as_deref().and_then(known_extension),
                cover: info.artwork,
            })
        }
        Some(("archive", track)) => {
            let (url, album) = archive::download_url(track).ok_or_else(|| AppError::msg("Identifiant de titre invalide"))?;
            Ok(Source {
                urls: vec![url],
                extension: track.rsplit_once('.').and_then(|(_, extension)| known_extension(extension)),
                cover: Some(archive::cover(album)),
            })
        }
        _ => Err(AppError::msg("Cette source ne permet pas le téléchargement")),
    }
}

/// Télécharge une adresse dans un fichier temporaire. Renvoie l'extension déduite de la réponse.
async fn fetch(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    temp: &Path,
    id: &str,
) -> Result<Option<&'static str>> {
    let mut response = client.get(url).send().await?.error_for_status()?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    if !looks_like_audio(&content_type) {
        return Err(AppError::msg("Le serveur n'a pas renvoyé un fichier audio"));
    }
    let total = response.content_length();
    if total.is_some_and(|size| size > MAX_SIZE) {
        return Err(AppError::msg("Fichier trop volumineux (plus de 500 Mo)"));
    }

    let mut file = tokio::fs::File::create(temp).await?;
    let mut received: u64 = 0;
    let mut announced: u64 = 0;
    let _ = app.emit("download://progress", Progress { id, received, total });
    while let Some(chunk) = response.chunk().await? {
        received += chunk.len() as u64;
        if received > MAX_SIZE {
            return Err(AppError::msg("Fichier trop volumineux (plus de 500 Mo)"));
        }
        file.write_all(&chunk).await?;
        if received - announced >= PROGRESS_STEP {
            announced = received;
            let _ = app.emit("download://progress", Progress { id, received, total });
        }
    }
    file.flush().await?;
    if received == 0 || total.is_some_and(|size| size != received) {
        return Err(AppError::msg("Téléchargement incomplet"));
    }
    Ok(extension_from_type(&content_type))
}

async fn fetch_cover(client: &reqwest::Client, url: &str) -> Option<Vec<u8>> {
    let response = client.get(url).send().await.ok()?.error_for_status().ok()?;
    if response.content_length().is_some_and(|size| size > MAX_COVER as u64) {
        return None;
    }
    let bytes = response.bytes().await.ok()?;
    (bytes.len() <= MAX_COVER).then(|| bytes.to_vec())
}

fn image_type(data: &[u8]) -> Option<MimeType> {
    if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(MimeType::Jpeg)
    } else if data.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some(MimeType::Png)
    } else {
        None
    }
}

/// Complète les étiquettes manquantes (titre, artiste, album, pochette) sans écraser celles du fichier.
fn write_tags(path: &Path, request: &Request, cover: Option<Vec<u8>>) -> std::result::Result<(), lofty::error::LoftyError> {
    let mut tagged = lofty::read_from_path(path)?;
    let file_type = tagged.file_type();
    // Les étiquettes natives du WAV n'acceptent pas de pochette : on y utilise ID3v2, que le format admet aussi.
    let tag_type = if matches!(file_type, FileType::Wav | FileType::Aiff) { TagType::Id3v2 } else { file_type.primary_tag_type() };
    if tagged.tag(tag_type).is_none() {
        tagged.insert_tag(Tag::new(tag_type));
    }
    let Some(tag) = tagged.tag_mut(tag_type) else {
        return Ok(());
    };

    let mut changed = false;
    if tag.title().is_none() && !request.title.trim().is_empty() {
        tag.set_title(request.title.trim().to_string());
        changed = true;
    }
    if tag.artist().is_none() && !request.artist.trim().is_empty() {
        tag.set_artist(request.artist.trim().to_string());
        changed = true;
    }
    if let Some(album) = request.album.as_deref().map(str::trim).filter(|album| !album.is_empty()) {
        if tag.album().is_none() {
            tag.set_album(album.to_string());
            changed = true;
        }
    }
    if tag.pictures().is_empty() {
        if let Some(data) = cover {
            if let Some(mime) = image_type(&data) {
                tag.push_picture(Picture::new_unchecked(PictureType::CoverFront, Some(mime), None, data));
                changed = true;
            }
        }
    }
    if changed {
        tag.save_to_path(path, WriteOptions::default())?;
    }
    Ok(())
}

/// Télécharge un titre dans `Musique\Spotifive`. Refuse les sources qui ne l'autorisent pas.
#[tauri::command]
pub async fn download_track(
    app: AppHandle,
    net: State<'_, Net>,
    downloads: State<'_, Downloads>,
    request: Request,
) -> Result<Outcome> {
    if !downloads.active.lock().unwrap().insert(request.id.clone()) {
        return Err(AppError::msg("Ce titre est déjà en cours de téléchargement"));
    }
    let _active = Active { set: &downloads.active, id: request.id.clone() };

    let source = resolve(&net, &request.id).await?;
    let directory = folder(&app)?;
    let stem = file_stem(&request.artist, &request.title);

    // Déjà téléchargé, quel que soit le format : on ne le reprend pas.
    for extension in EXTENSIONS {
        let existing = directory.join(format!("{stem}.{extension}"));
        if existing.exists() {
            return Ok(Outcome { status: "exists", path: existing.to_string_lossy().into_owned() });
        }
    }

    let temp = directory.join(format!("{stem}.telechargement"));
    let mut last_error = AppError::msg("Aucune adresse de téléchargement");
    let mut detected = None;
    let mut fetched = false;
    for url in &source.urls {
        match fetch(&app, &downloads.client, url, &temp, &request.id).await {
            Ok(extension) => {
                detected = extension;
                fetched = true;
                break;
            }
            Err(error) => last_error = error,
        }
    }
    if !fetched {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(last_error);
    }

    let Some(extension) = source.extension.or_else(|| detected.map(str::to_string)) else {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(AppError::msg("Format audio non reconnu"));
    };
    let target = directory.join(format!("{stem}.{extension}"));
    tokio::fs::rename(&temp, &target).await?;

    // Étiquettes et pochette : un plus, jamais une raison de faire échouer le téléchargement.
    let cover = match &source.cover {
        Some(url) => fetch_cover(&downloads.client, url).await,
        None => None,
    };
    let tag_target = target.clone();
    let _ = blocking(move || {
        let _ = write_tags(&tag_target, &request, cover);
        Ok(())
    })
    .await;

    Ok(Outcome { status: "done", path: target.to_string_lossy().into_owned() })
}

/// À appeler quand une série de téléchargements est finie : ajoute le dossier à la bibliothèque et la réanalyse.
#[tauri::command]
pub async fn downloads_finish(app: AppHandle, library: State<'_, Arc<Library>>) -> Result<LibraryView> {
    let library = library.inner().clone();
    blocking(move || {
        let directory = folder(&app)?;
        library.include_folder(&app, &directory)
    })
    .await
}

#[tauri::command]
pub fn downloads_folder(app: AppHandle) -> Result<String> {
    Ok(folder(&app)?.to_string_lossy().into_owned())
}

/// Ouvre le dossier des téléchargements dans l'Explorateur.
#[tauri::command]
pub fn downloads_open(app: AppHandle) -> Result<()> {
    let directory = folder(&app)?;
    app.opener()
        .open_path(directory.to_string_lossy(), None::<&str>)
        .map_err(|error| AppError::msg(format!("Impossible d'ouvrir le dossier : {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_safe_for_windows() {
        assert_eq!(file_stem("Daft Punk", "One More Time"), "Daft Punk - One More Time");
        assert_eq!(file_stem("AC/DC", "Back: in \"Black\"?"), "AC DC - Back in Black");
        assert_eq!(file_stem("", "  Seul  "), "Seul");
        assert_eq!(file_stem("Beetlejuke", "beetlejuke - Broken Zen"), "beetlejuke - Broken Zen");
        assert_eq!(file_stem("", "..."), "Titre");
        assert_eq!(file_stem("", "con"), "_con");
        assert_eq!(file_stem("", "COM1"), "_COM1");
        assert_eq!(file_stem("a", "b. "), "a - b");
        assert!(!file_stem("x", "..\\..\\evil").contains(['\\', '/']));
        assert_eq!(file_stem("x", &"y".repeat(300)).chars().count(), 120);
    }

    #[test]
    fn only_audio_answers_are_kept() {
        assert!(looks_like_audio("audio/mpeg"));
        assert!(looks_like_audio("application/octet-stream"));
        assert!(looks_like_audio(""));
        assert!(!looks_like_audio("text/html; charset=utf-8"));
        assert!(!looks_like_audio("application/json"));
        assert_eq!(extension_from_type("audio/wave"), Some("wav"));
        assert_eq!(extension_from_type("audio/mpeg; charset=binary"), Some("mp3"));
        assert_eq!(extension_from_type("application/octet-stream"), None);
        assert_eq!(known_extension("MP3").as_deref(), Some("mp3"));
        assert_eq!(known_extension("exe"), None);
    }

    #[test]
    fn covers_are_recognised_by_their_first_bytes() {
        assert!(matches!(image_type(&[0xFF, 0xD8, 0xFF, 0xE0]), Some(MimeType::Jpeg)));
        assert!(matches!(image_type(&[0x89, b'P', b'N', b'G', 0x0D]), Some(MimeType::Png)));
        assert!(image_type(b"<html>").is_none());
    }
}
