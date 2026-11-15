use std::collections::BTreeMap;

use reqwest::Client;
use serde_json::Value;

use crate::error::{AppError, Result};
use crate::http::{get_json, text};
use crate::model::{Collection, CollectionDetail, Track};

/// On se limite aux collections dont la diffusion est autorisée par les artistes :
/// les netlabels (labels en licence libre) et la Live Music Archive (concerts autorisés).
const SCOPE: &str = "collection:(netlabels OR etree) AND mediatype:(audio OR etree)";

fn valid_identifier(identifier: &str) -> bool {
    !identifier.is_empty()
        && identifier.len() <= 120
        && identifier.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Retire la syntaxe de requête pour ne garder que des mots.
fn sanitize(query: &str) -> String {
    query
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn cover(identifier: &str) -> String {
    format!("https://archive.org/services/img/{identifier}")
}

/// Adresse de téléchargement d'un fichier, d'après l'identifiant de titre `album/fichier`.
/// Renvoie aussi l'identifiant de l'album. Refuse tout chemin qui sortirait de l'album.
pub(crate) fn download_url(track: &str) -> Option<(String, &str)> {
    let (identifier, name) = track.split_once('/')?;
    let inside = !name.is_empty()
        && !name.contains('\\')
        && name.split('/').all(|part| !part.is_empty() && part != "." && part != "..");
    (valid_identifier(identifier) && inside)
        .then(|| (format!("https://archive.org/download/{identifier}/{}", encode_path(name)), identifier))
}

fn encode_path(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 16);
    for byte in name.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Durée fournie soit en secondes (`133.11`), soit en `mm:ss` / `hh:mm:ss`.
fn parse_length(raw: &str) -> Option<f64> {
    let mut seconds = 0.0;
    for part in raw.split(':') {
        seconds = seconds * 60.0 + part.trim().parse::<f64>().ok()?;
    }
    (seconds > 0.0).then_some(seconds)
}

/// Classe les formats lisibles par ordre de préférence (plus petit = mieux). `None` = non audio.
fn format_rank(format: &str) -> Option<u8> {
    let format = format.to_ascii_lowercase();
    if format.contains("mp3") {
        Some(if format.starts_with("vbr") {
            0
        } else if format.starts_with("64") {
            3
        } else if format.starts_with("128") {
            2
        } else {
            1
        })
    } else if format.contains("ogg") {
        Some(4)
    } else if format.contains("flac") {
        Some(5)
    } else {
        None
    }
}

fn stem(name: &str) -> &str {
    name.rsplit_once('.').map(|(base, _)| base).unwrap_or(name)
}

pub async fn search(client: &Client, query: &str, rows: u32) -> Result<Vec<Collection>> {
    let terms = sanitize(query);
    let q = if terms.is_empty() { SCOPE.to_string() } else { format!("({terms}) AND {SCOPE}") };
    let rows = rows.to_string();
    let params = [
        ("q", q.as_str()),
        ("fl[]", "identifier"),
        ("fl[]", "title"),
        ("fl[]", "creator"),
        ("sort[]", "downloads desc"),
        ("rows", rows.as_str()),
        ("output", "json"),
    ];
    let body = get_json(client, "https://archive.org/advancedsearch.php", &params).await?;
    let docs = body.pointer("/response/docs").and_then(Value::as_array);

    Ok(docs
        .map(|docs| {
            docs.iter()
                .filter_map(|doc| {
                    let identifier = doc.get("identifier")?.as_str()?;
                    if !valid_identifier(identifier) {
                        return None;
                    }
                    Some(Collection {
                        id: format!("archive:{identifier}"),
                        source: "archive".into(),
                        kind: "album".into(),
                        title: text(doc.get("title")).unwrap_or_else(|| identifier.to_string()),
                        subtitle: text(doc.get("creator")).unwrap_or_else(|| "Internet Archive".into()),
                        artwork: Some(cover(identifier)),
                        count: None,
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

pub async fn album(client: &Client, identifier: &str) -> Result<CollectionDetail> {
    if !valid_identifier(identifier) {
        return Err(AppError::msg("Identifiant d'album invalide"));
    }
    let body = get_json(client, &format!("https://archive.org/metadata/{identifier}"), &[]).await?;
    let meta = body.get("metadata").ok_or_else(|| AppError::msg("Album introuvable"))?;
    let album_title = text(meta.get("title")).unwrap_or_else(|| identifier.to_string());
    let album_artist = text(meta.get("creator")).unwrap_or_else(|| "Artiste inconnu".into());
    let artwork = cover(identifier);

    // Un même morceau existe souvent en plusieurs formats : on garde le meilleur de chaque.
    let mut best: BTreeMap<String, (u8, &Value)> = BTreeMap::new();
    for file in body.get("files").and_then(Value::as_array).into_iter().flatten() {
        let (Some(name), Some(format)) = (
            file.get("name").and_then(Value::as_str),
            file.get("format").and_then(Value::as_str),
        ) else {
            continue;
        };
        let Some(rank) = format_rank(format) else { continue };
        let origin = file.get("original").and_then(Value::as_str).unwrap_or(name);
        let key = stem(origin).to_string();
        match best.get(&key) {
            Some((current, _)) if *current <= rank => {}
            _ => {
                best.insert(key, (rank, file));
            }
        }
    }

    let mut rows: Vec<(u32, String, Track)> = best
        .into_values()
        .filter_map(|(_, file)| {
            let name = file.get("name")?.as_str()?;
            let number = text(file.get("track"))
                .and_then(|raw| raw.split('/').next().and_then(|n| n.trim().parse::<u32>().ok()))
                .unwrap_or(u32::MAX);
            let track = Track {
                id: format!("archive:{identifier}/{name}"),
                source: "archive".into(),
                title: text(file.get("title"))
                    .unwrap_or_else(|| stem(name.rsplit('/').next().unwrap_or(name)).replace('_', " ")),
                artist: text(file.get("artist"))
                    .or_else(|| text(file.get("creator")))
                    .unwrap_or_else(|| album_artist.clone()),
                album: Some(album_title.clone()),
                duration: text(file.get("length")).and_then(|raw| parse_length(&raw)),
                artwork: Some(artwork.clone()),
                thumb: Some(artwork.clone()),
                url: Some(format!("https://archive.org/download/{identifier}/{}", encode_path(name))),
                mirrors: Vec::new(),
                info: None,
                live: false,
                // Netlabels et concerts autorisés : ces fichiers sont proposés en téléchargement libre.
                downloadable: true,
            };
            Some((number, name.to_string(), track))
        })
        .collect();
    rows.sort_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));
    let tracks: Vec<Track> = rows.into_iter().map(|(_, _, track)| track).collect();

    Ok(CollectionDetail {
        collection: Collection {
            id: format!("archive:{identifier}"),
            source: "archive".into(),
            kind: "album".into(),
            title: album_title,
            subtitle: album_artist,
            artwork: Some(artwork),
            count: Some(tracks.len() as u32),
        },
        tracks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lengths() {
        assert_eq!(parse_length("133.5"), Some(133.5));
        assert_eq!(parse_length("2:13"), Some(133.0));
        assert_eq!(parse_length("1:00:01"), Some(3601.0));
        assert_eq!(parse_length("abc"), None);
    }

    #[test]
    fn prefers_vbr_mp3_then_other_mp3_then_lossless() {
        assert!(format_rank("VBR MP3") < format_rank("128Kbps MP3"));
        assert!(format_rank("128Kbps MP3") < format_rank("Ogg Vorbis"));
        assert!(format_rank("Ogg Vorbis") < format_rank("Flac"));
        assert_eq!(format_rank("PNG"), None);
    }

    #[test]
    fn download_address_stays_inside_the_album() {
        let (url, album) = download_url("ird059/disc 1/01 track.mp3").unwrap();
        assert_eq!(url, "https://archive.org/download/ird059/disc%201/01%20track.mp3");
        assert_eq!(album, "ird059");
        assert!(download_url("ird059/../secret.mp3").is_none());
        assert!(download_url("ird059/a\\b.mp3").is_none());
        assert!(download_url("bad id/file.mp3").is_none());
        assert!(download_url("ird059/").is_none());
        assert!(download_url("ird059").is_none());
    }

    #[test]
    fn query_is_reduced_to_words() {
        assert_eq!(sanitize("  daft (punk) OR title:\"x\" "), "daft punk OR title x");
        assert_eq!(encode_path("a b/c#1.mp3"), "a%20b/c%231.mp3");
    }
}
