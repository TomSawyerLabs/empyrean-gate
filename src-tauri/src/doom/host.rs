//! The child side of DOOM: what `empyrean-gate --doom-host` runs instead of
//! the app (plans/doom.md). This process IS the DOOM engine — the vendored
//! doomgeneric core (`doom/doomgeneric`) linked in, with its five platform
//! callbacks implemented here. Frames go up stdout, keys come down stdin,
//! DOOM's own chatter goes to stderr where the parent logs it.
//!
//! Why a process and not a thread: doomgeneric's `I_Error` ends in `exit()`,
//! and 1993 C with global state can neither be re-initialised after a fault
//! nor be trusted not to take a 60 fps light show down with it. Here the
//! worst case is this process dying, which the parent notices (EOF) and turns
//! into "DOOM ended".

use super::wire::{self, RawStats, FRAME_BYTES, PALETTE_BYTES, PIXELS};
use std::collections::VecDeque;
use std::ffi::{CString, c_char, c_int, c_uchar};
use std::fs::File;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

unsafe extern "C" {
    fn doomgeneric_Create(argc: c_int, argv: *mut *mut c_char);
    fn doomgeneric_Tick();
    /// `pixel_t*` — `uint8_t*` in the CMAP256 build this tree is compiled in.
    /// DOOM allocates it in `doomgeneric_Create`; read, never written, here.
    static mut DG_ScreenBuffer: *mut u8;
    fn dg_stats(out: *mut RawStats);
    fn dg_palette(out: *mut u8);
    fn dg_steal_stdout() -> c_int;
    fn dg_os_handle(fd: c_int) -> isize;
}

struct Host {
    /// The original stdout, duplicated before fd 1 was pointed at stderr.
    frames: File,
    keys: Mutex<VecDeque<(bool, u8)>>,
    start: Instant,
    scratch: Mutex<Vec<u8>>,
}

static HOST: OnceLock<Host> = OnceLock::new();

fn host() -> &'static Host {
    HOST.get().expect("DG_* callback before run_host set the host up")
}

// ---- the doomgeneric platform contract ------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn DG_Init() {}

#[unsafe(no_mangle)]
pub extern "C" fn DG_SetWindowTitle(_title: *const c_char) {}

#[unsafe(no_mangle)]
pub extern "C" fn DG_SleepMs(ms: u32) {
    std::thread::sleep(Duration::from_millis(u64::from(ms)));
}

#[unsafe(no_mangle)]
pub extern "C" fn DG_GetTicksMs() -> u32 {
    host().start.elapsed().as_millis() as u32
}

/// DOOM polls this until it returns 0 each tic.
#[unsafe(no_mangle)]
pub extern "C" fn DG_GetKey(pressed: *mut c_int, key: *mut c_uchar) -> c_int {
    let Some((down, code)) = host().keys.lock().unwrap_or_else(|p| p.into_inner()).pop_front()
    else {
        return 0;
    };
    // SAFETY: doomgeneric passes two valid out-pointers.
    unsafe {
        *pressed = c_int::from(down);
        *key = code;
    }
    1
}

/// A finished frame sits in `DG_ScreenBuffer`: ship it. A write failure means
/// the parent is gone, and a DOOM with nobody to draw for just exits.
#[unsafe(no_mangle)]
pub extern "C" fn DG_DrawFrame() {
    let h = host();
    let mut stats = RawStats::default();
    let mut palette = [0u8; PALETTE_BYTES];
    // SAFETY: the shim writes exactly these sizes; DG_ScreenBuffer was
    // allocated by doomgeneric_Create (PIXELS bytes in the CMAP256 build) and
    // is only read here on the thread DOOM runs on.
    let pixels: &[u8] = unsafe {
        dg_stats(&mut stats);
        dg_palette(palette.as_mut_ptr());
        let buffer = std::ptr::read_volatile(std::ptr::addr_of!(DG_ScreenBuffer));
        if buffer.is_null() {
            return;
        }
        std::slice::from_raw_parts(buffer, PIXELS)
    };
    let mut scratch = h.scratch.lock().unwrap_or_else(|p| p.into_inner());
    wire::encode_frame(&stats, &palette, pixels, &mut scratch);
    debug_assert_eq!(scratch.len(), FRAME_BYTES);
    if (&h.frames).write_all(&scratch).is_err() {
        std::process::exit(0);
    }
}

// ---- process entry ----------------------------------------------------------

/// Arguments after `--doom-host`. Deliberately not clap: three flags, one caller.
struct HostArgs {
    wad: PathBuf,
    skill: u8,
    cwd: Option<PathBuf>,
}

fn parse_args(args: &[String]) -> Result<HostArgs, String> {
    let mut wad = None;
    let mut skill = 3u8;
    let mut cwd = None;
    let mut i = 0;
    while i < args.len() {
        let value = args.get(i + 1);
        match (args[i].as_str(), value) {
            ("--wad", Some(v)) => wad = Some(PathBuf::from(v)),
            ("--skill", Some(v)) => {
                skill = v.parse::<u8>().map_err(|e| format!("--skill {v}: {e}"))?.clamp(1, 5)
            }
            ("--cwd", Some(v)) => cwd = Some(PathBuf::from(v)),
            (other, _) => return Err(format!("unknown --doom-host argument {other:?}")),
        }
        i += 2;
    }
    Ok(HostArgs {
        wad: wad.ok_or("--wad is required")?,
        skill,
        cwd,
    })
}

/// Run DOOM until the parent closes the pipe or DOOM exits. Never returns.
pub fn run_host(args: &[String]) -> ! {
    let parsed = match parse_args(args) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("doom-host: {e}");
            std::process::exit(2);
        }
    };
    // DOOM writes default.cfg and saves into its cwd.
    if let Some(dir) = &parsed.cwd {
        if let Err(e) = std::env::set_current_dir(dir) {
            eprintln!("doom-host: cannot enter {}: {e}", dir.display());
        }
    }

    // Claim stdout for frames before DOOM prints a single line to it.
    // SAFETY: plain libc fd juggling with no Rust-side stdout in use yet.
    let frames = unsafe {
        let fd = dg_steal_stdout();
        if fd < 0 {
            eprintln!("doom-host: could not take over stdout");
            std::process::exit(2);
        }
        let handle = dg_os_handle(fd);
        file_from_os_handle(handle)
    };
    let _ = HOST.set(Host {
        frames,
        keys: Mutex::new(VecDeque::new()),
        start: Instant::now(),
        scratch: Mutex::new(Vec::with_capacity(FRAME_BYTES)),
    });

    // Keys arrive as two-byte events; EOF means the parent let go of us.
    std::thread::Builder::new()
        .name("doom-keys".into())
        .spawn(|| {
            let mut stdin = std::io::stdin().lock();
            let mut event = [0u8; 2];
            loop {
                if stdin.read_exact(&mut event).is_err() {
                    std::process::exit(0);
                }
                let mut keys = host().keys.lock().unwrap_or_else(|p| p.into_inner());
                // DOOM drains the queue every tic; a flood here is a stuck
                // parent, not a fast player.
                if keys.len() < 256 {
                    keys.push_back(wire::decode_key(event));
                }
            }
        })
        .expect("spawn doom-keys thread");

    // `-nogui`: I_Error must never pop a MessageBox on the show machine.
    // `-warp 1 1`: straight into E1M1, no title demo loop holding the array.
    let argv: Vec<CString> = [
        "empyrean-doom",
        "-iwad",
        &parsed.wad.to_string_lossy(),
        "-nogui",
        "-skill",
        &parsed.skill.to_string(),
        "-warp",
        "1",
        "1",
    ]
    .iter()
    .map(|s| CString::new(*s).expect("argv without NULs"))
    .collect();
    let mut ptrs: Vec<*mut c_char> = argv.iter().map(|s| s.as_ptr() as *mut c_char).collect();
    ptrs.push(std::ptr::null_mut());
    // SAFETY: argv outlives the engine (this function never returns) and DOOM
    // keeps pointers into it; ptrs is NULL-terminated as C expects.
    unsafe {
        doomgeneric_Create(argv.len() as c_int, ptrs.as_mut_ptr());
        loop {
            doomgeneric_Tick();
        }
    }
}

#[cfg(windows)]
unsafe fn file_from_os_handle(handle: isize) -> File {
    use std::os::windows::io::{FromRawHandle, RawHandle};
    // SAFETY: the caller passes a HANDLE from _get_osfhandle on a dup'd fd we own.
    unsafe { File::from_raw_handle(handle as RawHandle) }
}

#[cfg(unix)]
unsafe fn file_from_os_handle(handle: isize) -> File {
    use std::os::unix::io::FromRawFd;
    // SAFETY: the caller passes a dup'd fd we own.
    unsafe { File::from_raw_fd(handle as i32) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_args_parse_and_clamp() {
        let args: Vec<String> = ["--wad", "x.wad", "--skill", "9", "--cwd", "d"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let parsed = parse_args(&args).unwrap();
        assert_eq!(parsed.wad, PathBuf::from("x.wad"));
        assert_eq!(parsed.skill, 5);
        assert_eq!(parsed.cwd, Some(PathBuf::from("d")));
        assert!(parse_args(&["--skill".to_string(), "3".to_string()]).is_err());
        assert!(parse_args(&["--bogus".to_string(), "1".to_string()]).is_err());
    }
}
