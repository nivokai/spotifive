//! Catalogue mondial : le site officiel YouTube Music, affiché tel quel dans une zone de la fenêtre.
//!
//! Spotifive ne copie, ne télécharge et ne modifie rien : c'est le site de YouTube, avec ses
//! publicités, comme dans un navigateur. Cette page distante n'a accès à aucune commande de
//! l'application (Tauri refuse les appels venant d'une adresse externe, et les permissions
//! sont limitées à la page principale).

use serde::Deserialize;
use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, State, Url, WebviewUrl};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;

use crate::error::{AppError, Result};

const LABEL: &str = "catalogue";
const HOME: &str = "https://music.youtube.com/";

/// Seuls YouTube et la connexion Google s'affichent dans l'application ;
/// tout autre lien s'ouvre dans le navigateur de l'utilisateur.
const INSIDE: [&str; 2] = ["youtube.com", "google.com"];

/// Met en pause ce qui joue dans la page, comme le ferait la touche pause du clavier.
const PAUSE: &str = "document.querySelectorAll('video, audio').forEach((media) => media.pause());";

/// Zone de la fenêtre occupée par la page, en pixels logiques.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Bounds {
    fn position(&self) -> LogicalPosition<f64> {
        LogicalPosition::new(self.x.max(0.0), self.y.max(0.0))
    }

    fn size(&self) -> LogicalSize<f64> {
        LogicalSize::new(self.width.max(1.0), self.height.max(1.0))
    }
}

/// Empêche de créer deux fois la page si deux demandes arrivent en même temps.
#[derive(Default)]
pub struct Catalogue {
    creating: Mutex<()>,
}

fn stays_inside(url: &Url) -> bool {
    match url.scheme() {
        "about" => true,
        "https" => url.host_str().is_some_and(|host| {
            INSIDE
                .iter()
                .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
        }),
        _ => false,
    }
}

/// Adresse à afficher : l'accueil, ou les résultats d'une recherche.
fn target(query: Option<&str>) -> Url {
    let mut url = Url::parse(HOME).expect("adresse fixe valide");
    if let Some(query) = query.map(str::trim).filter(|query| !query.is_empty()) {
        url.set_path("search");
        url.query_pairs_mut().append_pair("q", query);
    }
    url
}

fn open_in_browser(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

/// Affiche la page dans la zone donnée (en la créant au premier appel) et lance une recherche si demandé.
#[tauri::command]
pub async fn catalogue_show(
    app: AppHandle,
    state: State<'_, Catalogue>,
    bounds: Bounds,
    query: Option<String>,
) -> Result<()> {
    let _guard = state.creating.lock().await;
    let has_query = query.as_deref().is_some_and(|query| !query.trim().is_empty());

    if let Some(webview) = app.get_webview(LABEL) {
        webview.set_position(bounds.position())?;
        webview.set_size(bounds.size())?;
        webview.show()?;
        if has_query {
            webview.navigate(target(query.as_deref()))?;
        }
        return Ok(());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| AppError::msg("Fenêtre principale introuvable"))?;
    let navigation_app = app.clone();
    let popup_app = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(target(query.as_deref())))
        .on_navigation(move |url| {
            if stays_inside(url) {
                true
            } else {
                open_in_browser(&navigation_app, url);
                false
            }
        })
        .on_new_window(move |url, _features| {
            open_in_browser(&popup_app, &url);
            NewWindowResponse::Deny
        });
    window.add_child(builder, bounds.position(), bounds.size())?;
    Ok(())
}

/// Suit la zone d'affichage quand la fenêtre change de taille.
#[tauri::command]
pub async fn catalogue_bounds(app: AppHandle, bounds: Bounds) -> Result<()> {
    if let Some(webview) = app.get_webview(LABEL) {
        webview.set_position(bounds.position())?;
        webview.set_size(bounds.size())?;
    }
    Ok(())
}

/// Masque la page sans l'arrêter : la musique continue pendant qu'on visite le reste de l'application.
#[tauri::command]
pub async fn catalogue_hide(app: AppHandle) -> Result<()> {
    if let Some(webview) = app.get_webview(LABEL) {
        webview.hide()?;
    }
    Ok(())
}

/// Met la page en pause, quand un titre démarre dans le lecteur de Spotifive.
#[tauri::command]
pub async fn catalogue_pause(app: AppHandle) -> Result<()> {
    if let Some(webview) = app.get_webview(LABEL) {
        webview.eval(PAUSE)?;
    }
    Ok(())
}

/// Boutons de navigation de la page : `back`, `forward`, `reload`, `home`.
#[tauri::command]
pub async fn catalogue_nav(app: AppHandle, action: String) -> Result<()> {
    let Some(webview) = app.get_webview(LABEL) else {
        return Ok(());
    };
    match action.as_str() {
        "back" => webview.eval("history.back();")?,
        "forward" => webview.eval("history.forward();")?,
        "reload" => webview.reload()?,
        "home" => webview.navigate(target(None))?,
        _ => return Err(AppError::msg("Action de navigation inconnue")),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn only_youtube_and_google_stay_in_the_app() {
        assert!(stays_inside(&url("https://music.youtube.com/search?q=x")));
        assert!(stays_inside(&url("https://consent.youtube.com/m")));
        assert!(stays_inside(&url("https://accounts.google.com/signin")));
        assert!(!stays_inside(&url("https://example.com/")));
        assert!(!stays_inside(&url("https://youtube.com.evil.example/")));
        assert!(!stays_inside(&url("https://notyoutube.com/")));
        assert!(!stays_inside(&url("http://music.youtube.com/")));
        assert!(!stays_inside(&url("file:///C:/Windows/win.ini")));
    }

    #[test]
    fn search_query_is_encoded() {
        assert_eq!(target(None).as_str(), "https://music.youtube.com/");
        assert_eq!(target(Some("   ")).as_str(), "https://music.youtube.com/");
        assert_eq!(
            target(Some("daft punk & co")).as_str(),
            "https://music.youtube.com/search?q=daft+punk+%26+co"
        );
    }
}
