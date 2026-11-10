# Contributing

Thanks for helping improve this reference architecture.

## Development setup

| Tool | Version |
|---|---|
| Terraform | `>= 1.5.0` |
| Node.js / npm | `>= 18` |
| Python | `>= 3.8` |

```bash
bash scripts/package-function.sh
node scripts/local-e2e/run_e2e.js
cd infra && terraform fmt -check && terraform validate
```

## Pull request checklist

- [ ] `node scripts/local-e2e/run_e2e.js` reports `0 failed`.
- [ ] `terraform fmt -check` and `terraform validate` pass.
- [ ] Both `README.md` and `README.cn.md` remain chapter-for-chapter aligned.
- [ ] Architecture diagrams in both READMEs stay identical in topology to `docs/architecture.md` and keep the 70-column box width.
- [ ] No credentials, project identifiers or generated state are committed.
- [ ] New environment variables are added to `infra/functions.tf`, `infra/terraform.tfvars.example` and the deployment guide.

## Reporting issues

Include the region, Terraform and provider versions, the exact command, and the full error output with any credential values redacted.
