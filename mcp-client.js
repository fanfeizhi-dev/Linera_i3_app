(function () {
  const MCP_NAMESPACE = 'mcp';
  // 自动检测基础URL：开发环境使用localhost，生产环境使用当前域名
  const DEFAULT_BASE_URL = window.location.origin;
  const CONFIGURED_BASE_URL =
    (window.APP_CONFIG && (window.APP_CONFIG.mcpBaseUrl || window.APP_CONFIG?.mcp?.baseUrl)) ||
    DEFAULT_BASE_URL;
  const MCP_BASE_URL = CONFIGURED_BASE_URL.replace(/\/$/, '');
  let explorerToastStylesInjected = false;

  function injectExplorerToastStyles() {
    if (explorerToastStylesInjected) return;
    const style = document.createElement('style');
    style.textContent = `
      .mcp-explorer-toast {
        position: fixed;
        right: 24px;
        bottom: 24px;
        width: 360px;
        max-width: calc(100% - 32px);
        background: rgba(17, 24, 39, 0.92);
        color: #fff;
        border-radius: 16px;
        box-shadow: 0 20px 45px rgba(15, 23, 42, 0.45);
        padding: 18px 20px;
        font-family: 'Inter', sans-serif;
        font-size: 13px;
        line-height: 1.5;
        z-index: 100000;
        animation: mcp-toast-in 0.25s ease-out;
      }
      .mcp-explorer-toast h4 {
        margin: 0 0 8px;
        font-size: 15px;
        font-weight: 600;
      }
      .mcp-explorer-toast a {
        color: #38bdf8;
        font-weight: 600;
        text-decoration: none;
      }
      .mcp-explorer-toast a:hover {
        text-decoration: underline;
      }
      .mcp-explorer-toast button {
        position: absolute;
        top: 12px;
        right: 14px;
        cursor: pointer;
        border: none;
        background: transparent;
        color: rgba(255,255,255,0.7);
        font-size: 14px;
      }
      .mcp-explorer-toast button:hover {
        color: #fff;
      }
      @keyframes mcp-toast-in {
        from { transform: translateY(12px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    explorerToastStylesInjected = true;
  }

  function showExplorerToast({ url, title, subtitle }) {
    if (!url) return;
    injectExplorerToastStyles();
    const toast = document.createElement('div');
    toast.className = 'mcp-explorer-toast';
    toast.innerHTML = `
      <button aria-label="Dismiss explorer link">✕</button>
      <h4>${title || 'Payment Settled'}</h4>
      <div>${subtitle || 'View the on-chain transaction:'}</div>
      <div style="margin-top: 10px;">
        <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>
      </div>
    `;
    const close = toast.querySelector('button');
    const remove = () => {
      toast.remove();
    };
    close.addEventListener('click', remove);
    setTimeout(remove, 15000);
    document.body.appendChild(toast);
  }

  function detectMetaMaskProvider() {
    if (window.ethereum && window.ethereum.isMetaMask) {
      return window.ethereum;
    }
    if (window.walletManager?.ethereum) {
      return window.walletManager.ethereum;
    }
    return null;
  }

  function detectWalletAddress() {
    // 优先从 walletManager 获取地址
    if (window.walletManager && window.walletManager.walletAddress) {
      return window.walletManager.walletAddress;
    }
    // 退一步，从 MetaMask 读取 selectedAddress
    if (window.ethereum && window.ethereum.selectedAddress) {
      return window.ethereum.selectedAddress;
    }
    return null;
  }

  function normalizeModelIdentifier(name) {
    if (!name) return '';
    return String(name)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-:_]/g, '');
  }

  function modelIdentifiersMatch(a, b) {
    if (!a || !b) return false;
    const normA = normalizeModelIdentifier(a);
    const normB = normalizeModelIdentifier(b);
    if (!normA || !normB) return false;
    if (normA === normB) return true;
    const compactA = normA.replace(/[-_:]/g, '');
    const compactB = normB.replace(/[-_:]/g, '');
    return compactA && compactA === compactB;
  }

  function resolveModelMatch(storedName, candidates = []) {
    if (!storedName) return null;
    for (const candidate of candidates) {
      if (modelIdentifiersMatch(storedName, candidate)) {
        return candidate;
      }
    }
    return null;
  }

  async function ensureMetaMaskConnected() {
    const provider = detectMetaMaskProvider();
    if (!provider) {
      throw new Error('MetaMask not detected. Please install MetaMask extension.');
    }
    
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!accounts || !accounts[0]) {
        throw new Error('No accounts found in MetaMask');
      }
      return { provider, address: accounts[0] };
    } catch (err) {
      throw new Error(`MetaMask connection failed: ${err.message}`);
    }
  }

  function amountToBaseUnits(amount, decimals = 18) {
    const str = String(amount);
    const [whole = '0', frac = ''] = str.split('.');
    const wholePart = whole || '0';
    const fracPart = frac.padEnd(decimals, '0').slice(0, decimals);
    const combined = wholePart + fracPart;
    return BigInt(combined);
  }


  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function emit(event, detail) {
    try {
      window.dispatchEvent(new CustomEvent(`${MCP_NAMESPACE}:${event}`, { detail }));
    } catch (_) {
      // noop
    }
  }

  function ensurePanel() {
    if (typeof document === 'undefined' || !document.body) return null;
    let panel = document.getElementById('mcp-status-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'mcp-status-panel';
    panel.innerHTML = `
      <style>
        #mcp-status-panel { position: fixed; right: 24px; bottom: 24px; width: 320px; max-height: 50vh; overflow-y: auto; background: rgba(17, 24, 39, 0.92); color: #fff; border-radius: 16px; box-shadow: 0 20px 45px rgba(15, 23, 42, 0.45); padding: 18px 20px; font-family: 'Inter', sans-serif; font-size: 13px; line-height: 1.45; z-index: 99999; display: none; }
        #mcp-status-panel.show { display: block; }
        #mcp-status-panel h4 { margin: 0 0 10px; font-size: 15px; font-weight: 600; }
        #mcp-status-panel .mcp-close { position: absolute; top: 12px; right: 14px; cursor: pointer; border: none; background: transparent; color: rgba(255,255,255,0.6); font-size: 14px; }
        #mcp-status-panel .mcp-close:hover { color: #fff; }
        #mcp-status-panel .mcp-log { margin: 0; padding: 0; list-style: none; }
        #mcp-status-panel .mcp-log li { padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
        #mcp-status-panel .mcp-log li:last-child { border-bottom: none; }
        #mcp-status-panel .mcp-pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 3px 9px; font-size: 11px; font-weight: 600; letter-spacing: 0.2px; }
        #mcp-status-panel .pill-invoice { background: rgba(59, 130, 246, 0.18); color: #bfdbfe; }
        #mcp-status-panel .pill-pay { background: rgba(16, 185, 129, 0.18); color: #bbf7d0; }
        #mcp-status-panel .pill-result { background: rgba(244, 114, 182, 0.18); color: #fbcfe8; }
        #mcp-status-panel .pill-cancel { background: rgba(248, 113, 113, 0.18); color: #fecaca; }
        #mcp-status-panel .mcp-log small { display: block; margin-top: 3px; color: rgba(255,255,255,0.65); }
      </style>
      <button class="mcp-close" aria-label="Close">✕</button>
      <h4>Payment progress · Sign / Transfer</h4>
      <ul class="mcp-log"></ul>
    `;
    panel.querySelector('.mcp-close').addEventListener('click', () => {
      panel.classList.remove('show');
    });
    document.body.appendChild(panel);
    return panel;
  }

  function logStatus(kind, text, meta = {}) {
    const panel = ensurePanel();
    if (!panel) return;
    const list = panel.querySelector('.mcp-log');
    const li = document.createElement('li');
    const pillClass = {
      invoice: 'pill-invoice',
      payment: 'pill-pay',
      result: 'pill-result',
      cancel: 'pill-cancel'
    }[kind] || 'pill-invoice';
    const title = {
      invoice: '402 Payment',
      payment: 'Paid',
      result: 'Done',
      cancel: 'Cancelled'
    }[kind] || 'Update';
    const lines = [];
    
    // Auto Router 选中的模型信息
    if (meta.autoRouterModel) {
      lines.push(`🤖 Auto Router → <strong style="color: #a78bfa;">${meta.autoRouterModel}</strong>`);
    }
    
    if (meta.amount) lines.push(`Amount: ${meta.amount} LIN`);
    if (meta.memo) lines.push(`Memo: ${meta.memo}`);
    if (meta.tx) {
      // Linera-only: 只展示签名摘要（无链上 explorer）
      lines.push(`Signature: ${meta.tx.slice(0, 6)}…${meta.tx.slice(-4)} (Linera)`);
    }
    if (meta.node) lines.push(`Node: ${meta.node}`);
    if (meta.description) lines.push(meta.description);
    li.innerHTML = `
      <span class="mcp-pill ${pillClass}">${title}</span>
      <div>${text}</div>
      ${lines.length ? `<small>${lines.join(' • ')}</small>` : ''}
    `;
    list.appendChild(li);
    panel.classList.add('show');
    panel.scrollTop = panel.scrollHeight;
  }

  function confirmPaymentOrThrow({ invoice, amount, balance }) {
    const modelName = invoice.auto_router?.model?.id || invoice.model_or_node || 'AI Model';
    const details = [
      'Linera Transfer',
      `Amount: ${amount} LIN`,
      `Model: ${modelName}`,
      balance != null ? `Your balance: ${balance} LIN` : null,
      '',
      'This will execute a real on-chain transfer on Linera Testnet.'
    ]
      .filter(Boolean)
      .join('\n');
    const ok = window.confirm(details);
    if (!ok) {
      const err = new Error('Payment cancelled by user');
      err.code = 'user_cancelled';
      throw err;
    }
  }

  async function settleInvoiceWithLineraSDK(invoice, opts = {}) {
    console.log('[MCPClient] settleInvoiceWithLineraSDK (real transfer)', invoice);

    const amount = invoice.amount_usdc ?? invoice.amount;
    const recipient = (invoice.recipient || '').trim();
    if (!recipient) throw new Error('Invoice missing recipient address');

    if (!window.LineraWallet) {
      throw new Error('Linera wallet module not loaded (linera-wallet.js).');
    }

    // 如果还没连上 Linera chain，这里尝试连接（会自动走 faucet）
    const state = window.LineraWallet.getState?.() || {};
    if (!state.connected) {
      const res = await window.LineraWallet.connect();
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to connect Linera wallet');
      }
    }

    // 余额检查（仅用于 UX，后端仍会校验 amount/nonce）
    let balance = null;
    try {
      const st = window.LineraWallet.getState?.() || {};
      balance = st.balance ?? null;
      if (balance != null && Number(balance) < Number(amount)) {
        throw new Error(`Insufficient LIN balance: need ${amount}, have ${balance}`);
      }
    } catch (e) {
      // 忽略余额读取失败，不阻塞支付（测试网偶发）
      console.warn('[MCPClient] Balance check skipped:', e?.message || e);
    }

    // 已通过 onInvoice 展示自定义「Sign / Transfer」弹窗时，不再弹出原生 confirm，避免挡住自定义按钮
    if (!opts.skipNativeConfirm) {
      confirmPaymentOrThrow({ invoice, amount, balance });
    }

    if (typeof logStatus === 'function') {
      logStatus('invoice', 'Initiating Linera transfer...', {
        amount: amount,
        memo: invoice.nonce,
        autoRouterModel: invoice.auto_router?.model?.id || invoice.model_or_node
      });
    }

    const result = await window.LineraWallet.settleInvoice(invoice);
    if (!result?.success) {
      throw new Error(result?.error || 'Linera transfer failed');
    }

    if (typeof logStatus === 'function') {
      logStatus('payment', 'Linera transfer completed ✓', {
        amount: amount,
        memo: invoice.nonce,
        tx: String(result.senderChainId || 'confirmed')
      });
    }

    return {
      type: 'linera_transfer',
      success: true,
      amount: result.amount ?? amount,
      recipient: result.recipient ?? recipient,
      senderChainId: result.senderChainId,
      senderAddress: result.senderAddress,
      nonce: invoice.nonce,
      timestamp: result.timestamp || new Date().toISOString()
    };
  }

  async function settleInvoice(invoice, opts = {}) {
    try {
      console.log('[MCPClient] settleInvoice', invoice);

      // 使用 Linera Wallet 模块
      if (!window.LineraWallet) {
        throw new Error('Linera Wallet module not loaded. Please refresh the page.');
      }

      // 检查当前模式
      const walletState = window.LineraWallet.getState?.() || {};
      console.log('[MCPClient] Linera wallet state:', walletState);

      // 先尝试使用 SDK 真实转账
      try {
        console.log('[MCPClient] Attempting Linera SDK transfer...');
        const result = await settleInvoiceWithLineraSDK(invoice, opts);
        console.log('[MCPClient] Linera SDK transfer result:', result);
        return result;
      } catch (sdkError) {
        console.warn('[MCPClient] Linera SDK transfer failed:', sdkError.message);
        console.log('[MCPClient] Falling back to direct wallet.settleInvoice...');
        
        // 直接调用 LineraWallet.settleInvoice（支持 GraphQL 模式）
        const result = await window.LineraWallet.settleInvoice(invoice);
        console.log('[MCPClient] LineraWallet.settleInvoice result:', result);
        
        if (!result || !result.success) {
          throw new Error(result?.error || 'Linera wallet settlement failed');
        }
        
        return result;
      }
    } catch (error) {
      console.error('[MCPClient] settleInvoice error:', error);
      if (typeof logStatus === 'function') {
        logStatus('cancel', error && error.message ? error.message : 'Payment cancelled', {
          error: String(error && error.stack ? error.stack : error)
        });
      }
      throw error;
    }
  }


  async function request(path, body, opts = {}) {
    const fullEndpoint = path.startsWith('http')
      ? path
      : `${MCP_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
    console.log('[MCPClient] request start', fullEndpoint, body);
    const baseHeaders = { 'Content-Type': 'application/json' };
    let sessionHeaders = { ...(opts.headers || {}) };
    let paymentHeaders = {};
    const history = [];
    const payload = { ...(body || {}) };
    let walletAddress = detectWalletAddress();
    if (walletAddress) {
      baseHeaders['X-Wallet-Address'] = walletAddress;
      if (!payload.wallet_address) {
        payload.wallet_address = walletAddress;
      }
    }
    
    // 添加网络信息到请求头
    try {
      const networkRaw = localStorage.getItem('i3_preferred_network');
      if (networkRaw) {
        const network = JSON.parse(networkRaw);
        if (network && network.key) {
          baseHeaders['X-Linera-Network'] = network.key;
          if (!payload.network) {
            payload.network = network.key;
          }
        }
      }
    } catch (e) {
      console.warn('[MCPClient] Failed to read network from localStorage:', e);
    }

    while (true) {
      if (walletAddress && payload.wallet_address !== walletAddress) {
        payload.wallet_address = walletAddress;
      }
      const payloadJson = JSON.stringify(payload);
      const rawHeaders = { ...baseHeaders, ...sessionHeaders, ...paymentHeaders };
      
      // 确保所有 header 值都是有效字符串（防止 fetch Invalid value 错误）
      const headers = {};
      for (const [key, value] of Object.entries(rawHeaders)) {
        if (value !== undefined && value !== null) {
          headers[key] = String(value);
        }
      }
      
      console.log('[MCPClient] issuing fetch', fullEndpoint, { headers });
      const response = await fetch(fullEndpoint, {
        method: 'POST',
        headers,
        body: payloadJson
      });
      console.log('[MCPClient] response status', response.status, fullEndpoint);
      paymentHeaders = {};

      const session = response.headers.get('X-Workflow-Session');
      if (session) {
        sessionHeaders['X-Workflow-Session'] = session;
      }

      if (response.status === 402) {
        let invoice;
        try {
          const text = await response.text();
          invoice = text && text.trim() ? JSON.parse(text) : {};
        } catch (e) {
          console.warn('[MCPClient] 402 body parse failed', e);
          invoice = { status: 'payment_required' };
        }
        console.log('[MCPClient] received 402 invoice', invoice);
        console.log('[MCPClient] Invoice status:', invoice.status);
        console.log('[MCPClient] Is payment_required?', invoice.status === 'payment_required');
        console.log('[MCPClient] Full invoice:', JSON.stringify(invoice, null, 2));
        if (invoice.status && invoice.status !== 'payment_required') {
          // 如果验证失败但提供了 explorerLink，说明交易可能已成功但 RPC 延迟
          // 在这种情况下，不显示错误，而是继续重试请求（后端应该会允许继续）
          if (invoice.status === 'payment_verification_failed' && 
              invoice.code === 'tx_not_found' && 
              invoice.details?.explorerLink) {
            
            // *** 新增: 增加重试计数器 ***
            if (!history.retryCount) history.retryCount = 0;
            history.retryCount++;
            
            console.warn(`[MCPClient] Transaction not found on RPC (attempt ${history.retryCount}/20), but explorer link is available. Retrying...`);
            console.warn('[MCPClient] Explorer link:', invoice.details.explorerLink);
            
            // *** 修改: 增加等待时间,最多重试 20 次 ***
            if (history.retryCount <= 20) {
              const waitTime = Math.min(2000 * history.retryCount, 5000); // 从2秒逐渐增加到5秒
              console.log(`[MCPClient] Waiting ${waitTime}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            } else {
              console.error('[MCPClient] Max retries reached, but transaction exists on explorer');
              // 即使达到最大重试次数,如果有 explorerLink,也视为成功
              return {
                status: 'ok',
                result: {
                  tx: invoice.details.explorerLink.split('/').pop(),
                  message: 'Payment confirmed via explorer (RPC delayed)',
                  explorerLink: invoice.details.explorerLink
                },
                history
              };
            }
          }
          
          // 检查错误消息中是否包含 "Transaction not found" 且提供了 explorerLink
          // 如果是，也不显示错误，而是继续重试
          const errorMessage = invoice.message || invoice.status || '';
          if (errorMessage.includes('Transaction not found') && invoice.details?.explorerLink) {
            
            // *** 新增: 增加重试计数器 ***
            if (!history.retryCount) history.retryCount = 0;
            history.retryCount++;
            
            console.warn(`[MCPClient] Transaction not found on RPC (attempt ${history.retryCount}/20), but explorer link is available. Retrying...`);
            console.warn('[MCPClient] Explorer link:', invoice.details.explorerLink);
            
            // *** 修改: 增加等待时间,最多重试 20 次 ***
            if (history.retryCount <= 20) {
              const waitTime = Math.min(2000 * history.retryCount, 5000); // 从2秒逐渐增加到5秒
              console.log(`[MCPClient] Waiting ${waitTime}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            } else {
              console.error('[MCPClient] Max retries reached, but transaction exists on explorer');
              // 即使达到最大重试次数,如果有 explorerLink,也视为成功
              return {
                status: 'ok',
                result: {
                  message: 'Payment confirmed via explorer (RPC delayed)',
                  explorerLink: invoice.details.explorerLink
                },
                history
              };
            }
          }
          
          const reason = invoice.message || invoice.status || 'Payment required';
          logStatus('cancel', reason, {
            amount: invoice.amount_usdc,
            memo: invoice.memo
          });
          return {
            status: 'invoice_error',
            invoice,
            history: [...history, { type: 'invoice_error', invoice }]
          };
        }
        
        // 检查是否有 prepaid credits
        const prepaidCreditsRaw = localStorage.getItem('prepaidCredits');
        if (prepaidCreditsRaw) {
          try {
            const prepaidCredits = JSON.parse(prepaidCreditsRaw);
            const modelCandidates = [
              payload.model,
              payload.modelName,
              payload.modelId,
              invoice.model_or_node,
              invoice.model,
              invoice.modelId,
              invoice.auto_router?.model?.id,
              invoice.auto_router?.model?.name
            ].filter(Boolean);
            const matchedCandidate = resolveModelMatch(prepaidCredits.modelName, modelCandidates);
            const fallbackModel = payload.model || payload.modelId || invoice.model_or_node;
            const modelName = matchedCandidate || fallbackModel;
            
            console.log('[MCPClient] Checking prepaid credits:', {
              prepaidModel: prepaidCredits.modelName,
              requestModel: modelName,
              remaining: prepaidCredits.remainingCalls,
              invoiceModel: invoice.model_or_node
            });
            
            // 尝试多种方式匹配模型名称
            const requestedModel = modelName || invoice.model_or_node;
            const isModelMatch = modelIdentifiersMatch(prepaidCredits.modelName, requestedModel);
            
            if (isModelMatch && prepaidCredits.remainingCalls > 0) {
              console.log(`[MCPClient] ✅ Using prepaid credits: ${prepaidCredits.remainingCalls} calls remaining for ${requestedModel}`);
              
              // 减少一次 API call
              prepaidCredits.remainingCalls -= 1;
              prepaidCredits.lastUsedAt = new Date().toISOString();
              
              // 如果用完了，清除 prepaid credits
              if (prepaidCredits.remainingCalls <= 0) {
                console.log('[MCPClient] Prepaid credits exhausted, clearing...');
                localStorage.removeItem('prepaidCredits');
                
                // 显示通知
                setTimeout(() => {
                  const notification = document.createElement('div');
                  notification.style.cssText = `
                    position: fixed; top: 20px; right: 20px; z-index: 10000;
                    background: linear-gradient(135deg, #f59e0b, #d97706);
                    color: white; padding: 16px 24px; border-radius: 12px;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
                    font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600;
                  `;
                  notification.innerHTML = `
                    ⚠️ API calls exhausted!<br>
                    <span style="font-size: 12px; font-weight: 400;">Purchase more from Modelverse to continue.</span>
                  `;
                  document.body.appendChild(notification);
                  
                  setTimeout(() => notification.remove(), 5000);
                }, 500);
              } else {
                localStorage.setItem('prepaidCredits', JSON.stringify(prepaidCredits));
              }
              
              // 同步更新 myAssets
              const myAssetsRaw = localStorage.getItem('myAssets');
              if (myAssetsRaw) {
                const myAssets = JSON.parse(myAssetsRaw);
                const tokenAsset = myAssets.tokens.find(
                  (t) => modelIdentifiersMatch(t.modelName, prepaidCredits.modelName) ||
                    modelIdentifiersMatch(t.modelName, modelName)
                );
                if (tokenAsset && tokenAsset.quantity > 0) {
                  tokenAsset.quantity -= 1;
                  localStorage.setItem('myAssets', JSON.stringify(myAssets));
                  console.log(`[MCPClient] Deducted 1 API call. Remaining: ${tokenAsset.quantity}`);
                  
                  // 如果 myAssets 中也用完了，移除该 token
                  if (tokenAsset.quantity <= 0) {
                    myAssets.tokens = myAssets.tokens.filter(
                      (t) =>
                        !modelIdentifiersMatch(t.modelName, prepaidCredits.modelName) &&
                        !modelIdentifiersMatch(t.modelName, modelName)
                    );
                    localStorage.setItem('myAssets', JSON.stringify(myAssets));
                    console.log(`[MCPClient] Removed ${modelName} from myAssets (exhausted)`);
                  }
                }
              }
              
              // 使用 prepaid 标记跳过实际支付
              logStatus('invoice', `Using prepaid credits (${prepaidCredits.remainingCalls} remaining)`, {
                amount: invoice.amount_usdc,
                memo: 'PREPAID'
              });
              
              // 设置特殊的支付 header 表示使用 prepaid credits
              paymentHeaders = {
                'X-PAYMENT': `prepaid model=${normalizeModelIdentifier(requestedModel || prepaidCredits.modelName)}; remaining=${prepaidCredits.remainingCalls}; nonce=${invoice.nonce}`,
                'X-Prepaid-Credits': 'true',
                'X-Request-Id': invoice.request_id || invoice.memo
              };
              
              console.log('[MCPClient] Setting prepaid payment headers:', paymentHeaders);
              
              // 触发 UI 更新事件
              window.dispatchEvent(new CustomEvent('prepaidCreditsUsed', { 
                detail: { 
                  modelName: requestedModel, 
                  remaining: prepaidCredits.remainingCalls 
                } 
              }));
              
              continue;
            } else {
              console.log('[MCPClient] Prepaid credits not applicable:', {
                modelMatch: isModelMatch,
                hasCredits: prepaidCredits.remainingCalls > 0,
                prepaidModel: prepaidCredits.modelName,
                requestedModel: requestedModel
              });
            }
          } catch (err) {
            console.warn('[MCPClient] Error checking prepaid credits:', err);
          }
        }
        
        history.push({ type: 'invoice', invoice });
        
        // 获取 Auto Router 选中的模型信息
        const autoRouterModel = invoice.auto_router?.model?.id || invoice.model_or_node || payload.model;
        
        const isLinera = (invoice.network || '').toLowerCase() === 'linera';
        const invoiceMsg = isLinera
          ? 'Please sign with MetaMask (no gas, no chain switch). Pop-up will appear.'
          : (invoice.description || 'Payment required');
        logStatus('invoice', invoiceMsg, {
          amount: invoice.amount_usdc,
          memo: invoice.memo,
          autoRouterModel: autoRouterModel
        });
        emit('invoice', { endpoint: fullEndpoint, invoice });
        if (typeof opts.onInvoice === 'function') {
          try { await opts.onInvoice(invoice); } catch (_) {}
        }
        if (opts.autoPay === false) {
          return { status: 'invoice', invoice, history, headers: sessionHeaders };
        }
        let tx;
        try {
          tx = opts.paymentProvider
          ? await opts.paymentProvider(invoice)
            : await settleInvoice(invoice, { skipNativeConfirm: !!opts.onInvoice });
        } catch (paymentError) {
          history.push({ type: 'payment_error', invoice, error: paymentError });
          logStatus('cancel', `Payment failed: ${paymentError?.message || 'Payment error'}`, {
            amount: invoice.amount_usdc,
            memo: invoice.memo
          });
          emit('payment:error', { endpoint: fullEndpoint, invoice, error: paymentError });
          throw paymentError;
        }
        if (!tx) {
          return { status: 'cancelled', invoice, history };
        }
        history.push({ type: 'payment', invoice, tx });
        if (typeof opts.onPayment === 'function') {
          try { await opts.onPayment(invoice, tx); } catch (_) {}
        }
        emit('payment:settled', { endpoint: fullEndpoint, invoice, tx });
        walletAddress = detectWalletAddress() || walletAddress;
        if (walletAddress) {
          baseHeaders['X-Wallet-Address'] = walletAddress;
        }
        const memoPart = invoice.memo ? `; memo=${invoice.memo}` : '';

        // 生成 X-PAYMENT header（方案 C：统一 x402-linera-transfer，签名时带 signature 和 message）
        if (tx.type === 'linera_transfer') {
          const senderChainId = String(tx.senderChainId || 'unknown');
          const senderAddress = String(tx.senderAddress || '');
          const amount = String(tx.amount || '0');
          const nonce = String(tx.nonce || Date.now());
          const timestamp = String(tx.timestamp || new Date().toISOString());
          const transferType = tx.transferType || (tx.signature ? 'signed' : 'real');

          let paymentStr = `x402-linera-transfer sender_chain_id=${senderChainId}; sender_address=${senderAddress}; amount=${amount}; nonce=${nonce}; timestamp=${timestamp}`;
          if (tx.signature) {
            paymentStr += `; signature=${tx.signature}`;
            if (tx.message) {
              paymentStr += `; message=${encodeURIComponent(tx.message)}`;
            }
          }
          if (invoice.memo) {
            paymentStr += `; memo=${invoice.memo}`;
          }

          paymentHeaders = {
            'X-Request-Id': String(invoice.request_id || ''),
            'X-PAYMENT': paymentStr,
            'X-Linera-Mode': tx.mode || 'unknown',
            'X-Transfer-Type': transferType
          };
          console.log('[MCPClient] Payment type:', transferType, 'mode:', tx.mode);
        } else {
          throw new Error(`Unsupported payment type: ${tx.type || typeof tx}`);
        }
        continue;
      }

      // 非 2xx 时安全解析 body，避免 500 空 body 导致 "Unexpected end of JSON input"
      if (!response.ok) {
        const text = await response.text();
        let errBody = { status: response.status, message: response.statusText };
        try {
          if (text && text.trim()) errBody = { ...errBody, ...JSON.parse(text) };
        } catch (_) {
          if (text) errBody.raw = text;
        }
        console.warn('[MCPClient] request failed', fullEndpoint, errBody);
        emit('error', { endpoint: fullEndpoint, response: errBody, status: response.status });
        const msg = errBody.message || errBody.error || `Request failed: ${response.status}`;
        if ((response.status === 500 || response.status === 502) && fullEndpoint.includes('/mcp/')) {
          throw new Error(
            msg + ' — Start the backend first: run npm run dev:full in the project directory, or run node serve.js in another terminal'
          );
        }
        throw new Error(msg);
      }

      const result = await response.json();
      console.log('[MCPClient] final result', result);
      history.push({ type: 'result', result });
      if (typeof opts.onResult === 'function') {
        try { await opts.onResult(result); } catch (_) {}
      }
      emit('result', { endpoint: fullEndpoint, result });
      logStatus('result', 'Call completed', {});
      return { status: 'ok', result, history };
    }
  }

  async function invokeModel({ prompt, modelName, metadata } = {}, opts = {}) {
    const body = {
      prompt,
      model: modelName,
      metadata: metadata || {}
    };
    return request('/mcp/models.invoke', body, opts);
  }

  async function executeWorkflow(payload, hooks = {}) {
    return request('/mcp/workflow/execute', payload, {
      onInvoice: hooks.onInvoice,
      onPayment: hooks.onPayment,
      onResult: hooks.onResult
    });
  }

  async function purchaseShare(payload, hooks = {}) {
    return request('/mcp/share/buy', payload, {
      onInvoice: hooks.onInvoice,
      onPayment: hooks.onPayment,
      onResult: hooks.onResult
    });
  }

  async function claimCheckin(payload, hooks = {}) {
    const res = await fetch(`${MCP_BASE_URL}/mcp/checkin/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      logStatus('result', 'Check-in successful', {
        amount: data.amount_usdc,
        tx: data.tx_signature
      });
      if (typeof hooks.onResult === 'function') {
        try { await hooks.onResult(data); } catch (_) {}
      }
      emit('result', { endpoint: 'checkin', result: data });
      return { status: 'ok', result: data };
    }
    emit('error', { endpoint: 'checkin', error: data });
    return { status: 'error', error: data };
  }

  window.MCPClient = {
    baseUrl: MCP_BASE_URL,
    request,
    invokeModel,
    executeWorkflow,
    settleInvoice,
    purchaseShare,
    claimCheckin,
    logStatus,
    // Debug helpers
    debugPrepaidCredits() {
      const prepaidCreditsRaw = localStorage.getItem('prepaidCredits');
      const myAssetsRaw = localStorage.getItem('myAssets');
      const currentModelRaw = localStorage.getItem('currentModel');
      
      console.log('=== Prepaid Credits Debug ===');
      console.log('1. Prepaid Credits:', prepaidCreditsRaw ? JSON.parse(prepaidCreditsRaw) : 'None');
      console.log('2. My Assets Tokens:', myAssetsRaw ? JSON.parse(myAssetsRaw).tokens : 'None');
      console.log('3. Current Model:', currentModelRaw ? JSON.parse(currentModelRaw) : 'None');
      
      return {
        prepaidCredits: prepaidCreditsRaw ? JSON.parse(prepaidCreditsRaw) : null,
        myAssets: myAssetsRaw ? JSON.parse(myAssetsRaw) : null,
        currentModel: currentModelRaw ? JSON.parse(currentModelRaw) : null
      };
    },
    clearPrepaidCredits() {
      localStorage.removeItem('prepaidCredits');
      console.log('✅ Prepaid credits cleared. Please refresh and use the "Use" button again.');
    }
  };
})();
