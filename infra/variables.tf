variable "account_id" {
  description = "Cloudflare account ID (wrangler whoami). Set it in terraform.tfvars, which is gitignored."
  type        = string
}

variable "d1_name" {
  description = "D1 database name, as in wrangler.jsonc."
  type        = string
  default     = "incident-copilot"
}

variable "d1_database_id" {
  description = "ID of the existing D1 database (wrangler.jsonc d1_databases[0].database_id), adopted by the import below."
  type        = string
  default     = "d24601d5-e047-48c8-8d5a-66880d841b40"
}

variable "gateway_id" {
  description = "AI Gateway ID, as in wrangler.jsonc vars.AI_GATEWAY_ID."
  type        = string
  default     = "incident-copilot"
}
