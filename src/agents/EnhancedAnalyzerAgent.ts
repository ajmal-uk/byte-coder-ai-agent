/**
 * EnhancedAnalyzerAgent - Advanced analytical capabilities for superior task execution
 * Provides deep code analysis, pattern recognition, and intelligent decision making
 */

import * as vscode from 'vscode';
import { BaseAgent, AgentOutput, TaskNode, Complexity, FileLocation } from '../core/AgentTypes';
import { ByteAIClient } from '../byteAIClient';
import { ContextAnalyzer, ContextAnalyzerInput, AnalyzedContext } from './ContextAnalyzer';

export interface EnhancedAnalysisInput {
    query: string;
    codebaseContext: {
        files: string[];
        activeFile?: string;
        projectType: string;
    };
    targetFiles?: string[];
    analysisDepth: 'quick' | 'deep' | 'comprehensive';
}

export interface EnhancedAnalysisResult {
    intentClassification: {
        primaryIntent: string;
        confidence: number;
        subIntents: string[];
        complexity: Complexity;
    };
    codebaseInsights: {
        architecture: string;
        patterns: string[];
        dependencies: string[];
        potentialIssues: string[];
        optimizationOpportunities: string[];
    };
    executionStrategy: {
        approach: 'incremental' | 'comprehensive' | 'targeted';
        riskLevel: 'low' | 'medium' | 'high';
        recommendedAgents: string[];
        parallelizableTasks: string[];
        criticalPath: string[];
    };
    contextualKnowledge: {
        relevantFiles: FileLocation[];
        similarPatterns: Array<{ file: string; pattern: string; relevance: number }>;
        bestPractices: string[];
        securityConsiderations: string[];
    };
}

export class EnhancedAnalyzerAgent extends BaseAgent<EnhancedAnalysisInput, EnhancedAnalysisResult> {
    private client: ByteAIClient;
    private contextAnalyzer: ContextAnalyzer;
    private analysisCache: Map<string, EnhancedAnalysisResult> = new Map();

    constructor() {
        super({ name: 'EnhancedAnalyzer', timeout: 45000 });
        this.client = new ByteAIClient();
        this.contextAnalyzer = new ContextAnalyzer();
    }

    async execute(input: EnhancedAnalysisInput): Promise<AgentOutput<EnhancedAnalysisResult>> {
        const startTime = Date.now();
        const cacheKey = this.generateCacheKey(input);

        try {
            // Check cache first
            if (this.analysisCache.has(cacheKey)) {
                const cached = this.analysisCache.get(cacheKey)!;
                return this.createOutput('success', cached, 0.9, startTime, {
                    reasoning: 'Analysis retrieved from cache'
                });
            }

            // Perform multi-layered analysis
            const intentAnalysis = await this.analyzeIntent(input);
            const codebaseAnalysis = await this.analyzeCodebase(input);
            const strategicAnalysis = await this.analyzeExecutionStrategy(input, intentAnalysis, codebaseAnalysis);
            const contextualAnalysis = await this.analyzeContext(input);

            const result: EnhancedAnalysisResult = {
                intentClassification: intentAnalysis,
                codebaseInsights: codebaseAnalysis,
                executionStrategy: strategicAnalysis,
                contextualKnowledge: contextualAnalysis
            };

            // Cache the result
            this.analysisCache.set(cacheKey, result);

            return this.createOutput('success', result, 0.85, startTime, {
                reasoning: `Enhanced analysis completed with ${contextualAnalysis.relevantFiles.length} relevant files identified`
            });

        } catch (error) {
            return this.handleError(error as Error, startTime);
        }
    }

    private async analyzeIntent(input: EnhancedAnalysisInput) {
        const prompt = `You are an expert software architect with deep understanding of development patterns and user intent.

Analyze this request: "${input.query}"

Context:
- Project Type: ${input.codebaseContext.projectType}
- Active File: ${input.codebaseContext.activeFile || 'None'}
- Target Files: ${input.targetFiles?.join(', ') || 'None'}
- Available Files: ${input.codebaseContext.files.slice(0, 20).join(', ')}

Classify the intent with high precision:

1. Primary Intent (choose one):
   - Build: Create new features/components
   - Fix: Debug and resolve issues
   - Refactor: Improve code structure without changing behavior
   - Optimize: Improve performance, efficiency, or resource usage
   - Test: Add or improve testing
   - Document: Add or improve documentation
   - Analyze: Understand or explain code
   - Integrate: Connect different systems/components
   - Migrate: Move between technologies/versions
   - Configure: Setup or modify configuration

2. Confidence Level (0.0-1.0)

3. Sub-intents (up to 3 related intents)

4. Complexity Assessment:
   - Simple: Single file, straightforward logic, low risk
   - Medium: Multiple files, some interdependencies, moderate risk
   - Complex: Cross-system changes, high interdependencies, high risk

Return JSON format:
{
    "primaryIntent": "intent",
    "confidence": 0.95,
    "subIntents": ["intent1", "intent2"],
    "complexity": "simple|medium|complex",
    "reasoning": "Detailed explanation of classification"
}`;

        try {
            const response = await this.client.streamResponse(prompt, () => {}, () => {});
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    primaryIntent: parsed.primaryIntent || 'Build',
                    confidence: parsed.confidence || 0.7,
                    subIntents: parsed.subIntents || [],
                    complexity: parsed.complexity || 'medium'
                };
            }
        } catch (error) {
            console.warn('Intent analysis failed, using fallback:', error);
        }

        // Fallback analysis
        const lowerQuery = input.query.toLowerCase();
        let primaryIntent = 'Build';
        let complexity: Complexity = 'medium';

        if (lowerQuery.includes('fix') || lowerQuery.includes('bug') || lowerQuery.includes('error')) {
            primaryIntent = 'Fix';
        } else if (lowerQuery.includes('refactor') || lowerQuery.includes('clean') || lowerQuery.includes('organize')) {
            primaryIntent = 'Refactor';
        } else if (lowerQuery.includes('optimize') || lowerQuery.includes('performance') || lowerQuery.includes('speed')) {
            primaryIntent = 'Optimize';
        } else if (lowerQuery.includes('test') || lowerQuery.includes('spec') || lowerQuery.includes('unit')) {
            primaryIntent = 'Test';
        }

        if (input.targetFiles && input.targetFiles.length > 3) {
            complexity = 'complex';
        } else if (input.targetFiles && input.targetFiles.length <= 1) {
            complexity = 'simple';
        }

        return {
            primaryIntent,
            confidence: 0.6,
            subIntents: [],
            complexity
        };
    }

    private async analyzeCodebase(input: EnhancedAnalysisInput) {
        const architecture = await this.detectArchitecture(input.codebaseContext);
        const patterns = await this.detectPatterns(input.codebaseContext);
        const dependencies = await this.analyzeDependencies(input.codebaseContext);
        const issues = await this.identifyPotentialIssues(input.codebaseContext);
        const optimizations = await this.identifyOptimizations(input.codebaseContext);

        return {
            architecture,
            patterns,
            dependencies,
            potentialIssues: issues,
            optimizationOpportunities: optimizations
        };
    }

    private async detectArchitecture(context: EnhancedAnalysisInput['codebaseContext']): Promise<string> {
        const files = context.files;
        
        if (files.some(f => f.includes('components/') || f.includes('pages/')) && files.some(f => f.endsWith('.tsx') || f.endsWith('.jsx'))) {
            return 'React/SPA Architecture';
        } else if (files.some(f => f.includes('controllers/') || f.includes('models/') || f.includes('views/'))) {
            return 'MVC Architecture';
        } else if (files.some(f => f.includes('services/') || f.includes('repositories/') || f.includes('dto/'))) {
            return 'Layered/N-Tier Architecture';
        } else if (files.some(f => f.includes('store/') || f.includes('redux/') || f.includes('state/'))) {
            return 'State-Managed Architecture';
        } else if (files.some(f => f.includes('microservices') || files.length > 50)) {
            return 'Microservices Architecture';
        } else if (files.some(f => f.includes('lib/') || f.includes('utils/') || f.includes('helpers/'))) {
            return 'Modular/Library-based Architecture';
        }
        
        return 'Custom/Unknown Architecture';
    }

    private async detectPatterns(context: EnhancedAnalysisInput['codebaseContext']): Promise<string[]> {
        const patterns: string[] = [];
        const files = context.files;

        // Common design patterns detection
        if (files.some(f => f.includes('factory') || f.includes('Factory'))) patterns.push('Factory Pattern');
        if (files.some(f => f.includes('observer') || f.includes('EventEmitter') || f.includes('pubsub'))) patterns.push('Observer Pattern');
        if (files.some(f => f.includes('singleton') || f.includes('Singleton'))) patterns.push('Singleton Pattern');
        if (files.some(f => f.includes('decorator') || f.includes('hoc') || f.includes('wrapper'))) patterns.push('Decorator Pattern');
        if (files.some(f => f.includes('strategy') || f.includes('Strategy'))) patterns.push('Strategy Pattern');
        if (files.some(f => f.includes('adapter') || f.includes('Adapter'))) patterns.push('Adapter Pattern');
        
        // Architectural patterns
        if (files.some(f => f.includes('middleware') || f.includes('interceptor'))) patterns.push('Middleware Pattern');
        if (files.some(f => f.includes('repository') || f.includes('Repository'))) patterns.push('Repository Pattern');
        if (files.some(f => f.includes('dto') || f.includes('DataTransfer') || f.includes('vo'))) patterns.push('DTO/VO Pattern');

        return patterns;
    }

    private async analyzeDependencies(context: EnhancedAnalysisInput['codebaseContext']): Promise<string[]> {
        // Simplified dependency analysis - in production, would analyze package.json, imports, etc.
        const dependencies: string[] = [];
        const files = context.files;

        if (files.some(f => f.includes('package.json'))) dependencies.push('Node.js/npm');
        if (files.some(f => f.includes('requirements.txt') || f.includes('pyproject.toml'))) dependencies.push('Python/Pip');
        if (files.some(f => f.includes('Cargo.toml'))) dependencies.push('Rust/Cargo');
        if (files.some(f => f.includes('go.mod'))) dependencies.push('Go/Modules');
        
        if (files.some(f => f.endsWith('react') || f.includes('React'))) dependencies.push('React');
        if (files.some(f => f.includes('vue') || f.includes('Vue'))) dependencies.push('Vue.js');
        if (files.some(f => f.includes('angular') || f.includes('Angular'))) dependencies.push('Angular');
        
        if (files.some(f => f.includes('express'))) dependencies.push('Express.js');
        if (files.some(f => f.includes('fastapi'))) dependencies.push('FastAPI');
        if (files.some(f => f.includes('django'))) dependencies.push('Django');

        return dependencies;
    }

    private async identifyPotentialIssues(context: EnhancedAnalysisInput['codebaseContext']): Promise<string[]> {
        const issues: string[] = [];
        
        // This would be enhanced with actual static analysis in production
        // For now, return common potential issues based on file structure
        
        return issues; // Placeholder - would implement actual analysis
    }

    private async identifyOptimizations(context: EnhancedAnalysisInput['codebaseContext']): Promise<string[]> {
        const optimizations: string[] = [];
        
        // This would be enhanced with actual performance analysis
        // For now, return common optimization opportunities
        
        return optimizations; // Placeholder - would implement actual analysis
    }

    private async analyzeExecutionStrategy(
        input: EnhancedAnalysisInput,
        intentAnalysis: any,
        codebaseAnalysis: any
    ) {
        const complexity = intentAnalysis.complexity;
        const primaryIntent = intentAnalysis.primaryIntent;
        
        let approach: 'incremental' | 'comprehensive' | 'targeted' = 'incremental';
        let riskLevel: 'low' | 'medium' | 'high' = 'medium';
        let recommendedAgents: string[] = ['CodeGenerator'];
        
        // Determine approach based on complexity and intent
        if (complexity === 'complex') {
            approach = 'comprehensive';
            riskLevel = 'high';
            recommendedAgents = ['Architect', 'TaskPlanner', 'CodeGenerator', 'QualityAssurance'];
        } else if (complexity === 'simple') {
            approach = 'targeted';
            riskLevel = 'low';
            recommendedAgents = ['CodeGenerator'];
        } else {
            approach = 'incremental';
            riskLevel = 'medium';
            recommendedAgents = ['TaskPlanner', 'CodeGenerator'];
        }
        
        // Adjust based on intent
        if (primaryIntent === 'Fix') {
            recommendedAgents.push('ContextSearch', 'CodeModifier');
        } else if (primaryIntent === 'Test') {
            recommendedAgents = ['CodeGenerator', 'QualityAssurance'];
        } else if (primaryIntent === 'Refactor') {
            recommendedAgents = ['ContextAnalyzer', 'CodeModifier', 'QualityAssurance'];
        }
        
        return {
            approach,
            riskLevel,
            recommendedAgents: [...new Set(recommendedAgents)], // Remove duplicates
            parallelizableTasks: [], // Would be determined by task analysis
            criticalPath: [] // Would be determined by dependency analysis
        };
    }

    private async analyzeContext(input: EnhancedAnalysisInput) {
        // Create a mock plan for the context analyzer
        const mockPlan: any = {
            searchTerms: this.extractSearchTerms(input.query),
            symbolSearch: this.extractSymbolSearch(input.query)
        };

        const rawContent = new Map<string, string>();
        
        // Add file contents for relevant files
        for (const file of input.codebaseContext.files) {
            try {
                const wsFolder = vscode.workspace.workspaceFolders?.[0];
                if (wsFolder) {
                    const uri = vscode.Uri.joinPath(wsFolder.uri, file);
                    const content = await vscode.workspace.fs.readFile(uri);
                    rawContent.set(file, Buffer.from(content).toString());
                }
            } catch (error) {
                // File might not exist or be readable, skip
            }
        }

        const contextInput: ContextAnalyzerInput = {
            query: input.query,
            rawContent: rawContent,
            plan: mockPlan
        };

        try {
            const result = await this.contextAnalyzer.execute(contextInput);
            if (result.status === 'success' && result.payload) {
                return {
                    relevantFiles: result.payload.chunks.map(chunk => ({
                        file: chunk.filePath,
                        startLine: chunk.startLine,
                        endLine: chunk.endLine,
                        element: chunk.type,
                        confidence: chunk.score,
                        reason: `Matched terms: ${chunk.matchedTerms.join(', ')}`
                    })),
                    similarPatterns: [], // Would be implemented with pattern matching
                    bestPractices: [], // Would be implemented with knowledge base
                    securityConsiderations: [] // Would be implemented with security analysis
                };
            }
        } catch (error) {
            console.warn('Context analysis failed:', error);
        }

        // Fallback
        return {
            relevantFiles: [],
            similarPatterns: [],
            bestPractices: [],
            securityConsiderations: []
        };
    }

    private extractSearchTerms(query: string): string[] {
        // Extract meaningful search terms from the query
        return query.toLowerCase()
            .split(/\s+/)
            .filter(word => word.length > 2)
            .filter(word => !['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'are', 'was', 'were'].includes(word));
    }

    private extractSymbolSearch(query: string): string[] {
        // Extract potential function/class names from the query
        const symbols: string[] = [];
        const camelCaseMatches = query.match(/\b[A-Z][a-zA-Z0-9]*\b/g);
        const snakeCaseMatches = query.match(/\b[a-z][a-z0-9_]*[a-z]\b/g);
        
        if (camelCaseMatches) symbols.push(...camelCaseMatches);
        if (snakeCaseMatches) symbols.push(...snakeCaseMatches);
        
        return symbols;
    }

    private generateCacheKey(input: EnhancedAnalysisInput): string {
        return `${input.query}_${input.codebaseContext.projectType}_${input.targetFiles?.join(',') || 'none'}_${input.analysisDepth}`;
    }

    public clearCache(): void {
        this.analysisCache.clear();
    }
}