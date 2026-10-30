//! Where a photo may be downloaded from: Google Drive, and nowhere else.
//!
//! The directory gives each photo as `https://drive.google.com/uc?export=download&id=…`.
//! Drive answers that with a redirect to `drive.usercontent.google.com`, or for some
//! files a `*.googleusercontent.com` host, so those are allowed too. Every hop of a
//! redirect is checked against the same list, so an allowed address cannot hand the
//! download on to anywhere else.

use tauri::Url;

/// For messages: the hosts a photo may come from.
pub const ALLOWED_HOSTS: &str =
    "drive.google.com, drive.usercontent.google.com, *.googleusercontent.com";

/// Why an address was refused, as a phrase that finishes "…because it ".
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    NotAUrl,
    NotHttps,
    HasCredentials,
    HasPort,
    NotGoogle(String),
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Refusal::NotAUrl => write!(f, "is not a web address"),
            Refusal::NotHttps => write!(f, "is not an https:// address"),
            Refusal::HasCredentials => write!(f, "carries a user name or password"),
            Refusal::HasPort => write!(f, "names a port"),
            Refusal::NotGoogle(host) => {
                write!(
                    f,
                    "points to {host}, and photos may only come from {ALLOWED_HOSTS}"
                )
            }
        }
    }
}

/// True for a host Drive serves photo bytes from.
pub fn is_allowed_host(host: &str) -> bool {
    const USERCONTENT: &str = ".googleusercontent.com";
    if host == "drive.google.com" || host == "drive.usercontent.google.com" {
        return true;
    }
    match host.strip_suffix(USERCONTENT) {
        // At least one label before the suffix, and no empty ones.
        Some(prefix) => !prefix.is_empty() && prefix.split('.').all(|label| !label.is_empty()),
        None => false,
    }
}

/// Accepts an address only if a photo may be downloaded from it.
pub fn check(url: &Url) -> Result<(), Refusal> {
    if url.scheme() != "https" {
        return Err(Refusal::NotHttps);
    }
    // `domain()` is `None` for an IP address, which Drive never hands out.
    match url.domain() {
        Some(host) if is_allowed_host(host) => {}
        Some(host) => return Err(Refusal::NotGoogle(host.to_string())),
        None => {
            let host = url.host_str().unwrap_or("no host").to_string();
            return Err(Refusal::NotGoogle(host));
        }
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(Refusal::HasCredentials);
    }
    // `port()` is `None` for the scheme's default, so only an explicit
    // non-default port is caught here.
    if url.port().is_some() {
        return Err(Refusal::HasPort);
    }
    Ok(())
}

/// Parses a photo address and accepts it only if a photo may come from it.
#[cfg(test)]
pub fn parse(raw: &str) -> Result<Url, Refusal> {
    let url = Url::parse(raw.trim()).map_err(|_| Refusal::NotAUrl)?;
    check(&url)?;
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(raw: &str) -> bool {
        parse(raw).is_ok()
    }

    #[test]
    fn allows_the_drive_download_link_the_directory_writes() {
        assert!(allowed(
            "https://drive.google.com/uc?export=download&id=1AbC_dEf-123"
        ));
    }

    #[test]
    fn allows_where_drive_redirects_a_download() {
        assert!(allowed(
            "https://drive.usercontent.google.com/download?id=1AbC&export=download"
        ));
        assert!(allowed(
            "https://doc-0s-8c-docs.googleusercontent.com/docs/securesc/abc/def"
        ));
        assert!(allowed("https://lh3.googleusercontent.com/d/1AbC=w640"));
    }

    #[test]
    fn is_not_fooled_by_case_or_a_default_port() {
        assert!(allowed("HTTPS://DRIVE.GOOGLE.COM/uc?id=1"));
        assert!(allowed("https://drive.google.com:443/uc?id=1"));
    }

    #[test]
    fn refuses_other_hosts() {
        assert_eq!(
            parse("https://example.com/photo.jpg"),
            Err(Refusal::NotGoogle("example.com".into()))
        );
        assert!(!allowed("https://google.com/uc?id=1"));
        assert!(!allowed("https://www.google.com/url?q=https://example.com"));
        assert!(!allowed("https://docs.google.com/uc?id=1"));
        assert!(!allowed("https://accounts.google.com/ServiceLogin"));
        assert!(!allowed("https://script.google.com/macros/s/x/exec"));
        assert!(!allowed("https://googleusercontent.com/x"));
        assert!(!allowed("https://drive.google.com.evil.com/uc?id=1"));
        assert!(!allowed("https://evilgoogleusercontent.com/x"));
        assert!(!allowed("https://googleusercontent.com.evil.com/x"));
        assert!(!allowed("https://drive-google.com/uc?id=1"));
        assert!(!allowed("https://drive.google.com./uc?id=1"));
    }

    #[test]
    fn refuses_anything_but_https() {
        assert_eq!(
            parse("http://drive.google.com/uc?id=1"),
            Err(Refusal::NotHttps)
        );
        assert_eq!(parse("file:///C:/Windows/win.ini"), Err(Refusal::NotHttps));
        assert_eq!(parse("ftp://drive.google.com/x"), Err(Refusal::NotHttps));
        assert_eq!(parse("javascript:alert(1)"), Err(Refusal::NotHttps));
    }

    #[test]
    fn refuses_tricks_that_hide_the_real_host() {
        assert_eq!(
            parse("https://drive.google.com@example.com/x"),
            Err(Refusal::NotGoogle("example.com".into()))
        );
        assert_eq!(
            parse("https://user:pass@drive.google.com/x"),
            Err(Refusal::HasCredentials)
        );
        assert_eq!(
            parse("https://drive.google.com:8443/x"),
            Err(Refusal::HasPort)
        );
        assert!(!allowed("https://142.250.4.100/uc?id=1"));
        assert!(!allowed("https://[::1]/x"));
        assert!(!allowed("https://localhost/x"));
    }

    #[test]
    fn refuses_what_is_not_an_address() {
        assert_eq!(parse(""), Err(Refusal::NotAUrl));
        assert_eq!(parse("drive.google.com/uc?id=1"), Err(Refusal::NotAUrl));
        assert_eq!(parse("photo 1"), Err(Refusal::NotAUrl));
    }

    #[test]
    fn refuses_empty_labels_before_the_suffix() {
        assert!(!is_allowed_host(".googleusercontent.com"));
        assert!(!is_allowed_host("a..googleusercontent.com"));
        assert!(is_allowed_host("a.b.googleusercontent.com"));
    }
}
