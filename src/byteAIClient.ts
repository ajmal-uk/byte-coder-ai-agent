import * as WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { SYSTEM_PROMPT } from './prompts';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export class ByteAIClient {
    private wsUrl = "wss://backend.buildpicoapps.com/api/chatbot/chat";
    private appId = "plan-organization";
    private chatId: string;
    private _ws?: WebSocket;

    constructor() {
        this.chatId = uuidv4();
    }

    public resetSession() {
        this.chatId = uuidv4();
        this.disconnect();
    }

    public async streamResponse(userInput: string, onChunk: (chunk: string) => void, onError: (err: any) => void): Promise<string> {
        // Close existing connection if any
        this.disconnect();

        return new Promise((resolve, reject) => {
            const payload = {
                chatId: this.chatId,
                appId: this.appId,
                systemPrompt: SYSTEM_PROMPT,
                message: userInput
            };

            this._ws = new WebSocket(this.wsUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Origin": "null"
                },
                rejectUnauthorized: false
            });

            const ws = this._ws; // Local reference for closure safety

            ws.on('open', () => {
                ws.send(JSON.stringify(payload));
            });

            let fullResponse = "";

            ws.on('message', (data: WebSocket.Data) => {
                const message = data.toString();
                fullResponse += message;
                onChunk(fullResponse);
            });

            ws.on('error', (err: any) => {
                onError(err);
                reject(err);
            });

            ws.on('close', () => {
                resolve(fullResponse);
            });
        });
    }

    public disconnect() {
        if (this._ws) {
            this._ws.terminate();
            this._ws = undefined;
        }
    }
}
