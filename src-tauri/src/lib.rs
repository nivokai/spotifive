mod error;
mod http;
mod library;
mod model;
mod sources;
mod store;
mod updater;

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use error::Result;
use model::{Collection, CollectionDetail, Track};
use sources::{archive, audius, radio};

/// Client HTTP partagé par toutes les commandes.
struct Net(reqwest::Client);

#[derive(Serialize)]
struct Home {
    trending: Vec<Track>,
    playlists: Vec<Collection>,
    radios: Vec<Track>,
    errors: Vec<String>,
}

#[derive(Serialize)]
struct SearchResults {
    tracks: Vec<Track>,
    playlists: Vec<Collection>,
    albums: Vec<Collection>,
    radios: Vec<Track>,
    errors: Vec<String>,
}

#[derive(Serialize)]
struct AppInfo {
    version: String,
}

/// Garde le résultat d'une source ; si elle échoue, les autres sections s'affichent quand même.
fn keep<T: Default>(result: Result<T>, source: &str, errors: &mut Vec<String>) -> T {
    result.unwrap_or_else(|error| {
        errors.push(format!("{source} : {error}"));
        T::default()
    })
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo { version: app.package_info().version.to_string() }
}

/// Page d'accueil : les trois sources sont interrogées en parallèle.
#[tauri::command]
async fn home(net: State<'_, Net>, country: Option<String>) -> Result<Home> {
    let client = &net.0;
    let (trending, playlists, radios) = tokio::join!(
        audius::trending(client, None, "week", 30),
        audius::playlists_trending(client, 12),
        radio::search(client, None, None, country.as_deref(), 18),
    );
    let mut errors = Vec::new();
    Ok(Home {
        trending: keep(trending, "Audius", &mut errors),
        playlists: keep(playlists, "Playlists Audius", &mut errors),
        radios: keep(radios, "Radios", &mut errors),
        errors,
    })
}

/// Recherche globale : toutes les sources en même temps.
#[tauri::command]
async fn search_all(net: State<'_, Net>, query: String) -> Result<SearchResults> {
    let client = &net.0;
    let query = query.trim();
    let (tracks, playlists, albums, radios) = tokio::join!(
        audius::search(client, query, 40),
        audius::playlists_search(client, query, 12),
        archive::search(client, query, 18),
        radio::search(client, Some(query), None, None, 18),
    );
    let mut errors = Vec::new();
    Ok(SearchResults {
        tracks: keep(tracks, "Audius", &mut errors),
        playlists: keep(playlists, "Playlists Audius", &mut errors),
        albums: keep(albums, "Internet Archive", &mut errors),
        radios: keep(radios, "Radios", &mut errors),
        errors,
    })
}

#[tauri::command]
async fn audius_trending(net: State<'_, Net>, genre: Option<String>, time: Option<String>) -> Result<Vec<Track>> {
    let time = match time.as_deref() {
        Some("month") => "month",
        Some("year") => "year",
        Some("allTime") => "allTime",
        _ => "week",
    };
    audius::trending(&net.0, genre.as_deref(), time, 60).await
}

/// Redemande l'adresse du flux d'un titre Audius juste avant de le lire.
#[tauri::command]
async fn audius_resolve(net: State<'_, Net>, id: String) -> Result<Track> {
    audius::resolve(&net.0, &id).await
}

/// Détail d'un album ou d'une playlist, d'après son identifiant préfixé par la source.
#[tauri::command]
async fn collection_detail(net: State<'_, Net>, id: String) -> Result<CollectionDetail> {
    match id.split_once(':') {
        Some(("audius", rest)) => audius::playlist(&net.0, rest).await,
        Some(("archive", rest)) => archive::album(&net.0, rest).await,
        _ => Err(error::AppError::msg("Source inconnue")),
    }
}

#[tauri::command]
async fn radio_search(
    net: State<'_, Net>,
    name: Option<String>,
    tag: Option<String>,
    country: Option<String>,
) -> Result<Vec<Track>> {
    radio::search(&net.0, name.as_deref(), tag.as_deref(), country.as_deref(), 60).await
}

#[tauri::command]
async fn radio_click(net: State<'_, Net>, id: String) -> Result<()> {
    radio::click(&net.0, id.strip_prefix("radio:").unwrap_or(&id)).await
}

pub fn run() {
    tauri::Builder::default()
        // Un second lancement ramène simplement la fenêtre existante au premier plan.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            app.manage(Net(http::client()));
            app.manage(store::Store::new(data_dir.join("state.json")));

            let library = Arc::new(library::Library::open(&data_dir));
            library.grant_access(app.handle());
            app.manage(library);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            home,
            search_all,
            audius_trending,
            audius_resolve,
            collection_detail,
            radio_search,
            radio_click,
            library::library_get,
            library::library_add_folder,
            library::library_remove_folder,
            library::library_rescan,
            store::state_load,
            store::state_save,
            updater::update_check,
            updater::update_install,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Spotifive");
}
