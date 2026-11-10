'use strict';

// A single HTTP entry point receives a form submission. In one request the
// handler fans out to two independent managed services with Promise.all:
// persist the payload to a key-value table and publish a notification message.
const { saveFormData } = require('./store');
const { sendNotification } = require('./notify');

function reply(statusCode, body) {
  return {
    statusCode,
    isBase64Encoded: false,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.CORS_ALLOW_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'OPTIONS,POST',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

// Accepts an API Gateway proxy event, a direct invocation event carrying a
// formData object, or an already parsed form object.
function parseFormEvent(event) {
  if (!event || typeof event !== 'object') {
    throw new Error('event must be an object');
  }

  let raw = event.body !== undefined ? event.body : (event.formData !== undefined ? event.formData : event);
  if (typeof raw === 'string') {
    if (event.isBase64Encoded === true) {
      raw = Buffer.from(raw, 'base64').toString('utf8');
    }
    raw = JSON.parse(raw);
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('form body must be a JSON object');
  }
  return raw;
}

function createHandler(deps = {}) {
  const persist = deps.saveFormData || saveFormData;
  const notify = deps.sendNotification || sendNotification;

  return async function handler(event, context) {
    let formData;
    try {
      formData = parseFormEvent(event);
    } catch (err) {
      console.error('invalid form payload:', err.message);
      return reply(400, { error: 'invalid form payload' });
    }

    try {
      // Both branches start in the same tick; the request does not return
      // until persistence and notification have both completed.
      const [notification, record] = await Promise.all([
        notify(formData, context),
        persist(formData),
      ]);
      console.log('submission accepted:', record.formId, notification.messageId || '');
      return reply(200, { message: 'OK!', formId: record.formId });
    } catch (err) {
      console.error('handler error:', err && err.message ? err.message : err);
      return reply(500, { error: 'failed to process the form submission' });
    }
  };
}

const handler = createHandler();

module.exports = { handler, createHandler, parseFormEvent, reply };
