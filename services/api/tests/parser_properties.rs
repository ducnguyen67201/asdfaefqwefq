use proptest::prelude::*;
use serde_json::json;
use trocode_api::{auth::stable_json, providers::parse_pcm_wav};

proptest! {
    #[test]
    fn arbitrary_bytes_never_panic_the_wav_parser(bytes in prop::collection::vec(any::<u8>(), 0..2_000)) {
        let _ = parse_pcm_wav(&bytes, None);
    }

    #[test]
    fn stable_json_is_independent_of_object_insertion_order(a in any::<i64>(), b in any::<i64>()) {
        let left = json!({"b": b, "a": {"z": a, "c": b}});
        let right: serde_json::Value = serde_json::from_str(&format!(r#"{{"a":{{"c":{b},"z":{a}}},"b":{b}}}"#)).expect("json");
        prop_assert_eq!(stable_json(&left).expect("left"), stable_json(&right).expect("right"));
    }
}
