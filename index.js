// 获取所有路径配置
function getPathConfig(env) {
  const paths = [];
  
  // 基础路径（兼容旧版本）
  if (env.GITHUB_PATH) {
    paths.push({
      name: 'default',
      displayName: '默认路径',
      path: env.GITHUB_PATH
    });
  }
  
  // 动态路径配置
  let i = 1;
  while (true) {
    const pathKey = `GITHUB_PATH${i}`;
    const nameKey = `GITHUB_PATH${i}_NAME`;
    
    if (!env[pathKey]) break;
    
    paths.push({
      name: `path${i}`,
      displayName: env[nameKey] || `路径${i}`,
      path: env[pathKey]
    });
    i++;
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

// 会话存储（使用内存存储，生产环境建议使用 KV）
const sessions = new Map();

// 生成会话令牌
function generateSessionToken() {
  return crypto.randomUUID();
}

// 验证会话
function verifySession(request, env) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return false;
  
  const cookies = new Map(cookieHeader.split(';').map(c => {
    const [key, value] = c.trim().split('=');
    return [key, value];
  }));
  
  const sessionToken = cookies.get('session_token');
  if (!sessionToken) return false;
  
  const sessionData = sessions.get(sessionToken);
  return sessionData && sessionData.expires > Date.now();
}

// 设置会话Cookie
function setSessionCookie(response, env, username) {
  const sessionToken = generateSessionToken();
  const maxAge = parseInt(env.SESSION_MAX_AGE) || 3600;
  
  sessions.set(sessionToken, {
    username: username,
    expires: Date.now() + maxAge * 1000
  });
  
  response.headers.set('Set-Cookie', `session_token=${sessionToken}; Max-Age=${maxAge}; HttpOnly; Path=/; SameSite=Lax`);
  return response;
}

// 清除会话Cookie
function clearSessionCookie(response, request) {
  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader) {
    const cookies = new Map(cookieHeader.split(';').map(c => {
      const [key, value] = c.trim().split('=');
      return [key, value];
    }));
    const sessionToken = cookies.get('session_token');
    if (sessionToken) {
      sessions.delete(sessionToken);
    }
  }
  
  response.headers.set('Set-Cookie', 'session_token=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax');
  return response;
}

// 统一的文件路径编码函数
function encodeGitHubPath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

// 登录页面HTML
function getLoginHTML(error = '') {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, shrink-to-fit=no"/>
    <meta name="renderer" content="webkit"/>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/mdui/2.1.4/mdui.css" />
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined" rel="stylesheet" />
    <script src="https://cdnjs.cloudflare.com/ajax/libs/mdui/2.1.4/mdui.global.js"></script>
    <style>
        :root {
            --md-sys-color-primary: #1e40af;
            --md-sys-color-primary-container: #dbeafe;
            --md-sys-color-secondary: #374151;
            --md-sys-color-secondary-container: #e5e7eb;
            --md-sys-color-error: #b91c1c;
            --md-sys-color-error-container: #fef2f2;
            --md-sys-color-background: #f8fafc;
            --md-sys-color-surface: #ffffff;
            --md-sys-color-surface-variant: #f1f5f9;
            --md-sys-color-on-primary: #ffffff;
            --md-sys-color-on-secondary: #ffffff;
            --md-sys-color-on-error: #ffffff;
            --md-sys-color-on-background: #1e293b;
            --md-sys-color-on-surface: #1e293b;
            --md-sys-color-on-surface-variant: #475569;
        }
        
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #1e40af;
            margin: 0;
            font-family: 'Roboto', 'Helvetica', 'Arial', sans-serif;
        }
        
        .login-container {
            width: 100%;
            max-width: 420px;
            background: var(--md-sys-color-surface);
            border-radius: 24px;
            box-shadow: 0 10px 50px rgba(0,0,0,0.15);
            overflow: hidden;
            transition: all 0.3s ease;
        }
        
        .login-container:hover {
            transform: translateY(-5px);
            box-shadow: 0 15px 60px rgba(0,0,0,0.2);
        }
        
        .login-header {
            background: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
            padding: 40px 32px;
            text-align: center;
            position: relative;
        }
        
        .logo {
            margin-bottom: 20px;
            display: flex;
            justify-content: center;
        }
        
        .logo-icon {
            background: var(--md-sys-color-primary-container);
            color: var(--md-sys-color-primary);
            border-radius: 50%;
            padding: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .login-body {
            padding: 32px;
        }
        
        .error-message {
            margin-bottom: 24px;
        }
        
        .form-group {
            margin-bottom: 24px;
        }
        
        .form-actions {
            margin-top: 32px;
        }
        
        .footer {
            text-align: center;
            margin-top: 24px;
            font-size: 14px;
            color: var(--md-sys-color-on-surface-variant);
        }
        
        @media (max-width: 480px) {
            .login-container {
                margin: 20px;
                border-radius: 20px;
            }
            
            .login-header {
                padding: 32px 24px;
            }
            
            .login-body {
                padding: 24px;
            }
        }
    </style>
    <title>GitHub文件管理器 - 登录</title>
</head>
<body>
    <div class="login-container">
        <div class="login-header">
            <div class="logo">
                <div class="logo-icon">
                    <mdui-icon name="lock--outlined" size="48px"></mdui-icon>
                </div>
            </div>
            <h1 class="mdui-typo-headline-medium">GitHub文件管理器</h1>
            <p class="mdui-typo-body-1">请输入用户名和密码登录系统</p>
        </div>
        
        ${error ? `<mdui-alert type="error" class="error-message">${error}</mdui-alert>` : ''}
        
        <div class="login-body">
            <form id="loginForm" method="POST" action="/api/login">
                <div class="form-group">
                    <mdui-text-field 
                        label="用户名" 
                        type="text" 
                        name="username" 
                        id="username" 
                        required
                        variant="outlined"
                    >
                        <mdui-icon slot="icon" name="person--outlined"></mdui-icon>
                    </mdui-text-field>
                </div>
                <div class="form-group">
                    <mdui-text-field 
                        label="密码" 
                        type="password" 
                        name="password" 
                        id="password" 
                        required
                        variant="outlined"
                    >
                        <mdui-icon slot="icon" name="lock--outlined"></mdui-icon>
                    </mdui-text-field>
                </div>
                <div class="form-actions">
                    <mdui-button 
                        type="submit" 
                        variant="filled" 
                        color="primary" 
                        full-width
                        size="large"
                    >
                        <mdui-icon slot="icon" name="login--outlined"></mdui-icon>
                        登录
                    </mdui-button>
                </div>
                <div class="footer">
                    <p>© 2026 GitHub文件管理器</p>
                </div>
            </form>
        </div>
    </div>
    
    <script>
        document.getElementById('loginForm').addEventListener('submit', function(e) {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            
            if (!username || !password) {
                e.preventDefault();
                mdui.snackbar({
                    message: '请输入用户名和密码',
                    type: 'error',
                    position: 'top'
                });
            }
        });
        
        window.onload = function() {
            document.getElementById('username').focus();
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
    const username = formData.get('username');
    const password = formData.get('password');
    
    const expectedUsername = env.LOGIN_USERNAME || 'admin';
    const expectedPassword = env.LOGIN_PASSWORD || 'password123';
    
    if (username === expectedUsername && password === expectedPassword) {
      const response = new Response(null, {
        status: 302,
        headers: { 'Location': '/' }
      });
      return setSessionCookie(response, env, username);
    } else {
      return new Response(getLoginHTML('用户名或密码错误'), {
        status: 401,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
  } catch (error) {
    return new Response(getLoginHTML('登录请求格式错误'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

// 登出处理函数
async function handleLogout(request, env) {
  const response = new Response(null, {
    status: 302,
    headers: { 'Location': '/login' }
  });
  return clearSessionCookie(response, request);
}

// 获取文件列表
async function getFiles(env, pathConfig) {
  try {
    const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = env;
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
async function uploadFile(request, env, pathConfig) {
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
    
    const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = env;
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
async function deleteFile(request, env, pathConfig) {
  try {
    const { filePath, sha } = await request.json();
    
    if (!filePath || !sha) {
      return new Response(JSON.stringify({ error: '缺少必要参数' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = env;
    
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
async function updateFile(request, env, pathConfig) {
  try {
    const { filePath, sha, content, message } = await request.json();
    
    if (!filePath || !sha || !content) {
      return new Response(JSON.stringify({ error: '缺少必要参数' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = env;
    
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
async function downloadProxy(request, env) {
  try {
    const url = new URL(request.url);
    const filePath = url.searchParams.get('path');
    const previewMode = url.searchParams.get('preview') === 'true';
    
    if (!filePath) {
      return new Response('缺少文件路径参数', { status: 400 });
    }
    
    const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = env;
    
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

// 路径选择界面
function getPathSelectionHTML(pathConfigs) {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, shrink-to-fit=no"/>
    <meta name="renderer" content="webkit"/>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/mdui/2.1.4/mdui.css" />
    <script src="https://cdnjs.cloudflare.com/ajax/libs/mdui/2.1.4/mdui.global.js"></script>
    <title>GitHub文件管理器 - 选择路径</title>
    <style>
        :root {
            --md-sys-color-primary: #1e40af;
            --md-sys-color-primary-container: #dbeafe;
            --md-sys-color-secondary: #374151;
            --md-sys-color-secondary-container: #e5e7eb;
            --md-sys-color-error: #b91c1c;
            --md-sys-color-error-container: #fef2f2;
            --md-sys-color-background: #f8fafc;
            --md-sys-color-surface: #ffffff;
            --md-sys-color-surface-variant: #f1f5f9;
            --md-sys-color-on-primary: #ffffff;
            --md-sys-color-on-secondary: #ffffff;
            --md-sys-color-on-error: #ffffff;
            --md-sys-color-on-background: #1e293b;
            --md-sys-color-on-surface: #1e293b;
            --md-sys-color-on-surface-variant: #475569;
        }
        
        body {
            font-family: 'Roboto', 'Helvetica', 'Arial', sans-serif;
            line-height: 1.6;
            color: var(--md-sys-color-on-background);
            background: #1e40af;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
        }
        
        .container {
            max-width: 1200px;
            width: 100%;
            margin: 0 auto;
            padding: 20px;
        }
        
        .card {
            background: var(--md-sys-color-surface);
            border-radius: 24px;
            box-shadow: 0 10px 50px rgba(0,0,0,0.15);
            overflow: hidden;
        }
        
        .card-header {
            background: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
            padding: 32px;
            text-align: center;
            position: relative;
        }
        
        .logout-btn {
            position: absolute;
            top: 16px;
            right: 16px;
        }
        
        .card-body {
            padding: 40px;
        }
        
        .path-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 24px;
        }
        
        .path-card {
            background: var(--md-sys-color-surface-variant);
            padding: 32px;
            border-radius: 16px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.08);
            transition: all 0.3s ease;
            border: 1px solid transparent;
        }
        
        .path-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 8px 25px rgba(0,0,0,0.12);
            border-color: var(--md-sys-color-primary);
            background: var(--md-sys-color-secondary-container);
        }
        
        .path-icon {
            margin-bottom: 20px;
            display: inline-block;
            background: var(--md-sys-color-primary-container);
            color: var(--md-sys-color-primary);
            border-radius: 12px;
            padding: 16px;
        }
        
        .path-name {
            font-weight: 600;
            margin-bottom: 12px;
            color: var(--md-sys-color-on-surface);
        }
        
        .path-info {
            font-size: 14px;
            color: var(--md-sys-color-on-surface-variant);
            margin-bottom: 24px;
        }
        
        @media (max-width: 768px) {
            .card-body {
                padding: 24px;
            }
            
            .path-grid {
                grid-template-columns: 1fr;
            }
            
            .path-card {
                padding: 24px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="card-header">
                <h1 class="mdui-typo-headline-medium">GitHub文件管理器</h1>
                <p class="mdui-typo-body-1">请选择要管理的文件夹路径</p>
                <mdui-button class="logout-btn" variant="outlined" color="error" onclick="logout()">登出</mdui-button>
            </div>
            
            <div class="card-body">
                <div class="path-grid">
                    ${pathConfigs.map((config, index) => `
                        <div class="path-card">
                            <div class="path-icon">
                                <mdui-icon name="folder--outlined" size="48px"></mdui-icon>
                            </div>
                            <h3 class="mdui-typo-headline-small path-name">${escapeHtml(config.displayName)}</h3>
                            <p class="mdui-typo-body-2 path-info">路径: ${escapeHtml(config.path || '根目录')}</p>
                            <mdui-button 
                                href="/${config.name}" 
                                variant="filled" 
                                color="primary"
                                full-width
                                size="large"
                            >
                                进入管理
                            </mdui-button>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    </div>
    
    <script>
        function logout() {
            if (confirm('确定要登出吗？')) {
                fetch('/api/logout', {
                    method: 'POST'
                }).then(() => {
                    window.location.href = '/login';
                }).catch(error => {
                    console.error('登出失败:', error);
                    window.location.href = '/login';
                });
            }
        }
    </script>
</body>
</html>`;
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

// 文件管理界面
function getFileManagerHTML(pathConfig, pathConfigs, env) {
  const apiBase = '/api/files/' + pathConfig.name;
  
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, shrink-to-fit=no"/>
    <meta name="renderer" content="webkit"/>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/mdui/2.1.4/mdui.css" />
    <script src="https://cdnjs.cloudflare.com/ajax/libs/mdui/2.1.4/mdui.global.js"></script>
    <title>GitHub文件管理器 - ${escapeHtml(pathConfig.displayName)}</title>
    <style>
        :root {
            --md-sys-color-primary: #1e40af;
            --md-sys-color-primary-container: #dbeafe;
            --md-sys-color-secondary: #374151;
            --md-sys-color-secondary-container: #e5e7eb;
            --md-sys-color-error: #b91c1c;
            --md-sys-color-error-container: #fef2f2;
            --md-sys-color-background: #f8fafc;
            --md-sys-color-surface: #ffffff;
            --md-sys-color-surface-variant: #f1f5f9;
            --md-sys-color-on-primary: #ffffff;
            --md-sys-color-on-secondary: #ffffff;
            --md-sys-color-on-error: #ffffff;
            --md-sys-color-on-background: #1e293b;
            --md-sys-color-on-surface: #1e293b;
            --md-sys-color-on-surface-variant: #475569;
        }
        
        body {
            font-family: 'Roboto', 'Helvetica', 'Arial', sans-serif;
            line-height: 1.6;
            color: var(--md-sys-color-on-background);
            background: var(--md-sys-color-background);
            min-height: 100vh;
            margin: 0;
            display: flex;
            flex-direction: column;
        }
        
        .app-container {
            display: flex;
            flex: 1;
            height: calc(100vh - 64px);
        }
        
        .sidebar {
            width: 280px;
            background: var(--md-sys-color-surface);
            border-right: 1px solid var(--md-sys-color-surface-variant);
            display: flex;
            flex-direction: column;
            box-shadow: 0 0 10px rgba(0,0,0,0.05);
        }
        
        .sidebar-header {
            padding: 24px;
            border-bottom: 1px solid var(--md-sys-color-surface-variant);
        }
        
        .sidebar-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--md-sys-color-on-surface);
        }
        
        .sidebar-subtitle {
            font-size: 14px;
            color: var(--md-sys-color-on-surface-variant);
        }
        
        .path-list {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        }
        
        .path-item {
            display: block;
            width: 100%;
            padding: 12px 16px;
            margin-bottom: 8px;
            border-radius: 8px;
            text-align: left;
            transition: all 0.2s ease;
            border: 1px solid transparent;
        }
        
        .path-item:hover {
            background: var(--md-sys-color-surface-variant);
        }
        
        .path-item.active {
            background: var(--md-sys-color-primary-container);
            color: var(--md-sys-color-primary);
            border-color: var(--md-sys-color-primary);
        }
        
        .sidebar-footer {
            padding: 16px;
            border-top: 1px solid var(--md-sys-color-surface-variant);
        }
        
        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .main-header {
            background: var(--md-sys-color-surface);
            padding: 16px 24px;
            border-bottom: 1px solid var(--md-sys-color-surface-variant);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .main-title {
            font-size: 20px;
            font-weight: 600;
            color: var(--md-sys-color-on-surface);
        }
        
        .header-actions {
            display: flex;
            gap: 12px;
        }
        
        .content-area {
            flex: 1;
            padding: 24px;
            overflow-y: auto;
        }
        
        .upload-section {
            background: var(--md-sys-color-surface);
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            margin-bottom: 24px;
        }
        
        .file-list {
            background: var(--md-sys-color-surface);
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            overflow: hidden;
        }
        
        .progress-container {
            margin-top: 20px;
        }
        
        .progress-item {
            margin-bottom: 16px;
        }
        
        .selected-files {
            margin-top: 20px;
        }
        
        .file-tag {
            display: inline-block;
            background: var(--md-sys-color-primary-container);
            color: var(--md-sys-color-primary);
            padding: 6px 12px;
            border-radius: 16px;
            font-size: 14px;
            margin-right: 8px;
            margin-bottom: 8px;
        }
        
        .empty-state {
            padding: 80px 20px;
            text-align: center;
            color: var(--md-sys-color-on-surface-variant);
        }
        
        .empty-state mdui-icon {
            opacity: 0.5;
        }
        
        .file-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        }
        
        .file-table th {
            background: var(--md-sys-color-surface-variant);
            padding: 16px 24px;
            text-align: left;
            font-weight: 500;
            color: var(--md-sys-color-on-surface-variant);
            border-bottom: 1px solid var(--md-sys-color-surface-variant);
        }
        
        .file-table td {
            padding: 16px 24px;
            border-bottom: 1px solid var(--md-sys-color-surface-variant);
            vertical-align: middle;
        }
        
        .file-table tr:hover {
            background: var(--md-sys-color-surface-variant);
        }
        
        .file-table tr:last-child td {
            border-bottom: none;
        }
        
        @media (max-width: 768px) {
            .app-container {
                flex-direction: column;
            }
            
            .sidebar {
                width: 100%;
                height: 200px;
                border-right: none;
                border-bottom: 1px solid var(--md-sys-color-surface-variant);
            }
            
            .path-list {
                padding: 12px;
            }
            
            .path-item {
                padding: 10px 12px;
                font-size: 14px;
            }
            
            .main-header {
                padding: 12px 16px;
            }
            
            .main-title {
                font-size: 18px;
            }
            
            .content-area {
                padding: 16px;
            }
            
            .upload-section {
                padding: 20px;
            }
            
            .header-actions {
                gap: 8px;
            }
            
            .header-actions mdui-button {
                font-size: 14px;
                padding: 6px 12px;
            }
        }
        
        @media (max-width: 480px) {
            .sidebar {
                height: 180px;
            }
            
            .sidebar-header {
                padding: 16px;
            }
            
            .sidebar-title {
                font-size: 16px;
            }
            
            .sidebar-subtitle {
                font-size: 12px;
            }
            
            .path-item {
                padding: 8px 10px;
                font-size: 13px;
            }
            
            .main-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 12px;
            }
            
            .header-actions {
                width: 100%;
                justify-content: space-between;
            }
            
            .content-area {
                padding: 12px;
            }
            
            .upload-section {
                padding: 16px;
            }
        }
    </style>
</head>
<body>
    <div class="app-container">
        <div style="position: relative; height: 100%;">
            <mdui-navigation-rail contained divider value="${pathConfig.name}">
                <div slot="top" style="padding: 16px; text-align: center;">
                    <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">GitHub文件管理器</div>
                    <div style="font-size: 12px; color: var(--md-sys-color-on-surface-variant);">选择文件夹路径</div>
                </div>
                
                ${pathConfigs.map(config => `
                    <mdui-navigation-rail-item 
                        icon="folder--outlined"
                        value="${config.name}"
                        href="/${config.name}"
                    >
                        ${escapeHtml(config.displayName)}
                    </mdui-navigation-rail-item>
                `).join('')}
                
                <mdui-button-icon 
                    icon="logout--outlined" 
                    slot="bottom" 
                    color="error"
                    onclick="if(confirm('确定要登出吗？')) { fetch('/api/logout', { method: 'POST' }).then(() => window.location.href = '/login').catch(() => window.location.href = '/login'); }"
                    style="margin-bottom: 16px;"></mdui-button-icon>
            </mdui-navigation-rail>
        </div>
        
        <div class="main-content">
            <div class="main-header">
                <div class="main-title">${escapeHtml(pathConfig.displayName)}</div>
                <div class="header-actions">
                    <mdui-button variant="outlined" color="primary" onclick="window.location.href='/'">
                        <mdui-icon slot="icon" name="arrow_back--outlined"></mdui-icon>
                        返回选择
                    </mdui-button>
                </div>
            </div>
            
            <div class="content-area">
                <div class="upload-section">
                    <h2 class="mdui-typo-headline-small">上传文件</h2>
                    <div style="margin-top: 20px; display: flex; gap: 12px; flex-wrap: wrap;">
                        <mdui-file-picker id="filePicker" multiple accept="*/*" label="选择文件"></mdui-file-picker>
                        <mdui-button id="uploadBtn" variant="filled" color="primary" onclick="window.uploadFiles()" size="medium">
                            <mdui-icon slot="icon" name="upload--outlined"></mdui-icon>
                            开始上传
                        </mdui-button>
                        <mdui-button id="refreshBtn" variant="outlined" color="primary" onclick="window.getFileList()" size="medium">
                            <mdui-icon slot="icon" name="refresh--outlined"></mdui-icon>
                            刷新文件列表
                        </mdui-button>
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
                        <tbody id="fileTableBody">
                        </tbody>
                    </table>
                    
                    <div id="emptyState" class="empty-state" style="display: none;">
                        <mdui-icon name="folder--outlined" size="64px" style="opacity: 0.5;"></mdui-icon>
                        <p style="margin-top: 20px; font-size: 16px;">当前目录为空</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
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
                                html += '<div style="font-size: 12px; color: var(--md-sys-color-on-surface-variant);">' + escapeHtml(file.path) + '</div>';
                                html += '</td>';
                                html += '<td>' + fileSize + '</td>';
                                html += '<td>';
                                html += '<div style="display: flex; gap: 8px; flex-wrap: wrap;">';
                                
                                const filePath = JSON.stringify(file.path);
                                const fileName = JSON.stringify(file.name);
                                const fileSha = JSON.stringify(file.sha);
                                
                                if (canPreviewFile) {
                                    html += "<mdui-button variant='text' color='primary' size='small' onclick='window.previewFile(" + filePath + ", " + fileName + ")'><mdui-icon slot='icon' name='visibility--outlined'></mdui-icon>查看</mdui-button>";
                                }
                                
                                html += "<mdui-button variant='text' color='primary' size='small' onclick='window.downloadFile(" + filePath + ", " + fileName + ")'><mdui-icon slot='icon' name='download--outlined'></mdui-icon>下载</mdui-button>";
                                html += "<mdui-button variant='text' color='error' size='small' onclick='window.deleteFile(" + filePath + ", " + fileSha + ")'><mdui-icon slot='icon' name='delete--outlined'></mdui-icon>删除</mdui-button>";
                                
                                // 文本文件显示编辑按钮
                                if (canPreviewFile && !file.name.match(/\\.(jpg|jpeg|png|gif|bmp|webp|pdf)$/i)) {
                                    html += "<mdui-button variant='text' color='primary' size='small' onclick='window.editFile(" + filePath + ", " + fileSha + ")'><mdui-icon slot='icon' name='edit--outlined'></mdui-icon>编辑</mdui-button>";
                                }
                                
                                html += '</div>';
                                html += '</td>';
                                html += '</tr>';
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
                        if (mdui && mdui.snackbar) {
                            mdui.snackbar({
                                message: '获取文件列表失败: ' + error.message,
                                type: 'error'
                            });
                        }
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
        
        function deleteFile(filePath, sha) {
            try {
                if (confirm('确定要删除文件 ' + filePath.split('/').pop() + ' 吗？')) {
                    fetch(apiBase, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ filePath: filePath, sha: sha })
                    })
                    .then(function(response) {
                        return response.json();
                    })
                    .then(function(data) {
                        if (data.success) {
                            if (mdui && mdui.snackbar) {
                                mdui.snackbar({
                                    message: '文件删除成功',
                                    type: 'success'
                                });
                            } else {
                                alert('文件删除成功');
                            }
                            window.getFileList();
                        } else {
                            if (mdui && mdui.snackbar) {
                                mdui.snackbar({
                                    message: data.error || '删除失败',
                                    type: 'error'
                                });
                            } else {
                                alert('删除失败: ' + (data.error || '未知错误'));
                            }
                        }
                    })
                    .catch(function(error) {
                        console.error('删除文件失败:', error);
                        if (mdui && mdui.snackbar) {
                            mdui.snackbar({
                                message: '删除文件失败',
                                type: 'error'
                            });
                        } else {
                            alert('删除文件失败');
                        }
                    });
                }
            } catch (error) {
                console.error('deleteFile函数执行失败:', error);
            }
        }
        
        function uploadFiles() {
            try {
                const filePicker = document.getElementById('filePicker');
                const files = filePicker.files;
                
                if (!files || files.length === 0) {
                    if (mdui && mdui.snackbar) {
                        mdui.snackbar({
                            message: '请先选择文件',
                            type: 'error'
                        });
                    } else {
                        alert('请先选择文件');
                    }
                    return;
                }
                
                // 检查文件大小
                const MAX_SIZE = 25 * 1024 * 1024;
                for (let i = 0; i < files.length; i++) {
                    if (files[i].size > MAX_SIZE) {
                        if (mdui && mdui.snackbar) {
                            mdui.snackbar({
                                message: '文件 ' + files[i].name + ' 超过25MB限制',
                                type: 'error'
                            });
                        } else {
                            alert('文件 ' + files[i].name + ' 超过25MB限制');
                        }
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
                    progressItem.innerHTML = '<div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span>' + escapeHtml(file.name) + '</span><span id="progress' + index + '">0%</span></div><mdui-linear-progress id="progressBar' + index + '" indeterminate></mdui-linear-progress>';
                    progressContainer.appendChild(progressItem);
                    
                    fetch(apiBase, {
                        method: 'POST',
                        body: formData
                    })
                    .then(function(response) {
                        return response.json();
                    })
                    .then(function(data) {
                        const progressBar = document.getElementById('progressBar' + index);
                        const progressText = document.getElementById('progress' + index);
                        
                        if (progressBar && progressText) {
                            if (data.success) {
                                progressBar.indeterminate = false;
                                progressBar.value = 100;
                                progressText.textContent = '100%';
                                if (mdui && mdui.snackbar) {
                                    mdui.snackbar({
                                        message: '文件 ' + file.name + ' 上传成功',
                                        type: 'success'
                                    });
                                }
                            } else {
                                progressBar.indeterminate = false;
                                progressBar.value = 0;
                                progressText.textContent = '失败';
                                if (mdui && mdui.snackbar) {
                                    mdui.snackbar({
                                        message: '文件 ' + file.name + ' 上传失败: ' + (data.error || '未知错误'),
                                        type: 'error'
                                    });
                                }
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
                        if (mdui && mdui.snackbar) {
                            mdui.snackbar({
                                message: '文件 ' + file.name + ' 上传失败',
                                type: 'error'
                            });
                        }
                        
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
        
        document.getElementById('filePicker').addEventListener('change', function(e) {
            const files = e.target.files;
            const selectedFilesContainer = document.getElementById('selectedFiles');
            
            if (files && files.length > 0) {
                let html = '';
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const fileSize = formatFileSize(file.size);
                    html += '<span class="file-tag">' + escapeHtml(file.name) + ' (' + fileSize + ')</span>';
                }
                selectedFilesContainer.innerHTML = html;
            } else {
                selectedFilesContainer.innerHTML = '';
            }
        });
        
        // 挂载函数到window对象
        window.getFileList = getFileList;
        window.previewFile = previewFile;
        window.downloadFile = downloadFile;
        window.editFile = editFile;
        window.deleteFile = deleteFile;
        window.uploadFiles = uploadFiles;
        
        document.addEventListener('DOMContentLoaded', function() {
            window.getFileList();
        });
    </script>
</body>
</html>`;
}

// 文件编辑页面
function getEditFileHTML(filename, sha, filePath, env) {
  const pathConfigs = getPathConfig(env);
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
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, shrink-to-fit=no"/>
    <meta name="renderer" content="webkit"/>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined" rel="stylesheet" />
    <link rel="stylesheet" href="https://unpkg.com/mdui@2/mdui.css" />
    <script src="https://unpkg.com/mdui@2/mdui.global.js"></script>
    <title>编辑文件 - ${escapeHtml(filename)}</title>
    <style>
        :root {
            --md-sys-color-primary: #1e40af;
            --md-sys-color-primary-container: #dbeafe;
            --md-sys-color-secondary: #374151;
            --md-sys-color-secondary-container: #e5e7eb;
            --md-sys-color-error: #b91c1c;
            --md-sys-color-error-container: #fef2f2;
            --md-sys-color-background: #f8fafc;
            --md-sys-color-surface: #ffffff;
            --md-sys-color-surface-variant: #f1f5f9;
            --md-sys-color-on-primary: #ffffff;
            --md-sys-color-on-secondary: #ffffff;
            --md-sys-color-on-error: #ffffff;
            --md-sys-color-on-background: #1e293b;
            --md-sys-color-on-surface: #1e293b;
            --md-sys-color-on-surface-variant: #475569;
        }
        
        body {
            font-family: 'Roboto', 'Helvetica', 'Arial', sans-serif;
            line-height: 1.6;
            color: var(--md-sys-color-on-background);
            background: var(--md-sys-color-background);
            min-height: 100vh;
            margin: 0;
        }
        
        .container {
            max-width: 1000px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            background: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
            padding: 24px;
            border-radius: 16px;
            margin-bottom: 24px;
            position: relative;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .back-btn {
            position: absolute;
            top: 16px;
            left: 16px;
        }
        
        .edit-section {
            background: var(--md-sys-color-surface);
            padding: 32px;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        
        .form-group {
            margin-bottom: 24px;
        }
        
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
            border: 1px solid var(--md-sys-color-surface-variant);
            border-radius: 8px;
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
            box-shadow: 0 0 0 2px var(--md-sys-color-primary-container);
        }
        
        .form-actions {
            display: flex;
            gap: 16px;
            margin-top: 32px;
            justify-content: flex-end;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 16px;
            }
            
            .header {
                padding: 20px;
            }
            
            .edit-section {
                padding: 24px;
            }
            
            textarea {
                min-height: 400px;
            }
            
            .form-actions {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <mdui-button class="back-btn" variant="text" color="white" onclick="window.history.back()" size="medium">
                <mdui-icon slot="icon" name="arrow_back--outlined"></mdui-icon>
                返回
            </mdui-button>
            <h1 class="mdui-typo-headline-medium" style="text-align: center;">编辑文件</h1>
            <p class="mdui-typo-body-1" style="text-align: center;">${escapeHtml(filename)}</p>
        </div>
        
        <div class="edit-section">
            <form id="editForm">
                <div class="form-group">
                    <label for="content">文件内容</label>
                    <textarea id="content" name="content" placeholder="请输入文件内容"></textarea>
                </div>
                
                <div class="form-group">
                    <label for="message">提交信息</label>
                    <mdui-text-field 
                        id="message" 
                        name="message" 
                        label="提交信息" 
                        placeholder="更新文件: ${escapeHtml(filename)}"
                        variant="outlined"
                    ></mdui-text-field>
                </div>
                
                <div class="form-actions">
                    <mdui-button variant="outlined" color="default" onclick="window.history.back()" size="medium">
                        取消
                    </mdui-button>
                    <mdui-button id="saveBtn" type="submit" variant="filled" color="primary" size="medium">
                        <mdui-icon slot="icon" name="save--outlined"></mdui-icon>
                        保存修改
                    </mdui-button>
                </div>
            </form>
        </div>
    </div>
    
    <script>
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
                    if (mdui && mdui.snackbar) {
                        mdui.snackbar({
                            message: '加载文件内容失败: ' + error.message,
                            type: 'error'
                        });
                    } else {
                        alert('加载文件内容失败');
                    }
                });
        }
        
        document.getElementById('editForm').addEventListener('submit', function(e) {
            e.preventDefault();
            
            const content = document.getElementById('content').value;
            const message = document.getElementById('message').value || 'Update file: ${escapeHtml(filename)}';
            
            if (!content) {
                if (mdui && mdui.snackbar) {
                    mdui.snackbar({
                        message: '文件内容不能为空',
                        type: 'error'
                    });
                } else {
                    alert('文件内容不能为空');
                }
                return;
            }
            
            const saveBtn = document.getElementById('saveBtn');
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<mdui-icon slot="icon" name="save--outlined"></mdui-icon>保存中...';
            
            fetch(apiBase, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
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
                saveBtn.innerHTML = '<mdui-icon slot="icon" name="save--outlined"></mdui-icon>保存修改';
                
                if (data.success) {
                    if (mdui && mdui.snackbar) {
                        mdui.snackbar({
                            message: '文件修改成功',
                            type: 'success'
                        });
                    } else {
                        alert('文件修改成功');
                    }
                    setTimeout(() => {
                        window.history.back();
                    }, 1500);
                } else {
                    if (mdui && mdui.snackbar) {
                        mdui.snackbar({
                            message: data.error || '修改失败',
                            type: 'error'
                        });
                    } else {
                        alert('修改失败: ' + (data.error || '未知错误'));
                    }
                }
            })
            .catch(error => {
                console.error('保存文件失败:', error);
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<mdui-icon slot="icon" name="save--outlined"></mdui-icon>保存修改';
                if (mdui && mdui.snackbar) {
                    mdui.snackbar({
                        message: '保存文件失败: ' + error.message,
                        type: 'error'
                    });
                } else {
                    alert('保存文件失败');
                }
            });
        });
        
        window.onload = function() {
            loadFileContent();
        };
        
        function escapeHtml(str) {
            if (!str) return '';
            return str.replace(/[&<>]/g, function(m) {
                if (m === '&') return '&amp;';
                if (m === '<') return '&lt;';
                if (m === '>') return '&gt;';
                return m;
            });
        }
    </script>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathConfigs = getPathConfig(env);
    
    // 登录页面（不需要认证）
    if (url.pathname === '/login') {
      return new Response(getLoginHTML(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    // 登录API（不需要认证）
    if (url.pathname === '/api/login') {
      return await handleLogin(request, env);
    }
    
    // 登出API（需要认证）
    if (url.pathname === '/api/logout') {
      if (!verifySession(request, env)) {
        return new Response(null, {
          status: 302,
          headers: { 'Location': '/login' }
        });
      }
      return await handleLogout(request, env);
    }
    
    // 检查会话认证（除了登录相关页面）
    if (!verifySession(request, env)) {
      return new Response(null, {
        status: 302,
        headers: { 'Location': '/login' }
      });
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
        return new Response(getFileManagerHTML(pathConfig, pathConfigs, env), {
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
          return await getFiles(env, pathConfig);
        } else if (request.method === 'POST') {
          return await uploadFile(request, env, pathConfig);
        } else if (request.method === 'DELETE') {
          return await deleteFile(request, env, pathConfig);
        } else if (request.method === 'PUT') {
          return await updateFile(request, env, pathConfig);
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
      
      return new Response(getEditFileHTML(filename, sha, filePath, env), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    // 处理下载代理请求
    if (url.pathname === '/api/download') {
      return await downloadProxy(request, env);
    }
    
    return new Response('Not Found', { status: 404 });
  }
};