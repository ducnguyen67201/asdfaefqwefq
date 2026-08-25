use std::{collections::BTreeMap, path::Path, sync::OnceLock};

use anyhow::Context;
use clap::ValueEnum;
use editpe::{Image, VersionInfo, types::VersionU32};
use regex::Regex;

const PRODUCT_NAME: &str = "Tro";

#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum WindowsArtifactKind {
    App,
    Installer,
}

pub fn stamp_windows_executable(
    file_path: &Path,
    kind: WindowsArtifactKind,
    version: &str,
) -> anyhow::Result<()> {
    let numeric_version = parse_version(version)?;
    let mut image = Image::parse_file(file_path)
        .with_context(|| format!("failed to parse {}", file_path.display()))?;
    let mut resources = image
        .resource_directory()
        .cloned()
        .context("Expected one Windows version resource, received 0.")?;
    let mut version_info = resources
        .get_version_info()
        .context("failed to read Windows version resource")?
        .context("Expected one Windows version resource, received 0.")?;
    apply_metadata(
        &mut version_info,
        kind,
        file_path
            .file_name()
            .context("Windows artifact path must have a file name")?
            .to_string_lossy()
            .as_ref(),
        version,
        time::OffsetDateTime::now_utc().year(),
        numeric_version,
    )?;
    resources
        .set_version_info(&version_info)
        .context("failed to update Windows version resource")?;
    image
        .set_resource_directory(resources)
        .context("failed to update Windows executable resources")?;
    image
        .write_file(file_path)
        .with_context(|| format!("failed to write {}", file_path.display()))?;
    println!(
        "{}",
        serde_json::to_string(&read_windows_metadata(file_path)?)?
    );
    Ok(())
}

fn read_windows_metadata(file_path: &Path) -> anyhow::Result<BTreeMap<String, String>> {
    let image = Image::parse_file(file_path)
        .with_context(|| format!("failed to parse {}", file_path.display()))?;
    let version_info = image
        .resource_directory()
        .context("Expected one Windows version resource, received 0.")?
        .get_version_info()
        .context("failed to read Windows version resource")?
        .context("Expected one Windows version resource, received 0.")?;
    anyhow::ensure!(
        version_info.strings.len() == 1,
        "Expected one Windows metadata language, received {}.",
        version_info.strings.len()
    );
    Ok(version_info.strings[0]
        .strings
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect())
}

fn apply_metadata(
    version_info: &mut VersionInfo,
    kind: WindowsArtifactKind,
    file_name: &str,
    version: &str,
    year: i32,
    numeric_version: [u16; 3],
) -> anyhow::Result<()> {
    anyhow::ensure!(
        version_info.strings.len() == 1,
        "Expected one Windows metadata language, received {}.",
        version_info.strings.len()
    );
    let fixed_version = VersionU32 {
        major: (u32::from(numeric_version[0]) << 16) | u32::from(numeric_version[1]),
        minor: u32::from(numeric_version[2]) << 16,
    };
    version_info.info.file_version = fixed_version;
    version_info.info.product_version = fixed_version;
    version_info.strings[0].strings.clear();
    version_info.strings[0]
        .strings
        .extend(metadata_for(kind, file_name, version, year));
    Ok(())
}

fn metadata_for(
    kind: WindowsArtifactKind,
    file_name: &str,
    version: &str,
    year: i32,
) -> BTreeMap<String, String> {
    let description = match kind {
        WindowsArtifactKind::App => PRODUCT_NAME,
        WindowsArtifactKind::Installer => "Tro Installer",
    };
    let internal_name = match kind {
        WindowsArtifactKind::App => PRODUCT_NAME,
        WindowsArtifactKind::Installer => "Tro Setup",
    };
    [
        ("CompanyName", PRODUCT_NAME.to_owned()),
        ("FileDescription", description.to_owned()),
        ("FileVersion", version.to_owned()),
        ("InternalName", internal_name.to_owned()),
        (
            "LegalCopyright",
            format!("Copyright © {year} Tro contributors"),
        ),
        ("OriginalFilename", file_name.to_owned()),
        ("ProductName", PRODUCT_NAME.to_owned()),
        ("ProductVersion", version.to_owned()),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_owned(), value))
    .collect()
}

fn parse_version(version: &str) -> anyhow::Result<[u16; 3]> {
    static VERSION_PATTERN: OnceLock<Regex> = OnceLock::new();
    let pattern = VERSION_PATTERN.get_or_init(|| {
        Regex::new(r"^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$")
            .expect("release version pattern")
    });
    let captures = pattern
        .captures(version)
        .ok_or_else(|| anyhow::anyhow!("Invalid release version: {version}"))?;
    let mut numeric_version = [0_u16; 3];
    for (index, value) in numeric_version.iter_mut().enumerate() {
        let component: u32 = captures[index + 1]
            .parse()
            .map_err(|_| anyhow::anyhow!("Windows version components must be at most 65535."))?;
        *value = u16::try_from(component)
            .map_err(|_| anyhow::anyhow!("Windows version components must be at most 65535."))?;
    }
    Ok(numeric_version)
}

#[cfg(test)]
mod tests {
    use editpe::VersionStringTable;

    use super::*;

    #[test]
    fn release_metadata_is_constrained_and_round_trips() {
        let mut version_info = VersionInfo::default();
        version_info.strings.push(VersionStringTable {
            key: "040904b0".to_owned(),
            ..VersionStringTable::default()
        });
        apply_metadata(
            &mut version_info,
            WindowsArtifactKind::Installer,
            "Tro-0.1.0 Setup.exe",
            "0.1.0",
            2026,
            [0, 1, 0],
        )
        .expect("metadata");
        let parsed = VersionInfo::parse(&version_info.try_build().expect("version bytes"))
            .expect("parsed version");
        let strings = &parsed.strings[0].strings;
        assert_eq!(strings["CompanyName"], "Tro");
        assert_eq!(strings["FileDescription"], "Tro Installer");
        assert_eq!(strings["FileVersion"], "0.1.0");
        assert_eq!(strings["InternalName"], "Tro Setup");
        assert_eq!(strings["OriginalFilename"], "Tro-0.1.0 Setup.exe");
        assert_eq!(strings["ProductName"], "Tro");
        assert_eq!(strings["ProductVersion"], "0.1.0");
    }

    #[test]
    fn release_versions_reject_non_semantic_and_out_of_range_values() {
        assert!(parse_version("not-a-version").is_err());
        assert!(parse_version("70000.0.0").is_err());
        assert_eq!(parse_version("1.2.3-beta.1+build.7").ok(), Some([1, 2, 3]));
    }
}
