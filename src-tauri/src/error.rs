use serde::{Serialize, Serializer};

/// Erreur unique de l'application, renvoyée à l'interface sous forme de texte lisible.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Problème réseau : {0}")]
    Http(#[from] reqwest::Error),
    #[error("Problème de fichier : {0}")]
    Io(#[from] std::io::Error),
    #[error("Données illisibles : {0}")]
    Json(#[from] serde_json::Error),
    #[error("Problème d'affichage : {0}")]
    Window(#[from] tauri::Error),
    #[error("{0}")]
    Msg(String),
}

impl AppError {
    pub fn msg(text: impl Into<String>) -> Self {
        Self::Msg(text.into())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
