// chains.js — 统一管理 EVM & Solana & Linera 的"当前链"与元数据

export const EVM_CHAINS = [
  { key: 'bsc',   type: 'evm', chainIdHex: '0x38', displayName: 'BNB Chain' },
  { key: 'opbnb', type: 'evm', chainIdHex: '0xcc', displayName: 'opBNB' },
];

// Linera 网络配置（使用签名支付，不需要 RPC）
export const LINERA = {
  key: 'linera',
  type: 'linera',
  displayName: 'Linera',
  explorerBaseUrl: null // Linera 使用签名支付，无链上交易
};

export const SOLANA = {
  key: 'solana',
  type: 'solana',
  cluster: (window?.ENV?.SOLANA_CLUSTER) || 'mainnet-beta',
  endpointByCluster: {
    'mainnet-beta': 'https://mainnet.helius-rpc.com/?api-key=fd6a5779-892d-47eb-a88b-bc961ca4b606',
    mainnet: 'https://mainnet.helius-rpc.com/?api-key=fd6a5779-892d-47eb-a88b-bc961ca4b606',
    devnet:  'https://api.devnet.solana.com',
    testnet: 'https://api.testnet.solana.com',
  },
  programId: (window?.ENV?.SOLANA_PROGRAM_ID) || 'HDNJ2F8CMHksj2EzuutDZiHrduCyi4KLZGabpdCs5BfZ',
  idlPath: '/solana-idl.json',
  explorerByCluster: {
    'mainnet-beta': 'https://explorer.solana.com',
    mainnet: 'https://explorer.solana.com',
    devnet:  'https://explorer.solana.com?cluster=devnet',
    testnet: 'https://explorer.solana.com?cluster=testnet',
  }
};

// 初始化当前链：优先读本地存储键
const DEFAULT_CHAIN_KEY = localStorage.getItem('currentChainKey') || 'linera';
export let CurrentChain = (DEFAULT_CHAIN_KEY === 'solana')
  ? SOLANA
  : (DEFAULT_CHAIN_KEY === 'linera')
    ? LINERA
    : (EVM_CHAINS.find(c => c.key === DEFAULT_CHAIN_KEY) || LINERA);

export function setCurrentChain(key) {
  if (key === 'solana') CurrentChain = SOLANA;
  else if (key === 'linera') CurrentChain = LINERA;
  else CurrentChain = EVM_CHAINS.find(c => c.key === key) || LINERA;
  localStorage.setItem('currentChainKey', key);
  window.dispatchEvent(new CustomEvent('chainChanged', { detail: { key } }));
}

export function isSolanaSelected() {
  return CurrentChain?.type === 'solana';
}

export function isLineraSelected() {
  return CurrentChain?.type === 'linera';
}

export function solanaEndpoint() {
  return SOLANA.endpointByCluster[SOLANA.cluster] || SOLANA.endpointByCluster['mainnet-beta'];
}

export function solanaExplorerTx(sig) {
  const base = SOLANA.explorerByCluster[SOLANA.cluster] || SOLANA.explorerByCluster['mainnet-beta'];
  return `${base}/tx/${sig}`;
}

// 让非模块脚本也能用
window.setCurrentChain  = setCurrentChain;
window.isSolanaSelected = isSolanaSelected;
window.isLineraSelected = isLineraSelected;
window.LINERA = LINERA; // 导出 Linera 配置