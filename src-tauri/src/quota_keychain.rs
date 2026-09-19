//! Scoped, read-only macOS keychain lookup. Timer reads cannot raise UI.
#[cfg(target_os = "macos")]
mod mac {
    use std::{
        ffi::{c_char, c_void, CString},
        ptr,
    };
    type Ref = *const c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(value: Ref);
        fn CFStringCreateWithCString(allocator: Ref, text: *const c_char, encoding: u32) -> Ref;
        fn CFDictionaryCreateMutable(
            allocator: Ref,
            capacity: isize,
            keys: Ref,
            values: Ref,
        ) -> Ref;
        fn CFDictionarySetValue(dict: Ref, key: Ref, value: Ref);
        fn CFDictionaryGetValue(dict: Ref, key: Ref) -> Ref;
        fn CFArrayGetCount(array: Ref) -> isize;
        fn CFArrayGetValueAtIndex(array: Ref, index: isize) -> Ref;
        fn CFDateGetAbsoluteTime(date: Ref) -> f64;
        fn CFDataGetLength(data: Ref) -> isize;
        fn CFDataGetBytePtr(data: Ref) -> *const u8;
        static kCFBooleanTrue: Ref;
    }
    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecItemCopyMatching(query: Ref, result: *mut Ref) -> i32;
        static kSecClass: Ref;
        static kSecClassGenericPassword: Ref;
        static kSecAttrService: Ref;
        static kSecAttrAccount: Ref;
        static kSecAttrModificationDate: Ref;
        static kSecMatchLimit: Ref;
        static kSecMatchLimitAll: Ref;
        static kSecReturnAttributes: Ref;
        static kSecReturnPersistentRef: Ref;
        static kSecValuePersistentRef: Ref;
        static kSecReturnData: Ref;
        static kSecUseAuthenticationUI: Ref;
        static kSecUseAuthenticationUIFail: Ref;
    }
    struct Owned(Ref);
    impl Drop for Owned {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) }
            }
        }
    }
    unsafe fn string(text: &str) -> Result<Owned, String> {
        let text = CString::new(text).map_err(|_| "Invalid credential scope")?;
        let result = Owned(CFStringCreateWithCString(
            ptr::null(),
            text.as_ptr(),
            0x08000100,
        ));
        if result.0.is_null() {
            Err("Keychain unavailable".into())
        } else {
            Ok(result)
        }
    }
    unsafe fn dictionary() -> Result<Owned, String> {
        let result = Owned(CFDictionaryCreateMutable(
            ptr::null(),
            0,
            ptr::null(),
            ptr::null(),
        ));
        if result.0.is_null() {
            Err("Keychain unavailable".into())
        } else {
            Ok(result)
        }
    }
    pub fn read(
        service: &str,
        account: Option<&str>,
        interactive: bool,
    ) -> Result<Option<Vec<u8>>, String> {
        let account = account
            .map(str::to_owned)
            .or_else(|| std::env::var("USER").ok())
            .filter(|name| !name.is_empty())
            .ok_or("Keychain account unavailable")?;
        // Both queries are constrained to the owning CLI's exact service/account. Attributes select the newest duplicate without reading
        // all secrets or falling through to another profile's credentials.
        unsafe {
            let service = string(service)?;
            let account = string(&account)?;
            let query = dictionary()?;
            for (key, value) in [
                (kSecClass, kSecClassGenericPassword),
                (kSecAttrService, service.0),
                (kSecAttrAccount, account.0),
                (kSecMatchLimit, kSecMatchLimitAll),
                (kSecReturnAttributes, kCFBooleanTrue),
                (kSecReturnPersistentRef, kCFBooleanTrue),
            ] {
                CFDictionarySetValue(query.0, key, value);
            }
            if !interactive {
                CFDictionarySetValue(
                    query.0,
                    kSecUseAuthenticationUI,
                    kSecUseAuthenticationUIFail,
                );
            }
            let mut raw = ptr::null();
            let status = SecItemCopyMatching(query.0, &mut raw);
            let items = Owned(raw);
            if status == -25300 {
                return Ok(None);
            }
            if status != 0 || items.0.is_null() {
                return Err("keychain_access".into());
            }
            let mut winner = ptr::null();
            let mut newest = f64::NEG_INFINITY;
            let count = CFArrayGetCount(items.0);
            if count > 16384 {
                return Err("Too many scoped keychain entries".into());
            }
            for i in 0..count {
                let item = CFArrayGetValueAtIndex(items.0, i);
                let date = CFDictionaryGetValue(item, kSecAttrModificationDate);
                let reference = CFDictionaryGetValue(item, kSecValuePersistentRef);
                let modified = if date.is_null() {
                    0.0
                } else {
                    CFDateGetAbsoluteTime(date)
                };
                if !reference.is_null() && modified > newest {
                    newest = modified;
                    winner = reference;
                }
            }
            if winner.is_null() {
                return Ok(None);
            }
            let query = dictionary()?;
            CFDictionarySetValue(query.0, kSecClass, kSecClassGenericPassword);
            CFDictionarySetValue(query.0, kSecValuePersistentRef, winner);
            CFDictionarySetValue(query.0, kSecReturnData, kCFBooleanTrue);
            if !interactive {
                CFDictionarySetValue(
                    query.0,
                    kSecUseAuthenticationUI,
                    kSecUseAuthenticationUIFail,
                );
            }
            let mut raw = ptr::null();
            let status = SecItemCopyMatching(query.0, &mut raw);
            let data = Owned(raw);
            if status != 0 || data.0.is_null() {
                return Err("keychain_access".into());
            }
            let length = CFDataGetLength(data.0);
            if !(1..=1_048_576).contains(&length) {
                return Err("Invalid credential document size".into());
            }
            Ok(Some(
                std::slice::from_raw_parts(CFDataGetBytePtr(data.0), length as usize).to_vec(),
            ))
        }
    }
}

pub fn read(
    service: &str,
    account: Option<&str>,
    interactive: bool,
) -> Result<Option<Vec<u8>>, String> {
    #[cfg(target_os = "macos")]
    {
        mac::read(service, account, interactive)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (service, account, interactive);
        Ok(None)
    }
}
