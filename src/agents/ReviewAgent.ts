import { ByteAIClient } from '../byteAIClient';
import { IAgent, AgentResponse } from './interfaces';

const REVIEW_PROMPT = `
You are a Senior Code Reviewer. Your job is to analyze code for:
1. Bugs and logical errors.
2. Security vulnerabilities.
3. Performance bottlenecks.
4. Code style and readability (Clean Code principles).

Provide your feedback in a structured, concise format.
If the code is good, say "✅ Code looks good."
`;

export class ReviewAgent implements IAgent {
    public name = "ReviewAgent";
    constructor(private client: ByteAIClient) { }

    public async execute(input: string, context: any, onUpdate: (update: AgentResponse) => void): Promise<void> {
        onUpdate({ type: 'status', value: '🔍 Reviewing Code...', isStream: false });

        const prompt = `${REVIEW_PROMPT}\n\n[CONTEXT]:\n${context.fullContext}\n\n[CODE TO REVIEW]:\n${input}`;

        let fullResponse = "";
        await this.client.streamResponse(prompt,
            (chunk) => {
                fullResponse += chunk;
                onUpdate({ type: 'response', value: chunk, isStream: true });
            },
            (err) => onUpdate({ type: 'error', value: err.message })
        );
    }
}
