locals {
  # Dedicated instances ship with a RELEASE environment whose ID is a fixed
  # constant. Querying it through a data source returns nothing during plan
  # when the instance is being replaced.
  release_env_id = "DEFAULT_ENVIRONMENT_RELEASE_ID"
}

# The lightweight verification profile skips the dedicated gateway and its
# public entry. The key-value store, topic and function remain unchanged, so
# the function can still be invoked directly to exercise the whole chain.
resource "huaweicloud_apig_instance" "main" {
  count = var.enable_public_api ? 1 : 0

  name              = "${local.name_prefix}-apig"
  edition           = "BASIC"
  vpc_id            = huaweicloud_vpc.main.id
  subnet_id         = huaweicloud_vpc_subnet.main.id
  security_group_id = huaweicloud_networking_secgroup.main.id

  availability_zones = var.availability_zones

  ingress_bandwidth_size          = var.apig_ingress_bandwidth_size
  ingress_bandwidth_charging_mode = var.apig_ingress_bandwidth_charging_mode

  maintain_begin = "02:00:00"

  tags = {
    project = local.name_prefix
  }
}

resource "huaweicloud_apig_group" "main" {
  count = var.enable_public_api ? 1 : 0

  name        = "${local.name_prefix}-group"
  instance_id = huaweicloud_apig_instance.main[0].id
  description = "Form submission API group"
}

resource "huaweicloud_apig_api" "submit_form" {
  count = var.enable_public_api ? 1 : 0

  name        = "submit-form"
  instance_id = huaweicloud_apig_instance.main[0].id
  group_id    = huaweicloud_apig_group.main[0].id
  description = "Accept a form submission, persist it and publish a notification"

  type             = "FunctionGraph"
  request_protocol = "HTTPS"
  request_method   = "POST"
  request_path     = "/submitForm"
  cors             = true

  # Teaching endpoint without authentication; enable authentication and
  # request throttling before using this pattern in production.
  security_authentication = "NONE"

  func_graph {
    # Strip the version suffix: updating function code must not trigger an
    # unsupported in-place update of the gateway backend.
    function_urn     = trimsuffix(huaweicloud_fgs_function.submit_form.urn, ":latest")
    invocation_type  = "sync"
    timeout          = var.function_timeout * 1000
    network_type     = "V1"
    request_protocol = "HTTPS"
  }

  lifecycle {
    ignore_changes = [func_graph]
  }
}

# An API is not reachable until it is explicitly published to an environment.
resource "huaweicloud_apig_api_publishment" "submit_form" {
  count = var.enable_public_api ? 1 : 0

  instance_id = huaweicloud_apig_instance.main[0].id
  api_id      = huaweicloud_apig_api.submit_form[0].id
  env_id      = local.release_env_id
}
