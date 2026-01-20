
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
                    
                    /* Header Shadow */
                    --header-shadow: 0 4px 20px -5px rgba(0,0,0,0.3);
                    
                    /* Tag Colors */
                    --tag-file-bg: rgba(56, 189, 248, 0.15);
                    --tag-file-border: rgba(56, 189, 248, 0.3);
                    --tag-file-text: #38bdf8;
                    
                    --tag-cmd-bg: rgba(216, 180, 254, 0.15);
                    --tag-cmd-border: rgba(216, 180, 254, 0.3);
                    --tag-cmd-text: #d8b4fe;
                    
                    /* Font Fallbacks */
                    --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
                }

                body.vscode-light {
                    --glass-bg: rgba(255, 255, 255, 0.85);
                    --glass-border: rgba(0, 0, 0, 0.1);
                    --shadow-sm: 0 2px 8px rgba(0,0,0,0.05);
                    --shadow-md: 0 6px 16px rgba(0,0,0,0.1);
                    --shadow-lg: 0 12px 32px rgba(0,0,0,0.15);
                    --header-shadow: 0 4px 20px -5px rgba(0,0,0,0.1);
                    
                    /* Tag Colors Light */
                    --tag-file-bg: rgba(2, 132, 199, 0.1);
                    --tag-file-border: rgba(2, 132, 199, 0.2);
                    --tag-file-text: #0284c7;
                    
                    --tag-cmd-bg: rgba(147, 51, 234, 0.1);
                    --tag-cmd-border: rgba(147, 51, 234, 0.2);
                    --tag-cmd-text: #9333ea;
                }

                body {
                    margin: 0; padding: 0;
                    background: var(--bg-app);
                    color: var(--text-primary);
                    font-family: var(--vscode-font-family, 'Inter', system-ui, sans-serif);
                    height: 100vh;
                    display: flex; flex-direction: column;
                    overflow: hidden;
                }
                
                /* Premium Scrollbar */
                ::-webkit-scrollbar { width: 6px; height: 6px; }
                ::-webkit-scrollbar-thumb { background: rgba(127,127,127,0.2); border-radius: 3px; }
                ::-webkit-scrollbar-thumb:hover { background: rgba(127,127,127,0.4); }
                ::-webkit-scrollbar-track { background: transparent; }

                /* Glass Header */
                header {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 0 16px; height: 52px;
                    border-bottom: 1px solid var(--glass-border);
                    background: var(--glass-bg); position: sticky; top: 0; z-index: 100;
                    backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
                    box-shadow: var(--header-shadow);
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
                    display: flex; flex-direction: column; gap: 24px;
                    scroll-behavior: smooth;
                    mask-image: linear-gradient(to bottom, transparent, black 16px);
                    -webkit-mask-image: linear-gradient(to bottom, transparent, black 16px);
                }

                /* Messages */
                .message { 
                    display: flex; gap: 8px; /* changed from column to row (implicit) */
                    max-width: 100%; 
                    animation: slideIn 0.35s cubic-bezier(0.2, 0.8, 0.2, 1); 
                }
                @keyframes slideIn { from { opacity: 0; transform: translateY(16px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
                
                .content { position: relative; font-size: 14px; line-height: 1.6; word-wrap: break-word; }
                
                /* User Message - Row Reverse to put actions on left */
                .message.user { 
                    flex-direction: row-reverse; 
                    align-items: flex-end; 
                    justify-content: flex-start; /* content starts from right */
                }
                .message.user .content {
                    background: var(--bg-hover); color: var(--text-primary);
                    padding: 12px 18px; border-radius: 18px;
                    border-bottom-right-radius: 4px;
                    max-width: 85%;
                }

                /* Assistant Message - Column (Text top, Actions bottom) */
                .message.assistant { 
                    flex-direction: column; 
                    align-items: flex-start; 
                    width: 100%; 
                }
                
                /* New Action Button Styles */
                .msg-actions {
                    display: flex; gap: 6px;
                    opacity: 0; transition: opacity 0.2s;
                }
                
                /* User Actions: Centered vertically on side */
                .message.user .msg-actions {
                    align-self: center;
                }

                /* Assistant Actions: Bottom of bubble */
                .message.assistant .msg-actions {
                     margin-top: 6px;
                     margin-left: 2px;
                     position: static; transform: none;
                }
                 .message:hover .msg-actions { opacity: 1; }

                .btn-icon.action-btn {
                    width: 28px; height: 28px; background: transparent; 
                    border: none; color: var(--text-secondary);
                    box-shadow: none; /* Removed shadow/border for cleaner look */
                }
                .btn-icon.action-btn:hover {
                    color: var(--text-primary);
                    transform: scale(1.1);
                    /* Removed background change */
                }

                .message.assistant .content {
                    background: transparent;
                    border: none;
                    padding: 4px 0;
                    max-width: 100%;
                    color: var(--text-primary);
                }

                /* ... existing styles ... */

                .btn-send {
                    background: var(--accent); color: white; border: none;
                    border-radius: 50% !important; /* Forced round */
                    width: 40px; height: 40px;
                    cursor: pointer; display: flex; align-items: center; justify-content: center;
                    transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
                    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);
                }
                .thinking-indicator {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 16px;
                    background: rgba(59, 130, 246, 0.08);
                    border-radius: 12px;
                    border: 1px solid rgba(59, 130, 246, 0.2);
                    animation: fadeIn 0.3s ease;
                    max-width: fit-content;
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(8px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                
                .thinking-dots {
                    display: flex;
                    gap: 4px;
                }
                
                .thinking-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: var(--accent);
                    animation: dotPulse 1.4s ease-in-out infinite;
                }
                
                .thinking-dot:nth-child(1) { animation-delay: 0s; }
                .thinking-dot:nth-child(2) { animation-delay: 0.2s; }
                .thinking-dot:nth-child(3) { animation-delay: 0.4s; }
                
                @keyframes dotPulse {
                    0%, 80%, 100% { 
                        opacity: 0.3;
                        transform: scale(0.8);
                    }
                    40% { 
                        opacity: 1;
                        transform: scale(1);
                    }
                }
                
                .thinking-text {
                    font-size: 13px;
                    color: var(--accent);
                    font-weight: 500;
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

                /* Simple Typing Indicator - fallback */
                .typing-indicator {
                    display: none;
                }

                /* Input Section - Floating Style */
                .input-section {
                    padding: 20px; background: transparent;
                    position: relative; z-index: 20;
                    margin-top: auto; /* Push to bottom by default */
                    transition: all 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
                }

                /* New Chat State - Centered Input */
                body.new-chat .input-section {
                    position: absolute;
                    top: 50%; left: 50%;
                    transform: translate(-50%, -50%);
                    width: 100%;
                    max-width: 600px;
                    padding: 0 32px;
                    box-sizing: border-box;
                }
                
                body.new-chat #chat-container {
                    opacity: 0;
                    pointer-events: none;
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
                    opacity: 1;
                    transition: opacity 0.3s;
                }
                
                body.new-chat .input-section::before {
                    opacity: 0; /* No background in centered mode */
                    border-top: none;
                }

                .input-box {
                    background: var(--input-bg); border: none;
                    border-radius: 16px; padding: 12px 14px;
                    display: flex; flex-direction: column; gap: 8px;
                    transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
                    box-shadow: var(--shadow-md);
                }
                .input-box:focus-within {
                    box-shadow: var(--shadow-lg);
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
                    color: transparent; background: rgba(0, 198, 255, 0.15);
                    border-radius: 6px; padding: 0 6px;
                    border: 1px solid rgba(0, 198, 255, 0.3);
                }
                .input-highlight .command {
                    color: transparent; background: rgba(168, 85, 247, 0.15);
                    border-radius: 6px; padding: 0 6px;
                    border: 1px solid rgba(168, 85, 247, 0.3);
                }
                
                /* Scroll to Bottom Button */
                #scrollToBottomBtn {
                    position: fixed; bottom: 100px; right: 24px;
                    width: 38px; height: 38px; border-radius: 50%;
                    background: var(--accent); color: white;
                    border: none; cursor: pointer; display: none;
                    align-items: center; justify-content: center;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.4);
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    z-index: 90; backdrop-filter: blur(8px);
                }
                #scrollToBottomBtn:hover { transform: translateY(-4px) scale(1.1); box-shadow: var(--shadow-glow); }
                #scrollToBottomBtn.show { display: flex; animation: bounceIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
                @keyframes bounceIn { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }

                textarea {
                    position: relative; z-index: 1;
                    width: 100%; border: none; background: transparent; color: var(--input-fg);
                    font-family: inherit; font-size: 14px; resize: none; outline: none;
                    max-height: 200px; min-height: 24px; padding: 4px 0; line-height: 1.4;
                    box-sizing: border-box;
                    height: 24px;
                }
                
                .input-actions { display: flex; justify-content: flex-end; align-items: center; }
                
                .btn-icon {
                    background: transparent; color: var(--text-secondary); border: none;
                    border-radius: 12px; width: 40px; height: 40px;
                    cursor: pointer; display: flex; align-items: center; justify-content: center;
                    transition: all 0.2s;
                }
                .btn-icon:hover {
                    background: rgba(127, 127, 127, 0.1);
                    color: var(--text-primary);
                }
                .btn-icon:active { transform: scale(0.95); }

                .btn-send {
                    background: var(--accent); color: white; border: none;
                    border-radius: 12px; width: 40px; height: 40px;
                    cursor: pointer; display: flex; align-items: center; justify-content: center;
                    transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
                    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);
                }
                .btn-send:hover { 
                    background: var(--accent-hover); 
                    transform: scale(1.05); 
                    box-shadow: 0 6px 16px rgba(37, 99, 235, 0.3); 
                }
                .btn-send:active { transform: scale(0.95); }
                .btn-send.disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                    background: var(--text-secondary);
                    box-shadow: none;
                    pointer-events: none;
                }
                .btn-send span { display: none; }

                .btn-stop {
                    background: #ef4444; color: white; border: none;
                    border-radius: 12px; width: 40px; height: 40px;
                    cursor: pointer; display: none; align-items: center; justify-content: center;
                    transition: all 0.2s;
                    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
                }
                .btn-stop:hover { 
                    background: #dc2626; 
                    transform: scale(1.05);
                    box-shadow: 0 6px 16px rgba(239, 68, 68, 0.3);
                }
                .btn-stop:active { transform: scale(0.95); }

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
                
                .empty-greeting {
                     font-size: 24px; font-weight: 700;
                     color: var(--text-primary);
                     margin-bottom: 8px;
                     text-align: center;
                     opacity: 0.9;
                }
                .empty-subtitle {
                     font-size: 14px;
                     color: var(--text-secondary);
                     text-align: center;
                     margin-bottom: 24px;
                }
                
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
                
                /* Action Cards Removed */


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

                .settings-content { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 20px; }
                
                .setting-group { display: flex; flex-direction: column; gap: 8px; }
                .setting-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
                .setting-icon { opacity: 0.7; display: flex; align-items: center; }
                .setting-info { flex: 1; }
                .setting-label { font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
                .setting-desc { font-size: 12px; color: var(--text-secondary); opacity: 0.8; line-height: 1.4; }
                .settings-divider { height: 1px; background: var(--border); margin: 4px 0; }
                .drawer-title { display: flex; align-items: center; gap: 8px; font-weight: 600; }
                
                .setting-input {
                    background: var(--input-bg); border: 1px solid var(--border); color: var(--text-primary);
                    padding: 12px; border-radius: 8px; font-family: inherit; font-size: 13px; resize: vertical;
                    min-height: 100px; outline: none; transition: border-color 0.2s, box-shadow 0.2s;
                }
                .setting-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(0, 114, 255, 0.15); }
                .setting-input::placeholder { color: var(--text-secondary); opacity: 0.6; }

                /* Keyboard Shortcuts */
                .keyboard-shortcuts .setting-header { margin-bottom: 12px; }
                .shortcuts-grid { display: flex; flex-direction: column; gap: 8px; }
                .shortcut-item { 
                    display: flex; justify-content: space-between; align-items: center; 
                    padding: 8px 12px; background: var(--bg-hover); border-radius: 6px;
                }
                .shortcut-key { 
                    font-family: var(--font-mono); font-size: 11px; font-weight: 500;
                    background: var(--bg-app); padding: 4px 8px; border-radius: 4px;
                    border: 1px solid var(--border); color: var(--text-primary);
                }
                .shortcut-action { font-size: 12px; color: var(--text-secondary); }
                
                /* Save Button */
                .btn-save {
                    display: flex; align-items: center; justify-content: center; gap: 8px;
                    width: 100%; padding: 12px 16px; border: none; border-radius: 8px;
                    background: var(--accent); color: var(--accent-foreground);
                    font-size: 13px; font-weight: 500; cursor: pointer;
                    transition: all 0.2s; box-shadow: var(--shadow-sm);
                }
                .btn-save:hover { background: var(--accent-hover); transform: translateY(-1px); box-shadow: var(--shadow-md); }



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

                /* Input Tags (Chips) */
                .input-tags {
                    display: flex; flex-wrap: wrap; gap: 6px; padding: 0 4px;
                    margin-bottom: 8px; /* Space before input */
                    min-height: 0;
                    transition: all 0.2s ease;
                }
                .input-tags:not(:empty) {
                    margin-top: 4px;
                }
                .file-tag {
                    display: inline-flex; align-items: center; gap: 6px;
                    background: var(--tag-file-bg); 
                    border: 1px solid var(--tag-file-border);
                    color: var(--tag-file-text); 
                    padding: 4px 8px; 
                    border-radius: 6px;
                    font-size: 12px; 
                    cursor: pointer; 
                    user-select: none;
                    transition: all 0.2s;
                    max-width: 100%;
                }
                .file-tag:hover { 
                    background: rgba(56, 189, 248, 0.25); 
                    transform: translateY(-1px);
                    box-shadow: 0 2px 8px rgba(56, 189, 248, 0.2);
                }
                .file-tag .tag-icon { opacity: 1; }
                .file-tag .tag-text { 
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;
                    font-weight: 500;
                }
                .file-tag .close { 
                    margin-left: 2px; opacity: 0.7; padding: 2px; border-radius: 4px; display: flex;
                }
                .file-tag .close:hover { 
                    opacity: 1; background: rgba(56, 189, 248, 0.3); color: white;
                }
                
                .command-tag {
                    background: var(--tag-cmd-bg) !important;
                    border-color: var(--tag-cmd-border) !important;
                    color: var(--tag-cmd-text) !important;
                }
                .command-tag:hover {
                    background: var(--tag-cmd-bg) !important;
                    filter: brightness(1.1);
                    box-shadow: 0 2px 8px rgba(216, 180, 254, 0.2);
                }
                .command-tag .close:hover {
                    background: var(--tag-cmd-border) !important;
                }

                
                /* Clickable Tags in History */
                .message .file-tag {
                    display: inline-flex; align-items: center; gap: 4px;
                    background: var(--tag-file-bg); 
                    border: 1px solid var(--tag-file-border);
                    color: var(--tag-file-text); 
                    padding: 2px 6px; 
                    border-radius: 4px;
                    font-size: 12px; 
                    font-family: var(--font-mono);
                    cursor: pointer;
                    margin: 0 2px;
                    vertical-align: middle;
                    font-weight: 500;
                }
                .message .file-tag:hover {
                    background: rgba(56, 189, 248, 0.25);
                    text-decoration: underline;
                    box-shadow: 0 2px 8px rgba(56, 189, 248, 0.2);
                }

            </style>
        </head>
        <body>
            <header>
                <div class="brand">
                    <img src="${logoUri}" class="logo-img" alt="Logo">
                    <span style="font-size: 10px; background: var(--gradient-primary); -webkit-background-clip: text; -webkit-text-fill-color: transparent; border: 1px solid var(--accent); padding: 1px 4px; border-radius: 4px; margin-left: -2px; font-weight: 800; opacity: 0.9; letter-spacing: 0.5px;">BYTE</span>
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
                        <span class="drawer-title">${icons.settings} Settings</span>
                        <button class="btn-icon" onclick="toggleSettings()" title="Close">${icons.close}</button>
                    </div>
                </div>
                <div class="settings-content">
                    <div class="setting-group">
                        <div class="setting-header">
                            <span class="setting-icon">${icons.edit}</span>
                            <div class="setting-label">CUSTOM INSTRUCTIONS</div>
                        </div>
                        <div class="setting-desc">Customize the AI's behavior and persona for this workspace.</div>
                        <textarea id="customInstructions" class="setting-input" rows="5" placeholder="E.g. You are an expert Python developer. Always include type hints. Be concise."></textarea>
                    </div>

                    <div class="settings-divider"></div>

                    <div class="setting-group">
                         <div class="setting-row">
                             <div class="setting-info">
                                 <div class="setting-header">
                                     <span class="setting-icon">${icons.code}</span>
                                     <div class="setting-label">AUTO-CONTEXT</div>
                                 </div>
                                 <div class="setting-desc">Automatically include relevant code context from your project.</div>
                             </div>
                             <label class="switch">
                                 <input type="checkbox" id="autoContext" checked>
                                 <span class="slider round"></span>
                             </label>
                         </div>
                    </div>

                    <div class="settings-divider"></div>

                    <div class="setting-group keyboard-shortcuts">
                        <div class="setting-header">
                            <span class="setting-icon">⌨️</span>
                            <div class="setting-label">KEYBOARD SHORTCUTS</div>
                        </div>
                        <div class="shortcuts-grid">
                            <div class="shortcut-item">
                                <span class="shortcut-key">Enter</span>
                                <span class="shortcut-action">Send message</span>
                            </div>
                            <div class="shortcut-item">
                                <span class="shortcut-key">Shift + Enter</span>
                                <span class="shortcut-action">New line</span>
                            </div>
                            <div class="shortcut-item">
                                <span class="shortcut-key">ESC</span>
                                <span class="shortcut-action">Close popups</span>
                            </div>
                            <div class="shortcut-item">
                                <span class="shortcut-key">@</span>
                                <span class="shortcut-action">Mention file</span>
                            </div>
                            <div class="shortcut-item">
                                <span class="shortcut-key">/</span>
                                <span class="shortcut-action">Quick command</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="drawer-footer">
                    <button class="btn-save" onclick="saveSettings()">${icons.check} Save Changes</button>
                </div>
            </div>



            <div id="chat-container">
                <!-- Chat messages will appear here -->
            </div>

            <button id="scrollToBottomBtn" onclick="scrollToBottom()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 13l5 5 5-5M7 6l5 5 5-5"></path></svg>
            </button>
            
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
                        <div class="input-tags" id="inputTags"></div>
                        <div class="input-highlight" id="inputHighlight"></div>
                        <textarea id="messageInput" placeholder="Ask anything, @ to mention, / for command..." rows="1"></textarea>
                    </div>
                    <div class="input-actions" style="justify-content: space-between;">
                         <div class="left-actions" style="display: flex; gap: 8px;">
                             <button class="btn-icon" id="attachBtn" title="Add File/Folder">
                                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                             </button>
                             <button class="btn-icon" id="commandBtn" title="Commands">
                                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                     <polyline points="4 17 10 11 4 5"></polyline>
                                     <line x1="12" y1="19" x2="20" y2="19"></line>
                                 </svg>
                             </button>
                         </div>
                         <div class="right-actions" style="display: flex; gap: 8px; align-items: center;">
                            <button class="btn-send" id="sendBtn" title="Send">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
                            </button>
                            <button class="btn-stop" id="stopBtn" title="Stop Generation">${icons.stop}</button>
                        </div>
                    </div>
                </div>
            </div>

            <div id="toast-container"></div>
            <script>
                const vscode = acquireVsCodeApi();
                const initialState = vscode.getState() || {};
                
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
                const inputTags = document.getElementById('inputTags');
                const sendBtn = document.getElementById('sendBtn');
                const stopBtn = document.getElementById('stopBtn');
                const sessionDrawer = document.getElementById('session-drawer');
                const sessionList = document.getElementById('sessionList');
                const commandPopup = document.getElementById('commandPopup');
                const filePopup = document.getElementById('filePopup');
                const emptyState = document.getElementById('emptyState');
                
                // State
                let selectedFiles = [];
                let selectedCommands = [];

                // Helper: Open File
                window.openFile = (path) => {
                    vscode.postMessage({ type: 'openFile', value: path });
                };

                // Helper: Update Send Button State
                function updateSendButtonState() {
                    const text = messageInput.value.trim();
                    if (!text && selectedFiles.length === 0 && selectedCommands.length === 0) {
                        sendBtn.classList.add('disabled');
                    } else {
                        sendBtn.classList.remove('disabled');
                    }
                }

                // Helper: Update Input Tags
                function updateInputTags() {
                    inputTags.innerHTML = '';
                    
                    // Render Commands
                    selectedCommands.forEach((cmd, index) => {
                        const tag = document.createElement('div');
                        tag.className = 'file-tag command-tag';
                        tag.title = '/' + cmd;
                        tag.innerHTML = \`
                            <span class="tag-icon">⚡</span>
                            <span class="tag-text">/\${cmd}</span>
                            <span class="close" onclick="event.stopPropagation(); removeCommand(\${index})">×</span>
                        \`;
                        inputTags.appendChild(tag);
                    });

                    selectedFiles.forEach((file, index) => {
                        const tag = document.createElement('div');
                        tag.className = 'file-tag';
                        tag.title = file.path;
                        const iconChar = file.isFolder ? '📁' : '📄';
                        tag.innerHTML = \`
                            <span class="tag-icon">\${iconChar}</span>
                            <span class="tag-text">\${file.name}</span>
                            <span class="close" onclick="event.stopPropagation(); removeFile(\${index})">×</span>
                        \`;
                        // Allow clicking the tag in input to open it too (user requirement)
                        tag.onclick = () => window.openFile(file.fullPath || file.path);
                        inputTags.appendChild(tag);
                    });
                    
                    // Adjust input height if needed
                    messageInput.dispatchEvent(new Event('input'));
                }

                window.removeFile = (index) => {
                    selectedFiles.splice(index, 1);
                    updateInputTags();
                    messageInput.focus();
                };

                window.removeCommand = (index) => {
                    selectedCommands.splice(index, 1);
                    updateInputTags();
                    messageInput.focus();
                };
                
                // Popup navigation state
                let commandPopupSelectedIndex = -1;
                let filePopupSelectedIndex = -1;
                
                // Helper: Update visual selection in command popup
                function updateCommandPopupSelection() {
                    const items = commandPopup.querySelectorAll('.command-item');
                    items.forEach((item, idx) => {
                        if (idx === commandPopupSelectedIndex) {
                            item.classList.add('selected');
                        } else {
                            item.classList.remove('selected');
                        }
                    });
                    // Scroll selected item into view
                    if (commandPopupSelectedIndex >= 0 && items[commandPopupSelectedIndex]) {
                        items[commandPopupSelectedIndex].scrollIntoView({ block: 'nearest' });
                    }
                }
                
                // Helper: Update visual selection in file popup
                function updateFilePopupSelection() {
                    const items = filePopup.querySelectorAll('.file-item');
                    items.forEach((item, idx) => {
                        if (idx === filePopupSelectedIndex) {
                            item.classList.add('selected');
                        } else {
                            item.classList.remove('selected');
                        }
                    });
                    // Scroll selected item into view
                    if (filePopupSelectedIndex >= 0 && items[filePopupSelectedIndex]) {
                        items[filePopupSelectedIndex].scrollIntoView({ block: 'nearest' });
                    }
                }
                
                // Reset popup selection when popup is shown
                function resetCommandPopupSelection() {
                    commandPopupSelectedIndex = 0;
                    updateCommandPopupSelection();
                }
                
                function resetFilePopupSelection() {
                    filePopupSelectedIndex = 0;
                    updateFilePopupSelection();
                }
                
                // Inline thinking indicator state
                let thinkingIndicatorEl = null;
                
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
                let currentAssistantMessageIndex = null;
                
                function createThinkingIndicator() {
                    const wrapper = document.createElement('div');
                    wrapper.id = 'thinkingIndicator';
                    wrapper.className = 'message assistant';
                    
                    const indicator = document.createElement('div');
                    indicator.className = 'thinking-indicator';
                    indicator.innerHTML = \`
                        <div class="thinking-dots">
                            <span class="thinking-dot"></span>
                            <span class="thinking-dot"></span>
                            <span class="thinking-dot"></span>
                        </div>
                        <span class="thinking-text" id="thinkingText">Thinking...</span>
                    \`;
                    wrapper.appendChild(indicator);
                    return wrapper;
                }
                
                function showThinkingIndicator() {
                    hideThinkingIndicator();
                    thinkingIndicatorEl = createThinkingIndicator();
                    chatContainer.appendChild(thinkingIndicatorEl);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
                
                function hideThinkingIndicator() {
                    if (thinkingIndicatorEl) {
                        thinkingIndicatorEl.remove();
                        thinkingIndicatorEl = null;
                    }
                }
                
                function handleAgentStatus(phase, messageText) {
                    if (!thinkingIndicatorEl) {
                        showThinkingIndicator();
                    }
                    
                    // Update the thinking text with current phase
                    const textEl = thinkingIndicatorEl.querySelector('#thinkingText');
                    if (textEl) {
                        textEl.textContent = phase + '...';
                    }
                    
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
                
                function handleAgentDebugText(text) {
                    console.log('Agent Debug:', text);
                }
                
                function handleAgentStatusDone() {
                    // Just hide the indicator when done - the response will replace it
                }
                
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
                    this.style.height = '24px';
                    if (this.scrollHeight > 24) {
                        this.style.height = (this.scrollHeight) + 'px';
                    }
                    
                    updateSendButtonState();
                    
                    // Update syntax highlighting
                    updateHighlight();
                    
                    const val = this.value;
                    
                    // Mention Logic (@)
                    const lastAt = val.lastIndexOf('@');
                    if (lastAt !== -1) {
                         const searchStr = val.substring(lastAt + 1);
                         if (!searchStr.includes(' ') && !searchStr.includes('\\n')) {
                             debouncedFileSearch(searchStr);
                             if (!filePopup.classList.contains('show')) {
                                 filePopupSelectedIndex = 0;
                             }
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
                                if (!commandPopup.classList.contains('show')) {
                                    commandPopupSelectedIndex = 0;
                                    setTimeout(updateCommandPopupSelection, 10);
                                }
                                commandPopup.classList.add('show');
                                return;
                             }
                        }
                    }
                    commandPopup.classList.remove('show');
                    persistState();
                });
                
                // Send Message
                function sendMessage() {
                    const text = messageInput.value.trim();
                    if ((!text && selectedFiles.length === 0 && selectedCommands.length === 0) || isGenerating) return;
                    
                    currentAssistantMessageDiv = null;
                    currentAssistantMessageIndex = null;
                    
                    addMessage('user', text, [...selectedFiles], [...selectedCommands]);
                    
                    vscode.postMessage({ type: 'sendMessage', value: text, files: [...selectedFiles], commands: [...selectedCommands] });
                    
                    // Reset input and state
                    messageInput.value = '';
                    messageInput.style.height = '24px';
                    selectedFiles = [];
                    selectedCommands = [];
                    updateInputTags();
                    
                    updateHighlight();
                    commandPopup.classList.remove('show');
                    filePopup.classList.remove('show');
                    
                    // Reset Buttons
                    attachBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
                    commandBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>';
                    
                    document.body.classList.remove('new-chat');
                    
                    isGenerating = true;
                    updateUIState();
                    
                    // Show inline thinking indicator instead of simple dots
                    showThinkingIndicator();
                    
                    persistState();
                }
                
                function showTypingIndicator() {
                    // Now uses the thinking indicator
                    showThinkingIndicator();
                }
                
                function hideTypingIndicator() {
                    hideThinkingIndicator();
                }

                sendBtn.addEventListener('click', sendMessage);
                
                stopBtn.addEventListener('click', () => {
                    vscode.postMessage({ type: 'stopGeneration' });
                    isGenerating = false;
                    updateUIState();
                    persistState();
                });

                // Button Event Listeners
                
                function toggleFilePopup() {
                    if (filePopup.classList.contains('show')) {
                        filePopup.classList.remove('show');
                        attachBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
                        messageInput.focus();
                    } else {
                        commandPopup.classList.remove('show');
                        commandBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>';
                        
                        filePopup.classList.add('show');
                        attachBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                        debouncedFileSearch(''); // Load all files
                        filePopupSelectedIndex = 0;
                        messageInput.focus();
                    }
                }

                function toggleCommandPopup() {
                    if (commandPopup.classList.contains('show')) {
                        commandPopup.classList.remove('show');
                        commandBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>';
                        messageInput.focus();
                    } else {
                        filePopup.classList.remove('show');
                        attachBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
                        
                        commandPopup.classList.add('show');
                        commandBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                        commandPopupSelectedIndex = 0;
                        updateCommandPopupSelection();
                        messageInput.focus();
                    }
                }

                attachBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleFilePopup();
                });

                commandBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleCommandPopup();
                });

                // Global shortcuts
                document.addEventListener('keydown', (e) => {
                    // Focus input on '/' if not already focused
                    if (e.key === '/' && document.activeElement !== messageInput) {
                        e.preventDefault();
                        messageInput.focus();
                        messageInput.value += '/';
                        updateHighlight();
                        return;
                    }
                    // Focus input on any key if no other element is focused
                    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement === document.body) {
                        messageInput.focus();
                    }
                });

                // Auto-focus on load
                window.addEventListener('load', () => {
                    messageInput.focus();
                });

                messageInput.addEventListener('keydown', (e) => {
                    const isFilePopupOpen = filePopup.classList.contains('show');
                    const isCommandPopupOpen = commandPopup.classList.contains('show');
                    
                    // Arrow key navigation for file popup
                    if (isFilePopupOpen) {
                        const items = filePopup.querySelectorAll('.file-item');
                        const itemCount = items.length;
                        
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            filePopupSelectedIndex = (filePopupSelectedIndex + 1) % itemCount;
                            updateFilePopupSelection();
                            return;
                        }
                        if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            filePopupSelectedIndex = filePopupSelectedIndex <= 0 ? itemCount - 1 : filePopupSelectedIndex - 1;
                            updateFilePopupSelection();
                            return;
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            const selectedItem = items[filePopupSelectedIndex] || items[0];
                            if (selectedItem) selectedItem.click();
                            return;
                        }
                        if (e.key === 'Tab') {
                            e.preventDefault();
                            const selectedItem = items[filePopupSelectedIndex] || items[0];
                            if (selectedItem) selectedItem.click();
                            return;
                        }
                    }
                    
                    // Arrow key navigation for command popup
                    if (isCommandPopupOpen) {
                        const items = commandPopup.querySelectorAll('.command-item');
                        const itemCount = items.length;
                        
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            commandPopupSelectedIndex = (commandPopupSelectedIndex + 1) % itemCount;
                            updateCommandPopupSelection();
                            return;
                        }
                        if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            commandPopupSelectedIndex = commandPopupSelectedIndex <= 0 ? itemCount - 1 : commandPopupSelectedIndex - 1;
                            updateCommandPopupSelection();
                            return;
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            const selectedItem = items[commandPopupSelectedIndex] || items[0];
                            if (selectedItem) selectedItem.click();
                            return;
                        }
                        if (e.key === 'Tab') {
                            e.preventDefault();
                            const selectedItem = items[commandPopupSelectedIndex] || items[0];
                            if (selectedItem) selectedItem.click();
                            return;
                        }
                    }
                    
                    // Regular Enter to send message
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                    }
                    
                    // Escape to close popups
                    if (e.key === 'Escape') {
                        commandPopup.classList.remove('show');
                        filePopup.classList.remove('show');
                        commandPopupSelectedIndex = -1;
                        filePopupSelectedIndex = -1;
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
                                
                                if (currentAssistantMessageIndex !== null &&
                                    currentAssistantMessageIndex >= 0 &&
                                    currentAssistantMessageIndex < messageHistory.length) {
                                    const msg = messageHistory[currentAssistantMessageIndex];
                                    if (msg.role === 'assistant') {
                                        msg.text = message.value;
                                    }
                                }
                            } else {
                                addMessage('assistant', message.value);
                            }
                            
                            if (!message.isStream) {
                                isGenerating = false;
                                currentAssistantMessageDiv = null;
                                currentAssistantMessageIndex = null;
                                updateUIState();
                                persistState();
                            }
                            break;
                        
                        case 'agentStatus':
                            handleAgentStatus(message.phase, message.message);
                            break;
                        
                        case 'agentDebugText':
                            handleAgentDebugText(message.value);
                            break;

                        case 'agentStatusDone':
                            handleAgentStatusDone();
                            break;
                            
                        case 'setAndSendMessage':
                            messageInput.value = message.value;
                            
                            // Restore tags if provided
                            if (message.files || message.commands) {
                                selectedFiles = message.files || [];
                                selectedCommands = message.commands || [];
                                updateInputTags();
                            }
                            
                            updateHighlight();
                            if (!message.justSet) {
                                sendMessage();
                            } else {
                                messageInput.focus();
                                persistState();
                            }
                            break;
                            
                        case 'sessionList':
                             renderSessionList(message.sessions, message.currentSessionId);
                             break;
                             
                        case 'loadSession':
                             chatContainer.innerHTML = '';
                             resetMessageIndex();
                             hideThinkingIndicator();
                             currentAssistantMessageDiv = null;
                             currentAssistantMessageIndex = null;
                             if (message.history.length === 0) {
                                 chatContainer.innerHTML = '';
                                 document.body.classList.add('new-chat');
                             } else {
                                 document.body.classList.remove('new-chat');
                                 message.history.forEach(msg => {
                                     addMessage(msg.role, msg.text, msg.files, msg.commands);
                                 });
                             }
                             break;

                        case 'addMessage':
                           addMessage(message.role, message.value, message.files, message.commands);
                           break;

                        case 'setGenerating':
                           isGenerating = true;
                           updateUIState();
                           showTypingIndicator();
                           persistState();
                           break;

                        case 'error':
                           hideTypingIndicator();
                           isGenerating = false;
                           currentAssistantMessageDiv = null;
                           currentAssistantMessageIndex = null;
                           updateUIState();
                           window.showToast(message.value);
                           persistState();
                           break;

                        case 'fileList':
                           renderFiles(message.files);
                           break;

                        case 'updateSettings':
                           const s = message.value;
                           if (s) {
                               const customInstructionsEl = document.getElementById('customInstructions');
                               const autoContextEl = document.getElementById('autoContext');
                               if (customInstructionsEl) customInstructionsEl.value = s.customInstructions || '';
                               if (autoContextEl) autoContextEl.checked = s.autoContext !== false;
                           }
                           break;
                    }
                });

                let messageIndex = 0;
                let messageHistory = [];
                
                function addMessage(role, text, files = [], commands = []) {
                    const currentIdx = messageIndex++;
                    messageHistory.push({ role, text, files, commands });
                    const div = document.createElement('div');
                    div.className = 'message ' + role;
                    div.dataset.index = currentIdx;

                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'content';
                    
                    // Render Files/Tags if any
                    if ((files && files.length > 0) || (commands && commands.length > 0)) {
                        const tagsContainer = document.createElement('div');
                        tagsContainer.className = 'input-tags';
                        tagsContainer.style.marginBottom = '8px';
                        
                        if (commands) {
                            commands.forEach(cmd => {
                                const tag = document.createElement('div');
                                tag.className = 'file-tag command-tag';
                                tag.innerHTML = \`
                                    <span class="tag-icon">⚡</span>
                                    <span class="tag-text">/\${cmd}</span>
                                \`;
                                tagsContainer.appendChild(tag);
                            });
                        }

                        if (files) {
                            files.forEach(file => {
                                const tag = document.createElement('div');
                                tag.className = 'file-tag'; 
                                
                                const iconChar = file.isFolder ? '📁' : '📄';
                                
                                tag.innerHTML = \`
                                    <span class="tag-icon">\${iconChar}</span>
                                    <span class="tag-text">\${file.name}</span>
                                \`;
                                tag.onclick = () => window.openFile(file.fullPath || file.path);
                                tagsContainer.appendChild(tag);
                            });
                        }
                        contentDiv.appendChild(tagsContainer);
                    }

                    const textDiv = document.createElement('div');
                    textDiv.innerHTML = marked.parse(text);
                    contentDiv.appendChild(textDiv);

                    div.appendChild(contentDiv);

                    // Add Action Buttons
                    const actionsDiv = document.createElement('div');
                    actionsDiv.className = 'msg-actions';
                    
                    if (role === 'assistant') {
                        // Copy Button
                        const copyBtn = document.createElement('button');
                        copyBtn.className = 'btn-icon action-btn';
                        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
                        copyBtn.title = 'Copy Response';
                        copyBtn.onclick = () => {
                            vscode.postMessage({ type: 'copyCode', value: text });
                            // temporary success state
                            const original = copyBtn.innerHTML;
                            copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#27c93f"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                            setTimeout(() => copyBtn.innerHTML = original, 2000);
                        };
                        actionsDiv.appendChild(copyBtn);

                        // Regenerate Button
                        const regenBtn = document.createElement('button');
                        regenBtn.className = 'btn-icon action-btn';
                        regenBtn.innerHTML = '${icons.refresh}';
                        regenBtn.title = 'Regenerate';
                        regenBtn.onclick = () => {
                            vscode.postMessage({ type: 'regenerate', index: currentIdx });
                        };
                        actionsDiv.appendChild(regenBtn);
                    } else {
                        // Edit Button
                        const editBtn = document.createElement('button');
                        editBtn.className = 'btn-icon action-btn';
                        editBtn.innerHTML = '${icons.edit}';
                        editBtn.title = 'Edit';
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
                        currentAssistantMessageIndex = currentIdx;
                        enhanceCodeBlocks(div);
                    }

                    // Remove empty state dynamically
                    const es = document.getElementById('emptyState');
                    if (es) es.remove();
                    persistState();
                }
                
                function resetMessageIndex() {
                    messageIndex = 0;
                    messageHistory = [];
                    persistState();
                }

                function persistState() {
                    vscode.setState({
                        messages: messageHistory,
                        inputValue: messageInput.value,
                        isGenerating
                    });
                }

                if (initialState && Array.isArray(initialState.messages) && initialState.messages.length > 0) {
                    chatContainer.innerHTML = '';
                    resetMessageIndex();
                    document.body.classList.remove('new-chat');
                    initialState.messages.forEach(msg => {
                        addMessage(msg.role, msg.text, msg.files, msg.commands);
                    });
                } else {
                    document.body.classList.add('new-chat');
                }

                if (initialState && typeof initialState.inputValue === 'string' && initialState.inputValue.length > 0) {
                    messageInput.value = initialState.inputValue;
                    messageInput.style.height = 'auto';
                    messageInput.style.height = (messageInput.scrollHeight) + 'px';
                    if (messageInput.value === '') messageInput.style.height = '24px';
                    updateHighlight();
                }

                if (initialState && initialState.isGenerating) {
                    isGenerating = true;
                    updateUIState();
                    showThinkingIndicator();
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
                        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
                        copyBtn.title = 'Copy Code';
                        copyBtn.onclick = () => {
                            vscode.postMessage({ type: 'copyCode', value: code.innerText });
                            copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#27c93f"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                            setTimeout(() => copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>', 2000);
                        };
                        actions.appendChild(copyBtn);
                        
                        const insertBtn = document.createElement('button');
                        insertBtn.className = 'copy-btn';
                        insertBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"></path></svg>';
                        insertBtn.title = 'Insert at Cursor';
                        insertBtn.onclick = () => {
                            vscode.postMessage({ type: 'insertCode', value: code.innerText });
                            insertBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#27c93f"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                            setTimeout(() => insertBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"></path></svg>', 2000);
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
                    // Check if already selected
                    if (!selectedCommands.includes(cmd)) {
                        selectedCommands.push(cmd);
                        updateInputTags();
                    }
                    
                    // Remove the command text from input
                    const val = messageInput.value;
                    const lastSlash = val.lastIndexOf('/');
                    if (lastSlash !== -1) {
                         messageInput.value = val.substring(0, lastSlash);
                    } else {
                        messageInput.value = '';
                    }

                    updateHighlight();
                    messageInput.focus();
                    commandPopup.classList.remove('show');
                }

                function renderFiles(files) {
                    filePopup.innerHTML = '';
                    if (!files || files.length === 0) {
                        filePopup.classList.remove('show');
                        filePopupSelectedIndex = -1;
                        return;
                    }
                    
                    // Reset selection to first item when new files are loaded
                    filePopupSelectedIndex = 0;
                    
                    files.forEach((file, index) => {
                        const div = document.createElement('div');
                        div.className = 'file-item';
                        if (index === filePopupSelectedIndex) div.classList.add('selected');

                        // Sync Selection on Hover
                        div.onmouseenter = () => {
                            filePopupSelectedIndex = index;
                            Array.from(filePopup.children).forEach(child => child.classList.remove('selected'));
                            div.classList.add('selected');
                        };

                        // Determine Icon
                        let iconChar = '📄';
                        let iconClass = 'file-icon';
                        
                        if (file.isFolder) {
                             iconChar = '📁';
                             iconClass += ' icon-folder';
                        } else {
                            const ext = file.path.split('.').pop().toLowerCase();
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
                            // Tag Logic Replacement
                            const val = messageInput.value;
                            const cursorPos = messageInput.selectionStart;
                            const textBeforeCursor = val.substring(0, cursorPos);
                            const textAfterCursor = val.substring(cursorPos);
                            
                            // Find where the @ mention starts
                            const lastSpaceIndex = textBeforeCursor.lastIndexOf(' ');
                            const beforeAt = lastSpaceIndex === -1 ? '' : textBeforeCursor.substring(0, lastSpaceIndex + 1);

                            // Add to selected files
                            const fileObj = { path: file.path, fullPath: file.fullPath, name: fileName, isFolder: file.isFolder };
                            
                            // Check duplicates
                            if (!selectedFiles.some(f => f.path === file.path)) {
                                selectedFiles.push(fileObj);
                                updateInputTags();
                            }
                            
                            // Remove the @partial text from input
                            messageInput.value = beforeAt + textAfterCursor.trim();
                            
                            filePopup.classList.remove('show');
                            messageInput.focus();
                            
                            // Set cursor position
                            const newPos = beforeAt.length;
                            messageInput.setSelectionRange(newPos, newPos);
                            
                            updateHighlight();
                        };
                        filePopup.appendChild(div);
                    });
                }
                
                
                // Override addMessage to hide empty state and reset streaming state for new user messages
                const originalAddMessage = addMessage;
                addMessage = function(role, text, files = [], commands = []) {
                    if (role === 'user') {
                        currentAssistantMessageDiv = null;
                        currentAssistantMessageIndex = null;
                    }
                    const es = document.getElementById('emptyState');
                    if (es) es.remove();
                    return originalAddMessage(role, text, files, commands);
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
                        autoContext: document.getElementById('autoContext').checked
                    };
                    vscode.postMessage({ type: 'saveSettings', value: settings });
                    document.getElementById('settings-drawer').classList.remove('open');
                };

                window.scrollToBottom = () => {
                    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
                };

                chatContainer.addEventListener('scroll', () => {
                    const btn = document.getElementById('scrollToBottomBtn');
                    if (!btn) return;
                    if (chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight > 800) {
                        btn.classList.add('show');
                    } else {
                        btn.classList.remove('show');
                    }
                });

                window.executeCommand = (cmd) => {
                    vscode.postMessage({ type: 'executeCommand', command: cmd });
                };

                window.setInputValue = (val) => {
                    messageInput.value = val;
                    // Trigger auto-resize
                    messageInput.style.height = 'auto';
                    messageInput.style.height = (messageInput.scrollHeight) + 'px';
                    messageInput.focus();
                    updateHighlight();
                    
                    // Add subtle click feedback
                    const el = event?.currentTarget;
                    if (el) {
                        el.style.transform = 'scale(0.95)';
                        setTimeout(() => el.style.transform = '', 100);
                    }
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
