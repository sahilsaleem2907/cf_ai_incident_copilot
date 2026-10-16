# Terraform owns the two account-level resources the Workers depend on; wrangler owns the Workers, their
# bindings, Durable Objects, Workflows, cron and migrations (TDD §15, D15). Both resources already exist
# (created by wrangler and the dashboard on Day 1), so they're imported, not created. State is local.

import {
  to = cloudflare_d1_database.main
  id = "${var.account_id}/${var.d1_database_id}"
}

resource "cloudflare_d1_database" "main" {
  account_id = var.account_id
  name       = var.d1_name

  # Holds every workspace, incident index, watch and webhook: never let a plan delete it.
  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = cloudflare_ai_gateway.main
  id = "${var.account_id}/${var.gateway_id}"
}

# Every LLM call goes through this gateway (env.AI.run(..., { gateway })). Settings match how it was created in
# the dashboard: logs on, no cache, no rate limit (the app enforces its own limits, TDD §11).
resource "cloudflare_ai_gateway" "main" {
  account_id                 = var.account_id
  id                         = var.gateway_id
  collect_logs               = true
  cache_ttl                  = 0
  cache_invalidate_on_update = false
  rate_limiting_interval     = 0
  rate_limiting_limit        = 0

  lifecycle {
    prevent_destroy = true
  }
}
