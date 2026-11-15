use serde::{Deserialize, Serialize};

/// Un titre jouable, quelle que soit sa source (Audius, Internet Archive, radio, fichier local).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Track {
    /// Identifiant unique préfixé par la source, ex. `audius:J7Xb000`.
    pub id: String,
    pub source: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    /// Durée en secondes (absente pour une radio en direct).
    pub duration: Option<f64>,
    /// Pochette en grand format.
    pub artwork: Option<String>,
    /// Pochette en petit format pour les listes.
    pub thumb: Option<String>,
    /// Adresse du flux audio, ou chemin du fichier pour un titre local.
    pub url: Option<String>,
    /// Adresses de secours du même flux.
    #[serde(default)]
    pub mirrors: Vec<String>,
    /// Genre, pays, débit… affiché en complément.
    pub info: Option<String>,
    /// Vrai pour un flux en direct (radio).
    #[serde(default)]
    pub live: bool,
    /// Vrai si la source autorise le téléchargement pour une écoute hors ligne.
    #[serde(default)]
    pub downloadable: bool,
}

/// Un album ou une playlist en ligne.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub source: String,
    /// `album` ou `playlist`.
    pub kind: String,
    pub title: String,
    pub subtitle: String,
    pub artwork: Option<String>,
    pub count: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CollectionDetail {
    pub collection: Collection,
    pub tracks: Vec<Track>,
}
