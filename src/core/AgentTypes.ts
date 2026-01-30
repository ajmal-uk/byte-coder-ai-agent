/**
 * AgentTypes - Core type definitions for Byte Coder Multi-Agent System
 * Defines interfaces for agent communication, pipeline construction, and structured outputs
 */

// ===== AGENT OUTPUT TYPES =====

export type AgentStatus = 'success' | 'failed' | 'partial' | 'running';
export type IntentType = 'Build' | 'Fix' | 'Modify' | 'Explain' | 'Design' | 'Audit' | 'Expand' | 'Command' | 'VersionControl' | 'WebSearch';
export type QueryType = 'fix' | 'explain' | 'refactor' | 'test' | 'optimize' | 'security' | 'build' | 'design' | 'general';
export type Complexity = 'simple' | 'medium' | 'complex';

export interface AgentOutput<T = any> {
    agent: string;
    status: AgentStatus;
    confidence: number;  // 0.0 - 1.0
    executionTimeMs: number;
    payload: T;
    error?: {
        type: string;
        message: string;
        location?: { file: string; line: number };
    };
    nextRecommendedAgent?: string;
    reasoning?: string;
}

// ===== PIPELINE TYPES =====

export interface PipelineStep {
    step: number;
    agent: string;
    parallel?: boolean;
    condition?: string;
    dependency?: number;
    args?: Record<string, any>;
    required?: boolean;
}

export interface ManagerDecision {
    intent: IntentType;
    confidence: number;
    complexity: Complexity;
    pipeline: PipelineStep[];
    safetyThreshold: number;
    reasoning: string;
    executionMode: 'sequential' | 'parallel_with_dependencies';
    userMessage?: string;
}

export interface PipelineStatus {
    phase: string;
    currentAgent: string;
    progress: number;  // 0-100
    message: string;
    isComplete: boolean;
    hasError: boolean;
    plan?: TaskNode[]; // Optional plan update
    activeTaskId?: string; // Currently executing task ID
}

// ===== CHECKPOINT TYPES =====

export interface Checkpoint {
    checkpointId: string;
    timestamp: Date;
    modifiedFiles: string[];
    diffHash: string;
    rollbackCommand: string;
    description: string;
    sessionId?: string;
    requestId?: string;
}

// ===== FILE/CODE TYPES =====

export interface FileLocation {
    file: string;
    startLine: number;
    endLine: number;
    element?: string;
    props?: Record<string, any>;
    confidence: number;
    reason: string;
}

export interface CodeModification {
    filePath: string;
    startLine: number;
    endLine: number;
    searchBlock: string;
    replaceBlock: string;
    action?: 'replace' | 'insert_before' | 'insert_after' | 'delete';
    validationCommand?: string;
}

export interface CommandSpec {
    command: string;
    args: string[];
    cwd?: string;
    requiresConfirmation?: boolean;
    runInTerminal?: boolean; // Indicates if command requires a visible terminal
    platform?: 'windows' | 'darwin' | 'linux' | 'all';
    description: string;
    operation?: string; // e.g., 'create_file'
    target?: string; // target file path
    content?: string; // content for file creation
}

// ===== SEARCH TYPES =====

export interface SearchResult {
    path: string;
    confidence: number;
    reason: string;
    framework?: string;
    matchType?: 'exact' | 'fuzzy' | 'semantic';
}

export interface ContextMemory {
    type: 'previous_fix' | 'conversation' | 'file_history' | 'pattern' | 'knowledge';
    date: Date;
    summary: string;
    relevance: number;
    filePath?: string;
    data?: any;
}

// ===== PLANNING TYPES =====

export interface ProjectPhase {
    name: string;
    deliverables: string[];
    dependencies: string[];
    durationEstimate?: string;
    status?: 'pending' | 'in_progress' | 'completed';
}

export interface TaskNode {
    id: string;
    description: string;
    type: 'code' | 'command' | 'test';
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
    dependencies: string[];
    filePath?: string;
    command?: string;
    validationCommand?: string;
    parallelGroup?: string;
    assignedAgent?: string;
    complexity?: Complexity;
    reasoning?: string; // Why this task is needed
    successCriteria?: string[]; // What defines success for this task
    persona?: string;
}

export interface CodePlan {
    fileStructure: string[];
    interfaces: string[];
    apiEndpoints?: { method: string; path: string; description: string }[];
    stateFlows?: string[];
}

// ===== VISION TYPES =====

export interface VisionAnalysis {
    elementType: string;
    colors: string[];
    layout: string;
    recommendedCss?: string;
    accessibility?: string;
    elements?: { type: string; bounds?: { x: number; y: number; width: number; height: number } }[];
}

// ===== EXECUTION TYPES =====

export interface ExecutionResult {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    success: boolean;
    errorLocation?: FileLocation;
    recoveryOptions?: {
        strategy: string;
        confidence: number;
        requiredChanges?: CodeModification[];
    }[];
}

// ===== BASE AGENT INTERFACE =====

export interface BaseAgentConfig {
    name: string;
    maxRetries?: number;
    timeout?: number;
    dependencies?: string[];
}

export abstract class BaseAgent<TInput = any, TOutput = any> {
    protected name: string;
    protected maxRetries: number;
    protected timeout: number;

    constructor(config: BaseAgentConfig) {
        this.name = config.name;
        this.maxRetries = config.maxRetries ?? 3;
        this.timeout = config.timeout ?? 30000;
    }

    abstract execute(input: TInput): Promise<AgentOutput<TOutput>>;

    protected createOutput<T>(
        status: AgentStatus,
        payload: T,
        confidence: number,
        startTime: number,
        options?: Partial<AgentOutput<T>>
    ): AgentOutput<T> {
        return {
            agent: this.name,
            status,
            confidence,
            executionTimeMs: Date.now() - startTime,
            payload,
            ...options
        };
    }

    protected handleError(error: Error, startTime: number): AgentOutput<any> {
        return this.createOutput('failed', null as any, 0, startTime, {
            error: {
                type: error.name,
                message: error.message
            }
        });
    }
}

// ===== AGENT REGISTRY =====

export type AgentName =
    | 'Manager'
    | 'IntentAnalyzer'
    | 'FileSearch'
    | 'FilePartSearcher'
    | 'ContextSearch'
    | 'Vision'
    | 'ProcessPlanner'
    | 'CodePlanner'
    | 'TaskPlanner'
    | 'FileReader'
    | 'CommandGenerator'
    | 'CodeModifier'
    | 'Executor'
    | 'VersionController'
    | 'DocWriter'
    | 'RelevanceScorer'
    | 'Architect'
    | 'QualityAssurance'
    | 'TodoManager'
    | 'WebSearch';

export const AGENT_LAYERS = {
    SEARCH: ['IntentAnalyzer', 'FileSearch', 'FilePartSearcher', 'ContextSearch', 'Vision', 'RelevanceScorer', 'WebSearch'],
    PLANNING: ['Architect', 'ProcessPlanner', 'CodePlanner', 'TaskPlanner', 'TodoManager'],
    EXECUTION: ['FileReader', 'CommandGenerator', 'CodeModifier', 'Executor'],
    SAFETY: ['VersionController', 'DocWriter', 'QualityAssurance']
} as const;

// ===== DECISION PROTOCOL =====

export const CONFIDENCE_THRESHOLDS = {
    PROCEED: 0.85,
    VERIFY: 0.6,
    DISCOVER: 0.4
} as const;

export function getDecisionAction(confidence: number): 'proceed' | 'verify' | 'discover' | 'handoff' {
    if (confidence > CONFIDENCE_THRESHOLDS.PROCEED) return 'proceed';
    if (confidence >= CONFIDENCE_THRESHOLDS.VERIFY) return 'verify';
    if (confidence >= CONFIDENCE_THRESHOLDS.DISCOVER) return 'discover';
    return 'handoff';
}
