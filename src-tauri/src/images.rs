//! Pictures for the flyer (docs/mockups/flyer.html). The page draws each
//! flyer page on a canvas; these do what the WebView can't.
//!
//! - `photo_data`: a listing photo from Drive, as JPEG bytes the page makes a
//!   `data:` address of. Drive sends none of the headers that would let a page
//!   read its photos into a canvas, so a canvas they were drawn on could never
//!   be saved. Fetched exactly as `copy_photo` fetches it, turned upright,
//!   scaled to 2000 px at most, and made a JPG whatever Drive had it as.
//! - `copy_image`: a PNG the page made, onto the clipboard as an image.
//! - `save_images`: PNGs the page made, into the listing's photo folder,
//!   replacing files of the same name: a flyer made again is the newest flyer,
//!   not a copy.
//!
//! PNGs arrive as raw bytes (Tauri's `InvokeBody::Raw`), not inside JSON: one
//! line of JSON saying what they are, a newline, then the PNGs back to back
//! (src/platform/tauri.ts `framed`). As base64 in JSON, a 3 MB page would be
//! 4 MB of text to make and parse.

use std::borrow::Cow;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Deserialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

use crate::{copy_photo, hosts, names, photos};

/// The longest side of a photo for the flyer, in pixels: more than a 1080 ×
/// 1350 page needs, even for a photo cropped to fill it.
pub const PHOTO_MAX_SIDE: u32 = 2000;
/// High enough not to show on the page, low enough to keep a page of photos light.
const PHOTO_QUALITY: u8 = 88;
/// More than any flyer has. A request for more is a bug, not a flyer.
const MAX_IMAGES: usize = 100;

/// Fetches the photo at `url` and answers with it as a JPG, as raw bytes (an
/// ArrayBuffer in the page). `name` is what the person sees it called
/// ("Photo 3"), for the error messages.
#[tauri::command]
pub async fn photo_data(name: String, url: String) -> Result<Response, String> {
    let client = photos::client(hosts::check, true)?;
    let bytes = copy_photo::fetch_photo(&name, &url, hosts::check, &client, photos::MAX_PHOTO_BYTES).await?;
    let jpeg = tauri::async_runtime::spawn_blocking(move || jpeg_of(&bytes, PHOTO_MAX_SIDE))
        .await
        .map_err(|e| format!("Could not read \"{name}\": {e}."))?
        .map_err(|why| format!("Could not read \"{name}\": {why}."))?;
    Ok(Response::new(jpeg))
}

/// Puts one PNG on the clipboard. Sent framed: `{"name":"Flyer 1"}`, then the PNG.
#[tauri::command]
pub async fn copy_image(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let unreadable = |why: String| format!("Could not copy the image: {why}.");
    let body = body_of(&request).map_err(unreadable)?;
    let (CopyHead { name }, png) = unframe::<CopyHead>(&body).map_err(unreadable)?;
    if photos::sniff(png) != Some("png") {
        return Err(format!("Could not copy \"{name}\": it is not a PNG image."));
    }
    let png = png.to_vec();
    let pixels = tauri::async_runtime::spawn_blocking(move || copy_photo::pixels_of(&png, copy_photo::MAX_SIDE))
        .await
        .map_err(|e| format!("Could not copy \"{name}\": {e}."))?
        .map_err(|why| format!("Could not copy \"{name}\": {why}."))?;
    copy_photo::put_on_clipboard(&app, pixels, &name)
}

/// Saves PNGs into `<Downloads>\APG Post-It\<listing>\` and answers with that
/// folder. Sent framed: `{"property":"Lot 7","images":[{"name":"Flyer 1.png",
/// "size":123456},…]}`, then each PNG in that order.
#[tauri::command]
pub async fn save_images(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let downloads = app
        .path()
        .download_dir()
        .map_err(|e| format!("Could not find your Downloads folder: {e}"))?;
    let body = body_of(&request)
        .map_err(|why| format!("Could not save the images: {why}."))?
        .into_owned();
    tauri::async_runtime::spawn_blocking(move || save_framed(&downloads, &body))
        .await
        .map_err(|e| format!("Could not save the images: {e}."))?
        .map(|folder| folder.to_string_lossy().into_owned())
}

#[derive(Debug, Deserialize)]
struct CopyHead {
    name: String,
}

#[derive(Debug, Deserialize)]
struct SaveHead {
    property: String,
    images: Vec<ImageHead>,
}

#[derive(Debug, Deserialize)]
struct ImageHead {
    name: String,
    /// The PNG's length in bytes.
    size: usize,
}

/// A photo as a JPG for the flyer: upright, neither side over `max_side`, and
/// anything see-through laid on white. The reason, in words, when it can't.
pub(crate) fn jpeg_of(bytes: &[u8], max_side: u32) -> Result<Vec<u8>, String> {
    let kind = photos::sniff(bytes);
    if !copy_photo::decodes(kind) {
        return Err(match kind {
            Some(other) => format!("Post-It can't read a .{other} photo"),
            None => "it is not a photo".to_string(),
        });
    }
    let photo = copy_photo::upright(bytes, max_side)?;
    photos::jpeg_on_white(&photo.into_rgba8(), PHOTO_QUALITY)
}

/// What `save_images` does once it has the bytes, apart from the window so it
/// can be tested.
pub(crate) fn save_framed(downloads: &Path, body: &[u8]) -> Result<PathBuf, String> {
    let unreadable = |why: String| format!("Could not save the images: {why}.");
    let (head, rest) = unframe::<SaveHead>(body).map_err(unreadable)?;
    let sizes: Vec<usize> = head.images.iter().map(|image| image.size).collect();
    let pngs = split(rest, &sizes).map_err(unreadable)?;
    let images: Vec<(&str, &[u8])> = head
        .images
        .iter()
        .map(|image| image.name.as_str())
        .zip(pngs)
        .collect();
    save_all(downloads, &head.property, &images)
}

/// Writes each PNG, named after its name (made safe as a photo's is, `.png`
/// always), into the folder `save_photos` uses for `property`, replacing a
/// file of the same name. Every image is checked first: a bad one saves none.
pub(crate) fn save_all(downloads: &Path, property: &str, images: &[(&str, &[u8])]) -> Result<PathBuf, String> {
    if images.is_empty() {
        return Err("There were no images to save.".to_string());
    }
    if images.len() > MAX_IMAGES {
        return Err(format!(
            "Asked to save {} images at once; the most is {MAX_IMAGES}. Nothing was saved.",
            images.len()
        ));
    }
    let mut files: Vec<(&str, String, &[u8])> = Vec::with_capacity(images.len());
    for &(name, png) in images {
        if photos::sniff(png) != Some("png") {
            return Err(format!("\"{name}\" is not a PNG image, so nothing was saved."));
        }
        let stem = names::safe_file_stem(name);
        // Windows names ignore case: "flyer 1" would replace "Flyer 1".
        if let Some((first, ..)) = files.iter().find(|(_, other, _)| other.to_lowercase() == stem.to_lowercase()) {
            return Err(format!(
                "\"{first}\" and \"{name}\" would both be saved as {stem}.png, so nothing was saved."
            ));
        }
        files.push((name, stem, png));
    }

    let folder = downloads
        .join(photos::DOWNLOADS_SUBFOLDER)
        .join(names::safe_folder_name(property));
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("Could not make the folder {}: {e}", folder.display()))?;
    for (name, stem, png) in files {
        names::write_replacing(&folder, &stem, "png", png)
            .map_err(|e| format!("Could not save \"{name}\" in {}: {e}.", folder.display()))?;
    }
    Ok(folder)
}

/// The bytes a command was sent: raw over Tauri's own protocol, or a JSON
/// array of numbers where the WebView had to fall back to postMessage.
fn body_of<'a>(request: &'a Request<'_>) -> Result<Cow<'a, [u8]>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(Cow::Borrowed(bytes)),
        InvokeBody::Json(value) => Vec::<u8>::deserialize(value)
            .map(Cow::Owned)
            .map_err(|_| "they arrived as JSON, not as bytes".to_string()),
    }
}

/// Splits a framed body into the line of JSON that says what the bytes are,
/// and the bytes. The page's JSON is on one line: JSON writes a newline inside
/// a string as `\n`.
fn unframe<T: DeserializeOwned>(body: &[u8]) -> Result<(T, &[u8]), String> {
    let end = body
        .iter()
        .position(|&b| b == b'\n')
        .ok_or_else(|| "they arrived without saying what they are".to_string())?;
    let head = serde_json::from_slice(&body[..end])
        .map_err(|e| format!("what they are could not be read ({e})"))?;
    Ok((head, &body[end + 1..]))
}

/// The bytes cut into parts of these sizes, which must use every byte.
fn split<'a>(mut rest: &'a [u8], sizes: &[usize]) -> Result<Vec<&'a [u8]>, String> {
    let mut parts = Vec::with_capacity(sizes.len());
    for &size in sizes {
        if size > rest.len() {
            return Err("they arrived incomplete".to_string());
        }
        let (part, after) = rest.split_at(size);
        parts.push(part);
        rest = after;
    }
    if rest.is_empty() {
        Ok(parts)
    } else {
        Err("more arrived than was said".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
    use std::io::Cursor;

    fn encoded(width: u32, height: u32, alpha: u8, format: ImageFormat) -> Vec<u8> {
        let photo = DynamicImage::ImageRgba8(RgbaImage::from_pixel(width, height, Rgba([200, 30, 30, alpha])));
        let photo = if format == ImageFormat::Jpeg { DynamicImage::ImageRgb8(photo.into_rgb8()) } else { photo };
        let mut out = Cursor::new(Vec::new());
        photo.write_to(&mut out, format).expect("encode");
        out.into_inner()
    }

    fn decoded(jpeg: &[u8]) -> DynamicImage {
        assert_eq!(photos::sniff(jpeg), Some("jpg"));
        image::load_from_memory_with_format(jpeg, ImageFormat::Jpeg).expect("a JPEG")
    }

    #[test]
    fn makes_a_jpeg_of_a_png_scaled_so_its_longest_side_fits() {
        let wide = decoded(&jpeg_of(&encoded(300, 120, 255, ImageFormat::Png), 200).unwrap());
        assert_eq!((wide.width(), wide.height()), (200, 80));
        let tall = decoded(&jpeg_of(&encoded(90, 300, 255, ImageFormat::Png), 200).unwrap());
        assert_eq!((tall.width(), tall.height()), (60, 200));
    }

    #[test]
    fn leaves_a_photo_that_fits_at_its_own_size() {
        let jpeg = decoded(&jpeg_of(&encoded(40, 30, 255, ImageFormat::Jpeg), PHOTO_MAX_SIDE).unwrap());
        assert_eq!((jpeg.width(), jpeg.height()), (40, 30));
    }

    #[test]
    fn lays_what_is_see_through_on_white() {
        let jpeg = decoded(&jpeg_of(&encoded(16, 16, 0, ImageFormat::Png), PHOTO_MAX_SIDE).unwrap());
        let px = jpeg.to_rgb8().get_pixel(8, 8).0;
        assert!(px.iter().all(|&c| c > 245), "{px:?}");
    }

    #[test]
    fn says_what_it_cannot_read() {
        let heic = b"\0\0\0\x18ftypheic\0\0\0\0mif1heic";
        assert_eq!(jpeg_of(heic, PHOTO_MAX_SIDE), Err("Post-It can't read a .heic photo".to_string()));
        assert_eq!(jpeg_of(b"<html>", PHOTO_MAX_SIDE), Err("it is not a photo".to_string()));
        let mut broken = encoded(40, 30, 255, ImageFormat::Png);
        broken.truncate(60);
        assert!(jpeg_of(&broken, PHOTO_MAX_SIDE).is_err());
    }

    fn framed(head: &str, parts: &[&[u8]]) -> Vec<u8> {
        let mut body = format!("{head}\n").into_bytes();
        for part in parts {
            body.extend_from_slice(part);
        }
        body
    }

    #[test]
    fn reads_a_framed_body() {
        let body = framed(r#"{"name":"Flyer\n1"}"#, &[b"\x89PNG\n\x1a\nrest"]);
        let (head, bytes) = unframe::<CopyHead>(&body).unwrap();
        assert_eq!(head.name, "Flyer\n1");
        assert_eq!(bytes, b"\x89PNG\n\x1a\nrest");
    }

    #[test]
    fn says_when_a_body_is_not_framed() {
        assert!(unframe::<CopyHead>(b"\x89PNG").unwrap_err().contains("without saying"));
        assert!(unframe::<CopyHead>(b"{\"nom\":1}\nx").unwrap_err().starts_with("what they are could not be read"));
    }

    #[test]
    fn cuts_the_bytes_by_the_sizes_given_and_checks_they_add_up() {
        assert_eq!(split(b"aabbb", &[2, 3]).unwrap(), [&b"aa"[..], &b"bbb"[..]]);
        assert_eq!(split(b"", &[]).unwrap(), Vec::<&[u8]>::new());
        assert_eq!(split(b"aab", &[2, 3]).unwrap_err(), "they arrived incomplete");
        assert_eq!(split(b"aabbbc", &[2, 3]).unwrap_err(), "more arrived than was said");
    }

    fn scratch_downloads(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("apg-post-it-images-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn saves_each_png_into_the_listings_photo_folder_replacing_the_last_flyer() {
        let downloads = scratch_downloads("save");
        let one = encoded(4, 5, 255, ImageFormat::Png);
        let two = encoded(5, 4, 255, ImageFormat::Png);
        let head = format!(
            r#"{{"property":"FOR LEASE/ Lot 7","images":[{{"name":"Flyer 1.png","size":{}}},{{"name":"Flyer/2","size":{}}}]}}"#,
            one.len(),
            two.len()
        );

        let folder = save_framed(&downloads, &framed(&head, &[&one, &two])).unwrap();
        assert_eq!(folder, downloads.join("APG Post-It").join("FOR LEASE_ Lot 7"));
        assert_eq!(std::fs::read(folder.join("Flyer 1.png")).unwrap(), one);
        assert_eq!(std::fs::read(folder.join("Flyer_2.png")).unwrap(), two);

        let again = save_all(&downloads, "FOR LEASE/ Lot 7", &[("Flyer 1.png", two.as_slice())]).unwrap();
        assert_eq!(again, folder);
        assert_eq!(std::fs::read(folder.join("Flyer 1.png")).unwrap(), two);
        assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 2);
        std::fs::remove_dir_all(&downloads).unwrap();
    }

    #[test]
    fn saves_nothing_and_makes_no_folder_when_one_image_is_wrong() {
        let downloads = scratch_downloads("refuse");
        let png = encoded(4, 4, 255, ImageFormat::Png);
        let jpeg = encoded(4, 4, 255, ImageFormat::Jpeg);

        assert_eq!(
            save_all(&downloads, "Lot 7", &[("Flyer 1", png.as_slice()), ("Flyer 2", jpeg.as_slice())]).unwrap_err(),
            "\"Flyer 2\" is not a PNG image, so nothing was saved."
        );
        assert_eq!(
            save_all(&downloads, "Lot 7", &[("Flyer 1.png", png.as_slice()), ("flyer 1", png.as_slice())]).unwrap_err(),
            "\"Flyer 1.png\" and \"flyer 1\" would both be saved as flyer 1.png, so nothing was saved."
        );
        assert_eq!(save_all(&downloads, "Lot 7", &[]).unwrap_err(), "There were no images to save.");
        assert!(!downloads.join("APG Post-It").exists());
        std::fs::remove_dir_all(&downloads).unwrap();
    }

    #[test]
    fn says_when_the_images_did_not_arrive_whole() {
        let downloads = scratch_downloads("short");
        let body = framed(r#"{"property":"Lot 7","images":[{"name":"Flyer 1","size":99}]}"#, &[b"\x89PNG"]);
        assert_eq!(
            save_framed(&downloads, &body).unwrap_err(),
            "Could not save the images: they arrived incomplete."
        );
        std::fs::remove_dir_all(&downloads).unwrap();
    }
}
