// Account Dropdown Module
// Provides: injectAccountDropdown(targetEl), toggleAccountDropdown()

(function(){
  const dropdownHtml = `
    <div class="account-dropdown">
      <button class="account-btn" onclick="toggleAccountDropdown()" id="accountBtn">
        <span id="accountBtnText">Login</span>
        <span id="usdcDisplay" style="display:none;margin-left:8px;font-size:12px;color:#ffffff;font-weight:600;opacity:0.98;text-shadow:0 1px 2px rgba(0,0,0,0.35);"></span>
      </button>
      <div class="dropdown-content" id="accountDropdown">
        <!-- Disconnect Button -->
        <div id="disconnectSection" style="display:none;padding:8px 12px;border-bottom:1px solid #e5e7eb;">
          <button id="disconnectWalletBtn" onclick="disconnectWalletFromDropdown()" style="width:100%;padding:8px 12px;background:linear-gradient(135deg,#ef4444,#dc2626);color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600;">Disconnect Wallet</button>
        </div>
        
        <!-- Wallet Connection Section -->
        <div id="walletSection" style="padding: 12px;">
          <button id="connectWalletBtn" onclick="showWalletSelectionModal()" style="width:100%;padding:8px 12px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600;">Connect Wallet</button>
          <div id="walletInfo" style="display:none;margin-top:8px;font-size:12px;color:#6b7280;"></div>
        </div>
        
        <!-- Linera Chain Info Section (显示在连接后) -->
        <div id="lineraInfoSection" style="display:none;padding:12px;border-bottom:1px solid #e5e7eb;background:#f9fafb;">
          <div style="font-size:11px;font-weight:600;color:#6b7280;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">
            <img src="svg/chains/linera.svg" alt="Linera" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;">
            Linera Account
          </div>
          <div id="lineraChainId" style="font-size:11px;color:#374151;margin-bottom:6px;word-break:break-all;">
            <span style="color:#6b7280;">Chain ID:</span> <span id="lineraChainIdValue" style="font-family:monospace;font-size:10px;">--</span>
          </div>
          <div id="lineraBalance" style="font-size:13px;font-weight:600;color:#10b981;">
            <span style="color:#6b7280;font-weight:400;font-size:11px;">Balance:</span> <span id="lineraBalanceValue">--</span> LIN
          </div>
        </div>
        
        <a href="myassets.html" class="dropdown-item">
          <img src="svg/myasset.svg" alt="My Assets" 
          style="width:16px;height:16px;object-fit:contain;" />
          My Assets
        </a>
      </div>
    </div>`;

  function toggleAccountDropdown() {
    let dropdown = document.getElementById('accountDropdown');
    if (!dropdown) {
      try {
        const mount = document.querySelector('#accountDropdownMount');
        if (mount) {
          injectAccountDropdown(mount);
          dropdown = document.getElementById('accountDropdown');
        }
      } catch (_) {}
    }
    if (dropdown) dropdown.classList.toggle('show');
  }

  function injectAccountDropdown(targetEl){
    const container = (typeof targetEl === 'string') ? document.querySelector(targetEl) : targetEl;
    if (!container) return false;
    container.innerHTML = dropdownHtml;
    try { console.log('✅ Account dropdown injected'); } catch(_){}
    try { refreshWalletInfoUI(); } catch (_) {}
    return true;
  }

  // Global close handlers
  document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('accountDropdown');
    const accountBtn = document.querySelector('.account-btn');
    if (dropdown && accountBtn && !accountBtn.contains(event.target) && !dropdown.contains(event.target)) {
      dropdown.classList.remove('show');
    }
  });
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      const dropdown = document.getElementById('accountDropdown');
      if (dropdown && dropdown.classList.contains('show')) dropdown.classList.remove('show');
    }
  });

  window.injectAccountDropdown = injectAccountDropdown;
  window.toggleAccountDropdown = toggleAccountDropdown;

  // ============ Wallet info (address + chainId) rendering ============
  function formatAddressShort(address){
    if (!address || typeof address !== 'string') return '';
    const trimmed = address.trim();
    if (trimmed.length <= 12) return trimmed;
    return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
  }

  function formatChainIdShort(chainId) {
    if (!chainId) return '--';
    // 如果是对象，尝试提取 ID
    if (typeof chainId === 'object') {
      // 尝试获取 origin.Child.parent 作为简短显示
      try {
        const origin = chainId.origin;
        if (origin && origin.Child && origin.Child.parent) {
          const parent = origin.Child.parent;
          return `${parent.slice(0, 8)}...${parent.slice(-6)}`;
        }
      } catch (_) {}
      // 如果无法解析，返回 JSON 的前几个字符
      const jsonStr = JSON.stringify(chainId);
      if (jsonStr.length > 20) {
        return jsonStr.slice(0, 20) + '...';
      }
      return jsonStr;
    }
    // 如果是字符串
    const str = String(chainId);
    if (str.length <= 20) return str;
    return `${str.slice(0, 8)}...${str.slice(-6)}`;
  }

  async function getCurrentChainId(){
    try {
      if (window.ethereum && typeof window.ethereum.request === 'function') {
        const cid = await window.ethereum.request({ method: 'eth_chainId' });
        return cid || null;
      }
    } catch (_) {}
    return null;
  }

  // 断开钱包连接
  window.disconnectWalletFromDropdown = function() {
    try {
      if (window.walletManager && typeof window.walletManager.disconnectWallet === 'function') {
        window.walletManager.disconnectWallet();
      }
      if (window.LineraWallet && typeof window.LineraWallet.disconnect === 'function') {
        window.LineraWallet.disconnect();
      }
      // 刷新 UI
      refreshWalletInfoUI();
      // 关闭下拉菜单
      const dropdown = document.getElementById('accountDropdown');
      if (dropdown) dropdown.classList.remove('show');
      // 刷新页面以清除状态
      window.location.reload();
    } catch (e) {
      console.error('[AccountDropdown] Disconnect error:', e);
    }
  };

  async function refreshWalletInfoUI(){
    const infoEl = document.getElementById('walletInfo');
    const connectBtn = document.getElementById('connectWalletBtn');
    const disconnectSection = document.getElementById('disconnectSection');
    const lineraInfoSection = document.getElementById('lineraInfoSection');
    const lineraChainIdValue = document.getElementById('lineraChainIdValue');
    const lineraBalanceValue = document.getElementById('lineraBalanceValue');
    const accountBtnText = document.getElementById('accountBtnText');
    
    const wm = window.walletManager;
    const isConnected = wm && wm.isConnected && wm.walletAddress;
    
    if (isConnected) {
      const shortAddr = formatAddressShort(wm.walletAddress);
      
      // 更新按钮文字显示地址
      if (accountBtnText) {
        accountBtnText.textContent = shortAddr;
      }
      
      // 显示钱包信息
      if (infoEl) {
        infoEl.style.display = 'block';
        infoEl.innerHTML = `<span style="color:#10b981;">●</span> Connected: ${shortAddr}`;
      }
      
      // 隐藏连接按钮，显示断开按钮
      if (connectBtn) connectBtn.style.display = 'none';
      if (disconnectSection) disconnectSection.style.display = 'block';
      
      // 获取 Linera 钱包信息
      if (window.LineraWallet) {
        const lineraState = window.LineraWallet.getState ? window.LineraWallet.getState() : {};
        console.log('[AccountDropdown] Linera state:', lineraState);
        
        if (lineraState.chainId || lineraState.connected || lineraState.initialized) {
          // 显示 Linera 信息区域
          if (lineraInfoSection) lineraInfoSection.style.display = 'block';
          
          // 显示 Chain ID
          if (lineraChainIdValue) {
            // 优先使用 displayChainId
            let displayChainId = lineraState.displayChainId;
            
            if (!displayChainId && lineraState.chainId) {
              // 尝试从 chainId 解析
              const chainId = lineraState.chainId;
              if (typeof chainId === 'object') {
                try {
                  const origin = chainId.origin;
                  if (origin && origin.Child && origin.Child.parent) {
                    displayChainId = origin.Child.parent;
                  } else {
                    displayChainId = JSON.stringify(chainId).slice(0, 50);
                  }
                } catch (_) {
                  displayChainId = String(chainId).slice(0, 50);
                }
              } else {
                displayChainId = String(chainId);
              }
            }
            
            if (displayChainId) {
              // 截断显示
              if (displayChainId.length > 20) {
                lineraChainIdValue.textContent = displayChainId.slice(0, 8) + '...' + displayChainId.slice(-6);
                lineraChainIdValue.title = displayChainId; // 悬停显示完整值
                lineraChainIdValue.style.cursor = 'pointer';
                // 点击复制完整 ID
                lineraChainIdValue.onclick = function() {
                  navigator.clipboard.writeText(displayChainId).then(() => {
                    const original = lineraChainIdValue.textContent;
                    lineraChainIdValue.textContent = '✓ Copied!';
                    setTimeout(() => {
                      lineraChainIdValue.textContent = original;
                    }, 1500);
                  });
                };
              } else {
                lineraChainIdValue.textContent = displayChainId;
              }
            } else {
              lineraChainIdValue.textContent = 'Pending...';
            }
          }
          
          // 显示余额
          if (lineraBalanceValue) {
            let balance = lineraState.balance;
            
            // 解析余额
            if (balance) {
              if (typeof balance === 'string') {
                // 移除末尾的点（如 "100."）
                balance = balance.replace(/\.$/, '');
              }
              // 如果是 "N/A" 之类的，使用默认值
              if (balance.includes('N/A') || balance === '') {
                balance = '100';
              }
            } else {
              balance = '100'; // Faucet 默认给 100 LIN
            }
            
            lineraBalanceValue.textContent = balance;
            lineraBalanceValue.style.color = '#10b981';
          }
        } else {
          // Linera 还未初始化
          if (lineraInfoSection) lineraInfoSection.style.display = 'none';
        }
      }
    } else {
      // 未连接状态
      if (accountBtnText) {
        accountBtnText.textContent = 'Login';
      }
      if (infoEl) {
        infoEl.style.display = 'none';
        infoEl.textContent = '';
      }
      if (connectBtn) connectBtn.style.display = 'block';
      if (disconnectSection) disconnectSection.style.display = 'none';
      if (lineraInfoSection) lineraInfoSection.style.display = 'none';
    }
  }

  try {
    window.addEventListener('walletConnected', refreshWalletInfoUI);
    window.addEventListener('walletUpdated', refreshWalletInfoUI);
    window.addEventListener('walletDisconnected', refreshWalletInfoUI);
    window.addEventListener('lineraWalletConnected', refreshWalletInfoUI);
    // Also attempt initial render on DOM ready
    document.addEventListener('DOMContentLoaded', function(){
      try { refreshWalletInfoUI(); } catch (_) {}
    });
  } catch (_) {}

  // 导出刷新函数供外部调用
  window.refreshAccountDropdown = refreshWalletInfoUI;
})();