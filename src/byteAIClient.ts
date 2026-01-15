import * as WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export class ByteAIClient {
    private wsUrl = "wss://backend.buildpicoapps.com/api/chatbot/chat";
    private appId = "plan-organization";
    private chatId: string;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private isConnected = false;
    private _ws?: WebSocket;

    constructor() {
        this.chatId = uuidv4();
    }

    public resetSession() {
        this.chatId = uuidv4();
        this.disconnect();
        this.reconnectAttempts = 0;
    }

    private setupWebSocket(onChunk: (chunk: string) => void, onError: (err: any) => void, onComplete: () => void) {
        if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this._ws = new WebSocket(this.wsUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Origin": "null"
            },
            rejectUnauthorized: false
        });

        this._ws.on('open', () => {
            this.isConnected = true;
            this.reconnectAttempts = 0;
        });

        this._ws.on('message', (data: WebSocket.Data) => {
            const message = data.toString();
            onChunk(message);
        });

        this._ws.on('error', (err: any) => {
            console.error("WebSocket Error:", err);
            onError(err);
        });

        this._ws.on('close', (code, reason) => {
            this.isConnected = false;
            // Only retry if closed abnormally and not exceeded max attempts
            if (code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                const timeout = Math.min(1000 * (2 ** this.reconnectAttempts), 10000); // Exponential backoff max 10s
                this.reconnectAttempts++;
                console.log(`Reconnecting in ${timeout}ms (Attempt ${this.reconnectAttempts})...`);
                setTimeout(() => {
                    this.setupWebSocket(onChunk, onError, onComplete);
                    // Re-send payload logic would need to be handled by caller or state
                }, timeout);
            } else {
                onComplete();
            }
        });
    }

    public async streamResponse(userInput: string, onChunk: (chunk: string) => void, onError: (err: any) => void): Promise<string> {
        this.disconnect(); // Ensure fresh start for prompt-response cycle to avoid state mixups

        return new Promise((resolve, reject) => {
            let fullResponse = "";
            let hasResolved = false;

            const safeOnChunk = (chunk: string) => {
                fullResponse += chunk;
                onChunk(chunk);
            };

            const safeOnError = (err: any) => {
                if (!hasResolved) { onError(err); reject(err); hasResolved = true; }
            };

            const safeOnComplete = () => {
                if (!hasResolved) { resolve(fullResponse); hasResolved = true; }
            };

            this._ws = new WebSocket(this.wsUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Origin": "null"
                },
                rejectUnauthorized: false
            });

            this._ws.on('open', () => {
                const payload = {
                    chatId: this.chatId,
                    appId: this.appId,
                    systemPrompt: "",
                    message: userInput
                };
                this._ws?.send(JSON.stringify(payload));
            });

            this._ws.on('message', (data: WebSocket.Data) => {
                const message = data.toString();
                safeOnChunk(message);
            });

            this._ws.on('error', (err: any) => {
                safeOnError(err);
            });

            this._ws.on('close', () => {
                safeOnComplete();
            });
        });
    }

    public disconnect() {
        if (this._ws) {
            this._ws.removeAllListeners(); // Prevent dangling listeners
            this._ws.terminate();
            this._ws = undefined;
        }
    }
}
