terraform {
  required_version = ">= 1.7.0"

  backend "gcs" {
    bucket = "opportune-chess-492418-r5-tfstate"
    prefix = "zvaka-backend/prod"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.32"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.5"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
