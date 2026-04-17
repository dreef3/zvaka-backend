variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "terraform_state_bucket_name" {
  type    = string
  default = "opportune-chess-492418-r5-tfstate"
}

variable "github_deployer_service_account_email" {
  type    = string
  default = "github-releaser@opportune-chess-492418-r5.iam.gserviceaccount.com"
}
