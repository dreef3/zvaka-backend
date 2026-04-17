variable "project_id" {
  type = string
}

variable "billing_account_id" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "function_name" {
  type    = string
  default = "calorie-drive-upload"
}

variable "drive_folder_id" {
  type      = string
  sensitive = true
  default   = ""
}

variable "android_package_name" {
  type = string
}

variable "debug_upload_token" {
  type      = string
  sensitive = true
  default   = ""
}

variable "drive_oauth_client_id" {
  type      = string
  sensitive = true
  default   = ""
}

variable "drive_oauth_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "drive_oauth_refresh_token" {
  type      = string
  sensitive = true
  default   = ""
}

variable "monthly_budget_amount" {
  type    = number
  default = 1
}

variable "github_repository" {
  type    = string
  default = "dreef3/zvaka-backend"
}

variable "github_wif_project_number" {
  type    = string
  default = "1086833593805"
}

variable "github_wif_pool_id" {
  type    = string
  default = "github"
}

variable "github_wif_provider_id" {
  type    = string
  default = "my-repo"
}

variable "github_deployer_service_account_email" {
  type    = string
  default = "github-releaser@opportune-chess-492418-r5.iam.gserviceaccount.com"
}

variable "github_deployer_project_roles" {
  type = list(string)
  default = [
    "roles/viewer",
    "roles/resourcemanager.projectIamAdmin",
    "roles/serviceusage.serviceUsageAdmin",
    "roles/secretmanager.admin",
    "roles/iam.serviceAccountAdmin",
    "roles/iam.serviceAccountUser",
    "roles/storage.admin",
    "roles/cloudfunctions.admin",
    "roles/run.admin",
    "roles/artifactregistry.admin",
  ]
}
