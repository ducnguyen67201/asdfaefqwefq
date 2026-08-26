use serde_json::{Value, json};
use trocode_api::{auth::ConnectorTokenCrypto, connectors::catalog};

#[test]
fn committed_gmail_inventory_matches_the_reviewed_catalog() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/connectors/gmail-tools.json"))
        .expect("Gmail fixture");
    let definition = catalog::by_key("gmail").expect("reviewed Gmail connector");
    assert_eq!(definition.endpoint, fixture["endpoint"]);
    assert_eq!(definition.tools.len(), 10);
    for namespace in ["gmail_read", "gmail_organize"] {
        let actual = definition
            .tools
            .iter()
            .filter(|tool| tool.namespace == namespace)
            .map(|tool| Value::String(tool.name.to_owned()))
            .collect::<Vec<_>>();
        assert_eq!(Value::Array(actual), fixture["namespaces"][namespace]);
    }
    assert!(definition.tools.iter().all(|tool| {
        !["send", "delete", "trash"]
            .iter()
            .any(|fragment| tool.name.contains(fragment))
    }));
}

#[test]
fn connector_tokens_are_bound_to_connection_and_user_metadata() {
    let crypto = ConnectorTokenCrypto::parse("1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", 1)
        .expect("connector key");
    let metadata = json!({
        "catalogKey":"gmail",
        "connectionId":"11111111-1111-4111-8111-111111111111",
        "kind":"connector_tokens",
        "schemaVersion":1,
        "userId":"user-a"
    });
    let envelope = crypto
        .encrypt_json(&json!({"accessToken":"secret"}), &metadata)
        .unwrap();
    assert_eq!(
        crypto.decrypt_json(&envelope, &metadata).unwrap()["accessToken"],
        "secret"
    );
    let mut wrong_user = metadata.clone();
    wrong_user["userId"] = Value::String("user-b".to_owned());
    assert!(crypto.decrypt_json(&envelope, &wrong_user).is_err());
}
