//! Sauvegarde des données de l'utilisateur (titres aimés, playlists, réglages).

use std::io::ErrorKind;
use std::path::PathBuf;

use serde_json::Value;
use tauri::State;
use tokio::sync::Mutex;

use crate::error::Result;

pub struct Store {
    path: PathBuf,
    /// Une seule écriture à la fois.
    writing: Mutex<()>,
}

impl Store {
    pub fn new(path: PathBuf) -> Self {
        Self { path, writing: Mutex::new(()) }
    }
}

#[tauri::command]
pub async fn state_load(store: State<'_, Store>) -> Result<Value> {
    match tokio::fs::read(&store.path).await {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(state) => Ok(state),
            Err(_) => {
                // Fichier abîmé : on le met de côté plutôt que de l'écraser sans recours.
                let _ = tokio::fs::copy(&store.path, store.path.with_extension("abime.json")).await;
                Ok(Value::Null)
            }
        },
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Value::Null),
        Err(error) => Err(error.into()),
    }
}

#[tauri::command]
pub async fn state_save(store: State<'_, Store>, state: Value) -> Result<()> {
    let _guard = store.writing.lock().await;
    // Écriture dans un fichier temporaire puis renommage : jamais de fichier à moitié écrit.
    let temp = store.path.with_extension("json.tmp");
    tokio::fs::write(&temp, serde_json::to_vec(&state)?).await?;
    tokio::fs::rename(&temp, &store.path).await?;
    Ok(())
}
