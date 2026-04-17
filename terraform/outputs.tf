output "function_url" {
  value = nonsensitive(local.has_drive_folder_id ? google_cloudfunctions2_function.upload_api[0].service_config[0].uri : null)
}

output "runtime_service_account_email" {
  value = google_service_account.runtime.email
}

output "source_bucket_name" {
  value = google_storage_bucket.source.name
}

output "cloud_project_number" {
  value = data.google_project.current.number
}

output "upload_api_deployed" {
  value = nonsensitive(local.has_drive_folder_id)
}

output "budget_display_name" {
  value = google_billing_budget.project_budget.display_name
}

output "github_actions_workload_identity_provider" {
  value = "projects/${var.github_wif_project_number}/locations/global/workloadIdentityPools/${var.github_wif_pool_id}/providers/${var.github_wif_provider_id}"
}

output "github_actions_service_account_email" {
  value = var.github_deployer_service_account_email
}
