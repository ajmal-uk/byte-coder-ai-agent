import * as vscode from 'vscode';
import { ChatPanel } from './ChatPanel';

export function activate(context: vscode.ExtensionContext) {
    console.log('Byte AI Coding Assistant is now active!');

    const provider = new ChatPanel(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatPanel.viewType, provider)
    );

    // Auto-focus the chat view on load
    vscode.commands.executeCommand('byteAI.chatView.focus');

    context.subscriptions.push(
        vscode.commands.registerCommand('byteAI.clearChat', () => {
            provider.clearChat();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('byteAI.explainCode', () => {
            provider.runCommand('explain');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('byteAI.fixCode', () => {
            provider.runCommand('fix');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('byteAI.generateDocs', () => {
            provider.runCommand('doc');
        })
    );
}

export function deactivate() { }
