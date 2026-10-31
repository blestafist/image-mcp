use rmcp::{
    ServerHandler,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ContentBlock},
    tool, tool_handler, tool_router,
};
use schemars::JsonSchema;
use serde::Deserialize;

use crate::provider::{self, Config};

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GenerateImageParams {
    /// Text description of the image to generate.
    pub prompt: String,
    /// Model ID. Defaults to IMAGE_MODEL from the environment.
    pub model: Option<String>,
    /// Local path to a reference image (png, jpg, webp, gif). Sent to the API as the `image` field.
    pub reference_image: Option<String>,
    /// Number of images to generate.
    pub n: Option<u32>,
    /// Image size, e.g. "auto" or "1024x1024".
    pub size: Option<String>,
    /// Quality level, e.g. "auto", "high".
    pub quality: Option<String>,
    /// Background type, e.g. "auto", "transparent".
    pub background: Option<String>,
    /// Detail level for the input image, e.g. "high".
    pub image_detail: Option<String>,
    /// Output file format, e.g. "png", "jpeg", "webp". Also used as the saved file extension.
    pub output_format: Option<String>,
    /// Whether to add a watermark.
    pub watermark: Option<bool>,
    /// Whether the provider may extend the prompt.
    pub prompt_extend: Option<bool>,
}

#[derive(Clone)]
pub struct ImageServer {
    cfg: Config,
    client: reqwest::Client,
    tool_router: ToolRouter<Self>,
}

impl ImageServer {
    pub fn new(cfg: Config) -> Self {
        Self {
            cfg,
            client: reqwest::Client::new(),
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_router]
impl ImageServer {
    /// Generate an image and save it to disk.
    #[tool(description = "Generate an image from a text prompt, optionally guided by a reference image. Saves the result to disk and returns the file paths.")]
    async fn generate_image(
        &self,
        Parameters(params): Parameters<GenerateImageParams>,
    ) -> Result<CallToolResult, String> {
        let text = provider::generate(&self.cfg, &self.client, params)
            .await
            .map_err(|e| format!("{e:#}"))?;
        Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for ImageServer {}
