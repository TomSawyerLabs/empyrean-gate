//! Windows Firewall bookkeeping. Without an allow rule, Windows pops its
//! "Allow this app to communicate on networks?" dialog for EVERY new binary that
//! listens on our port — including each self-updated versioned exe — and a
//! dismissed dialog silently blocks LAN clients.
//!
//! The fix is a PORT-scoped inbound allow rule (not program-scoped), which is
//! version-proof: one admin elevation ever, then no prompts and no blocks, no
//! matter how many binaries come and go. Non-Windows platforms are no-ops.

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
        // Delete any stale rule (old port) first, then add — both inside ONE
        // elevated shell so UAC appears once.
        let script = format!(
            "netsh advfirewall firewall delete rule name=\"{name}\" >$null 2>&1; \
             netsh advfirewall firewall add rule name=\"{name}\" dir=in action=allow \
             protocol=TCP localport={port} profile=any",
            name = rule_name(),
        );
        let status = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden \
                     -ArgumentList '-NoProfile','-Command','{}'",
                    script.replace('\'', "''")
                ),
            ])
            .status()?;
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
