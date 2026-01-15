import { IAgent, AgentResponse } from './interfaces';
import { ByteAIClient } from '../byteAIClient';

export class ChatAgent implements IAgent {
    public name = "ChatAgent";
    private client: ByteAIClient;

    constructor(client: ByteAIClient) {
        this.client = client;
    }

    public async execute(input: string, context: any, onUpdate: (update: AgentResponse) => void): Promise<void> {
        onUpdate({ type: 'status', value: '💡 Thinking...', isStream: false });

        const prompt = `You are Byte AI, an expert coding assistant. \n[CONTEXT]:\n${context.fullContext}\n\n[USER]: ${input}\n\nAnswer concisely and helpfully.`;

        await this.client.streamResponse(prompt,
            (chunk) => onUpdate({ type: 'response', value: chunk, isStream: true }),
            (err) => onUpdate({ type: 'error', value: err.message })
        );
    }
}
