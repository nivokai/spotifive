//! Mise à jour automatique : l'application interroge la dernière version publiée,
//! vérifie sa signature avec la clé publique embarquée, l'installe et redémarre.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

use crate::error::{AppError, Result};

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
}

fn failure(error: impl std::fmt::Display) -> AppError {
    AppError::msg(format!(
        "Impossible de vérifier les mises à jour pour le moment (serveur injoignable ou aucune version publiée). Détail : {error}"
    ))
}

/// Renvoie la mise à jour disponible, ou `None` si l'application est à jour.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>> {
    let update = app.updater().map_err(failure)?.check().await.map_err(failure)?;
    Ok(update.map(|update| UpdateInfo {
        version: update.version.clone(),
        current: update.current_version.clone(),
        notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
    }))
}

/// Télécharge et installe la mise à jour, en envoyant la progression à l'interface.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<()> {
    let update = app
        .updater()
        .map_err(failure)?
        .check()
        .await
        .map_err(failure)?
        .ok_or_else(|| AppError::msg("Spotifive est déjà à jour"))?;

    let progress_app = app.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit("update://progress", DownloadProgress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(failure)?;

    // Sous Windows l'installeur relance déjà l'application ; ailleurs on redémarre ici.
    app.restart()
}
