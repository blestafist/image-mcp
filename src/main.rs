mod provider;
mod tools;

use rmcp::{ServiceExt, transport::stdio};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cfg = provider::Config::from_env()?;
    let service = tools::ImageServer::new(cfg).serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}
