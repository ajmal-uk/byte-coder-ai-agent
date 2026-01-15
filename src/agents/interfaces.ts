import * as vscode from 'vscode';

export interface AgentResponse {
    type: 'response' | 'status' | 'error' | 'action';
    value: string;
    isStream?: boolean;
    metadata?: any;
}

export interface IAgent {
    name: string;
    execute(input: string, context: any, onUpdate: (update: AgentResponse) => void): Promise<void>;
}
