# 部署指导书

## 1. 准备

| 项 | 要求 |
|---|---|
| 华为云账号 | 已完成实名认证，具备创建 VPC、GeminiDB、SMN、FunctionGraph、API 网关与 IAM 委托的权限 |
| 区域 | 推荐 `cn-north-4`；规格码与可用区在不同区域可能不同 |
| 工具 | Terraform `>= 1.5.0`、Node.js `>= 18`、npm、Python `>= 3.8`（打包脚本使用）、zip 能力 |
| Provider | `huaweicloud/huaweicloud >= 1.97.0`，由 `terraform init` 自动拉取 |
| 区域项目 ID | 在控制台「我的凭证」→「项目列表」中查看与所选区域对应的项目 ID |
| 实例密码 | 自行设定 GeminiDB 实例管理员密码，数据面账号固定为 `rwuser` |
| 收件邮箱 | 用于接收通知邮件的邮箱；留空则不创建邮件订阅 |

部署命令所需的访问密钥由运行环境提供，不写入仓库中的任何文件：

```bash
export HW_ACCESS_KEY="<your-access-key>"
export HW_SECRET_KEY="<your-secret-key>"
```

## 2. 生成函数部署包

Terraform 以 base64 内联方式上传函数代码，因此部署前必须先生成 zip：

```bash
bash scripts/package-function.sh
```

预期输出末尾显示 `ZIP=.../build/submit-form.zip`。该命令会在 `src/functions/submit-form/` 安装运行时依赖，并把代码与依赖一起打包。

> 依赖清单中显式包含 `uuid`：通知客户端所依赖的华为云 SDK 核心包在运行时会调用它，但自身未声明该依赖，需由应用侧补齐，否则函数在加载阶段报 `Cannot find module 'uuid'`。

若跳过此步骤直接执行 `terraform apply`，函数会以一段抛出错误的代码创建，调用时返回明确提示。

## 3. 填写部署参数

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
```

编辑 `terraform.tfvars`，至少填写 `project_id`、`geminidb_password`，并按需要设置 `notify_email`。`terraform.tfvars` 已被 `.gitignore` 忽略，不要提交到版本库。

| 变量 | 建议值 | 说明 |
|---|---|---|
| `project_id` | 区域对应的项目 ID | 通知客户端构建凭据时使用 |
| `geminidb_password` | 自行设定 | 实例管理员密码；修改会触发实例变更 |
| `notify_email` | 有效邮箱或留空 | 非空时创建邮件订阅，需要人工确认 |
| `enable_public_api` | `true` / `false` | 是否需要公网表单接口；`false` 为轻量验证档 |
| `geminidb_node_num` | `3` | 兼容接口的节点数下限，调小会被服务端拒绝 |
| `geminidb_endpoint_override` | 留空 | 留空时自动使用实例负载均衡地址与端口 80 |

## 4. 初始化与预演

```bash
terraform init
terraform validate
terraform plan
```

`terraform validate` 应输出 `Success! The configuration is valid.`。`terraform plan` 会列出拟创建的资源；完整档包含网关实例、分组、API、发布动作、网络、键值存储实例、通知主题、委托与函数。

## 5. 执行部署

```bash
terraform apply -auto-approve
```

预期输出：`Apply complete! Resources: N added, 0 changed, 0 destroyed.`

记录关键输出：

```bash
terraform output
```

| 输出 | 用途 |
|---|---|
| `api_endpoint` | 浏览器表单提交地址，形如 `https://<入口地址>/release/submitForm` |
| `function_name` / `function_urn` | 轻量验证档直接调用函数时使用 |
| `smn_topic_urn` | 通知主题标识 |
| `geminidb_endpoint` | 键值存储内网端点 |
| `notify_email` | 已订阅的收件地址 |

## 6. 确认邮件订阅（关键步骤）

`notify_email` 非空时，平台会向该地址发送订阅确认邮件。**必须点击邮件中的确认链接**，订阅状态变为已确认后，通知消息才会投递。未确认时函数发布消息仍会成功（返回 200），但收不到邮件。

可在控制台「消息通知服务」→「订阅」中查看订阅状态，或用 CLI 查询主题订阅列表，确认状态为已确认。

## 7. 验证业务链路

### 7.1 通过公网表单接口（完整档）

```bash
ENDPOINT="$(terraform output -raw api_endpoint)"
curl -i -X POST "$ENDPOINT" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Sender Name","reply_to":"sender@example.com","message":"A test message"}'
```

预期：`HTTP/1.1 200`，响应体形如 `{"message":"OK!","formId":"1234567"}`。随后检查邮箱是否收到主题为 `New Form Submission` 的邮件。

也可直接用浏览器打开 `src/frontend/index.html`，在「Form endpoint」填入 `api_endpoint` 后提交。

### 7.2 直接调用函数（轻量验证档）

```bash
FUNC="$(terraform output -raw function_name)"
# 以 FunctionGraph 直接调用接口传入同样的表单事件
```

直接调用时事件体为 `{"body":"{\"name\":\"...\",\"message\":\"...\"}"}`，函数同样返回 `{"message":"OK!","formId":"..."}`。

### 7.3 本地端到端检查

无需连接云资源即可验证处理逻辑：

```bash
bash scripts/package-function.sh
node scripts/local-e2e/run_e2e.js
```

预期末尾输出 `=== Summary: 27 passed, 0 failed ===`。该检查覆盖请求解析、并行扇出时序、两条分支的入参一致性、错误码、协议客户端请求形状与前端 POST 形状。

## 8. 轻量验证档

```bash
terraform apply -auto-approve -var enable_public_api=false
```

该档不创建网关专享实例、分组、API 与发布动作，其余资源不变；`api_endpoint` 返回说明文字。适合只需要验证函数内双写链路的场景。切回完整档时把变量改回 `true` 再 apply。

## 9. 清理

```bash
terraform destroy -auto-approve
```

预期输出：`Destroy complete! Resources: N destroyed.`

> 避免资源残留：销毁只释放 Terraform state 中追踪的资源；手工在控制台创建的订阅、对象或公网地址需单独释放。若销毁因依赖顺序失败，按「订阅 → 网关 API/发布 → 函数 → 实例」的顺序重试。

## 10. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 建函数报 `FSS.1501 The delegate not exist` | IAM 委托生效有短暂延迟 | 配置已声明 `depends_on`；仍失败则等待约 1 分钟后重新 apply |
| 函数日志 `Cannot find module 'uuid'` | 部署包未包含通知客户端的间接依赖 | 确认 `package.json` 含 `uuid`，重跑打包脚本并重新 apply |
| 写入报 `AccessDeniedException` | 数据面使用了委托凭据或密码不对 | 数据面只用 `rwuser` + 实例管理员密码；核对 `geminidb_password` |
| 写入超时 | 端点端口选错 | 集群形态经负载均衡走端口 80，节点直连才是 8000；检查 `geminidb_endpoint_override` |
| 发布消息成功但收不到邮件 | 邮件订阅未确认 | 打开确认邮件完成订阅，再检查订阅状态 |
| 网关返回 404 | API 未发布或路径不对 | 确认发布资源已创建，路径为 `/release/submitForm` |
| 函数返回 500 | 任一支路失败 | 查看函数日志中的 `handler error` 定位到持久化还是通知 |
| 浏览器报跨域错误 | 网关侧 `cors` 未开启或来源受限 | 检查 `infra/apig.tf` 的 `cors` 与 `cors_allowed_origins` |
