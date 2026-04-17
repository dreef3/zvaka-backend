provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "current" {
  project_id = var.project_id
}

locals {
  source_dir                = "${path.module}/../function-source"
  has_drive_folder_id       = trimspace(var.drive_folder_id) != ""
  github_principal_set      = "principalSet://iam.googleapis.com/projects/${var.github_wif_project_number}/locations/global/workloadIdentityPools/${var.github_wif_pool_id}/attribute.repository/${var.github_repository}"
  github_pool_principal_set = "principalSet://iam.googleapis.com/projects/${var.github_wif_project_number}/locations/global/workloadIdentityPools/${var.github_wif_pool_id}/*"
}

resource "random_id" "suffix" {
  byte_length = 3
}

resource "google_project_service" "services" {
  for_each = toset([
    "billingbudgets.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudfunctions.googleapis.com",
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "drive.googleapis.com",
    "playintegrity.googleapis.com",
  ])

  project = var.project_id
  service = each.value
}

resource "google_service_account" "runtime" {
  account_id   = "${var.function_name}-sa"
  display_name = "Calorie Drive Upload runtime"
}

resource "google_project_iam_member" "github_deployer_project_roles" {
  for_each = toset(var.github_deployer_project_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${var.github_deployer_service_account_email}"
}

resource "google_service_account_iam_member" "github_deployer_wif_user" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.github_deployer_service_account_email}"
  role               = "roles/iam.workloadIdentityUser"
  member             = local.github_pool_principal_set
}

resource "google_service_account_iam_member" "github_deployer_token_creator" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.github_deployer_service_account_email}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = local.github_pool_principal_set
}

resource "google_storage_bucket" "source" {
  name                        = "${var.project_id}-${var.function_name}-src-${random_id.suffix.hex}"
  location                    = var.region
  uniform_bucket_level_access = true

  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }
}

data "archive_file" "function_zip" {
  type        = "zip"
  source_dir  = local.source_dir
  output_path = "${path.module}/dist/${var.function_name}.zip"
}

resource "google_storage_bucket_object" "function_source" {
  name   = "${var.function_name}-${data.archive_file.function_zip.output_md5}.zip"
  bucket = google_storage_bucket.source.name
  source = data.archive_file.function_zip.output_path
}

resource "google_secret_manager_secret" "drive_folder_id" {
  count     = local.has_drive_folder_id ? 1 : 0
  secret_id = "${var.function_name}-drive-folder-id"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "drive_folder_id" {
  count       = local.has_drive_folder_id ? 1 : 0
  secret      = google_secret_manager_secret.drive_folder_id[0].id
  secret_data = var.drive_folder_id
}

resource "google_secret_manager_secret" "debug_upload_token" {
  count     = var.debug_upload_token == "" ? 0 : 1
  secret_id = "${var.function_name}-debug-upload-token"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "debug_upload_token" {
  count       = var.debug_upload_token == "" ? 0 : 1
  secret      = google_secret_manager_secret.debug_upload_token[0].id
  secret_data = var.debug_upload_token
}

resource "google_secret_manager_secret" "drive_oauth_client_id" {
  count     = var.drive_oauth_client_id == "" ? 0 : 1
  secret_id = "${var.function_name}-drive-oauth-client-id"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "drive_oauth_client_id" {
  count       = var.drive_oauth_client_id == "" ? 0 : 1
  secret      = google_secret_manager_secret.drive_oauth_client_id[0].id
  secret_data = var.drive_oauth_client_id
}

resource "google_secret_manager_secret" "drive_oauth_client_secret" {
  count     = var.drive_oauth_client_secret == "" ? 0 : 1
  secret_id = "${var.function_name}-drive-oauth-client-secret"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "drive_oauth_client_secret" {
  count       = var.drive_oauth_client_secret == "" ? 0 : 1
  secret      = google_secret_manager_secret.drive_oauth_client_secret[0].id
  secret_data = var.drive_oauth_client_secret
}

resource "google_secret_manager_secret" "drive_oauth_refresh_token" {
  count     = var.drive_oauth_refresh_token == "" ? 0 : 1
  secret_id = "${var.function_name}-drive-oauth-refresh-token"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "drive_oauth_refresh_token" {
  count       = var.drive_oauth_refresh_token == "" ? 0 : 1
  secret      = google_secret_manager_secret.drive_oauth_refresh_token[0].id
  secret_data = var.drive_oauth_refresh_token
}

resource "google_secret_manager_secret_iam_member" "runtime_drive_folder" {
  count     = local.has_drive_folder_id ? 1 : 0
  secret_id = google_secret_manager_secret.drive_folder_id[0].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_debug_upload_token" {
  count     = var.debug_upload_token == "" ? 0 : 1
  secret_id = google_secret_manager_secret.debug_upload_token[0].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_drive_oauth_client_id" {
  count     = var.drive_oauth_client_id == "" ? 0 : 1
  secret_id = google_secret_manager_secret.drive_oauth_client_id[0].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_drive_oauth_client_secret" {
  count     = var.drive_oauth_client_secret == "" ? 0 : 1
  secret_id = google_secret_manager_secret.drive_oauth_client_secret[0].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_drive_oauth_refresh_token" {
  count     = var.drive_oauth_refresh_token == "" ? 0 : 1
  secret_id = google_secret_manager_secret.drive_oauth_refresh_token[0].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_cloudfunctions2_function" "upload_api" {
  count    = local.has_drive_folder_id ? 1 : 0
  name     = var.function_name
  location = var.region

  build_config {
    runtime     = "nodejs22"
    entry_point = "uploadExample"
    source {
      storage_source {
        bucket = google_storage_bucket.source.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    available_memory               = "256M"
    timeout_seconds                = 15
    max_instance_count             = 1
    ingress_settings               = "ALLOW_ALL"
    all_traffic_on_latest_revision = true
    service_account_email          = google_service_account.runtime.email

    environment_variables = {
      ALLOWED_PACKAGE_NAME = var.android_package_name
    }

    secret_environment_variables {
      key        = "DRIVE_FOLDER_ID"
      project_id = var.project_id
      secret     = google_secret_manager_secret.drive_folder_id[0].secret_id
      version    = "latest"
    }

    dynamic "secret_environment_variables" {
      for_each = var.debug_upload_token == "" ? [] : [1]
      content {
        key        = "DEBUG_UPLOAD_TOKEN"
        project_id = var.project_id
        secret     = google_secret_manager_secret.debug_upload_token[0].secret_id
        version    = "latest"
      }
    }

    dynamic "secret_environment_variables" {
      for_each = var.drive_oauth_client_id == "" ? [] : [1]
      content {
        key        = "DRIVE_OAUTH_CLIENT_ID"
        project_id = var.project_id
        secret     = google_secret_manager_secret.drive_oauth_client_id[0].secret_id
        version    = "latest"
      }
    }

    dynamic "secret_environment_variables" {
      for_each = var.drive_oauth_client_secret == "" ? [] : [1]
      content {
        key        = "DRIVE_OAUTH_CLIENT_SECRET"
        project_id = var.project_id
        secret     = google_secret_manager_secret.drive_oauth_client_secret[0].secret_id
        version    = "latest"
      }
    }

    dynamic "secret_environment_variables" {
      for_each = var.drive_oauth_refresh_token == "" ? [] : [1]
      content {
        key        = "DRIVE_OAUTH_REFRESH_TOKEN"
        project_id = var.project_id
        secret     = google_secret_manager_secret.drive_oauth_refresh_token[0].secret_id
        version    = "latest"
      }
    }
  }

  depends_on = [google_project_service.services]
}

resource "google_cloudfunctions2_function_iam_member" "public_invoker" {
  count          = local.has_drive_folder_id ? 1 : 0
  project        = var.project_id
  location       = var.region
  cloud_function = google_cloudfunctions2_function.upload_api[0].name
  role           = "roles/cloudfunctions.invoker"
  member         = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count    = local.has_drive_folder_id ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.upload_api[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
