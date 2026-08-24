use std::{future::IntoFuture, net::SocketAddr, sync::Arc, time::Duration};

use sqlx::PgPool;
use tokio_util::sync::CancellationToken;

use crate::{
    agent::AgentService,
    auth::{AccessCodeRepository, AgentStateCrypto, GoogleVerifier, SessionRepository},
    config::Config,
    db,
    error::ApiError,
    http,
    knowledge::{IngestionWorker, KnowledgeService, ObjectStore},
    providers::{ResponsesService, TranscriptionService},
    usage::{BudgetService, RateLimiter},
};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub pool: PgPool,
    pub sessions: SessionRepository,
    pub access_codes: AccessCodeRepository,
    pub rate_limiter: RateLimiter,
    pub budget: BudgetService,
    pub responses: ResponsesService,
    pub transcription: TranscriptionService,
    pub google: GoogleVerifier,
    pub knowledge: KnowledgeService,
    pub agent: Option<AgentService>,
    pub shutdown: CancellationToken,
}

impl AppState {
    pub async fn compose(config: Config) -> Result<Self, ApiError> {
        let pool = db::connect(&config).await?;
        db::migrate(&pool).await?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(ApiError::internal)?;
        let budget = BudgetService::new(pool.clone(), config.cost_guard.clone());
        let responses =
            ResponsesService::new(budget.clone(), client.clone(), &config.openai_api_key);
        let store = match &config.knowledge_spaces.object_store {
            Some(value) => Some(ObjectStore::new(value).await),
            None => None,
        };
        let knowledge = KnowledgeService::new(pool.clone(), store, &config.session_token_hmac_key);
        let agent = match &config.agent_runtime.encryption_keys {
            Some(keys) => Some(AgentService::new(
                pool.clone(),
                AgentStateCrypto::parse(keys, config.agent_runtime.current_encryption_key_version)?,
                responses.clone(),
                config.agent_runtime.clone(),
                &config.session_token_hmac_key,
                &config.openai_models,
                config.cost_guard.mode,
            )),
            None => None,
        };
        Ok(Self {
            sessions: SessionRepository::new(
                pool.clone(),
                &config.session_token_hmac_key,
                config.session_duration_days,
            ),
            access_codes: AccessCodeRepository::new(pool.clone(), &config.session_token_hmac_key),
            rate_limiter: RateLimiter::new(pool.clone(), &config.session_token_hmac_key),
            transcription: TranscriptionService::new(
                budget.clone(),
                client.clone(),
                &config.openai_api_key,
            ),
            google: GoogleVerifier::new(client),
            config: Arc::new(config),
            pool,
            budget,
            responses,
            knowledge,
            agent,
            shutdown: CancellationToken::new(),
        })
    }
}

pub async fn serve(config: Config) -> anyhow::Result<()> {
    let state = AppState::compose(config).await?;
    let cancel = state.shutdown.clone();
    if let Some(agent) = state.agent.clone() {
        let token = cancel.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(250));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {()=token.cancelled()=>break,_=interval.tick()=>{if let Err(error)=agent.run_once().await{tracing::error!(event="agent.worker.failed",error=%error);}}}
            }
        });
    }
    let address = SocketAddr::from(([0, 0, 0, 0], state.config.port));
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(event = "server.ready", port = state.config.port);
    let router = http::router(state.clone());
    let graceful = cancel.clone();
    let mut server = Box::pin(
        axum::serve(listener, router)
            .with_graceful_shutdown(graceful.cancelled_owned())
            .into_future(),
    );
    tokio::select! {result=&mut server=>result?,()=shutdown_signal()=>{tracing::info!(event="server.stopping");cancel.cancel();match tokio::time::timeout(Duration::from_secs(30),&mut server).await{Ok(result)=>result?,Err(_)=>tracing::warn!(event="server.shutdown_timeout")}}}
    state.pool.close().await;
    Ok(())
}
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("signal");
        tokio::select! {result=tokio::signal::ctrl_c()=>{let _=result;},_=terminate.recv()=>{}}
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

pub async fn ingestion_worker(config: Config) -> anyhow::Result<()> {
    let state = AppState::compose(config).await?;
    let store = state
        .knowledge
        .object_store
        .clone()
        .ok_or_else(|| anyhow::anyhow!("Knowledge object storage is not configured."))?;
    let worker = IngestionWorker::new(state.pool.clone(), store);
    let signal = shutdown_signal();
    tokio::pin!(signal);
    loop {
        tokio::select! {()=&mut signal=>{tracing::info!(event="ingestion_worker.stopping");break},result=worker.run_once()=>{if !result?{tokio::time::sleep(Duration::from_secs(1)).await;}}}
    }
    state.pool.close().await;
    Ok(())
}
