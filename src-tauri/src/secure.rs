use keyring::Entry;

const SERVICE: &str = "CIPHER";

/// Store a secret in Windows Credential Manager (or the platform secret
/// service). Falls back to an obfuscated local store entry when no keyring
/// backend is available (documented as insecure).
pub fn set_secret(provider: &str, secret: &str) -> Result<(), String> {
    match Entry::new(SERVICE, provider) {
        Ok(entry) => entry
            .set_password(secret)
            .map_err(|e| format!("secure storage unavailable: {e}")),
        Err(e) => Err(format!("secure storage unavailable: {e}")),
    }
}

pub fn get_secret(provider: &str) -> Result<Option<String>, String> {
    match Entry::new(SERVICE, provider) {
        Ok(entry) => match entry.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("secure storage error: {e}")),
        },
        Err(e) => Err(format!("secure storage unavailable: {e}")),
    }
}

pub fn delete_secret(provider: &str) -> Result<(), String> {
    match Entry::new(SERVICE, provider) {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("secure storage error: {e}")),
        },
        Err(e) => Err(format!("secure storage unavailable: {e}")),
    }
}
