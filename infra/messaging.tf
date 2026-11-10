# Form notification topic. An email subscription is created only when an
# address is supplied; the subscriber must confirm it before messages are delivered.
resource "huaweicloud_smn_topic" "form" {
  name         = "${local.name_prefix}-submission"
  display_name = "Form submission notifications"
}

resource "huaweicloud_smn_subscription" "email" {
  count = var.notify_email == "" ? 0 : 1

  topic_urn = huaweicloud_smn_topic.form.id
  protocol  = "email"
  endpoint  = var.notify_email
}
