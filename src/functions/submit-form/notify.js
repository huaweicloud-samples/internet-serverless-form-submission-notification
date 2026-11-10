'use strict';

// Notification side of the fan-out. Publishing to a notification topic is a
// control-plane call, so it uses the temporary credentials that FunctionGraph
// hands to the handler through its context object. Those credentials are not
// present in environment variables and must be read inside the invocation.
const smn = require('@huaweicloud/huaweicloud-sdk-smn').v2;
const core = require('@huaweicloud/huaweicloud-sdk-core');

function readCredentials(context) {
  const ctx = context || {};
  const pick = (methodNames, envName) => {
    for (const name of methodNames) {
      if (typeof ctx[name] === 'function') {
        try {
          const value = ctx[name]();
          if (value) return value;
        } catch (err) {
          // The current runtime may not expose this method.
        }
      }
    }
    return process.env[envName] || '';
  };

  return {
    ak: pick(['getSecurityAccessKey', 'getAccessKey'], 'HW_ACCESS_KEY'),
    sk: pick(['getSecuritySecretKey', 'getSecretKey'], 'HW_SECRET_KEY'),
    token: pick(['getSecurityToken', 'getToken'], 'HW_SECURITY_TOKEN'),
    projectId: process.env.HW_PROJECT_ID || '',
  };
}

function buildClient(context, credentials = readCredentials(context)) {
  if (!credentials.ak || !credentials.sk) {
    throw new Error('temporary credentials are unavailable; attach an IAM agency to the function');
  }
  const basic = new core.BasicCredentials()
    .withAk(credentials.ak)
    .withSk(credentials.sk)
    .withProjectId(credentials.projectId);
  if (credentials.token) {
    basic.withSecurityToken(credentials.token);
  }
  return smn.SmnClient.newBuilder()
    .withCredential(basic)
    .withRegion(smn.SmnRegion.valueOf(process.env.REGION || 'cn-north-4'))
    .build();
}

// The message body lists every submitted field, separated by a blank line.
function buildMessage(formData) {
  return Object.keys(formData)
    .map((key) => `${key}: ${formData[key]}\n`)
    .join('\n');
}

function buildRequest(topicUrn, subject, message) {
  return new smn.PublishMessageRequest(topicUrn)
    .withBody(new smn.PublishMessageRequestBody()
      .withSubject(subject)
      .withMessage(message));
}

async function sendNotification(formData, context, deps = {}) {
  const topicUrn = process.env.SMN_TOPIC_URN;
  const subject = process.env.NOTIFY_SUBJECT || 'New Form Submission';
  if (!topicUrn) {
    throw new Error('SMN_TOPIC_URN is not configured');
  }

  const message = buildMessage(formData);
  const request = buildRequest(topicUrn, subject, message);
  const client = deps.client || buildClient(context);
  const response = await client.publishMessage(request);
  return { messageId: response && (response.message_id || response.messageId), subject, message };
}

module.exports = {
  sendNotification,
  buildClient,
  buildRequest,
  buildMessage,
  readCredentials,
};
