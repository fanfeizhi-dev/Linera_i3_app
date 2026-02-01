const path = require('path');

// 网络配置映射
const NETWORK_CONFIGS = {
  'linera': {
    network: 'linera',
    // 方案A：真实转账（Testnet Conway）
    // - explorerBaseUrl 用于前端/后端生成可点击的浏览器链接（若未来返回 tx id）
    // - rpcUrl 预留给后端做链上校验（当前仍以 Testnet 轻校验为主）
    explorerBaseUrl:
      process.env.LINERA_EXPLORER_BASE_URL ||
      'https://explorer.testnet-conway.linera.net',
    rpcUrl: process.env.LINERA_RPC_URL || null,
    // tokenType 用于 invoice 描述前端支付方式（transfer 优先，signature 兜底）
    tokenType: 'transfer',
    decimals: 18,
    // 真实转账需要明确收款链（否则会默认转到用户自己的链）
    recipientChainId: process.env.LINERA_RECIPIENT_CHAIN_ID || null,
    faucetUrl:
      process.env.LINERA_FAUCET_URL ||
      'https://faucet.testnet-conway.linera.net',
    networkName: process.env.LINERA_NETWORK_NAME || 'Testnet Conway'
  }
};

// 默认网络
const DEFAULT_NETWORK = process.env.X402_NETWORK || 'linera';

const MCP_CONFIG = {
  payments: {
    network: DEFAULT_NETWORK,
    // Linera 使用真实转账
    tokenType: NETWORK_CONFIGS[DEFAULT_NETWORK]?.tokenType || 'transfer',
    recipientChainId: NETWORK_CONFIGS[DEFAULT_NETWORK]?.recipientChainId || null,
    faucetUrl: NETWORK_CONFIGS[DEFAULT_NETWORK]?.faucetUrl || null,
    networkName: NETWORK_CONFIGS[DEFAULT_NETWORK]?.networkName || null,
    // 收款地址：可以通过环境变量覆盖
    recipient:
      process.env.X402_RECIPIENT ||
      '0x49e0329808559a9aa742a3cf01cec9b773a53834',
    paymentUrl: process.env.X402_PAYMENT_URL || null,
    explorerBaseUrl:
      NETWORK_CONFIGS[DEFAULT_NETWORK]?.explorerBaseUrl ||
      null,
    rpcUrl:
      NETWORK_CONFIGS[DEFAULT_NETWORK]?.rpcUrl ||
      null,
    // Linera 默认使用 18 位精度
    decimals: Number(
      process.env.X402_DECIMALS ||
        NETWORK_CONFIGS[DEFAULT_NETWORK]?.decimals ||
        18
    ),
    expiresInSeconds: Number(process.env.X402_EXPIRES_SECONDS || 300)
  },
  billing: {
    storeFile: path.join(__dirname, '..', '..', 'data', 'billing-entries.json')
  },
  autoRouter: {
    defaultMaxCandidates: 3
  }
};

// 根据请求头获取网络配置
function getNetworkConfigFromRequest(req) {
  const networkHeader =
    req.headers['x-linera-network'] ||
    req.body?.network ||
    DEFAULT_NETWORK;
  const networkKey = networkHeader || DEFAULT_NETWORK;
  const config = NETWORK_CONFIGS[networkKey] || NETWORK_CONFIGS[DEFAULT_NETWORK] || {};
  return {
    ...MCP_CONFIG.payments,
    network: config.network || DEFAULT_NETWORK,
    explorerBaseUrl: config.explorerBaseUrl,
    rpcUrl: config.rpcUrl,
    decimals: config.decimals ?? MCP_CONFIG.payments.decimals,
    tokenType: config.tokenType || MCP_CONFIG.payments.tokenType,
    recipientChainId: config.recipientChainId || MCP_CONFIG.payments.recipientChainId || null,
    faucetUrl: config.faucetUrl || MCP_CONFIG.payments.faucetUrl || null,
    networkName: config.networkName || MCP_CONFIG.payments.networkName || null
  };
}

module.exports = { MCP_CONFIG, getNetworkConfigFromRequest, NETWORK_CONFIGS };