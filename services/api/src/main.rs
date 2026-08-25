#![forbid(unsafe_code)]
use clap::{Parser, Subcommand};
use trocode_api::{app, cli, config::Config, observability};

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
    AccessCode {
        #[command(subcommand)]
        command: AccessCodeCommand,
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    observability::init();
    let arguments = Arguments::parse();
    match arguments.command {
        Command::Serve => app::serve(Config::from_env()?).await,
        Command::IngestionWorker => app::ingestion_worker(Config::from_env()?).await,
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
        Command::KnowledgeLoadReport => {
            cli::knowledge_load_report();
            Ok(())
        }
        Command::KnowledgeWorkerSmoke => cli::knowledge_worker_smoke(),
    }
}
