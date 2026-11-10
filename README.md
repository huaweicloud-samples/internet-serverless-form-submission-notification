# internet-serverless-form-submission-notification

> [中文](README.cn.md)

[![License](https://img.shields.io/badge/License-MIT%20No%20Attribution-blue.svg)](LICENSE)
[![Huawei Cloud](https://img.shields.io/badge/Huawei%20Cloud-IAM%20Auth-red.svg)](https://support.huaweicloud.com/intl/en-us/)
[![Build Status](https://img.shields.io/badge/Build-Passing-brightgreen.svg)](#)

> Serverless Form Submission and Notification on Huawei Cloud

---

## 1. Overview

A single FunctionGraph function receives a web form submission over one public HTTP endpoint. Within the same request it writes the payload to a managed key-value table and publishes a notification message in parallel, then returns one unified response. No server is provisioned or maintained.

Designed for backend engineers and DevOps teams who want a compact reference for the "one request, two managed side effects" pattern, including an optional browser demo page and a reproducible Terraform deployment.

### Core Capabilities

- One `POST /submitForm` endpoint backed by a dedicated API Gateway instance with CORS enabled.
- A single Node.js 18 function that fans out with `Promise.all` to persistence and notification in the same invocation.
- A GeminiDB instance using the DynamoDB-compatible wire protocol over a private VPC endpoint, with lazy table creation.
- A Simple Message Notification (SMN) topic with a confirmed email subscription that delivers the submitted fields by email.
- A lightweight verification profile that omits the public gateway while keeping the full dual-write chain intact.

---

## 2. Table of Contents

- [1. Overview](#1-overview)
- [2. Table of Contents](#2-table-of-contents)
- [3. Architecture](#3-architecture)
- [4. Highlights](#4-highlights)
- [5. Cloud Services Used](#5-cloud-services-used)
- [6. Prerequisites](#6-prerequisites)
- [7. Quick Start](#7-quick-start)
- [8. Step-by-Step Deployment](#8-step-by-step-deployment)
- [9. Usage / Verification](#9-usage--verification)
- [10. Cleanup](#10-cleanup)
- [11. Detailed Explanation](#11-detailed-explanation)
- [12. Dependencies](#12-dependencies)
- [13. FAQ / Troubleshooting](#13-faq--troubleshooting)
- [14. Contributing](#14-contributing)
- [15. License](#15-license)
- [16. Contact / Maintainers](#16-contact--maintainers)

---

## 3. Architecture

> One request enters a single function; persistence and notification run as two parallel branches before the response is returned.

```
                         ┌────────────────┐
                         │  User browser  │
                         │  Submit form   │
                         └─────────┬──────┘
                                   │ (1) POST /submitForm (JSON)
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│               APIG dedicated instance (public entry)               │
│        POST /submitForm - CORS enabled - synchronous invoke        │
└────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│              FunctionGraph  submit-form (Node.js 18)               │
│     Parse form -> Promise.all fan-out -> 200 / 400 / 500 reply     │
└───────────┬─────────────────────────────────────┬──────────────────┘
            │ (2a) persist                        │ (2b) publish
            ▼                                     ▼
┌────────────────────────────┐    ┌──────────────────────────────────┐
│ GeminiDB compatible table  │    │   SMN topic + confirmed email    │
│   Table form_submissions   │    │   Subject New Form Submission    │
│    Key formId - VPC :80    │    │   Delivered to confirmed inbox   │
└────────────────────────────┘    └──────────────────────────────────┘
```

**Lightweight verification profile** (`-var enable_public_api=false`): the dedicated gateway, its API group, the API and its publication are not created. The VPC, key-value store, topic and function remain unchanged, so the function is invoked directly.

```
                         ┌────────────────┐
                         │ Direct invoke  │
                         │ console or CLI │
                         └─────────┬──────┘
                                   │ (1) pass form JSON
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│              FunctionGraph  submit-form (Node.js 18)               │
│     Parse form -> Promise.all fan-out -> 200 / 400 / 500 reply     │
└───────────┬─────────────────────────────────────┬──────────────────┘
            │ (2a) persist                        │ (2b) publish
            ▼                                     ▼
┌────────────────────────────┐    ┌──────────────────────────────────┐
│ GeminiDB compatible table  │    │   SMN topic + confirmed email    │
│   Table form_submissions   │    │   Subject New Form Submission    │
│    Key formId - VPC :80    │    │   Delivered to confirmed inbox   │
└────────────────────────────┘    └──────────────────────────────────┘
```

The component responsibilities, workflow and security design are documented in [`docs/architecture.md`](docs/architecture.md).

**Key components**:

- **API Gateway (APIG) dedicated instance**: exposes `POST /submitForm`, enables CORS, and invokes the function synchronously.
- **FunctionGraph**: parses the request body, runs the two branches with `Promise.all`, and returns 200 / 400 / 500.
- **GeminiDB**: stores each submission with a `formId` key, the serialized payload and a creation timestamp.
- **Simple Message Notification (SMN)**: publishes the submitted fields to a topic with a confirmed email subscription.
- **Identity and Access Management (IAM)**: cloud service agency that supplies temporary credentials for control-plane calls at runtime.

---

## 4. Highlights

- **One invocation, two side effects**: persistence and notification start in the same tick; the request only returns after both complete.
- **No long-lived keys in the package**: control-plane calls read temporary credentials from the function context; data-plane access uses the managed instance account.
- **Private data path**: the key-value store has no public endpoint and is reached only from inside the VPC.
- **Two verification profiles**: keep the public gateway for the browser demo, or omit it and invoke the function directly.
- **Local end-to-end checks**: 27 assertions cover event decoding, fan-out timing, error codes, request shapes and the browser form client without contacting the cloud.

---

## 5. Cloud Services Used

| Service | Purpose | Notes |
|---|---|---|
| API Gateway (APIG) | Public `POST /submitForm` endpoint | Dedicated BASIC instance; API must be published to `RELEASE` |
| FunctionGraph | Form processing function | Node.js 18, 512 MB, 30 s |
| GeminiDB | Managed key-value table | DynamoDB-compatible interface, Cluster mode, three nodes minimum |
| Simple Message Notification (SMN) | Email notification | Topic plus a confirmed email subscription |
| Identity and Access Management (IAM) | Runtime agency | `op_svc_cff` cloud service agency with publishing and VPC roles |
| Virtual Private Cloud (VPC) | Private network | VPC, subnet and security group shared by the function and the gateway |

> All services are created with the Terraform in this repository. To release them, see [Section 10 "Cleanup"](#10-cleanup).

---

## 6. Prerequisites

| Item | Requirement | Description |
|---|---|---|
| **Account** | Huawei Cloud account with real-name verification | Personal or enterprise account |
| **Permissions** | IAM **Tenant Administrator** or equivalent | To create VPC, GeminiDB, SMN, FunctionGraph, API Gateway and an agency |
| **Region** | Recommended `cn-north-4` | Flavor codes and availability zones differ across regions |
| **Terraform** | `>= 1.5.0` | IaC deployment tool |
| **huaweicloud Provider** | `>= 1.97.0` | Huawei Cloud Terraform Provider |
| **Node.js / npm** | `>= 18` | Used to install function dependencies and build the deployment package |
| **Python** | `>= 3.8` | Used by the packaging script to assemble the zip |
| **Access keys** | Obtain an Access Key and Secret Access Key from the Huawei Cloud "My Credentials" page and provide them through the shell environment | Do not write credentials into any code or configuration file |

---

## 7. Quick Start

### One-click Deployment (Recommended)

```bash
# 1. Clone this repository
git clone <repo-https-url> internet-serverless-form-submission-notification
cd internet-serverless-form-submission-notification

# 2. Provide access keys through the shell environment (see Section 6)
export HW_ACCESS_KEY="<your-access-key>"
export HW_SECRET_KEY="<your-secret-key>"

# 3. Build the function package and deploy
bash scripts/package-function.sh
cd infra
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars: set project_id, geminidb_password and optionally notify_email
terraform init
terraform plan
terraform apply -auto-approve
```

> **Deployment time**: about 15–25 minutes (the managed key-value instance takes the longest).
> **Full steps with expected output**: see [Section 8](#8-step-by-step-deployment) and [`docs/deployment-guide.md`](docs/deployment-guide.md).

---

## 8. Step-by-Step Deployment

### Step 1: Build the function deployment package

```bash
bash scripts/package-function.sh
```

**Expected output**: `ZIP=.../build/submit-form.zip`.

### Step 2: Initialize the working directory

```bash
cd internet-serverless-form-submission-notification/infra
terraform init
```

**Expected output**: `Terraform has been successfully initialized!`

### Step 3: Preview resource changes

```bash
terraform validate
terraform plan
```

**Expected output**: `Success! The configuration is valid.` followed by `Plan: N to add, 0 to change, 0 to destroy.`

### Step 4: Apply the deployment

```bash
terraform apply -auto-approve
```

**Expected output**: `Apply complete! Resources: N added, 0 changed, 0 destroyed.`

### Step 5: Confirm the email subscription

If `notify_email` is set, open the confirmation message sent to that address and confirm the subscription. Messages are delivered only to confirmed subscriptions.

### Step 6: Record key outputs

```bash
terraform output
```

**Expected output**: lists `api_endpoint`, `function_name`, `function_urn`, `smn_topic_urn`, `geminidb_endpoint`, `form_table_name` and `notify_email`.

---

## 9. Usage / Verification

> **Verification notice**: after deployment, follow this section to verify that the business functionality works before considering the delivery complete. The local end-to-end checks below have been executed during development; the cloud commands require a deployed stack.

### Verification 1: Local end-to-end checks (executed during development)

```bash
bash scripts/package-function.sh
node scripts/local-e2e/run_e2e.js
```

**Expected output**:
```
=== Summary: 27 passed, 0 failed ===
```

The checks cover request decoding, genuine parallel fan-out timing, identical payloads on both branches, 400 / 500 error paths, key-value item shape, notification request shape and the browser form client.

### Verification 2: Submit the form through the public endpoint

```bash
ENDPOINT="$(terraform output -raw api_endpoint)"
curl -i -X POST "$ENDPOINT" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Sender Name","reply_to":"sender@example.com","message":"A test message"}'
```

**Expected output**: `HTTP/1.1 200` with a body such as `{"message":"OK!","formId":"1234567"}`. A notification email with subject `New Form Submission` is delivered to the confirmed subscription.

### Verification 3: Browser demo page

Open `src/frontend/index.html`, paste the value of `api_endpoint` into the "Form endpoint" field, fill the form and submit.

**Expected output**: `HTTP 200` followed by the JSON response body.

### Verification 4: Lightweight profile without a public endpoint

```bash
terraform apply -auto-approve -var enable_public_api=false
```

Then invoke the function named by `terraform output -raw function_name` with the event `{"body":"{\"name\":\"Sender Name\",\"message\":\"A test message\"}"}`.

**Expected result**: the same 200 response and the same notification email; no public gateway is created.

---

## 10. Cleanup

```bash
cd internet-serverless-form-submission-notification/infra
terraform destroy -auto-approve
```

**Expected output**: `Destroy complete! Resources: N destroyed.`

> **Avoid resource residue**:
> - `terraform destroy` only releases resources tracked in the Terraform state;
> - resources created directly in the console (for example an extra subscription) must be released manually;
> - shared VPC resources used by other tasks in the account are not affected.

---

## 11. Detailed Explanation

### Workflow

The browser POSTs JSON to the API Gateway endpoint. The gateway synchronously invokes the FunctionGraph function with a proxy event. The function parses `event.body`, then starts two branches at once: publishing a message to the SMN topic with credentials from the function context, and writing the record to the GeminiDB compatible endpoint with the instance account. Both must resolve before the function returns 200; a parse failure returns 400 and any branch failure returns 500.

### Configuration Items

| Variable | Default | Description |
|---|---|---|
| `region` | `cn-north-4` | Deployment region |
| `project_id` | *(required)* | Region project ID used by the notification client |
| `geminidb_password` | *(required)* | Instance administrator password for the data-plane account `rwuser` |
| `geminidb_node_num` | `3` | Node count; the compatible interface has a three-node minimum |
| `form_table_name` | `form_submissions` | Table that stores submissions |
| `notify_email` | `""` | Email subscription address; empty skips the subscription |
| `notify_subject` | `New Form Submission` | Notification subject line |
| `enable_public_api` | `true` | Create the dedicated gateway and public entry |

See [`docs/deployment-guide.md`](docs/deployment-guide.md) for the full list and per-step details.

### Interfaces / APIs

| Method | Path | Request | Success response |
|---|---|---|---|
| `POST` | `/release/submitForm` | `{"name":"...","reply_to":"...","message":"..."}` | `200` `{"message":"OK!","formId":"1234567"}` |
| `POST` | `/release/submitForm` | Invalid JSON | `400` `{"error":"invalid form payload"}` |
| `POST` | `/release/submitForm` | Valid JSON, one branch fails | `500` `{"error":"failed to process the form submission"}` |

All responses include `Access-Control-Allow-Origin`, `Access-Control-Allow-Headers: Content-Type`, `Access-Control-Allow-Methods: OPTIONS,POST` and `Cache-Control: no-store`.

---

## 12. Dependencies

| Name | Version | Purpose |
|---|---|---|
| Terraform | `>= 1.5.0` | IaC orchestration |
| huaweicloud Provider | `>= 1.97.0` | Huawei Cloud resources |
| Node.js | `>= 18` | Function runtime and packaging |
| `@aws-sdk/client-dynamodb` | `^3.744.0` | Wire-protocol client for the GeminiDB DynamoDB-compatible interface |
| `@aws-sdk/util-dynamodb` | `^3.744.0` | Item marshalling for the wire protocol |
| `@huaweicloud/huaweicloud-sdk-smn` | `^3.1.221` | Notification topic publishing client |
| `@huaweicloud/huaweicloud-sdk-core` | `^3.1.221` | Credentials and region types for the notification client |
| `uuid` | `^9.0.1` | Runtime dependency required by the notification client's core package |

---

## 13. FAQ / Troubleshooting

### Q1: What if deployment reports "insufficient permissions"?

**A**: Confirm the account has IAM **Tenant Administrator**, or at least administrator permissions for VPC, GeminiDB, SMN, FunctionGraph and API Gateway plus permission to create an agency.

### Q2: The function returns 200 but no email arrives. Why?

**A**: The email subscription has not been confirmed. Open the subscription confirmation message and confirm it; only confirmed subscriptions receive published messages.

### Q3: The function log shows `Cannot find module 'uuid'`. What should I do?

**A**: Rebuild the deployment package after confirming `uuid` is listed in `src/functions/submit-form/package.json`, then run `terraform apply` again.

### Troubleshooting Checklist

| Symptom | Possible Cause | Troubleshooting |
|---|---|---|
| `FSS.1501 The delegate not exist` | IAM agency propagation delay | Wait about a minute and re-apply; the configuration already declares the dependency |
| `AccessDeniedException` on write | Wrong data-plane credentials | The data plane accepts only `rwuser` plus the instance administrator password |
| Write timeout | Wrong endpoint port | Cluster mode uses load balancer port 80; node-direct connections use 8000 |
| Gateway returns 404 | API not published or wrong path | Check the publication resource and use `/release/submitForm` |
| Browser CORS error | Gateway CORS disabled | Verify `cors = true` and `cors_allowed_origins` |
| Function returns 500 | One branch failed | Read the `handler error` entry in the function log |

---

## 14. Contributing

Issues and PRs are welcome. Please follow this process:

1. **Issue**: describe the problem or suggestion with reproduction commands, expected and actual output, and screenshots.
2. **PR**: create a feature branch from `main`; run `terraform validate`, `terraform fmt -check` and `node scripts/local-e2e/run_e2e.js` before submitting.
3. **Code Review**: merged after review by **[@<github-username>](https://github.com/<github-username>)**.

See `CONTRIBUTING.md` for details (if available).

---

## 15. License

This reference architecture is released under the **MIT No Attribution** license. See the [`LICENSE`](LICENSE) file at the repository root for details.

```
MIT No Attribution

Copyright (c) Huawei Cloud

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software... (no attribution required)
```

---

## 16. Contact / Maintainers

| Item | Content |
|---|---|
| **Creator** | [@<github-username>](https://github.com/<github-username>) |
| **Maintainer** | [@<github-username>](https://github.com/<github-username>) |
| **Contact** | GitHub Issues / PR (see [Section 14](#14-contributing)) |
