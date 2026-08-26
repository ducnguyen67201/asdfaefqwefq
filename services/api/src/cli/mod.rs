use std::{env, time::Duration, time::Instant};

use rand::RngCore;
use serde_json::json;

mod checks;
mod membership;
mod reports;
mod windows_release;

pub use checks::{check_agent_runtime_versions, check_rust_only_script_layout};
pub use membership::{membership_issue, membership_keygen};
pub use reports::{agent_reliability_report, cua_fast_path_report, inference_cost_report};
pub use windows_release::{WindowsArtifactKind, stamp_windows_executable};

use crate::{
    auth::{digest_access_code, normalize_access_code, seal_access_code},
    db,
    knowledge::{chunk_pages, extract_text},
    postgres::PgPoolOptions,
    usage::plan_for,
};

pub async fn create_access_code(
    code: Option<String>,
    label: Option<String>,
    max_users: i32,
    plan: &str,
    distribution_mode: &str,
) -> anyhow::Result<()> {
    if max_users < 1 {
        anyhow::bail!("--max-users must be a positive integer.")
    }
    plan_for(plan).map_err(|_| anyhow::anyhow!("--plan must be one of: free, basic, pro, max."))?;
    if !matches!(distribution_mode, "organization" | "shared") {
        anyhow::bail!("--distribution-mode must be organization or shared.")
    }
    let code = code
        .map(|value| value.trim().to_uppercase())
        .unwrap_or_else(|| {
            let mut bytes = [0u8; 12];
            rand::rng().fill_bytes(&mut bytes);
            format!(
                "TRO-{}",
                bytes
                    .iter()
                    .map(|value| format!("{value:02X}"))
                    .collect::<String>()
            )
        });
    let code = normalize_access_code(&code).ok_or_else(|| {
        anyhow::anyhow!(
            "Access codes must contain 4 to 64 letters, numbers, hyphens, or underscores."
        )
    })?;
    let label = label.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    });
    if label
        .as_ref()
        .is_some_and(|value| value.encode_utf16().count() > 100)
    {
        anyhow::bail!("--label must be at most 100 characters.")
    }
    let database_url = required_environment("DATABASE_URL")?;
    let session_token_hmac_key = required_environment("TROCODE_SESSION_TOKEN_HMAC_KEY")?;
    if session_token_hmac_key.len() < 32 {
        anyhow::bail!("TROCODE_SESSION_TOKEN_HMAC_KEY must be at least 32 characters.")
    }
    let digest = digest_access_code(&code, &session_token_hmac_key)?
        .ok_or_else(|| anyhow::anyhow!("Access code normalization failed."))?;
    let sealed = seal_access_code(&code, &session_token_hmac_key, &digest)?;
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(15))
        .connect(&database_url)
        .await?;
    db::migrate(&pool).await?;
    let result=sqlx::query("INSERT INTO access_codes(code_digest,code_ciphertext,label,max_users,plan,distribution_mode)VALUES($1,$2,$3,$4,$5,$6)RETURNING id").bind(digest.to_vec()).bind(sealed).bind(label.as_deref()).bind(max_users).bind(plan).bind(distribution_mode).fetch_one(&pool).await;
    match result {
        Ok(row) => {
            use sqlx::Row;
            println!("Created access code {}.", row.get::<uuid::Uuid, _>("id"));
            println!("Code: {code}");
            println!("User limit: {max_users}");
            println!("Plan: {plan}");
            println!("Distribution mode: {distribution_mode}");
            if let Some(label) = label {
                println!("Label: {label}");
            }
            println!(
                "Store the code securely; PostgreSQL keeps only its keyed HMAC digest and encrypted retrieval copy."
            );
        }
        Err(sqlx::Error::Database(error)) if error.code().as_deref() == Some("23505") => {
            anyhow::bail!("That access code already exists.")
        }
        Err(error) => return Err(error.into()),
    }
    pool.close().await;
    Ok(())
}

fn required_environment(name: &str) -> anyhow::Result<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!("{name} is required."))
}

pub fn knowledge_load_report() {
    for participants in [200, 500] {
        let mut durations = Vec::new();
        for _ in 0..500 {
            let started = Instant::now();
            let _: Vec<_> = (0..participants)
                .filter(|index| index % 19 == 0 || index % 23 == 0)
                .collect();
            durations.push(started.elapsed().as_secs_f64() * 1_000.0);
        }
        durations.sort_by(f64::total_cmp);
        let p95 = durations[(durations.len() * 95 / 100).min(durations.len() - 1)];
        println!(
            "{}",
            json!({"event":"knowledge.dashboard_projection_fixture","participantCount":participants,"p95Milliseconds":(p95*1_000.0).round()/1_000.0,"samples":durations.len()})
        );
    }
}
pub fn knowledge_worker_smoke() -> anyhow::Result<()> {
    let extracted = extract_text(b"Loops repeat a bounded block while a condition remains true.")?;
    let chunks = chunk_pages(&extracted.pages)?;
    if chunks.len() != 1 || !chunks[0].body.contains("Loops repeat") {
        anyhow::bail!("The worker produced an unexpected chunk set.")
    }
    println!("{}", json!({"event":"knowledge.worker_smoke_passed"}));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_knowledge_diagnostics_complete() {
        knowledge_load_report();
        knowledge_worker_smoke().expect("worker smoke test");
    }

    #[tokio::test]
    async fn access_code_command_rejects_invalid_arguments_before_database_access() {
        assert!(
            create_access_code(None, None, 0, "basic", "organization")
                .await
                .is_err()
        );
        assert!(
            create_access_code(None, None, 1, "enterprise", "organization")
                .await
                .is_err()
        );
        assert!(
            create_access_code(
                Some("bad code!".to_owned()),
                None,
                1,
                "basic",
                "organization",
            )
            .await
            .is_err()
        );
        assert!(
            create_access_code(None, Some("x".repeat(101)), 1, "basic", "organization")
                .await
                .is_err()
        );
        assert!(
            create_access_code(None, None, 1, "basic", "invalid")
                .await
                .is_err()
        );
    }
}
