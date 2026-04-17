terraform {
  required_version = ">= 1.7.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.32"
    }
  }
}

provider "google" {
  project = var.project_id
}

locals {
  github_deployer_sa_member = "serviceAccount:${var.github_deployer_service_account_email}"
}

resource "google_storage_bucket" "terraform_state" {
  name                        = var.terraform_state_bucket_name
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }
}

resource "google_storage_bucket_iam_member" "github_deployer_admin" {
  bucket = google_storage_bucket.terraform_state.name
  role   = "roles/storage.admin"
  member = local.github_deployer_sa_member
}

output "terraform_state_bucket_name" {
  value = google_storage_bucket.terraform_state.name
}
