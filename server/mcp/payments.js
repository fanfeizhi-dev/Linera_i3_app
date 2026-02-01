const { randomUUID } = require('crypto');
const { MCP_CONFIG } = require('./config');
const store = require('./store');

function createInvoice({
  type,
  userId,
  modelOrNode,
  amount,
  description,
  tokensOrCalls,
  metadata = {}
}) {
  const numericAmount = Number.isFinite(amount)
    ? amount
    : Number(amount || 0);
  const normalizedAmount = Number(numericAmount.toFixed(6));
  const requestId = randomUUID();
  const nonce = randomUUID();
  const expiresAt = new Date(
    Date.now() + MCP_CONFIG.payments.expiresInSeconds * 1000
  ).toISOString();
  const entry = store.createEntry({
    type,
    user_id: userId,
    request_id: requestId,
    nonce,
    amount_usdc: normalizedAmount,
    model_or_node: modelOrNode,
    tokens_or_calls: tokensOrCalls,
    expires_at: expiresAt,
    meta: {
      ...metadata,
      description
    }
  });
  return entry;
}

function build402Body(entry, extras = {}, networkConfig = null) {
  const paymentConfig = networkConfig || MCP_CONFIG.payments;
  const response = {
    status: 'payment_required',
    request_id: entry.request_id,
    nonce: entry.nonce,
    amount_usdc: entry.amount_usdc,
    currency: 'LIN',
    recipient: paymentConfig.recipient || MCP_CONFIG.payments.recipient,
    // Linera 真实转账需要指定收款链（可为空：前端会自行兜底，但推荐配置）
    recipient_chain_id:
      paymentConfig.recipientChainId ||
      MCP_CONFIG.payments.recipientChainId ||
      null,
    network: paymentConfig.network || MCP_CONFIG.payments.network,
    network_name: paymentConfig.networkName || MCP_CONFIG.payments.networkName || null,
    faucet_url: paymentConfig.faucetUrl || MCP_CONFIG.payments.faucetUrl || null,
    expires_at: entry.expires_at,
    memo: entry.request_id,
    description: entry.meta?.description,
    decimals: paymentConfig.decimals || MCP_CONFIG.payments.decimals,
    payment_url: paymentConfig.paymentUrl || MCP_CONFIG.payments.paymentUrl || null,
    rpc_endpoint: paymentConfig.rpcUrl || MCP_CONFIG.payments.rpcUrl,
    explorer_base_url: paymentConfig.explorerBaseUrl || MCP_CONFIG.payments.explorerBaseUrl,
    failure_modes: {
      timeout: 'Invoice expired, request a new 402',
      underpaid: 'Amount less than invoice, please top-up or downgrade',
      duplicate: 'Duplicate payment detected, flagged as orphan_payment'
    },
    ...extras
  };
  if (!response.payment_url) {
    delete response.payment_url;
  }
  if (!response.network_name) delete response.network_name;
  if (!response.faucet_url) delete response.faucet_url;
  if (!response.recipient_chain_id) delete response.recipient_chain_id;
  return response;
}

function parsePaymentHeader(header) {
  if (!header || typeof header !== 'string') return null;
  const trimmed = header.trim();

  // 检查是否是 prepaid credits 支付
  if (trimmed.toLowerCase().startsWith('prepaid')) {
    const parts = trimmed.split(/\s+/).slice(1).join(' ').split(';').map(p => p.trim()).filter(Boolean);
    const data = {};
    for (const part of parts) {
      const [key, value] = part.split('=');
      if (!key || typeof value === 'undefined') continue;
      data[key.trim().toLowerCase()] = value.trim();
    }
    return {
      isPrepaid: true,
      network: MCP_CONFIG.payments.network,
      tx: 'PREPAID_CREDITS',
      amount: 0,
      nonce: data.nonce || null,
      model: data.model || null,
      remaining: data.remaining ? Number(data.remaining) : 0,
      memo: 'PREPAID'
    };
  }

  // 检查是否是 Linera 真实转账 (x402-linera-transfer)
  if (trimmed.toLowerCase().startsWith('x402-linera-transfer')) {
    const paramsString = trimmed.substring(21).trim();
    const params = {};
    const parts = paramsString.split(';').map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key && typeof value !== 'undefined') {
        const k = key.trim().toLowerCase();
        const v = value.trim();
        params[k] = k === 'message' ? decodeURIComponent(v) : v;
      }
    }
    const result = {
      isPrepaid: false,
      isLineraTransfer: true,
      network: 'linera',
      senderChainId: params.sender_chain_id || params.senderchainid,
      senderAddress: params.sender_address || params.senderaddress,
      amount: params.amount ? parseFloat(params.amount) : null,
      nonce: params.nonce || null,
      timestamp: params.timestamp || null,
      memo: params.memo || 'LINERA_TRANSFER'
    };
    if (params.signature) {
      result.signature = params.signature;
      result.message = params.message || null;
      result.transferType = 'signed';
    } else {
      result.transferType = 'real';
    }
    return result;
  }

  // 原有的 x402 支付逻辑
  if (!trimmed.toLowerCase().startsWith('x402')) return null;
  const [, ...rest] = trimmed.split(/\s+/);
  const paramsString = rest.join(' ');
  const parts = paramsString
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  const data = {};
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (!key || typeof value === 'undefined') continue;
    const normalizedKey = key.trim().toLowerCase();
    data[normalizedKey] = value.trim();
  }
  if (!data.tx) {
    const txPart = parts.find((p) => p.startsWith('tx='));
    if (txPart) {
      data.tx = txPart.slice(3);
    }
  }
  if (!data.tx || !data.amount || !data.nonce) {
    return null;
  }
  return {
    isPrepaid: false,
    network: rest[0] || MCP_CONFIG.payments.network,
    tx: data.tx,
    amount: Number(data.amount),
    nonce: data.nonce,
    memo: data.memo || null
  };
}

function isExpired(entry) {
  if (!entry?.expires_at) return false;
  return Date.now() > Date.parse(entry.expires_at);
}

async function verifyLineraSignature(message, signature, expectedAddress) {
  try {
    const { recoverPersonalSignature } = require('@metamask/eth-sig-util');
    const recoveredAddress = recoverPersonalSignature({
      data: message,
      signature: signature
    });
    const recovered = recoveredAddress.toLowerCase();
    const expected = expectedAddress.toLowerCase();
    return recovered === expected;
  } catch (error) {
    console.error('[Payments] Signature verification failed:', error.message);
    return false;
  }
}

module.exports = {
  createInvoice,
  build402Body,
  parsePaymentHeader,
  isExpired,
  verifyLineraSignature
};