use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::Context;
use serde::Deserialize;
use sqlx_core::row::Row;

use crate::{agent::protocol, postgres::PgPoolOptions};

const EXPECTED_AGENT_RUNTIME_VERSIONS: [(&str, &str); 3] = [
    ("@trycua/cua-driver", "0.19.3"),
    ("playwright-core", "1.62.1"),
    ("zod", "4.4.3"),
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageManifest {
    #[serde(default)]
    dependencies: BTreeMap<String, String>,
    #[serde(default)]
    dev_dependencies: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct PackageLock {
    #[serde(default)]
    packages: BTreeMap<String, LockedPackage>,
}

#[derive(Debug, Deserialize)]
struct LockedPackage {
    version: Option<String>,
}

pub fn check_agent_runtime_versions(repository_root: &Path) -> anyhow::Result<()> {
    let manifest_path = repository_root.join("package.json");
    let lock_path = repository_root.join("package-lock.json");
    let manifest: PackageManifest = serde_json::from_str(
        &fs::read_to_string(&manifest_path)
            .with_context(|| format!("failed to read {}", manifest_path.display()))?,
    )
    .with_context(|| format!("failed to parse {}", manifest_path.display()))?;
    let lock: PackageLock = serde_json::from_str(
        &fs::read_to_string(&lock_path)
            .with_context(|| format!("failed to read {}", lock_path.display()))?,
    )
    .with_context(|| format!("failed to parse {}", lock_path.display()))?;

    for (name, expected) in EXPECTED_AGENT_RUNTIME_VERSIONS {
        let declared = manifest
            .dependencies
            .get(name)
            .or_else(|| manifest.dev_dependencies.get(name))
            .map(String::as_str);
        let locked = lock
            .packages
            .get(&format!("node_modules/{name}"))
            .and_then(|package| package.version.as_deref());
        anyhow::ensure!(
            declared == Some(expected) && locked == Some(expected),
            "{name} must remain pinned to {expected}; declared={}, locked={}.",
            declared.unwrap_or("undefined"),
            locked.unwrap_or("undefined")
        );
    }
    println!("Agent runtime versions match the supported compatibility baseline.");
    Ok(())
}

pub async fn agent_runtime_versions_report(repository_root: &Path) -> anyhow::Result<()> {
    check_agent_runtime_versions(repository_root)?;
    let mode = std::env::var("AGENT_RUNTIME_V3_MODE")
        .unwrap_or_else(|_| "observe".to_owned())
        .to_lowercase();
    anyhow::ensure!(
        matches!(mode.as_str(), "observe" | "dual" | "enforce"),
        "AGENT_RUNTIME_V3_MODE must be one of: observe, dual, enforce."
    );

    println!("Canonical agent protocol: v{}", protocol::PROTOCOL_VERSION);
    println!("Protocol digest: {}", protocol::protocol_digest());
    println!("Tool catalog digest: {}", protocol::tool_catalog_digest());
    println!("Rollout mode: {mode}");

    let Ok(database_url) = std::env::var("DATABASE_URL") else {
        println!("Active v2/v3 runs: unavailable (DATABASE_URL is not configured)");
        println!("Enforcement readiness: unknown until the active-run drain query is available");
        return Ok(());
    };
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .context("failed to inspect active agent runtime versions")?;
    let counts = sqlx::query(
        "SELECT \
           COUNT(*) FILTER (WHERE protocol_version = 2) AS active_v2, \
           COUNT(*) FILTER (WHERE protocol_version = 3) AS active_v3 \
         FROM agent_runs \
         WHERE state NOT IN ('completed','blocked','failed','cancelled','expired')",
    )
    .fetch_one(&pool)
    .await
    .context("failed to count active agent runtime rows")?;
    let active_v2 = counts.get::<i64, _>("active_v2");
    let active_v3 = counts.get::<i64, _>("active_v3");
    println!("Active runs: v2={active_v2}, v3={active_v3}");
    println!(
        "Enforcement readiness: {}",
        if active_v2 == 0 {
            "ready (no active v2 runs)"
        } else {
            "not ready (drain active v2 runs before enforce)"
        }
    );
    Ok(())
}

pub fn check_rust_only_script_layout(repository_root: &Path) -> anyhow::Result<()> {
    let mut module_files = Vec::new();
    collect_module_files(repository_root, repository_root, &mut module_files)?;
    module_files.sort();
    anyhow::ensure!(
        module_files.is_empty(),
        "Executable JavaScript modules remain:\n{}",
        module_files
            .iter()
            .map(|path| format!("- {}", path.display()))
            .collect::<Vec<_>>()
            .join("\n")
    );
    println!("Rust is the sole hosted engine; no repository-owned .mjs tooling remains.");
    Ok(())
}

fn collect_module_files(
    repository_root: &Path,
    directory: &Path,
    output: &mut Vec<PathBuf>,
) -> anyhow::Result<()> {
    for entry in fs::read_dir(directory)
        .with_context(|| format!("failed to inspect {}", directory.display()))?
    {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let path = entry.path();
        if file_type.is_dir() {
            let name = entry.file_name();
            if matches!(
                name.to_str(),
                Some(".git" | ".webpack" | "coverage" | "node_modules" | "out" | "target")
            ) {
                continue;
            }
            collect_module_files(repository_root, &path, output)?;
        } else if file_type.is_file() && path.extension().is_some_and(|value| value == "mjs") {
            output.push(
                path.strip_prefix(repository_root)
                    .unwrap_or(&path)
                    .to_path_buf(),
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_version_check_requires_declared_and_locked_exact_versions() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let dependencies = EXPECTED_AGENT_RUNTIME_VERSIONS
            .iter()
            .map(|(name, version)| ((*name).to_owned(), serde_json::json!(version)))
            .collect::<serde_json::Map<_, _>>();
        let packages = EXPECTED_AGENT_RUNTIME_VERSIONS
            .iter()
            .map(|(name, version)| {
                (
                    format!("node_modules/{name}"),
                    serde_json::json!({"version": version}),
                )
            })
            .collect::<serde_json::Map<_, _>>();
        fs::write(
            directory.path().join("package.json"),
            serde_json::to_vec(&serde_json::json!({"dependencies": dependencies}))
                .expect("manifest"),
        )
        .expect("manifest write");
        fs::write(
            directory.path().join("package-lock.json"),
            serde_json::to_vec(&serde_json::json!({"packages": packages})).expect("lock"),
        )
        .expect("lock write");
        check_agent_runtime_versions(directory.path()).expect("valid versions");

        let manifest_path = directory.path().join("package.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).expect("manifest read"))
                .expect("manifest JSON");
        manifest["dependencies"]["playwright-core"] = serde_json::json!("latest");
        fs::write(
            &manifest_path,
            serde_json::to_vec(&manifest).expect("changed manifest"),
        )
        .expect("changed manifest write");
        assert!(check_agent_runtime_versions(directory.path()).is_err());
    }

    #[test]
    fn rust_only_layout_ignores_dependencies_but_rejects_repository_modules() {
        let directory = tempfile::tempdir().expect("temporary directory");
        fs::create_dir_all(directory.path().join("node_modules/library")).expect("node_modules");
        fs::write(
            directory.path().join("node_modules/library/index.mjs"),
            "export {};",
        )
        .expect("dependency module");
        check_rust_only_script_layout(directory.path()).expect("dependency ignored");
        fs::create_dir_all(directory.path().join("scripts")).expect("scripts");
        fs::write(directory.path().join("scripts/tool.mjs"), "export {};")
            .expect("repository module");
        assert!(check_rust_only_script_layout(directory.path()).is_err());
    }
}
