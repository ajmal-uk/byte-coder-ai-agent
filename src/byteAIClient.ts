import * as WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export class ByteAIClient {
    private readonly wsUrl = "wss://backend.buildpicoapps.com/api/chatbot/chat";
    private readonly appId = "plan-organization";
    private chatId: string;
    private _ws?: WebSocket;

    private readonly SYSTEM_PROMPT = `You are Byte AI, an advanced AI coding assistant embedded in VS Code.
Your goal is to be helpful, concise, and professional.
- When explaining code, be clear and list key points.
- When fixing bugs, explain the fix and show the corrected code block.
- When generating tests, use modern testing frameworks (e.g., Jest, Pytest) suitable for the language.
- Context usage: You may receive file contents in the prompt. Use them to answer accurate questions about the user's codebase.
- Formatting: Use Markdown with language-specific code blocks.`;

    constructor() {
        this.chatId = uuidv4();
    }

    public resetSession(): void {
        this.chatId = uuidv4();
        this.disconnect();
    }

    public async streamResponse(
        userInput: string,
        onChunk: (chunk: string) => void,
        onError: (err: Error) => void
    ): Promise<string> {
        this.disconnect(); // Ensure fresh start for prompt-response cycle

        return new Promise((resolve, reject) => {
            let fullResponse = "";
            let hasResolved = false;
            let connectionTimeout: NodeJS.Timeout | null = null;
            let responseTimeout: NodeJS.Timeout | null = null;
            const CONNECT_TIMEOUT = 15000; // 15 seconds to connect
            const RESPONSE_TIMEOUT = 30000; // 30 seconds for first response

            const clearTimeouts = () => {
                if (connectionTimeout) {
                    clearTimeout(connectionTimeout);
                    connectionTimeout = null;
                }
                if (responseTimeout) {
                    clearTimeout(responseTimeout);
                    responseTimeout = null;
                }
            };

            const safeResolve = () => {
                if (!hasResolved) {
                    hasResolved = true;
                    clearTimeouts();
                    resolve(fullResponse);
                }
            };

            const safeReject = (err: Error) => {
                if (!hasResolved) {
                    hasResolved = true;
                    clearTimeouts();
                    onError(err);
                    reject(err);
                }
            };

            // Connection timeout - fail if we can't connect
            connectionTimeout = setTimeout(() => {
                if (!hasResolved) {
                    this.disconnect();
                    safeReject(new Error('Connection timeout. Please check your internet connection and try again.'));
                }
            }, CONNECT_TIMEOUT);

            this._ws = new WebSocket(this.wsUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Origin": "null"
                },
                rejectUnauthorized: false
            });

            this._ws.on('open', () => {
                // Clear connection timeout, set response timeout
                if (connectionTimeout) {
                    clearTimeout(connectionTimeout);
                    connectionTimeout = null;
                }

                responseTimeout = setTimeout(() => {
                    if (!hasResolved && fullResponse === "") {
                        this.disconnect();
                        safeReject(new Error('Response timeout. The AI server is taking too long to respond. Please try again.'));
                    }
                }, RESPONSE_TIMEOUT);

                const payload = {
                    chatId: this.chatId,
                    appId: this.appId,
                    systemPrompt: this.SYSTEM_PROMPT,
                    message: userInput
                };
                this._ws?.send(JSON.stringify(payload));
            });

            this._ws.on('message', (data: WebSocket.Data) => {
                // Clear response timeout on first message
                if (responseTimeout) {
                    clearTimeout(responseTimeout);
                    responseTimeout = null;
                }
                const chunk = data.toString();
                fullResponse += chunk;
                onChunk(chunk);
            });

            this._ws.on('error', (err: Error) => {
                console.error("WebSocket Error:", err);
                safeReject(new Error('Connection error. Please check your network and try again.'));
            });

            this._ws.on('close', () => {
                safeResolve();
            });
        });
    }

    public disconnect(): void {
        if (this._ws) {
            this._ws.removeAllListeners();
            this._ws.terminate();
            this._ws = undefined;
        }
    }
}
