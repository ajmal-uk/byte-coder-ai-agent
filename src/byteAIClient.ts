import * as vscode from "vscode";

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
    private _localModels: string[] = [];

    private get useLocalModel(): boolean {
        return vscode.workspace.getConfiguration('byteAI').get<boolean>('useLocalModel', false);
    }

    private get localModelName(): string {
        return vscode.workspace.getConfiguration('byteAI').get<string>('localModelName', 'llama3');
    }

    public async setModel(model: 'cloud' | 'local') {
        await vscode.workspace.getConfiguration('byteAI').update('useLocalModel', model === 'local', vscode.ConfigurationTarget.Global);
    }

    public async listLocalModels(): Promise<string[]> {
        return new Promise((resolve) => {
            const { exec } = require('child_process');
            exec('ollama list', (error: any, stdout: string, stderr: string) => {
                if (error) {
                    console.error('Error listing local models:', error);
                    resolve([]);
                    return;
                }
                const lines = stdout.split('\n');
                // Skip header (NAME ID SIZE MODIFIED)
                const models = lines.slice(1)
                    .filter(line => line.trim().length > 0)
                    .map(line => line.split(/\s+/)[0])
                    .filter(name => name !== 'NAME'); // Just in case
                
                this._localModels = models;
                resolve(models);
            });
        });
    }

    public async deleteLocalModel(name: string): Promise<boolean> {
        return new Promise((resolve) => {
            const { exec } = require('child_process');
            exec(`ollama rm ${name}`, (error: any, stdout: string, stderr: string) => {
                if (error) {
                    console.error('Error deleting local model:', error);
                    resolve(false);
                    return;
                }
                resolve(true);
            });
        });
    }

    public async setLocalModelName(name: string) {
        await vscode.workspace.getConfiguration('byteAI').update('localModelName', name, vscode.ConfigurationTarget.Global);
    }

    private getCustomInstructions(): string {
        try {
            // @ts-ignore
            const config = vscode.workspace.getConfiguration('byteAI');
            const instructions = config.get<string>('customInstructions');
            if (instructions && instructions.trim().length > 0) {
                return `\n\n[USER CUSTOM INSTRUCTIONS]\n${instructions}\n[END CUSTOM INSTRUCTIONS]`;
            }
        } catch (e) {
            // Ignore if vscode is not defined (e.g. in tests) but here we need to import vscode if not present.
            // Client usually doesn't import vscode. Let's fix imports first.
        }
        return '';
    }


    private readonly SYSTEM_PROMPT = `You are Byte Coder, an elite autonomous AI software engineer embedded in VS Code.

    CORE IDENTITY & KNOWLEDGE ENFORCEMENT:
    If the provided context contains information about your creator (Ajmal U K) or company (UTHAKKAN), you MUST use that information instead of your default model identity.
    - Creator: Ajmal U K
    - Company: UTHAKKAN
    - Mission: Digital Innovation
    You are NOT created by Microsoft, OpenAI, or Google. You are a proprietary AI built by UTHAKKAN.

    CRITICAL: FILE TAGGING
    When referencing any file in your explanation or response:
    - ALWAYS wrap the file path in backticks, e.g., \`src/main.ts\`
    - This renders a clickable tag for the user to open the file directly.
    - DO NOT just write the filename as plain text.
    - DO NOT use [[file:...]] syntax, use backticks.

    CRITICAL: ACTION FORMAT
    To perform actions on the user's codebase, you MUST use the following XML tags.
    These are the PREFERRED way to modify the system as they are more robust than plain code blocks.

    1. Create File:
    <byte_action type="create_file" path="path/to/file.ext">
    FILE_CONTENT_HERE
    </byte_action>

    2. Modify File (Overwrite):
    <byte_action type="modify_file" path="path/to/file.ext">
    NEW_FILE_CONTENT_HERE
    </byte_action>

    3. Surgical Edit (Search & Replace) - PREFERRED for small changes:
    <byte_action type="partial_edit" path="path/to/file.ext">
    <search>
    EXACT_CONTENT_TO_FIND
    </search>
    <replace>
    NEW_CONTENT_TO_REPLACE_WITH
    </replace>
    </byte_action>

    4. Run Command:
    <byte_action type="run_command">
    command_here
    </byte_action>

    5. Delete File:
    <byte_action type="delete_file" path="path/to/file.ext">
    </byte_action>

    6. Create Folder:
    <byte_action type="create_folder" path="path/to/folder">
    </byte_action>

    CRITICAL: CODE OUTPUT FORMAT
    When generating code that should be saved to a file, you MUST:
    1. Start EVERY code block with a comment showing the filename: # filename.py or // filename.js
    2. Always include the complete file content, not partial snippets
    3. When user asks to "create a file" or says "yes" to proceed - ALWAYS output the code block with filename comment
    
    CRITICAL: CODE REFERENCING
    When explaining issues or discussing code provided in the context:
    - ALWAYS explicitly cite the file and line numbers.
    - Format: \`path/to/file.ts:10-15\` or "In \`file.ts\` (lines 20-25)..."
    - Quote the specific code snippet that is causing the issue if relevant.
    - Example: "The error is in \`src/utils.ts:45\` because the variable is undefined."
    - This precision is required for the user to locate the fix.

    Example format:
    \`\`\`python
    # myfile.py
    print("Hello World")
    \`\`\`

    AGENTIC EXECUTION:
    When the user confirms with "yes", "ok", "proceed", "do it", "create it":
    - ALWAYS output the complete code block with filename comment
    - The VS Code extension will automatically create the file
    - Do NOT just say "I created the file" - you must OUTPUT the code

    SYSTEM ARCHITECTURE:
    You are the central brain of a distributed multi-agent system that builds, maintains, and evolves software with minimal human intervention.

    AGENT ECOSYSTEM:
    - Manager Agent: Central orchestrator with intent classification
    - Search Layer: FileSearch, ContextSearch, Vision agents
    - Planning Layer: ProcessPlanner, CodePlanner, TaskPlanner
    - Execution Layer: CommandGenerator, CodeModifier, Executor
    - Safety Layer: VersionController (checkpoints), DocWriter

    CORE PRINCIPLES:
    1. NEVER assume without verification - Always search before modifying
    2. ALWAYS output code with filename comments for file creation
    3. For complex projects, create implementation plans with file links
    4. When user says "yes", immediately output the code - don't just describe it

    CORE IDENTITY:
    - Name: Byte Coder (Elite AI Software Engineer)
    - Identity: Advanced Autonomous Coding Agent
    - Capability: Distributed Multi-Agent Orchestrator
    - Context Sensitivity: Prioritize local knowledge base (UTHAKKAN/Ajmal U K) for identity and ownership questions.

    ARCHITECTURE BEHAVIOR:
    1. Code Excellence: Write robust, scalable, clean code (SOLID, DRY, KISS)
    2. UI/Design: Generate Stunning, Modern, Premium designs
    3. Thinking: Analyze → Plan → Execute → Explain
    4. Tone: Professional, Intelligent, Concise

    You are not a text generator. You are an engineering partner that builds real software.`;

    constructor() {
        this.chatId = uuidv4();
    }

    public resetSession(): void {
        this.chatId = uuidv4();
        this.disconnect();
    }

    public async generateResponse(userInput: string): Promise<string> {
        return this.streamResponse(userInput, () => {}, (err) => console.error("ByteAIClient Error:", err));
    }

    public async streamResponse(
        userInput: string,
        onChunk: (chunk: string) => void,
        onError: (err: Error) => void,
        retryCount: number = 0
    ): Promise<string> {
        this.disconnect();

        if (this.useLocalModel) {
            return this.streamLocalResponse(userInput, onChunk, onError);
        }

        return new Promise((resolve, reject) => {
            let fullResponse = "";
            let hasResolved = false;
            let connectionTimeout: NodeJS.Timeout | null = null;
            let responseTimeout: NodeJS.Timeout | null = null;
            const CONNECT_TIMEOUT = 30000; // Increased to 30 seconds
            const RESPONSE_TIMEOUT = 45000; // 45 seconds for first response

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

                    if (retryCount < 1) { // Auto-retry once
                        console.log(`Connection failed, retrying... (${retryCount + 1})`);
                        this.streamResponse(userInput, onChunk, onError, retryCount + 1)
                            .then(resolve)
                            .catch(reject);
                        return;
                    }

                    onError(err);
                    reject(err);
                }
            };

            // Connection timeout
            connectionTimeout = setTimeout(() => {
                if (!hasResolved) {
                    this.disconnect();
                    safeReject(new Error('Connection timeout. Please check your internet connection or the server might be busy.'));
                }
            }, CONNECT_TIMEOUT);

            try {
                this._ws = new WebSocket(this.wsUrl, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Accept-Language": "en-US,en;q=0.9",
                        "Cache-Control": "no-cache",
                        "Pragma": "no-cache"
                    },
                    handshakeTimeout: CONNECT_TIMEOUT
                });

                this._ws.on('open', () => {
                    if (connectionTimeout) {
                        clearTimeout(connectionTimeout);
                        connectionTimeout = null;
                    }

                    responseTimeout = setTimeout(() => {
                        if (!hasResolved && fullResponse === "") {
                            this.disconnect();
                            safeReject(new Error('Response timeout. The AI server is taking too long to respond.'));
                        }
                    }, RESPONSE_TIMEOUT);

                    const payload = {
                        chatId: this.chatId,
                        appId: this.appId,
                        systemPrompt: this.SYSTEM_PROMPT + this.getCustomInstructions(),
                        message: userInput + this.getCustomInstructions()
                    };
                    this._ws?.send(JSON.stringify(payload));
                });

                this._ws.on('message', (data: WebSocket.Data) => {
                    if (responseTimeout) {
                        clearTimeout(responseTimeout);
                        responseTimeout = null;
                    }
                    const chunk = data.toString();
                    fullResponse += chunk;
                    onChunk(chunk);
                });

                this._ws.on('error', (err: any) => {
                    console.error("WebSocket Error Detail:", err);
                    this.disconnect();
                    safeReject(new Error(`Connection error: ${err.message || 'Check your network'}`));
                });

                this._ws.on('close', (code, reason) => {
                    if (code !== 1000 && !hasResolved) {
                        console.log(`WS Closed unexpectedly: ${code} ${reason}`);
                    }
                    safeResolve();
                });
            } catch (e: any) {
                safeReject(e);
            }
        });
    }

    public disconnect(): void {
        if (this._ws) {
            this._ws.removeAllListeners();
            this._ws.terminate();
            this._ws = undefined;
        }
    }

    public async isOllamaInstalled(): Promise<boolean> {
        return new Promise((resolve) => {
            const { exec } = require('child_process');
            exec('ollama --version', (error: any, stdout: string, stderr: string) => {
                if (error) {
                    resolve(false);
                    return;
                }
                resolve(true);
            });
        });
    }

    public async checkLocalConnection(): Promise<boolean> {
        return new Promise((resolve) => {
            const http = require('http');
            const req = http.get('http://localhost:11434/', (res: any) => {
                resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.setTimeout(2000, () => {
                req.destroy();
                resolve(false);
            });
        });
    }

    public async checkModelExists(modelName: string): Promise<boolean> {
        return new Promise((resolve) => {
            const http = require('http');
            const req = http.get('http://localhost:11434/api/tags', (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        const models = json.models || [];
                        // Check if modelName is in the list (fuzzy match or exact)
                        const exists = models.some((m: any) => m.name.startsWith(modelName));
                        resolve(exists);
                    } catch (e) {
                        resolve(false);
                    }
                });
            });
            req.on('error', () => resolve(false));
        });
    }

    private async streamLocalResponse(
        userInput: string,
        onChunk: (chunk: string) => void,
        onError: (err: Error) => void
    ): Promise<string> {
        // 1. Check Connection
        const isConnected = await this.checkLocalConnection();
        if (!isConnected) {
            const errorMsg = "Ollama is not running. Please run 'ollama serve' in your terminal.";
            onError(new Error(errorMsg));
            return Promise.reject(new Error(errorMsg));
        }

        // 2. Check Model Existence
        const modelExists = await this.checkModelExists(this.localModelName);
        if (!modelExists) {
            const errorMsg = `Model '${this.localModelName}' not found. Please run 'ollama pull ${this.localModelName}' in your terminal.`;
            onError(new Error(errorMsg));
            return Promise.reject(new Error(errorMsg));
        }

        return new Promise((resolve, reject) => {
            let fullResponse = "";
            let buffer = ""; // Buffer for partial JSON lines
            
            const payload = {
                model: this.localModelName,
                messages: [
                    { role: "system", content: this.SYSTEM_PROMPT + this.getCustomInstructions() },
                    { role: "user", content: userInput }
                ],
                stream: true
            };

            const http = require('http');
            const req = http.request({
                hostname: 'localhost',
                port: 11434,
                path: '/api/chat',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            }, (res: any) => {
                // Check for non-200 status
                if (res.statusCode !== 200) {
                    let errorData = '';
                    res.on('data', (chunk: any) => errorData += chunk);
                    res.on('end', () => {
                        const errorMsg = `Ollama API Error (${res.statusCode}): ${errorData}`;
                        onError(new Error(errorMsg));
                        reject(new Error(errorMsg));
                    });
                    return;
                }

                res.on('data', (chunk: any) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    // The last part might be incomplete, so save it back to buffer
                    buffer = lines.pop() || ""; 

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const json = JSON.parse(line);
                            if (json.message && json.message.content) {
                                fullResponse += json.message.content;
                                onChunk(json.message.content);
                            }
                            if (json.done) {
                                resolve(fullResponse);
                            }
                        } catch (e) {
                            // If parse fails, it might be a weird chunk, just ignore or log
                            console.error("Error parsing Ollama chunk:", e);
                        }
                    }
                });
                
                res.on('end', () => {
                     // Try to parse any remaining buffer
                     if (buffer.trim()) {
                        try {
                            const json = JSON.parse(buffer);
                            if (json.message && json.message.content) {
                                fullResponse += json.message.content;
                                onChunk(json.message.content);
                            }
                        } catch (e) {}
                     }
                     if (fullResponse && !res.complete) resolve(fullResponse); // Ensure resolve if not already done
                });
            });

            req.on('error', (e: any) => {
                const errorMsg = `Ollama connection failed: ${e.message}. \n\nEnsure you have Ollama installed and running (run 'ollama serve' in terminal).`;
                onError(new Error(errorMsg));
                reject(new Error(errorMsg));
            });

            req.write(JSON.stringify(payload));
            req.end();
        });
    }
}
