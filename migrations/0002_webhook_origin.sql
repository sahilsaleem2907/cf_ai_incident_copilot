-- WP-19: the app's origin, recorded when a webhook is saved, so messages can link to the incident
-- without committing the deployed URL (D2).
ALTER TABLE webhooks ADD COLUMN app_origin TEXT;
