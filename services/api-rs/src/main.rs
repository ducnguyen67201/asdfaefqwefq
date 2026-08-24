use std::{env, error::Error, io};

use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::EnvFilter;
use trocode_api::{app, parse_port, version_from_value};

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
    let listener = TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|error| io::Error::new(error.kind(), "failed to bind API listener"))?;

    info!(event = "server.ready", port, "server ready");
    axum::serve(listener, app(version))
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
