// Tao's Cocoa delegate handles applicationWillTerminate, but not
// applicationShouldTerminate. NSApp's standard Quit/AppleEvent path otherwise
// bypasses the cancellable Tauri ExitRequested event entirely.
use std::ffi::{c_char, c_void, CStr};

type Object = *mut c_void;
type Selector = *mut c_void;

#[link(name = "objc")]
extern "C" {
    fn objc_getClass(name: *const c_char) -> Object;
    fn sel_registerName(name: *const c_char) -> Selector;
    fn objc_msgSend();
    fn object_getClass(object: Object) -> Object;
    fn class_getName(class: Object) -> *const c_char;
    fn class_addMethod(class: Object, selector: Selector, implementation: unsafe extern "C" fn(), types: *const c_char) -> i8;
}

unsafe extern "C" fn should_terminate(_: Object, _: Selector, _: Object) -> usize {
    // Never unwind through Objective-C, nor treat a failed check as consent.
    let _ = std::panic::catch_unwind(|| {
        if let Some(app) = crate::app_handle::current() {
            crate::quit_guard::request(&app);
        }
    });
    0 // NSTerminateCancel; approved quits use AppHandle::exit instead.
}

pub fn install() -> Result<(), String> {
    // Setup runs on the AppKit main thread. These are fixed, public Objective-C
    // runtime calls, with signatures matching the pointer-only selectors used.
    unsafe {
        let send: unsafe extern "C" fn(Object, Selector) -> Object = std::mem::transmute(objc_msgSend as *const ());
        let app_class = objc_getClass(c"NSApplication".as_ptr());
        if app_class.is_null() { return Err("AppKit is unavailable for quit protection".into()); }
        let app = send(app_class, sel_registerName(c"sharedApplication".as_ptr()));
        if app.is_null() { return Err("Application is unavailable for quit protection".into()); }
        let delegate = send(app, sel_registerName(c"delegate".as_ptr()));
        if delegate.is_null() { return Err("Application delegate is unavailable for quit protection".into()); }
        let class = object_getClass(delegate);
        if class.is_null() || CStr::from_ptr(class_getName(class)).to_bytes() != b"TaoAppDelegateParent" {
            return Err("Unreviewed application delegate; quit protection needs compatibility review".into());
        }
        let implementation: unsafe extern "C" fn() = std::mem::transmute(should_terminate as unsafe extern "C" fn(Object, Selector, Object) -> usize);
        if class_addMethod(class, sel_registerName(c"applicationShouldTerminate:".as_ptr()), implementation, c"Q@:@".as_ptr()) == 0 {
            return Err("Application quit policy already exists; compatibility review required".into());
        }
    }
    Ok(())
}
