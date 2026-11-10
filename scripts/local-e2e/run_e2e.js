'use strict';

// Local end-to-end checks. No cloud connection is made: the handler's two
// fan-out branches are injected with deterministic stubs, while the real
// protocol clients are exercised separately for request shape only.
// Run scripts/package-function.sh first to install runtime dependencies.
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const FUNC = path.join(ROOT, 'src', 'functions', 'submit-form');

process.env.REGION = 'cn-north-4';
process.env.HW_PROJECT_ID = 'local-test-project';
process.env.GEMINIDB_ENDPOINT = '10.0.1.10:80';
process.env.GEMINIDB_PROTOCOL = 'http';
process.env.GEMINIDB_ACCESS_KEY = 'rwuser';
process.env.GEMINIDB_SECRET_KEY = 'LOCAL_TEST_INSTANCE_PASSWORD';
process.env.FORM_TABLE = 'form_submissions';
process.env.SMN_TOPIC_URN = 'urn:smn:cn-north-4:local-test-project:form-submission';
process.env.NOTIFY_SUBJECT = 'New Form Submission';
process.env.CORS_ALLOW_ORIGIN = '*';

const { createHandler, parseFormEvent } = require(path.join(FUNC, 'index.js'));
const store = require(path.join(FUNC, 'store.js'));
const notify = require(path.join(FUNC, 'notify.js'));
const { submitForm, collect } = require(path.join(ROOT, 'src', 'frontend', 'form.js'));

const FORM = { name: 'Sender Name', reply_to: 'sender@example.com', message: 'A test message' };

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log('  PASS  ' + name);
    passed += 1;
  } catch (err) {
    console.log('  FAIL  ' + name + ' -> ' + (err && err.message));
    failed += 1;
  }
}

function fakeContext() {
  return {
    getSecurityAccessKey: () => 'LOCAL_TEST_AK',
    getSecuritySecretKey: () => 'LOCAL_TEST_SK',
    getSecurityToken: () => 'LOCAL_TEST_SECURITY_TOKEN',
    getRequestID: () => 'local-e2e-request',
  };
}

function makeHandler(overrides) {
  const calls = { notify: [], save: [], ticks: [] };
  const deps = Object.assign({
    sendNotification: async (data, ctx) => {
      calls.notify.push({ data, ctx });
      calls.ticks.push('notify');
      return { messageId: 'local-message-id', subject: 'New Form Submission', message: 'ok' };
    },
    saveFormData: async (data) => {
      calls.save.push({ data });
      calls.ticks.push('save');
      return { formId: '1234567', table: 'form_submissions' };
    },
  }, overrides || {});
  return { handler: createHandler(deps), calls };
}

async function main() {
  console.log('=== Parallel fan-out in one request (FunctionGraph handler) ===');

  await check('returns 200, CORS headers and the OK body', async () => {
    const { handler } = makeHandler();
    const res = await handler({ body: JSON.stringify(FORM), httpMethod: 'POST' }, fakeContext());
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.isBase64Encoded, false);
    assert.strictEqual(res.headers['Content-Type'], 'application/json');
    assert.strictEqual(res.headers['Access-Control-Allow-Origin'], '*');
    assert.strictEqual(res.headers['Access-Control-Allow-Methods'], 'OPTIONS,POST');
    assert.deepStrictEqual(JSON.parse(res.body), { message: 'OK!', formId: '1234567' });
  });

  await check('both branches receive the exact same form object', async () => {
    const { handler, calls } = makeHandler();
    await handler({ body: JSON.stringify(FORM) }, fakeContext());
    assert.strictEqual(calls.save.length, 1);
    assert.strictEqual(calls.notify.length, 1);
    assert.deepStrictEqual(calls.save[0].data, FORM);
    assert.deepStrictEqual(calls.notify[0].data, FORM);
  });

  await check('the handler context is forwarded to the notification branch', async () => {
    const { handler, calls } = makeHandler();
    await handler({ body: JSON.stringify(FORM) }, fakeContext());
    assert.strictEqual(calls.notify[0].ctx.getSecurityAccessKey(), 'LOCAL_TEST_AK');
  });

  await check('branches start in the same tick (genuine Promise.all fan-out)', async () => {
    const order = [];
    const handler = createHandler({
      sendNotification: async () => {
        order.push('notify:start');
        await new Promise((r) => setTimeout(r, 30));
        order.push('notify:end');
        return { messageId: 'm' };
      },
      saveFormData: async () => {
        order.push('save:start');
        await new Promise((r) => setTimeout(r, 30));
        order.push('save:end');
        return { formId: '42' };
      },
    });
    const startedAt = Date.now();
    await handler({ body: JSON.stringify(FORM) }, fakeContext());
    const elapsed = Date.now() - startedAt;
    assert.deepStrictEqual(order.slice(0, 2), ['notify:start', 'save:start']);
    assert.ok(elapsed < 55, 'branches ran sequentially, elapsed=' + elapsed + 'ms');
  });

  await check('invalid JSON payload returns 400 and never invokes the branches', async () => {
    const { handler, calls } = makeHandler();
    const res = await handler({ body: '{not-json' }, fakeContext());
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(calls.save.length + calls.notify.length, 0);
  });

  await check('persistence failure returns 500', async () => {
    const { handler } = makeHandler({ saveFormData: async () => { throw new Error('store offline'); } });
    const res = await handler({ body: JSON.stringify(FORM) }, fakeContext());
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(JSON.parse(res.body).error, 'failed to process the form submission');
  });

  await check('notification failure returns 500', async () => {
    const { handler } = makeHandler({ sendNotification: async () => { throw new Error('topic offline'); } });
    const res = await handler({ body: JSON.stringify(FORM) }, fakeContext());
    assert.strictEqual(res.statusCode, 500);
  });

  console.log('=== Event decoding ===');

  await check('accepts an already parsed body object', () => {
    assert.deepStrictEqual(parseFormEvent({ body: FORM }), FORM);
  });

  await check('accepts a base64-encoded body from the gateway', () => {
    const encoded = Buffer.from(JSON.stringify(FORM), 'utf8').toString('base64');
    assert.deepStrictEqual(parseFormEvent({ body: encoded, isBase64Encoded: true }), FORM);
  });

  await check('accepts a direct invocation event with a formData field', () => {
    assert.deepStrictEqual(parseFormEvent({ formData: FORM }), FORM);
  });

  await check('accepts a direct invocation event that is itself the form', () => {
    assert.deepStrictEqual(parseFormEvent(FORM), FORM);
  });

  await check('rejects a non-object payload', () => {
    assert.throws(() => parseFormEvent({ body: '[1,2]' }), /must be a JSON object/);
  });

  console.log('=== Persistence branch (real protocol client, no network) ===');

  await check('item has the string key, serialized payload and numeric timestamp', () => {
    const item = store.buildItem(FORM);
    assert.match(item.formId.S, /^\d+$/);
    assert.strictEqual(JSON.parse(item.formData.S).message, 'A test message');
    assert.strictEqual(typeof item.created.N, 'string');
    assert.ok(Number(item.created.N) > 0);
  });

  await check('each submission gets a distinct identifier', () => {
    assert.notStrictEqual(store.buildItem(FORM).formId.S, store.buildItem(FORM).formId.S);
  });

  await check('client points at the private endpoint with the instance account', () => {
    const client = store.buildClient();
    assert.ok(client, 'client not constructed');
    const config = store.readConfig();
    assert.strictEqual(config.endpoint, '10.0.1.10:80');
    assert.strictEqual(config.accessKeyId, 'rwuser');
  });

  await check('missing endpoint configuration is rejected', () => {
    assert.throws(() => store.buildClient({ endpoint: '', secretAccessKey: 'x' }), /GEMINIDB_ENDPOINT/);
  });

  await check('ensureTable describes first and creates only when absent', async () => {
    const sent = [];
    const fakeClient = {
      send: async (command) => {
        sent.push(command.constructor.name);
        if (command.constructor.name === 'DescribeTableCommand') {
          const err = new Error('missing'); err.name = 'ResourceNotFoundException'; throw err;
        }
        return {};
      },
    };
    await store.ensureTable(fakeClient, 'form_submissions');
    assert.deepStrictEqual(sent, ['DescribeTableCommand', 'CreateTableCommand']);
  });

  await check('ensureTable tolerates a backend that creates tables lazily', async () => {
    const fakeClient = {
      send: async (command) => {
        if (command.constructor.name === 'DescribeTableCommand') {
          const err = new Error('missing'); err.name = 'ResourceNotFoundException'; throw err;
        }
        const err = new Error('unsupported'); err.name = 'UnsupportedOperationException'; throw err;
      },
    };
    await store.ensureTable(fakeClient, 'form_submissions');
  });

  console.log('=== Notification branch (real SMN client, no network) ===');

  await check('message body lists every submitted field', () => {
    const text = notify.buildMessage(FORM);
    assert.ok(text.includes('name: Sender Name'));
    assert.ok(text.includes('reply_to: sender@example.com'));
    assert.ok(text.includes('message: A test message'));
  });

  await check('publish request carries topic URN, subject and body', () => {
    const req = notify.buildRequest(process.env.SMN_TOPIC_URN, 'New Form Submission', 'body');
    assert.strictEqual(req.topic_urn, process.env.SMN_TOPIC_URN);
    assert.strictEqual(req.body.subject, 'New Form Submission');
    assert.strictEqual(req.body.message, 'body');
  });

  await check('temporary credentials come from the function context', () => {
    const creds = notify.readCredentials(fakeContext());
    assert.strictEqual(creds.ak, 'LOCAL_TEST_AK');
    assert.strictEqual(creds.sk, 'LOCAL_TEST_SK');
    assert.strictEqual(creds.token, 'LOCAL_TEST_SECURITY_TOKEN');
    assert.strictEqual(creds.projectId, 'local-test-project');
  });

  await check('SMN client builds with a publishMessage method', () => {
    const client = notify.buildClient(fakeContext());
    assert.strictEqual(typeof client.publishMessage, 'function');
  });

  await check('missing credentials are rejected with an actionable error', () => {
    assert.throws(() => notify.buildClient({}, { ak: '', sk: '', token: '', projectId: 'x' }), /IAM agency/);
  });

  await check('publishing is invoked with a well-formed request', async () => {
    let captured = null;
    const result = await notify.sendNotification(FORM, fakeContext(), {
      client: { publishMessage: async (req) => { captured = req; return { message_id: 'mid-1' }; } },
    });
    assert.strictEqual(result.messageId, 'mid-1');
    assert.strictEqual(captured.topic_urn, process.env.SMN_TOPIC_URN);
    assert.strictEqual(captured.body.subject, 'New Form Submission');
    assert.ok(captured.body.message.includes('Sender Name'));
  });

  console.log('=== Browser form client (injected transport) ===');

  await check('POSTs JSON to the configured endpoint', async () => {
    let captured = null;
    const fakeFetch = async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200, text: async () => '{"message":"OK!"}' };
    };
    const res = await submitForm('https://example.test/release/submitForm', FORM, fakeFetch);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(captured.options.method, 'POST');
    assert.strictEqual(captured.options.headers['Content-Type'], 'application/json');
    assert.deepStrictEqual(JSON.parse(captured.options.body), FORM);
  });

  await check('collects named fields from a form element', () => {
    const fakeForm = { elements: [{ name: 'name', value: 'A' }, { name: '', value: 'ignored' }, { name: 'message', value: 'B' }] };
    assert.deepStrictEqual(collect(fakeForm), { name: 'A', message: 'B' });
  });

  await check('surfaces a non-2xx response without throwing', async () => {
    const fakeFetch = async () => ({ ok: false, status: 500, text: async () => 'Error' });
    const res = await submitForm('https://example.test/submitForm', FORM, fakeFetch);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.status, 500);
  });

  console.log('');
  console.log('=== Summary: ' + passed + ' passed, ' + failed + ' failed ===');
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('E2E runner error:', err);
  process.exitCode = 1;
});
