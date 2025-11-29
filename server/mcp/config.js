const path = require('path');

// 网络配置映射
const NETWORK_CONFIGS = {
  'solana-mainnet': {
    network: 'solana-mainnet',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC Mainnet mint
    explorerBaseUrl: 'https://explorer.solana.com/tx',
    rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=fd6a5779-892d-47eb-a88b-bc961ca4b606'
  },
  'solana-devnet': {
    network: 'solana-devnet',
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC Devnet mint
    explorerBaseUrl: 'https://explorer.solana.com/tx', // cluster 参数在生成链接时添加
    rpcUrl: 'https://api.devnet.solana.com'
  }
};

// 默认网络（mainnet）
const DEFAULT_NETWORK = process.env.X402_NETWORK || 'solana-mainnet';

const MCP_CONFIG = {
  payments: {
    network: DEFAULT_NETWORK,
    mint: NETWORK_CONFIGS[DEFAULT_NETWORK]?.mint || NETWORK_CONFIGS['solana-mainnet'].mint,
    recipient:
      process.env.X402_RECIPIENT ||
      'FWSVwBwtyN3mFY96cR3myCbsNYawdyZRyX1W29nsFqYV',
    paymentUrl: process.env.X402_PAYMENT_URL || null,
    explorerBaseUrl: NETWORK_CONFIGS[DEFAULT_NETWORK]?.explorerBaseUrl || NETWORK_CONFIGS['solana-mainnet'].explorerBaseUrl,
    rpcUrl: NETWORK_CONFIGS[DEFAULT_NETWORK]?.rpcUrl || NETWORK_CONFIGS['solana-mainnet'].rpcUrl,
    decimals: Number(process.env.X402_DECIMALS || 6),
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
  const networkHeader = req.headers['x-solana-network'] || req.body?.network || DEFAULT_NETWORK;
  const networkKey = networkHeader === 'mainnet-beta' ? 'solana-mainnet' : 
                     networkHeader === 'devnet' ? 'solana-devnet' :
                     networkHeader;
  const config = NETWORK_CONFIGS[networkKey] || NETWORK_CONFIGS[DEFAULT_NETWORK];
  
  return {
    ...MCP_CONFIG.payments,
    network: config.network,
    mint: config.mint,
    explorerBaseUrl: config.explorerBaseUrl,
    rpcUrl: config.rpcUrl
  };
}

module.exports = { MCP_CONFIG, getNetworkConfigFromRequest, NETWORK_CONFIGS };