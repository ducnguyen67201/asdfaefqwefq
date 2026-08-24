use std::time::Duration;

use aws_credential_types::Credentials;
use aws_sdk_s3::{
    Client,
    config::{Builder, Region},
    presigning::PresigningConfig,
};
use serde::Serialize;

use crate::{
    config::ObjectStoreConfig,
    error::{ApiError, ApiResult},
};

#[derive(Clone)]
pub struct ObjectStore {
    client: Client,
    bucket: String,
}
#[derive(Clone, Debug)]
pub struct ObjectHead {
    pub byte_size: i64,
    pub checksum_base64: Option<String>,
    pub media_type: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PutTicket {
    pub expires_in_seconds: u64,
    pub headers: std::collections::BTreeMap<&'static str, String>,
    pub url: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTicket {
    pub expires_in_seconds: u64,
    pub url: String,
}
impl ObjectStore {
    pub async fn new(config: &ObjectStoreConfig) -> Self {
        let credentials = Credentials::new(
            &config.access_key_id,
            &config.secret_access_key,
            None,
            None,
            "trocode",
        );
        let shared = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region(Region::new(config.region.clone()))
            .credentials_provider(credentials)
            .load()
            .await;
        let mut builder = Builder::from(&shared).force_path_style(config.force_path_style);
        if let Some(endpoint) = &config.endpoint {
            builder = builder.endpoint_url(endpoint);
        }
        Self {
            client: Client::from_conf(builder.build()),
            bucket: config.bucket.clone(),
        }
    }
    pub async fn put_ticket(
        &self,
        key: &str,
        byte_size: i64,
        media_type: &str,
        checksum: &str,
    ) -> ApiResult<PutTicket> {
        let request = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_length(byte_size)
            .content_type(media_type)
            .checksum_sha256(checksum)
            .presigned(
                PresigningConfig::expires_in(Duration::from_secs(300))
                    .map_err(ApiError::internal)?,
            )
            .await
            .map_err(ApiError::internal)?;
        Ok(PutTicket {
            expires_in_seconds: 300,
            headers: std::collections::BTreeMap::from([
                ("content-length", byte_size.to_string()),
                ("content-type", media_type.to_owned()),
                ("x-amz-checksum-sha256", checksum.to_owned()),
            ]),
            url: request.uri().to_string(),
        })
    }
    pub async fn get_ticket(&self, key: &str) -> ApiResult<GetTicket> {
        let request = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .checksum_mode(aws_sdk_s3::types::ChecksumMode::Enabled)
            .presigned(
                PresigningConfig::expires_in(Duration::from_secs(120))
                    .map_err(ApiError::internal)?,
            )
            .await
            .map_err(ApiError::internal)?;
        Ok(GetTicket {
            expires_in_seconds: 120,
            url: request.uri().to_string(),
        })
    }
    pub async fn head(&self, key: &str) -> ApiResult<ObjectHead> {
        let value = self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(key)
            .checksum_mode(aws_sdk_s3::types::ChecksumMode::Enabled)
            .send()
            .await
            .map_err(ApiError::internal)?;
        Ok(ObjectHead {
            byte_size: value.content_length().unwrap_or_default(),
            checksum_base64: value.checksum_sha256().map(ToOwned::to_owned),
            media_type: value.content_type().map(ToOwned::to_owned),
        })
    }
    pub async fn get(&self, key: &str) -> ApiResult<Vec<u8>> {
        let value = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .checksum_mode(aws_sdk_s3::types::ChecksumMode::Enabled)
            .send()
            .await
            .map_err(ApiError::internal)?;
        let bytes = value
            .body
            .collect()
            .await
            .map_err(ApiError::internal)?
            .into_bytes();
        if bytes.len() > 25 * 1024 * 1024 {
            return Err(ApiError::coded(
                http::StatusCode::UNPROCESSABLE_ENTITY,
                "object_too_large",
                "Object is too large.",
            ));
        }
        Ok(bytes.to_vec())
    }
}
