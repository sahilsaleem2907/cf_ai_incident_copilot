output "database_id" {
  description = "Goes in wrangler.jsonc d1_databases[0].database_id."
  value       = cloudflare_d1_database.main.id
}

output "gateway_id" {
  description = "Goes in wrangler.jsonc vars.AI_GATEWAY_ID."
  value       = cloudflare_ai_gateway.main.id
}
