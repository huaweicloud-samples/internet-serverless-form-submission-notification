# The key-value store does not expose a public endpoint, so the function must
# attach to this VPC. The dedicated gateway instance shares the same network.
resource "huaweicloud_vpc" "main" {
  name = "${local.name_prefix}-vpc"
  cidr = "10.0.0.0/16"
}

resource "huaweicloud_vpc_subnet" "main" {
  name       = "${local.name_prefix}-subnet"
  vpc_id     = huaweicloud_vpc.main.id
  cidr       = "10.0.1.0/24"
  gateway_ip = "10.0.1.1"
}

resource "huaweicloud_networking_secgroup" "main" {
  name        = "${local.name_prefix}-sg"
  description = "Security group for ${local.name_prefix}"
}

locals {
  # Cluster mode exposes the DynamoDB-compatible protocol on the load balancer
  # high-availability port 80; individual nodes also listen on port 8000.
  geminidb_lb_port   = 80
  geminidb_node_port = 8000
}

resource "huaweicloud_networking_secgroup_rule" "allow_data_lb_port" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = local.geminidb_lb_port
  port_range_max    = local.geminidb_lb_port
  remote_ip_prefix  = "10.0.0.0/16"
  security_group_id = huaweicloud_networking_secgroup.main.id
}

resource "huaweicloud_networking_secgroup_rule" "allow_data_node_port" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = local.geminidb_node_port
  port_range_max    = local.geminidb_node_port
  remote_ip_prefix  = "10.0.0.0/16"
  security_group_id = huaweicloud_networking_secgroup.main.id
}

# FunctionGraph requires ICMP ingress and an open egress on the attached subnet.
resource "huaweicloud_networking_secgroup_rule" "allow_icmp" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "icmp"
  remote_ip_prefix  = "10.0.0.0/16"
  security_group_id = huaweicloud_networking_secgroup.main.id
}

resource "huaweicloud_networking_secgroup_rule" "allow_outbound" {
  direction         = "egress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 1
  port_range_max    = 65535
  remote_ip_prefix  = "0.0.0.0/0"
  security_group_id = huaweicloud_networking_secgroup.main.id
}

resource "huaweicloud_networking_secgroup_rule" "allow_gateway_https" {
  count = var.enable_public_api ? 1 : 0

  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 443
  port_range_max    = 443
  remote_ip_prefix  = "0.0.0.0/0"
  security_group_id = huaweicloud_networking_secgroup.main.id
}

resource "huaweicloud_networking_secgroup_rule" "allow_gateway_http" {
  count = var.enable_public_api ? 1 : 0

  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 80
  port_range_max    = 80
  remote_ip_prefix  = "0.0.0.0/0"
  security_group_id = huaweicloud_networking_secgroup.main.id
}
