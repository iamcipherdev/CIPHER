//! Platform layer: window/process interaction.
//! Real Win32 implementation on Windows; graceful fallbacks elsewhere so the
//! project still compiles and runs on other desktop OSes for development.

#[derive(Debug, Clone)]
pub struct WindowInfo {
    pub hwnd: isize,
    pub pid: u32,
    pub title: String,
    pub process: String,
}

#[cfg(windows)]
mod imp {
    use super::WindowInfo;
    use winapi::shared::minwindef::{BOOL, DWORD, LPARAM, TRUE};
    use winapi::shared::windef::{HWND, RECT};
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::OpenProcess;
    use winapi::um::psapi::GetModuleBaseNameW;
    use winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION;
    use winapi::um::winuser::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        GetWindowRect, IsIconic, IsWindowVisible, PostMessageW, SetForegroundWindow,
        ShowWindow, SW_RESTORE, WM_CLOSE,
    };

    unsafe fn process_name(pid: u32) -> Option<String> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return None;
        }
        let mut buf = [0u16; 512];
        let len = unsafe { GetModuleBaseNameW(handle, std::ptr::null_mut(), buf.as_mut_ptr(), 512) };
        unsafe { CloseHandle(handle) };
        if len == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }

    pub fn visible_windows() -> Vec<WindowInfo> {
        let mut out: Vec<WindowInfo> = Vec::new();
        unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let out = unsafe { &mut *(lparam as *mut Vec<WindowInfo>) };
            if unsafe { IsWindowVisible(hwnd) } == 0 {
                return TRUE;
            }
            let mut pid: DWORD = 0;
            unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
            if pid == 0 {
                return TRUE;
            }
            let len = unsafe { GetWindowTextLengthW(hwnd) };
            let mut title = String::new();
            if len > 0 {
                let mut buf = vec![0u16; (len + 1) as usize];
                unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), len + 1) };
                title = String::from_utf16_lossy(&buf[..len as usize]);
            }
            let process = unsafe { process_name(pid) }.unwrap_or_default();
            out.push(WindowInfo {
                hwnd: hwnd as isize,
                pid,
                title,
                process,
            });
            TRUE
        }
        unsafe {
            EnumWindows(Some(cb), &mut out as *mut _ as LPARAM);
        }
        out
    }

    pub fn focus_window(hwnd: isize) -> bool {
        let hwnd = hwnd as HWND;
        unsafe {
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            SetForegroundWindow(hwnd)
        }
    }

    pub fn post_close(hwnd: isize) -> bool {
        unsafe { PostMessageW(hwnd as HWND, WM_CLOSE, 0, 0) != 0 }
    }

    /// (title, physical-pixel rect of the foreground window)
    pub fn foreground_window() -> Option<(String, Option<(i32, i32, u32, u32)>)> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return None;
            }
            let len = GetWindowTextLengthW(hwnd);
            let mut title = String::new();
            if len > 0 {
                let mut buf = vec![0u16; (len + 1) as usize];
                GetWindowTextW(hwnd, buf.as_mut_ptr(), len + 1);
                title = String::from_utf16_lossy(&buf[..len as usize]);
            }
            let mut rect = RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            let ok = GetWindowRect(hwnd, &mut rect) != 0;
            Some((
                title,
                if ok {
                    Some((rect.left, rect.top, (rect.right - rect.left) as u32, (rect.bottom - rect.top) as u32))
                } else {
                    None
                },
            ))
        }
    }

    pub fn set_dpi_aware() {
        unsafe {
            winapi::um::winuser::SetProcessDPIAware();
        }
    }

    use winapi::um::winuser::EnumWindows;
}

#[cfg(not(windows))]
mod imp {
    use super::WindowInfo;

    pub fn visible_windows() -> Vec<WindowInfo> {
        // Best-effort via wmctrl/xdotool if present; empty otherwise.
        let mut out = Vec::new();
        if let Ok(output) = std::process::Command::new("wmctrl")
            .args(["-lp"])
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines().skip(1) {
                    let cols: Vec<&str> = line.split_whitespace().collect();
                    if cols.len() >= 4 {
                        let pid: u32 = cols[2].parse().unwrap_or(0);
                        let title = cols[3..].join(" ");
                        out.push(WindowInfo {
                            hwnd: 0,
                            pid,
                            title,
                            process: String::new(),
                        });
                    }
                }
            }
        }
        out
    }

    pub fn focus_window(_hwnd: isize) -> bool {
        false
    }

    pub fn post_close(_hwnd: isize) -> bool {
        false
    }

    pub fn foreground_window() -> Option<(String, Option<(i32, i32, u32, u32)>)> {
        if let Ok(output) = std::process::Command::new("xdotool")
            .args(["getactivewindow", "getwindowname"])
            .output()
        {
            if output.status.success() {
                let title = String::from_utf8_lossy(&output.stdout).trim().to_string();
                return Some((title, None));
            }
        }
        None
    }

    #[allow(dead_code)]
    pub fn set_dpi_aware() {}
}

pub use imp::*;
