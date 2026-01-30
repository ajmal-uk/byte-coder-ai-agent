
import { BaseAgent, AgentOutput } from '../core/AgentTypes';
import { ByteAIClient } from '../byteAIClient';

export interface QAInput {
    originalRequirements: string;
    implementedFiles: string[];
    testResults?: {
        passed: boolean;
        output: string;
    };
    fileContents?: Record<string, string>; // Map of filename -> content
}

export interface QAReport {
    passed: boolean;
    issues: {
        severity: 'critical' | 'major' | 'minor';
        description: string;
        recommendation: string;
        location?: string;
    }[];
    verificationSteps: string[];
    codeQualityScore: number; // 0-100
    suggestedFixes?: { filePath: string; modification: string }[];
}

export class QualityAssuranceAgent extends BaseAgent<QAInput, QAReport> {
    private client: ByteAIClient;

    constructor() {
        super({ name: 'QA', timeout: 30000 });
        this.client = new ByteAIClient();
    }

    async execute(input: QAInput): Promise<AgentOutput<QAReport>> {
        const startTime = Date.now();
        
        // 1. Basic Checks
        if (!input.implementedFiles || input.implementedFiles.length === 0) {
             return this.createOutput('failed', {
                 passed: false,
                 issues: [{ severity: 'critical', description: "No files were implemented.", recommendation: "Check CodeGenerator output." }],
                 verificationSteps: [],
                 codeQualityScore: 0
             }, 0.0, startTime);
        }

        // 2. LLM Analysis
        const prompt = `
You are a Lead QA Engineer.
Original Requirements: "${input.originalRequirements}"
Implemented Files: ${input.implementedFiles.join(', ')}
Test Results: ${input.testResults ? (input.testResults.passed ? "PASSED" : "FAILED") : "NOT RUN"}
Test Output: ${input.testResults?.output || "N/A"}

Analyze the implementation status.
1. If tests failed, analyze the error output and pinpoint the cause.
2. If tests passed (or weren't run), verify if the requirements are met based on file names and structure.
3. Provide specific actionable recommendations.

Output ONLY a JSON object:
{
  "passed": boolean,
  "issues": [
    { "severity": "critical"|"major"|"minor", "description": "What is wrong", "recommendation": "How to fix it", "location": "file:line" }
  ],
  "verificationSteps": ["Step 1", "Step 2"],
  "codeQualityScore": number (0-100),
  "suggestedFixes": [ { "filePath": "path", "modification": "description of fix" } ]
}
`;

        try {
            const response = await this.client.generateResponse(prompt);
            const report = this.parseResponse(response);

            // Override passed status if tests explicitly failed
            if (input.testResults && !input.testResults.passed) {
                report.passed = false;
            }

            return this.createOutput(report.passed ? 'success' : 'failed', report, 1.0, startTime, {
                reasoning: report.passed ? "QA checks passed." : `Found ${report.issues.length} issues.`
            });

        } catch (error) {
            console.error("QA Agent failed:", error);
            // Fallback
             return this.createOutput('partial', {
                 passed: input.testResults?.passed ?? false,
                 issues: [{ severity: 'minor', description: "LLM analysis failed, relying on test results.", recommendation: "Check logs." }],
                 verificationSteps: ["Manual Review"],
                 codeQualityScore: 50
             }, 0.5, startTime);
        }
    }

    private parseResponse(response: string): QAReport {
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : response;
            return JSON.parse(jsonStr);
        } catch (e) {
            throw new Error("Failed to parse QA JSON response");
        }
    }
}
