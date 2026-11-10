terraform {
  required_version = ">= 1.5.0"

  required_providers {
    huaweicloud = {
      source  = "huaweicloud/huaweicloud"
      version = ">= 1.97.0"
    }
  }
}

# Access keys come from the shell environment; they are never stored in this repository.
provider "huaweicloud" {
  region = var.region
}

locals {
  name_prefix = var.app_name
}
