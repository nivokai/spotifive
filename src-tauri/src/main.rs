// Pas de console noire derrière la fenêtre en version finale
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    spotifive_lib::run()
}
