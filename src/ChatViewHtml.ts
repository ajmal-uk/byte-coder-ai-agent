
import * as vscode from 'vscode';

export class ChatViewHtml {
    public static getHtml(webview: vscode.Webview, extensionUri: vscode.Uri, icons: any): string {
        const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'images', 'logo.png'));

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' https:; img-src ${webview.cspSource} https: data:; font-src https:;">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            
            <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
            <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

            <style>
                :root {
                    /* Base Colors */
                    --bg-app: var(--vscode-sideBar-background);
                    --bg-hover: var(--vscode-list-hoverBackground);
                    --text-primary: var(--vscode-editor-foreground);
                    --text-secondary: var(--vscode-descriptionForeground);
                    --border: var(--vscode-panel-border);
                    --accent: var(--vscode-button-background);
                    --accent-foreground: var(--vscode-button-foreground);
                    --accent-hover: var(--vscode-button-hoverBackground);
                    --input-bg: var(--vscode-input-background);
                    --input-fg: var(--vscode-input-foreground);
                    --input-border: var(--vscode-input-border);
                    
                    /* Premium Gradients & Effects */
                    /* Logo Palette: Blue -> Cyan -> Yellow -> Orange */
                    /* Logo Palette: Cyan -> Blue -> Gold -> Orange */
                    --gradient-primary: linear-gradient(135deg, #00C6FF 0%, #0072FF 40%, #FFD700 70%, #FF7F00 100%);
                    --accent: #0072FF;
                    --gradient-overlay: linear-gradient(180deg, rgba(255,255,255,0.02), transparent);
                    --glass-bg: rgba(30, 30, 30, 0.6);
                    --glass-border: rgba(255, 255, 255, 0.08);
                    
                    /* Shadows */
                    --shadow-sm: 0 2px 8px rgba(0,0,0,0.1);
                    --shadow-md: 0 6px 16px rgba(0,0,0,0.15);
                    --shadow-lg: 0 12px 32px rgba(0,0,0,0.25);
                    --shadow-glow: 0 0 20px rgba(59, 130, 246, 0.15);
                    
                    /* Code Blocks */
                    --code-bg: var(--vscode-editor-background);
                    --code-header-bg: var(--vscode-editorGroupHeader-tabsBackground);
                    
                    /* Font Fallbacks */
                    --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
                }

                body {
                    margin: 0; padding: 0;
                    background: var(--bg-app);
                    color: var(--text-primary);
                    font-family: var(--vscode-font-family, 'Inter', system-ui, sans-serif);
                    height: 100vh;
                    display: flex; flex-direction: column;
                    overflow: hidden;
                    background-image: radial-gradient(circle at top right, rgba(59, 130, 246, 0.03), transparent 400px);
                }

                /* Premium Scrollbar */
                ::-webkit-scrollbar { width: 6px; height: 6px; }
                ::-webkit-scrollbar-thumb { background: rgba(127,127,127,0.2); border-radius: 3px; }
                ::-webkit-scrollbar-thumb:hover { background: rgba(127,127,127,0.4); }
                ::-webkit-scrollbar-track { background: transparent; }

                /* Glass Header */
                header {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 0 16px; height: 50px;
                    border-bottom: 1px solid var(--border);
                    background: var(--bg-app); position: sticky; top: 0; z-index: 10;
                    backdrop-filter: blur(16px);
                    -webkit-backdrop-filter: blur(16px);
                    position: relative;
                }
                
                header::after {
                    content: ''; position: absolute; bottom: -1px; left: 0; right: 0;
                    height: 1px;
                    background: linear-gradient(90deg, transparent, var(--accent), transparent);
                    opacity: 0.6;
                }

                .brand {
                    font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 10px;
                    background: var(--gradient-primary);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    letter-spacing: -0.01em;
                }
                .logo-img { 
                    width: 24px; height: 24px; object-fit: contain; 
                    filter: drop-shadow(0 2px 4px rgba(59, 130, 246, 0.25)); 
                    transition: transform 0.3s ease;
                }
                .brand:hover .logo-img { transform: rotate(10deg) scale(1.05); }
                
                .header-actions { display: flex; align-items: center; gap: 6px; }

                .btn-icon {
                    background: transparent; border: 1px solid transparent; color: var(--text-secondary);
                    cursor: pointer; padding: 6px; border-radius: 8px;
                    display: flex; align-items: center; justify-content: center;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .btn-icon:hover { 
                    background: var(--bg-hover); color: var(--text-primary); 
                    transform: translateY(-1px);
                    box-shadow: var(--shadow-sm);
                }
                .btn-icon:active { transform: translateY(0); }

                /* Chat Area */
                #chat-container {
                    flex: 1; overflow-y: auto; padding: 14px 18px;
                    display: flex; flex-direction: column; gap: 12px;
                    scroll-behavior: smooth;
                    mask-image: linear-gradient(to bottom, transparent, black 16px);
                    -webkit-mask-image: linear-gradient(to bottom, transparent, black 16px);
                }

                /* Messages */
                .message { 
                    display: flex; flex-direction: column; gap: 6px; 
                    max-width: 100%; 
                    animation: slideIn 0.35s cubic-bezier(0.2, 0.8, 0.2, 1); 
                }
                @keyframes slideIn { from { opacity: 0; transform: translateY(16px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
                
                .content { position: relative; font-size: 14px; line-height: 1.6; word-wrap: break-word; }
                
                /* User Message */
                .message.user { align-items: flex-end; }
                .message.user .content {
                    background: var(--accent); color: var(--accent-foreground);
                    padding: 12px 18px; border-radius: 18px;
                    border-bottom-right-radius: 4px;
                    max-width: 85%;
                    box-shadow: var(--shadow-md);
                    border: 1px solid rgba(255,255,255,0.1);
                    background-image: var(--gradient-overlay);
                }

                /* Assistant Message */
                .message.assistant { align-items: flex-start; width: 100%; }
                .message.assistant .content {
                    padding-left: 4px; color: var(--text-primary); width: 100%;
                }

                /* Markdown Styles */
                .content p { margin: 8px 0; }
                .content p:first-child { margin-top: 0; }
                .content p:last-child { margin-bottom: 0; }
                .content strong { font-weight: 600; color: var(--text-primary); }
                .content a { color: var(--accent); text-decoration: none; }
                .content a:hover { text-decoration: underline; }
                
                /* Inline Code */
                .content :not(pre) > code {
                    font-family: var(--font-mono); font-size: 12px;
                    background: rgba(127,127,127,0.12); padding: 3px 6px; border-radius: 6px; 
                    color: var(--text-primary);
                    border: 1px solid rgba(127,127,127,0.1);
                }
                
                /* Code Blocks - Premium */
                .content pre {
                    background: var(--code-bg);
                    border: 1px solid var(--border); border-radius: 12px;
                    margin: 16px 0; overflow: hidden;
                    box-shadow: var(--shadow-md);
                    transition: all 0.2s ease;
                }
                .content pre:hover {
                    box-shadow: var(--shadow-lg);
                    border-color: var(--accent);
                }
                
                .code-header {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 10px 16px; background: var(--code-header-bg);
                    border-bottom: 1px solid var(--border);
                }
                
                .window-dots { display: flex; gap: 6px; opacity: 0.7; }
                .dot { width: 10px; height: 10px; border-radius: 50%; }
                .dot.red { background: #ff5f56; }
                .dot.yellow { background: #ffbd2e; }
                .dot.green { background: #27c93f; }
                
                .code-lang { 
                    font-size: 11px; font-weight: 700; color: var(--text-secondary); 
                    text-transform: uppercase; letter-spacing: 0.5px;
                }
                
                .code-actions { display: flex; gap: 8px; }

                .copy-btn {
                    padding: 4px 8px; font-size: 11px; border-radius: 6px;
                    background: rgba(255,255,255,0.05); border: 1px solid transparent;
                    color: var(--text-secondary); cursor: pointer;
                    display: flex; align-items: center; gap: 6px;
                    transition: all 0.2s; font-weight: 500;
                }
                .copy-btn:hover { 
                    background: var(--accent); color: white; border-color: transparent;
                    transform: translateY(-1px);
                }
                
                .content pre code { 
                    display: block; padding: 16px; overflow-x: auto; 
                    font-size: 13px; line-height: 1.5;
                }

                /* Typing Indicator */
                .typing-indicator {
                    padding: 12px 18px; background: var(--bg-hover);
                    border-radius: 20px; border-bottom-left-radius: 4px;
                    display: flex; gap: 5px; align-items: center;
                    width: fit-content; margin-top: 8px;
                    box-shadow: var(--shadow-sm);
                }
                .typing-dot {
                    width: 6px; height: 6px; background: var(--text-secondary); border-radius: 50%; opacity: 0.6;
                    animation: bounce 1.4s infinite ease-in-out both;
                }
                .typing-dot:nth-child(1) { animation-delay: -0.32s; }
                .typing-dot:nth-child(2) { animation-delay: -0.16s; }
                @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }

                /* Input Section - Floating Style */
                .input-section {
                    padding: 20px; background: transparent;
                    position: relative; z-index: 20;
                }
                /* Gradient Mask for scroll transition */
                .input-section::before {
                    content: ''; position: absolute; inset: 0;
                    background: var(--bg-app);
                    mask-image: linear-gradient(to bottom, transparent, black 12px);
                    -webkit-mask-image: linear-gradient(to bottom, transparent, black 12px);
                    backdrop-filter: blur(8px);
                    z-index: -1;
                    border-top: 1px solid var(--border);
                }

                .input-box {
                    background: var(--input-bg); border: 1px solid var(--border);
                    border-radius: 16px; padding: 12px 14px;
                    display: flex; flex-direction: column; gap: 8px;
                    transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
                    box-shadow: var(--shadow-md);
                }
                
                /* Highlighting */
                .input-wrapper { position: relative; width: 100%; }
                .input-highlight {
                    position: absolute; top: 0; left: 0; right: 0;
                    pointer-events: none; white-space: pre-wrap; word-wrap: break-word;
                    font-family: inherit; font-size: 14px; line-height: 1.4;
                    padding: 4px 0; color: transparent;
                    max-height: 200px; overflow: hidden;
                }
                .input-highlight .mention {
                    color: transparent; background: rgba(59, 130, 246, 0.2);
                    border-radius: 4px; padding: 0 2px;
                    box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.3);
                }
                .input-highlight .command {
                    color: transparent; background: rgba(249, 115, 22, 0.2);
                    border-radius: 4px; padding: 0 2px;
                    box-shadow: 0 0 0 1px rgba(249, 115, 22, 0.3);
                }

                textarea {
                    position: relative; z-index: 1;
                    width: 100%; border: none; background: transparent; color: var(--input-fg);
                    font-family: inherit; font-size: 14px; resize: none; outline: none;
                    max-height: 200px; min-height: 24px; padding: 4px 0; line-height: 1.4;
                }
                
                .input-actions { display: flex; justify-content: flex-end; align-items: center; }
                
                .btn-send {
                    background: var(--accent); color: white; border: none;
                    border-radius: 10px; width: 34px; height: 34px;
                    cursor: pointer; display: flex; align-items: center; justify-content: center;
                    transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
                    box-shadow: var(--shadow-sm);
                }
                .btn-send:hover { background: var(--accent-hover); transform: scale(1.1) rotate(-10deg); box-shadow: var(--shadow-glow); }
                .btn-send span { display: none; }

                .btn-stop {
                    background: #ef4444; color: white; border: none;
                    border-radius: 10px; width: 34px; height: 34px;
                    cursor: pointer; display: none; align-items: center; justify-content: center;
                    transition: all 0.2s;
                }
                .btn-stop:hover { background: #dc2626; transform: scale(1.05); }

                /* Session Drawer - Full Window Overlay */
                #session-drawer {
                    position: absolute; top: 0; right: 0; bottom: 0; width: 0;
                    background: var(--bg-app); 
                    transition: width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
                    overflow: hidden; z-index: 100;
                    display: flex; flex-direction: column;
                }
                #session-drawer.open { width: 100%; }
                
                .drawer-header {
                    padding: 0; border-bottom: 1px solid var(--border);
                    background: var(--bg-app);
                    display: flex; flex-direction: column;
                }

                .drawer-top-bar {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 16px 20px 8px 20px;
                    font-size: 13px; font-weight: 600; color: var(--text-secondary);
                }

                .search-container {
                    padding: 0 16px 16px 16px;
                }
                
                .session-search-input {
                    box-sizing: border-box; /* ensure padding doesn't overflow */
                    width: 100%;
                    padding: 8px 12px;
                    border-radius: 8px;
                    background: var(--input-bg);
                    border: 1px solid var(--border);
                    color: var(--text-primary);
                    font-family: inherit; font-size: 13px;
                    outline: none; transition: all 0.2s;
                }
                .session-search-input:focus {
                    border-color: var(--accent);
                    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
                }
                .session-search-input::placeholder { color: var(--text-secondary); opacity: 0.7; }

                .session-list { flex: 1; overflow-y: auto; padding: 12px 16px; }
                
                /* Session Group Header */
                .session-group-header {
                    padding: 8px 4px; font-size: 11px; font-weight: 600; 
                    color: var(--text-secondary); text-transform: uppercase; 
                    margin-top: 12px; letter-spacing: 0.5px;
                }
                .session-group-header:first-child { margin-top: 0; }

                /* Session Item Card */
                .session-link {
                    padding: 12px; border-radius: 12px; cursor: pointer;
                    display: flex; justify-content: space-between; align-items: center;
                    margin-bottom: 6px; border: 1px solid transparent;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                    background: transparent;
                }
                .session-link:hover { 
                    background: var(--bg-hover); 
                    transform: translateY(-1px);
                    box-shadow: var(--shadow-sm);
                }
                
                /* Current Active Session Styling */
                .session-link.active { 
                    background: rgba(59, 130, 246, 0.1); 
                    border: 1px solid rgba(59, 130, 246, 0.2); 
                }
                .session-link.active .session-title { color: var(--accent); font-weight: 600; }
                
                .session-info { display: flex; flex-direction: column; gap: 4px; overflow: hidden; flex: 1; margin-right: 12px; }
                
                .session-title {
                    font-size: 13px; color: var(--text-primary);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .session-meta {
                    display: flex; align-items: center; gap: 6px;
                    font-size: 11px; color: var(--text-secondary);
                }

                .session-actions {
                    display: flex; align-items: center; gap: 4px; opacity: 0;
                    transition: opacity 0.2s;
                }
                .session-link:hover .session-actions, .session-link.active .session-actions { opacity: 1; }
                
                .btn-session-action {
                    color: var(--text-secondary); cursor: pointer; padding: 6px; 
                    border-radius: 6px; transition: all 0.2s;
                    display: flex; align-items: center; justify-content: center;
                    border: none; background: transparent;
                }
                .btn-session-action:hover { background: var(--bg-hover); color: var(--text-primary); }
                .btn-session-action.delete:hover { color: #ef4444; background: rgba(239, 68, 68, 0.1); }
                
                .drawer-footer { padding: 16px; border-top: 1px solid var(--border); background: var(--bg-app); }
                .btn-clear {
                    width: 100%; border: 1px solid var(--border); color: #ef4444; background: transparent;
                    padding: 10px; border-radius: 8px; font-size: 12px; cursor: pointer; font-weight: 500;
                    display: flex; align-items: center; justify-content: center; gap: 8px;
                    transition: all 0.2s;
                }
                .btn-clear:hover { background: rgba(239, 68, 68, 0.08); border-color: #ef4444; transform: translateY(-1px); }

                @keyframes fadeIn { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }

                /* Premium Empty State */
                .empty-state {
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    text-align: center; height: 100%; padding-bottom: 40px;
                    position: relative;
                }
                
                /* Floating Particles Background */
                .empty-state::before {
                    content: ''; position: absolute; width: 200px; height: 200px;
                    background: radial-gradient(circle, rgba(59, 130, 246, 0.1) 0%, transparent 70%);
                    border-radius: 50%; filter: blur(40px);
                    animation: float 10s infinite ease-in-out;
                    z-index: -1;
                }
                @keyframes float { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-20px, 20px) scale(1.1); } }

                .empty-greeting {
                    font-size: 32px; font-weight: 800; 
                    background: var(--gradient-primary); 
                    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
                    margin-bottom: 16px; letter-spacing: -0.5px;
                    filter: drop-shadow(0 4px 10px rgba(0, 114, 255, 0.2));
                }
                .empty-subtitle {
                    font-size: 14px; color: var(--text-secondary); margin-bottom: 32px; max-width: 280px; line-height: 1.5;
                }
                
                .quick-actions {
                    display: grid; grid-template-columns: 1fr 1fr; gap: 12px; width: 100%; max-width: 360px;
                }
                .action-card {
                    background: var(--bg-hover); border: 1px solid var(--border);
                    border-radius: 16px; padding: 20px; cursor: pointer;
                    display: flex; flex-direction: column; gap: 10px; align-items: flex-start;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
                    position: relative; overflow: hidden;
                    backdrop-filter: blur(10px);
                }
                .action-card:hover { 
                    transform: translateY(-5px);
                    box-shadow: 0 12px 30px -10px rgba(0, 0, 0, 0.2);
                    border-color: var(--accent);
                    background: linear-gradient(180deg, var(--bg-hover) 0%, rgba(59, 130, 246, 0.05) 100%);
                }
                
                .action-icon {
                    width: 44px; height: 44px; border-radius: 12px;
                    background: linear-gradient(135deg, rgba(59,130,246,0.1), rgba(139,92,246,0.1));
                    color: var(--accent);
                    display: flex; align-items: center; justify-content: center; font-size: 20px;
                    transition: all 0.3s ease; box-shadow: 0 4px 6px -2px rgba(0,0,0,0.05);
                }
                .action-card:hover .action-icon { 
                    transform: scale(1.1); 
                    background: linear-gradient(135deg, var(--accent), #8b5cf6); 
                    color: white;
                    box-shadow: 0 8px 12px -4px rgba(59, 130, 246, 0.4);
                }
                
                .action-title { font-size: 14px; font-weight: 700; color: var(--text-primary); margin-top: 4px; }
                .action-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.5; font-weight: 500; }

                /* Command Popup Styling */
                .command-popup {
                    position: absolute; bottom: 100%; left: 0; right: 0;
                    background: var(--bg-app); border: 1px solid var(--border);
                    border-radius: 12px; padding: 6px; margin-bottom: 12px;
                    box-shadow: var(--shadow-lg);
                    display: none; animation: slideUp 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
                    backdrop-filter: blur(16px);
                }
                .command-popup.show { display: block; }
                @keyframes slideUp { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
                
                .command-item {
                    padding: 8px 12px; border-radius: 8px; cursor: pointer;
                    display: flex; align-items: center; gap: 10px;
                    transition: all 0.1s ease;
                }
                .command-item:hover, .command-item.selected { background: var(--accent); color: white; }
                .command-item:hover .cmd-key, .command-item.selected .cmd-key { color: white; }
                .command-item:hover .cmd-desc, .command-item.selected .cmd-desc { color: rgba(255,255,255,0.8); }

                .cmd-key {
                    font-family: var(--font-mono); font-size: 12px;
                    font-weight: 600; color: var(--accent); min-width: 80px;
                }
                .cmd-desc { font-size: 12px; color: var(--text-secondary); }

                /* File Popup */
                .file-popup {
                    position: absolute; bottom: 100%; left: 0; right: 0;
                    background: var(--bg-app); border: 1px solid var(--border);
                    border-radius: 12px; padding: 6px; margin-bottom: 12px;
                    box-shadow: var(--shadow-lg);
                    max-height: 240px; overflow-y: auto;
                    display: none; animation: slideUp 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
                    backdrop-filter: blur(16px);
                }
                .file-popup.show { display: block; }

                .file-item {
                    padding: 6px 10px; border-radius: 8px; cursor: pointer;
                    display: flex; align-items: center; gap: 8px;
                    font-size: 13px; color: var(--text-secondary);
                    transition: all 0.1s ease;
                }
                .file-item:hover, .file-item.selected { background: var(--accent); color: white; }
                .file-item:hover .file-path, .file-item.selected .file-path { color: rgba(255,255,255,0.7); }
                .file-item:hover .file-icon, .file-item.selected .file-icon { color: white !important; }
                
                .file-icon { 
                    font-size: 16px; width: 16px; height: 16px; 
                    display: flex; align-items: center; justify-content: center;
                    opacity: 0.8;
                }
                
                .file-info {
                    display: flex; flex-direction: column; overflow: hidden;
                }
                .file-name {
                    font-weight: 500; font-size: 12px; color: var(--text-primary);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .file-path {
                    font-size: 9px; color: var(--text-secondary); opacity: 0.7;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                
                /* Icon Colors */
                .icon-ts { color: #3178c6; }
                .icon-js { color: #f7df1e; }
                .icon-json { color: #f1c40f; }
                .icon-md { color: #adadad; }
                .icon-css { color: #264de4; }
                .icon-html { color: #e34c26; }
                .icon-py { color: #3572A5; }

                /* Settings Drawer */
                #settings-drawer {
                    position: absolute; top: 0; right: 0; bottom: 0; width: 0;
                    background: var(--bg-app);
                    transition: width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
                    overflow: hidden; z-index: 100;
                    display: flex; flex-direction: column;
                }
                #settings-drawer.open { width: 100%; }

                .settings-content { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 24px; }
                
                .setting-group { display: flex; flex-direction: column; gap: 8px; }
                .setting-label { font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
                .setting-desc { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
                
                .setting-input {
                    background: var(--input-bg); border: 1px solid var(--border); color: var(--text-primary);
                    padding: 10px; border-radius: 8px; font-family: inherit; font-size: 13px; resize: vertical;
                    min-height: 80px; outline: none; transition: border-color 0.2s;
                }
                .setting-input:focus { border-color: var(--accent); }

                /* Range Slider */
                .range-container { display: flex; align-items: center; gap: 12px; }
                input[type=range] {
                    flex: 1; height: 4px; border-radius: 2px;
                    background: var(--bg-hover); outline: none; -webkit-appearance: none;
                }
                input[type=range]::-webkit-slider-thumb {
                    -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%;
                    background: var(--accent); cursor: pointer; border: 2px solid var(--bg-app);
                    box-shadow: 0 0 0 1px var(--accent);
                }
                #tempValue { font-family: var(--font-mono); font-size: 13px; width: 30px; text-align: right; }

                /* Toggle Switch */
                .setting-row { display: flex; justify-content: space-between; align-items: center; }
                .switch { position: relative; display: inline-block; width: 40px; height: 20px; }
                .switch input { opacity: 0; width: 0; height: 0; }
                .slider {
                    position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
                    background-color: var(--bg-hover); transition: .4s; border-radius: 20px;
                }
                .slider:before {
                    position: absolute; content: ""; height: 16px; width: 16px;
                    left: 2px; bottom: 2px; background-color: white; transition: .4s; border-radius: 50%;
                }
                input:checked + .slider { background-color: var(--accent); }
                input:checked + .slider:before { transform: translateX(20px); }

                /* Toast Notifications */
                #toast-container {
                    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
                    z-index: 1000; display: flex; flex-direction: column; gap: 8px;
                    width: 90%; max-width: 400px; pointer-events: none;
                }
                .toast {
                    background: var(--bg-app); border: 1px solid rgba(239, 68, 68, 0.3);
                    border-left: 3px solid #ef4444;
                    padding: 12px 16px; border-radius: 8px;
                    box-shadow: var(--shadow-lg); pointer-events: auto;
                    display: flex; align-items: flex-start; gap: 10px;
                    animation: toastSlide 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
                    backdrop-filter: blur(12px);
                }
                @keyframes toastSlide { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
                .toast-icon { color: #ef4444; flex-shrink: 0; margin-top: 2px; }
                .toast-content { flex: 1; font-size: 13px; color: var(--text-primary); line-height: 1.4; }
                .toast-close {
                    color: var(--text-secondary); cursor: pointer; padding: 4px;
                    border-radius: 4px; border: none; background: transparent;
                    transition: all 0.2s;
                }
                .toast-close:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; }

            </style>
        </head>
        <body>
            <header>
                <div class="brand">
                    <img src="${logoUri}" class="logo-img" alt="Logo">
                </div>
                <div class="header-actions">
                    <button class="btn-icon" onclick="exportChat()" title="Export Chat">${icons.download}</button>
                    <button class="btn-icon" onclick="newChat()" title="New Chat">${icons.plus}</button>
                    <button class="btn-icon" onclick="toggleDrawer()" title="History">${icons.history}</button>
                    <button class="btn-icon" onclick="toggleSettings()" title="Settings">${icons.settings}</button>
                </div>
            </header>

            <div id="session-drawer">
                <div class="drawer-header">
                    <div class="drawer-top-bar">
                        <span>Select a conversation</span>
                        <button class="btn-icon" onclick="toggleDrawer()" title="Close">×</button>
                    </div>
                    <div class="search-container">
                        <input type="text" class="session-search-input" id="sessionSearchInput" placeholder="Search conversations...">
                    </div>
                </div>
                <div class="session-list" id="sessionList"></div>
                <div class="drawer-footer">
                    <button class="btn-clear" onclick="clearAllSessions()">${icons.trash} Clear All</button>
                </div>
            </div>

            <div id="settings-drawer">
                <div class="drawer-header">
                    <div class="drawer-top-bar">
                        <span>Settings</span>
                        <button class="btn-icon" onclick="toggleSettings()" title="Close">×</button>
                    </div>
                </div>
                <div class="settings-content">
                    <div class="setting-group">
                        <div class="setting-label">CUSTOM INSTRUCTIONS</div>
                        <div class="setting-desc">Define the AI's persona and behavior.</div>
                        <textarea id="customInstructions" class="setting-input" rows="4" placeholder="E.g. You are an expert Python developer. Be concise."></textarea>
                    </div>

                    <div class="setting-group">
                        <div class="setting-label">CREATIVITY (Temperature)</div>
                        <div class="setting-desc">Adjust response randomness (0.0 - 1.0).</div>
                        <div class="range-container">
                            <input type="range" id="tempSlider" min="0" max="1" step="0.1" value="0.7" oninput="updateTempLabel(this.value)">
                            <span id="tempValue">0.7</span>
                        </div>
                    </div>

                    <div class="setting-group">
                         <div class="setting-row">
                             <div>
                                 <div class="setting-label">AUTO-CONTEXT</div>
                                 <div class="setting-desc">Automatically gather relevant context.</div>
                             </div>
                             <label class="switch">
                                 <input type="checkbox" id="autoContext" checked>
                                 <span class="slider round"></span>
                             </label>
                         </div>
                    </div>
                </div>
                <div class="drawer-footer">
                    <button class="btn-clear" onclick="saveSettings()">${icons.check} Save Changes</button>
                </div>
            </div>

            <div id="chat-container">
                <div id="emptyState" class="empty-state">
                    <div class="empty-greeting">What can I help you build?</div>
                    <div class="empty-subtitle">Ask me anything about your code, or try one of these quick actions</div>
                    <div class="quick-actions">
                        <div class="action-card" onclick="executeCommand('explain')">
                            <div class="action-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></div>
                            <div class="action-title">Explain</div>
                            <div class="action-desc">Understand code logic</div>
                        </div>
                        <div class="action-card" onclick="executeCommand('fix')">
                            <div class="action-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg></div>
                            <div class="action-title">Fix Bugs</div>
                            <div class="action-desc">Debug & repair issues</div>
                        </div>
                        <div class="action-card" onclick="executeCommand('refactor')">
                            <div class="action-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg></div>
                            <div class="action-title">Refactor</div>
                            <div class="action-desc">Improve code quality</div>
                        </div>
                        <div class="action-card" onclick="executeCommand('test')">
                            <div class="action-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg></div>
                            <div class="action-title">Test</div>
                            <div class="action-desc">Generate unit tests</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="input-section">
                <div class="command-popup" id="commandPopup">
                    <div class="command-item" onclick="selectCommand('explain')">
                        <span class="cmd-key">/explain</span> <span class="cmd-desc">Explain selected code</span>
                    </div>
                    <div class="command-item" onclick="selectCommand('fix')">
                        <span class="cmd-key">/fix</span> <span class="cmd-desc">Fix bugs in selection</span>
                    </div>
                    <div class="command-item" onclick="selectCommand('refactor')">
                        <span class="cmd-key">/refactor</span> <span class="cmd-desc">Refactor selection</span>
                    </div>
                    <div class="command-item" onclick="selectCommand('test')">
                        <span class="cmd-key">/test</span> <span class="cmd-desc">Generate unit tests</span>
                    </div>
                    <div class="command-item" onclick="selectCommand('doc')">
                        <span class="cmd-key">/doc</span> <span class="cmd-desc">Generate documentation</span>
                    </div>
                    <div class="command-item" onclick="selectCommand('optimize')">
                        <span class="cmd-key">/optimize</span> <span class="cmd-desc">Optimize performance</span>
                    </div>
                    <div class="command-item" onclick="selectCommand('security')">
                        <span class="cmd-key">/security</span> <span class="cmd-desc">Security audit</span>
                    </div>
                    <div class="command-item" onclick="selectCommand('review')">
                        <span class="cmd-key">/review</span> <span class="cmd-desc">Code review</span>
                    </div>
                    <div class="command-item" onclick="selectCommand('convert')">
                        <span class="cmd-key">/convert</span> <span class="cmd-desc">Convert to other language</span>
                    </div>
                </div>
                
                <div class="file-popup" id="filePopup"></div>
                <div class="input-box">
                    <div class="input-wrapper">
                        <div class="input-highlight" id="inputHighlight"></div>
                        <textarea id="messageInput" placeholder="Ask anything, @ to mention, / for command..." rows="1"></textarea>
                    </div>
                    <div class="input-actions">
                        <button class="btn-send" id="sendBtn" title="Send">${icons.send}</button>
                        <button class="btn-stop" id="stopBtn" title="Stop Generation">${icons.stop}</button>
                    </div>
                </div>
            </div>

            <div id="toast-container"></div>
            <script>
                const vscode = acquireVsCodeApi();
                
                // Global Error Handler
                window.onerror = function(msg, source, lineno, colno, error) {
                    const div = document.createElement('div');
                    div.style.cssText = 'position:fixed;top:0;left:0;right:0;background:red;color:white;padding:10px;z-index:9999;font-family:monospace;font-size:12px;';
                    div.innerText = 'JS Error: ' + msg;
                    document.body.appendChild(div);
                    return false;
                };

                const chatContainer = document.getElementById('chat-container');
                const messageInput = document.getElementById('messageInput');
                const inputHighlight = document.getElementById('inputHighlight');
                const sendBtn = document.getElementById('sendBtn');
                const stopBtn = document.getElementById('stopBtn');
                const sessionDrawer = document.getElementById('session-drawer');
                const sessionList = document.getElementById('sessionList');
                const commandPopup = document.getElementById('commandPopup');
                const filePopup = document.getElementById('filePopup');
                const emptyState = document.getElementById('emptyState');
                
                // Update the highlight overlay with colored @mentions and /commands
                function updateHighlight() {
                    let text = messageInput.value;
                    // Escape HTML to prevent XSS
                    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    // Highlight @mentions (blue) - match @word patterns immediately
                    text = text.replace(/@([a-zA-Z0-9_./-]+)/g, '<span class="mention">@$1</span>');
                    // Highlight /commands (purple) - match /word at start or after space, no trailing space needed
                    text = text.replace(/(^|\\s)(\\/[a-zA-Z]+)/g, '$1<span class="command">$2</span>');
                    // Set the highlighted HTML
                    inputHighlight.innerHTML = text;
                }
                
                // Initialize highlighting on page load
                setTimeout(updateHighlight, 0);
                
                marked.setOptions({
                    highlight: function(code, lang) {
                        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                        return hljs.highlight(code, { language }).value;
                    },
                    langPrefix: 'hljs language-'
                });

                let isGenerating = false;
                let currentAssistantMessageDiv = null;
                
                // Debounce utility
                function debounce(fn, delay) {
                    let timeoutId;
                    return function(...args) {
                        clearTimeout(timeoutId);
                        timeoutId = setTimeout(() => fn.apply(this, args), delay);
                    };
                }
                
                // Debounced file search
                // Debounced file search (Faster)
                const debouncedFileSearch = debounce((query) => {
                    vscode.postMessage({ type: 'getFiles', query: query });
                }, 100);

                // Auto-resize & Input Handler
                messageInput.addEventListener('input', function() {
                    this.style.height = 'auto';
                    this.style.height = (this.scrollHeight) + 'px';
                    if (this.value === '') this.style.height = '24px';
                    
                    // Update syntax highlighting
                    updateHighlight();
                    
                    const val = this.value;
                    
                    // Mention Logic (@)
                    const lastAt = val.lastIndexOf('@');
                    if (lastAt !== -1) {
                         const searchStr = val.substring(lastAt + 1);
                         if (!searchStr.includes(' ') && !searchStr.includes('\\n')) {
                             debouncedFileSearch(searchStr);
                             filePopup.classList.add('show');
                             return;
                         }
                    }
                    filePopup.classList.remove('show');
                    
                    // Command Logic (/)
                    const lastSlash = val.lastIndexOf('/');
                    if (lastSlash !== -1) {
                        // Check if it's at start or after space
                        const charBefore = lastSlash > 0 ? val[lastSlash - 1] : ' ';
                        if (charBefore === ' ') {
                             const cmdStr = val.substring(lastSlash);
                             if (!cmdStr.includes(' ') && !cmdStr.includes('\\n')) {
                                commandPopup.classList.add('show');
                                return;
                             }
                        }
                    }
                    commandPopup.classList.remove('show');
                });
                
                // Send Message
                function sendMessage() {
                    const text = messageInput.value.trim();
                    if (!text || isGenerating) return;
                    
                    addMessage('user', text);
                    messageInput.value = '';
                    messageInput.style.height = '24px';
                    updateHighlight();
                    commandPopup.classList.remove('show');
                    filePopup.classList.remove('show');
                    
                    isGenerating = true;
                    updateUIState();
                    
                    // Show typing indicator
                    showTypingIndicator();
                    
                    vscode.postMessage({ type: 'sendMessage', value: text });
                }
                
                function showTypingIndicator() {
                    // Remove existing typing indicator
                    const existing = document.getElementById('typingIndicator');
                    if (existing) existing.remove();
                    
                    const indicator = document.createElement('div');
                    indicator.id = 'typingIndicator';
                    indicator.className = 'message assistant';
                    indicator.innerHTML = '<div class="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
                    chatContainer.appendChild(indicator);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
                
                function hideTypingIndicator() {
                    const indicator = document.getElementById('typingIndicator');
                    if (indicator) indicator.remove();
                }

                sendBtn.addEventListener('click', sendMessage);
                
                stopBtn.addEventListener('click', () => {
                    vscode.postMessage({ type: 'stopGeneration' });
                    isGenerating = false;
                    updateUIState();
                });

                messageInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (filePopup.classList.contains('show')) {
                             // If popup open, select first item
                             const first = filePopup.querySelector('.file-item');
                             if (first) first.click();
                             return;
                        }
                        if (commandPopup.classList.contains('show')) {
                             // If popup open, select first item
                             const first = commandPopup.querySelector('.command-item');
                             if (first) first.click();
                             return;
                        }
                        sendMessage();
                    }
                    // Navigation for popups could go here (ArrowUp/Down)
                    if (e.key === 'Escape') {
                        commandPopup.classList.remove('show');
                        filePopup.classList.remove('show');
                    }
                });

                function updateUIState() {
                    if (isGenerating) {
                        sendBtn.style.display = 'none';
                        stopBtn.style.display = 'flex';
                        messageInput.disabled = true;
                    } else {
                        sendBtn.style.display = 'flex';
                        stopBtn.style.display = 'none';
                        messageInput.disabled = false;
                        messageInput.focus();
                    }
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'addResponse':
                            hideTypingIndicator();
                            if (currentAssistantMessageDiv) {
                                currentAssistantMessageDiv.innerHTML = marked.parse(message.value);
                                enhanceCodeBlocks(currentAssistantMessageDiv.parentElement);
                                chatContainer.scrollTop = chatContainer.scrollHeight;
                            } else {
                                addMessage('assistant', message.value);
                            }
                            
                            if (!message.isStream) {
                                isGenerating = false;
                                currentAssistantMessageDiv = null;
                                updateUIState();
                            }
                            break;
                            
                        case 'setAndSendMessage':
                            messageInput.value = message.value;
                            updateHighlight();
                            if (!message.justSet) {
                                sendMessage();
                            } else {
                                messageInput.focus();
                            }
                            break;
                            
                        case 'sessionList':
                             renderSessionList(message.sessions, message.currentSessionId);
                             break;
                             
                        case 'loadSession':
                             chatContainer.innerHTML = '';
                             resetMessageIndex();
                             if (message.history.length === 0) {
                                 chatContainer.innerHTML = '<div id="emptyState" class="empty-state"><div class="empty-greeting">What can I help you build?</div><div class="empty-subtitle">Ask me anything about your code, or try one of these quick actions</div><div class="quick-actions"><div class="action-card" onclick="executeCommand(\\'explain\\')"><div class="action-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></div><div class="action-title">Explain</div><div class="action-desc">Understand code logic</div></div><div class="action-card" onclick="executeCommand(\\'fix\\')"><div class="action-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg></div><div class="action-title">Fix Bugs</div><div class="action-desc">Debug & repair issues</div></div><div class="action-card" onclick="executeCommand(\\'refactor\\')"><div class="action-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg></div><div class="action-title">Refactor</div><div class="action-desc">Improve code quality</div></div><div class="action-card" onclick="executeCommand(\\'test\\')"><div class="action-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg></div><div class="action-title">Test</div><div class="action-desc">Generate unit tests</div></div></div></div>';
                             } else {
                                 message.history.forEach(msg => {
                                     addMessage(msg.role, msg.text);
                                 });
                                 currentAssistantMessageDiv = null;
                             }
                             break;

                        case 'addMessage':
                           addMessage(message.role, message.value);
                           break;

                        case 'setGenerating':
                           isGenerating = true;
                           updateUIState();
                           showTypingIndicator();
                           break;

                        case 'error':
                           hideTypingIndicator();
                           isGenerating = false;
                           updateUIState();
                           // Use Toast instead of chat message
                           window.showToast(message.value);
                           break;

                        case 'fileList':
                           renderFiles(message.files);
                           break;

                        case 'updateSettings':
                           const s = message.value;
                           if (s) {
                               document.getElementById('customInstructions').value = s.customInstructions || '';
                               document.getElementById('tempSlider').value = s.temperature || 0.7;
                               document.getElementById('tempValue').innerText = s.temperature || 0.7;
                               document.getElementById('autoContext').checked = s.autoContext !== false;
                           }
                           break;
                    }
                });

                let messageIndex = 0;
                
                function addMessage(role, text) {
                    const currentIdx = messageIndex++;
                    const div = document.createElement('div');
                    div.className = 'message ' + role;
                    div.dataset.index = currentIdx;

                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'content';
                    contentDiv.innerHTML = marked.parse(text);

                    div.appendChild(contentDiv);

                    // Add Action Buttons
                    const actionsDiv = document.createElement('div');
                    actionsDiv.className = 'msg-actions';
                    actionsDiv.style.cssText = 'display:flex; gap:8px; margin-top:4px; opacity:0; transition:opacity 0.2s;';

                    if (role === 'assistant') {
                        // Regenerate Button
                        const regenBtn = document.createElement('button');
                        regenBtn.className = 'btn-icon';
                        regenBtn.innerHTML = '${icons.refresh}';
                        regenBtn.title = 'Regenerate this response';
                        regenBtn.onclick = () => {
                            vscode.postMessage({ type: 'regenerate', index: currentIdx });
                        };
                        actionsDiv.appendChild(regenBtn);
                    } else {
                        // Edit Button
                        const editBtn = document.createElement('button');
                        editBtn.className = 'btn-icon';
                        editBtn.innerHTML = '${icons.edit}';
                        editBtn.title = 'Edit and resend from here';
                        editBtn.onclick = () => {
                            vscode.postMessage({ type: 'editMessage', index: currentIdx });
                        };
                        actionsDiv.appendChild(editBtn);
                    }
                    div.appendChild(actionsDiv);

                    // Hover effect
                    div.onmouseenter = () => { actionsDiv.style.opacity = '1'; };
                    div.onmouseleave = () => { actionsDiv.style.opacity = '0'; };

                    chatContainer.appendChild(div);

                    // Auto-scroll
                    requestAnimationFrame(() => {
                        chatContainer.scrollTop = chatContainer.scrollHeight;
                    });

                    if (role === 'assistant') {
                        currentAssistantMessageDiv = contentDiv;
                        enhanceCodeBlocks(div);
                    }

                    // Remove empty state dynamically
                    const es = document.getElementById('emptyState');
                    if (es) es.remove();
                }
                
                function resetMessageIndex() {
                    messageIndex = 0;
                }

                function enhanceCodeBlocks(container) {
                    const contentDiv = container.querySelector('.content');
                    if (!contentDiv) return;

                    contentDiv.querySelectorAll('pre').forEach((pre) => {
                        if (pre.querySelector('.code-header')) return;

                        const code = pre.querySelector('code');
                        if (!code) return;

                        hljs.highlightElement(code);

                        const langClass = Array.from(code.classList).find(c => c.startsWith('language-'));
                        const lang = langClass ? langClass.replace('language-', '') : 'text';

                        const header = document.createElement('div');
                        header.className = 'code-header';
                        header.innerHTML = '<div class="window-dots"><div class="dot red"></div><div class="dot yellow"></div><div class="dot green"></div></div><span class="code-lang">' + lang.toUpperCase() + '</span>';
                        
                        const actions = document.createElement('div');
                        actions.className = 'code-actions';
                        
                        const copyBtn = document.createElement('button');
                        copyBtn.className = 'copy-btn';
                        copyBtn.innerHTML = '${icons.copy} Copy';
                        copyBtn.onclick = () => {
                            vscode.postMessage({ type: 'copyCode', value: code.innerText });
                            copyBtn.innerHTML = '${icons.check} Copied';
                            setTimeout(() => copyBtn.innerHTML = '${icons.copy} Copy', 2000);
                        };
                        actions.appendChild(copyBtn);
                        
                        const insertBtn = document.createElement('button');
                        insertBtn.className = 'copy-btn';
                        insertBtn.innerHTML = '${icons.zap} Insert';
                        insertBtn.title = 'Insert code at cursor in editor';
                        insertBtn.onclick = () => {
                            vscode.postMessage({ type: 'insertCode', value: code.innerText });
                            insertBtn.innerHTML = '${icons.check} Inserted';
                            setTimeout(() => insertBtn.innerHTML = '${icons.zap} Insert', 2000);
                        };
                        actions.appendChild(insertBtn);
                        
                        header.appendChild(actions);
                        pre.insertBefore(header, code);
                    });
                }
                
                function executeCommand(cmd) {
                    vscode.postMessage({ type: 'runCommand', command: cmd });
                }
                
                function selectCommand(cmd) {
                    messageInput.value = '/' + cmd + ' ';
                    updateHighlight();
                    messageInput.focus();
                    commandPopup.classList.remove('show');
                }

                function renderFiles(files) {
                    filePopup.innerHTML = '';
                    if (!files || files.length === 0) {
                        filePopup.classList.remove('show');
                        return;
                    }
                    
                    let selectedFileIndex = 0;
                    
                    files.forEach((file, index) => {
                        const div = document.createElement('div');
                        div.className = 'file-item';
                        if (index === selectedFileIndex) div.classList.add('selected');

                        // Determine Icon
                        const ext = file.path.split('.').pop().toLowerCase();
                        let iconChar = '📄';
                        let iconClass = 'file-icon';
                        
                        // Simple icon mapping
                        switch(ext) {
                            case 'ts': case 'tsx': iconChar = '{}'; iconClass += ' icon-ts'; break;
                            case 'js': case 'jsx': iconChar = '{}'; iconClass += ' icon-js'; break;
                            case 'json': iconChar = '{}'; iconClass += ' icon-json'; break;
                            case 'md': iconChar = 'M↓'; iconClass += ' icon-md'; break;
                            case 'css': case 'scss': iconChar = '#'; iconClass += ' icon-css'; break;
                            case 'html': iconChar = '<>'; iconClass += ' icon-html'; break;
                            case 'py': iconChar = 'py'; iconClass += ' icon-py'; break;
                            case 'png': case 'svg': case 'jpg': iconChar = '🖼️'; break;
                        }

                        // Split path for display
                        const pathParts = file.path.split('/');
                        const fileName = pathParts.pop();
                        const dirPath = pathParts.join('/');

                        div.innerHTML = \`
                            <span class="\${iconClass}">\${iconChar}</span>
                            <div class="file-info">
                                <span class="file-name">\${fileName}</span>
                                <span class="file-path">\${dirPath || './'}</span>
                            </div>
                        \`;
                        div.onclick = () => {
                            // Use cursor-aware replacement
                            const val = messageInput.value;
                            const cursorPos = messageInput.selectionStart;
                            const textBeforeCursor = val.substring(0, cursorPos);
                            const textAfterCursor = val.substring(cursorPos);
                            
                            // Find where the @ mention starts
                            const lastSpaceIndex = textBeforeCursor.lastIndexOf(' ');
                            const beforeAt = lastSpaceIndex === -1 ? '' : textBeforeCursor.substring(0, lastSpaceIndex + 1);
                            
                            // Insert formatted file tag: @[path] for cleaner parsing if you want, 
                            // or just @path. User mentioned "@[images/logo.png]" earlier.
                            // Let's stick to simple path for now, or match user preference.
                            // Actually, let's just insert the path, standard logic.
                            messageInput.value = beforeAt + '@' + file.path + ' ' + textAfterCursor.trim();
                            
                            filePopup.classList.remove('show');
                            messageInput.focus();
                            
                            // Set cursor position
                            const newPos = beforeAt.length + file.path.length + 2;
                            messageInput.setSelectionRange(newPos, newPos);
                            
                            // Update highlighting immediately
                            updateHighlight();
                        };
                        filePopup.appendChild(div);
                    });
                }
                
                
                // Override addMessage to hide empty state
                const originalAddMessage = addMessage;
                addMessage = function(role, text) {
                    const es = document.getElementById('emptyState');
                    if (es) es.remove();
                    return originalAddMessage(role, text);
                };

                function newChat() {
                    vscode.postMessage({ type: 'newChat' });
                }

                function exportChat() {
                    vscode.postMessage({ type: 'exportChat' });
                }

                function toggleDrawer() { 
                    try {
                        const sessionDrawer = document.getElementById('session-drawer');
                        const settingsDrawer = document.getElementById('settings-drawer');
                        
                        if (settingsDrawer && settingsDrawer.classList.contains('open')) {
                            settingsDrawer.classList.remove('open');
                        }

                        sessionDrawer.classList.toggle('open');
                        if (sessionDrawer.classList.contains('open')) vscode.postMessage({ type: 'getSessions' });
                    } catch (e) { console.error(e); }
                }

                function clearAllSessions() { 
                    vscode.postMessage({ type: 'clearAllSessions' }); 
                    toggleDrawer();
                }

                // Add Search Listener
                const searchInput = document.getElementById('sessionSearchInput');
                if (searchInput) {
                    searchInput.addEventListener('input', (e) => {
                        const sessions = window.currentSessions || [];
                        const currentId = window.currentSessionId;
                        renderSessionList(sessions, currentId, e.target.value);
                    });
                }

                function timeAgo(date) {
                    const seconds = Math.floor((new Date() - date) / 1000);
                    let interval = seconds / 31536000;
                    if (interval > 1) return Math.floor(interval) + "y ago";
                    interval = seconds / 2592000;
                    if (interval > 1) return Math.floor(interval) + "mo ago";
                    interval = seconds / 86400;
                    if (interval > 1) return Math.floor(interval) + "d ago";
                    interval = seconds / 3600;
                    if (interval > 1) return Math.floor(interval) + "h ago";
                    interval = seconds / 60;
                    if (interval > 1) return Math.floor(interval) + "m ago";
                    return "Just now";
                }

                function renderSessionList(sessions, currentId, searchQuery = '') {
                    // Cache for search
                    window.currentSessions = sessions;
                    window.currentSessionId = currentId;

                    sessionList.innerHTML = '';
                    
                    const filtered = sessions.filter(s => 
                        (s.title || 'New Chat').toLowerCase().includes(searchQuery.toLowerCase())
                    );

                    if (filtered.length === 0) {
                        sessionList.innerHTML = '<div style="padding:20px; text-align:center; opacity:0.5; font-size:12px;">No conversations found</div>';
                        return;
                    }

                    // Grouping Logic
                    const groups = {
                        'Current': [],
                        'Recent in ByteAiCoder': [],
                        'Other Conversations': []
                    };
                    
                    const now = new Date();
                    filtered.forEach(s => {
                         if (s.id === currentId) {
                             groups['Current'].push(s);
                         } else {
                             // Recent: last 24h
                             const date = new Date(s.timestamp || Date.now());
                             const isRecent = (now - date) < (24 * 60 * 60 * 1000);
                             if (isRecent) groups['Recent in ByteAiCoder'].push(s);
                             else groups['Other Conversations'].push(s);
                         }
                    });

                    // Render Groups
                    for (const [groupName, groupSessions] of Object.entries(groups)) {
                        if (groupSessions.length === 0) continue;

                        const header = document.createElement('div');
                        header.className = 'session-group-header';
                        header.innerText = groupName;
                        sessionList.appendChild(header);

                        groupSessions.forEach(s => {
                            const date = new Date(s.timestamp || Date.now());
                            const isActive = s.id === currentId;
                            
                            const div = document.createElement('div');
                            div.className = 'session-link' + (isActive ? ' active' : '');
                            
                            // Native Click on card loads session
                            div.onclick = () => {
                                if (isActive) return;
                                vscode.postMessage({ type: 'loadSession', id: s.id });
                                sessionDrawer.classList.remove('open');
                            };
                            
                            div.innerHTML = \`
                                <div class="session-info">
                                    <div class="session-title">\${escapeHtml(s.title || 'New Chat')}</div>
                                </div>
                                <div class="session-meta">
                                    <span>\${timeAgo(date)}</span>
                                    <div class="session-actions">
                                        <button class="btn-session-action" title="Rename" onclick="event.stopPropagation(); renameSession('\${s.id}', '\${escapeHtml(s.title || '')}')">
                                            ${icons.edit}
                                        </button>
                                        <button class="btn-session-action delete" title="Delete" onclick="event.stopPropagation(); deleteSession('\${s.id}')">
                                            ${icons.trash}
                                        </button>
                                    </div>
                                </div>
                            \`;
                            sessionList.appendChild(div);
                        });
                    }
                }
                
                function renameSession(id, currentTitle) {
                    vscode.postMessage({ type: 'renameSession', id: id, title: currentTitle });
                }
                
                function deleteSession(id) {
                    vscode.postMessage({ type: 'deleteSession', id: id });
                }

                function escapeHtml(text) {
                     const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
                     return text.replace(/[&<>"']/g, function(m) { return map[m]; });
                }

                // Window helpers for older onclicks if needed (though we moved to closure)
                window.loadSession = (id) => {
                     vscode.postMessage({ type: 'loadSession', id: id });
                     sessionDrawer.classList.remove('open');
                };
                
                window.deleteSession = (id) => {
                    event.stopPropagation();
                    vscode.postMessage({ type: 'deleteSession', id: id });
                };

                // Settings Functions
                window.toggleSettings = () => {
                    try {
                        const settingsDrawer = document.getElementById('settings-drawer');
                        const sessionDrawer = document.getElementById('session-drawer');
                        
                        if (sessionDrawer && sessionDrawer.classList.contains('open')) {
                            sessionDrawer.classList.remove('open');
                        }

                        const isOpen = settingsDrawer.classList.contains('open');
                        if (!isOpen) {
                            vscode.postMessage({ type: 'getSettings' });
                            settingsDrawer.classList.add('open');
                        } else {
                            settingsDrawer.classList.remove('open');
                        }
                    } catch (e) {
                        console.error(e);
                        if(window.showToast) window.showToast("Error opening settings: " + e.message);
                    }
                };

                window.saveSettings = () => {
                    const settings = {
                        customInstructions: document.getElementById('customInstructions').value,
                        temperature: parseFloat(document.getElementById('tempSlider').value),
                        autoContext: document.getElementById('autoContext').checked
                    };
                    vscode.postMessage({ type: 'saveSettings', value: settings });
                    document.getElementById('settings-drawer').classList.remove('open');
                };

                window.updateTempLabel = (val) => {
                    document.getElementById('tempValue').innerText = val;
                };

                window.executeCommand = (cmd) => {
                    vscode.postMessage({ type: 'executeCommand', command: cmd });
                };

                // Toast Helper
                // Toast Helper (DOM optimized)
                window.showToast = (message, duration = 5000) => {
                    const container = document.getElementById('toast-container');
                    if (!container) return;
                    
                    const toast = document.createElement('div');
                    toast.className = 'toast';
                    
                    const icon = document.createElement('div');
                    icon.className = 'toast-icon';
                    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
                    
                    const content = document.createElement('div');
                    content.className = 'toast-content';
                    content.textContent = message;
                    
                    const close = document.createElement('button');
                    close.className = 'toast-close';
                    close.innerHTML = '✕';
                    close.onclick = function() { toast.remove(); };
                    
                    toast.appendChild(icon);
                    toast.appendChild(content);
                    toast.appendChild(close);
                    
                    container.appendChild(toast);
                    
                    setTimeout(() => {
                        toast.style.opacity = '0';
                        toast.style.transform = 'translateY(-10px)';
                        setTimeout(() => toast.remove(), 300);
                    }, duration);
                };

            </script>
        </body>
        </html>`;
    }
}
