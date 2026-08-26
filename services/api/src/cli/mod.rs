use std::time::Instant;

use rand::RngCore;
use serde_json::json;

use crate::{
    auth::{digest_access_code, seal_access_code},
    config::Config,
    db,
    knowledge::{chunk_pages, extract_text},
    usage::plan_for,
};

pub async fn create_access_code(
    config: &Config,
    code: Option<String>,
    label: Option<String>,
    max_users: i32,
    plan: &str,
) -> anyhow::Result<()> {
    if max_users < 1 {
        anyhow::bail!("--max-users must be a positive integer.")
    }
    plan_for(plan).map_err(|_| anyhow::anyhow!("--plan must be one of: free, basic, pro, max."))?;
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
    let digest = digest_access_code(&code, &config.session_token_hmac_key)?.ok_or_else(|| {
        anyhow::anyhow!(
            "Access codes must contain 4 to 64 letters, numbers, hyphens, or underscores."
        )
    })?;
    let sealed = seal_access_code(&code, &config.session_token_hmac_key, &digest)?;
    let pool = db::connect(config).await?;
    db::migrate(&pool).await?;
    let result=sqlx::query("INSERT INTO access_codes(code_digest,code_ciphertext,label,max_users,plan)VALUES($1,$2,$3,$4,$5)RETURNING id").bind(digest.to_vec()).bind(sealed).bind(label.as_deref()).bind(max_users).bind(plan).fetch_one(&pool).await;
    match result {
        Ok(row) => {
            use sqlx::Row;
            println!("Created access code {}.", row.get::<uuid::Uuid, _>("id"));
            println!("Code: {code}");
            println!("User limit: {max_users}");
            println!("Plan: {plan}");
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
        let config = Config {
            admin: crate::config::AdminConfig { access_token: None },
            agent_runtime: crate::config::AgentRuntimeConfig {
                canary_users: std::collections::BTreeSet::new(),
                compaction_item_threshold: 80,
                current_encryption_key_version: 1,
                enabled: false,
                encryption_keys: None,
                heartbeat_ttl_ms: 35_000,
                intent_authorization: crate::config::RolloutConfig {
                    canary_users: std::collections::BTreeSet::new(),
                    enabled: false,
                    rollout_percent: 0,
                },
                lease_ms: 30_000,
                max_active_runs_per_user: 2,
                max_queue_depth: 1_000,
                payload_ttl_ms: 604_800_000,
                playwright_cdp_enabled: false,
                protocol_version: 2,
                rollout_percent: 0,
            },
            cost_guard: crate::config::CostGuardConfig {
                daily_micro_usd: 8_000_000,
                enabled: true,
                mode: crate::config::CostGuardMode::Enforce,
                monthly_micro_usd: 45_000_000,
                realtime_call_micro_usd: 5_000,
                reservation_ttl_ms: 120_000,
                speech_micro_usd_per_thousand_characters: 60_000,
                task_micro_usd: 5_000_000,
                transcription_micro_usd_per_minute: 6_000,
                warning_percent: 80,
            },
            database_pool_max: 1,
            database_url: "postgresql://unused.invalid/unused".to_owned(),
            eleven_labs_api_key: None,
            eleven_labs_model_id: "eleven_multilingual_v2".to_owned(),
            eleven_labs_voice_id: None,
            google_client_id: "unused".to_owned(),
            knowledge_spaces: crate::config::KnowledgeConfig {
                enabled: false,
                object_store: None,
            },
            openai_api_key: "unused".to_owned(),
            openai_models: std::collections::BTreeSet::new(),
            port: 0,
            railway_git_commit_sha: "test".to_owned(),
            session_duration_days: 30,
            session_token_hmac_key: "cli_test_hmac_key_0123456789abcdef".to_owned(),
        };
        assert!(
            create_access_code(&config, None, None, 0, "basic")
                .await
                .is_err()
        );
        assert!(
            create_access_code(&config, None, None, 1, "enterprise")
                .await
                .is_err()
        );
        assert!(
            create_access_code(&config, Some("bad code!".to_owned()), None, 1, "basic")
                .await
                .is_err()
        );
    }
}
