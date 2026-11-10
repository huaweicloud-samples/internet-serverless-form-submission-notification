'use strict';

// Persistence side of the fan-out. The key-value store speaks the
// DynamoDB-compatible wire protocol over a private VPC endpoint, so a
// protocol-compatible client is used with an explicit endpoint override.
//
// Data-plane authentication uses the instance account (rwuser + the instance
// administrator password). It is independent from the IAM agency credentials
// used by the control plane in notify.js.
const {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  PutItemCommand,
} = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const DEFAULT_PROTOCOL = 'http';

function readConfig() {
  return {
    endpoint: process.env.GEMINIDB_ENDPOINT || '',
    protocol: process.env.GEMINIDB_PROTOCOL || DEFAULT_PROTOCOL,
    region: process.env.REGION || 'cn-north-4',
    accessKeyId: process.env.GEMINIDB_ACCESS_KEY || 'rwuser',
    secretAccessKey: process.env.GEMINIDB_SECRET_KEY || '',
    tableName: process.env.FORM_TABLE || 'form_submissions',
  };
}

function buildClient(config = readConfig()) {
  if (!config.endpoint) {
    throw new Error('GEMINIDB_ENDPOINT is not configured');
  }
  if (!config.secretAccessKey) {
    throw new Error('GEMINIDB_SECRET_KEY is not configured');
  }
  return new DynamoDBClient({
    endpoint: `${config.protocol}://${config.endpoint}`,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function buildItem(formData) {
  return marshall({
    formId: String(Math.floor(Math.random() * 10000000)),
    formData: JSON.stringify(formData),
    created: Math.floor(Date.now() / 1000),
  });
}

// Some compatible deployments create a table on first write, while others
// require an explicit definition. Probe first, create only when missing, and
// tolerate a backend that refuses CreateTable so the lazy path still works.
async function ensureTable(client, tableName) {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return;
  } catch (err) {
    if (err && err.name !== 'ResourceNotFoundException') {
      throw err;
    }
  }

  try {
    await client.send(new CreateTableCommand({
      TableName: tableName,
      AttributeDefinitions: [{ AttributeName: 'formId', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'formId', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST',
    }));
  } catch (err) {
    const name = err && err.name;
    if (name === 'ResourceInUseException' || name === 'ResourceInUse') return;
    if (name === 'UnsupportedOperationException' || name === 'ValidationException') {
      // The backend creates tables lazily; continue to PutItem.
      return;
    }
    throw err;
  }
}

async function saveFormData(formData, deps = {}) {
  const config = deps.config || readConfig();
  const client = deps.client || buildClient(config);
  const tableName = config.tableName;

  await ensureTable(client, tableName);
  const item = deps.buildItem ? deps.buildItem(formData) : buildItem(formData);
  await client.send(new PutItemCommand({ TableName: tableName, Item: item }));
  return { formId: item.formId.S, table: tableName };
}

module.exports = { saveFormData, buildClient, buildItem, ensureTable, readConfig };
