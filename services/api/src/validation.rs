use uuid::Uuid;

#[must_use]
pub fn js_string_len(value: &str) -> usize {
    value.encode_utf16().count()
}

#[must_use]
pub fn truncate_js_string(value: &str, max_code_units: usize) -> String {
    let mut used = 0usize;
    value
        .chars()
        .take_while(|character| {
            let next = character.len_utf16();
            if used.saturating_add(next) > max_code_units {
                false
            } else {
                used += next;
                true
            }
        })
        .collect()
}

#[must_use]
pub fn api_uuid(value: &str) -> Option<Uuid> {
    parse_uuid(value, false)
}

#[must_use]
pub fn zod_uuid(value: &str) -> Option<Uuid> {
    parse_uuid(value, true)
}

fn parse_uuid(value: &str, allow_sentinels: bool) -> Option<Uuid> {
    let bytes = value.as_bytes();
    if bytes.len() != 36
        || bytes[8] != b'-'
        || bytes[13] != b'-'
        || bytes[18] != b'-'
        || bytes[23] != b'-'
        || bytes
            .iter()
            .enumerate()
            .any(|(index, byte)| !matches!(index, 8 | 13 | 18 | 23) && !byte.is_ascii_hexdigit())
    {
        return None;
    }
    let sentinel = value.eq_ignore_ascii_case("00000000-0000-0000-0000-000000000000")
        || value.eq_ignore_ascii_case("ffffffff-ffff-ffff-ffff-ffffffffffff");
    let version = bytes[14];
    let variant = bytes[19].to_ascii_lowercase();
    if !(allow_sentinels && sentinel)
        && (!(b'1'..=b'8').contains(&version) || !matches!(variant, b'8' | b'9' | b'a' | b'b'))
    {
        return None;
    }
    Uuid::parse_str(value).ok()
}

#[cfg(test)]
mod tests {
    use super::{api_uuid, js_string_len, truncate_js_string, zod_uuid};

    #[test]
    fn javascript_length_counts_utf16_code_units() {
        assert_eq!(js_string_len("Tro"), 3);
        assert_eq!(js_string_len("Tiếng Việt"), 10);
        assert_eq!(js_string_len("😀"), 2);
    }

    #[test]
    fn uuid_parsers_match_api_and_zod_contracts() {
        for value in [
            "01234567-89ab-4def-8123-456789abcdef",
            "01234567-89AB-8DEF-B123-456789ABCDEF",
        ] {
            assert!(api_uuid(value).is_some());
            assert!(zod_uuid(value).is_some());
        }
        for value in [
            "01234567-89ab-0def-8123-456789abcdef",
            "01234567-89ab-4def-7123-456789abcdef",
            "0123456789ab4def8123456789abcdef",
        ] {
            assert!(api_uuid(value).is_none());
            assert!(zod_uuid(value).is_none());
        }
        for value in [
            "00000000-0000-0000-0000-000000000000",
            "ffffffff-ffff-ffff-ffff-ffffffffffff",
        ] {
            assert!(api_uuid(value).is_none());
            assert!(zod_uuid(value).is_some());
        }
    }

    #[test]
    fn javascript_truncation_respects_utf16_code_units() {
        assert_eq!(truncate_js_string("ab😀cd", 4), "ab😀");
        assert_eq!(truncate_js_string("ab😀cd", 3), "ab");
    }
}
