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
