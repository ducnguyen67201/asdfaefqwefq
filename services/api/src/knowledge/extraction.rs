use serde::Serialize;
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

use crate::error::{ApiError, ApiResult};

const MAX_CHUNKS: usize = 5_000;
const MAX_PAGES: usize = 500;
const MAX_TEXT: usize = 2_000_000;
#[derive(Clone, Debug)]
pub struct Page {
    pub page: usize,
    pub text: String,
}
#[derive(Clone, Debug)]
pub struct Extracted {
    pub pages: Vec<Page>,
    pub page_count: usize,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    pub ordinal: usize,
    pub locator: Locator,
    pub body: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Locator {
    pub page: usize,
    pub start_character: usize,
}

pub fn verify_sha256(bytes: &[u8], expected: &str) -> bool {
    format!("{:x}", Sha256::digest(bytes)) == expected
}
pub fn extract_text(bytes: &[u8]) -> ApiResult<Extracted> {
    let text = String::from_utf8(bytes.to_vec())
        .map_err(|_| {
            ApiError::coded(
                http::StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_text",
                "Text source is not valid UTF-8.",
            )
        })?
        .replace('\0', "")
        .nfc()
        .collect::<String>();
    if text.trim().is_empty() {
        return Err(ApiError::coded(
            http::StatusCode::UNPROCESSABLE_ENTITY,
            "empty_text",
            "Text is empty.",
        ));
    }
    if text.chars().count() > MAX_TEXT {
        return Err(ApiError::coded(
            http::StatusCode::UNPROCESSABLE_ENTITY,
            "extracted_text_too_large",
            "Extracted text is too large.",
        ));
    }
    Ok(Extracted {
        pages: vec![Page { page: 1, text }],
        page_count: 1,
    })
}
pub fn extract_pdf(bytes: &[u8]) -> ApiResult<Extracted> {
    extract_pdf_inner(bytes)
}
fn extract_pdf_inner(bytes: &[u8]) -> ApiResult<Extracted> {
    if !bytes.starts_with(b"%PDF-") {
        return Err(ApiError::coded(
            http::StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_pdf",
            "PDF signature is invalid.",
        ));
    }
    let text = pdf_extract::extract_text_from_mem(bytes).map_err(|error| {
        let message = error.to_string();
        if message.to_ascii_lowercase().contains("encrypt")
            || message.to_ascii_lowercase().contains("password")
        {
            ApiError::coded(
                http::StatusCode::UNPROCESSABLE_ENTITY,
                "encrypted_pdf_unsupported",
                "Encrypted PDFs are not supported.",
            )
        } else {
            ApiError::coded(
                http::StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_pdf",
                "PDF could not be extracted.",
            )
        }
    })?;
    let mut pages: Vec<Page> = text
        .split('\u{c}')
        .enumerate()
        .map(|(index, text)| Page {
            page: index + 1,
            text: text
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .nfc()
                .collect(),
        })
        .collect();
    if pages.last().is_some_and(|page| page.text.is_empty()) && pages.len() > 1 {
        pages.pop();
    }
    if pages.len() > MAX_PAGES {
        return Err(ApiError::coded(
            http::StatusCode::UNPROCESSABLE_ENTITY,
            "pdf_page_limit",
            "PDF has too many pages.",
        ));
    }
    if !pages.iter().any(|page| !page.text.is_empty()) {
        return Err(ApiError::coded(
            http::StatusCode::UNPROCESSABLE_ENTITY,
            "scanned_pdf_unsupported",
            "PDF contains no extractable text.",
        ));
    }
    if pages
        .iter()
        .map(|page| page.text.chars().count())
        .sum::<usize>()
        > MAX_TEXT
    {
        return Err(ApiError::coded(
            http::StatusCode::UNPROCESSABLE_ENTITY,
            "extracted_text_too_large",
            "Extracted PDF text is too large.",
        ));
    }
    let page_count = pages.len();
    Ok(Extracted { pages, page_count })
}
pub fn chunk_pages(pages: &[Page]) -> ApiResult<Vec<Chunk>> {
    let mut chunks = Vec::new();
    for page in pages {
        let chars: Vec<char> = page.text.trim().chars().collect();
        let mut start = 0;
        while start < chars.len() {
            let end = (start + 1_200).min(chars.len());
            let body: String = chars[start..end]
                .iter()
                .collect::<String>()
                .trim()
                .to_owned();
            if !body.is_empty() {
                if chunks.len() >= MAX_CHUNKS {
                    return Err(ApiError::coded(
                        http::StatusCode::UNPROCESSABLE_ENTITY,
                        "chunk_limit",
                        "Source produced too many chunks.",
                    ));
                }
                chunks.push(Chunk {
                    ordinal: chunks.len(),
                    locator: Locator {
                        page: page.page,
                        start_character: start,
                    },
                    body,
                });
            }
            if end == chars.len() {
                break;
            }
            start = start.saturating_add(1_050);
        }
    }
    Ok(chunks)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chunks_overlap() {
        let input = "x".repeat(2_000);
        let chunks = chunk_pages(&[Page {
            page: 1,
            text: input,
        }])
        .expect("chunks");
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[1].locator.start_character, 1050);
    }
    #[test]
    fn text_rejects_empty() {
        assert!(extract_text(b" \0 ").is_err());
    }

    #[test]
    fn extraction_boundaries_fail_closed_and_normalize_text() {
        let extracted = extract_text("Cafe\u{301}\0 notes".as_bytes()).expect("valid text");
        assert_eq!(extracted.page_count, 1);
        assert_eq!(extracted.pages[0].text, "Café notes");
        assert!(extract_text(&[0xff, 0xfe]).is_err());
        assert!(extract_text("x".repeat(MAX_TEXT + 1).as_bytes()).is_err());
        assert!(extract_pdf(b"not-a-pdf").is_err());
        assert!(extract_pdf(b"%PDF-malformed").is_err());
        assert!(verify_sha256(
            b"fixture",
            "f16d05ec6b29248d2c61adb1e9263f78e4f7bace1b955014a2d17872cfe4064d"
        ));
        assert!(!verify_sha256(b"fixture", &"0".repeat(64)));
    }

    #[test]
    fn chunking_preserves_page_locators_and_enforces_the_global_limit() {
        let chunks = chunk_pages(&[
            Page {
                page: 2,
                text: "  first page  ".to_owned(),
            },
            Page {
                page: 7,
                text: "second page".to_owned(),
            },
        ])
        .expect("bounded pages");
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].locator.page, 2);
        assert_eq!(chunks[1].locator.page, 7);

        let excessive = (0..=MAX_CHUNKS)
            .map(|page| Page {
                page: page + 1,
                text: "x".to_owned(),
            })
            .collect::<Vec<_>>();
        let error = chunk_pages(&excessive).expect_err("chunk limit must fail");
        assert_eq!(error.code, Some("chunk_limit"));
    }
}
