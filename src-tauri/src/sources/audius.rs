use reqwest::Client;
use serde_json::Value;

use crate::error::{AppError, Result};
use crate::http::get_json;
use crate::model::{Collection, CollectionDetail, Track};

const BASE: &str = "https://api.audius.co/v1";
const APP_NAME: &str = "spotifive";

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Reconstruit l'adresse d'un flux sur un serveur de secours.
fn swap_origin(url: &str, mirror: &str) -> Option<String> {
    let rest = url.splitn(4, '/').nth(3)?;
    Some(format!("{}/{}", mirror.trim_end_matches('/'), rest))
}

fn image(value: &Value, size: &str) -> Option<String> {
    value
        .get("artwork")?
        .get(size)?
        .as_str()
        .filter(|s| s.starts_with("http"))
        .map(str::to_string)
}

fn track_from(value: &Value) -> Option<Track> {
    let id = value.get("id")?.as_str()?;
    // Sans adresse de flux, le titre n'est pas écoutable : on l'écarte.
    let stream = value.get("stream")?.get("url")?.as_str()?;
    if value.pointer("/access/stream").and_then(Value::as_bool) == Some(false) {
        return None;
    }
    let mirrors = value
        .pointer("/stream/mirrors")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(Value::as_str)
                .filter_map(|mirror| swap_origin(stream, mirror))
                .collect()
        })
        .unwrap_or_default();
    let title = value.get("title").and_then(Value::as_str).unwrap_or("").trim();
    let artist = value.pointer("/user/name").and_then(Value::as_str).unwrap_or("").trim();
    let large = image(value, "480x480");
    let small = image(value, "150x150");

    Some(Track {
        id: format!("audius:{id}"),
        source: "audius".into(),
        title: if title.is_empty() { "Sans titre".into() } else { title.into() },
        artist: if artist.is_empty() { "Artiste inconnu".into() } else { artist.into() },
        album: None,
        duration: value.get("duration").and_then(Value::as_f64),
        thumb: small.clone().or_else(|| large.clone()),
        artwork: large.or(small),
        url: Some(stream.to_string()),
        mirrors,
        info: value
            .get("genre")
            .and_then(Value::as_str)
            .filter(|genre| !genre.is_empty())
            .map(str::to_string),
        live: false,
        // Audius ne fournit un lien de téléchargement que si l'artiste l'a activé sans condition.
        downloadable: value.pointer("/download/url").and_then(Value::as_str).is_some(),
    })
}

/// Ce qu'il faut pour télécharger un titre : adresses à essayer, extension du fichier d'origine, pochette.
pub struct DownloadInfo {
    pub urls: Vec<String>,
    pub extension: Option<String>,
    pub artwork: Option<String>,
}

/// Redemande le lien de téléchargement d'un titre. Échoue si l'artiste ne l'autorise pas.
pub async fn download_info(client: &Client, id: &str) -> Result<DownloadInfo> {
    if !valid_id(id) {
        return Err(AppError::msg("Identifiant de titre invalide"));
    }
    let body = get_json(client, &format!("{BASE}/tracks/{id}"), &[("app_name", APP_NAME)]).await?;
    let track = body.get("data").ok_or_else(|| AppError::msg("Titre introuvable"))?;
    let url = track
        .pointer("/download/url")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::msg("L'artiste n'autorise pas le téléchargement de ce titre"))?;
    let mut urls = vec![url.to_string()];
    if let Some(mirrors) = track.pointer("/download/mirrors").and_then(Value::as_array) {
        urls.extend(mirrors.iter().filter_map(Value::as_str).filter_map(|mirror| swap_origin(url, mirror)));
    }
    Ok(DownloadInfo {
        urls,
        extension: track
            .get("orig_filename")
            .and_then(Value::as_str)
            .and_then(|name| name.rsplit_once('.'))
            .map(|(_, extension)| extension.to_ascii_lowercase()),
        artwork: image(track, "480x480").or_else(|| image(track, "150x150")),
    })
}

fn tracks_from(body: &Value) -> Vec<Track> {
    body.get("data")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(track_from).collect())
        .unwrap_or_default()
}

fn collection_from(value: &Value) -> Option<Collection> {
    let id = value.get("id")?.as_str()?;
    let title = value.get("playlist_name")?.as_str()?.trim();
    if title.is_empty() {
        return None;
    }
    let is_album = value.get("is_album").and_then(Value::as_bool).unwrap_or(false);
    Some(Collection {
        id: format!("audius:{id}"),
        source: "audius".into(),
        kind: if is_album { "album" } else { "playlist" }.into(),
        title: title.into(),
        subtitle: value
            .pointer("/user/name")
            .and_then(Value::as_str)
            .unwrap_or("Audius")
            .trim()
            .to_string(),
        artwork: image(value, "480x480").or_else(|| image(value, "150x150")),
        count: value.get("track_count").and_then(Value::as_u64).map(|n| n as u32),
    })
}

fn collections_from(body: &Value) -> Vec<Collection> {
    body.get("data")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(collection_from).collect())
        .unwrap_or_default()
}

/// Titres en tendance, éventuellement filtrés par genre.
pub async fn trending(client: &Client, genre: Option<&str>, time: &str, limit: u32) -> Result<Vec<Track>> {
    let limit = limit.to_string();
    let mut query = vec![("app_name", APP_NAME), ("time", time), ("limit", limit.as_str())];
    if let Some(genre) = genre.filter(|g| !g.is_empty()) {
        query.push(("genre", genre));
    }
    let body = get_json(client, &format!("{BASE}/tracks/trending"), &query).await?;
    Ok(tracks_from(&body))
}

pub async fn search(client: &Client, text: &str, limit: u32) -> Result<Vec<Track>> {
    let limit = limit.to_string();
    let query = [("app_name", APP_NAME), ("query", text), ("limit", limit.as_str())];
    let body = get_json(client, &format!("{BASE}/tracks/search"), &query).await?;
    Ok(tracks_from(&body))
}

/// Récupère un titre avec une adresse de flux fraîchement signée, juste avant la lecture.
pub async fn resolve(client: &Client, id: &str) -> Result<Track> {
    if !valid_id(id) {
        return Err(AppError::msg("Identifiant de titre invalide"));
    }
    let body = get_json(client, &format!("{BASE}/tracks/{id}"), &[("app_name", APP_NAME)]).await?;
    body.get("data")
        .and_then(track_from)
        .ok_or_else(|| AppError::msg("Ce titre n'est plus disponible à l'écoute"))
}

pub async fn playlists_trending(client: &Client, limit: u32) -> Result<Vec<Collection>> {
    let limit = limit.to_string();
    let query = [("app_name", APP_NAME), ("time", "week"), ("limit", limit.as_str())];
    let body = get_json(client, &format!("{BASE}/playlists/trending"), &query).await?;
    Ok(collections_from(&body))
}

pub async fn playlists_search(client: &Client, text: &str, limit: u32) -> Result<Vec<Collection>> {
    let limit = limit.to_string();
    let query = [("app_name", APP_NAME), ("query", text), ("limit", limit.as_str())];
    let body = get_json(client, &format!("{BASE}/playlists/search"), &query).await?;
    Ok(collections_from(&body))
}

/// Détail d'une playlist ou d'un album Audius : fiche et titres chargés en parallèle.
pub async fn playlist(client: &Client, id: &str) -> Result<CollectionDetail> {
    if !valid_id(id) {
        return Err(AppError::msg("Identifiant de playlist invalide"));
    }
    let query = [("app_name", APP_NAME)];
    let info_url = format!("{BASE}/playlists/{id}");
    let tracks_url = format!("{BASE}/playlists/{id}/tracks");
    let (info, tracks) = tokio::join!(
        get_json(client, &info_url, &query),
        get_json(client, &tracks_url, &query)
    );
    let info = info?;
    let collection = info
        .get("data")
        .and_then(|data| data.as_array().and_then(|list| list.first()).or(Some(data)))
        .and_then(collection_from)
        .ok_or_else(|| AppError::msg("Playlist introuvable"))?;
    Ok(CollectionDetail { collection, tracks: tracks_from(&tracks?) })
}
