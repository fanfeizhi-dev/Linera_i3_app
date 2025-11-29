const { Connection } = require('@solana/web3.js');
const { MCP_CONFIG } = require('./config');

const DEFAULT_RPC = 'https://mainnet.helius-rpc.com/?api-key=fd6a5779-892d-47eb-a88b-bc961ca4b606';
let sharedConnection = null;

function getConnection() {
  if (!sharedConnection) {
    const rpcEndpoint = MCP_CONFIG.payments.rpcUrl || DEFAULT_RPC;
    sharedConnection = new Connection(rpcEndpoint, 'confirmed');
  }
  return sharedConnection;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAddress(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function buildExplorerUrl(signature) {
  const base = MCP_CONFIG.payments.explorerBaseUrl;
  if (!base) {
    return `https://explorer.solana.com/tx/${signature}`;
  }
  if (base.includes('{tx}')) {
    return base.replace('{tx}', signature);
  }
  const [path, query] = base.split('?');
  if (query) {
    return `${path.replace(/\/$/, '')}/${signature}?${query}`;
  }
  return `${base.replace(/\/$/, '')}/${signature}`;
}

function toBaseUnits(amount, decimals) {
  const value = typeof amount === 'string' ? amount : String(amount);
  const [wholeRaw, fracRaw = ''] = value.split('.');
  const whole = wholeRaw.length ? wholeRaw : '0';
  const fraction = fracRaw.padEnd(decimals, '0').slice(0, decimals);
  const digits = `${whole}${fraction}`;
  if (!/^\d+$/.test(digits)) {
    throw new Error(`Invalid amount "${amount}" for conversion`);
  }
  return BigInt(digits);
}

async function fetchParsedTransaction(signature, { attempts = 12, delayMs = 1000, rpcUrl = null } = {}) {
  const rpcEndpoint = rpcUrl || MCP_CONFIG.payments.rpcUrl || DEFAULT_RPC;
  const conn = new Connection(rpcEndpoint, 'confirmed');
  
  // 先尝试使用 'processed' commitment（更快，但可能不够稳定）
  for (let i = 0; i < Math.min(attempts, 6); i += 1) {
    try {
      const tx = await conn.getParsedTransaction(signature, {
        commitment: 'processed',
        maxSupportedTransactionVersion: 0
      });
      if (tx) {
        console.log(`[solana-verifier] Transaction found with 'processed' commitment (attempt ${i + 1})`);
        return tx;
      }
    } catch (err) {
      // 如果 processed 失败，继续尝试
      console.warn(`[solana-verifier] Failed to fetch with 'processed' commitment (attempt ${i + 1}):`, err.message);
    }
    await sleep(delayMs);
  }
  
  // 如果 processed 找不到，尝试使用 'confirmed' commitment（更稳定，但更慢）
  console.log(`[solana-verifier] Transaction not found with 'processed', trying 'confirmed' commitment...`);
  for (let i = 0; i < attempts; i += 1) {
    try {
      const tx = await conn.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      if (tx) {
        console.log(`[solana-verifier] Transaction found with 'confirmed' commitment (attempt ${i + 1})`);
        return tx;
      }
    } catch (err) {
      console.warn(`[solana-verifier] Failed to fetch with 'confirmed' commitment (attempt ${i + 1}):`, err.message);
    }
    await sleep(delayMs);
  }
  
  console.warn(`[solana-verifier] Transaction not found after ${attempts} attempts with both 'processed' and 'confirmed' commitments`);
  return null;
}

async function verifySolanaUsdcTransfer({
  signature,
  amount,
  mint,
  recipient,
  decimals,
  memo,
  expectedWallet,
  networkConfig = null
}) {
  const rpcUrl = networkConfig?.rpcUrl || null;
  const networkName = networkConfig?.network || 'unknown';
  
  // 记录使用的网络配置
  console.log(`[solana-verifier] Verifying transaction ${signature} on network: ${networkName}`);
  console.log(`[solana-verifier] Using RPC: ${rpcUrl || 'default'}`);
  console.log(`[solana-verifier] Explorer URL: ${networkConfig?.explorerBaseUrl || 'default'}`);
  
  const parsedTx = await fetchParsedTransaction(signature, { rpcUrl });
  if (!parsedTx) {
    // 交易找不到可能是暂时的（RPC 延迟），给出更友好的错误信息
    console.warn(`[solana-verifier] Transaction ${signature} not found on RPC after multiple attempts. This may be a temporary delay.`);
    
    // 生成正确的交易链接（根据网络）
    const explorerBaseUrl = networkConfig?.explorerBaseUrl || MCP_CONFIG.payments.explorerBaseUrl;
    const baseUrl = explorerBaseUrl ? explorerBaseUrl.replace(/\/$/, '') : 'https://explorer.solana.com/tx';
    const explorerLink = networkConfig?.network === 'solana-devnet'
      ? `${baseUrl}/${signature}?cluster=devnet`
      : `${baseUrl}/${signature}`;
    
    return {
      ok: false,
      code: 'tx_not_found',
      message: `Transaction not found on Solana RPC after verification attempts. The transaction may still be processing. Please check the transaction on Solana Explorer: ${explorerLink}`,
      details: {
        signature,
        rpcUrl: rpcUrl || 'default',
        network: networkName,
        explorerLink,
        note: 'This is usually a temporary issue. The transaction may have succeeded but not yet visible on the RPC endpoint.'
      }
    };
  }

  if (parsedTx.meta?.err) {
    return {
      ok: false,
      code: 'tx_failed',
      message: 'On-chain transaction failed.',
      details: parsedTx.meta.err
    };
  }

  let memoMatched = memo ? false : null;
  if (memo) {
    const memoIx = (parsedTx.transaction?.message?.instructions || []).find((ix) => {
      if (!ix) return false;
      if (ix.program === 'spl-memo' && ix.parsed?.info?.memo) {
        return ix.parsed.info.memo === memo;
      }
      if (ix.programId === 'Memo111111111111111111111111111111111111111') {
        return ix.parsed?.info?.memo === memo;
      }
      return false;
    });
    if (memoIx) {
      memoMatched = true;
    } else {
      console.warn('[solana-verifier] memo mismatch', { expected: memo, signature });
      memoMatched = false;
    }
  }

  const postBalances = parsedTx.meta?.postTokenBalances || [];
  const preBalances = parsedTx.meta?.preTokenBalances || [];
  const recipientLower = normalizeAddress(recipient);

  const postRecipient = postBalances.find(
    (b) => b?.mint === mint && normalizeAddress(b.owner) === recipientLower
  );
  const preRecipient = preBalances.find(
    (b) => b?.mint === mint && normalizeAddress(b.owner) === recipientLower
  );

  if (!postRecipient) {
    return {
      ok: false,
      code: 'recipient_account_missing',
      message: 'Recipient token account not present in transaction balance changes.'
    };
  }

  const after = BigInt(postRecipient.uiTokenAmount?.amount || '0');
  const before = BigInt(preRecipient?.uiTokenAmount?.amount || '0');
  const transferred = after - before;
  const required = toBaseUnits(amount, decimals);

  if (transferred < required) {
    return {
      ok: false,
      code: 'insufficient_amount',
      message: 'Transferred amount below invoice requirement.',
      details: {
        transferred: transferred.toString(),
        required: required.toString()
      }
    };
  }

  let payerAddress = null;
  const accountKeys = parsedTx.transaction?.message?.accountKeys || [];
  if (accountKeys.length) {
    const key0 = accountKeys[0];
    if (key0?.pubkey?.toBase58) {
      payerAddress = key0.pubkey.toBase58();
    } else if (typeof key0?.pubkey === 'string') {
      payerAddress = key0.pubkey;
    } else if (typeof key0 === 'string') {
      payerAddress = key0;
    }
  }

  if (expectedWallet && payerAddress) {
    if (normalizeAddress(expectedWallet) !== normalizeAddress(payerAddress)) {
      return {
        ok: false,
        code: 'payer_mismatch',
        message: 'Transaction sent from unexpected wallet.',
        details: {
          expected: expectedWallet,
          actual: payerAddress
        }
      };
    }
  }

  const explorerBaseUrl = networkConfig?.explorerBaseUrl || MCP_CONFIG.payments.explorerBaseUrl;
  // 生成交易链接：Mainnet 不需要 cluster 参数，Devnet 需要添加 ?cluster=devnet
  const baseUrl = explorerBaseUrl ? explorerBaseUrl.replace(/\/$/, '') : null;
  const explorerUrl = baseUrl
    ? (networkConfig?.network === 'solana-devnet'
        ? `${baseUrl}/${signature}?cluster=devnet`
        : `${baseUrl}/${signature}`)
    : buildExplorerUrl(signature);
  
  return {
    ok: true,
    payer: payerAddress,
    amountRaw: transferred.toString(),
    slot: parsedTx.slot,
    blockTime: parsedTx.blockTime || null,
    explorerUrl,
    memoMatched
  };
}

module.exports = {
  getConnection,
  toBaseUnits,
  verifySolanaUsdcTransfer
};
