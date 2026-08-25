use std::time::Duration;

use trocode_api::{
    auth::{OrganizationRepository, normalize_organization_email, organization_capacity},
    db,
    postgres::PgPoolOptions,
    query, query_scalar,
};
use url::Url;
use uuid::Uuid;

const MIGRATION: &str = include_str!("../migrations/021_organization_managed_access.sql");

fn disposable_database_url() -> String {
    let value = std::env::var("TEST_DATABASE_URL")
        .expect("TEST_DATABASE_URL is required for this ignored integration test");
    let parsed = Url::parse(&value).expect("TEST_DATABASE_URL must be a URL");
    let local = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"));
    let test_database = parsed.path().trim_start_matches('/').ends_with("_test");
    assert!(
        local && test_database,
        "refusing to use a database that is not local and suffixed _test"
    );
    value
}

#[test]
fn normalizes_verified_email_without_changing_its_display_form() {
    assert_eq!(
        normalize_organization_email("Teacher@Example.COM"),
        Some((
            "Teacher@Example.COM".to_owned(),
            "teacher@example.com".to_owned(),
        )),
    );

    for invalid in [
        "missing-domain",
        "two@@example.com",
        "space @example.com",
        "user@localhost",
        "user@.example.com",
    ] {
        assert_eq!(normalize_organization_email(invalid), None, "{invalid}");
    }
}

#[test]
fn pending_and_active_members_share_the_same_capacity_policy() {
    let available = organization_capacity(10, 3);
    assert_eq!(available.assigned_seats, 3);
    assert_eq!(available.max_seats, 10);
    assert_eq!(available.remaining_seats, 7);
    assert_eq!(available.state, "available");

    let full = organization_capacity(10, 10);
    assert_eq!(full.remaining_seats, 0);
    assert_eq!(full.state, "full");

    let defensive_overage = organization_capacity(10, 11);
    assert_eq!(defensive_overage.remaining_seats, 0);
    assert_eq!(defensive_overage.state, "full");
}

#[test]
fn migration_preserves_shared_rollback_and_organization_invariants() {
    for required in [
        "DEFAULT 'shared'",
        "distribution_mode IN ('shared', 'organization')",
        "CREATE TABLE IF NOT EXISTS organizations",
        "CREATE TABLE IF NOT EXISTS organization_memberships",
        "organization_memberships_email_active_uidx",
        "organization_memberships_user_active_uidx",
        "organization_memberships_organizer_uidx",
        "CREATE TABLE IF NOT EXISTS organization_audit_events",
        "CREATE TRIGGER access_code_redemptions_organization_membership_trigger",
        "organization-managed access requires active membership",
        "organization.member_added",
        "organization.member_joined",
        "organization.pending_cancelled",
    ] {
        assert!(
            MIGRATION.contains(required),
            "missing migration invariant: {required}"
        );
    }
}

#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn concurrent_last_seat_assignment_never_exceeds_capacity() {
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&disposable_database_url())
        .await
        .expect("connect to disposable PostgreSQL");
    db::migrate(&pool).await.expect("apply migrations");

    let nonce = Uuid::new_v4();
    let organizer_id = format!("organization-test-{nonce}");
    let organizer_email = format!("organizer-{nonce}@example.test");
    query("INSERT INTO users(id,email,name)VALUES($1,$2,'Organizer')")
        .bind(&organizer_id)
        .bind(&organizer_email)
        .execute(&pool)
        .await
        .expect("insert organizer");

    let mut digest = Vec::with_capacity(32);
    digest.extend_from_slice(nonce.as_bytes());
    digest.extend_from_slice(nonce.as_bytes());
    let access_code_id: Uuid = query_scalar("INSERT INTO access_codes(code_digest,label,max_users,plan,distribution_mode)VALUES($1,'Concurrent capacity',2,'pro','organization')RETURNING id")
        .bind(digest)
        .fetch_one(&pool)
        .await
        .expect("insert organization access code");
    let organization_id: Uuid = query_scalar(
        "INSERT INTO organizations(access_code_id,name)VALUES($1,'Concurrent capacity')RETURNING id",
    )
    .bind(access_code_id)
    .fetch_one(&pool)
    .await
    .expect("insert organization");
    query("INSERT INTO organization_memberships(organization_id,email,email_normalized,user_id,role,invited_by_user_id,joined_at)VALUES($1,$2,LOWER($2),$3,'organizer',$3,NOW())")
        .bind(organization_id)
        .bind(&organizer_email)
        .bind(&organizer_id)
        .execute(&pool)
        .await
        .expect("insert organizer membership");
    query("INSERT INTO access_code_redemptions(user_id,access_code_id)VALUES($1,$2)")
        .bind(&organizer_id)
        .bind(access_code_id)
        .execute(&pool)
        .await
        .expect("insert organizer redemption");

    let repository = OrganizationRepository::new(pool.clone());
    let first_email = format!("first-{nonce}@example.test");
    let second_email = format!("second-{nonce}@example.test");
    let (first, second) = tokio::join!(
        repository.add_member(&organizer_id, &first_email),
        repository.add_member(&organizer_id, &second_email),
    );
    let results = [first, second];
    let successful = results.iter().filter(|result| result.is_ok()).count();
    let capacity_conflicts = results
        .iter()
        .filter(|result| {
            result
                .as_ref()
                .is_err_and(|error| error.code == Some("organization_capacity_reached"))
        })
        .count();
    let assigned: i64 = query_scalar("SELECT COUNT(*)::bigint FROM organization_memberships WHERE organization_id=$1 AND removed_at IS NULL")
        .bind(organization_id)
        .fetch_one(&pool)
        .await
        .expect("count assigned seats");

    query("DELETE FROM organization_audit_events WHERE organization_id=$1")
        .bind(organization_id)
        .execute(&pool)
        .await
        .expect("clean audit rows");
    query("DELETE FROM access_code_redemptions WHERE access_code_id=$1")
        .bind(access_code_id)
        .execute(&pool)
        .await
        .expect("clean redemptions");
    query("DELETE FROM organization_memberships WHERE organization_id=$1")
        .bind(organization_id)
        .execute(&pool)
        .await
        .expect("clean memberships");
    query("DELETE FROM organizations WHERE id=$1")
        .bind(organization_id)
        .execute(&pool)
        .await
        .expect("clean organization");
    query("DELETE FROM access_codes WHERE id=$1")
        .bind(access_code_id)
        .execute(&pool)
        .await
        .expect("clean access code");
    query("DELETE FROM users WHERE id=$1")
        .bind(&organizer_id)
        .execute(&pool)
        .await
        .expect("clean organizer");

    assert_eq!(successful, 1);
    assert_eq!(capacity_conflicts, 1);
    assert_eq!(assigned, 2, "organizer plus exactly one pending member");
}
