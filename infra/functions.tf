locals {
  function_zip = "${path.module}/../build/submit-form.zip"

  # A missing package produces a clear runtime error instead of an opaque
  # "Invalid function argument" from filebase64 during plan.
  function_code = (
    fileexists(local.function_zip)
    ? filebase64(local.function_zip)
    : base64encode("throw new Error('Missing deployment package: build/submit-form.zip. Run scripts/package-function.sh first.')")
  )

  # The load balancer address is per instance and cannot be derived from the region.
  # Cluster mode serves the compatible protocol on high-availability port 80.
  geminidb_endpoint = (
    var.geminidb_endpoint_override != ""
    ? var.geminidb_endpoint_override
    : "${huaweicloud_geminidb_instance.form.lb_ip_address}:${local.geminidb_lb_port}"
  )

  # FunctionGraph rejects environment variables whose value is an empty string
  # (FSS.1009 Invalid function UserData), so filter them out before encoding.
  env_without_empty = {
    for k, v in {
      REGION              = var.region
      HW_PROJECT_ID       = var.project_id
      GEMINIDB_ENDPOINT   = local.geminidb_endpoint
      GEMINIDB_PROTOCOL   = var.geminidb_protocol
      GEMINIDB_ACCESS_KEY = "rwuser"
      GEMINIDB_SECRET_KEY = var.geminidb_password
      FORM_TABLE          = var.form_table_name
      SMN_TOPIC_URN       = huaweicloud_smn_topic.form.id
      NOTIFY_SUBJECT      = var.notify_subject
      CORS_ALLOW_ORIGIN   = join(",", var.cors_allowed_origins)
    } : k => v if v != null && v != ""
  }
}

# Cloud service agency: the function receives temporary credentials at runtime.
# GeminiDB data-plane authentication uses the instance account rwuser instead,
# so no key-value store role is granted to this agency.
resource "huaweicloud_identity_agency" "functiongraph" {
  name                   = "${local.name_prefix}-fgs-agency"
  description            = "Agency for FunctionGraph to publish form notifications and attach to a VPC"
  delegated_service_name = "op_svc_cff"

  domain_roles = [
    "SMN Publisher",
  ]

  project_role {
    project = var.region
    roles = [
      "VPC Administrator",
    ]
  }
}

resource "huaweicloud_fgs_function" "submit_form" {
  name        = "${local.name_prefix}-submit-form"
  app         = "default"
  agency      = huaweicloud_identity_agency.functiongraph.name
  handler     = "index.handler"
  runtime     = "Node.js18.18"
  memory_size = var.function_memory_size
  timeout     = var.function_timeout

  code_type     = "zip"
  code_filename = "submit-form.zip"
  func_code     = local.function_code

  vpc_id     = huaweicloud_vpc.main.id
  network_id = huaweicloud_vpc_subnet.main.id

  user_data = jsonencode(local.env_without_empty)

  # IAM agency propagation is asynchronous; creating the function too early
  # fails with FSS.1501 The delegate not exist.
  depends_on = [huaweicloud_identity_agency.functiongraph]
}
