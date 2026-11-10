variable "region" {
  description = "Deployment region"
  type        = string
  default     = "cn-north-4"
}

variable "app_name" {
  description = "Resource name prefix: lowercase letters, digits and hyphens"
  type        = string
  default     = "form-submission-notification"
}

variable "project_id" {
  description = "Project ID of the selected region, used by the notification client at runtime"
  type        = string
}

variable "availability_zones" {
  description = "Availability zones for the dedicated gateway instance"
  type        = list(string)
  default     = ["cn-north-4a"]
}

variable "geminidb_password" {
  description = "GeminiDB instance administrator password; the data-plane user is fixed to rwuser"
  type        = string
  sensitive   = true
}

variable "geminidb_az" {
  description = "Availability zones for the key-value store; a single zone is supported"
  type        = list(string)
  default     = ["cn-north-4a"]
}

variable "geminidb_node_num" {
  description = "Number of nodes; the compatible interface requires a minimum of three nodes"
  type        = number
  default     = 3
}

variable "geminidb_flavor" {
  description = "Node flavor for the compatible interface (large.4 = 2 vCPU / 8 GB)"
  type        = string
  default     = "geminidb.cassandra.large.4"
}

variable "geminidb_storage_size" {
  description = "Storage in GB per node; must be a multiple of 10 and at least 100"
  type        = number
  default     = 100
}

variable "geminidb_ssl_option" {
  description = "Data-plane TLS switch; keep consistent with geminidb_protocol"
  type        = string
  default     = "off"
}

variable "geminidb_protocol" {
  description = "Data-plane protocol: http or https"
  type        = string
  default     = "http"
}

variable "geminidb_endpoint_override" {
  description = "Optional explicit host:port endpoint; leave empty to derive from the instance load balancer"
  type        = string
  default     = ""
}

variable "form_table_name" {
  description = "Name of the key-value table that stores form submissions"
  type        = string
  default     = "form_submissions"
}

variable "notify_email" {
  description = "Email address subscribed to the form notification topic; leave empty to skip the subscription"
  type        = string
  default     = ""
}

variable "notify_subject" {
  description = "Subject line of the notification message"
  type        = string
  default     = "New Form Submission"
}

variable "cors_allowed_origins" {
  description = "Origins allowed to call the form endpoint from a browser"
  type        = list(string)
  default     = ["*"]
}

variable "function_memory_size" {
  description = "Function memory in MB"
  type        = number
  default     = 512
}

variable "function_timeout" {
  description = "Function timeout in seconds"
  type        = number
  default     = 30
}

variable "apig_ingress_bandwidth_size" {
  description = "Public ingress bandwidth of the dedicated gateway"
  type        = number
  default     = 5
}

variable "apig_ingress_bandwidth_charging_mode" {
  description = "Bandwidth mode of the dedicated gateway public ingress"
  type        = string
  default     = "traffic"
}

variable "enable_public_api" {
  description = "Create the dedicated gateway and its public entry; when false, invoke the function directly"
  type        = bool
  default     = true
}
