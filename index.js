// ===== 密码哈希（SHA-256 + Salt）=====
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + ':ghfm-salt-2024');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, hash) {
    const computedHash = await hashPassword(password);
    return computedHash === hash;
}

// ===== AES-GCM 加密/解密 =====
const ENCRYPTION_KEY_RAW = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';

async function getEncryptionKey() {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(ENCRYPTION_KEY_RAW);
    return await crypto.subtle.importKey(
        'raw', keyData, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
    );
}

async function encryptConfig(configObj) {
    const key = await getEncryptionKey();
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encoder.encode(JSON.stringify(configObj))
    );
    return {
        encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
        iv: btoa(String.fromCharCode(...iv))
    };
}

async function decryptConfig(encryptedData) {
    try {
        const key = await getEncryptionKey();
        const encrypted = Uint8Array.from(atob(encryptedData.encrypted), c => c.charCodeAt(0));
        const iv = Uint8Array.from(atob(encryptedData.iv), c => c.charCodeAt(0));
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            encrypted
        );
        return JSON.parse(new TextDecoder().decode(decrypted));
    } catch (e) {
        return null;
    }
}

// ===== Session Token =====
function generateSessionToken() {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getClientIP(request) {
    return request.headers.get('CF-Connecting-IP') || 
           request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 
           'unknown';
}

async function checkRateLimit(env, keyPrefix, request, maxAttempts = 5, windowMinutes = 15) {
    const rateKey = keyPrefix + ':' + getClientIP(request);
    const attempts = await env.KV.get(rateKey);
    
    if (attempts && parseInt(attempts) >= maxAttempts) {
        return false;
    }
    return true;
}

async function recordAttempt(env, keyPrefix, request) {
    const rateKey = keyPrefix + ':' + getClientIP(request);
    let attempts = await env.KV.get(rateKey);
    attempts = attempts ? parseInt(attempts) + 1 : 1;
    await env.KV.put(rateKey, String(attempts), { expirationTtl: 900 });
}

// 获取所有路径配置
function getPathConfig(userConfig) {
  const paths = [];
  
  // 使用用户配置中的paths数组
  if (userConfig.paths && userConfig.paths.length > 0) {
    userConfig.paths.forEach((p, index) => {
      paths.push({
        name: 'path' + (index + 1),
        displayName: p.name || ('路径' + (index + 1)),
        path: p.path
      });
    });
  }
  
  // 如果没有配置任何路径，使用默认值
  if (paths.length === 0) {
    paths.push({
      name: 'default',
      displayName: '默认路径',
      path: ''
    });
  }
  
  return paths;
}

// 从请求中获取用户配置
async function getUserConfig(request, env) {
  const username = await verifySession(request, env);
  if (!username) return null;
  
  const configStr = await env.KV.get('config:' + username);
  if (!configStr) return null;
  
  try {
    const encryptedData = JSON.parse(configStr);
    return await decryptConfig(encryptedData);
  } catch (e) {
    return null;
  }
}

// 获取GitHub API配置的辅助函数
function getGithubConfig(userConfig) {
  return {
    GITHUB_TOKEN: userConfig.GITHUB_TOKEN || '',
    GITHUB_OWNER: userConfig.GITHUB_OWNER || '',
    GITHUB_REPO: userConfig.GITHUB_REPO || '',
    GITHUB_BRANCH: userConfig.GITHUB_BRANCH || 'main'
  };
}

// 验证会话
async function verifySession(request, env) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  
  const cookies = new Map(cookieHeader.split(';').map(c => {
    const [key, value] = c.trim().split('=');
    return [key, value];
  }));
  
  const sessionToken = cookies.get('session_token');
  if (!sessionToken) return null;
  
  // 从KV读取会话数据
  const sessionStr = await env.KV.get('session:' + sessionToken);
  if (!sessionStr) return null;
  
  const sessionData = JSON.parse(sessionStr);
  if (sessionData.expiresAt < Date.now()) {
    // 会话过期，删除
    await env.KV.delete('session:' + sessionToken);
    return null;
  }
  
  return sessionData.username; // 返回用户名而非布尔值
}

// 设置会话Cookie
async function setSessionCookie(response, env, username) {
  const sessionToken = generateSessionToken();
  const maxAge = 3600; // 1小时
  
  const sessionData = {
    username: username,
    expiresAt: Date.now() + maxAge * 1000,
    createdAt: new Date().toISOString()
  };
  
  // 写入KV，设置TTL自动过期
  await env.KV.put('session:' + sessionToken, JSON.stringify(sessionData), { expirationTtl: maxAge });
  
  response.headers.set('Set-Cookie', `session_token=${sessionToken}; Max-Age=${maxAge}; HttpOnly; Path=/; SameSite=Lax`);
  return response;
}

// 清除会话Cookie
async function clearSessionCookie(response, request, env) {
  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader) {
    const cookies = new Map(cookieHeader.split(';').map(c => {
      const [key, value] = c.trim().split('=');
      return [key, value];
    }));
    const sessionToken = cookies.get('session_token');
    if (sessionToken) {
      await env.KV.delete('session:' + sessionToken);
    }
  }
  
  response.headers.set('Set-Cookie', 'session_token=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax');
  return response;
}

// 统一的文件路径编码函数
function encodeGitHubPath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

// Material Web 公共 CSS 变量和引入模板
function getMaterialWebHead(title) {
  return `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, shrink-to-fit=no"/>
    <meta name="renderer" content="webkit"/>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" rel="stylesheet">
    <script type="importmap">
    {
      "imports": {
        "@material/web/": "https://esm.run/@material/web/"
      }
    }
    </script>
    <script type="module">
      import '@material/web/all.js';
      import {styles as typescaleStyles} from '@material/web/typography/md-typescale-styles.js';
      document.adoptedStyleSheets.push(typescaleStyles.styleSheet);
    </script>
    <title>${title}</title>`;
}

// Material Web 动态色彩 CSS 变量默认值（含深色模式）
function getMD3ColorTokens() {
  return `
        /* 全局动画关键帧 */
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideInUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideInRight {
            from { opacity: 0; transform: translateX(-30px); }
            to { opacity: 1; transform: translateX(0); }
        }
        @keyframes scaleIn {
            from { opacity: 0; transform: scale(0.9); }
            to { opacity: 1; transform: scale(1); }
        }
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
        }
        @keyframes ripple {
            0% { transform: scale(0); opacity: 0.5; }
            100% { transform: scale(4); opacity: 0; }
        }
        @keyframes shimmer {
            0% { background-position: -1000px 0; }
            100% { background-position: 1000px 0; }
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
        
        :root {
            --md-sys-color-primary: #1e40af;
            --md-sys-color-on-primary: #ffffff;
            --md-sys-color-primary-container: #d7e3ff;
            --md-sys-color-on-primary-container: #001a41;
            --md-sys-color-secondary: #565e71;
            --md-sys-color-on-secondary: #ffffff;
            --md-sys-color-secondary-container: #dae2f9;
            --md-sys-color-on-secondary-container: #131c2b;
            --md-sys-color-tertiary: #705575;
            --md-sys-color-on-tertiary: #ffffff;
            --md-sys-color-tertiary-container: #fad8fd;
            --md-sys-color-on-tertiary-container: #28132f;
            --md-sys-color-error: #ba1a1a;
            --md-sys-color-on-error: #ffffff;
            --md-sys-color-error-container: #ffdad6;
            --md-sys-color-on-error-container: #410002;
            --md-sys-color-surface: #f8f9ff;
            --md-sys-color-on-surface: #191c20;
            --md-sys-color-surface-variant: #e1e2ec;
            --md-sys-color-on-surface-variant: #44474f;
            --md-sys-color-background: #f8f9ff;
            --md-sys-color-on-background: #191c20;
            --md-sys-color-outline: #74777f;
            --md-sys-color-outline-variant: #c4c6d0;
            --md-sys-color-inverse-surface: #2e3036;
            --md-sys-color-inverse-on-surface: #eff0f7;
            --md-sys-color-inverse-primary: #adc6ff;
            --md-sys-color-surface-dim: #d8d9e0;
            --md-sys-color-surface-bright: #f8f9ff;
            --md-sys-color-surface-container-lowest: #ffffff;
            --md-sys-color-surface-container-low: #f2f3fa;
            --md-sys-color-surface-container: #ecedf4;
            --md-sys-color-surface-container-high: #e7e8ee;
            --md-sys-color-surface-container-highest: #e1e2e8;
            --md-sys-shape-corner-full: 28px;
            --md-sys-shape-corner-extra-large: 16px;
            --md-sys-shape-corner-large: 12px;
            --md-sys-shape-corner-medium: 8px;
            --md-sys-shape-corner-small: 4px;
            color-scheme: light;
        }
        [data-theme="dark"] {
            --md-sys-color-primary: #adc6ff;
            --md-sys-color-on-primary: #003062;
            --md-sys-color-primary-container: #00478a;
            --md-sys-color-on-primary-container: #d7e3ff;
            --md-sys-color-secondary: #bec6dc;
            --md-sys-color-on-secondary: #263041;
            --md-sys-color-secondary-container: #3c4759;
            --md-sys-color-on-secondary-container: #dae2f9;
            --md-sys-color-tertiary: #debcde;
            --md-sys-color-on-tertiary: #3f2844;
            --md-sys-color-tertiary-container: #573f5b;
            --md-sys-color-on-tertiary-container: #fad8fd;
            --md-sys-color-error: #ffb4ab;
            --md-sys-color-on-error: #690005;
            --md-sys-color-error-container: #93000a;
            --md-sys-color-on-error-container: #ffdad6;
            --md-sys-color-surface: #111318;
            --md-sys-color-on-surface: #e1e2e8;
            --md-sys-color-surface-variant: #44474f;
            --md-sys-color-on-surface-variant: #c4c6d0;
            --md-sys-color-background: #111318;
            --md-sys-color-on-background: #e1e2e8;
            --md-sys-color-outline: #8e9099;
            --md-sys-color-outline-variant: #44474f;
            --md-sys-color-inverse-surface: #e1e2e8;
            --md-sys-color-inverse-on-surface: #2e3036;
            --md-sys-color-inverse-primary: #1e40af;
            --md-sys-color-surface-dim: #111318;
            --md-sys-color-surface-bright: #37393f;
            --md-sys-color-surface-container-lowest: #0c0e13;
            --md-sys-color-surface-container-low: #191c20;
            --md-sys-color-surface-container: #1d2024;
            --md-sys-color-surface-container-high: #282a2f;
            --md-sys-color-surface-container-highest: #33353a;
            color-scheme: dark;
        }
        body {
            transition: background-color 0.3s ease, color 0.3s ease;
            animation: fadeIn 0.5s ease;
        }`;
}

// 动态色彩应用脚本（使用 material-color-utilities 生成标准 MD3 配色）
function getDynamicColorScript() {
  return `
        let _mcuModule = null;
        let _lightScheme = null;
        let _darkScheme = null;

        // ARGB 整数转 hex 字符串
        function argbToHex(argb) {
            return '#' + ((argb & 0xffffff).toString(16).padStart(6, '0'));
        }

        // 从 MCU scheme 对象提取所有 MD3 颜色令牌
        function extractSchemeTokens(scheme) {
            const props = [
                'primary','onPrimary','primaryContainer','onPrimaryContainer',
                'secondary','onSecondary','secondaryContainer','onSecondaryContainer',
                'tertiary','onTertiary','tertiaryContainer','onTertiaryContainer',
                'error','onError','errorContainer','onErrorContainer',
                'surface','onSurface','surfaceVariant','onSurfaceVariant',
                'background','onBackground','outline','outlineVariant',
                'inverseSurface','inverseOnSurface','inversePrimary',
                'surfaceDim','surfaceBright',
                'surfaceContainerLowest','surfaceContainerLow',
                'surfaceContainer','surfaceContainerHigh','surfaceContainerHighest'
            ];
            const tokens = {};
            for (const prop of props) {
                if (scheme[prop] !== undefined) {
                    tokens[prop] = argbToHex(scheme[prop]);
                }
            }
            return tokens;
        }

        // 将颜色令牌应用到 :root CSS 变量
        function applySchemeTokens(tokens) {
            const root = document.documentElement;
            const prefix = '--md-sys-color-';
            for (const [key, value] of Object.entries(tokens)) {
                root.style.setProperty(prefix + key, value);
            }
        }

        // 动态加载 material-color-utilities
        async function loadMCU() {
            if (_mcuModule) return _mcuModule;
            try {
                _mcuModule = await import('https://cdn.jsdelivr.net/npm/@material/material-color-utilities@0.4.0/+esm');
                return _mcuModule;
            } catch (e) {
                console.warn('Failed to load material-color-utilities:', e);
                return null;
            }
        }

        // 从种子色生成 light/dark 双方案并缓存
        async function generateSchemes(hexColor) {
            const mcu = await loadMCU();
            if (!mcu) return false;
            try {
                const { argbFromHex, Hct, SchemeTonalSpot } = mcu;
                const sourceArgb = argbFromHex(hexColor);
                const sourceHct = Hct.fromInt(sourceArgb);
                _lightScheme = new SchemeTonalSpot(sourceHct, false, 0.0);
                _darkScheme = new SchemeTonalSpot(sourceHct, true, 0.0);
                return true;
            } catch (e) {
                console.warn('Scheme generation failed:', e);
                return false;
            }
        }

        // 应用当前模式的配色方案
        function applyCurrentScheme() {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const scheme = isDark ? _darkScheme : _lightScheme;
            if (!scheme) return;
            const tokens = extractSchemeTokens(scheme);
            applySchemeTokens(tokens);
        }

        // 用 MCU 从种子色生成 MD3 配色并应用（替换旧的 applyDynamicColor）
        async function applyDynamicColor(color) {
            const ok = await generateSchemes(color);
            if (ok) {
                applyCurrentScheme();
            }
        }

        // 深色模式切换
        function toggleDarkMode(forceState) {
            const html = document.documentElement;
            const currentIsDark = html.getAttribute('data-theme') === 'dark';
            const isDark = forceState !== undefined ? forceState : !currentIsDark;
            
            if (isDark) {
                html.setAttribute('data-theme', 'dark');
            } else {
                html.removeAttribute('data-theme');
            }
            localStorage.setItem('darkMode', isDark ? 'true' : 'false');
            // 如果已有 MCU 生成的方案，实时应用
            applyCurrentScheme();
            // 更新所有深色模式切换按钮图标
            updateDarkModeIcons(isDark);
            // 更新主题对话框中的 switch（如果存在）
            const sw = document.getElementById('darkModeSwitch');
            if (sw) sw.checked = isDark;
        }

        function updateDarkModeIcons(isDark) {
            const icon = isDark ? 'dark_mode' : 'light_mode';
            document.querySelectorAll('[data-dark-toggle]').forEach(function(btn) {
                btn.icon = icon;
                btn.setAttribute('aria-label', isDark ? '切换到浅色模式' : '切换到深色模式');
            });
        }

        // 初始化深色模式（页面加载时调用）
        function initDarkMode() {
            const saved = localStorage.getItem('darkMode');
            let isDark;
            if (saved !== null) {
                isDark = saved === 'true';
            } else {
                isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            }
            if (isDark) {
                document.documentElement.setAttribute('data-theme', 'dark');
            }
            updateDarkModeIcons(isDark);
            const sw = document.getElementById('darkModeSwitch');
            if (sw) sw.checked = isDark;
        }

        // 恢复主题色（页面加载时调用）
        async function restoreThemeColor() {
            initDarkMode();
            const savedColor = localStorage.getItem('themeColor');
            if (savedColor) {
                await applyDynamicColor(savedColor);
            } else {
                // 如果没有保存的颜色，使用默认主题色
                await applyDynamicColor('#1e40af');
            }
        }

        // 主题色对话框相关函数
        function openThemeDialog() {
            const dialog = document.getElementById('themeDialog');
            const sw = document.getElementById('darkModeSwitch');
            if (sw) {
                sw.checked = document.documentElement.getAttribute('data-theme') === 'dark';
            }
            dialog.show();
        }

        function updateColorPreview() {
            const colorInput = document.getElementById('colorInput');
            const preview = document.getElementById('colorPreview');
            // 使用CSS变量或直接样式更新预览
            preview.style.backgroundColor = colorInput.value;
            // 同时更新CSS变量以保持一致性
            preview.style.setProperty('--preview-color', colorInput.value);
        }

        function extractColorFromImage(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.onload = function() {
                    const canvas = document.getElementById('colorCanvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    ctx.drawImage(img, 0, 0);

                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const data = imageData.data;

                    let r = 0, g = 0, b = 0;
                    const sampleSize = Math.min(10000, data.length / 4);
                    const step = Math.floor(data.length / 4 / sampleSize);

                    for (let i = 0; i < sampleSize; i++) {
                        const idx = i * step * 4;
                        r += data[idx];
                        g += data[idx + 1];
                        b += data[idx + 2];
                    }

                    r = Math.floor(r / sampleSize);
                    g = Math.floor(g / sampleSize);
                    b = Math.floor(b / sampleSize);

                    const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
                    document.getElementById('colorInput').value = hex;
                    document.getElementById('colorPreview').style.backgroundColor = hex;
                    showMessage('已从图片提取主题色', false);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }

        async function applyTheme() {
            const color = document.getElementById('colorInput').value;
            // 同步切换深色模式
            const sw = document.getElementById('darkModeSwitch');
            if (sw) {
                toggleDarkMode(sw.checked);
            }
            await applyDynamicColor(color);
            localStorage.setItem('themeColor', color);
            showMessage('主题色已更新', false);
            document.getElementById('themeDialog').close();
        }`;
}

// 简单的消息提示函数（替代 Snackbar）
function getMessageHelper() {
  return `
        function showMessage(message, isError) {
            if (isError) {
                alert('错误: ' + message);
            } else {
                alert(message);
            }
        }`;
}

// 登录页面HTML
function getLoginHTML(error = '') {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    ${getMaterialWebHead('GitHub文件管理器 - 登录')}
    <style>
    ${getMD3ColorTokens()}
        * { box-sizing: border-box; }
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--md-sys-color-background);
            margin: 0;
            font-family: 'Roboto', 'Helvetica', 'Arial', sans-serif;
            transition: background 0.3s ease;
        }
        .login-container {
            width: 100%;
            max-width: 420px;
            background: var(--md-sys-color-surface);
            border-radius: var(--md-sys-shape-corner-extra-large);
            box-shadow: 0 1px 3px 1px rgba(0,0,0,0.15), 0 1px 2px 0 rgba(0,0,0,0.3);
            overflow: hidden;
            transition: box-shadow 0.3s ease, transform 0.3s ease;
            animation: slideInUp 0.6s ease;
        }
        .login-container:hover {
            box-shadow: 0 4px 6px 2px rgba(0,0,0,0.15), 0 2px 3px 0 rgba(0,0,0,0.3);
            transform: translateY(-4px);
        }
        .login-header {
            background: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
            padding: 40px 32px;
            text-align: center;
        }
        .logo { margin-bottom: 20px; display: flex; justify-content: center; }
        .logo-icon {
            background: var(--md-sys-color-primary-container);
            color: var(--md-sys-color-on-primary-container);
            border-radius: 50%;
            padding: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s ease;
            position: relative;
            overflow: hidden;
        }
        .logo-icon::before {
            content: '';
            position: absolute;
            inset: 0;
            background: currentColor;
            opacity: 0;
            transition: opacity 0.2s ease;
            pointer-events: none;
            border-radius: 50%;
        }
        .logo-icon:hover::before { opacity: 0.08; }
        .logo-icon:hover { transform: scale(1.05); }
        .login-body { padding: 32px; }
        .error-message {
            margin-bottom: 24px;
            padding: 12px 16px;
            border-radius: var(--md-sys-shape-corner-small);
            background: var(--md-sys-color-error-container);
            color: var(--md-sys-color-on-error-container);
            font-size: 14px;
            line-height: 1.5;
        }
        .form-group { margin-bottom: 24px; }
        .form-group md-outlined-text-field { width: 100%; }
        .form-actions { margin-top: 32px; }
        .form-actions md-filled-button {
            width: 100%;
            --md-filled-button-container-shape: var(--md-sys-shape-corner-full);
            height: 56px;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            position: relative;
            overflow: hidden;
        }
        .form-actions md-filled-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }
        .form-actions md-filled-button:active {
            transform: translateY(0);
            transition: transform 0.1s ease;
        }
        /* 波纹效果 */
        .ripple {
            position: absolute;
            border-radius: 50%;
            background: rgba(255,255,255,0.5);
            transform: scale(0);
            animation: ripple 0.6s ease-out;
            pointer-events: none;
        }
        .footer {
            text-align: center;
            margin-top: 24px;
            font-size: 14px;
            color: var(--md-sys-color-on-surface-variant);
        }
        @media (max-width: 480px) {
            body { padding: 0; }
            .login-container { 
                margin: 0; 
                border-radius: 0; 
                max-width: 100%; 
                height: 100vh; 
                display: flex; 
                flex-direction: column; 
                box-shadow: none;
            }
            .login-header { padding: 24px 20px; }
            .login-body { padding: 20px; flex: 1; }
            .form-actions { 
                margin-top: auto; 
                padding-top: 20px;
            }
            .material-symbols-outlined {
                font-size: 20px;
            }
        }
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
    </style>
</head>
<body>
    <div style="position: fixed; top: 16px; right: 16px; z-index: 100;">
        <md-filled-icon-button data-dark-toggle aria-label="切换到深色模式" onclick="toggleDarkMode()">
          <md-icon>routine</md-icon>
        </md-filled-icon-button>
    </div>
    <div class="login-container">
        <div class="login-header">
            <div class="logo">
                <div class="logo-icon">
                    <span class="material-symbols-outlined" style="font-size: 48px;">lock</span>
                </div>
            </div>
            <h1 class="md-typescale-headline-medium">GitHub文件管理器</h1>
            <p class="md-typescale-body-large">请输入用户名和密码登录系统</p>
        </div>
        ${error ? `<div class="error-message" role="alert">${error}</div>` : ''}
        <div class="login-body">
            <form id="loginForm" method="POST" action="/api/login">
                <div class="form-group">
                    <md-outlined-text-field label="用户名" type="text" name="username" id="username" required>
                        <span slot="leading-icon" class="material-symbols-outlined">person</span>
                    </md-outlined-text-field>
                </div>
                <div class="form-group">
                    <md-outlined-text-field label="密码" type="password" name="password" id="password" required>
                        <span slot="leading-icon" class="material-symbols-outlined">lock</span>
                    </md-outlined-text-field>
                </div>
                <div class="form-actions">
                    <md-filled-button type="submit">
                        <span slot="icon" class="material-symbols-outlined">login</span>
                        登录
                    </md-filled-button>
                </div>
                <div class="footer">
                    <p>没有账号？<a href="/register">去注册</a></p>
                </div>
            </form>
        </div>
    </div>
    <script>
    ${getMessageHelper()}
    ${getDynamicColorScript()}
        document.getElementById('loginForm').addEventListener('submit', function(e) {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            if (!username || !password) {
                e.preventDefault();
                showMessage('请输入用户名和密码', true);
            }
        });
        window.onload = function() {
            document.getElementById('username').focus();
            restoreThemeColor();
        };
    </script>
</body>
</html>
  `;
}

// 注册页面HTML
function getRegisterHTML(error = '') {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    ${getMaterialWebHead('GitHub文件管理器 - 注册')}
    <style>
    ${getMD3ColorTokens()}
        * { box-sizing: border-box; }
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--md-sys-color-background);
            margin: 0;
            font-family: 'Roboto', 'Helvetica', 'Arial', sans-serif;
            transition: background 0.3s ease;
        }
        .login-container {
            width: 100%;
            max-width: 420px;
            background: var(--md-sys-color-surface);
            border-radius: var(--md-sys-shape-corner-extra-large);
            box-shadow: 0 1px 3px 1px rgba(0,0,0,0.15), 0 1px 2px 0 rgba(0,0,0,0.3);
            overflow: hidden;
            transition: box-shadow 0.3s ease, transform 0.3s ease;
            animation: slideInUp 0.6s ease;
        }
        .login-container:hover {
            box-shadow: 0 4px 6px 2px rgba(0,0,0,0.15), 0 2px 3px 0 rgba(0,0,0,0.3);
            transform: translateY(-4px);
        }
        .login-header {
            background: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
            padding: 40px 32px;
            text-align: center;
        }
        .logo { margin-bottom: 20px; display: flex; justify-content: center; }
        .logo-icon {
            background: var(--md-sys-color-primary-container);
            color: var(--md-sys-color-on-primary-container);
            border-radius: 50%;
            padding: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s ease;
            position: relative;
            overflow: hidden;
        }
        .logo-icon::before {
            content: '';
            position: absolute;
            inset: 0;
            background: currentColor;
            opacity: 0;
            transition: opacity 0.2s ease;
            pointer-events: none;
            border-radius: 50%;
        }
        .logo-icon:hover::before { opacity: 0.08; }
        .logo-icon:hover { transform: scale(1.05); }
        .login-body { padding: 32px; }
        .error-message {
            margin-bottom: 24px;
            padding: 12px 16px;
            border-radius: var(--md-sys-shape-corner-small);
            background: var(--md-sys-color-error-container);
            color: var(--md-sys-color-on-error-container);
            font-size: 14px;
            line-height: 1.5;
        }
        .form-group { margin-bottom: 24px; }
        .form-group md-outlined-text-field { width: 100%; }
        .form-actions { margin-top: 32px; }
        .form-actions md-filled-button {
            width: 100%;
            --md-filled-button-container-shape: var(--md-sys-shape-corner-full);
            height: 56px;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            position: relative;
            overflow: hidden;
        }
        .form-actions md-filled-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }
        .form-actions md-filled-button:active {
            transform: translateY(0);
            transition: transform 0.1s ease;
        }
        /* 波纹效果 */
        .ripple {
            position: absolute;
            border-radius: 50%;
            background: rgba(255,255,255,0.5);
            transform: scale(0);
            animation: ripple 0.6s ease-out;
            pointer-events: none;
        }
        .footer {
            text-align: center;
            margin-top: 24px;
            font-size: 14px;
            color: var(--md-sys-color-on-surface-variant);
        }
        .footer a {
            color: var(--md-sys-color-primary);
            text-decoration: none;
            font-weight: 500;
        }
        .footer a:hover {
            text-decoration: underline;
        }
        @media (max-width: 480px) {
            body { padding: 0; }
            .login-container { 
                margin: 0; 
                border-radius: 0; 
                max-width: 100%; 
                height: 100vh; 
                display: flex; 
                flex-direction: column; 
                box-shadow: none;
            }
            .login-header { padding: 24px 20px; }
            .login-body { padding: 20px; flex: 1; }
            .form-actions { 
                margin-top: auto; 
                padding-top: 20px;
            }
            .material-symbols-outlined {
                font-size: 20px;
            }
        }
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
    </style>
</head>
<body>
    <div style="position: fixed; top: 16px; right: 16px; z-index: 100;">
        <md-filled-icon-button data-dark-toggle aria-label="切换到深色模式" onclick="toggleDarkMode()">
          <md-icon>routine</md-icon>
        </md-filled-icon-button>
    </div>
    <div class="login-container">
        <div class="login-header">
            <div class="logo">
                <div class="logo-icon">
                    <span class="material-symbols-outlined" style="font-size: 48px;">person_add</span>
                </div>
            </div>
            <h1 class="md-typescale-headline-medium">GitHub文件管理器</h1>
            <p class="md-typescale-body-large">创建新账户以使用系统</p>
        </div>
        ${error ? `<div class="error-message" role="alert">${error}</div>` : ''}
        <div class="login-body">
            <form id="registerForm" method="POST" action="/api/register">
                <div class="form-group">
                    <md-outlined-text-field label="用户名" type="text" name="username" id="username" required>
                        <span slot="leading-icon" class="material-symbols-outlined">person</span>
                    </md-outlined-text-field>
                </div>
                <div class="form-group">
                    <md-outlined-text-field label="密码" type="password" name="password" id="password" required>
                        <span slot="leading-icon" class="material-symbols-outlined">lock</span>
                    </md-outlined-text-field>
                </div>
                <div class="form-group">
                    <md-outlined-text-field label="确认密码" type="password" name="confirmPassword" id="confirmPassword" required>
                        <span slot="leading-icon" class="material-symbols-outlined">lock</span>
                    </md-outlined-text-field>
                </div>
                <div class="form-actions">
                    <md-filled-button type="submit">
                        <span slot="icon" class="material-symbols-outlined">person_add</span>
                        注册
                    </md-filled-button>
                </div>
                <div class="footer">
                    <p>已有账号？<a href="/login">去登录</a></p>
                </div>
            </form>
        </div>
    </div>
    <script>
    ${getMessageHelper()}
    ${getDynamicColorScript()}
        document.getElementById('registerForm').addEventListener('submit', function(e) {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            if (!username || !password || !confirmPassword) {
                e.preventDefault();
                showMessage('请填写所有必填项', true);
            } else if (password !== confirmPassword) {
                e.preventDefault();
                showMessage('两次输入的密码不一致', true);
            }
        });
        window.onload = function() {
            document.getElementById('username').focus();
            restoreThemeColor();
        };
    </script>
</body>
</html>
  `;
}

// 登录处理函数
async function handleLogin(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  
  try {
    const formData = await request.formData();
    
    const rateLimited = await checkRateLimit(env, 'login', request);
    if (!rateLimited) {
      return new Response(getLoginHTML('登录尝试次数过多，请15分钟后再试'), { status: 429, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    
    const username = formData.get('username');
    const password = formData.get('password');
    
    await recordAttempt(env, 'login', request);
    
    const userStr = await env.KV.get('user:' + username);
    if (!userStr) {
      return new Response(getLoginHTML('用户名或密码错误'), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    
    const userData = JSON.parse(userStr);
    const passwordMatch = await verifyPassword(password, userData.passwordHash);
    
    if (!passwordMatch) {
      return new Response(getLoginHTML('用户名或密码错误'), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    
    userData.lastLogin = new Date().toISOString();
    await env.KV.put('user:' + username, JSON.stringify(userData));
    
    const oldCookie = request.headers.get('Cookie');
    if (oldCookie) {
        const cookies = new Map(oldCookie.split(';').map(c => {
            const [key, value] = c.trim().split('=');
            return [key, value];
        }));
        const oldToken = cookies.get('session_token');
        if (oldToken) await env.KV.delete('session:' + oldToken);
    }
    
    const response = new Response(null, { status: 302, headers: { 'Location': '/' } });
    return setSessionCookie(response, env, username);
    
  } catch (error) {
    console.error('登录错误:', error);
    return new Response(getLoginHTML('登录请求处理失败'), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

// 注册处理函数
async function handleRegister(request, env) {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
        const formData = await request.formData();
        
        const rateLimited = await checkRateLimit(env, 'register', request);
        if (!rateLimited) {
            return new Response(getRegisterHTML('注册尝试次数过多，请15分钟后再试'), { status: 429, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        
        const username = formData.get('username');
        const password = formData.get('password');
        const confirmPassword = formData.get('confirmPassword');

        await recordAttempt(env, 'register', request);

        if (!username || !password || !confirmPassword) {
            return new Response(getRegisterHTML('请填写所有必填项'), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        if (username.length < 3 || username.length > 20) {
            return new Response(getRegisterHTML('用户名长度需为3-20个字符'), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        if (password.length < 6) {
            return new Response(getRegisterHTML('密码长度至少6位'), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        if (password !== confirmPassword) {
            return new Response(getRegisterHTML('两次输入的密码不一致'), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return new Response(getRegisterHTML('用户名只能包含字母、数字和下划线'), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        const existingUser = await env.KV.get('user:' + username);
        if (existingUser) {
            return new Response(getRegisterHTML('用户名已存在，请选择其他用户名'), { status: 409, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        const passwordHash = await hashPassword(password);
        const userData = JSON.stringify({
            passwordHash: passwordHash,
            createdAt: new Date().toISOString(),
            lastLogin: null
        });

        await env.KV.put('user:' + username, userData);

        const response = new Response(null, { status: 302, headers: { 'Location': '/login?registered=1' } });
        return response;

    } catch (error) {
        console.error('注册错误:', error);
        return new Response(getRegisterHTML('注册请求处理失败'), { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
}

// 登出处理函数
async function handleLogout(request, env) {
  const response = new Response(null, {
    status: 302,
    headers: { 'Location': '/login' }
  });
  return clearSessionCookie(response, request, env);
}

// 获取文件列表
async function getFiles(githubConfig, pathConfig) {
  try {
    const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = githubConfig;
    const path = pathConfig.path || '';
    
    // 编码路径
    const encodedPath = encodeGitHubPath(path);
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}?ref=${GITHUB_BRANCH}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Cloudflare-Worker'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({ 
        error: `GitHub API错误: ${response.status} - ${errorText}` 
      }), { 
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const files = await response.json();
    
    // 过滤出文件（排除文件夹）
    const fileList = Array.isArray(files) 
      ? files.filter(item => item.type === 'file').map(item => ({
          name: item.name,
          path: item.path,
          size: item.size,
          download_url: item.download_url,
          sha: item.sha
        }))
      : [];
    
    return new Response(JSON.stringify({ files: fileList }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('获取文件列表错误:', error);
    return new Response(JSON.stringify({ 
      error: `服务器错误: ${error.message}` 
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 上传文件
async function uploadFile(request, githubConfig, pathConfig) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const filename = formData.get('filename') || file.name;
    
    if (!file) {
      return new Response(JSON.stringify({ error: '未选择文件' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // GitHub API 文件大小限制检查
    const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
    if (file.size > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ 
        error: '文件大小超过 GitHub API 限制 (25MB)' 
      }), { 
        status: 413,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = githubConfig;
    const basePath = pathConfig.path || '';
    const filePath = basePath ? `${basePath}/${filename}` : filename;
    
    // 读取文件内容并编码为Base64
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binaryString = '';
    for (let i = 0; i < uint8Array.length; i++) {
        binaryString += String.fromCharCode(uint8Array[i]);
    }
    const content = btoa(binaryString);
    
    // 编码文件路径
    const encodedFilePath = encodeGitHubPath(filePath);
    
    // 检查文件是否已存在
    const checkUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedFilePath}?ref=${GITHUB_BRANCH}`;
    const checkResponse = await fetch(checkUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Cloudflare-Worker'
      }
    });
    
    let sha = null;
    let fileExists = false;
    if (checkResponse.status === 200) {
      const existingFile = await checkResponse.json();
      sha = existingFile.sha;
      fileExists = true;
    }
    
    // 上传文件
    const uploadUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedFilePath}`;
    const uploadData = {
      message: fileExists ? `Update file: ${filename}` : `Upload file: ${filename}`,
      content: content,
      branch: GITHUB_BRANCH
    };
    
    if (sha) {
      uploadData.sha = sha;
    }
    
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Cloudflare-Worker'
      },
      body: JSON.stringify(uploadData)
    });
    
    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.text();
      return new Response(JSON.stringify({ 
        error: `上传失败: ${uploadResponse.status} - ${errorData}` 
      }), { 
        status: uploadResponse.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: fileExists ? '文件更新成功' : '文件上传成功' 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('上传文件错误:', error);
    return new Response(JSON.stringify({ 
      error: `上传错误: ${error.message}` 
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 删除文件
async function deleteFile(request, githubConfig, pathConfig) {
  try {
    const { filePath, sha } = await request.json();
    
    if (!filePath || !sha) {
      return new Response(JSON.stringify({ error: '缺少必要参数' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = githubConfig;
    
    // 编码文件路径
    const encodedFilePath = encodeGitHubPath(filePath);
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedFilePath}`;
    
    const deleteData = {
      message: `Delete file: ${filePath.split('/').pop()}`,
      sha: sha,
      branch: GITHUB_BRANCH
    };
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Cloudflare-Worker'
      },
      body: JSON.stringify(deleteData)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({ 
        error: `删除失败: ${response.status} - ${errorText}` 
      }), { 
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: '文件删除成功' 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('删除文件错误:', error);
    return new Response(JSON.stringify({ 
      error: `删除错误: ${error.message}` 
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 修改文件
async function updateFile(request, githubConfig, pathConfig) {
  try {
    const { filePath, sha, content, message } = await request.json();
    
    if (!filePath || !sha || !content) {
      return new Response(JSON.stringify({ error: '缺少必要参数' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = githubConfig;
    
    // 编码文件路径
    const encodedFilePath = encodeGitHubPath(filePath);
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedFilePath}`;
    
    // 将内容转换为Base64（正确处理中文）
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    let binaryString = '';
    for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i]);
    }
    const contentBase64 = btoa(binaryString);
    
    const updateData = {
      message: message || `Update file: ${filePath.split('/').pop()}`,
      content: contentBase64,
      sha: sha,
      branch: GITHUB_BRANCH
    };
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Cloudflare-Worker'
      },
      body: JSON.stringify(updateData)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({ 
        error: `修改失败: ${response.status} - ${errorText}` 
      }), { 
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: '文件修改成功' 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('修改文件错误:', error);
    return new Response(JSON.stringify({ 
      error: `修改错误: ${error.message}` 
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 下载代理
async function downloadProxy(request, githubConfig) {
  try {
    const url = new URL(request.url);
    const filePath = url.searchParams.get('path');
    const previewMode = url.searchParams.get('preview') === 'true';
    
    if (!filePath) {
      return new Response('缺少文件路径参数', { status: 400 });
    }
    
    const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = githubConfig;
    
    // 使用GitHub API获取文件内容
    const encodedFilePath = encodeGitHubPath(filePath);
    const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedFilePath}?ref=${GITHUB_BRANCH}`;
    
    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Cloudflare-Worker'
      }
    });
    
    if (!response.ok) {
      return new Response(`下载失败: ${response.status}`, { 
        status: response.status 
      });
    }
    
    const data = await response.json();
    
    if (!data.content) {
      return new Response('文件内容为空', { status: 404 });
    }
    
    // 根据文件扩展名设置正确的Content-Type
    const getContentType = (filename) => {
      const extension = filename.split('.').pop().toLowerCase();
      const typeMap = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'bmp': 'image/bmp',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'pdf': 'application/pdf',
        'txt': 'text/plain',
        'md': 'text/markdown',
        'html': 'text/html',
        'htm': 'text/html',
        'xml': 'application/xml',
        'json': 'application/json',
        'csv': 'text/csv',
        'log': 'text/plain',
        'js': 'application/javascript',
        'css': 'text/css',
        'py': 'text/x-python',
        'java': 'text/x-java',
        'cpp': 'text/x-c++',
        'c': 'text/x-c'
      };
      return typeMap[extension] || 'application/octet-stream';
    };
    
    const filename = filePath.split('/').pop();
    const contentType = getContentType(filename);
    
    // 解码Base64内容
    const base64Content = data.content.replace(/\s/g, '');
    const binaryString = atob(base64Content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // 判断是否为文本文件
    const isTextFile = contentType.startsWith('text/') || 
                       contentType === 'application/json' ||
                       contentType === 'application/javascript' ||
                       contentType === 'text/markdown';
    
    let responseContent;
    if (isTextFile) {
      // 文本文件：解码为UTF-8字符串
      const decoder = new TextDecoder('utf-8');
      responseContent = decoder.decode(bytes);
    } else {
      // 二进制文件：直接返回字节数组
      responseContent = bytes;
    }
    
    // 设置响应头
    const headers = {
      'Content-Type': contentType
    };
    
    if (previewMode) {
      headers['Content-Disposition'] = 'inline';
    } else {
      // 使用RFC 5987标准处理中文文件名
      const encodedFilename = encodeURIComponent(filename);
      headers['Content-Disposition'] = `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`;
    }
    
    return new Response(responseContent, { headers });
    
  } catch (error) {
    console.error('下载错误:', error);
    return new Response(`下载错误: ${error.message}`, { status: 500 });
  }
}

// HTML转义函数
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// 设置页面HTML
function getSettingsHTML(username, error = '', isFirst = false) {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    ${getMaterialWebHead('GitHub文件管理器 - 配置设置')}
    <style>
    ${getMD3ColorTokens()}
        * { box-sizing: border-box; }
        body {
            font-family: 'Roboto', 'Helvetica', 'Arial', sans-serif;
            line-height: 1.6;
            min-height: 100vh;
            margin: 0;
            background-color: var(--md-sys-color-background);
            color: var(--md-sys-color-on-background);
        }
        .container { max-width: 800px; margin: 0 auto; padding: 20px; }
        .card {
            background: var(--md-sys-color-surface);
            border-radius: var(--md-sys-shape-corner-extra-large);
            box-shadow: 0 1px 3px 1px rgba(0,0,0,0.15), 0 1px 2px 0 rgba(0,0,0,0.3);
            overflow: hidden;
        }
        .card-header {
            background: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
            padding: 32px;
            text-align: left;
            position: relative;
        }
        .header-actions {
            position: absolute;
            top: 16px;
            right: 16px;
            display: flex;
            gap: 8px;
        }
        .card-body { padding: 40px; }
        .form-section { margin-bottom: 32px; }
        .section-title {
            font-size: 18px;
            font-weight: 600;
            color: var(--md-sys-color-on-surface);
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .form-group { margin-bottom: 24px; }
        .form-group md-outlined-text-field { width: 100%; }
        .path-list { margin-top: 16px; }
        .path-item {
            display: flex;
            gap: 12px;
            align-items: flex-start;
            margin-bottom: 16px;
            padding: 16px;
            background: var(--md-sys-color-surface-container-low);
            border-radius: var(--md-sys-shape-corner-large);
            border: 1px solid var(--md-sys-color-outline-variant);
        }
        .path-item md-outlined-text-field { flex: 1; }
        .path-item .delete-btn {
            flex-shrink: 0;
            margin-top: 8px;
        }
        .add-path-btn {
            margin-top: 16px;
            width: 100%;
        }
        .form-actions {
            margin-top: 32px;
            display: flex;
            gap: 16px;
            justify-content: flex-end;
        }
        .error-message {
            margin-bottom: 24px;
            padding: 12px 16px;
            border-radius: var(--md-sys-shape-corner-small);
            background: var(--md-sys-color-error-container);
            color: var(--md-sys-color-on-error-container);
            font-size: 14px;
            line-height: 1.5;
        }
        .success-message {
            margin-bottom: 24px;
            padding: 12px 16px;
            border-radius: var(--md-sys-shape-corner-small);
            background: var(--md-sys-color-primary-container);
            color: var(--md-sys-color-on-primary-container);
            font-size: 14px;
            line-height: 1.5;
        }
        @media (max-width: 768px) {
            .container { padding: 16px; }
            .card-header { padding: 20px; }
            .card-body { padding: 24px; }
            .path-item { flex-direction: column; }
            .path-item .delete-btn { margin-top: 0; }
            .form-actions { flex-direction: column; }
        }
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="card-header">
                <h1 class="md-typescale-headline-medium"><b>GitHub 配置设置</b></h1>
                <p class="md-typescale-body-large">配置您的 GitHub 仓库连接信息</p>
                <div class="header-actions">
                    <md-elevated-button data-dark-toggle aria-label="切换到深色模式" onclick="toggleDarkMode()">
                        <span slot="icon" class="material-symbols-outlined">routine</span>
                        切换模式
                    </md-elevated-button>
                    <md-elevated-button onclick="window.location.href='/';">
                        <span slot="icon" class="material-symbols-outlined">arrow_back</span>
                        返回
                    </md-elevated-button>
                </div>
            </div>
            <div class="card-body">
                ${isFirst ? `<div style="margin-bottom: 24px; padding: 16px 20px; border-radius: var(--md-sys-shape-corner-medium); background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); font-size: 15px; line-height: 1.6;">
                    <strong>欢迎使用！</strong>请先完成 GitHub API 配置以开始使用。
                </div>` : ''}
                ${error ? `<div class="error-message" role="alert">${error}</div>` : ''}
                <div id="messageArea"></div>
                <form id="settingsForm" method="POST" action="/api/config">
                    <div class="form-section">
                        <h2 class="section-title">
                            <span class="material-symbols-outlined">link</span>
                            GitHub 连接配置
                        </h2>
                        <div class="form-group">
                            <md-outlined-text-field label="GITHUB_TOKEN" type="password" name="github_token" id="github_token">
                                <span slot="leading-icon" class="material-symbols-outlined">vpn_key</span>
                            </md-outlined-text-field>
                            <div style="margin-top: 12px; display: flex; gap: 12px; align-items: center;">
                                <md-outlined-button type="button" onclick="verifyToken()" id="verifyBtn">
                                    <span slot="icon" class="material-symbols-outlined">verified_user</span>
                                    验证Token
                                </md-outlined-button>
                                <div id="tokenStatus"></div>
                            </div>
                        </div>
                        <div id="githubUserInfo" style="display: none; margin-bottom: 24px; padding: 16px; border-radius: var(--md-sys-shape-corner-medium); background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container);">
                            <div style="display: flex; align-items: center; gap: 16px;">
                                <img id="githubAvatar" src="" alt="Avatar" style="width: 48px; height: 48px; border-radius: 50%;">
                                <div>
                                    <div id="githubName" style="font-weight: 600; font-size: 16px;"></div>
                                    <div id="githubUsername" style="font-size: 14px; opacity: 0.8;"></div>
                                </div>
                            </div>
                        </div>
                        <div class="form-group">
                            <md-outlined-text-field label="GITHUB_OWNER" name="github_owner" id="github_owner">
                                <span slot="leading-icon" class="material-symbols-outlined">account_circle</span>
                            </md-outlined-text-field>
                        </div>
                        <div class="form-group">
                            <md-outlined-text-field label="GITHUB_REPO" name="github_repo" id="github_repo">
                                <span slot="leading-icon" class="material-symbols-outlined">folder</span>
                            </md-outlined-text-field>
                        </div>
                        <div class="form-group">
                            <md-outlined-text-field label="GITHUB_BRANCH" name="github_branch" id="github_branch" value="main">
                                <span slot="leading-icon" class="material-symbols-outlined">call_split</span>
                            </md-outlined-text-field>
                        </div>
                    </div>

                    <div class="form-section">
                        <h2 class="section-title">
                            <span class="material-symbols-outlined">route</span>
                            路径配置
                        </h2>
                        <div id="pathList" class="path-list"></div>
                        <md-outlined-button type="button" class="add-path-btn" onclick="addPathRow()">
                            <span slot="icon" class="material-symbols-outlined">add</span>
                            添加路径
                        </md-outlined-button>
                    </div>

                    <div class="form-actions">
                        <md-outlined-button type="button" onclick="window.location.href='/';">
                            取消
                        </md-outlined-button>
                        <md-filled-button type="submit" id="saveBtn">
                            <span slot="icon" class="material-symbols-outlined">save</span>
                            保存配置
                        </md-filled-button>
                    </div>
                </form>
            </div>
        </div>
    </div>

    <script>
    ${getMessageHelper()}
    ${getDynamicColorScript()}

        let pathCounter = 0;

        function createPathRow(index, pathValue = '', pathName = '') {
            const div = document.createElement('div');
            div.className = 'path-item';
            div.id = 'path_' + index;
            div.innerHTML = 
                '<md-outlined-text-field label="路径值" name="path_' + index + '" value="' + escapeHtml(pathValue) + '">' +
                    '<span slot="leading-icon" class="material-symbols-outlined">folder_open</span>' +
                '</md-outlined-text-field>' +
                '<md-outlined-text-field label="显示名称" name="pathname_' + index + '" value="' + escapeHtml(pathName) + '" style="flex: 0.8;">' +
                    '<span slot="leading-icon" class="material-symbols-outlined">label</span>' +
                '</md-outlined-text-field>' +
                '<md-icon-button class="delete-btn" onclick="removePathRow(' + index + ')">' +
                    '<md-icon>delete</md-icon>' +
                '</md-icon-button>';
            return div;
        }

        function addPathRow(pathValue = '', pathName = '') {
            pathCounter++;
            const container = document.getElementById('pathList');
            const row = createPathRow(pathCounter, pathValue, pathName);
            container.appendChild(row);
        }

        function removePathRow(index) {
            const row = document.getElementById('path_' + index);
            if (row) {
                row.remove();
            }
        }

        function escapeHtml(str) {
            if (!str) return '';
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        function loadConfig() {
            fetch('/api/config')
                .then(response => response.json())
                .then(data => {
                    if (data.error) {
                        showMessage('加载配置失败: ' + data.error, true);
                        return;
                    }
                    if (data.config) {
                        document.getElementById('github_token').value = data.config.GITHUB_TOKEN || '';
                        document.getElementById('github_owner').value = data.config.GITHUB_OWNER || '';
                        document.getElementById('github_repo').value = data.config.GITHUB_REPO || '';
                        document.getElementById('github_branch').value = data.config.GITHUB_BRANCH || 'main';
                        
                        if (data.config.paths && data.config.paths.length > 0) {
                            data.config.paths.forEach(function(p) {
                                addPathRow(p.path, p.name);
                            });
                        } else {
                            addPathRow('', '');
                        }
                    } else {
                        addPathRow('', '');
                    }
                })
                .catch(error => {
                    console.error('加载配置失败:', error);
                    showMessage('加载配置失败: ' + error.message, true);
                    addPathRow('', '');
                });
        }

        function verifyToken() {
            const token = document.getElementById('github_token').value;
            if (!token) {
                document.getElementById('tokenStatus').innerHTML = '<span style="color: var(--md-sys-color-error);">请先输入Token</span>';
                return;
            }
            
            const verifyBtn = document.getElementById('verifyBtn');
            verifyBtn.disabled = true;
            verifyBtn.innerHTML = '<span slot="icon" class="material-symbols-outlined">hourglass_empty</span>验证中...';
            
            const formData = new FormData();
            formData.append('token', token);
            
            fetch('/api/verify-token', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                verifyBtn.disabled = false;
                verifyBtn.innerHTML = '<span slot="icon" class="material-symbols-outlined">verified_user</span>验证Token';
                
                if (data.valid) {
                    document.getElementById('tokenStatus').innerHTML = '<span style="color: var(--md-sys-color-primary);">Token有效</span>';
                    document.getElementById('githubAvatar').src = data.avatar;
                    document.getElementById('githubName').textContent = data.name;
                    document.getElementById('githubUsername').textContent = '@' + data.username;
                    document.getElementById('githubUserInfo').style.display = 'block';
                    
                    // 自动填充owner
                    if (!document.getElementById('github_owner').value) {
                        document.getElementById('github_owner').value = data.username;
                    }
                } else {
                    document.getElementById('tokenStatus').innerHTML = '<span style="color: var(--md-sys-color-error);"> ' + (data.error || 'Token无效') + '</span>';
                    document.getElementById('githubUserInfo').style.display = 'none';
                }
            })
            .catch(error => {
                verifyBtn.disabled = false;
                verifyBtn.innerHTML = '<span slot="icon" class="material-symbols-outlined">verified_user</span>验证Token';
                document.getElementById('tokenStatus').innerHTML = '<span style="color: var(--md-sys-color-error);">验证失败: ' + error.message + '</span>';
            });
        }

        document.getElementById('settingsForm').addEventListener('submit', function(e) {
            e.preventDefault();

            const saveBtn = document.getElementById('saveBtn');
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span slot="icon" class="material-symbols-outlined">save</span>保存中...';

            const formData = new FormData(this);

            fetch('/api/config', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<span slot="icon" class="material-symbols-outlined">save</span>保存配置';

                const messageArea = document.getElementById('messageArea');
                if (data.success) {
                    messageArea.innerHTML = '<div class="success-message">' + data.message + '</div>';
                    setTimeout(() => { messageArea.innerHTML = ''; }, 5000);
                } else {
                    messageArea.innerHTML = '<div class="error-message">' + (data.error || '保存失败') + '</div>';
                }
            })
            .catch(error => {
                console.error('保存配置失败:', error);
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<span slot="icon" class="material-symbols-outlined">save</span>保存配置';
                
                const messageArea = document.getElementById('messageArea');
                messageArea.innerHTML = '<div class="error-message">保存配置失败: ' + error.message + '</div>';
            });
        });

        window.onload = function() {
            restoreThemeColor();
            loadConfig();
        };
    </script>
</body>
</html>`;
}

// 配置获取API处理函数
async function handleGetConfig(request, env) {
    const username = await verifySession(request, env);
    if (!username) return new Response(JSON.stringify({ error: '未认证' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    
    try {
        const configStr = await env.KV.get('config:' + username);
        if (!configStr) {
            return new Response(JSON.stringify({ config: null }), { headers: { 'Content-Type': 'application/json' } });
        }
        
        const encryptedData = JSON.parse(configStr);
        const config = await decryptConfig(encryptedData);
        
        return new Response(JSON.stringify({ config: config }), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error('获取配置错误:', error);
        return new Response(JSON.stringify({ error: '获取配置失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

// 配置保存API处理函数
async function handleSaveConfig(request, env) {
    const username = await verifySession(request, env);
    if (!username) return new Response(JSON.stringify({ error: '未认证' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    
    try {
        const formData = await request.formData();
        
        // 收集基本配置
        const config = {
            GITHUB_TOKEN: formData.get('github_token') || '',
            GITHUB_OWNER: formData.get('github_owner') || '',
            GITHUB_REPO: formData.get('github_repo') || '',
            GITHUB_BRANCH: formData.get('github_branch') || 'main',
            paths: []
        };
        
        // 收集PATH配置
        let i = 1;
        while (formData.get('path_' + i)) {
            config.paths.push({
                path: formData.get('path_' + i),
                name: formData.get('pathname_' + i) || ('路径' + i)
            });
            i++;
        }
        
        // 加密存储
        const encrypted = await encryptConfig(config);
        await env.KV.put('config:' + username, JSON.stringify(encrypted));
        
        return new Response(JSON.stringify({ success: true, message: '配置保存成功' }), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error('保存配置错误:', error);
        return new Response(JSON.stringify({ error: '保存配置失败: ' + error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

// 验证GitHub Token API
async function handleVerifyToken(request, env) {
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }
    
    try {
        const formData = await request.formData();
        const token = formData.get('token');
        
        if (!token) {
            return new Response(JSON.stringify({ error: '请提供Token' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        // 调用GitHub API验证Token
        const response = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Cloudflare-Worker'
            }
        });
        
        if (!response.ok) {
            return new Response(JSON.stringify({ error: 'Token无效或已过期', valid: false }), { 
                status: 200, 
                headers: { 'Content-Type': 'application/json' } 
            });
        }
        
        const user = await response.json();
        
        return new Response(JSON.stringify({
            valid: true,
            username: user.login,
            avatar: user.avatar_url,
            name: user.name || user.login,
            bio: user.bio || ''
        }), { 
            headers: { 'Content-Type': 'application/json' } 
        });
        
    } catch (error) {
        console.error('验证Token错误:', error);
        return new Response(JSON.stringify({ error: '验证失败: ' + error.message }), { 
            status: 500, 
            headers: { 'Content-Type': 'application/json' } 
        });
    }
}

// 路径选择界面
function getPathSelectionHTML(pathConfigs) {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    ${getMaterialWebHead('GitHub文件管理器 - 选择路径')}
    <style>
    ${getMD3ColorTokens()}
        * { box-sizing: border-box; }
        body {
            font-family: 'Roboto', 'Helvetica', 'Arial', sans-serif;
            line-height: 1.6;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            background-color: var(--md-sys-color-background);
            color: var(--md-sys-color-on-background);
        }
        .container { max-width: 1200px; width: 100%; margin: 0 auto; padding: 20px; }
        .card {
            background: var(--md-sys-color-surface);
            border-radius: var(--md-sys-shape-corner-extra-large);
            box-shadow: 0 1px 3px 1px rgba(0,0,0,0.15), 0 1px 2px 0 rgba(0,0,0,0.3);
            overflow: hidden;
        }
        .card-header {
            background: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
            padding: 32px;
            text-align: left;
            position: relative;
        }
        .header-actions {
            position: absolute;
            top: 16px;
            right: 16px;
            display: flex;
            gap: 8px;
        }
        .card-body { padding: 40px; }
        .path-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 24px;
            justify-content: center;
            max-width: 1200px;
            margin: 0 auto;
        }
        .path-card {
            background: var(--md-sys-color-surface-container-low);
            padding: 32px;
            border-radius: var(--md-sys-shape-corner-extra-large);
            box-shadow: 0 1px 2px 0 rgba(0,0,0,0.3), 0 1px 3px 1px rgba(0,0,0,0.15);
            transition: box-shadow 0.2s ease, transform 0.2s ease;
            border: 1px solid var(--md-sys-color-outline-variant);
            aspect-ratio: 1;
            display: flex;
            flex-direction: column;
            position: relative;
            overflow: hidden;
            max-width: 350px;
            max-height: 350px;
            justify-self: center;
            width: 100%;
        }
        .path-card::before {
            content: '';
            position: absolute;
            inset: 0;
            background: var(--md-sys-color-primary);
            opacity: 0;
            transition: opacity 0.2s ease;
            pointer-events: none;
        }
        .path-card:hover::before { opacity: 0.12; }
        .path-card.selected {
            background: var(--md-sys-color-primary-container);
            border-color: var(--md-sys-color-primary);
        }
        .path-card.selected::before { display: none; }
        .path-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 2px 6px 2px rgba(0,0,0,0.15), 0 1px 2px 0 rgba(0,0,0,0.3);
            border-color: var(--md-sys-color-primary);
        }
        .path-card:active { transform: translateY(-1px); }
        .path-icon {
            margin-bottom: 20px;
            display: inline-flex;
            background: var(--md-sys-color-secondary);
            color: var(--md-sys-color-on-secondary);
            border-radius: var(--md-sys-shape-corner-large);
            padding: 16px;
            transition: transform 0.2s ease;
        }
        .path-card:hover .path-icon { transform: scale(1.05); }
        .path-name {
            font-weight: 600;
            margin-bottom: 12px;
            color: var(--md-sys-color-on-surface);
        }
        .path-info {
            font-size: 14px;
            color: var(--md-sys-color-on-surface-variant);
            margin-bottom: 24px;
            flex: 1;
        }
        .path-card md-filled-button {
            --md-filled-button-container-shape: var(--md-sys-shape-corner-full);
        }
        .theme-color-input {
            display: flex;
            align-items: center;
            gap: 16px;
            margin: 24px 0;
        }
        .color-preview {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            border: 2px solid var(--md-sys-color-outline-variant);
            cursor: pointer;
            transition: border-color 0.2s ease;
        }
        /* 主题对话框最小宽度和移动端适配 */
        #themeDialog {
            --md-dialog-container-min-width: 420px;
        }
        @media (max-width: 480px) {
            #themeDialog {
                --md-dialog-container-min-width: 90vw;
                --md-dialog-container-max-width: 90vw;
            }
            .theme-color-input {
                flex-direction: column;
                align-items: flex-start;
            }
            .color-preview {
                width: 80px;
                height: 80px;
            }
        }
        .color-preview:hover { border-color: var(--md-sys-color-outline); }
        .color-input { flex: 1; }
        .color-input input[type="color"] {
            width: 100%;
            height: 48px;
            border: none;
            border-radius: var(--md-sys-shape-corner-medium);
            cursor: pointer;
            padding: 4px;
        }
        @media (max-width: 480px) {
            .container { padding: 12px; }
            .card-header { padding: 10px;}
            .card-body { padding: 20px; }
            .path-card { padding: 20px; }
            .header-actions { 
                position: static;
                margin-top: 12px;
                flex-direction: row; 
                gap: 8px;
                flex-wrap: wrap;
                justify-content: center;
            }
            .md-typescale-headline-medium { font-size: 20px; }
        }
            .material-symbols-outlined {
    font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="card-header">
                <h1 class="md-typescale-headline-medium"><b>GitHub文件管理器</b></h1>
                <p class="md-typescale-body-large">请选择要管理的文件夹路径</p>
                <div class="header-actions">
                    <md-elevated-button data-dark-toggle aria-label="切换到深色模式" onclick="toggleDarkMode()">
                        <span slot="icon" class="material-symbols-outlined">routine</span>
                        切换模式
                    </md-elevated-button>
                    <md-elevated-button onclick="openThemeDialog()">
                        <span slot="icon" class="material-symbols-outlined">palette</span>
                        主题色
                    </md-elevated-button>
                    <md-elevated-button onclick="window.location.href='/settings'">
                        <span slot="icon" class="material-symbols-outlined">settings</span>
                        设置
                    </md-elevated-button>
                    <md-elevated-button onclick="logout()">
                        <span slot="icon" class="material-symbols-outlined">logout</span>
                        登出
                    </md-elevated-button>
                </div>
            </div>
            <div class="card-body">
                <div class="path-grid">
                    ${pathConfigs.map((config) => `
                        <div class="path-card">
                            <div class="path-icon">
                                <span class="material-symbols-outlined" style="font-size: 48px;">folder</span>
                            </div>
                            <h3 class="md-typescale-title-large path-name">${escapeHtml(config.displayName)}</h3>
                            <p class="md-typescale-body-medium path-info">路径: ${escapeHtml(config.path || '根目录')}</p>
                            <md-filled-button href="/${config.name}" trailing-icon>
                                进入管理
                                <span slot="icon" class="material-symbols-outlined">arrow_forward</span>
                            </md-filled-button>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    </div>

    <md-dialog id="themeDialog">
        <div slot="headline">设置主题色</div>
        <div slot="content">
            <p>请选择颜色&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;</p>
            <div class="theme-color-input">
                <div class="color-preview" id="colorPreview" style="background: var(--md-sys-color-primary);" onclick="document.getElementById('colorInput').click()"></div>
                <div class="color-input">
                    <label for="colorInput" style="font-size: 14px; color: var(--md-sys-color-on-surface-variant); display: block; margin-bottom: 8px;">选择主题色</label>
                    <input type="color" id="colorInput" value="#1e40af" onchange="updateColorPreview()">
                </div>
            </div>
            <div style="margin-top: 20px;">
                <p style="font-size: 14px; color: var(--md-sys-color-on-surface-variant); margin-bottom: 12px;">或从图片中提取主题色：</p>
                <md-outlined-button onclick="document.getElementById('imageInput').click()">
                    <span slot="icon" class="material-symbols-outlined">photo_library</span>
                    选择图片
                </md-outlined-button>
                <input type="file" id="imageInput" accept="image/*" style="display: none;" onchange="extractColorFromImage(event)">
                <canvas id="colorCanvas" style="display: none;"></canvas>
            </div>
        </div>
        <div slot="actions">
            <md-text-button onclick="document.getElementById('themeDialog').close()">取消</md-text-button>
            <md-filled-button onclick="applyTheme()">应用</md-filled-button>
        </div>
    </md-dialog>

    <!-- 登出确认对话框 -->
    <md-dialog id="logoutDialog" type="alert">
        <div slot="headline">确认登出</div>
        <form slot="content" id="logout-form" method="dialog">
            确定要登出吗？
        </form>
        <div slot="actions">
            <md-text-button form="logout-form" value="cancel">取消</md-text-button>
            <md-text-button form="logout-form" value="logout">登出</md-text-button>
        </div>
    </md-dialog>

    <script>
    ${getMessageHelper()}
    ${getDynamicColorScript()}

        function logout() {
            const dialog = document.getElementById('logoutDialog');
            dialog.show();
        }

        // 监听对话框关闭事件
        document.addEventListener('DOMContentLoaded', function() {
            const logoutDialog = document.getElementById('logoutDialog');
            logoutDialog.addEventListener('close', function() {
                if (logoutDialog.returnValue === 'logout') {
                    fetch('/api/logout', { method: 'POST' })
                        .then(() => window.location.href = '/login')
                        .catch(() => window.location.href = '/login');
                }
            });
        });

        window.onload = function() {
            restoreThemeColor();
        };
    </script>
</body>
</html>`;
}

// 文件管理界面
function getFileManagerHTML(pathConfig, pathConfigs) {
  const apiBase = '/api/files/' + pathConfig.name;
  
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    ${getMaterialWebHead('GitHub文件管理器 - ' + escapeHtml(pathConfig.displayName))}
    <style>
    ${getMD3ColorTokens()}
        * { box-sizing: border-box; }
        body {
            font-family: 'Roboto', 'Helvetica', 'Arial', sans-serif;
            line-height: 1.6;
            min-height: 100vh;
            margin: 0;
            display: flex;
            flex-direction: row;
            background-color: var(--md-sys-color-background);
            color: var(--md-sys-color-on-background);
        }

        /* 主题色对话框样式 */
        .theme-color-input {
            display: flex;
            align-items: center;
            gap: 16px;
            margin: 24px 0;
        }
        .color-preview {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            border: 2px solid var(--md-sys-color-outline-variant);
            cursor: pointer;
            transition: border-color 0.2s ease;
        }
        /* 主题对话框最小宽度和移动端适配 */
        #themeDialog {
            --md-dialog-container-min-width: 420px;
        }
        @media (max-width: 480px) {
            #themeDialog {
                --md-dialog-container-min-width: 90vw;
                --md-dialog-container-max-width: 90vw;
            }
            .theme-color-input {
                flex-direction: column;
                align-items: flex-start;
            }
            .color-preview {
                width: 80px;
                height: 80px;
            }
        }
        .color-preview:hover { border-color: var(--md-sys-color-outline); }
        .color-input { flex: 1; }
        .color-input input[type="color"] {
            width: 100%;
            height: 48px;
            border: none;
            border-radius: var(--md-sys-shape-corner-medium);
            cursor: pointer;
            padding: 4px;
        }

        /* MD3 Navigation Rail */
        .nav-rail {
            width: 80px;
            background: var(--md-sys-color-surface);
            border-right: 1px solid var(--md-sys-color-outline-variant);
            flex-shrink: 0;
            height: 100vh;
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 12px 0;
        }
        .nav-rail-items {
            flex: 1;
            overflow-y: auto;
            width: 100%;
        }
        .nav-rail-header {
            padding: 8px 0 16px;
            text-align: center;
            font-size: 12px;
            font-weight: 600;
            color: var(--md-sys-color-on-surface);
            line-height: 1.3;
            word-break: break-all;
            max-width: 72px;
        }
        .nav-rail-fab {
            width: 56px;
            height: 56px;
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            text-decoration: none;
            color: var(--md-sys-color-on-surface-variant);
            position: relative;
            overflow: hidden;
            transition: background 0.2s ease;
            cursor: pointer;
        }
        .nav-rail-fab::before {
            content: '';
            position: absolute;
            inset: 0;
            background: var(--md-sys-color-on-surface-variant);
            opacity: 0;
            transition: opacity 0.2s ease;
            pointer-events: none;
            border-radius: 16px;
        }
        .nav-rail-fab:hover::before { opacity: 0.08; }
        .nav-rail-fab:active::before { opacity: 0.12; }
        .nav-rail-fab.active {
            background: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
        }
        .nav-rail-fab.active::before { display: none; }
        .nav-rail-fab-label {
            font-size: 11px;
            margin-top: 4px;
            text-align: center;
            line-height: 1.2;
            max-width: 72px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            align-items: center;
        }
        .nav-rail-item-group {
            display: flex;
            flex-direction: column;
            align-items: center;
        }
            max-width: 72px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .nav-rail-bottom {
            padding: 8px 0;
            flex-shrink: 0;
            position: absolute;
            bottom: 12px;
            left: 0;
            right: 0;
            background: var(--md-sys-color-surface);
            text-align: center;
            z-index: 10;
        }
        .nav-rail-items {
            flex: 1;
            overflow-y: auto;
            width: 100%;
            padding-bottom: 60px;
        }

        /* Main content */
        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .main-header {
            background: var(--md-sys-color-surface);
            padding: 16px 24px;
            border-bottom: 1px solid var(--md-sys-color-outline-variant);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .main-title {
            font-size: 22px;
            font-weight: 500;
            color: var(--md-sys-color-on-surface);
        }
        .header-actions { display: flex; gap: 8px; }
        .content-area { flex: 1; padding: 24px; overflow-y: auto; }
        .upload-section {
            background: var(--md-sys-color-surface-container-low);
            padding: 24px;
            border-radius: var(--md-sys-shape-corner-large);
            box-shadow: 0 1px 2px 0 rgba(0,0,0,0.3), 0 1px 3px 1px rgba(0,0,0,0.15);
            margin-bottom: 24px;
        }
        .file-list {
            background: var(--md-sys-color-surface-container-low);
            border-radius: var(--md-sys-shape-corner-large);
            box-shadow: 0 1px 2px 0 rgba(0,0,0,0.3), 0 1px 3px 1px rgba(0,0,0,0.15);
            overflow: hidden;
        }
        .progress-container { margin-top: 20px; }
        .progress-item { margin-bottom: 16px; }
        .selected-files { margin-top: 20px; }
        .file-tag {
            display: inline-block;
            background: var(--md-sys-color-secondary-container);
            color: var(--md-sys-color-on-secondary-container);
            padding: 6px 12px;
            border-radius: var(--md-sys-shape-corner-full);
            font-size: 14px;
            margin-right: 8px;
            margin-bottom: 8px;
            transition: background 0.2s ease;
        }
        .empty-state {
            padding: 80px 20px;
            text-align: center;
            color: var(--md-sys-color-on-surface-variant);
        }
        .empty-state .material-symbols-outlined { opacity: 0.5; }
        .file-table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .file-table * { box-sizing: border-box; }
        .file-table th {
            background: var(--md-sys-color-surface-container);
            padding: 14px 24px;
            text-align: left;
            font-weight: 500;
            color: var(--md-sys-color-on-surface-variant);
            border-bottom: 1px solid var(--md-sys-color-outline-variant);
        }
        .file-table th:nth-child(1) { width: 40%; }
        .file-table th:nth-child(2) { width: 15%; }
        .file-table th:nth-child(3) { width: 45%; }
        .file-table td {
            padding: 14px 24px;
            border-bottom: 1px solid var(--md-sys-color-outline-variant);
            vertical-align: middle;
        }
        .file-table td:nth-child(1) {
            white-space: normal;
            word-break: break-word;
            overflow: hidden;
        }
        .file-table td:nth-child(2) {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            width: 100px;
        }
        .file-table td:nth-child(3) {
            white-space: normal;
            overflow: hidden;
        }
        .action-buttons { 
            display: flex; 
            gap: 4px; 
            flex-wrap: wrap; 
            justify-content: flex-end;
            align-items: center;
        }
        .action-buttons md-text-button {
            margin: 2px 0;
            white-space: nowrap;
            --md-text-button-container-height: 32px;
            font-size: 13px;
        }
        .file-table tbody tr { transition: background 0.15s ease; }
        .file-table tbody tr:hover { background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent); }
        .file-table tr:last-child td { border-bottom: none; }
        .file-path-sub {
            font-size: 12px;
            color: var(--md-sys-color-on-surface-variant);
        }
        .action-buttons { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-start; }

        @media (max-width: 768px) {
            body { flex-direction: column; }
            .nav-rail {
                width: 100%;
                flex-direction: row;
                padding: 0 8px;
                border-right: none;
                border-bottom: 1px solid var(--md-sys-color-outline-variant);
                overflow-x: auto;
                align-items: center;
                height: auto;
            }
            .nav-rail-header { display: none; }
            .nav-rail-fab { width: 48px; height: 48px; border-radius: 16px; }
            .nav-rail-fab-label { font-size: 10px; }
            .nav-rail-items { display: flex; flex-direction: row; gap: 4px; flex: 1; }
            .nav-rail-item-group { display: flex; flex-direction: column; align-items: center; }
            .nav-rail-spacer { display: none; }
            .nav-rail-bottom { padding: 0 8px; }
            .main-header { padding: 12px 16px; }
            .main-title { font-size: 18px; }
            .content-area { padding: 16px; }
            .upload-section { padding: 20px; }
            .file-table th, .file-table td { padding: 10px 12px; }
            .file-table th:nth-child(2) { width: 80px; }
            .file-table th:nth-child(3) { width: auto; }
        }

        @media (max-width: 480px) {
            .main-header { flex-direction: column; align-items: flex-start; gap: 12px; }
            .header-actions { width: 100%; justify-content: space-between; }
            .content-area { padding: 12px; }
            .upload-section { padding: 16px; }
            .file-table th:nth-child(1) { width: 35%; }
            .file-table th:nth-child(2) { width: 20%; }
            .file-table th:nth-child(3) { width: 45%; }
            .file-table th, .file-table td { padding: 8px 10px; font-size: 12px; }
            .action-buttons { gap: 2px; }
            .action-buttons md-text-button { font-size: 11px; --md-text-button-container-height: 28px; }
        }
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
    </style>
</head>
<body>
    <nav class="nav-rail">
        <div class="nav-rail-header">GitHub<br>文件<br>管理器</div>
        <div class="nav-rail-items">
            ${pathConfigs.map(config => `
                <div class="nav-rail-item-group">
                    <a class="nav-rail-fab ${config.name === pathConfig.name ? 'active' : ''}" href="/${config.name}" title="${escapeHtml(config.displayName)}">
                        <span class="material-symbols-outlined">folder</span>
                    </a>
                    <span class="nav-rail-fab-label">${escapeHtml(config.displayName)}</span>
                </div>
            `).join('')}
        </div>
        <div class="nav-rail-spacer"></div>
        <div class="nav-rail-bottom">
        <md-filled-icon-button aria-label="登出" onclick="logout()">
  <md-icon>logout</md-icon>
</md-filled-icon-button>
        </div>
    </nav>

    <div class="main-content">
        <div class="main-header">
            <div class="main-title">${escapeHtml(pathConfig.displayName)}</div>
            <div class="header-actions">
                <md-outlined-button data-dark-toggle aria-label="切换模式" onclick="toggleDarkMode()">
                    <span slot="icon" class="material-symbols-outlined">routine</span>
                    切换模式
                </md-outlined-button>
                <md-outlined-button onclick="window.location.href='/';">
                    <span slot="icon" class="material-symbols-outlined">arrow_back</span>
                    返回选择
                </md-outlined-button>
                <md-outlined-button onclick="openThemeDialog()">
                    <span slot="icon" class="material-symbols-outlined">palette</span>
                    主题色
                </md-outlined-button>
            </div>
        </div>

        <div class="content-area">
            <div class="upload-section">
                <h2 class="md-typescale-title-large">上传文件</h2>
                <div style="margin-top: 20px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center;">
                    <input type="file" id="fileInput" multiple style="display: none;" />
                    <md-outlined-button onclick="document.getElementById('fileInput').click()" style="flex: 1; min-width: 200px;">
                        <span slot="icon" class="material-symbols-outlined">folder_open</span>
                        选择文件
                    </md-outlined-button>
                    <md-filled-button id="uploadBtn" onclick="window.uploadFiles()">
                        <span slot="icon" class="material-symbols-outlined">upload</span>
                        开始上传
                    </md-filled-button>
                    <md-outlined-button onclick="window.getFileList()">
                        <span slot="icon" class="material-symbols-outlined">refresh</span>
                        刷新
                    </md-outlined-button>
                </div>
                <div id="selectedFiles" class="selected-files"></div>
                <div id="uploadProgress" class="progress-container"></div>
            </div>

            <div class="file-list">
                <table class="file-table">
                    <thead>
                        <tr>
                            <th>文件名</th>
                            <th>大小</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody id="fileTableBody"></tbody>
                </table>
                <div id="emptyState" class="empty-state" style="display: none;">
                    <span class="material-symbols-outlined" style="font-size: 64px;">folder</span>
                    <p style="margin-top: 20px; font-size: 16px;">当前目录为空</p>
                </div>
            </div>
        </div>
    </div>

    <md-dialog id="themeDialog">
        <div slot="headline">设置主题色</div>
        <div slot="content">
            <p>请选择颜色&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;&#8195;</p>
            <div class="theme-color-input">
                <div class="color-preview" id="colorPreview" style="background: var(--md-sys-color-primary);" onclick="document.getElementById('colorInput').click()"></div>
                <div class="color-input">
                    <label for="colorInput" style="font-size: 14px; color: var(--md-sys-color-on-surface-variant); display: block; margin-bottom: 8px;">选择主题色</label>
                    <input type="color" id="colorInput" value="#1e40af" onchange="updateColorPreview()">
                </div>
            </div>
            <div style="margin-top: 20px;">
                <p style="font-size: 14px; color: var(--md-sys-color-on-surface-variant); margin-bottom: 12px;">或从图片中提取主题色：</p>
                <md-outlined-button onclick="document.getElementById('imageInput').click()">
                    <span slot="icon" class="material-symbols-outlined">photo_library</span>
                    选择图片
                </md-outlined-button>
                <input type="file" id="imageInput" accept="image/*" style="display: none;" onchange="extractColorFromImage(event)">
                <canvas id="colorCanvas" style="display: none;"></canvas>
            </div>
        </div>
        <div slot="actions">
            <md-text-button onclick="document.getElementById('themeDialog').close()">取消</md-text-button>
            <md-filled-button onclick="applyTheme()">应用</md-filled-button>
        </div>
    </md-dialog>

    <!-- 登出确认对话框 -->
    <md-dialog id="logoutDialog" type="alert">
        <div slot="headline">确认登出</div>
        <form slot="content" id="logout-form" method="dialog">
            确定要登出吗？
        </form>
        <div slot="actions">
            <md-text-button form="logout-form" value="cancel">取消</md-text-button>
            <md-text-button form="logout-form" value="logout">登出</md-text-button>
        </div>
    </md-dialog>

    <!-- 删除确认对话框 -->
    <md-dialog id="deleteDialog" type="alert">
        <div slot="headline">确认删除</div>
        <form slot="content" id="delete-form" method="dialog">
            确定要删除这个文件吗？此操作无法撤销。
        </form>
        <div slot="actions">
            <md-text-button form="delete-form" value="cancel">取消</md-text-button>
            <md-text-button form="delete-form" value="delete" style="color: var(--md-sys-color-error);">删除</md-text-button>
        </div>
    </md-dialog>

    <script>
    ${getMessageHelper()}
    ${getDynamicColorScript()}

        const apiBase = '/api/files/${pathConfig.name}';

        function formatFileSize(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }

        function canPreview(filename) {
            const previewExtensions = [
                'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg',
                'pdf', 'txt', 'md', 'html', 'htm', 'xml', 'json', 'csv', 'log',
                'js', 'css', 'py', 'java', 'cpp', 'c'
            ];
            const extension = filename.split('.').pop().toLowerCase();
            return previewExtensions.includes(extension);
        }

        function getFileList() {
            try {
                fetch(apiBase)
                    .then(response => response.json())
                    .then(data => {
                        const fileTableBody = document.getElementById('fileTableBody');
                        const emptyState = document.getElementById('emptyState');

                        if (data.files && data.files.length > 0) {
                            let html = '';
                            data.files.forEach(function(file) {
                                const fileSize = formatFileSize(file.size);
                                const canPreviewFile = canPreview(file.name);

                                html += '<tr>';
                                html += '<td>';
                                html += '<div style="font-weight: 500;">' + escapeHtml(file.name) + '</div>';
                                html += '<div class="file-path-sub">' + escapeHtml(file.path) + '</div>';
                                html += '</td>';
                                html += '<td>' + fileSize + '</td>';
                                html += '<td><div class="action-buttons">';

                                const filePath = encodeURIComponent(file.path);
                                const fileName = encodeURIComponent(file.name);
                                const fileSha = encodeURIComponent(file.sha);

                                if (canPreviewFile) {
                                    html += '<md-text-button class="file-action-btn" data-action="preview" data-path="' + filePath + '" data-name="' + fileName + '"><span slot="icon" class="material-symbols-outlined">visibility</span>查看</md-text-button>';
                                }
                                html += '<md-text-button class="file-action-btn" data-action="download" data-path="' + filePath + '" data-name="' + fileName + '"><span slot="icon" class="material-symbols-outlined">download</span>下载</md-text-button>';
                                html += '<md-text-button class="file-action-btn" data-action="delete" data-path="' + filePath + '" data-sha="' + fileSha + '" style="--md-text-button-label-text-color: var(--md-sys-color-error);"><span slot="icon" class="material-symbols-outlined">delete</span>删除</md-text-button>';
                                if (canPreviewFile && !file.name.match(/\\.(jpg|jpeg|png|gif|bmp|webp|pdf)$/i)) {
                                    html += '<md-text-button class="file-action-btn" data-action="edit" data-path="' + filePath + '" data-sha="' + fileSha + '"><span slot="icon" class="material-symbols-outlined">edit</span>编辑</md-text-button>';
                                }

                                html += '</div></td></tr>';
                            });
                            fileTableBody.innerHTML = html;
                            fileTableBody.style.display = 'table-row-group';
                            emptyState.style.display = 'none';
                        } else {
                            fileTableBody.innerHTML = '';
                            fileTableBody.style.display = 'none';
                            emptyState.style.display = 'block';
                        }
                    })
                    .catch(error => {
                        console.error('获取文件列表失败:', error);
                        showMessage('获取文件列表失败: ' + error.message, true);
                    });
            } catch (error) {
                console.error('getFileList函数执行失败:', error);
            }
        }

        function escapeHtml(str) {
            if (!str) return '';
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        function previewFile(filePath, filename) {
            window.open('/api/download?path=' + encodeURIComponent(filePath) + '&preview=true', '_blank');
        }

        function downloadFile(filePath, filename) {
            window.open('/api/download?path=' + encodeURIComponent(filePath), '_blank');
        }

        function editFile(filePath, sha) {
            const filename = filePath.split('/').pop();
            window.location.href = '/edit?filename=' + encodeURIComponent(filename) + '&sha=' + encodeURIComponent(sha) + '&path=' + encodeURIComponent(filePath);
        }

        let pendingDelete = null;

        function deleteFile(filePath, sha) {
            pendingDelete = { filePath, sha };
            const dialog = document.getElementById('deleteDialog');
            dialog.show();
        }

        function confirmDelete() {
            if (!pendingDelete) return;
            
            const { filePath, sha } = pendingDelete;
            pendingDelete = null;
            
            fetch(apiBase, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: filePath, sha: sha })
            })
            .then(function(response) { return response.json(); })
            .then(function(data) {
                if (data.success) {
                    showMessage('文件删除成功', false);
                    window.getFileList();
                } else {
                    showMessage(data.error || '删除失败', true);
                }
            })
            .catch(function(error) {
                console.error('删除文件失败:', error);
                showMessage('删除文件失败', true);
            });
        }

        function uploadFiles() {
            try {
                const filePicker = document.getElementById('fileInput');
                const files = filePicker.files;

                if (!files || files.length === 0) {
                    showMessage('请先选择文件', true);
                    return;
                }

                const MAX_SIZE = 25 * 1024 * 1024;
                for (let i = 0; i < files.length; i++) {
                    if (files[i].size > MAX_SIZE) {
                        showMessage('文件 ' + files[i].name + ' 超过25MB限制', true);
                        return;
                    }
                }

                const progressContainer = document.getElementById('uploadProgress');
                progressContainer.innerHTML = '';
                let completedUploads = 0;

                for (let index = 0; index < files.length; index++) {
                    const file = files[index];
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('filename', file.name);

                    const progressItem = document.createElement('div');
                    progressItem.className = 'progress-item';
                    progressItem.innerHTML = '<div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span>' + escapeHtml(file.name) + '</span><span id="progress' + index + '">0%</span></div><md-linear-progress id="progressBar' + index + '" indeterminate></md-linear-progress>';
                    progressContainer.appendChild(progressItem);

                    fetch(apiBase, { method: 'POST', body: formData })
                    .then(function(response) { return response.json(); })
                    .then(function(data) {
                        const progressBar = document.getElementById('progressBar' + index);
                        const progressText = document.getElementById('progress' + index);
                        if (progressBar && progressText) {
                            if (data.success) {
                                progressBar.indeterminate = false;
                                progressBar.value = 1;
                                progressText.textContent = '100%';
                                showMessage('文件 ' + file.name + ' 上传成功', false);
                            } else {
                                progressBar.indeterminate = false;
                                progressBar.value = 0;
                                progressText.textContent = '失败';
                                showMessage('文件 ' + file.name + ' 上传失败: ' + (data.error || '未知错误'), true);
                            }
                        }
                        completedUploads++;
                        if (completedUploads === files.length) {
                            setTimeout(window.getFileList, 1000);
                            setTimeout(() => {
                                progressContainer.innerHTML = '';
                                filePicker.value = '';
                                document.getElementById('selectedFiles').innerHTML = '';
                            }, 3000);
                        }
                    })
                    .catch(function(error) {
                        console.error('上传文件失败:', error);
                        const progressBar = document.getElementById('progressBar' + index);
                        const progressText = document.getElementById('progress' + index);
                        if (progressBar && progressText) {
                            progressBar.indeterminate = false;
                            progressBar.value = 0;
                            progressText.textContent = '失败';
                        }
                        showMessage('文件 ' + file.name + ' 上传失败', true);
                        completedUploads++;
                        if (completedUploads === files.length) {
                            setTimeout(window.getFileList, 1000);
                        }
                    });
                }
            } catch (error) {
                console.error('uploadFiles函数执行失败:', error);
            }
        }

        document.getElementById('fileInput').addEventListener('change', function(e) {
            const files = e.target.files;
            const selectedFilesContainer = document.getElementById('selectedFiles');
            if (files && files.length > 0) {
                let html = '';
                for (let i = 0; i < files.length; i++) {
                    const fileSize = formatFileSize(files[i].size);
                    html += '<span class="file-tag">' + escapeHtml(files[i].name) + ' (' + fileSize + ')</span>';
                }
                selectedFilesContainer.innerHTML = html;
            } else {
                selectedFilesContainer.innerHTML = '';
            }
        });

        window.getFileList = getFileList;
        window.previewFile = previewFile;
        window.downloadFile = downloadFile;
        window.editFile = editFile;
        window.deleteFile = deleteFile;
        window.uploadFiles = uploadFiles;

        function logout() {
            const dialog = document.getElementById('logoutDialog');
            dialog.show();
        }

        document.addEventListener('click', function(e) {
            const button = e.target.closest('.file-action-btn');
            if (button) {
                const action = button.getAttribute('data-action');
                const path = decodeURIComponent(button.getAttribute('data-path'));
                
                if (action === 'preview') {
                    const name = decodeURIComponent(button.getAttribute('data-name'));
                    previewFile(path, name);
                } else if (action === 'download') {
                    const name = decodeURIComponent(button.getAttribute('data-name'));
                    downloadFile(path, name);
                } else if (action === 'delete') {
                    const sha = decodeURIComponent(button.getAttribute('data-sha'));
                    deleteFile(path, sha);
                } else if (action === 'edit') {
                    const sha = decodeURIComponent(button.getAttribute('data-sha'));
                    editFile(path, sha);
                }
            }
        });

        document.addEventListener('DOMContentLoaded', function() {
            window.getFileList();
            restoreThemeColor();
            
            // 监听登出对话框关闭事件
            const logoutDialog = document.getElementById('logoutDialog');
            logoutDialog.addEventListener('close', function() {
                if (logoutDialog.returnValue === 'logout') {
                    fetch('/api/logout', { method: 'POST' })
                        .then(() => window.location.href = '/login')
                        .catch(() => window.location.href = '/login');
                }
            });
            
            // 监听删除对话框关闭事件
            const deleteDialog = document.getElementById('deleteDialog');
            deleteDialog.addEventListener('close', function() {
                if (deleteDialog.returnValue === 'delete') {
                    confirmDelete();
                }
            });
        });
    </script>
</body>
</html>`;
}

// 文件编辑页面
function getEditFileHTML(filename, sha, filePath, pathConfigs) {
  let pathName = 'default';
  let bestMatch = '';
  
  // 找到最精确匹配的路径配置
  for (const config of pathConfigs) {
    if (config.path && filePath.startsWith(config.path)) {
      if (config.path.length > bestMatch.length) {
        bestMatch = config.path;
        pathName = config.name;
      }
    }
  }
  
  const apiBase = '/api/files/' + pathName;
  
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    ${getMaterialWebHead('编辑文件 - ' + escapeHtml(filename))}
    <style>
    ${getMD3ColorTokens()}
        * { box-sizing: border-box; }
        body {
            font-family: 'Roboto', 'Helvetica', 'Arial', sans-serif;
            line-height: 1.6;
            min-height: 100vh;
            margin: 0;
            background-color: var(--md-sys-color-background);
            color: var(--md-sys-color-on-background);
        }
        .container { max-width: 1000px; margin: 0 auto; padding: 20px; }
        .header {
            background: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
            padding: 24px;
            border-radius: var(--md-sys-shape-corner-extra-large);
            margin-bottom: 24px;
            position: relative;
            box-shadow: 0 1px 3px 1px rgba(0,0,0,0.15), 0 1px 2px 0 rgba(0,0,0,0.3);
        }
        .header-content { text-align: center; }
        .edit-section {
            background: var(--md-sys-color-surface-container-low);
            padding: 32px;
            border-radius: var(--md-sys-shape-corner-large);
            box-shadow: 0 1px 2px 0 rgba(0,0,0,0.3), 0 1px 3px 1px rgba(0,0,0,0.15);
        }
        .form-group { margin-bottom: 24px; }
        .form-group label {
            display: block;
            margin-bottom: 12px;
            font-weight: 500;
            color: var(--md-sys-color-on-surface);
        }
        textarea {
            width: 100%;
            min-height: 500px;
            padding: 16px;
            border: 1px solid var(--md-sys-color-outline);
            border-radius: var(--md-sys-shape-corner-medium);
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 14px;
            resize: vertical;
            background: var(--md-sys-color-surface);
            color: var(--md-sys-color-on-surface);
            transition: border-color 0.2s ease;
        }
        textarea:focus {
            outline: none;
            border-color: var(--md-sys-color-primary);
            box-shadow: 0 0 0 1px var(--md-sys-color-primary);
        }
        textarea:hover { border-color: var(--md-sys-color-on-surface-variant); }
        .form-group md-outlined-text-field { width: 100%; }
        .form-actions {
            display: flex;
            gap: 16px;
            margin-top: 32px;
            justify-content: flex-end;
        }
        @media (max-width: 768px) {
            .container { padding: 16px; }
            .header { padding: 20px; }
            .edit-section { padding: 24px; }
            textarea { min-height: 400px; }
            .form-actions { flex-direction: column; }
        }
    </style>
</head>
<body>
    <div style="position: fixed; top: 16px; right: 16px; z-index: 100;">
        <md-icon-button data-dark-toggle aria-label="切换到深色模式" onclick="toggleDarkMode()" icon="light_mode"></md-icon-button>
    </div>
    <div class="container">
        <div class="header">
            <div class="header-content">
                <h1 class="md-typescale-headline-medium">编辑文件</h1>
                <p class="md-typescale-body-large">${escapeHtml(filename)}</p>
            </div>
        </div>

        <div class="edit-section">
            <form id="editForm">
                <div class="form-group">
                    <label for="content">文件内容</label>
                    <textarea id="content" name="content" placeholder="请输入文件内容"></textarea>
                </div>
                <div class="form-group">
                    <label for="message">提交信息</label>
                    <md-outlined-text-field
                        id="message"
                        name="message"
                        label="提交信息"
                        value="更新文件: ${escapeHtml(filename)}"
                    ></md-outlined-text-field>
                </div>
                <div class="form-actions">
                    <md-outlined-button type="button" onclick="window.history.back()">取消</md-outlined-button>
                    <md-filled-button id="saveBtn" type="submit">
                        <span slot="icon" class="material-symbols-outlined">save</span>
                        保存修改
                    </md-filled-button>
                </div>
            </form>
        </div>
    </div>

    <script>
    ${getMessageHelper()}
    ${getDynamicColorScript()}

        const filePath = '${escapeHtml(filePath)}';
        const apiBase = '${apiBase}';

        function loadFileContent() {
            fetch('/api/download?path=' + encodeURIComponent(filePath))
                .then(response => {
                    if (!response.ok) {
                        throw new Error('加载失败: ' + response.status);
                    }
                    return response.text();
                })
                .then(content => {
                    document.getElementById('content').value = content;
                })
                .catch(error => {
                    console.error('加载文件内容失败:', error);
                    showMessage('加载文件内容失败: ' + error.message, true);
                });
        }

        document.getElementById('editForm').addEventListener('submit', function(e) {
            e.preventDefault();

            const content = document.getElementById('content').value;
            const message = document.getElementById('message').value || 'Update file: ${escapeHtml(filename)}';

            if (!content) {
                showMessage('文件内容不能为空', true);
                return;
            }

            const saveBtn = document.getElementById('saveBtn');
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span slot="icon" class="material-symbols-outlined">save</span>保存中...';

            fetch(apiBase, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filePath: filePath,
                    sha: '${sha}',
                    content: content,
                    message: message
                })
            })
            .then(response => response.json())
            .then(data => {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<span slot="icon" class="material-symbols-outlined">save</span>保存修改';

                if (data.success) {
                    showMessage('文件修改成功', false);
                    setTimeout(() => { window.history.back(); }, 1500);
                } else {
                    showMessage(data.error || '修改失败', true);
                }
            })
            .catch(error => {
                console.error('保存文件失败:', error);
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<span slot="icon" class="material-symbols-outlined">save</span>保存修改';
                showMessage('保存文件失败: ' + error.message, true);
            });
        });

        window.onload = function() {
            loadFileContent();
            restoreThemeColor();
        };
    </script>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 登录页面（不需要认证）
    if (url.pathname === '/login') {
      return new Response(getLoginHTML(''), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    // 登录API（不需要认证）
    if (url.pathname === '/api/login') {
      return await handleLogin(request, env);
    }
    
    // 注册页面（不需要认证）
    if (url.pathname === '/register') {
      return new Response(getRegisterHTML(''), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // 注册API（不需要认证）
    if (url.pathname === '/api/register') {
      return await handleRegister(request, env);
    }
    
    // 验证GitHub Token API（不需要认证）
    if (url.pathname === '/api/verify-token') {
      return handleVerifyToken(request, env);
    }
    
    // 登出API（需要认证）
    if (url.pathname === '/api/logout') {
      if (!await verifySession(request, env)) {
        return new Response(null, {
          status: 302,
          headers: { 'Location': '/login' }
        });
      }
      return await handleLogout(request, env);
    }
    
    // 检查会话认证（除了登录相关页面）
    let currentUsername = await verifySession(request, env);
    if (!currentUsername) {
      return new Response(null, {
        status: 302,
        headers: { 'Location': '/login' }
      });
    }
    
    // 加载用户配置
    let userConfig = await getUserConfig(request, env);
    
    // 首次登录无配置，引导到设置页
    if (!userConfig && url.pathname !== '/settings' && !url.pathname.startsWith('/api/config')) {
      return new Response(null, { status: 302, headers: { 'Location': '/settings?first=1' } });
    }
    
    // 提供默认空配置给设置页面
    if (!userConfig) {
      userConfig = { GITHUB_TOKEN: '', GITHUB_OWNER: '', GITHUB_REPO: '', GITHUB_BRANCH: 'main', paths: [] };
    }
    
    const pathConfigs = getPathConfig(userConfig);
    const githubConfig = getGithubConfig(userConfig);
    
    // 设置页面
    if (url.pathname === '/settings') {
      const isFirst = url.searchParams.get('first') === '1';
      return new Response(getSettingsHTML(currentUsername, '', isFirst), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    
    // 配置API
    if (url.pathname === '/api/config') {
      if (request.method === 'GET') {
        return handleGetConfig(request, env);
      } else if (request.method === 'POST') {
        return handleSaveConfig(request, env);
      }
    }
    
    // 处理根路径，显示路径选择界面
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(getPathSelectionHTML(pathConfigs), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    // 处理具体路径的界面
    const pathMatch = url.pathname.match(/^\/(path\d+|default)(\.html)?$/);
    if (pathMatch) {
      const pathName = pathMatch[1];
      const pathConfig = pathConfigs.find(p => p.name === pathName);
      
      if (pathConfig) {
        return new Response(getFileManagerHTML(pathConfig, pathConfigs), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    }
    
    // 处理API请求
    const apiMatch = url.pathname.match(/^\/api\/files(?:\/(path\d+|default))?$/);
    if (apiMatch) {
      const pathName = apiMatch[1] || 'default';
      const pathConfig = pathConfigs.find(p => p.name === pathName);
      
      if (pathConfig) {
        if (request.method === 'GET') {
          return await getFiles(githubConfig, pathConfig);
        } else if (request.method === 'POST') {
          return await uploadFile(request, githubConfig, pathConfig);
        } else if (request.method === 'DELETE') {
          return await deleteFile(request, githubConfig, pathConfig);
        } else if (request.method === 'PUT') {
          return await updateFile(request, githubConfig, pathConfig);
        }
      }
    }
    
    // 处理编辑页面
    if (url.pathname === '/edit') {
      const filename = url.searchParams.get('filename');
      const sha = url.searchParams.get('sha');
      const filePath = url.searchParams.get('path');
      
      if (!filename || !sha || !filePath) {
        return new Response('缺少必要参数', { status: 400 });
      }
      
      return new Response(getEditFileHTML(filename, sha, filePath, pathConfigs), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    // 处理下载代理请求
    if (url.pathname === '/api/download') {
      return await downloadProxy(request, githubConfig);
    }
    
    return new Response('Not Found', { status: 404 });
  }
};
