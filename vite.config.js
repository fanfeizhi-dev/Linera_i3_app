import { defineConfig } from 'vite'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs'

export default defineConfig({
  server: {
    host: '0.0.0.0', // Allow external access
    // 开发时需要同时跑后端（serve.js 默认 3000），因此 Vite 改用不同端口
    port: 5173,
    strictPort: true,
    fs: {
      // Allow serving files from outside the root
      strict: false
    },
    proxy: {
      // 注意：使用 /api/ 而不是 /api，避免匹配 /api-manager.js
      '/api/': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path
      },
      // 注意：使用 /mcp/ 而不是 /mcp，避免匹配 /mcp-client.js
      '/mcp/': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path
      }
    },
    // Linera WASM 需要 SharedArrayBuffer
    // 使用 credentialless 模式（比 require-corp 更宽松，允许更多跨域资源）
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless'
    }
  },
  // 优化依赖预打包
  optimizeDeps: {
    // 不要预打包 Linera 包，让它们的 WASM 文件能正确加载
    exclude: ['@linera/client', '@linera/metamask']
  },
  // 确保 WASM 文件作为资源处理
  assetsInclude: ['**/*.wasm'],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        modelverse: resolve(__dirname, 'modelverse.html'),
        benchmark: resolve(__dirname, 'benchmark.html'),
        canvas: resolve(__dirname, 'canvas.html'),
        workflow: resolve(__dirname, 'workflow.html'),
        myassets: resolve(__dirname, 'myassets.html'),
        mycart: resolve(__dirname, 'mycart.html'),
        interactive: resolve(__dirname, 'interactive.html')
      }
    }
  },
  publicDir: 'public',
  root: '.',
  plugins: [
    {
      name: 'preserve-assets',
      transformIndexHtml(html) {
        // This plugin ensures CSS and JS files are referenced directly, not bundled
        let out = html
          .replace(/href="\/assets\/styles-[^"]+\.css"/g, 'href="styles.css"')
          .replace(/href="\/assets\/account-dropdown-[^"]+\.css"/g, 'href="account-dropdown.css"')
          .replace(/crossorigin href="styles\.css"/g, 'href="styles.css"')
          .replace(/crossorigin href="account-dropdown\.css"/g, 'href="account-dropdown.css"')

        // 方案A：确保生产构建也会加载 Linera Wallet 模块（真实转账）
        // Vite 可能会移除/重写指向根目录的脚本引用，因此这里做一次强制注入。
        if (!out.includes('linera-wallet.js')) {
          out = out.replace(
            /<script\s+src="\/mcp-client\.js"><\/script>/i,
            '<script type="module" src="/linera-wallet.js"></script>\n    <script src="/mcp-client.js"></script>'
          );
        }

        return out
      }
    },
    {
      name: 'copy-js-files',
      generateBundle() {
        // Copy JS files as-is to dist root
        const jsFiles = [
          'model-data.js',
          'config.js', 
          'api-manager.js',
          // 402 client + Linera wallet（方案A）
          'mcp-client.js',
          'linera-wallet.js',
          'wallet-manager.js',
          'wallet-integration.js',
          'account-dropdown.js',
          'modelverse.js',
          'benchmark.js',
          'canvas.js',
          'workflow.js',
          'myassets.js',
          'mycart.js'
        ]
        
        // Copy CSS files as-is to dist root
        const cssFiles = [
          'styles.css',
          'canvas.css',
          'account-dropdown.css',
          'modelverse.css',
          'myassets.css',
          'mycart.css',
          'workflow.css',
          'benchmark.css',
          'modelverse-buttons.css'
        ]
        
        jsFiles.forEach(file => {
          try {
            copyFileSync(resolve(__dirname, file), resolve(__dirname, 'dist', file))
            console.log(`✅ Copied ${file}`)
          } catch (err) {
            console.warn(`⚠️ Could not copy ${file}:`, err.message)
          }
        })
        
        cssFiles.forEach(file => {
          try {
            copyFileSync(resolve(__dirname, file), resolve(__dirname, 'dist', file))
            console.log(`✅ Copied ${file}`)
          } catch (err) {
            console.warn(`⚠️ Could not copy ${file}:`, err.message)
          }
        })
        
        // Copy SVG directory
        try {
          function copyDir(src, dest) {
            mkdirSync(dest, { recursive: true })
            const entries = readdirSync(src, { withFileTypes: true })
            
            for (let entry of entries) {
              const srcPath = resolve(src, entry.name)
              const destPath = resolve(dest, entry.name)
              
              if (entry.isDirectory()) {
                copyDir(srcPath, destPath)
              } else {
                copyFileSync(srcPath, destPath)
                console.log(`✅ Copied ${entry.name}`)
              }
            }
          }
          
          copyDir(resolve(__dirname, 'svg'), resolve(__dirname, 'dist', 'svg'))
        } catch (err) {
          console.warn(`⚠️ Could not copy SVG directory:`, err.message)
        }
      }
    }
  ]
})
