use std::time::Duration;

use reqwest::Client;
use serde_json::Value;

use crate::error::Result;

/// Client HTTP partagé : une seule réserve de connexions pour toute l'application,
/// ce qui évite de renégocier TLS à chaque recherche.
pub fn client() -> Client {
    Client::builder()
        .user_agent(concat!("Spotifive/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_nodelay(true)
        .build()
        .expect("création du client HTTP")
}

pub async fn get_json(client: &Client, url: &str, query: &[(&str, &str)]) -> Result<Value> {
    let response = client.get(url).query(query).send().await?.error_for_status()?;
    Ok(response.json::<Value>().await?)
}

/// Lit un champ texte qui peut arriver sous forme de chaîne, de nombre ou de liste.
pub fn text(value: Option<&Value>) -> Option<String> {
    let found = match value? {
        Value::String(s) => s.trim().to_string(),
        Value::Number(n) => n.to_string(),
        Value::Array(items) => items
            .iter()
            .filter_map(|item| item.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(", "),
        _ => return None,
    };
    (!found.is_empty()).then_some(found)
}
