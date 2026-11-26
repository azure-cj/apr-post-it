//! `copy_photo`: one listing photo from Drive onto the clipboard, to paste
//! straight into a Facebook post with Ctrl+V (AID-245).
//!
//! The WebView can put text on the clipboard but not a JPEG, so this is
//! Rust's job. The photo is fetched exactly as `save_photos` fetches it: only
//! from Google Drive (see `hosts`), and only bytes that are a photo. It is
//! then decoded, turned the way the camera held it (a pasted bitmap carries
//! no EXIF, so Facebook could not), scaled down to Facebook's own largest
//! size, and put on the clipboard as an image. Nothing is written to disk.

use std::io::Cursor;
use std::path::Path;

use image::{imageops::FilterType, DynamicImage, ImageDecoder, ImageReader};
use tauri::image::Image;
use tauri::{AppHandle, Url};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::hosts;
use crate::photos::{self, Gate};

/// The longest side of a copied photo, in pixels: the largest Facebook keeps.
/// A 12-megapixel phone photo is about 48 MB on the clipboard at full size and
/// about 12 MB at this one. Download photos still saves full size.
pub const MAX_SIDE: u32 = 2048;

/// A photo, ready for the clipboard: RGBA pixels, row by row.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Pixels {
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Fetches the photo at `url` and puts it on the clipboard. `name` is what the
/// person sees it called ("Photo 3"), for the error messages.
#[tauri::command]
pub async fn copy_photo(app: AppHandle, name: String, url: String) -> Result<(), String> {
    let client = photos::client(hosts::check, true)?;
    let bytes = fetch_photo(&name, &url, hosts::check, &client, photos::MAX_PHOTO_BYTES).await?;
    let pixels = tauri::async_runtime::spawn_blocking(move || pixels_of(&bytes, MAX_SIDE))
        .await
        .map_err(|e| format!("Could not read \"{name}\": {e}."))?
        .map_err(|why| format!("Could not copy \"{name}\": {why}. Use Download instead."))?;
    put_on_clipboard(&app, pixels, &name)
}

/// Puts decoded pixels on the clipboard as an image. Also what
/// `images::copy_image` uses.
pub(crate) fn put_on_clipboard(app: &AppHandle, pixels: Pixels, name: &str) -> Result<(), String> {
    app.clipboard()
        .write_image(&Image::new_owned(pixels.rgba, pixels.width, pixels.height))
        .map_err(|e| format!("Could not put \"{name}\" on the clipboard: {e}."))
}

/// The photo's bytes, checked as `save_photos` checks them.
pub(crate) async fn fetch_photo(
    name: &str,
    url: &str,
    gate: Gate,
    client: &tauri_plugin_http::reqwest::Client,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    let address = Url::parse(url.trim())
        .map_err(|_| hosts::Refusal::NotAUrl)
        .and_then(|address| gate(&address).map(|()| address))
        .map_err(|refusal| format!("Refused to download \"{name}\": its address {refusal}."))?;
    photos::fetch(client, address, max_bytes)
        .await
        .map(photos::PhotoFile::into_bytes)
        .map_err(|failure| failure.describe(name, Path::new("")))
}

/// Decodes a JPEG, PNG, WebP or GIF, turns it upright, and scales it down so
/// neither side is over `max_side`. The reason, in words, when it can't.
pub(crate) fn pixels_of(bytes: &[u8], max_side: u32) -> Result<Pixels, String> {
    let kind = photos::sniff(bytes);
    if !decodes(kind) {
        return Err(match kind {
            Some(other) => format!("Post-It can't copy a .{other} photo"),
            None => "it is not a photo".to_string(),
        });
    }
    let rgba = upright(bytes, max_side)?.into_rgba8();
    let (width, height) = rgba.dimensions();
    Ok(Pixels { rgba: rgba.into_raw(), width, height })
}

/// True for the formats Post-It decodes, as `photos::sniff` names them: the
/// ones Drive serves listing photos in.
pub(crate) fn decodes(kind: Option<&str>) -> bool {
    matches!(kind, Some("jpg" | "png" | "webp" | "gif"))
}

/// Decodes a photo in a format that `decodes`, turns it upright, and scales it
/// down so neither side is over `max_side`. Also what `images::photo_data` uses.
pub(crate) fn upright(bytes: &[u8], max_side: u32) -> Result<DynamicImage, String> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let mut photo = match jpeg_pixels(bytes) {
        Some(photo) => photo,
        None => DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?,
    };
    photo.apply_orientation(orientation);
    if photo.width() > max_side || photo.height() > max_side {
        // Keeps the shape: the longer side becomes max_side.
        photo = photo.resize(max_side, max_side, FilterType::Triangle);
    }
    Ok(photo)
}

/**
 * A JPEG's pixels, by jpeg-decoder; `None` for anything else, or a JPEG it
 * can't read, which image's own decoder then tries. image's decoder
 * (zune-jpeg 0.5.15) turns some listing photos into green stripes.
 */
fn jpeg_pixels(bytes: &[u8]) -> Option<DynamicImage> {
    if !bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return None;
    }
    let mut decoder = jpeg_decoder::Decoder::new(Cursor::new(bytes));
    let pixels = decoder.decode().ok()?;
    let info = decoder.info()?;
    let (w, h) = (u32::from(info.width), u32::from(info.height));
    match info.pixel_format {
        jpeg_decoder::PixelFormat::RGB24 => image::RgbImage::from_raw(w, h, pixels).map(DynamicImage::ImageRgb8),
        jpeg_decoder::PixelFormat::L8 => image::GrayImage::from_raw(w, h, pixels).map(DynamicImage::ImageLuma8),
        jpeg_decoder::PixelFormat::L16 => {
            let wide = pixels.chunks_exact(2).map(|b| u16::from_be_bytes([b[0], b[1]])).collect();
            image::ImageBuffer::from_raw(w, h, wide).map(DynamicImage::ImageLuma16)
        }
        jpeg_decoder::PixelFormat::CMYK32 => {
            // As image did before 0.25: each ink taken off white.
            let rgb = pixels
                .chunks_exact(4)
                .flat_map(|p| {
                    let k = 255 - u32::from(p[3]);
                    [0, 1, 2].map(|i| ((255 - u32::from(p[i])) * k / 255) as u8)
                })
                .collect();
            image::RgbImage::from_raw(w, h, rgb).map(DynamicImage::ImageRgb8)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageFormat, Rgba, RgbaImage};

    #[test]
    fn reads_a_jpeg_with_jpeg_decoder_and_leaves_other_formats_to_image() {
        let jpeg = encoded(48, 32, ImageFormat::Jpeg);
        let photo = jpeg_pixels(&jpeg).expect("a JPEG").into_rgb8();
        assert_eq!((photo.width(), photo.height()), (48, 32));
        let px = photo.get_pixel(24, 16).0;
        assert!(px[0] > 170 && px[1] < 70 && px[2] < 70, "red, not green: {px:?}");
        assert!(jpeg_pixels(&encoded(4, 4, ImageFormat::Png)).is_none());
        assert_eq!(upright(&jpeg, 2000).unwrap().width(), 48);
    }

    fn encoded(width: u32, height: u32, format: ImageFormat) -> Vec<u8> {
        let photo = DynamicImage::ImageRgba8(RgbaImage::from_pixel(width, height, Rgba([200, 30, 30, 255])));
        let photo = if format == ImageFormat::Jpeg { DynamicImage::ImageRgb8(photo.into_rgb8()) } else { photo };
        let mut out = Cursor::new(Vec::new());
        photo.write_to(&mut out, format).expect("encode");
        out.into_inner()
    }

    #[test]
    fn reads_a_jpeg_and_a_png_at_their_own_size() {
        for format in [ImageFormat::Jpeg, ImageFormat::Png] {
            let pixels = pixels_of(&encoded(40, 30, format), MAX_SIDE).expect("decoded");
            assert_eq!((pixels.width, pixels.height), (40, 30));
            assert_eq!(pixels.rgba.len(), 40 * 30 * 4);
        }
    }

    #[test]
    fn scales_a_large_photo_down_keeping_its_shape() {
        let wide = pixels_of(&encoded(400, 100, ImageFormat::Png), 200).expect("decoded");
        assert_eq!((wide.width, wide.height), (200, 50));
        let tall = pixels_of(&encoded(90, 300, ImageFormat::Png), 200).expect("decoded");
        assert_eq!((tall.width, tall.height), (60, 200));
    }

    #[test]
    fn refuses_what_it_cannot_copy_saying_what_it_is() {
        let heic = [0, 0, 0, 24, b'f', b't', b'y', b'p', b'h', b'e', b'i', b'c', 0, 0, 0, 0, b'm', b'i', b'f', b'1', b'h', b'e', b'i', b'c'];
        assert_eq!(pixels_of(&heic, MAX_SIDE), Err("Post-It can't copy a .heic photo".to_string()));
        assert_eq!(pixels_of(b"<!doctype html><html>", MAX_SIDE), Err("it is not a photo".to_string()));
    }

    #[test]
    fn says_why_a_broken_photo_cannot_be_read() {
        let mut broken = encoded(40, 30, ImageFormat::Png);
        broken.truncate(60);
        assert!(pixels_of(&broken, MAX_SIDE).is_err());
    }

    #[test]
    fn refuses_an_address_that_is_not_drives_before_asking() {
        let client = photos::client(hosts::check, false).expect("client");
        let refused = tauri::async_runtime::block_on(fetch_photo(
            "Photo 1",
            "https://example.com/a.jpg",
            hosts::check,
            &client,
            1024,
        ));
        assert!(refused.unwrap_err().starts_with("Refused to download \"Photo 1\": its address "));
    }
}
