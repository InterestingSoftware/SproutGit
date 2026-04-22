/// Register a workspace directory as a recent document with the host OS.
///
/// On macOS this populates the Dock's right-click "Open Recent" submenu.
/// On Windows this populates the taskbar Jump List (requires an installed build
/// with a registered App User Model ID to be visible).
///
/// Errors are silently ignored — this is a best-effort enhancement only.
pub fn add_to_recent_documents(path: &std::path::Path, app_handle: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let path_str = path.to_string_lossy().to_string();
        // AppKit calls must happen on the main thread; dispatch and ignore errors.
        let _ = app_handle.run_on_main_thread(move || {
            use objc2::MainThreadMarker;
            use objc2_app_kit::NSDocumentController;
            use objc2_foundation::{NSString, NSURL};

            if let Some(mtm) = MainThreadMarker::new() {
                let ns_path = NSURL::fileURLWithPath(&NSString::from_str(&path_str));
                let controller = NSDocumentController::sharedDocumentController(mtm);
                controller.noteNewRecentDocumentURL(&ns_path);
            }
        });
    }

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::Shell::{SHAddToRecentDocs, SHARD_APPIDINFO, SHARDAPPIDINFO};
        use windows::core::{HSTRING, PCWSTR};
        use windows::Win32::UI::Shell::SHCreateItemFromParsingName;

        let path_str = path.to_string_lossy();
        let app_id = &app_handle.config().identifier;
        let app_id_hstring = HSTRING::from(app_id.as_str());
        let path_hstring = HSTRING::from(path_str.as_ref());

        unsafe {
            if let Ok(item) = SHCreateItemFromParsingName(&path_hstring, None) {
                let info = SHARDAPPIDINFO {
                    pszAppID: PCWSTR::from_raw(app_id_hstring.as_ptr()),
                    psi: std::mem::ManuallyDrop::new(Some(item)),
                };
                SHAddToRecentDocs(
                    SHARD_APPIDINFO.0 as u32,
                    Some(&info as *const _ as *const core::ffi::c_void),
                );
            }
        }
    }

    // On Linux and other platforms this is a no-op.
    let _ = (path, app_handle);
}
