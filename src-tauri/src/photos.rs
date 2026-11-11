//! `save_photos`: a listing's photos from Drive into
//! `<Downloads>\APG Post-It\<listing>\`, ready for Facebook's upload box.
//!
//! The WebView can't write to Downloads, so this is Rust's job. It downloads only
//! from Google Drive (see `hosts`), keeps only bytes that are a photo, and never
//! replaces a file that is already there.
//!
//! A WebP photo is saved as a JPG: Facebook's upload box and most people's
//! tools take a JPG anywhere. Only the downloaded copy is converted; the file
//! on Drive is never touched. Each step is sent to the window as a
//! `photos-progress` event, so the app can say what is happening.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Url};
use tauri_plugin_http::reqwest;

use crate::{hosts, names};

/// The folder under Downloads that holds one folder per listing.
pub const DOWNLOADS_SUBFOLDER: &str = "APG Post-It";

/// More than any listing has. A request for more is a bug, not a listing.
const MAX_PHOTOS: usize = 200;
/// Listing photos are 2–5 MB. Anything near this is not a listing photo.
pub(crate) const MAX_PHOTO_BYTES: usize = 50 * 1024 * 1024;
const MAX_REDIRECTS: usize = 10;
/// Downloads at once. Enough to be quick, few enough not to look like a scraper to Drive.
const PARALLEL: usize = 4;

const USER_AGENT: &str = concat!("APG Post-It/", env!("CARGO_PKG_VERSION"));
/// A WebP saved as a JPG: high enough that Facebook's own recompression is the
/// only loss anyone sees.
const JPEG_QUALITY: u8 = 92;
/// The event each step of a save is sent as.
pub const PROGRESS_EVENT: &str = "photos-progress";

/// One photo to save: what to call it, and where Drive serves it.
#[derive(Debug, Clone, Deserialize)]
pub struct PhotoSource {
    pub name: String,
    pub url: String,
}

/// One photo saved. `name` is the name it was asked for under; `path` is the
/// file it went to, whose own name may differ (an extension added, a ` (2)`
/// when that name was taken).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SavedPhoto {
    pub name: String,
    pub path: String,
    /// True when Drive had it as a WebP and it was saved as a JPG.
    pub converted: bool,
}

/// What a save is doing, one photo at a time, for the window.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Step {
    /// A WebP has arrived and is being turned into a JPG.
    Converting,
    Saved,
    Failed,
}

/// One `photos-progress` event. `done` counts the photos finished before this
/// one, so the step is about photo `done + 1` of `total`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// The id the app gave this save, so it hears only its own.
    pub job: String,
    pub name: String,
    pub step: Step,
    pub done: usize,
    pub total: usize,
}

/// Hears each step of a save: the photo's name, the step, `done`, `total`.
pub(crate) type Report<'a> = &'a (dyn Fn(&str, Step, usize, usize) + Send + Sync);

/// Downloads each photo into `<Downloads>\APG Post-It\<listing>\` and returns
/// where each one went, in the order asked.
///
/// - Every address is checked before anything is downloaded. One that is not
///   Google Drive's refuses the whole request, and nothing is saved.
/// - A photo that fails is left out of the result; the others are still saved.
///   The caller compares counts to say "8 of 10 saved".
/// - If none could be saved, the error says why the first one failed.
#[tauri::command]
pub async fn save_photos(
    app: AppHandle,
    property: String,
    photos: Vec<PhotoSource>,
    job: Option<String>,
) -> Result<Vec<SavedPhoto>, String> {
    let downloads = app
        .path()
        .download_dir()
        .map_err(|e| format!("Could not find your Downloads folder: {e}"))?;
    let client = client(hosts::check, true)?;
    let job = job.unwrap_or_default();
    let report = move |name: &str, step: Step, done: usize, total: usize| {
        // Only for the window to show: the save goes on whether it hears or not.
        let _ = app.emit(
            PROGRESS_EVENT,
            Progress { job: job.clone(), name: name.to_string(), step, done, total },
        );
    };
    save_all(
        &downloads,
        &property,
        &photos,
        hosts::check,
        &client,
        MAX_PHOTO_BYTES,
        &report,
    )
    .await
}

/// Decides whether an address may be fetched. Production uses `hosts::check`;
/// tests use one that allows only their local server.
pub(crate) type Gate = fn(&Url) -> Result<(), hosts::Refusal>;

/// An HTTP client that follows a redirect only to an address the gate allows.
/// A redirect anywhere else is not followed; `fetch` reports where it pointed.
pub(crate) fn client(gate: Gate, system_proxy: bool) -> Result<reqwest::Client, String> {
    let policy = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() > MAX_REDIRECTS {
            attempt.error("too many redirects")
        } else if gate(attempt.url()).is_ok() {
            attempt.follow()
        } else {
            attempt.stop()
        }
    });
    let mut builder = reqwest::Client::builder()
        .redirect(policy)
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .timeout(Duration::from_secs(300));
    if !system_proxy {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|e| format!("Could not start the photo downloader: {e}"))
}

pub(crate) async fn save_all(
    downloads: &Path,
    property: &str,
    photos: &[PhotoSource],
    gate: Gate,
    client: &reqwest::Client,
    max_bytes: usize,
    report: Report<'_>,
) -> Result<Vec<SavedPhoto>, String> {
    if photos.len() > MAX_PHOTOS {
        return Err(format!(
            "Asked to save {} photos at once; the most is {MAX_PHOTOS}. Nothing was saved.",
            photos.len()
        ));
    }

    // Check every address first: one bad address means the request is wrong,
    // and half a folder of photos would hide that.
    let mut urls = Vec::with_capacity(photos.len());
    for photo in photos {
        let url = Url::parse(photo.url.trim())
            .map_err(|_| hosts::Refusal::NotAUrl)
            .and_then(|url| gate(&url).map(|()| url))
            .map_err(|refusal| {
                format!(
                    "Refused to download \"{}\": its address {refusal}. Nothing was saved.",
                    photo.name
                )
            })?;
        urls.push(url);
    }
    if photos.is_empty() {
        return Ok(Vec::new());
    }

    let folder = downloads
        .join(DOWNLOADS_SUBFOLDER)
        .join(names::safe_folder_name(property));
    // Made when the first photo has arrived, so a save where every download
    // fails leaves no empty folder behind.
    let mut folder_made = false;

    let mut saved = Vec::with_capacity(photos.len());
    let mut failures = Vec::new();
    let total = photos.len();
    let mut done = 0;

    let jobs: Vec<(&PhotoSource, Url)> = photos.iter().zip(urls).collect();
    for batch in jobs.chunks(PARALLEL) {
        let pending: Vec<_> = batch
            .iter()
            .map(|(_, url)| {
                let client = client.clone();
                let url = url.clone();
                tauri::async_runtime::spawn(async move { fetch(&client, url, max_bytes).await })
            })
            .collect();

        // Written in the order asked, so `photo 1 (2)` is always the second
        // "photo 1", whichever download finished first.
        for ((photo, _), download) in batch.iter().zip(pending) {
            let fetched = match download.await {
                Ok(result) => result,
                Err(e) => Err(Failure::Network(format!("the download stopped: {e}"))),
            };
            if fetched.is_ok() && !folder_made {
                std::fs::create_dir_all(&folder)
                    .map_err(|e| format!("Could not make the folder {}: {e}", folder.display()))?;
                folder_made = true;
            }
            let result = match fetched {
                Ok(photo_file) if photo_file.ext == "webp" => {
                    report(&photo.name, Step::Converting, done, total);
                    match as_jpeg(photo_file).await {
                        Ok(jpeg) => write(&folder, &photo.name, jpeg)
                            .await
                            .map(|path| (path, true)),
                        Err(failure) => Err(failure),
                    }
                }
                Ok(photo_file) => write(&folder, &photo.name, photo_file)
                    .await
                    .map(|path| (path, false)),
                Err(failure) => Err(failure),
            };
            match result {
                Ok((path, converted)) => {
                    saved.push(SavedPhoto {
                        name: photo.name.clone(),
                        path: path.to_string_lossy().into_owned(),
                        converted,
                    });
                    report(&photo.name, Step::Saved, done, total);
                }
                Err(failure) => {
                    failures.push(failure.describe(&photo.name, &folder));
                    report(&photo.name, Step::Failed, done, total);
                }
            }
            done += 1;
        }
    }

    if saved.is_empty() {
        let first = failures.into_iter().next().unwrap_or_default();
        return Err(if photos.len() == 1 {
            first
        } else {
            format!("None of the {} photos were saved. {first}", photos.len())
        });
    }
    Ok(saved)
}

/// A downloaded photo: its bytes and the extension they prove it has.
#[derive(Debug)]
pub(crate) struct PhotoFile {
    bytes: Vec<u8>,
    ext: &'static str,
}

impl PhotoFile {
    /// The bytes, for `copy_photo`, which decodes them rather than saving them.
    pub(crate) fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Failure {
    /// Drive sent the download to Google's sign-in page.
    SignIn,
    /// Drive sent the download on to an address that is not allowed, given as its origin.
    Redirected(String),
    Status(u16),
    /// An HTML page came back instead of a photo.
    WebPage,
    /// Bytes came back that are not a photo format we know.
    NotAPhoto(String),
    Empty,
    TooBig,
    Network(String),
    Disk(String),
    /// A WebP that could not be turned into a JPG.
    Convert(String),
}

impl Failure {
    pub(crate) fn describe(&self, name: &str, folder: &Path) -> String {
        match self {
            Failure::SignIn => format!(
                "Google asked for a sign-in before sending \"{name}\": its Drive file is not shared with \"Anyone with the link\"."
            ),
            Failure::Redirected(origin) => format!(
                "Drive sent \"{name}\" on to {origin}, which Post-It does not download from, so it was not saved."
            ),
            Failure::Status(404) => {
                format!("Drive could not find \"{name}\" (404). It may have been moved or deleted.")
            }
            Failure::Status(403) => format!(
                "Drive refused \"{name}\" (403). The file may not be shared with \"Anyone with the link\", or Drive is limiting downloads for now."
            ),
            Failure::Status(429) => format!(
                "Drive is limiting downloads right now (429). Try \"{name}\" again in a few minutes."
            ),
            Failure::Status(code) if *code >= 500 => {
                format!("Drive had a problem sending \"{name}\" ({code}). Try again.")
            }
            Failure::Status(code) => format!("Drive answered {code} for \"{name}\"."),
            Failure::WebPage => format!(
                "Drive sent a web page instead of \"{name}\", usually a sign-in or a warning about the file."
            ),
            Failure::NotAPhoto(kind) => {
                format!("\"{name}\" is not a photo ({kind}), so it was not saved.")
            }
            Failure::Empty => format!("Drive sent an empty file for \"{name}\"."),
            Failure::TooBig => format!(
                "\"{name}\" is larger than {} MB, so it was not saved.",
                MAX_PHOTO_BYTES / (1024 * 1024)
            ),
            Failure::Network(reason) => format!("Could not download \"{name}\": {reason}."),
            Failure::Convert(reason) => format!(
                "\"{name}\" is a WebP photo that could not be turned into a JPG ({reason}), so it was not saved."
            ),
            Failure::Disk(reason) => {
                format!(
                    "Could not save \"{name}\" in {}: {reason}.",
                    folder.display()
                )
            }
        }
    }
}

fn network(e: reqwest::Error) -> Failure {
    Failure::Network(if e.is_timeout() {
        "Google Drive took too long to answer".to_string()
    } else if e.is_connect() {
        "could not reach Google Drive. Check the internet connection".to_string()
    } else if e.is_redirect() {
        "Drive redirected it too many times".to_string()
    } else {
        e.to_string()
    })
}

pub(crate) async fn fetch(
    client: &reqwest::Client,
    url: Url,
    max_bytes: usize,
) -> Result<PhotoFile, Failure> {
    let mut response = client.get(url).send().await.map_err(network)?;
    let status = response.status();

    // The client stops at a redirect to a host the gate refused.
    if status.is_redirection() {
        let target = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|location| response.url().join(location).ok());
        return Err(match target {
            Some(t) if t.host_str() == Some("accounts.google.com") => Failure::SignIn,
            Some(t) => Failure::Redirected(t.origin().ascii_serialization()),
            None => Failure::Status(status.as_u16()),
        });
    }
    if !status.is_success() {
        return Err(Failure::Status(status.as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(Failure::TooBig);
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network)? {
        if bytes.len() + chunk.len() > max_bytes {
            return Err(Failure::TooBig);
        }
        bytes.extend_from_slice(&chunk);
    }

    if bytes.is_empty() {
        return Err(Failure::Empty);
    }
    match sniff(&bytes) {
        Some(ext) => Ok(PhotoFile { bytes, ext }),
        None if content_type.contains("html") || looks_like_html(&bytes) => Err(Failure::WebPage),
        None if content_type.is_empty() => Err(Failure::NotAPhoto("unknown type".to_string())),
        None => Err(Failure::NotAPhoto(content_type)),
    }
}

/// A WebP photo, as a JPG. Off the async threads: a large photo takes a moment.
async fn as_jpeg(photo: PhotoFile) -> Result<PhotoFile, Failure> {
    tauri::async_runtime::spawn_blocking(move || webp_to_jpeg(&photo.bytes))
        .await
        .map_err(|e| Failure::Convert(e.to_string()))?
        .map(|bytes| PhotoFile { bytes, ext: "jpg" })
        .map_err(Failure::Convert)
}

/// Decodes a WebP and encodes it as a JPG. A JPG can't be see-through, so any
/// transparent part is laid on white.
pub(crate) fn webp_to_jpeg(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let photo = image::load_from_memory_with_format(bytes, image::ImageFormat::WebP)
        .map_err(|e| e.to_string())?;
    let rgba = photo.into_rgba8();
    let mut rgb = image::RgbImage::new(rgba.width(), rgba.height());
    for (out, px) in rgb.pixels_mut().zip(rgba.pixels()) {
        let alpha = u32::from(px[3]);
        for c in 0..3 {
            out[c] = ((u32::from(px[c]) * alpha + 255 * (255 - alpha) + 127) / 255) as u8;
        }
    }
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY)
        .encode_image(&rgb)
        .map_err(|e| e.to_string())?;
    Ok(jpeg)
}

async fn write(folder: &Path, name: &str, photo: PhotoFile) -> Result<PathBuf, Failure> {
    let folder = folder.to_path_buf();
    let stem = names::safe_file_stem(name);
    tauri::async_runtime::spawn_blocking(move || {
        names::write_unique(&folder, &stem, photo.ext, &photo.bytes)
    })
    .await
    .map_err(|e| Failure::Disk(e.to_string()))?
    .map_err(|e| Failure::Disk(e.to_string()))
}

/// The photo format the bytes prove, as a file extension. `None` for anything
/// that is not a photo: what is saved is what Facebook will be given.
pub(crate) fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("png");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*") {
        return Some("tif");
    }
    if bytes.len() >= 26 && bytes.starts_with(b"BM") && bytes[6..10] == [0, 0, 0, 0] {
        return Some("bmp");
    }
    if bytes.len() >= 16 && &bytes[4..8] == b"ftyp" {
        let size = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
        let end = size.clamp(16, bytes.len());
        let compatible = bytes[16..end].chunks_exact(4);
        let brands: Vec<&[u8]> = std::iter::once(&bytes[8..12]).chain(compatible).collect();
        if brands.iter().any(|b| matches!(*b, b"avif" | b"avis")) {
            return Some("avif");
        }
        if brands.iter().any(|b| {
            matches!(
                *b,
                b"heic" | b"heix" | b"hevc" | b"hevx" | b"heim" | b"heis"
            )
        }) {
            return Some("heic");
        }
        if brands.iter().any(|b| matches!(*b, b"mif1" | b"msf1")) {
            return Some("heif");
        }
    }
    None
}

fn looks_like_html(bytes: &[u8]) -> bool {
    let start: Vec<u8> = bytes
        .iter()
        .skip_while(|b| b.is_ascii_whitespace())
        .take(15)
        .map(u8::to_ascii_lowercase)
        .collect();
    start.starts_with(b"<!doctype html")
        || start.starts_with(b"<html")
        || start.starts_with(b"<head")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::{TcpListener, TcpStream};

    const JPEG: &[u8] = &[
        0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, b'J', b'F', b'I', b'F', 0, 1, 0xFF, 0xD9,
    ];
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    #[test]
    fn knows_photos_by_their_bytes() {
        assert_eq!(sniff(JPEG), Some("jpg"));
        assert_eq!(sniff(PNG), Some("png"));
        assert_eq!(sniff(b"GIF89a\x01\0\x01\0"), Some("gif"));
        assert_eq!(sniff(b"RIFF\x24\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(sniff(b"\0\0\0\x18ftypheic\0\0\0\0mif1heic"), Some("heic"));
        assert_eq!(
            sniff(b"\0\0\0\x1cftypavif\0\0\0\0avifmif1miaf"),
            Some("avif")
        );
        assert_eq!(
            sniff(b"\0\0\0\x1cftypmif1\0\0\0\0mif1avifmiaf"),
            Some("avif")
        );
        assert_eq!(sniff(b"\0\0\0\x18ftypmif1\0\0\0\0mif1heic"), Some("heic"));
        assert_eq!(sniff(b"II*\0\x08\0\0\0"), Some("tif"));
    }

    #[test]
    fn refuses_what_is_not_a_photo() {
        assert_eq!(sniff(b"<!DOCTYPE html><html>"), None);
        assert_eq!(sniff(b"MZ\x90\0\x03\0\0\0"), None); // a Windows program
        assert_eq!(sniff(b"PK\x03\x04"), None); // a zip
        assert_eq!(sniff(b"%PDF-1.7"), None);
        assert_eq!(sniff(b"<svg xmlns='http://www.w3.org/2000/svg'/>"), None);
        assert_eq!(sniff(b"\0\0\0\x18ftypisom\0\0\0\0isommp41"), None); // a video
        assert_eq!(sniff(b""), None);
        assert_eq!(sniff(&[0xFF, 0xD8]), None);
    }

    #[test]
    fn recognises_a_sign_in_page() {
        assert!(looks_like_html(b"\n  <!DOCTYPE html><html lang=en>"));
        assert!(looks_like_html(b"<HTML><HEAD>"));
        assert!(!looks_like_html(JPEG));
    }

    // A local server stands in for Drive. The production gate allows only
    // Google over https, so these tests use one that allows only this server.

    fn local_only(url: &Url) -> Result<(), hosts::Refusal> {
        if url.scheme() == "http" && url.host_str() == Some("127.0.0.1") {
            Ok(())
        } else {
            Err(hosts::Refusal::NotGoogle(
                url.host_str().unwrap_or("").to_string(),
            ))
        }
    }

    struct Reply {
        status: &'static str,
        headers: Vec<(&'static str, String)>,
        body: Vec<u8>,
    }

    fn reply(port: u16, path: &str) -> Reply {
        let ok = |content_type: &str, body: &[u8]| Reply {
            status: "200 OK",
            headers: vec![("Content-Type", content_type.to_string())],
            body: body.to_vec(),
        };
        let redirect = |to: String| Reply {
            status: "302 Found",
            headers: vec![("Location", to)],
            body: Vec::new(),
        };
        match path {
            "/photo.jpg" => ok("image/jpeg", JPEG),
            "/photo.png" => ok("application/octet-stream", PNG),
            "/photo.webp" => ok("image/webp", &webp(4, 3, 255)),
            "/broken.webp" => ok("image/webp", b"RIFF\x24\0\0\0WEBPVP8 broken"),
            "/via-redirect" => redirect("/photo.png".to_string()),
            "/away" => redirect(format!("http://localhost:{port}/photo.jpg")),
            "/sign-in" => redirect(
                "https://accounts.google.com/ServiceLogin?continue=https://drive.google.com/uc"
                    .to_string(),
            ),
            "/page" => ok(
                "text/html; charset=utf-8",
                b"<!DOCTYPE html><title>Sign in</title>",
            ),
            "/page-as-octets" => ok(
                "application/octet-stream",
                b"<html><body>Sorry</body></html>",
            ),
            "/program" => ok("application/octet-stream", b"MZ\x90\0\x03\0\0\0\x04\0"),
            "/empty" => ok("image/jpeg", b""),
            "/big" => ok("image/jpeg", &[0xFF; 4096]),
            "/busy" => Reply {
                status: "429 Too Many Requests",
                headers: vec![],
                body: vec![],
            },
            _ => Reply {
                status: "404 Not Found",
                headers: vec![],
                body: b"no".to_vec(),
            },
        }
    }

    fn serve(stream: TcpStream, port: u16) {
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut request_line = String::new();
        if reader.read_line(&mut request_line).is_err() {
            return;
        }
        loop {
            let mut header = String::new();
            match reader.read_line(&mut header) {
                Ok(0) | Err(_) => break,
                Ok(_) if header == "\r\n" || header == "\n" => break,
                Ok(_) => {}
            }
        }
        let path = request_line
            .split_whitespace()
            .nth(1)
            .unwrap_or("/")
            .to_string();
        let r = reply(port, &path);
        let mut out = format!(
            "HTTP/1.1 {}\r\nContent-Length: {}\r\nConnection: close\r\n",
            r.status,
            r.body.len()
        );
        for (name, value) in r.headers {
            out.push_str(&format!("{name}: {value}\r\n"));
        }
        out.push_str("\r\n");
        let mut stream = stream;
        let _ = stream.write_all(out.as_bytes());
        let _ = stream.write_all(&r.body);
        let _ = stream.flush();
    }

    /// Starts the stand-in Drive and returns its base address.
    fn drive() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                std::thread::spawn(move || serve(stream, port));
            }
        });
        format!("http://127.0.0.1:{port}")
    }

    fn get(path: &str, max: usize) -> Result<PhotoFile, Failure> {
        let base = drive();
        let client = client(local_only, false).unwrap();
        let url = Url::parse(&format!("{base}{path}")).unwrap();
        tauri::async_runtime::block_on(fetch(&client, url, max))
    }

    #[test]
    fn downloads_a_photo() {
        let photo = get("/photo.jpg", 1024).unwrap();
        assert_eq!(photo.ext, "jpg");
        assert_eq!(photo.bytes, JPEG);
    }

    #[test]
    fn follows_a_redirect_the_gate_allows_and_trusts_the_bytes_over_the_header() {
        let photo = get("/via-redirect", 1024).unwrap();
        assert_eq!(photo.ext, "png");
    }

    #[test]
    fn does_not_follow_a_redirect_to_a_host_the_gate_refuses() {
        match get("/away", 1024).unwrap_err() {
            Failure::Redirected(origin) => {
                assert!(origin.starts_with("http://localhost:"), "{origin}")
            }
            other => panic!("expected a refused redirect, got {other:?}"),
        }
    }

    #[test]
    fn says_when_drive_wants_a_sign_in() {
        assert_eq!(get("/sign-in", 1024).unwrap_err(), Failure::SignIn);
    }

    #[test]
    fn refuses_a_web_page_whatever_it_claims_to_be() {
        assert_eq!(get("/page", 1024).unwrap_err(), Failure::WebPage);
        assert_eq!(get("/page-as-octets", 1024).unwrap_err(), Failure::WebPage);
    }

    #[test]
    fn refuses_bytes_that_are_not_a_photo() {
        assert_eq!(
            get("/program", 1024).unwrap_err(),
            Failure::NotAPhoto("application/octet-stream".into())
        );
        assert_eq!(get("/empty", 1024).unwrap_err(), Failure::Empty);
    }

    #[test]
    fn refuses_a_file_over_the_limit() {
        assert_eq!(get("/big", 1024).unwrap_err(), Failure::TooBig);
    }

    #[test]
    fn reports_drive_errors() {
        assert_eq!(get("/missing", 1024).unwrap_err(), Failure::Status(404));
        assert_eq!(get("/busy", 1024).unwrap_err(), Failure::Status(429));
    }

    fn scratch_downloads(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "apg-post-it-downloads-{label}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn photo(name: &str, url: String) -> PhotoSource {
        PhotoSource {
            name: name.into(),
            url,
        }
    }

    fn save(
        downloads: &Path,
        property: &str,
        photos: &[PhotoSource],
    ) -> Result<Vec<SavedPhoto>, String> {
        save_reporting(downloads, property, photos, &|_, _, _, _| {})
    }

    fn save_reporting(
        downloads: &Path,
        property: &str,
        photos: &[PhotoSource],
        report: Report<'_>,
    ) -> Result<Vec<SavedPhoto>, String> {
        let client = client(local_only, false).unwrap();
        tauri::async_runtime::block_on(save_all(
            downloads, property, photos, local_only, &client, 1024, report,
        ))
    }

    /// A real WebP, lossless, of one red at this opacity.
    fn webp(width: u32, height: u32, alpha: u8) -> Vec<u8> {
        let rgba = image::RgbaImage::from_pixel(width, height, image::Rgba([220, 20, 20, alpha]));
        let mut out = Vec::new();
        image::codecs::webp::WebPEncoder::new_lossless(&mut out)
            .encode(rgba.as_raw(), width, height, image::ExtendedColorType::Rgba8)
            .unwrap();
        out
    }

    #[test]
    fn saves_a_webp_as_a_jpg_and_says_it_is_converting() {
        let base = drive();
        let downloads = scratch_downloads("webp");
        let photos = [
            photo("photo 1", format!("{base}/photo.jpg")),
            photo("photo 2", format!("{base}/photo.webp")),
        ];
        let steps = std::sync::Mutex::new(Vec::new());
        let saved = save_reporting(&downloads, "Lot 7", &photos, &|name, step, done, total| {
            steps.lock().unwrap().push((name.to_string(), step, done, total));
        })
        .unwrap();

        let folder = downloads.join("APG Post-It").join("Lot 7");
        assert_eq!(saved[0].path, folder.join("photo 1.jpg").to_string_lossy());
        assert!(!saved[0].converted);
        assert_eq!(saved[1].path, folder.join("photo 2.jpg").to_string_lossy());
        assert!(saved[1].converted);
        let jpg = std::fs::read(folder.join("photo 2.jpg")).unwrap();
        assert_eq!(sniff(&jpg), Some("jpg"));
        let decoded = image::load_from_memory(&jpg).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (4, 3));
        assert!(!folder.join("photo 2.webp").exists());
        assert_eq!(
            *steps.lock().unwrap(),
            [
                ("photo 1".to_string(), Step::Saved, 0, 2),
                ("photo 2".to_string(), Step::Converting, 1, 2),
                ("photo 2".to_string(), Step::Saved, 1, 2),
            ]
        );
        std::fs::remove_dir_all(&downloads).unwrap();
    }

    #[test]
    fn lays_a_see_through_webp_on_white() {
        let jpg = webp_to_jpeg(&webp(8, 8, 0)).unwrap();
        let px = image::load_from_memory(&jpg).unwrap().into_rgb8();
        let p = px.get_pixel(0, 0);
        assert!(p[0] > 245 && p[1] > 245 && p[2] > 245, "{p:?}");
    }

    #[test]
    fn says_why_a_broken_webp_was_not_saved_and_saves_the_rest() {
        let base = drive();
        let downloads = scratch_downloads("broken-webp");
        let photos = [
            photo("photo 1", format!("{base}/broken.webp")),
            photo("photo 2", format!("{base}/photo.png")),
        ];
        let steps = std::sync::Mutex::new(Vec::new());
        let saved = save_reporting(&downloads, "Lot 7", &photos, &|name, step, _, _| {
            steps.lock().unwrap().push((name.to_string(), step));
        })
        .unwrap();
        assert_eq!(
            saved.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            ["photo 2"]
        );
        assert_eq!(
            *steps.lock().unwrap(),
            [
                ("photo 1".to_string(), Step::Converting),
                ("photo 1".to_string(), Step::Failed),
                ("photo 2".to_string(), Step::Saved),
            ]
        );
        let alone = save(&downloads, "Lot 8", &photos[..1]).unwrap_err();
        assert!(
            alone.starts_with("\"photo 1\" is a WebP photo that could not be turned into a JPG ("),
            "{alone}"
        );
        std::fs::remove_dir_all(&downloads).unwrap();
    }

    #[test]
    fn saves_into_a_safe_folder_named_after_the_listing_in_the_order_asked() {
        let base = drive();
        let downloads = scratch_downloads("order");
        let photos: Vec<_> = (1..=6)
            .map(|i| {
                photo(
                    &format!("photo {i}"),
                    format!(
                        "{base}/{}",
                        if i % 2 == 0 { "photo.png" } else { "photo.jpg" }
                    ),
                )
            })
            .collect();

        let saved = save(&downloads, "FOR LEASE/ FOR RENT, *Taguig*", &photos).unwrap();

        let folder = downloads
            .join("APG Post-It")
            .join("FOR LEASE_ FOR RENT, _Taguig_");
        let names: Vec<_> = saved.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "photo 1", "photo 2", "photo 3", "photo 4", "photo 5", "photo 6"
            ]
        );
        assert_eq!(saved[0].path, folder.join("photo 1.jpg").to_string_lossy());
        assert_eq!(saved[1].path, folder.join("photo 2.png").to_string_lossy());
        assert_eq!(std::fs::read(folder.join("photo 1.jpg")).unwrap(), JPEG);
        std::fs::remove_dir_all(&downloads).unwrap();
    }

    #[test]
    fn saving_again_adds_copies_instead_of_replacing() {
        let base = drive();
        let downloads = scratch_downloads("again");
        let photos = [
            photo("photo 1", format!("{base}/photo.jpg")),
            photo("photo 1", format!("{base}/photo.jpg")),
        ];

        let first = save(&downloads, "Lot 7", &photos).unwrap();
        let second = save(&downloads, "Lot 7", &photos[..1]).unwrap();

        let file = |s: &SavedPhoto| {
            Path::new(&s.path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        };
        assert_eq!(
            first.iter().map(file).collect::<Vec<_>>(),
            ["photo 1.jpg", "photo 1 (2).jpg"]
        );
        assert_eq!(file(&second[0]), "photo 1 (3).jpg");
        std::fs::remove_dir_all(&downloads).unwrap();
    }

    #[test]
    fn refuses_the_whole_request_when_one_address_is_not_allowed() {
        let base = drive();
        let downloads = scratch_downloads("refused");
        let photos = [
            photo("photo 1", format!("{base}/photo.jpg")),
            photo("photo 2", "https://example.com/photo.jpg".into()),
        ];

        let error = save(&downloads, "Lot 7", &photos).unwrap_err();

        assert!(error.contains("\"photo 2\""), "{error}");
        assert!(error.contains("example.com"), "{error}");
        assert!(error.ends_with("Nothing was saved."), "{error}");
        assert!(!downloads.join("APG Post-It").exists());
        std::fs::remove_dir_all(&downloads).unwrap();
    }

    #[test]
    fn keeps_the_photos_that_worked_when_some_fail() {
        let base = drive();
        let downloads = scratch_downloads("partial");
        let photos = [
            photo("photo 1", format!("{base}/photo.jpg")),
            photo("photo 2", format!("{base}/missing")),
            photo("photo 3", format!("{base}/photo.png")),
        ];

        let saved = save(&downloads, "Lot 7", &photos).unwrap();

        assert_eq!(
            saved.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            ["photo 1", "photo 3"]
        );
        std::fs::remove_dir_all(&downloads).unwrap();
    }

    #[test]
    fn says_why_when_nothing_could_be_saved() {
        let base = drive();
        let downloads = scratch_downloads("none");

        let one = save(
            &downloads,
            "Lot 7",
            &[photo("photo 1", format!("{base}/sign-in"))],
        )
        .unwrap_err();
        assert!(
            one.starts_with("Google asked for a sign-in before sending \"photo 1\""),
            "{one}"
        );

        let two = save(
            &downloads,
            "Lot 7",
            &[
                photo("photo 1", format!("{base}/page")),
                photo("photo 2", format!("{base}/page")),
            ],
        )
        .unwrap_err();
        assert!(
            two.starts_with("None of the 2 photos were saved. Drive sent a web page"),
            "{two}"
        );
        assert!(
            !downloads.join("APG Post-It").exists(),
            "no empty folder is left behind"
        );
        std::fs::remove_dir_all(&downloads).unwrap();
    }

    #[test]
    fn an_empty_request_saves_nothing_and_makes_no_folder() {
        let downloads = scratch_downloads("empty");
        assert_eq!(save(&downloads, "Lot 7", &[]).unwrap(), Vec::new());
        assert!(!downloads.join("APG Post-It").exists());
        std::fs::remove_dir_all(&downloads).unwrap();
    }

    #[test]
    fn the_production_gate_refuses_this_test_server() {
        let base = drive();
        let downloads = scratch_downloads("production-gate");
        let client = client(hosts::check, false).unwrap();
        let photos = [photo("photo 1", format!("{base}/photo.jpg"))];
        let error = tauri::async_runtime::block_on(save_all(
            &downloads,
            "Lot 7",
            &photos,
            hosts::check,
            &client,
            1024,
            &|_, _, _, _| {},
        ))
        .unwrap_err();
        assert!(error.contains("is not an https:// address"), "{error}");
        std::fs::remove_dir_all(&downloads).unwrap();
    }
}
