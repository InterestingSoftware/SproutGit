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
        add_to_recent_documents_windows(path, app_handle.config().identifier.as_str());
    }

    // On Linux and other platforms this is a no-op.
    let _ = (path, app_handle);
}

#[cfg(target_os = "windows")]
#[allow(unsafe_code)] // Windows shell/COM APIs require FFI calls.
fn add_to_recent_documents_windows(path: &std::path::Path, app_id: &str) {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        IShellItem, SHAddToRecentDocs, SHCreateItemFromParsingName, SHARDAPPIDINFO,
        SHARD_APPIDINFO, SHARD_PATHW,
    };

    let path_hstring = HSTRING::from(path.to_string_lossy().as_ref());
    let app_id_hstring = HSTRING::from(app_id);

    let mut com_initialized = false;
    if let Err(err) = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) } {
        if err.code() != RPC_E_CHANGED_MODE {
            return;
        }
    } else {
        com_initialized = true;
    }

    let mut added = false;
    if let Ok(item) = unsafe { SHCreateItemFromParsingName::<IShellItem>(&path_hstring, None) } {
        let info = SHARDAPPIDINFO {
            pszAppID: PCWSTR::from_raw(app_id_hstring.as_ptr()),
            psi: std::mem::ManuallyDrop::new(Some(item)),
        };
        unsafe {
            SHAddToRecentDocs(
                SHARD_APPIDINFO.0 as u32,
                Some(&info as *const _ as *const core::ffi::c_void),
            );
        }
        added = true;
    }

    if !added {
        unsafe {
            SHAddToRecentDocs(
                SHARD_PATHW.0 as u32,
                Some(path_hstring.as_ptr() as *const core::ffi::c_void),
            );
        }
    }

    if com_initialized {
        unsafe { CoUninitialize() };
    }
}
