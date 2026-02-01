/**
 * Linera 原生钱包集成模块
 * 
 * 支持两种模式：
 * 1. WASM SDK 模式 - 使用 @linera/client SDK（需要 WASM 正确加载）
 * 2. GraphQL 模式 - 直接调用 Faucet GraphQL API（不依赖 WASM，更可靠）
 * 
 * 功能：
 * - 连接 Linera Testnet Conway
 * - 使用 MetaMask 签名（EIP-191）
 * - 执行链上代币转账
 * - 查询余额
 */

// Linera Testnet Conway 配置
const LINERA_CONFIG = {
  faucetUrl: 'https://faucet.testnet-conway.linera.net',
  networkName: 'Testnet Conway',
  explorerUrl: 'https://explorer.testnet-conway.linera.net'
};

// 全局状态
let lineraState = {
  initialized: false,
  linera: null,        // @linera/client 模块（可能为 null，GraphQL 模式不需要）
  signer: null,        // MetaMask signer
  faucet: null,        // Faucet 实例（WASM 模式）或 null（GraphQL 模式）
  wallet: null,        // Wallet 实例
  client: null,        // Client 实例
  chain: null,         // 当前 Chain 实例
  chainId: null,       // 当前链 ID
  ownerAddress: null,  // 用户地址（EVM 地址）
  balance: '0',
  mode: 'graphql'      // 'wasm' 或 'graphql'，默认 graphql（更可靠）
};

// 是否优先使用 GraphQL 模式（绕过 WASM）
// 设为 true 时 chat 通过 402 → MetaMask 签名 → 重试，不依赖 WASM
const PREFER_GRAPHQL_MODE = true;

/** 持久化余额到 localStorage（支付后模拟扣减需跨刷新保留） */
function _persistBalance(owner, balance) {
  try {
    if (owner && balance != null) {
      localStorage.setItem(`linera_balance_${owner.toLowerCase()}`, String(balance));
    }
  } catch (_) {}
}

/** 支付成功后减少本地余额（签名模式无真实转账，需模拟扣减） */
function decreaseLineraBalance(amount) {
  const owner = lineraState.ownerAddress;
  if (!owner) return;
  const amt = parseFloat(String(amount || 0));
  if (isNaN(amt) || amt <= 0) return;
  let current = parseFloat(String(lineraState.balance || 0));
  if (isNaN(current)) current = 100;
  const next = Math.max(0, current - amt);
  lineraState.balance = String(next);
  _persistBalance(owner, lineraState.balance);
  window.dispatchEvent(new CustomEvent('lineraBalanceUpdated', { detail: { balance: lineraState.balance } }));
  console.log('[LineraWallet] Balance decreased:', current, '-', amt, '=', next, 'LIN');
}

// Linera Web SDK 加载方式
const USE_LOCAL_PACKAGES = true;

// CDN 备用地址
const CDN_LINERA_SDK_URL = 'https://esm.sh/@linera/client@0.15.11';
const CDN_LINERA_METAMASK_URL = 'https://esm.sh/@linera/metamask@0.15.11';

// ============================================================================
// GraphQL 模式实现（不依赖 WASM）
// ============================================================================

/**
 * 通过 GraphQL API 调用 Faucet
 * @param {string} query - GraphQL 查询字符串
 * @returns {Promise<Object>} 返回 data 字段
 */
async function faucetGraphQL(query) {
  console.log('[LineraWallet] GraphQL query:', query);
  
  const response = await fetch(LINERA_CONFIG.faucetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query })
  });
  
  if (!response.ok) {
    throw new Error(`Faucet HTTP error: ${response.status} ${response.statusText}`);
  }
  
  const result = await response.json();
  console.log('[LineraWallet] GraphQL result:', result);
  
  if (result.errors && result.errors.length > 0) {
    const messages = result.errors.map(e => e.message || JSON.stringify(e)).join('; ');
    throw new Error(`Faucet GraphQL error: ${messages}`);
  }
  
  return result.data;
}

/**
 * 通过 GraphQL 获取创世配置
 */
async function getGenesisConfigGraphQL() {
  const data = await faucetGraphQL('query { genesisConfig }');
  return data.genesisConfig;
}

/**
 * 通过 GraphQL 获取当前验证者
 */
async function getCurrentValidatorsGraphQL() {
  const data = await faucetGraphQL('query { currentValidators { publicKey networkAddress } }');
  return data.currentValidators;
}

/**
 * 通过 GraphQL 领取新链
 * @param {string} owner - AccountOwner 字符串（EVM 地址格式：0x...）
 * @returns {Promise<Object>} ChainDescription
 */
async function claimChainGraphQL(owner) {
  // 确保 owner 是正确的格式（0x 前缀 + 40个十六进制字符 for EVM 地址）
  if (!owner.startsWith('0x')) {
    owner = '0x' + owner;
  }
  
  console.log('[LineraWallet] Claiming chain for owner:', owner);
  
  const data = await faucetGraphQL(`mutation { claim(owner: "${owner}") }`);
  return data.claim;
}

/**
 * 通过 GraphQL 查询已存在的链 ID
 * @param {string} owner - AccountOwner 字符串
 * @returns {Promise<string|null>} Chain ID 或 null
 */
async function getChainIdGraphQL(owner) {
  if (!owner.startsWith('0x')) {
    owner = '0x' + owner;
  }
  
  try {
    const data = await faucetGraphQL(`query { chainId(owner: "${owner}") }`);
    return data.chainId;
  } catch (e) {
    // 可能没有该查询，返回 null
    console.warn('[LineraWallet] chainId query failed:', e.message);
    return null;
  }
}

/**
 * 检查浏览器环境是否支持 WASM 模式
 * @returns {Object} 环境检查结果
 */
function checkWasmEnvironment() {
  const result = {
    sharedArrayBufferAvailable: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
    wasmSupported: typeof WebAssembly !== 'undefined',
    canUseWasm: false,
    reason: ''
  };
  
  if (!result.wasmSupported) {
    result.reason = 'WebAssembly not supported';
  } else if (!result.sharedArrayBufferAvailable) {
    result.reason = 'SharedArrayBuffer not available (missing COEP/COOP headers)';
  } else if (!result.crossOriginIsolated) {
    result.reason = 'crossOriginIsolated is false (COEP/COOP headers not properly configured)';
  } else {
    result.canUseWasm = true;
    result.reason = 'All requirements met';
  }
  
  console.log('[LineraWallet] Environment check:', result);
  return result;
}

/**
 * 初始化 Linera SDK
 * 
 * 支持两种模式：
 * 1. GraphQL 模式（PREFER_GRAPHQL_MODE = true）- 不需要 WASM，直接调用 Faucet API
 * 2. WASM 模式 - 使用 @linera/client SDK
 */
async function initializeLineraSDK() {
  if (lineraState.initialized) {
    console.log('[LineraWallet] SDK already initialized, mode:', lineraState.mode);
    return true;
  }

  // 首先检查环境
  const envCheck = checkWasmEnvironment();
  console.log('[LineraWallet] WASM environment check:', {
    canUseWasm: envCheck.canUseWasm,
    reason: envCheck.reason
  });

  // 如果优先使用 GraphQL 模式，直接标记为初始化完成
  // GraphQL 支付仅需 MetaMask 签名，不依赖 Faucet；Faucet 仅用于「连接钱包」时领取/查询链，校验失败也不影响 chat 支付
  if (PREFER_GRAPHQL_MODE) {
    console.log('[LineraWallet] Using GraphQL mode (no WASM required)');
    lineraState.mode = 'graphql';
    lineraState.initialized = true;
    
    // 可选：验证 Faucet GraphQL API（仅用于「连接 Linera」时的 claim/chainId，失败不阻塞支付）
    try {
      console.log('[LineraWallet] Testing Faucet GraphQL API...');
      const validators = await getCurrentValidatorsGraphQL();
      console.log('[LineraWallet] Faucet API is available, validators count:', validators?.length || 0);
    } catch (testErr) {
      console.warn('[LineraWallet] Faucet API test failed (chat payment still works):', testErr.message);
      // 不再回退：保持 initialized=true, mode=graphql，保证 chat 支付（签名模式）可用
    }
    
    console.log('[LineraWallet] GraphQL mode initialized successfully');
    return true;
  }

  // WASM 模式
  try {
    // 再次检查环境，如果不支持则提前报错
    if (!envCheck.canUseWasm) {
      console.warn('[LineraWallet] WASM environment not ready:', envCheck.reason);
      console.warn('[LineraWallet] Will attempt anyway, but may fail...');
    }
    
    console.log('[LineraWallet] Initializing Linera SDK (WASM mode)...');
    lineraState.mode = 'wasm';
    
    let linera;
    
    if (USE_LOCAL_PACKAGES) {
      console.log('[LineraWallet] Loading @linera/client from local packages...');
      try {
        linera = await import('@linera/client');
        console.log('[LineraWallet] @linera/client loaded from local packages');
      } catch (localErr) {
        console.warn('[LineraWallet] Failed to load local package, falling back to CDN:', localErr.message);
        linera = await import(/* @vite-ignore */ CDN_LINERA_SDK_URL);
        console.log('[LineraWallet] @linera/client loaded from CDN');
      }
    } else {
      console.log('[LineraWallet] Loading @linera/client from CDN:', CDN_LINERA_SDK_URL);
      linera = await import(/* @vite-ignore */ CDN_LINERA_SDK_URL);
    }
    
    console.log('[LineraWallet] @linera/client exports:', Object.keys(linera));
    
    // 预加载 MetaMask signer
    console.log('[LineraWallet] Loading @linera/metamask...');
    try {
      if (USE_LOCAL_PACKAGES) {
        await import('@linera/metamask');
      } else {
        await import(/* @vite-ignore */ CDN_LINERA_METAMASK_URL);
      }
    } catch (metamaskErr) {
      console.warn('[LineraWallet] Failed to load local @linera/metamask, trying CDN:', metamaskErr.message);
      await import(/* @vite-ignore */ CDN_LINERA_METAMASK_URL);
    }

    // 初始化 WASM
    // @linera/client 导出 initialize 函数用于初始化 WASM
    console.log('[LineraWallet] Initializing WASM...');
    console.log('[LineraWallet] linera.initialize type:', typeof linera.initialize);
    console.log('[LineraWallet] linera.default type:', typeof linera.default);
    
    let wasmModule = null;
    
    // 优先使用 initialize 函数（官方推荐方式）
    if (typeof linera.initialize === 'function') {
      console.log('[LineraWallet] Using linera.initialize()...');
      wasmModule = await linera.initialize();
      console.log('[LineraWallet] WASM initialized via initialize()');
    } else if (typeof linera.default === 'function') {
      console.log('[LineraWallet] Using linera.default() as fallback...');
      wasmModule = await linera.default();
    }
    
    if (wasmModule) {
      console.log('[LineraWallet] WASM init result type:', typeof wasmModule);
      console.log('[LineraWallet] WASM init result keys:', Object.keys(wasmModule || {}).slice(0, 10));
    }
    
    console.log('[LineraWallet] WASM initialized');
    
    // 检查初始化结果是否包含 Faucet 类
    let effectiveModule = linera;
    
    if (wasmModule && typeof wasmModule.Faucet === 'function') {
      console.log('[LineraWallet] Using WASM init result as module');
      effectiveModule = wasmModule;
    } else if (typeof linera.Faucet === 'function') {
      console.log('[LineraWallet] Using imported module directly');
      effectiveModule = linera;
    } else {
      console.log('[LineraWallet] Searching for Faucet class...');
      
      if (linera.default && typeof linera.default.Faucet === 'function') {
        console.log('[LineraWallet] Found Faucet in linera.default');
        effectiveModule = linera.default;
      }
      else if (wasmModule && wasmModule.exports && typeof wasmModule.exports.Faucet === 'function') {
        console.log('[LineraWallet] Found Faucet in wasmModule.exports');
        effectiveModule = wasmModule.exports;
      }
    }
    
    lineraState.linera = effectiveModule;
    lineraState.initialized = true;
    lineraState.mode = 'wasm';
    
    console.log('[LineraWallet] Checking available classes:', {
      Faucet: typeof effectiveModule.Faucet,
      Client: typeof effectiveModule.Client,
      Wallet: typeof effectiveModule.Wallet
    });
    
    if (typeof effectiveModule.Faucet !== 'function') {
      console.error('[LineraWallet] WARNING: Faucet class not found!');
      console.error('[LineraWallet] Available exports:', Object.keys(effectiveModule));
      
      // WASM 模式 Faucet 不可用，尝试回退到 GraphQL 模式
      console.log('[LineraWallet] Falling back to GraphQL mode...');
      lineraState.mode = 'graphql';
    }
    
    console.log('[LineraWallet] SDK initialized successfully, mode:', lineraState.mode);
    return true;
  } catch (error) {
    console.error('[LineraWallet] Failed to initialize WASM SDK:', error);
    console.error('[LineraWallet] Error stack:', error.stack);
    
    // WASM 失败，尝试 GraphQL 模式
    console.log('[LineraWallet] Falling back to GraphQL mode...');
    lineraState.mode = 'graphql';
    lineraState.initialized = true;
    
    try {
      const validators = await getCurrentValidatorsGraphQL();
      console.log('[LineraWallet] GraphQL fallback successful, validators:', validators?.length || 0);
      return true;
    } catch (graphqlErr) {
      console.error('[LineraWallet] GraphQL fallback also failed:', graphqlErr);
      lineraState.initialized = false;
      lineraState.mode = null;
      return false;
    }
  }
}

/**
 * 连接 Linera 钱包（GraphQL 模式）
 * 使用 MetaMask 地址作为 owner，直接调用 Faucet GraphQL API
 */
async function connectLineraWalletGraphQL() {
  console.log('[LineraWallet] Connecting wallet (GraphQL mode)...');
  
  // 检查 MetaMask
  if (!window.ethereum) {
    throw new Error('MetaMask not detected. Please install MetaMask.');
  }
  
  // 请求 MetaMask 账户
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!accounts || accounts.length === 0) {
    throw new Error('No MetaMask accounts available');
  }
  
  const ownerAddress = accounts[0].toLowerCase();
  console.log('[LineraWallet] MetaMask address:', ownerAddress);
  lineraState.ownerAddress = ownerAddress;
  
  // 先检查是否已有链
  console.log('[LineraWallet] Checking existing chain...');
  let chainId = await getChainIdGraphQL(ownerAddress);
  let chainDescription = null;
  let balance = '100'; // Faucet 默认给 100 LIN
  
  if (!chainId) {
    // 领取新链
    console.log('[LineraWallet] Claiming new chain from faucet...');
    chainDescription = await claimChainGraphQL(ownerAddress);
    console.log('[LineraWallet] Chain claimed:', chainDescription);
    
    // 解析 chainDescription 获取信息
    if (chainDescription) {
      // 尝试从 chainDescription 提取余额
      if (chainDescription.config && chainDescription.config.balance) {
        // 余额格式可能是 "100." 或 "100"
        balance = String(chainDescription.config.balance).replace(/\.$/, '');
      }
      
      // 计算 Chain ID（Linera 的 Chain ID 是 ChainDescription 的哈希）
      // 但在 GraphQL 模式下，我们直接存储整个 description
      if (typeof chainDescription === 'string') {
        chainId = chainDescription;
      } else {
        // 存储整个对象，用于后续操作
        chainId = chainDescription;
      }
    }
  } else {
    console.log('[LineraWallet] Using existing chain:', chainId);
    // 已有链：优先使用 localStorage 中持久化的余额（支付后模拟扣减）
    try {
      const stored = localStorage.getItem(`linera_balance_${ownerAddress}`);
      if (stored != null && stored !== '') {
        const parsed = parseFloat(stored);
        if (!isNaN(parsed) && parsed >= 0) {
          balance = String(parsed);
        }
      }
    } catch (_) {}
  }
  
  // 存储原始 chainDescription 和解析后的信息
  lineraState.chainId = chainId;
  lineraState.chainDescription = chainDescription;
  lineraState.balance = balance;
  _persistBalance(ownerAddress, balance);
  
  // 尝试提取更友好的 Chain ID 显示
  let displayChainId = 'Unknown';
  if (chainId) {
    if (typeof chainId === 'object') {
      // 尝试从 origin.Child.parent 提取
      if (chainId.origin && chainId.origin.Child && chainId.origin.Child.parent) {
        displayChainId = chainId.origin.Child.parent;
      }
    } else {
      displayChainId = String(chainId);
    }
  }
  lineraState.displayChainId = displayChainId;
  
  console.log('[LineraWallet] Chain info:', {
    displayChainId,
    balance,
    owner: ownerAddress
  });
  
  // 触发连接成功事件
  window.dispatchEvent(new CustomEvent('lineraWalletConnected', {
    detail: {
      address: ownerAddress,
      chainId: chainId,
      balance: lineraState.balance,
      mode: 'graphql'
    }
  }));
  
  return {
    success: true,
    address: ownerAddress,
    chainId: chainId,
    balance: lineraState.balance,
    mode: 'graphql'
  };
}

/**
 * 连接 Linera 钱包（WASM 模式）
 * 使用 @linera/client SDK
 * 
 * 按照官方示例 (linera-protocol/examples/counter/metamask) 的方式实现
 */
async function connectLineraWalletWASM() {
  console.log('[LineraWallet] Connecting wallet (WASM mode)...');
  
  // 验证 linera 模块已加载
  if (!lineraState.linera) {
    throw new Error('Linera SDK not loaded. Please refresh the page.');
  }
  
  const linera = lineraState.linera;
  const { Faucet, Client } = linera;
  
  // 验证关键类可用
  if (typeof Faucet !== 'function') {
    console.error('[LineraWallet] Faucet class not available:', typeof Faucet);
    throw new Error('Faucet class not available. WASM may not be initialized.');
  }
  
  // 加载 MetaMask signer（优先用 CDN，避免 Vite 打包导致导出结构异常）
  console.log('[LineraWallet] Loading MetaMask signer...');
  let metamaskModule;
  const loadMetamask = async (url) => {
    const m = await import(/* @vite-ignore */ url);
    return m;
  };
  try {
    metamaskModule = await loadMetamask(CDN_LINERA_METAMASK_URL);
  } catch (cdnErr) {
    console.warn('[LineraWallet] CDN metamask failed, trying local:', cdnErr.message);
    metamaskModule = await import('@linera/metamask');
  }
  
  console.log('[LineraWallet] @linera/metamask exports:', Object.keys(metamaskModule));
  
  // 兼容多种导出方式：Signer / default / MetaMaskSigner，以及嵌套 default
  let MetaMaskSigner = metamaskModule.Signer ?? metamaskModule.MetaMaskSigner ?? metamaskModule.default;
  if (MetaMaskSigner && typeof MetaMaskSigner === 'object' && typeof MetaMaskSigner.default === 'function') {
    MetaMaskSigner = MetaMaskSigner.default;
  }
  
  if (!MetaMaskSigner || typeof MetaMaskSigner !== 'function') {
    throw new Error('Signer not found. Exports: ' + JSON.stringify(Object.keys(metamaskModule)) + ' SignerType: ' + typeof MetaMaskSigner);
  }
  
  // 检查 MetaMask
  if (!window.ethereum) {
    throw new Error('MetaMask not detected. Please install MetaMask.');
  }
  
  // 请求 MetaMask 账户
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!accounts || accounts.length === 0) {
    throw new Error('No MetaMask accounts available');
  }
  
  const ownerAddress = accounts[0].toLowerCase();
  console.log('[LineraWallet] MetaMask address:', ownerAddress);
  lineraState.ownerAddress = ownerAddress;
  
  // 检查 SharedArrayBuffer 是否可用
  console.log('[LineraWallet] crossOriginIsolated:', typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : 'undefined');
  if (typeof SharedArrayBuffer === 'undefined') {
    throw new Error('SharedArrayBuffer not available. COEP/COOP headers may be missing.');
  }
  
  // 测试 SharedArrayBuffer 是否真的可用
  try {
    const testBuffer = new SharedArrayBuffer(1024);
    console.log('[LineraWallet] SharedArrayBuffer test passed, size:', testBuffer.byteLength);
  } catch (sabError) {
    console.error('[LineraWallet] SharedArrayBuffer test failed:', sabError);
    throw new Error('SharedArrayBuffer test failed: ' + sabError.message);
  }
  
  // ========================================
  // 按照官方示例的顺序执行
  // ========================================
  
  // 1. 创建 MetaMask Signer
  console.log('[LineraWallet] Creating MetaMask Signer...');
  const metamaskSigner = new MetaMaskSigner();
  lineraState.signer = metamaskSigner;
  console.log('[LineraWallet] MetaMask Signer created');
  
  // 获取 signer 地址（用于 claimChain）
  let signerOwner;
  if (typeof metamaskSigner.address === 'function') {
    signerOwner = await metamaskSigner.address();
    console.log('[LineraWallet] Signer address:', signerOwner);
  } else {
    signerOwner = ownerAddress;
    console.log('[LineraWallet] Using MetaMask address as owner:', signerOwner);
  }
  
  // 2. 连接 Faucet
  console.log('[LineraWallet] Creating Faucet instance...');
  const faucet = new Faucet(LINERA_CONFIG.faucetUrl);
  lineraState.faucet = faucet;
  console.log('[LineraWallet] Faucet created');
  
  // 3. 创建钱包
  console.log('[LineraWallet] Creating wallet...');
  const wallet = await faucet.createWallet();
  lineraState.wallet = wallet;
  console.log('[LineraWallet] Wallet created');
  
  // 4. 先领取链（官方示例：在创建 Client 之前）
  console.log('[LineraWallet] Claiming chain from faucet...');
  const chainId = await faucet.claimChain(wallet, signerOwner);
  lineraState.chainId = chainId;
  console.log('[LineraWallet] Chain claimed:', chainId);
  
  // 5. 简化：直接使用 MetaMask signer（跳过 Composite 以排除问题）
  // 注意：官方示例使用 Composite，但我们先测试直接使用 MetaMask
  console.log('[LineraWallet] Using MetaMask signer directly (simplified mode)');
  const signerToUse = metamaskSigner;
  
  // 6. 创建客户端（带超时）
  // 增加到 90 秒，Linera 验证者网络可能响应较慢
  const CLIENT_TIMEOUT_MS = 90000;
  console.log('[LineraWallet] Creating Client with', CLIENT_TIMEOUT_MS / 1000, 'second timeout...');
  console.log('[LineraWallet] Connecting to Linera validators (this may take 30-60 seconds)...');
  
  const startTime = Date.now();
  const clientPromise = new Client(wallet, signerToUse);
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      reject(new Error(`Client creation timed out after ${elapsed.toFixed(1)}s. The Linera network may be slow or unreachable.`));
    }, CLIENT_TIMEOUT_MS)
  );
  
  // 添加进度提示
  const progressInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed < 30) {
      console.log(`[LineraWallet] Connecting to validators... (${elapsed.toFixed(0)}s elapsed)`);
    } else {
      console.log(`[LineraWallet] Still connecting... (${elapsed.toFixed(0)}s elapsed) - network may be slow`);
    }
  }, 5000);
  
  let client;
  try {
    client = await Promise.race([clientPromise, timeoutPromise]);
    clearInterval(progressInterval);
    lineraState.client = client;
    const elapsed = (Date.now() - startTime) / 1000;
    console.log('[LineraWallet] ✅ Client created successfully in', elapsed.toFixed(1), 'seconds');
  } catch (clientError) {
    clearInterval(progressInterval);
    throw clientError;
  }
  
  // 7. 连接到链
  console.log('[LineraWallet] Connecting to chain...');
  const chain = await client.chain(chainId);
  lineraState.chain = chain;
  console.log('[LineraWallet] ✅ Connected to chain');
  
  // 8. 获取余额
  const balance = await chain.balance();
  lineraState.balance = balance;
  console.log('[LineraWallet] Balance:', balance);
  
  // 触发连接成功事件
  window.dispatchEvent(new CustomEvent('lineraWalletConnected', {
    detail: {
      address: ownerAddress,
      chainId: chainId,
      balance: balance,
      mode: 'wasm'
    }
  }));
  
  return {
    success: true,
    address: ownerAddress,
    chainId: chainId,
    balance: balance,
    mode: 'wasm'
  };
}

/**
 * 连接 Linera 钱包
 * 自动选择 GraphQL 或 WASM 模式
 */
async function connectLineraWallet() {
  try {
    console.log('[LineraWallet] Connecting wallet...');
    
    // 确保 SDK 已初始化
    if (!lineraState.initialized) {
      const success = await initializeLineraSDK();
      if (!success) {
        throw new Error('Failed to initialize Linera SDK');
      }
    }
    
    // 根据模式选择连接方式
    if (lineraState.mode === 'graphql') {
      return await connectLineraWalletGraphQL();
    } else {
      // WASM 模式，如果失败则回退到 GraphQL
      try {
        return await connectLineraWalletWASM();
      } catch (wasmError) {
        console.error('[LineraWallet] WASM connection failed:', wasmError);
        console.log('[LineraWallet] Falling back to GraphQL mode...');
        lineraState.mode = 'graphql';
        return await connectLineraWalletGraphQL();
      }
    }
  } catch (error) {
    console.error('[LineraWallet] Connection failed:', error);
    return {
      success: false,
      error: error.message || String(error)
    };
  }
}

/**
 * 执行 Linera 代币转账
 * 
 * @param {Object} params - 转账参数
 * @param {string} params.recipient - 接收者地址（EVM 地址）
 * @param {string} params.recipientChainId - 接收者链 ID
 * @param {number} params.amount - 转账金额
 * @returns {Promise<Object>} 转账结果
 */
async function transferLinera({ recipient, recipientChainId, amount }) {
  try {
    console.log('[LineraWallet] Transfer request:', { recipient, recipientChainId, amount });
    
    if (!lineraState.chain) {
      throw new Error('Wallet not connected. Please connect first.');
    }
    
    // 执行转账
    await lineraState.chain.transfer({
      amount: Number(amount),
      recipient: {
        chain_id: recipientChainId || lineraState.chainId,
        owner: recipient.toLowerCase()
      }
    });
    
    console.log('[LineraWallet] Transfer successful');
    
    // 更新余额
    const newBalance = await lineraState.chain.balance();
    lineraState.balance = newBalance;
    
    // 触发转账成功事件
    window.dispatchEvent(new CustomEvent('lineraTransferComplete', {
      detail: {
        recipient,
        amount,
        newBalance
      }
    }));
    
    return {
      success: true,
      amount,
      recipient,
      newBalance
    };
  } catch (error) {
    console.error('[LineraWallet] Transfer failed:', error);
    return {
      success: false,
      error: error.message || String(error)
    };
  }
}

/**
 * 获取当前余额
 */
async function getLineraBalance() {
  try {
    if (!lineraState.chain) {
      return { success: false, error: 'Wallet not connected' };
    }
    
    const balance = await lineraState.chain.balance();
    lineraState.balance = balance;
    
    return {
      success: true,
      balance
    };
  } catch (error) {
    console.error('[LineraWallet] Failed to get balance:', error);
    return {
      success: false,
      error: error.message || String(error)
    };
  }
}

/**
 * 获取钱包状态
 */
function getLineraWalletState() {
  // GraphQL 模式下没有 chain 实例，但有 chainId
  const isConnected = lineraState.mode === 'graphql' 
    ? !!lineraState.chainId 
    : !!lineraState.chain;
  
  // 获取环境检查结果
  const envCheck = checkWasmEnvironment();
  
  return {
    initialized: lineraState.initialized,
    connected: isConnected,
    address: lineraState.ownerAddress,
    chainId: lineraState.chainId,
    displayChainId: lineraState.displayChainId || null,
    chainDescription: lineraState.chainDescription || null,
    balance: lineraState.balance,
    networkName: LINERA_CONFIG.networkName,
    mode: lineraState.mode,
    faucetUrl: LINERA_CONFIG.faucetUrl,
    // 新增：环境检查信息
    environment: {
      canUseWasm: envCheck.canUseWasm,
      sharedArrayBufferAvailable: envCheck.sharedArrayBufferAvailable,
      crossOriginIsolated: envCheck.crossOriginIsolated,
      reason: envCheck.reason
    },
    // 是否可以执行真实转账
    canRealTransfer: envCheck.canUseWasm && lineraState.mode === 'wasm'
  };
}

/**
 * 断开 Linera 钱包
 */
function disconnectLineraWallet() {
  // 清理状态
  if (lineraState.chain) {
    lineraState.chain.free?.();
  }
  if (lineraState.client) {
    lineraState.client.free?.();
  }
  if (lineraState.wallet) {
    lineraState.wallet.free?.();
  }
  if (lineraState.faucet) {
    lineraState.faucet.free?.();
  }
  
  lineraState.signer = null;
  lineraState.faucet = null;
  lineraState.wallet = null;
  lineraState.client = null;
  lineraState.chain = null;
  lineraState.chainId = null;
  lineraState.ownerAddress = null;
  lineraState.balance = '0';
  
  window.dispatchEvent(new CustomEvent('lineraWalletDisconnected'));
  
  console.log('[LineraWallet] Disconnected');
}

/**
 * 使用 MetaMask 创建 EIP-191 签名
 * @param {string} message - 要签名的消息
 * @returns {Promise<string>} 签名
 */
async function createLineraSignature(message) {
  if (!window.ethereum) {
    throw new Error('MetaMask not available');
  }
  
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  if (!accounts || accounts.length === 0) {
    throw new Error('No MetaMask accounts');
  }
  
  const address = accounts[0];
  console.log('[LineraWallet] Creating signature for message:', message);
  
  // 使用 personal_sign (EIP-191)
  const signature = await window.ethereum.request({
    method: 'personal_sign',
    params: [message, address]
  });
  
  console.log('[LineraWallet] Signature created:', signature.substring(0, 20) + '...');
  return signature;
}

/**
 * 为 MCP 支付创建转账（GraphQL 模式）
 * 由于 GraphQL 模式无法直接执行链上转账，使用签名证明
 * 
 * @param {Object} invoice - 402 Invoice
 * @returns {Promise<Object>} 支付结果
 */
async function settleLineraInvoiceGraphQL(invoice) {
  console.log('[LineraWallet] Settling invoice (GraphQL mode):', invoice);
  
  const amount = invoice.amount_usdc ?? invoice.amount;
  const recipient = invoice.recipient;
  const nonce = invoice.nonce || Date.now().toString();
  
  // 确保有 owner 地址
  if (!lineraState.ownerAddress) {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (!accounts || accounts.length === 0) {
      throw new Error('No MetaMask accounts');
    }
    lineraState.ownerAddress = accounts[0].toLowerCase();
  }
  
  // 确保有 chainId（如果没有则先 claim）
  if (!lineraState.chainId) {
    console.log('[LineraWallet] No chain claimed yet, claiming now...');
    try {
      const chainDescription = await claimChainGraphQL(lineraState.ownerAddress);
      lineraState.chainId = chainDescription;
      lineraState.chainDescription = chainDescription;
      console.log('[LineraWallet] Chain claimed:', chainDescription);
    } catch (claimError) {
      console.warn('[LineraWallet] Failed to claim chain:', claimError.message);
      lineraState.chainId = 'pending-claim';
    }
  }
  
  // 方案 C：创建包含完整转账信息的签名消息
  const recipientChainId = invoice.recipient_chain_id || null;
  const transferMessage = JSON.stringify({
    type: 'linera_transfer_intent',
    amount: amount,
    recipient: recipient,
    recipientChainId: recipientChainId,
    sender: lineraState.ownerAddress,
    senderChainId: lineraState.chainId,
    nonce: nonce,
    timestamp: new Date().toISOString()
  });
  
  console.log('[LineraWallet] Creating EIP-191 signature for transfer intent...');
  const signature = await createLineraSignature(transferMessage);
  console.log('[LineraWallet] ✅ Signature created');
  
  // 签名模式无真实链上转账，本地模拟扣减余额
  decreaseLineraBalance(amount);
  
  return {
    type: 'linera_transfer',
    success: true,
    amount,
    recipient,
    recipientChainId,
    senderChainId: lineraState.chainId,
    senderAddress: lineraState.ownerAddress,
    nonce: nonce,
    signature: signature,
    timestamp: new Date().toISOString(),
    mode: 'graphql',
    transferType: 'signed',
    message: transferMessage
  };
}

/**
 * 为 MCP 支付创建转账（WASM 模式）
 * 使用 @linera/client SDK 执行真实链上转账
 * 
 * @param {Object} invoice - 402 Invoice
 * @returns {Promise<Object>} 支付结果
 */
async function settleLineraInvoiceWASM(invoice) {
  console.log('[LineraWallet] Settling invoice (WASM mode):', invoice);
  
  const amount = invoice.amount_usdc ?? invoice.amount;
  const recipient = invoice.recipient;
  const recipientChainId = invoice.recipient_chain_id || null;
  const nonce = invoice.nonce;
  
  try {
    if (!lineraState.chain) {
      console.log('[LineraWallet] Chain not connected, attempting to connect...');
      const connectResult = await connectLineraWalletWASM();
      if (!connectResult.success) {
        throw new Error('Failed to connect wallet: ' + connectResult.error);
      }
    }
    
    console.log('[LineraWallet] Attempting real transfer via WASM...');
    const result = await transferLinera({
      recipient,
      recipientChainId,
      amount
    });
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    console.log('[LineraWallet] ✅ Real transfer successful');
    return {
      type: 'linera_transfer',
      success: true,
      amount,
      recipient,
      senderChainId: lineraState.chainId,
      senderAddress: lineraState.ownerAddress,
      nonce: nonce,
      timestamp: new Date().toISOString(),
      mode: 'wasm',
      transferType: 'real'
    };
  } catch (transferError) {
    console.warn('[LineraWallet] Real transfer failed:', transferError.message);
    console.log('[LineraWallet] Falling back to signed proof (Plan C)...');
    
    if (!lineraState.ownerAddress) {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (!accounts || accounts.length === 0) {
        throw new Error('No MetaMask accounts available');
      }
      lineraState.ownerAddress = accounts[0].toLowerCase();
    }
    
    const chainIdForProof = lineraState.chainId || 'pending-claim';
    const transferMessage = JSON.stringify({
      type: 'linera_transfer_intent',
      amount: amount,
      recipient: recipient,
      recipientChainId: recipientChainId,
      sender: lineraState.ownerAddress,
      senderChainId: chainIdForProof,
      nonce: nonce,
      timestamp: new Date().toISOString()
    });
    
    console.log('[LineraWallet] Creating EIP-191 signature for transfer intent...');
    const signature = await createLineraSignature(transferMessage);
    console.log('[LineraWallet] ✅ Signed transfer intent created');
    
    // WASM 回退到签名模式，无真实转账，本地模拟扣减
    decreaseLineraBalance(amount);
    
    return {
      type: 'linera_transfer',
      success: true,
      amount,
      recipient,
      recipientChainId,
      senderChainId: chainIdForProof,
      senderAddress: lineraState.ownerAddress,
      nonce: nonce,
      signature: signature,
      timestamp: new Date().toISOString(),
      mode: 'wasm_fallback',
      transferType: 'signed',
      message: transferMessage
    };
  }
}

/**
 * 为 MCP 支付创建转账
 * 自动选择 GraphQL 或 WASM 模式
 * 
 * @param {Object} invoice - 402 Invoice
 * @returns {Promise<Object>} 支付结果
 */
async function settleLineraInvoice(invoice) {
  try {
    console.log('[LineraWallet] Settling invoice, mode:', lineraState.mode);
    
    // 确保已初始化
    if (!lineraState.initialized) {
      await initializeLineraSDK();
    }
    
    // 根据模式选择
    if (lineraState.mode === 'graphql') {
      // GraphQL 模式 - 使用签名验证（不是真实转账）
      console.log('[LineraWallet] Using GraphQL signature mode (not real transfer)');
      return await settleLineraInvoiceGraphQL(invoice);
    } else if (lineraState.mode === 'wasm') {
      // WASM 模式 - 尝试真实转账
      console.log('[LineraWallet] Using WASM mode for real transfer');
      
      // 先检查 SharedArrayBuffer 是否可用
      if (typeof SharedArrayBuffer === 'undefined') {
        console.warn('[LineraWallet] SharedArrayBuffer not available, falling back to GraphQL');
        lineraState.mode = 'graphql';
        return await settleLineraInvoiceGraphQL(invoice);
      }
      
      // 检查 crossOriginIsolated
      if (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated) {
        console.warn('[LineraWallet] crossOriginIsolated is false, WASM may not work');
        console.warn('[LineraWallet] Falling back to GraphQL mode...');
        lineraState.mode = 'graphql';
        return await settleLineraInvoiceGraphQL(invoice);
      }
      
      // 如果没有 chain 实例，先连接钱包
      if (!lineraState.chain) {
        console.log('[LineraWallet] No chain instance, connecting wallet first...');
        try {
          const connectResult = await connectLineraWalletWASM();
          if (!connectResult.success) {
            console.warn('[LineraWallet] WASM wallet connection failed:', connectResult.error);
            console.log('[LineraWallet] Falling back to GraphQL mode...');
            lineraState.mode = 'graphql';
            return await settleLineraInvoiceGraphQL(invoice);
          }
        } catch (connectError) {
          console.error('[LineraWallet] WASM wallet connection error:', connectError.message);
          console.log('[LineraWallet] Falling back to GraphQL mode...');
          lineraState.mode = 'graphql';
          return await settleLineraInvoiceGraphQL(invoice);
        }
      }
      
      // 执行 WASM 转账
      try {
        return await settleLineraInvoiceWASM(invoice);
      } catch (wasmError) {
        console.error('[LineraWallet] WASM transfer failed:', wasmError);
        console.log('[LineraWallet] Falling back to GraphQL mode...');
        lineraState.mode = 'graphql';
        return await settleLineraInvoiceGraphQL(invoice);
      }
    } else {
      // 未知模式，使用 GraphQL
      console.warn('[LineraWallet] Unknown mode, using GraphQL fallback');
      return await settleLineraInvoiceGraphQL(invoice);
    }
  } catch (error) {
    console.error('[LineraWallet] Invoice settlement failed:', error);
    throw error;
  }
}

// 导出到全局
window.LineraWallet = {
  config: LINERA_CONFIG,
  initialize: initializeLineraSDK,
  connect: connectLineraWallet,
  transfer: transferLinera,
  getBalance: getLineraBalance,
  getState: getLineraWalletState,
  disconnect: disconnectLineraWallet,
  settleInvoice: settleLineraInvoice,
  // 新增：环境检测函数
  checkEnvironment: checkWasmEnvironment
};

// 导出状态（只读）
Object.defineProperty(window.LineraWallet, 'state', {
  get: () => ({ ...lineraState }),
  enumerable: true
});

console.log('[LineraWallet] Module loaded. Use window.LineraWallet to access.');
