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
//! - **Controller discovery (UDP 49150/49151/5568)**: replies to a broadcast or
//!   multicast probe arrive from a source we never sent a packet to directly, so
//!   Windows does not treat them as solicited and drops them by default. Without
//!   this rule a controller scan silently finds nothing on a network full of
//!   working PixLites. Same rule name as the TCP rule so the `delete` above
//!   still cleans both up.
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
    // Query structured PowerShell objects instead of searching localized netsh
    // prose for the port digits (which could mistake 19520 for 9520 and ignored
    // direction, action, protocol, and remote-address scope).
    let command = format!(
        "$rules = @(Get-NetFirewallRule -DisplayName '{name}' -ErrorAction SilentlyContinue | \
         Where-Object {{ $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and \
         $_.Action -eq 'Allow' }}); \
         foreach ($rule in $rules) {{ \
           $p = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule; \
           $a = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule; \
           if ($p.Protocol -eq 'TCP' -and @($p.LocalPort) -contains '{port}' -and \
               @($a.RemoteAddress) -contains 'LocalSubnet') {{ exit 0 }} \
         }}; exit 1",
        name = rule_name(),
    );
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &command,
        ])
        .output()
        .ok()?;
    Some(output.status.success())
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
             protocol=TCP localport={port} remoteip=localsubnet profile=any\r\n\
             $fw = $LASTEXITCODE\r\n\
             netsh advfirewall firewall add rule name=\"{name}\" dir=in action=allow \
             protocol=UDP localport=49150,49151,5568 remoteip=localsubnet profile=any | Out-Null\r\n\
             $wu = 'HKLM\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings'\r\n\
             reg add $wu /v ActiveHoursStart /t REG_DWORD /d 15 /f | Out-Null\r\n\
             reg add $wu /v ActiveHoursEnd /t REG_DWORD /d 9 /f | Out-Null\r\n\
             reg add $wu /v SmartActiveHoursState /t REG_DWORD /d 0 /f | Out-Null\r\n\
             exit $fw\r\n",
            name = rule_name(),
        );
        // A fixed filename in a user-writable temp directory can be replaced in
        // the gap before elevation. Use an unpredictable create-new file and sync
        // it before asking the elevated process to read it.
        let path = std::env::temp_dir().join(format!(
            "empyrean-gate-firewall-{}.ps1",
            uuid::Uuid::new_v4().simple()
        ));
        let result = (|| -> anyhow::Result<std::process::ExitStatus> {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)?;
            file.write_all(script.as_bytes())?;
            file.sync_all()?;
            drop(file);
            Ok(std::process::Command::new("powershell")
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
                .status()?)
        })();
        let _ = std::fs::remove_file(&path);
        let status = result?;
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
