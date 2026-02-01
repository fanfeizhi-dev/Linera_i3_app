# Intelligence Cubed (i³) – Linera Edition

本仓库已完成到 **Linera Edition** 的迁移：前端与后端统一使用 **Linera SDK 真实转账**（`@linera/client`），在 Linera Testnet Conway 上执行真实的链上代币转账。

## 核心概念

- **支付模型**：当后端返回 HTTP `402`（x402 invoice）时，前端会使用 Linera SDK 执行真实的链上转账，并把转账信息作为支付凭证提交给后端。
- **真实链上转账**：使用 `@linera/client` SDK 在 Linera Testnet Conway 上执行真实转账。MetaMask 作为 Linera 的签名器（Signer）。
- **Faucet 自动领取**：首次连接时会自动从 Linera Faucet 领取测试链和代币。

## 支付流程

1. 后端返回 `402 Payment Required` 和 invoice
2. 前端显示支付确认对话框
3. 用户确认后，通过 Linera SDK 执行真实转账
4. 前端提交支付凭证（sender chain ID, sender address, amount, nonce）
5. 后端验证并完成服务

## 开发运行

```bash
npm install
```

### 方式 A（推荐：开发模式，前后端都跑）

```bash
# 一条命令同时启动后端(3000) + 前端(5173)
npm run dev:full
```

Vite 会把 `/mcp/*` 和 `/api/*` **代理到** `http://localhost:3000`（后端 `serve.js`）。

### 方式 B（生产模式/部署前验证）

```bash
npm run build
npm start
```

默认启动 `serve.js`，并提供：
- 前端页面（静态资源）
- MCP 接口：`/mcp/*`（包含 `402` 发票、转账校验、模型调用等）

## 关于 `linera-protocol/`

`linera-protocol/` 目录包含 Linera 官方协议与示例代码，可作为教程/参考资料；**当前主项目不依赖也不直接引用该目录**。
