//! The person's key, kept by the OS and never by the WebView or a plain file.
//!
//! Windows: a generic credential in Credential Manager, named `key.APG Post-It`
//! (Control Panel → Credential Manager → Windows Credentials). macOS: the login
//! Keychain. Linux: the Secret Service. The key never touches disk in the clear,
//! and the WebView only sees it when it asks for it to call the backend.

use keyring::{Entry, Error};

/// The credential's service and user. On Windows they make the name `key.APG Post-It`.
const SERVICE: &str = "APG Post-It";
const USER: &str = "key";

/// Longer than any key the backend hands out, and inside what every store accepts
/// (Windows keeps at most 2,560 bytes, as UTF-16).
pub const MAX_KEY_CHARS: usize = 512;

/// The saved key, or `None` if this person has not entered one on this PC.
#[tauri::command]
pub async fn read_key() -> Result<Option<String>, String> {
    run(|| match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(describe("read", &e)),
    })
    .await
}

/// Saves the key, replacing any before it. An empty key removes it: signing out.
#[tauri::command]
pub async fn write_key(key: String) -> Result<(), String> {
    let key = normalise(&key)?;
    run(move || {
        let entry = entry()?;
        match key {
            Some(key) => entry.set_password(&key).map_err(|e| describe("save", &e)),
            None => match entry.delete_credential() {
                Ok(()) | Err(Error::NoEntry) => Ok(()),
                Err(e) => Err(describe("remove", &e)),
            },
        }
    })
    .await
}

/// What will be stored: the key without the spaces and line breaks a paste brings
/// along, or `None` for "remove it". Whether it is a key the backend knows is
/// for the backend to say.
pub fn normalise(key: &str) -> Result<Option<String>, String> {
    let key = key.trim();
    if key.is_empty() {
        return Ok(None);
    }
    if key.chars().count() > MAX_KEY_CHARS {
        return Err(format!(
            "That is too long to be a key (the most is {MAX_KEY_CHARS} characters). Check what was pasted."
        ));
    }
    if key.chars().any(char::is_control) {
        return Err("A key is one line of text. Check what was pasted.".to_string());
    }
    Ok(Some(key.to_string()))
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, USER).map_err(|e| describe("open", &e))
}

fn describe(action: &str, error: &Error) -> String {
    let store = if cfg!(windows) {
        "Windows Credential Manager"
    } else if cfg!(target_os = "macos") {
        "the Keychain"
    } else {
        "the system keyring"
    };
    match error {
        Error::NoStorageAccess(_) => {
            format!("Could not {action} your key: {store} is locked or refused access ({error}).")
        }
        Error::NoDefaultStore => {
            format!("Could not {action} your key: {store} is not available on this computer.")
        }
        _ => format!("Could not {action} your key in {store}: {error}."),
    }
}

/// Credential stores block, and on macOS can wait on a prompt, so they run off
/// the thread that drives the window.
async fn run<T, F>(job: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| format!("Could not reach the credential store: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_what_a_paste_brings_along() {
        assert_eq!(
            normalise("  abc123\r\n").unwrap(),
            Some("abc123".to_string())
        );
    }

    #[test]
    fn an_empty_key_means_remove_it() {
        assert_eq!(normalise("").unwrap(), None);
        assert_eq!(normalise(" \n\t ").unwrap(), None);
    }

    #[test]
    fn refuses_what_cannot_be_a_key() {
        assert!(normalise(&"k".repeat(MAX_KEY_CHARS + 1)).is_err());
        assert!(normalise("abc\ndef").is_err());
        assert!(normalise("abc\u{0}def").is_err());
        assert_eq!(
            normalise(&"k".repeat(MAX_KEY_CHARS))
                .unwrap()
                .map(|k| k.len()),
            Some(MAX_KEY_CHARS)
        );
    }
}
