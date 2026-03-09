use std::process::Command;

fn read_command_output(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn main() {
    let pkg_version = std::env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.0.0".to_string());
    let git_sha = read_command_output("git", &["rev-parse", "--short=12", "HEAD"])
        .or_else(|| {
            std::env::var("GITHUB_SHA")
                .ok()
                .map(|value| value.chars().take(12).collect())
        })
        .or_else(|| std::env::var("VERGEN_GIT_SHA").ok());
    let git_dirty = read_command_output("git", &["status", "--porcelain"])
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    let build_version = match git_sha {
        Some(sha) if git_dirty => format!("{pkg_version}+{sha}.dirty"),
        Some(sha) => format!("{pkg_version}+{sha}"),
        None => pkg_version.clone(),
    };

    println!("cargo:rustc-env=FUGIT_BUILD_VERSION={build_version}");
    println!(
        "cargo:rustc-env=FUGIT_BUILD_GIT_SHA={}",
        git_sha.unwrap_or_default()
    );
    println!(
        "cargo:rustc-env=FUGIT_BUILD_GIT_DIRTY={}",
        if git_dirty { "true" } else { "false" }
    );
}
