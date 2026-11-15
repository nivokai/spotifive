use std::collections::HashSet;

use reqwest::Client;
use serde_json::Value;

use crate::error::{AppError, Result};
use crate::http::get_json;
use crate::model::Track;

/// Serveurs de l'annuaire communautaire Radio Browser, essayés dans l'ordre.
const HOSTS: [&str; 2] = [
    "https://de1.api.radio-browser.info",
    "https://all.api.radio-browser.info",
];

async fn fetch(client: &Client, path: &str, query: &[(&str, &str)]) -> Result<Value> {
    let mut last_error = AppError::msg("Annuaire des radios injoignable");
    for host in HOSTS {
        match get_json(client, &format!("{host}{path}"), query).await {
            Ok(body) => return Ok(body),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

fn field<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("").trim()
}

fn station(value: &Value) -> Option<Track> {
    // Les flux HLS ne sont pas lisibles directement par le lecteur intégré.
    if value.get("hls").and_then(Value::as_i64) == Some(1) {
        return None;
    }
    let uuid = field(value, "stationuuid");
    let name = field(value, "name");
    let url = ["url_resolved", "url"]
        .into_iter()
        .map(|key| field(value, key))
        .find(|url| url.starts_with("http"))?;
    if uuid.is_empty() || name.is_empty() {
        return None;
    }

    let tags: Vec<&str> = field(value, "tags")
        .split(',')
        .map(str::trim)
        .filter(|tag| !tag.is_empty())
        .take(3)
        .collect();
    let country = field(value, "country");
    let artist = match (country.is_empty(), tags.is_empty()) {
        (false, false) => format!("{country} · {}", tags.join(", ")),
        (false, true) => country.to_string(),
        (true, false) => tags.join(", "),
        (true, true) => "Radio".to_string(),
    };
    let codec = field(value, "codec");
    let bitrate = value.get("bitrate").and_then(Value::as_u64).unwrap_or(0);
    let info = match (codec.is_empty(), bitrate) {
        (false, 0) => Some(codec.to_string()),
        (false, rate) => Some(format!("{codec} {rate} kbps")),
        (true, 0) => None,
        (true, rate) => Some(format!("{rate} kbps")),
    };
    let favicon = Some(field(value, "favicon"))
        .filter(|icon| icon.starts_with("http"))
        .map(str::to_string);

    Some(Track {
        id: format!("radio:{uuid}"),
        source: "radio".into(),
        title: name.to_string(),
        artist,
        album: None,
        duration: None,
        artwork: favicon.clone(),
        thumb: favicon,
        url: Some(url.to_string()),
        mirrors: Vec::new(),
        info,
        live: true,
        downloadable: false,
    })
}

fn stations(body: &Value) -> Vec<Track> {
    // L'annuaire contient des doublons : on ne garde que la première radio de chaque nom.
    let mut seen = HashSet::new();
    body.as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(station)
                .filter(|track| seen.insert(track.title.to_lowercase()))
                .collect()
        })
        .unwrap_or_default()
}

/// Recherche de radios par nom, style et pays, classées par popularité.
pub async fn search(
    client: &Client,
    name: Option<&str>,
    tag: Option<&str>,
    country: Option<&str>,
    limit: u32,
) -> Result<Vec<Track>> {
    let limit = limit.to_string();
    let mut query = vec![
        ("limit", limit.as_str()),
        ("hidebroken", "true"),
        ("order", "clickcount"),
        ("reverse", "true"),
    ];
    if let Some(name) = name.map(str::trim).filter(|v| !v.is_empty()) {
        query.push(("name", name));
    }
    if let Some(tag) = tag.map(str::trim).filter(|v| !v.is_empty()) {
        query.push(("tag", tag));
    }
    if let Some(country) = country.map(str::trim).filter(|v| v.len() == 2 && v.chars().all(|c| c.is_ascii_alphabetic())) {
        query.push(("countrycode", country));
    }
    let body = fetch(client, "/json/stations/search", &query).await?;
    Ok(stations(&body))
}

/// Signale une écoute à l'annuaire : c'est ce qui alimente son classement de popularité.
pub async fn click(client: &Client, uuid: &str) -> Result<()> {
    if uuid.is_empty() || !uuid.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err(AppError::msg("Identifiant de radio invalide"));
    }
    fetch(client, &format!("/json/url/{uuid}"), &[]).await.map(|_| ())
}
