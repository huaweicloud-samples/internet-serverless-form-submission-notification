locals {
  ingress_address = try(coalesce(one(huaweicloud_apig_instance.main[*].ingress_address), ""), "")
  api_group_id    = try(one(huaweicloud_apig_group.main[*].id), "")
}

output "api_endpoint" {
  description = "Public form submission endpoint; a hint is returned in the lightweight profile"
  value = (
    var.enable_public_api
    ? (local.ingress_address != "" ? "https://${local.ingress_address}/release/submitForm" : "public entry is not ready; check the gateway ingress configuration")
    : "public entry is disabled (lightweight verification profile; invoke the function directly)"
  )
}

output "internal_api_domain" {
  description = "Internal domain of the API group, reachable from inside the VPC"
  value = (
    local.api_group_id != ""
    ? "${local.api_group_id}.apic.${var.region}.huaweicloudapis.com"
    : "public entry is disabled"
  )
}

output "form_table_name" {
  description = "Table that stores form submissions"
  value       = var.form_table_name
}

output "geminidb_endpoint" {
  description = "Internal load balancer endpoint of the key-value store"
  value       = local.geminidb_endpoint
}

output "smn_topic_urn" {
  description = "Topic URN used by the function when publishing notifications"
  value       = huaweicloud_smn_topic.form.id
}

output "notify_email" {
  description = "Subscribed address; confirm the subscription before messages are delivered"
  value       = var.notify_email
}

output "function_name" {
  description = "Function name, used for direct invocation in the lightweight profile"
  value       = huaweicloud_fgs_function.submit_form.name
}

output "function_urn" {
  description = "Function URN, used by the direct invocation API"
  value       = huaweicloud_fgs_function.submit_form.urn
}

output "agency_name" {
  description = "Cloud service agency attached to the function"
  value       = huaweicloud_identity_agency.functiongraph.name
}
