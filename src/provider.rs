use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, bail};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Serialize;
use serde_json::{Value, json};

use crate::tools::GenerateImageParams;

#[derive(Clone)]
pub struct Config {
    api_key: String,
    base_url: String,
    default_model: Option<String>,
    output_dir: PathBuf,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let api_key = std::env::var("IMAGE_API_KEY").context("IMAGE_API_KEY is not set")?;
        let base_url = std::env::var("IMAGE_BASE_URL").context("IMAGE_BASE_URL is not set")?;
        let default_model = std::env::var("IMAGE_MODEL").ok().filter(|s| !s.is_empty());
        let output_dir = std::env::var("IMAGE_OUTPUT_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/tmp/opencode/images"));
        Ok(Self {
            api_key,
            base_url: base_url.trim_end_matches('/').to_string(),
            default_model,
            output_dir,
        })
    }
}

pub async fn generate(cfg: &Config, client: &reqwest::Client, p: GenerateImageParams) -> Result<String> {
    let model = p
        .model
        .clone()
        .or_else(|| cfg.default_model.clone())
        .context("no model: pass `model` or set IMAGE_MODEL")?;

    let mut body = json!({ "model": model, "prompt": p.prompt });
    if let Some(path) = &p.reference_image {
        body["image"] = json!(to_data_uri(Path::new(path))?);
    }
    set(&mut body, "n", p.n);
    set(&mut body, "size", p.size.as_deref());
    set(&mut body, "quality", p.quality.as_deref());
    set(&mut body, "background", p.background.as_deref());
    set(&mut body, "image_detail", p.image_detail.as_deref());
    set(&mut body, "output_format", p.output_format.as_deref());
    set(&mut body, "watermark", p.watermark);
    set(&mut body, "prompt_extend", p.prompt_extend);

    let resp = client
        .post(format!("{}/images/generations", cfg.base_url))
        .bearer_auth(&cfg.api_key)
        .json(&body)
        .send()
        .await
        .context("request to image API failed")?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        bail!("image API returned {status}: {text}");
    }

    let v: Value = serde_json::from_str(&text).context("image API returned invalid JSON")?;
    let items = v["data"].as_array().context("response has no `data` array")?;

    tokio::fs::create_dir_all(&cfg.output_dir).await?;
    let ext = p.output_format.as_deref().unwrap_or("png");
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();

    let mut paths = Vec::new();
    for (i, item) in items.iter().enumerate() {
        let path = cfg.output_dir.join(format!("image-{stamp}-{i}.{ext}"));
        if let Some(b64) = item["b64_json"].as_str().filter(|s| !s.is_empty()) {
            tokio::fs::write(&path, STANDARD.decode(b64)?).await?;
        } else if let Some(url) = item["url"].as_str() {
            let bytes = client.get(url).send().await?.error_for_status()?.bytes().await?;
            tokio::fs::write(&path, bytes).await?;
        } else {
            bail!("result {i} has neither b64_json nor url");
        }
        paths.push(path.display().to_string());
    }

    Ok(format!("Generated {} image(s) with {model}:\n{}", paths.len(), paths.join("\n")))
}

fn set<T: Serialize>(body: &mut Value, key: &str, value: Option<T>) {
    if let Some(v) = value {
        body[key] = json!(v);
    }
}

fn to_data_uri(path: &Path) -> Result<String> {
    let bytes = std::fs::read(path).with_context(|| format!("cannot read {}", path.display()))?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => bail!("unsupported image type: {}", path.display()),
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}
