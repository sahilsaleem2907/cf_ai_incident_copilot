terraform {
  # Import blocks with expressions need 1.6.
  required_version = ">= 1.6"

  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      # 5.19 is the first version with cloudflare_ai_gateway.
      version = "~> 5.19"
    }
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment: the token never goes in a file.
provider "cloudflare" {}
