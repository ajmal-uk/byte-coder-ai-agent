/**
 * IntentAnalyzer - Advanced query intent analysis sub-agent
 * Extracts keywords, code patterns, and determines search strategy
 */

import * as vscode from 'vscode';
import { ByteAIClient } from '../byteAIClient';
import { BaseAgent, AgentOutput } from '../core/AgentTypes';

export interface SearchIntent {
    keywords: string[];
    codeTerms: string[];
    filePatterns: string[];
    queryType: 'fix' | 'explain' | 'refactor' | 'test' | 'optimize' | 'security' | 'general' | 'build' | 'modify' | 'command' | 'version_control' | 'web_search';
    complexity: 'simple' | 'medium' | 'complex';
    mentionedFiles: string[];
    symbols: string[];  // Function/class names extracted
    originalQuery: string;
    reasoning?: string;
    confidence: number;
}

export class IntentAnalyzer extends BaseAgent<{ query: string }, SearchIntent> {
    private client: ByteAIClient;

    // Stop words to filter from keyword extraction
    private readonly STOP_WORDS = new Set([
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these',
        'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
        'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
        'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
        'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'code',
        'file', 'function', 'class', 'method', 'variable', 'please', 'help',
        'want', 'need', 'make', 'create', 'add', 'get', 'set', 'use', 'show',
        'tell', 'give', 'find', 'look', 'see', 'know', 'think', 'take', 'come'
    ]);

    // Query type detection patterns
    private readonly QUERY_PATTERNS: { [key: string]: RegExp[] } = {
        'fix': [/\bfix\b/i, /\bbug\b/i, /\berror\b/i, /\bissue\b/i, /\bproblem\b/i, /\bbroken\b/i, /\bwrong\b/i, /\bfail/i, /\bcrash/i, /\bnot working/i, /\bdebug\b/i],
        'explain': [/\bexplain\b/i, /\bwhat\b/i, /\bhow\b/i, /\bwhy\b/i, /\bunderstand\b/i, /\bdescribe\b/i, /\bwalk.*through\b/i, /\bwho\b/i, /\bwhere\b/i, /\bwhen\b/i, /\bmean\b/i],
        'refactor': [/\brefactor\b/i, /\bimprove\b/i, /\bclean\b/i, /\bbetter\b/i, /\benhance\b/i, /\brewrite\b/i],
        'test': [/\btest\b/i, /\btests\b/i, /\bunit\b/i, /\bspec\b/i, /\bcoverage\b/i, /\bmock\b/i],
        'optimize': [/\bperformance\b/i, /\bspeed\b/i, /\bfast\b/i, /\bslow\b/i, /\bmemory\b/i, /\befficient\b/i, /\boptimize\b/i],
        'security': [/\bsecurity\b/i, /\bvulnerab/i, /\bauth/i, /\bpassword\b/i, /\btoken\b/i, /\bencrypt/i, /\bsanitize\b/i, /\baudit\b/i],
        'build': [/\bcreate\b/i, /\bbuild\b/i, /\bgenerate\b/i, /\bimplement\b/i, /\bscaffold\b/i, /\bsetup\b/i, /\bnew\b/i, /\binit\b/i],
        'modify': [/\bchange\b/i, /\bupdate\b/i, /\bmodify\b/i, /\bedit\b/i, /\breplace\b/i, /\bremove\b/i, /\bdelete\b/i],
        'command': [/\brun\b/i, /\bexecute\b/i, /\bcommand\b/i, /\bterminal\b/i, /\bshell\b/i, /\bnpm\b/i, /\byarn\b/i, /\bgit\b/i, /\binstall\b/i],
        'version_control': [/\bcommit\b/i, /\bpush\b/i, /\bpull\b/i, /\bcheckpoint\b/i, /\bundo\b/i, /\brevert\b/i, /\brollback\b/i],
        'web_search': [/\bsearch\b/i, /\bgoogle\b/i, /\bfind online\b/i, /\blookup\b/i, /\bweb\b/i]
    };

    // Semantic map for keyword expansion
    private readonly SEMANTIC_MAP: Record<string, string[]> = {
        'auth': ['login', 'signup', 'authentication', 'authorization', 'token', 'jwt', 'oauth'],
        'database': ['db', 'sql', 'mongo', 'postgres', 'schema', 'model', 'query'],
        'api': ['endpoint', 'route', 'controller', 'service', 'http', 'rest', 'graphql'],
        'ui': ['component', 'view', 'screen', 'page', 'layout', 'css', 'style'],
        'test': ['spec', 'unit', 'integration', 'e2e', 'jest', 'mocha', 'assert'],
        'error': ['bug', 'fix', 'exception', 'stack', 'trace', 'fail', 'crash'],
        'user': ['profile', 'account', 'member', 'customer', 'client'],
        'config': ['setting', 'env', 'environment', 'variable', 'option', 'setup']
    };

    constructor() {
        super({ name: 'IntentAnalyzer', timeout: 20000 });
        this.client = new ByteAIClient();
    }

    async execute(input: { query: string }): Promise<AgentOutput<SearchIntent>> {
        const startTime = Date.now();
        const intent = await this.analyze(input.query);
        return this.createOutput('success', intent, 0.9, startTime);
    }

    /**
     * Analyze a query and extract structured search intent
     * Uses Heuristics first, falls back to LLM for complex queries
     */
    public async analyze(query: string): Promise<SearchIntent> {
        // 1. Fast Heuristic Analysis
        const queryType = this.detectQueryType(query);
        const mentionedFiles = this.extractMentionedFiles(query);
        const symbols = this.extractSymbols(query);
        const keywords = this.extractKeywords(query);
        const expandedKeywords = this.expandKeywords(keywords);
        const filePatterns = this.generateFilePatterns(expandedKeywords, mentionedFiles, queryType);
        const complexity = this.assessComplexity(query, keywords);

        const heuristicIntent: SearchIntent = {
            keywords: expandedKeywords,
            codeTerms: symbols,
            filePatterns,
            queryType,
            complexity,
            mentionedFiles,
            symbols,
            originalQuery: query,
            confidence: complexity === 'simple' ? 0.9 : 0.7
        };

        // 2. If simple or high confidence, return heuristics
        if (complexity === 'simple' && queryType !== 'general') {
            return heuristicIntent;
        }

        // 3. For complex/vague queries, use LLM
        try {
            return await this.analyzeWithLLM(query, heuristicIntent);
        } catch (error) {
            console.warn('IntentAnalyzer LLM failed, falling back to heuristics', error);
            return heuristicIntent;
        }
    }

    private async analyzeWithLLM(query: string, heuristic: SearchIntent): Promise<SearchIntent> {
        const prompt = `
Analyze the User Query to determine intent, complexity, and search terms.

User Query: "${query}"

Heuristic Detection:
- Type: ${heuristic.queryType}
- Complexity: ${heuristic.complexity}
- Keywords: ${heuristic.keywords.join(', ')}

Classify into ONE Query Type:
- fix: Fixing bugs, errors, issues
- explain: Asking for explanation, understanding
- refactor: improving code quality without changing behavior
- test: adding or running tests
- optimize: improving performance
- security: security audit or fix
- build: creating new files, features, projects
- modify: changing existing code logic
- command: running terminal commands
- version_control: git operations
- web_search: searching internet
- general: other

Determine Complexity: simple (1 file/small change), medium (multi-file/function), complex (architecture/system-wide).

Extract:
- Keywords: semantic search terms
- FilePatterns: glob patterns for relevant files
- Symbols: specific class/function names mentioned

Output JSON ONLY:
{
  "queryType": "type",
  "complexity": "simple|medium|complex",
  "keywords": ["term1", "term2"],
  "filePatterns": ["*.ts", "src/**"],
  "symbols": ["funcName"],
  "reasoning": "Brief explanation"
}
`;
        const response = await this.client.generateResponse(prompt);
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return heuristic;

        const parsed = JSON.parse(jsonMatch[0]);
        
        return {
            ...heuristic,
            queryType: parsed.queryType || heuristic.queryType,
            complexity: parsed.complexity || heuristic.complexity,
            keywords: [...new Set([...heuristic.keywords, ...(parsed.keywords || [])])],
            filePatterns: [...new Set([...heuristic.filePatterns, ...(parsed.filePatterns || [])])],
            symbols: [...new Set([...heuristic.symbols, ...(parsed.symbols || [])])],
            reasoning: parsed.reasoning,
            confidence: 0.95
        };
    }


    /**
     * Detect the type of query (fix, explain, refactor, etc.)
     */
    private detectQueryType(query: string): SearchIntent['queryType'] {
        for (const [type, patterns] of Object.entries(this.QUERY_PATTERNS)) {
            if (patterns.some(p => p.test(query))) {
                return type as SearchIntent['queryType'];
            }
        }
        return 'general';
    }

    /**
     * Extract @mentioned files from query
     */
    private extractMentionedFiles(query: string): string[] {
        const mentions = query.match(/@[\w./\\-]+/g) || [];
        return mentions.map(m => m.substring(1));
    }

    /**
     * Extract code symbols (function/class names) from query
     */
    private extractSymbols(query: string): string[] {
        const symbols: string[] = [];

        // CamelCase identifiers
        const camelCase = query.match(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g) || [];
        symbols.push(...camelCase);

        // PascalCase identifiers (class names)
        const pascalCase = query.match(/\b[A-Z][a-z][a-zA-Z0-9]*\b/g) || [];
        symbols.push(...pascalCase);

        // snake_case identifiers
        const snakeCase = query.match(/\b[a-z]+_[a-z_]+\b/g) || [];
        symbols.push(...snakeCase);

        // Function calls
        const funcCalls = query.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\s*\(/g) || [];
        symbols.push(...funcCalls.map(f => f.replace(/\s*\($/, '')));

        return [...new Set(symbols)];
    }

    /**
     * Extract and filter keywords from query
     */
    private extractKeywords(query: string): string[] {
        const words = query.toLowerCase()
            .replace(/[^\w\s@/.-]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !this.STOP_WORDS.has(w));

        // Also extract parts of camelCase words
        const codeTerms = this.extractSymbols(query);
        const codeParts: string[] = [];

        for (const term of codeTerms) {
            // Split camelCase
            const separated = term.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
            const parts = separated.split(/[_\s]+/);
            for (const part of parts) {
                const lowered = part.toLowerCase();
                if (lowered.length > 2 && !this.STOP_WORDS.has(lowered)) {
                    codeParts.push(lowered);
                }
            }
        }

        return [...new Set([...words, ...codeParts])];
    }

    /**
     * Expand keywords using semantic map
     */
    private expandKeywords(keywords: string[]): string[] {
        const expanded = new Set(keywords);

        for (const keyword of keywords) {
            const expansions = this.SEMANTIC_MAP[keyword];
            if (expansions) {
                expansions.forEach((e: string) => expanded.add(e));
            }
        }

        return Array.from(expanded);
    }

    /**
     * Generate file patterns based on keywords and query type
     */
    private generateFilePatterns(keywords: string[], mentionedFiles: string[], queryType: string): string[] {
        const patterns: string[] = [];

        // Add mentioned files with highest priority
        for (const file of mentionedFiles) {
            patterns.push(`**/*${file}*`);
        }

        // Add keyword-based patterns
        for (const kw of keywords) {
            if (kw.length > 3) {
                patterns.push(`**/*${kw}*`);
            }
        }

        // Add type-specific patterns
        if (queryType === 'test') {
            patterns.push('**/*.test.*', '**/*.spec.*', '**/test/**', '**/__tests__/**');
        } else if (queryType === 'fix') {
            patterns.push('**/*error*', '**/*handler*', '**/*util*');
        }

        return patterns;
    }

    /**
     * Assess query complexity to determine search depth
     */
    private assessComplexity(query: string, keywords: string[]): SearchIntent['complexity'] {
        const wordCount = query.split(/\s+/).length;
        const keywordCount = keywords.length;

        if (wordCount > 20 || keywordCount > 10) {
            return 'complex';
        } else if (wordCount > 8 || keywordCount > 4) {
            return 'medium';
        }
        return 'simple';
    }
}
