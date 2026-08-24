use std::{env, error::Error, io, net::SocketAddr, sync::Arc};

use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::EnvFilter;
use trocode_api::database::PgPoolOptions;
use trocode_api::{
    app, app_with_classroom, classroom::ClassroomService, classroom_config_from_values, parse_port,
    version_from_value,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .json()
        .init();

    let port_value = env::var("PORT").ok();
    let port = parse_port(port_value.as_deref())?;
    let version_value = env::var("RAILWAY_GIT_COMMIT_SHA").ok();
    let version = version_from_value(version_value.as_deref());
    let classroom_enabled = env::var("TROCODE_KNOWLEDGE_SPACES_ENABLED").ok();
    let database_url = env::var("DATABASE_URL").ok();
    let hmac_key = env::var("TROCODE_SESSION_TOKEN_HMAC_KEY").ok();
    let pool_max = env::var("TROCODE_DATABASE_POOL_MAX").ok();
    let classroom = classroom_config_from_values(
        classroom_enabled.as_deref(),
        database_url.as_deref(),
        hmac_key.as_deref(),
        pool_max.as_deref(),
    )?;
    let router = if let Some(classroom) = classroom {
        let pool = PgPoolOptions::new()
            .max_connections(classroom.pool_max)
            .connect(&classroom.database_url)
            .await
            .map_err(|_| io::Error::other("failed to connect classroom database"))?;
        let service = Arc::new(ClassroomService::new(pool, classroom.session_hmac_key));
        service
            .verify_schema()
            .await
            .map_err(|_| io::Error::other("classroom database migration 018 is required"))?;
        info!(event = "classroom.enabled", "Rust classroom API enabled");
        app_with_classroom(version, service)
    } else {
        app(version)
    };
    let listener = TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|error| io::Error::new(error.kind(), "failed to bind API listener"))?;

    info!(event = "server.ready", port, "server ready");
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .map_err(|_| io::Error::other("API server stopped unexpectedly"))?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl-C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install termination signal handler")
            .recv()
            .await;
    };

    #[cfg(unix)]
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }

    #[cfg(not(unix))]
    ctrl_c.await;

    info!(event = "server.stopping", "server stopping");
}
