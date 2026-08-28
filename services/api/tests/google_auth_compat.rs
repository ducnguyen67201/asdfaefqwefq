use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde::Serialize;
use serde_json::json;
use trocode_api::auth::GoogleVerifier;
use wiremock::{Mock, MockServer, ResponseTemplate, matchers::path};

const PRIVATE_KEY: &str = r#"-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDJETqse41HRBsc
7cfcq3ak4oZWFCoZlcic525A3FfO4qW9BMtRO/iXiyCCHn8JhiL9y8j5JdVP2Q9Z
IpfElcFd3/guS9w+5RqQGgCR+H56IVUyHZWtTJbKPcwWXQdNUX0rBFcsBzCRESJL
eelOEdHIjG7LRkx5l/FUvlqsyHDVJEQsHwegZ8b8C0fz0EgT2MMEdn10t6Ur1rXz
jMB/wvCg8vG8lvciXmedyo9xJ8oMOh0wUEgxziVDMMovmC+aJctcHUAYubwoGN8T
yzcvnGqL7JSh36Pwy28iPzXZ2RLhAyJFU39vLaHdljwthUaupldlNyCfa6Ofy4qN
ctlUPlN1AgMBAAECggEAdESTQjQ70O8QIp1ZSkCYXeZjuhj081CK7jhhp/4ChK7J
GlFQZMwiBze7d6K84TwAtfQGZhQ7km25E1kOm+3hIDCoKdVSKch/oL54f/BK6sKl
qlIzQEAenho4DuKCm3I4yAw9gEc0DV70DuMTR0LEpYyXcNJY3KNBOTjN5EYQAR9s
2MeurpgK2MdJlIuZaIbzSGd+diiz2E6vkmcufJLtmYUT/k/ddWvEtz+1DnO6bRHh
xuuDMeJA/lGB/EYloSLtdyCF6sII6C6slJJtgfb0bPy7l8VtL5iDyz46IKyzdyzW
tKAn394dm7MYR1RlUBEfqFUyNK7C+pVMVoTwCC2V4QKBgQD64syfiQ2oeUlLYDm4
CcKSP3RnES02bcTyEDFSuGyyS1jldI4A8GXHJ/lG5EYgiYa1RUivge4lJrlNfjyf
dV230xgKms7+JiXqag1FI+3mqjAgg4mYiNjaao8N8O3/PD59wMPeWYImsWXNyeHS
55rUKiHERtCcvdzKl4u35ZtTqQKBgQDNKnX2bVqOJ4WSqCgHRhOm386ugPHfy+8j
m6cicmUR46ND6ggBB03bCnEG9OtGisxTo/TuYVRu3WP4KjoJs2LD5fwdwJqpgtHl
yVsk45Y1Hfo+7M6lAuR8rzCi6kHHNb0HyBmZjysHWZsn79ZM+sQnLpgaYgQGRbKV
DZWlbw7g7QKBgQCl1u+98UGXAP1jFutwbPsx40IVszP4y5ypCe0gqgon3UiY/G+1
zTLp79GGe/SjI2VpQ7AlW7TI2A0bXXvDSDi3/5Dfya9ULnFXv9yfvH1QwWToySpW
Kvd1gYSoiX84/WCtjZOr0e0HmLIb0vw0hqZA4szJSqoxQgvF22EfIWaIaQKBgQCf
34+OmMYw8fEvSCPxDxVvOwW2i7pvV14hFEDYIeZKW2W1HWBhVMzBfFB5SE8yaCQy
pRfOzj9aKOCm2FjjiErVNpkQoi6jGtLvScnhZAt/lr2TXTrl8OwVkPrIaN0bG/AS
aUYxmBPCpXu3UjhfQiWqFq/mFyzlqlgvuCc9g95HPQKBgAscKP8mLxdKwOgX8yFW
GcZ0izY/30012ajdHY+/QK5lsMoxTnn0skdS+spLxaS5ZEO4qvPVb8RAoCkWMMal
2pOhmquJQVDPDLuZHdrIiKiDM20dy9sMfHygWcZjQ4WSxf/J7T9canLZIXFhHAZT
3wc9h4G8BBCtWN2TN/LsGZdB
-----END PRIVATE KEY-----"#;
const MODULUS: &str = "yRE6rHuNR0QbHO3H3Kt2pOKGVhQqGZXInOduQNxXzuKlvQTLUTv4l4sggh5_CYYi_cvI-SXVT9kPWSKXxJXBXd_4LkvcPuUakBoAkfh-eiFVMh2VrUyWyj3MFl0HTVF9KwRXLAcwkREiS3npThHRyIxuy0ZMeZfxVL5arMhw1SRELB8HoGfG_AtH89BIE9jDBHZ9dLelK9a184zAf8LwoPLxvJb3Il5nncqPcSfKDDodMFBIMc4lQzDKL5gvmiXLXB1AGLm8KBjfE8s3L5xqi-yUod-j8MtvIj812dkS4QMiRVN_by2h3ZY8LYVGrqZXZTcgn2ujn8uKjXLZVD5TdQ";
const CLIENT_ID: &str = "google-auth-test.apps.googleusercontent.com";

#[derive(Clone, Serialize)]
struct Claims {
    aud: String,
    email: String,
    email_verified: bool,
    exp: i64,
    iat: i64,
    iss: String,
    name: Option<String>,
    sub: String,
}

fn token(kid: &str, claims: &Claims) -> String {
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some(kid.to_owned());
    encode(
        &header,
        claims,
        &EncodingKey::from_rsa_pem(PRIVATE_KEY.as_bytes()).unwrap(),
    )
    .unwrap()
}

#[tokio::test]
async fn google_identity_verification_checks_signature_claims_and_key_refresh() {
    let server = MockServer::start().await;
    Mock::given(path("/oauth2/v3/certs"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "keys":[{
                "alg":"RS256",
                "e":"AQAB",
                "kid":"rsa01",
                "kty":"RSA",
                "n":MODULUS,
                "use":"sig"
            }]
        })))
        .mount(&server)
        .await;
    let verifier = GoogleVerifier::new_with_endpoint(
        reqwest::Client::new(),
        &format!("{}/oauth2/v3/certs", server.uri()),
    );
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let valid = Claims {
        aud: CLIENT_ID.to_owned(),
        email: "person@example.test".to_owned(),
        email_verified: true,
        exp: now + 3_600,
        iat: now,
        iss: "https://accounts.google.com".to_owned(),
        name: Some("Person".to_owned()),
        sub: "google-person".to_owned(),
    };
    let user = verifier
        .verify(&token("rsa01", &valid), CLIENT_ID)
        .await
        .expect("valid signed identity");
    assert_eq!(user.id, "google-person");
    assert_eq!(user.email, "person@example.test");
    assert_eq!(user.name, "Person");

    let mut fallback_name = valid.clone();
    fallback_name.name = None;
    let user = verifier
        .verify(&token("rsa01", &fallback_name), CLIENT_ID)
        .await
        .expect("cached signing key and fallback name");
    assert_eq!(user.name, "person");

    let mut unverified = valid.clone();
    unverified.email_verified = false;
    assert!(
        verifier
            .verify(&token("rsa01", &unverified), CLIENT_ID)
            .await
            .is_err()
    );
    let mut future = valid.clone();
    future.iat = now + 600;
    assert!(
        verifier
            .verify(&token("rsa01", &future), CLIENT_ID)
            .await
            .is_err()
    );
    assert!(
        verifier
            .verify(&token("unknown-kid", &valid), CLIENT_ID)
            .await
            .is_err()
    );
    assert!(verifier.verify("", CLIENT_ID).await.is_err());
    assert!(
        verifier
            .verify(&"x".repeat(16_385), CLIENT_ID)
            .await
            .is_err()
    );
    let hs = encode(
        &Header::new(Algorithm::HS256),
        &valid,
        &EncodingKey::from_secret(b"not-google"),
    )
    .unwrap();
    assert!(verifier.verify(&hs, CLIENT_ID).await.is_err());
}
