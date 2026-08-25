#![forbid(unsafe_code)]
use std::path::PathBuf;

use clap::{Parser, Subcommand};
use trocode_api::{app, cli, config::Config, desktop_engine, observability};

#[derive(Parser)]
#[command(name = "trocode-api", version, about = "Tro hosted backend")]
struct Arguments {
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Serve,
    IngestionWorker,
    DesktopEngine,
    AccessCode {
        #[command(subcommand)]
        command: AccessCodeCommand,
    },
    AgentRuntimeVersions {
        #[arg(long, default_value = ".")]
        repository_root: PathBuf,
    },
    RustOnlyCheck {
        #[arg(long, default_value = ".")]
        repository_root: PathBuf,
    },
    AgentBenchmark {
        #[arg(long)]
        baseline: PathBuf,
        #[arg(long)]
        candidate: PathBuf,
        #[arg(long)]
        json: bool,
    },
    CuaReport {
        #[arg(long)]
        baseline: PathBuf,
        #[arg(long)]
        candidate: PathBuf,
        #[arg(long)]
        json: bool,
    },
    CostReport {
        #[arg(long, default_value = "test/fixtures/inference-cost/call-shapes.json")]
        fixture: PathBuf,
    },
    Membership {
        #[command(subcommand)]
        command: MembershipCommand,
    },
    WindowsReleaseMetadata {
        #[arg(long)]
        file: PathBuf,
        #[arg(long)]
        kind: cli::WindowsArtifactKind,
        #[arg(long)]
        version: String,
    },
    KnowledgeLoadReport,
    KnowledgeWorkerSmoke,
}
#[derive(Subcommand)]
enum AccessCodeCommand {
    Create {
        #[arg(long)]
        code: Option<String>,
        #[arg(long, default_value = "organization")]
        distribution_mode: String,
        #[arg(long)]
        label: Option<String>,
        #[arg(long)]
        max_users: i32,
        #[arg(long)]
        plan: String,
    },
}
#[derive(Subcommand)]
enum MembershipCommand {
    Keygen {
        #[arg(long)]
        private_key: PathBuf,
        #[arg(long)]
        public_key: Option<PathBuf>,
    },
    Issue {
        #[arg(long)]
        private_key: PathBuf,
        #[arg(long)]
        reference: String,
        #[arg(long, value_parser = clap::value_parser!(u16).range(1..=3650))]
        days: u16,
        #[arg(long)]
        now: Option<String>,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let arguments = Arguments::parse();
    if matches!(&arguments.command, Command::DesktopEngine) {
        return std::thread::spawn(desktop_engine::run)
            .join()
            .map_err(|_| anyhow::anyhow!("Rust desktop engine thread failed."))?;
    }
    observability::init();
    match arguments.command {
        Command::Serve => app::serve(Config::from_env()?).await,
        Command::IngestionWorker => app::ingestion_worker(Config::from_env()?).await,
        Command::DesktopEngine => unreachable!("handled before tracing initialization"),
        Command::AccessCode {
            command:
                AccessCodeCommand::Create {
                    code,
                    distribution_mode,
                    label,
                    max_users,
                    plan,
                },
        } => cli::create_access_code(code, label, max_users, &plan, &distribution_mode).await,
        Command::AgentRuntimeVersions { repository_root } => {
            cli::check_agent_runtime_versions(&repository_root)
        }
        Command::RustOnlyCheck { repository_root } => {
            cli::check_rust_only_script_layout(&repository_root)
        }
        Command::AgentBenchmark {
            baseline,
            candidate,
            json,
        } => cli::agent_reliability_report(&baseline, &candidate, json),
        Command::CuaReport {
            baseline,
            candidate,
            json,
        } => cli::cua_fast_path_report(&baseline, &candidate, json),
        Command::CostReport { fixture } => cli::inference_cost_report(&fixture),
        Command::Membership {
            command:
                MembershipCommand::Keygen {
                    private_key,
                    public_key,
                },
        } => cli::membership_keygen(&private_key, public_key.as_deref()),
        Command::Membership {
            command:
                MembershipCommand::Issue {
                    private_key,
                    reference,
                    days,
                    now,
                },
        } => cli::membership_issue(&private_key, &reference, days, now.as_deref()),
        Command::WindowsReleaseMetadata {
            file,
            kind,
            version,
        } => cli::stamp_windows_executable(&file, kind, &version),
        Command::KnowledgeLoadReport => {
            cli::knowledge_load_report();
            Ok(())
        }
        Command::KnowledgeWorkerSmoke => cli::knowledge_worker_smoke(),
    }
}
