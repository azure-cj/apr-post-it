// No console window behind the app in a release build on Windows. Do not remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    apg_post_it_lib::run();
}
