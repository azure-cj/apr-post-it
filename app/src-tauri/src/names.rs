//! Names Windows will accept, made from a listing's name or a photo's.
//!
//! Listing names are written by people for people: "Taguig, 135 East Tower",
//! "FOR LEASE/ FOR RENT", "*NEW* Casa Amara". Every character Windows refuses
//! becomes `_`, as browsers do with downloads, so the folder is still
//! recognisably the listing's. Commas, `&`, `#` and accents are legal and kept.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// What a folder is called when nothing usable is left of the listing's name.
pub const FALLBACK_FOLDER: &str = "Property";
/// What a photo is called when nothing usable is left of its name.
pub const FALLBACK_STEM: &str = "photo";

/// Longest name kept, in characters. `Downloads\APG Post-It\<folder>\<file>`
/// has to stay well inside the 260 characters that Explorer and the Facebook
/// upload dialog still work within, even under a OneDrive-redirected Downloads.
const MAX_FOLDER_CHARS: usize = 64;
const MAX_STEM_CHARS: usize = 64;

/// How many `name (n).ext` variants are tried before giving up.
const MAX_SUFFIX: u32 = 999;

/// Image extensions a photo's own name may already carry. Dropped from the
/// stem, because the extension written is the one the downloaded bytes prove.
const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "jpe", "jfif", "png", "gif", "webp", "heic", "heif", "avif", "bmp", "tif",
    "tiff",
];

/// The folder for a listing's photos, from its name.
pub fn safe_folder_name(property: &str) -> String {
    clean(property, MAX_FOLDER_CHARS).unwrap_or_else(|| FALLBACK_FOLDER.to_string())
}

/// A photo's file name without its extension, from the name it was given.
pub fn safe_file_stem(name: &str) -> String {
    let trimmed = name.trim();
    let without_ext = match trimmed.rsplit_once('.') {
        Some((stem, ext)) if IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()) => stem,
        _ => trimmed,
    };
    clean(without_ext, MAX_STEM_CHARS).unwrap_or_else(|| FALLBACK_STEM.to_string())
}

/// `photo 1.jpg`, then `photo 1 (2).jpg`, `photo 1 (3).jpg`…
pub fn numbered(stem: &str, ext: &str, n: u32) -> String {
    if n <= 1 {
        format!("{stem}.{ext}")
    } else {
        format!("{stem} ({n}).{ext}")
    }
}

/// Creates `stem.ext` in `dir`, or the first free `stem (n).ext`, and writes
/// `bytes` to it. Never replaces a file: the name is claimed with
/// `create_new`, so the OS decides what "already exists" means (case and
/// Unicode folding included) and two savers cannot claim the same name.
pub fn write_unique(dir: &Path, stem: &str, ext: &str, bytes: &[u8]) -> io::Result<PathBuf> {
    for n in 1..=MAX_SUFFIX {
        let path = dir.join(numbered(stem, ext, n));
        if path.symlink_metadata().is_ok() {
            continue;
        }
        let file = match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => file,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        };
        return match fill(file, bytes) {
            Ok(()) => Ok(path),
            Err(e) => {
                // A half-written photo is worse than none: it would be
                // uploaded to Facebook truncated.
                let _ = std::fs::remove_file(&path);
                Err(e)
            }
        };
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        format!("{MAX_SUFFIX} copies of {stem}.{ext} are already there"),
    ))
}

fn fill(mut file: File, bytes: &[u8]) -> io::Result<()> {
    file.write_all(bytes)?;
    file.sync_all()
}

/// Characters Windows refuses anywhere in a file or folder name.
const FORBIDDEN: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Invisible characters that can disguise a name (`photo\u{202E}gpj.exe`
/// shows as `photoexe.jpg`) or make two names look the same.
fn is_invisible(c: char) -> bool {
    matches!(c,
        '\u{00AD}'                      // soft hyphen
        | '\u{061C}'                    // Arabic letter mark
        | '\u{180E}'                    // Mongolian vowel separator
        | '\u{200B}'..='\u{200F}'       // zero-width spaces and joiners, LRM, RLM
        | '\u{202A}'..='\u{202E}'       // bidi embeddings and overrides
        | '\u{2060}'..='\u{2064}'       // word joiner, invisible operators
        | '\u{2066}'..='\u{2069}'       // bidi isolates
        | '\u{FEFF}'                    // byte-order mark
        | '\u{FFF9}'..='\u{FFFB}'       // interlinear annotations
    )
}

/// Device names Windows reserves, with or without an extension.
fn is_reserved(name: &str) -> bool {
    let base = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_uppercase();
    match base.as_str() {
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$" => true,
        _ => {
            let mut chars = base.chars();
            let prefix: String = chars.by_ref().take(3).collect();
            let rest: Vec<char> = chars.collect();
            (prefix == "COM" || prefix == "LPT")
                && rest.len() == 1
                && matches!(rest[0], '0'..='9' | '¹' | '²' | '³')
        }
    }
}

fn clean(raw: &str, max_chars: usize) -> Option<String> {
    let mut out = String::with_capacity(raw.len());
    let mut last_space = false;
    for c in raw.chars() {
        let mapped = if FORBIDDEN.contains(&c) {
            Some('_')
        } else if c.is_whitespace() {
            Some(' ')
        } else if c.is_control() || is_invisible(c) {
            None
        } else {
            Some(c)
        };
        match mapped {
            Some(' ') if last_space => {}
            Some(m) => {
                last_space = m == ' ';
                out.push(m);
            }
            None => {}
        }
    }

    // Windows drops trailing dots and spaces itself, so a name ending in one
    // would not be the name it was saved under. A leading dot hides a folder
    // on macOS and Linux. Neither is ever part of what makes a name a name.
    let trimmed = out.trim_matches([' ', '.']);
    let truncated: String = trimmed.chars().take(max_chars).collect();
    let result = truncated.trim_end_matches([' ', '.']);

    if result.is_empty() {
        None
    } else if is_reserved(result) {
        Some(format!("_{result}"))
    } else {
        Some(result.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_plain_name() {
        assert_eq!(
            safe_folder_name("Casa Amara House & Lot"),
            "Casa Amara House & Lot"
        );
    }

    #[test]
    fn keeps_commas_and_accents_which_windows_allows() {
        assert_eq!(
            safe_folder_name("Taguig, 135 East Tower"),
            "Taguig, 135 East Tower"
        );
        assert_eq!(safe_folder_name("Parañaque #12"), "Parañaque #12");
    }

    #[test]
    fn replaces_slashes_and_asterisks() {
        assert_eq!(
            safe_folder_name("FOR LEASE/ FOR RENT"),
            "FOR LEASE_ FOR RENT"
        );
        assert_eq!(safe_folder_name("*NEW* Casa Amara"), "_NEW_ Casa Amara");
        assert_eq!(safe_folder_name(r"Unit 4B\5B"), "Unit 4B_5B");
    }

    #[test]
    fn replaces_every_character_windows_refuses() {
        assert_eq!(
            safe_folder_name(r#"a<b>c:d"e/f\g|h?i*j"#),
            "a_b_c_d_e_f_g_h_i_j"
        );
    }

    #[test]
    fn cannot_climb_out_of_the_folder() {
        assert_eq!(safe_folder_name(".."), FALLBACK_FOLDER);
        assert_eq!(safe_folder_name("."), FALLBACK_FOLDER);
        assert_eq!(safe_folder_name("../../Windows"), "_.._Windows");
        assert_eq!(safe_folder_name(r"..\..\AppData"), "_.._AppData");
        assert_eq!(safe_folder_name("C:/Users/x"), "C__Users_x");
        assert!(!safe_folder_name("/etc/passwd").contains('/'));
    }

    #[test]
    fn trims_spaces_and_dots_windows_would_drop() {
        assert_eq!(
            safe_folder_name("  Verdant Hills Lot 7.  "),
            "Verdant Hills Lot 7"
        );
        assert_eq!(
            safe_folder_name("...Sta. Rosa Lot 22..."),
            "Sta. Rosa Lot 22"
        );
    }

    #[test]
    fn collapses_whitespace_and_drops_control_characters() {
        assert_eq!(
            safe_folder_name("Lot\t12\r\n  Phase\u{0}2"),
            "Lot 12 Phase2"
        );
        assert_eq!(safe_folder_name("Lot\u{00A0}\u{00A0}9"), "Lot 9");
    }

    #[test]
    fn drops_invisible_characters_that_disguise_names() {
        assert_eq!(safe_file_stem("photo\u{202E}gpj.exe"), "photogpj.exe");
        assert_eq!(safe_folder_name("Lot\u{200B}7"), "Lot7");
        assert_eq!(safe_folder_name("\u{FEFF}Lot 7"), "Lot 7");
    }

    #[test]
    fn falls_back_when_nothing_is_left() {
        assert_eq!(safe_folder_name(""), FALLBACK_FOLDER);
        assert_eq!(safe_folder_name("   "), FALLBACK_FOLDER);
        assert_eq!(safe_folder_name("\u{200B}\u{0007}"), FALLBACK_FOLDER);
        assert_eq!(safe_file_stem(""), FALLBACK_STEM);
        assert_eq!(safe_file_stem(".jpg"), FALLBACK_STEM);
    }

    #[test]
    fn avoids_names_windows_reserves() {
        assert_eq!(safe_folder_name("CON"), "_CON");
        assert_eq!(safe_folder_name("con"), "_con");
        assert_eq!(safe_folder_name("nul.txt"), "_nul.txt");
        assert_eq!(safe_folder_name("COM1"), "_COM1");
        assert_eq!(safe_folder_name("lpt9"), "_lpt9");
        assert_eq!(safe_folder_name("COM²"), "_COM²");
        assert_eq!(safe_folder_name("AUX "), "_AUX");
        assert_eq!(safe_folder_name("Console"), "Console");
        assert_eq!(safe_folder_name("COM10"), "COM10");
        assert_eq!(safe_folder_name("Auxiliary Lot"), "Auxiliary Lot");
    }

    #[test]
    fn caps_long_names_without_leaving_a_trailing_space_or_dot() {
        let long = "Antipolo Ridge ".repeat(10);
        let safe = safe_folder_name(&long);
        assert!(safe.chars().count() <= MAX_FOLDER_CHARS);
        assert!(!safe.ends_with(' ') && !safe.ends_with('.'));

        let dotted = format!("{}. Rest", "a".repeat(MAX_FOLDER_CHARS - 1));
        assert_eq!(safe_folder_name(&dotted), "a".repeat(MAX_FOLDER_CHARS - 1));
    }

    #[test]
    fn caps_by_character_not_byte() {
        let name = "ñ".repeat(100);
        assert_eq!(safe_folder_name(&name).chars().count(), MAX_FOLDER_CHARS);
    }

    #[test]
    fn a_photo_name_loses_only_an_image_extension() {
        assert_eq!(safe_file_stem("photo 1"), "photo 1");
        assert_eq!(safe_file_stem("IMG_0001.JPG"), "IMG_0001");
        assert_eq!(safe_file_stem("front.webp"), "front");
        assert_eq!(safe_file_stem("Sta. Rosa"), "Sta. Rosa");
        assert_eq!(safe_file_stem("invoice.exe"), "invoice.exe");
        assert_eq!(safe_file_stem("a/b.png"), "a_b");
    }

    #[test]
    fn numbers_copies_like_explorer() {
        assert_eq!(numbered("photo 1", "jpg", 1), "photo 1.jpg");
        assert_eq!(numbered("photo 1", "jpg", 2), "photo 1 (2).jpg");
        assert_eq!(numbered("photo 1", "jpg", 12), "photo 1 (12).jpg");
    }

    fn scratch_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "apg-post-it-test-{label}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn never_overwrites_a_file_that_is_there() {
        let dir = scratch_dir("unique");
        let first = write_unique(&dir, "photo 1", "jpg", b"first").unwrap();
        let second = write_unique(&dir, "photo 1", "jpg", b"second").unwrap();
        let third = write_unique(&dir, "photo 1", "jpg", b"third").unwrap();

        assert_eq!(first.file_name().unwrap(), "photo 1.jpg");
        assert_eq!(second.file_name().unwrap(), "photo 1 (2).jpg");
        assert_eq!(third.file_name().unwrap(), "photo 1 (3).jpg");
        assert_eq!(std::fs::read(&first).unwrap(), b"first");
        assert_eq!(std::fs::read(&second).unwrap(), b"second");
        assert_eq!(std::fs::read(&third).unwrap(), b"third");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn skips_a_folder_that_has_the_name() {
        let dir = scratch_dir("dirname");
        std::fs::create_dir(dir.join("photo 1.jpg")).unwrap();
        let saved = write_unique(&dir, "photo 1", "jpg", b"x").unwrap();
        assert_eq!(saved.file_name().unwrap(), "photo 1 (2).jpg");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn fills_a_gap_in_the_numbering() {
        let dir = scratch_dir("gap");
        std::fs::write(dir.join("photo 1.jpg"), b"a").unwrap();
        std::fs::write(dir.join("photo 1 (3).jpg"), b"c").unwrap();
        let saved = write_unique(&dir, "photo 1", "jpg", b"b").unwrap();
        assert_eq!(saved.file_name().unwrap(), "photo 1 (2).jpg");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
