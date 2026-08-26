#![forbid(unsafe_code)]

extern crate self as sqlx;

pub use sqlx_core::{
    Error, migrate, query::query, query_scalar::query_scalar, row::Row, transaction::Transaction,
};
pub use sqlx_postgres::{PgPool, Postgres};

pub mod postgres {
    pub use sqlx_postgres::{PgPoolOptions, PgRow};
}

pub mod agent;
pub mod app;
pub mod auth;
pub mod classroom;
pub mod cli;
pub mod config;
pub mod db;
pub mod desktop_engine;
pub mod error;
pub mod http;
pub mod knowledge;
pub mod observability;
pub mod providers;
pub mod usage;
pub(crate) mod validation;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
