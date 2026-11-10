# internet-serverless-form-submission-notification

> [English](README.md)

[![License](https://img.shields.io/badge/License-MIT%20No%20Attribution-blue.svg)](LICENSE)
[![Huawei Cloud](https://img.shields.io/badge/Huawei%20Cloud-IAM%20Auth-red.svg)](https://support.huaweicloud.com/intl/en-us/)
[![Build Status](https://img.shields.io/badge/Build-Passing-brightgreen.svg)](#)

> 基于华为云的无服务器表单提交与通知

---

## 1. 简介

用一个 FunctionGraph 函数承接网页表单提交：单个公网 HTTP 入口收到请求后，在**同一次调用内**把表单数据并行写入托管键值表并发布通知消息，两条分支都完成后才返回统一响应。全程无需创建或维护服务器。

面向后端与 DevOps 工程师，可作为「一次请求、两个托管副作用」这一模式的紧凑参考实现，附浏览器演示页与可复现的 Terraform 部署。

### 核心能力

- 一个 `POST /submitForm` 接口，由 API 网关专享实例承载并开启跨域。
- 单个 Node.js 18 函数用 `Promise.all` 在同一次调用内并行完成落库与通知。
- GeminiDB 兼容 DynamoDB 协议的键值实例，走 VPC 内网端点，表按需惰性创建。
- 消息通知服务（SMN）主题 + 已确认邮件订阅，把表单各字段以邮件送达。
- 轻量验证档：不创建公网网关，函数内的并行双写链路保持完整。

---

## 2. 目录

- [1. 简介](#1-简介)
- [2. 目录](#2-目录)
- [3. 架构图](#3-架构图)
- [4. 方案亮点](#4-方案亮点)
- [5. 涉及云服务](#5-涉及云服务)
- [6. 前置条件](#6-前置条件)
- [7. 快速开始](#7-快速开始)
- [8. 分步部署](#8-分步部署)
- [9. 使用方法 / 验证](#9-使用方法--验证)
- [10. 清理资源](#10-清理资源)
- [11. 详细说明](#11-详细说明)
- [12. 依赖](#12-依赖)
- [13. FAQ / 故障排除](#13-faq--故障排除)
- [14. 贡献指南](#14-贡献指南)
- [15. 许可证](#15-许可证)
- [16. 联系方式 / 维护者](#16-联系方式--维护者)

---

## 3. 架构图

> 一次请求进入单个函数，持久化与通知并行执行，两者完成后才返回响应。

```
                         ┌────────────────┐
                         │   用户浏览器   │
                         │ 填写并提交表单 │
                         └─────────┬──────┘
                                   │ ① POST /submitForm（JSON）
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│                      APIG 专享版（公网入口）                       │
│            POST /submitForm · 跨域已开启 · 同步调用函数            │
└────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│              FunctionGraph  submit-form（Node.js 18）              │
│     解析表单 → Promise.all 并行双写 → 统一返回 200 / 400 / 500     │
└───────────┬─────────────────────────────────────┬──────────────────┘
            │ ②a 落库                               │ ②b 发布消息
            ▼                                     ▼
┌────────────────────────────┐    ┌──────────────────────────────────┐
│    GeminiDB 兼容键值表     │    │    SMN 主题 + 已确认邮件订阅     │
│    表 form_submissions     │    │     主题 New Form Submission     │
│ 主键 formId · VPC 内网 80  │    │     送达订阅时确认的收件邮箱     │
└────────────────────────────┘    └──────────────────────────────────┘
```

**轻量验证档**（`-var enable_public_api=false`）：不创建网关专享实例、分组、API 与发布动作；VPC、键值实例、通知主题与函数保持不变，直接调用函数即可验证。

```
                         ┌────────────────┐
                         │  直接调用函数  │
                         │ （控制台/CLI） │
                         └─────────┬──────┘
                                   │ ① 传入表单 JSON
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│              FunctionGraph  submit-form（Node.js 18）              │
│     解析表单 → Promise.all 并行双写 → 统一返回 200 / 400 / 500     │
└───────────┬─────────────────────────────────────┬──────────────────┘
            │ ②a 落库                               │ ②b 发布消息
            ▼                                     ▼
┌────────────────────────────┐    ┌──────────────────────────────────┐
│    GeminiDB 兼容键值表     │    │    SMN 主题 + 已确认邮件订阅     │
│    表 form_submissions     │    │     主题 New Form Submission     │
│ 主键 formId · VPC 内网 80  │    │     送达订阅时确认的收件邮箱     │
└────────────────────────────┘    └──────────────────────────────────┘
```

组件职责、工作流程与安全设计详见 [`docs/architecture.md`](docs/architecture.md)。

**关键组件说明**：

- **API 网关（APIG）专享版**：对外提供 `POST /submitForm`，开启跨域，同步调用函数。
- **函数工作流（FunctionGraph）**：解析请求体，用 `Promise.all` 扇出两条分支，返回 200 / 400 / 500。
- **云数据库 GeminiDB**：以 `formId` 为主键保存表单内容、序列化载荷与创建时间。
- **消息通知服务（SMN）**：把表单内容发布到主题，由已确认的邮件订阅投递。
- **统一身份认证（IAM）**：云服务委托，运行时为控制面调用下发临时凭据。

---

## 4. 方案亮点

- **一次调用、两个副作用**：落库与通知在同一 tick 启动，全部完成后请求才返回。
- **代码包不含长期密钥**：控制面从函数上下文读取临时凭据，数据面使用实例自带账号。
- **数据链路不出内网**：键值实例不绑定公网地址，仅接受 VPC 内访问。
- **两档验证形态**：保留公网网关可用于浏览器演示；也可省略网关直接调用函数。
- **本地端到端可验**：27 项断言覆盖事件解析、扇出时序、错误码、请求形状与前端 POST 形状，无需连接云资源。

---

## 5. 涉及云服务

| 服务 | 用途 | 备注 |
|---|---|---|
| API 网关（APIG） | 公网 `POST /submitForm` 入口 | BASIC 专享实例；API 须显式发布到 `RELEASE` 环境 |
| 函数工作流（FunctionGraph） | 表单处理函数 | Node.js 18，512 MB，30 秒 |
| 云数据库 GeminiDB | 托管键值表 | 兼容 DynamoDB 协议，Cluster 形态，节点数下限 3 |
| 消息通知服务（SMN） | 邮件通知 | 主题 + 已确认的邮件订阅 |
| 统一身份认证（IAM） | 运行时委托 | `op_svc_cff` 云服务委托，授予发布与 VPC 相关角色 |
| 虚拟私有云（VPC） | 私有网络 | 函数与网关实例共用 VPC、子网与安全组 |

> 所有服务均可通过本仓库的 Terraform 创建；如需释放，请参见 [第 10 节「清理资源」](#10-清理资源)。

---

## 6. 前置条件

| 项 | 要求 | 说明 |
|---|---|---|
| **账号** | 已开通华为云账号并完成实名认证 | 个人 / 企业账号均可 |
| **权限** | 具备 IAM **Tenant Administrator** 或等效权限 | 用于创建 VPC、GeminiDB、SMN、FunctionGraph、API 网关与委托 |
| **Region** | 推荐 `cn-north-4` | 不同区域的规格码与可用区可能不同 |
| **Terraform** | `>= 1.5.0` | IaC 部署工具 |
| **huaweicloud Provider** | `>= 1.97.0` | 华为云 Terraform Provider |
| **Node.js / npm** | `>= 18` | 安装函数依赖并生成部署包 |
| **Python** | `>= 3.8` | 打包脚本依赖 |
| **访问密钥** | 在华为云「我的凭证」页面获取访问密钥，通过命令行环境提供 | 不要写入任何代码或配置文件 |

---

## 7. 快速开始

### 一键部署（推荐）

```bash
# 1. 克隆本仓库
git clone <repo-https-url> internet-serverless-form-submission-notification
cd internet-serverless-form-submission-notification

# 2. 通过命令行环境提供访问密钥（参见第 6 节）
export HW_ACCESS_KEY="<your-access-key>"
export HW_SECRET_KEY="<your-secret-key>"

# 3. 生成函数部署包并部署
bash scripts/package-function.sh
cd infra
cp terraform.tfvars.example terraform.tfvars
# 编辑 terraform.tfvars：填写 project_id、geminidb_password，按需填写 notify_email
terraform init
terraform plan
terraform apply -auto-approve
```

> **部署耗时**：约 15–25 分钟（托管键值实例创建耗时最长）。
> **完整步骤与每步预期输出**：参见 [第 8 节](#8-分步部署) 与 [`docs/deployment-guide.md`](docs/deployment-guide.md)。

---

## 8. 分步部署

### 步骤 1：生成函数部署包

```bash
bash scripts/package-function.sh
```

**预期输出**：`ZIP=.../build/submit-form.zip`。

### 步骤 2：初始化工作目录

```bash
cd internet-serverless-form-submission-notification/infra
terraform init
```

**预期输出**：`Terraform has been successfully initialized!`

### 步骤 3：预演资源变更

```bash
terraform validate
terraform plan
```

**预期输出**：`Success! The configuration is valid.`，随后输出 `Plan: N to add, 0 to change, 0 to destroy.`

### 步骤 4：执行部署

```bash
terraform apply -auto-approve
```

**预期输出**：`Apply complete! Resources: N added, 0 changed, 0 destroyed.`

### 步骤 5：确认邮件订阅

若填写了 `notify_email`，请打开该邮箱收到的订阅确认邮件并点击确认。只有已确认的订阅才会收到通知消息。

### 步骤 6：记录关键输出

```bash
terraform output
```

**预期输出**：列出 `api_endpoint`、`function_name`、`function_urn`、`smn_topic_urn`、`geminidb_endpoint`、`form_table_name` 与 `notify_email`。

---

## 9. 使用方法 / 验证

> **验证提醒**：部署完成后请按本节步骤自行验证，确认业务功能可用后方可视为交付完成。下列本地检查已在开发过程中实际执行；云端命令需在部署完成后执行。

### 验证 1：本地端到端检查（开发阶段已实测）

```bash
bash scripts/package-function.sh
node scripts/local-e2e/run_e2e.js
```

**预期输出**：
```
=== Summary: 27 passed, 0 failed ===
```

检查覆盖事件解析、并行扇出时序、两条分支入参一致性、400 / 500 错误路径、键值项结构、通知请求形状与前端 POST 形状。

### 验证 2：通过公网接口提交表单

```bash
ENDPOINT="$(terraform output -raw api_endpoint)"
curl -i -X POST "$ENDPOINT" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Sender Name","reply_to":"sender@example.com","message":"A test message"}'
```

**预期输出**：`HTTP/1.1 200`，响应体形如 `{"message":"OK!","formId":"1234567"}`；已确认的订阅邮箱收到主题为 `New Form Submission` 的通知邮件。

### 验证 3：浏览器演示页

打开 `src/frontend/index.html`，在「Form endpoint」填入 `api_endpoint`，填写表单后提交。

**预期输出**：`HTTP 200` 与 JSON 响应体。

### 验证 4：轻量验证档（无公网入口）

```bash
terraform apply -auto-approve -var enable_public_api=false
```

以 `terraform output -raw function_name` 指定的函数直接调用，事件体为 `{"body":"{\"name\":\"Sender Name\",\"message\":\"A test message\"}"}`。

**预期结果**：返回同样的 200 响应与同样的通知邮件，且不创建公网网关。

---

## 10. 清理资源

```bash
cd internet-serverless-form-submission-notification/infra
terraform destroy -auto-approve
```

**预期输出**：`Destroy complete! Resources: N destroyed.`

> **避免资源残留**：
> - `terraform destroy` 仅释放 Terraform state 中追踪的资源；
> - 在控制台另行创建的资源（例如手工新增的订阅）需单独释放；
> - 账号内其他任务共享的 VPC 资源不受影响。

---

## 11. 详细说明

### 工作流程

浏览器把表单 JSON POST 到 API 网关；网关以代理事件同步调用函数。函数解析 `event.body` 后同时启动两条分支：用函数上下文下发的临时凭据向 SMN 主题发布消息，用实例账号向 GeminiDB 兼容端点写入记录。两条分支都成功才返回 200；解析失败返回 400，任一分支失败返回 500。

### 配置项

| 变量 | 默认值 | 说明 |
|---|---|---|
| `region` | `cn-north-4` | 部署区域 |
| `project_id` | 必填 | 区域项目 ID，通知客户端构建凭据时使用 |
| `geminidb_password` | 必填 | 实例管理员密码，数据面账号固定为 `rwuser` |
| `geminidb_node_num` | `3` | 节点数；兼容接口下限为 3 |
| `form_table_name` | `form_submissions` | 保存表单记录的表名 |
| `notify_email` | `""` | 邮件订阅地址；留空则不创建订阅 |
| `notify_subject` | `New Form Submission` | 通知主题行 |
| `enable_public_api` | `true` | 是否创建网关专享实例与公网入口 |

完整清单与逐步说明参见 [`docs/deployment-guide.md`](docs/deployment-guide.md)。

### 接口 / API

| 方法 | 路径 | 请求 | 成功响应 |
|---|---|---|---|
| `POST` | `/release/submitForm` | `{"name":"...","reply_to":"...","message":"..."}` | `200` `{"message":"OK!","formId":"1234567"}` |
| `POST` | `/release/submitForm` | 非法 JSON | `400` `{"error":"invalid form payload"}` |
| `POST` | `/release/submitForm` | 合法 JSON，但某一分支失败 | `500` `{"error":"failed to process the form submission"}` |

所有响应均带 `Access-Control-Allow-Origin`、`Access-Control-Allow-Headers: Content-Type`、`Access-Control-Allow-Methods: OPTIONS,POST` 与 `Cache-Control: no-store`。

---

## 12. 依赖

| 名称 | 版本 | 用途 |
|---|---|---|
| Terraform | `>= 1.5.0` | IaC 编排 |
| huaweicloud Provider | `>= 1.97.0` | 华为云资源 |
| Node.js | `>= 18` | 函数运行时与打包 |
| `@aws-sdk/client-dynamodb` | `^3.744.0` | GeminiDB 兼容 DynamoDB 协议的线协议客户端 |
| `@aws-sdk/util-dynamodb` | `^3.744.0` | 线协议的条目序列化 |
| `@huaweicloud/huaweicloud-sdk-smn` | `^3.1.221` | 通知主题发布客户端 |
| `@huaweicloud/huaweicloud-sdk-core` | `^3.1.221` | 通知客户端的凭据与区域类型 |
| `uuid` | `^9.0.1` | 通知客户端核心包的运行时依赖 |

---

## 13. FAQ / 故障排除

### Q1：部署时提示「权限不足」怎么办？

**A**：确认账号具备 IAM **Tenant Administrator**，或至少具备 VPC、GeminiDB、SMN、FunctionGraph、API 网关的管理员权限以及创建委托的权限。

### Q2：函数返回 200，但收不到邮件？

**A**：邮件订阅尚未确认。打开订阅确认邮件完成确认，只有已确认的订阅才会收到发布的消息。

### Q3：函数日志出现 `Cannot find module 'uuid'`？

**A**：确认 `src/functions/submit-form/package.json` 中已声明 `uuid`，重新生成部署包后再执行一次 `terraform apply`。

### 故障排查清单

| 现象 | 可能原因 | 排查方法 |
|---|---|---|
| `FSS.1501 The delegate not exist` | IAM 委托生效延迟 | 配置已声明依赖；等待约 1 分钟后重新 apply |
| 写入报 `AccessDeniedException` | 数据面凭据不对 | 数据面只认 `rwuser` + 实例管理员密码 |
| 写入超时 | 端点端口选错 | Cluster 形态经负载均衡走 80，节点直连才是 8000 |
| 网关返回 404 | API 未发布或路径不对 | 检查发布资源，路径为 `/release/submitForm` |
| 浏览器报跨域错误 | 网关未开启跨域 | 核对 `cors = true` 与 `cors_allowed_origins` |
| 函数返回 500 | 某一分支失败 | 查看函数日志中的 `handler error` |

---

## 14. 贡献指南

欢迎提交 Issue 与 PR。请遵循以下流程：

1. **Issue**：描述问题 / 建议，含复现命令、预期与实际输出、截图。
2. **PR**：基于 `main` 新建 feature 分支；提交前运行 `terraform validate`、`terraform fmt -check` 与 `node scripts/local-e2e/run_e2e.js`。
3. **Code Review**：由 **[@<github-username>](https://github.com/<github-username>)** 审核通过后合并。

详细规范参见 `CONTRIBUTING.md`（如有）。

---

## 15. 许可证

本实践采用 **MIT No Attribution** 许可证发布。详见仓库根目录 [`LICENSE`](LICENSE) 文件。

```
MIT No Attribution

Copyright (c) Huawei Cloud

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software... (no attribution required)
```

---

## 16. 联系方式 / 维护者

| 项 | 内容 |
|---|---|
| **创建者** | [@<github-username>](https://github.com/<github-username>) |
| **维护者** | [@<github-username>](https://github.com/<github-username>) |
| **联系方式** | GitHub Issues / PR（见 [第 14 节](#14-贡献指南)） |
