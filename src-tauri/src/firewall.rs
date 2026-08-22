//! Show-machine authorization: the one-UAC-click elevation that configures the
//! Windows policies the installation needs. Triggered by the firewall check, but
//! the elevated script applies ALL machine policy, so a fresh show machine is
//! fully configured by the single Authorize click:
//!
//! - **Firewall**: without an allow rule, Windows pops its "Allow this app to
//!   communicate on networks?" dialog for EVERY new binary that listens on our
//!   port — including each self-updated versioned exe — and a dismissed dialog
//!   silently blocks LAN clients. The fix is a PORT-scoped inbound allow rule
//!   (not program-scoped), which is version-proof.
//! - **Windows Update active hours**: 15:00→09:00 (the 18 h max), so automatic
//!   update restarts can only land 09:00–15:00 — people are at the gate until
//!   well past 5am. Manual (SmartActiveHoursState=0) so Windows can't drift
//!   them back toward "overnight".
//!
//! Non-Windows platforms are no-ops.

/// True when the port allow rule for `port` is missing (Windows only) — the UI
/// shows an "authorize" banner then.
pub fn rule_missing(port: u16) -> bool {
    #[cfg(windows)]
    {
        rule_exists_windows(port) == Some(false)
    }
    #[cfg(not(windows))]
    {
        let _ = port;
        false
    }
}

#[cfg(windows)]
fn rule_name() -> &'static str {
    "Empyrean Gate"
}

/// None = could not determine (treat as present; never nag on uncertainty).
#[cfg(windows)]
fn rule_exists_windows(port: u16) -> Option<bool> {
    let output = std::process::Command::new("netsh")
        .args([
            "advfirewall",
            "firewall",
            "show",
            "rule",
            &format!("name={}", rule_name()),
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        // "No rules match the specified criteria."
        return Some(false);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    // The rule may exist for an older port; require the current one.
    Some(text.contains(&port.to_string()))
}

/// Create/replace the allow rule, elevating via UAC (one prompt, on the machine
/// running the backend — which is where the operator is). Blocks until the
/// elevated process finishes so the caller can re-check immediately.
pub fn authorize(port: u16) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        // The netsh commands go through a temp .ps1 run with -File. Passing them
        // inline via nested `-Command` strips the embedded quotes at the native
        // command-line level (netsh saw `name=Empyrean` + a stray `Gate` and
        // failed inside the hidden elevated window). A script file parses its
        // own contents, so quoting survives. Delete any stale rule (old port)
        // first, then add — both inside ONE elevated shell so UAC appears once.
        let script = format!(
            "netsh advfirewall firewall delete rule name=\"{name}\" | Out-Null\r\n\
             netsh advfirewall firewall add rule name=\"{name}\" dir=in action=allow \
             protocol=TCP localport={port} profile=any\r\n\
             $fw = $LASTEXITCODE\r\n\
             $wu = 'HKLM\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings'\r\n\
             reg add $wu /v ActiveHoursStart /t REG_DWORD /d 15 /f | Out-Null\r\n\
             reg add $wu /v ActiveHoursEnd /t REG_DWORD /d 9 /f | Out-Null\r\n\
             reg add $wu /v SmartActiveHoursState /t REG_DWORD /d 0 /f | Out-Null\r\n\
             exit $fw\r\n",
            name = rule_name(),
        );
        let path = std::env::temp_dir().join("empyrean-gate-firewall.ps1");
        std::fs::write(&path, script)?;
        let status = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "$ErrorActionPreference='Stop'; \
                     $p = Start-Process powershell -Verb RunAs -Wait -PassThru \
                     -WindowStyle Hidden -ArgumentList \
                     '-NoProfile','-ExecutionPolicy','Bypass','-File','\"{}\"'; \
                     exit $p.ExitCode",
                    path.display()
                ),
            ])
            .status()?;
        let _ = std::fs::remove_file(&path);
        anyhow::ensure!(status.success(), "elevation was declined or failed");
        anyhow::ensure!(
            rule_exists_windows(port) == Some(true),
            "the rule did not appear after elevation"
        );
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = port;
        Ok(())
    }
}
