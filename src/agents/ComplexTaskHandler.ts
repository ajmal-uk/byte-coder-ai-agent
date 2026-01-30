/**
 * ComplexTaskHandler - Advanced handling of complex, multi-domain tasks
 * Manages sophisticated workflows, cross-system integrations, and compound operations
 */

import * as vscode from 'vscode';
import { BaseAgent, AgentOutput, TaskNode, Complexity } from '../core/AgentTypes';
import { EnhancedOrchestrator, EnhancedExecutionOptions } from '../core/EnhancedOrchestrator';
import { EnhancedAnalyzerAgent, EnhancedAnalysisResult } from './EnhancedAnalyzerAgent';
import { ByteAIClient } from '../byteAIClient';

export interface ComplexTaskDefinition {
    id: string;
    title: string;
    description: string;
    domain: 'fullstack' | 'microservices' | 'data-engineering' | 'mobile' | 'devops' | 'ai-ml' | 'blockchain' | 'enterprise';
    complexity: Complexity;
    estimatedDuration: string;
    phases: TaskPhase[];
    dependencies: string[];
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    deliverables: string[];
    successCriteria: string[];
}

export interface TaskPhase {
    id: string;
    name: string;
    description: string;
    objectives: string[];
    tasks: string[];
    deliverables: string[];
    validationCriteria: string[];
    estimatedTime: string;
    dependencies: string[];
    parallelizable: boolean;
}

export interface ComplexTaskInput {
    taskDefinition?: ComplexTaskDefinition;
    userRequest: string;
    domain?: ComplexTaskDefinition['domain'];
    complexity?: Complexity;
    constraints?: {
        timeLimit?: string;
        resources?: string[];
        technologies?: string[];
        teamSize?: number;
        budget?: string;
    };
    preferences?: {
        approach?: 'iterative' | 'waterfall' | 'agile' | 'hybrid';
        riskTolerance?: 'conservative' | 'moderate' | 'aggressive';
        qualityPriority?: 'speed' | 'quality' | 'balance';
    };
}

export interface ComplexTaskResult {
    success: boolean;
    taskDefinition: ComplexTaskDefinition;
    executionPlan: {
        phases: Array<{
            phase: TaskPhase;
            tasks: TaskNode[];
            executionOrder: string[];
            estimatedDuration: string;
        }>;
        totalDuration: string;
        criticalPath: string[];
        riskMitigation: string[];
    };
    executionResults: {
        phaseResults: Array<{
            phaseId: string;
            success: boolean;
            tasks: TaskNode[];
            duration: number;
            issues: string[];
        }>;
        totalDuration: number;
        overallSuccess: boolean;
        qualityMetrics: {
            codeQuality: number;
            testCoverage: number;
            performanceScore: number;
            securityScore: number;
        };
    };
    deliverables: {
        created: string[];
        modified: string[];
        tested: string[];
        documented: string[];
    };
    recommendations: string[];
    lessonsLearned: string[];
}

export class ComplexTaskHandler extends BaseAgent<ComplexTaskInput, ComplexTaskResult> {
    private enhancedOrchestrator: EnhancedOrchestrator;
    private enhancedAnalyzer: EnhancedAnalyzerAgent;
    private client: ByteAIClient;
    private taskTemplates: Map<string, ComplexTaskDefinition> = new Map();

    constructor(private context: vscode.ExtensionContext) {
        super({ name: 'ComplexTaskHandler', timeout: 300000 }); // 5 minutes for complex tasks
        this.enhancedOrchestrator = new EnhancedOrchestrator(context);
        this.enhancedAnalyzer = new EnhancedAnalyzerAgent();
        this.client = new ByteAIClient();
        this.initializeTaskTemplates();
    }

    async execute(input: ComplexTaskInput): Promise<AgentOutput<ComplexTaskResult>> {
        const startTime = Date.now();

        try {
            console.log('[ComplexTaskHandler] Processing complex task:', input.userRequest);

            // Phase 1: Task Analysis and Definition
            const taskDefinition = input.taskDefinition || 
                await this.defineComplexTask(input);

            // Phase 2: Strategic Planning
            const executionPlan = await this.createExecutionPlan(taskDefinition, input);

            // Phase 3: Progressive Execution
            const executionResults = await this.executeComplexTask(
                taskDefinition, 
                executionPlan, 
                input
            );

            // Phase 4: Consolidation and Reporting
            const result: ComplexTaskResult = {
                success: executionResults.overallSuccess,
                taskDefinition,
                executionPlan,
                executionResults,
                deliverables: await this.catalogDeliverables(executionResults),
                recommendations: await this.generateRecommendations(taskDefinition, executionResults),
                lessonsLearned: await this.extractLessonsLearned(taskDefinition, executionResults)
            };

            return this.createOutput('success', result, 0.9, startTime, {
                reasoning: `Complex task completed in ${executionResults.totalDuration}ms with ${executionResults.phaseResults.length} phases`
            });

        } catch (error) {
            return this.handleError(error as Error, startTime);
        }
    }

    private async defineComplexTask(input: ComplexTaskInput): Promise<ComplexTaskDefinition> {
        console.log('[ComplexTaskHandler] Defining complex task from user request...');

        const prompt = `You are an expert technical project manager and solution architect.

User Request: "${input.userRequest}"
Domain: ${input.domain || 'auto-detect'}
Complexity: ${input.complexity || 'auto-detect'}

Constraints:
${input.constraints ? Object.entries(input.constraints).map(([k, v]) => `- ${k}: ${v}`).join('\n') : '- None specified'}

Preferences:
${input.preferences ? Object.entries(input.preferences).map(([k, v]) => `- ${k}: ${v}`).join('\n') : '- None specified'}

Define this as a complex, multi-phase technical task. Break it down into logical phases that could be executed independently but contribute to the overall goal.

Return JSON format:
{
    "id": "unique_task_id",
    "title": "Brief descriptive title",
    "description": "Detailed description of what this task accomplishes",
    "domain": "fullstack|microservices|data-engineering|mobile|devops|ai-ml|blockchain|enterprise",
    "complexity": "simple|medium|complex",
    "estimatedDuration": "X hours/days/weeks",
    "phases": [
        {
            "id": "phase_1",
            "name": "Phase Name",
            "description": "What this phase accomplishes",
            "objectives": ["Objective 1", "Objective 2"],
            "tasks": ["Task 1 description", "Task 2 description"],
            "deliverables": ["Deliverable 1", "Deliverable 2"],
            "validationCriteria": ["Validation 1", "Validation 2"],
            "estimatedTime": "X hours",
            "dependencies": [],
            "parallelizable": true
        }
    ],
    "dependencies": [],
    "riskLevel": "low|medium|high|critical",
    "deliverables": ["Overall deliverable 1", "Overall deliverable 2"],
    "successCriteria": ["Success criteria 1", "Success criteria 2"]
}

Guidelines:
1. Break complex tasks into 3-7 logical phases
2. Each phase should have clear objectives and deliverables
3. Consider technical dependencies and order of operations
4. Include validation criteria for each phase
5. Estimate realistic timeframes
6. Identify risks and mitigation strategies
7. Ensure deliverables are tangible and measurable`;

        try {
            const response = await this.client.streamResponse(prompt, () => {}, () => {});
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const taskDef = JSON.parse(jsonMatch[0]);
                return {
                    id: taskDef.id || `task_${Date.now()}`,
                    title: taskDef.title || 'Complex Task',
                    description: taskDef.description || input.userRequest,
                    domain: taskDef.domain || this.inferDomain(input.userRequest),
                    complexity: taskDef.complexity || 'complex',
                    estimatedDuration: taskDef.estimatedDuration || 'Unknown',
                    phases: taskDef.phases || [],
                    dependencies: taskDef.dependencies || [],
                    riskLevel: taskDef.riskLevel || 'medium',
                    deliverables: taskDef.deliverables || [],
                    successCriteria: taskDef.successCriteria || []
                };
            }
        } catch (error) {
            console.warn('Failed to define complex task, using template:', error);
        }

        // Fallback to template
        return this.getTaskTemplate(input.domain || 'fullstack');
    }

    private async createExecutionPlan(
        taskDefinition: ComplexTaskDefinition,
        input: ComplexTaskInput
    ): Promise<ComplexTaskResult['executionPlan']> {
        console.log('[ComplexTaskHandler] Creating detailed execution plan...');

        const phases = [];
        let totalDuration = 0;
        const criticalPath: string[] = [];
        const riskMitigation: string[] = [];

        for (const phase of taskDefinition.phases) {
            // Generate detailed tasks for each phase
            const phaseTasks = await this.generatePhaseTasks(phase, taskDefinition);
            const executionOrder = this.calculateExecutionOrder(phaseTasks);
            
            phases.push({
                phase,
                tasks: phaseTasks,
                executionOrder,
                estimatedDuration: phase.estimatedTime
            });

            totalDuration += this.parseTimeToMinutes(phase.estimatedTime);
            
            // Update critical path
            if (phase.dependencies.length === 0 || criticalPath.length === 0) {
                criticalPath.push(...phaseTasks.filter(t => 
                    t.dependencies.length === 0
                ).map(t => t.id));
            }

            // Add risk mitigation
            if (taskDefinition.riskLevel === 'high' || taskDefinition.riskLevel === 'critical') {
                riskMitigation.push(`Enhanced testing for ${phase.name}`);
                riskMitigation.push(`Incremental delivery for ${phase.name}`);
            }
        }

        return {
            phases,
            totalDuration: this.formatMinutesToDuration(totalDuration),
            criticalPath,
            riskMitigation
        };
    }

    private async generatePhaseTasks(
        phase: TaskPhase,
        taskDefinition: ComplexTaskDefinition
    ): Promise<TaskNode[]> {
        const prompt = `Generate detailed executable tasks for this phase:

Phase: ${phase.name}
Description: ${phase.description}
Objectives: ${phase.objectives.join(', ')}
Current Tasks: ${phase.tasks.join(', ')}
Domain: ${taskDefinition.domain}

Create atomic tasks that can be executed by the coding agent. Each task should be specific and actionable.

Return JSON array of task objects:
[
    {
        "id": "unique_task_id",
        "description": "Specific actionable task description",
        "type": "code|command|test",
        "filePath": "path/to/file.ext",
        "command": "shell command (if type is command)",
        "dependencies": ["task_id_dependencies"],
        "validationCommand": "validation shell command",
        "assignedAgent": "CodeGenerator|Executor|CodeModifier|QualityAssurance",
        "complexity": "simple|medium|complex",
        "parallelGroup": "optional_group_id"
    }
]

Guidelines:
1. Make tasks atomic and specific
2. Include validation commands
3. Assign appropriate agents
4. Define dependencies clearly
5. Group parallelizable tasks`;

        try {
            const response = await this.client.streamResponse(prompt, () => {}, () => {});
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const tasks = JSON.parse(jsonMatch[0]);
                return tasks.map((t: any) => ({
                    ...t,
                    status: 'pending' as const,
                    dependencies: t.dependencies || [],
                    complexity: t.complexity || 'simple',
                    assignedAgent: t.assignedAgent || 'CodeGenerator'
                }));
            }
        } catch (error) {
            console.warn('Failed to generate phase tasks:', error);
        }

        // Fallback tasks
        return phase.tasks.map((taskDesc, index) => ({
            id: `${phase.id}_task_${index}`,
            description: taskDesc,
            type: 'code' as const,
            status: 'pending' as const,
            dependencies: [],
            complexity: 'medium' as const,
            assignedAgent: 'CodeGenerator' as const
        }));
    }

    private async executeComplexTask(
        taskDefinition: ComplexTaskDefinition,
        executionPlan: ComplexTaskResult['executionPlan'],
        input: ComplexTaskInput
    ): Promise<ComplexTaskResult['executionResults']> {
        console.log('[ComplexTaskHandler] Executing complex task with progressive phases...');

        const phaseResults = [];
        let totalDuration = 0;
        let overallSuccess = true;

        const executionOptions: EnhancedExecutionOptions = {
            analysisDepth: taskDefinition.complexity === 'complex' ? 'comprehensive' : 'deep',
            riskTolerance: input.preferences?.riskTolerance || 'moderate',
            parallelism: input.preferences?.approach === 'agile' ? 'maximum' : 'moderate',
            validationMode: taskDefinition.riskLevel === 'critical' ? 'strict' : 'standard',
            autoRecovery: true,
            checkpointing: true
        };

        for (const phasePlan of executionPlan.phases) {
            console.log(`[ComplexTaskHandler] Executing phase: ${phasePlan.phase.name}`);

            const phaseStartTime = Date.now();

            try {
                // Execute phase tasks using enhanced orchestrator
                const phaseQuery = `Execute ${phasePlan.phase.name}: ${phasePlan.phase.description}`;
                const phaseResult = await this.enhancedOrchestrator.executeEnhanced(
                    phaseQuery,
                    executionOptions
                );

                const phaseDuration = Date.now() - phaseStartTime;
                totalDuration += phaseDuration;

                phaseResults.push({
                    phaseId: phasePlan.phase.id,
                    success: phaseResult.success,
                    tasks: phasePlan.tasks,
                    duration: phaseDuration,
                    issues: phaseResult.success ? [] : ['Phase execution failed']
                });

                if (!phaseResult.success) {
                    overallSuccess = false;
                    if (taskDefinition.riskLevel === 'critical') {
                        throw new Error(`Critical phase failed: ${phasePlan.phase.name}`);
                    }
                }

                // Phase validation
                await this.validatePhase(phasePlan.phase, taskDefinition);

            } catch (error) {
                const phaseDuration = Date.now() - phaseStartTime;
                totalDuration += phaseDuration;
                overallSuccess = false;

                phaseResults.push({
                    phaseId: phasePlan.phase.id,
                    success: false,
                    tasks: phasePlan.tasks,
                    duration: phaseDuration,
                    issues: [`Phase execution error: ${error instanceof Error ? error.message : String(error)}`]
                });

                if (taskDefinition.riskLevel === 'critical') {
                    throw error;
                }
            }
        }

        // Calculate quality metrics
        const qualityMetrics = await this.calculateQualityMetrics(phaseResults);

        return {
            phaseResults,
            totalDuration,
            overallSuccess,
            qualityMetrics
        };
    }

    private calculateExecutionOrder(tasks: TaskNode[]): string[] {
        // Simple topological sort
        const visited = new Set<string>();
        const order: string[] = [];

        const visit = (taskId: string, task: TaskNode) => {
            if (visited.has(taskId)) return;
            
            for (const depId of task.dependencies) {
                const depTask = tasks.find(t => t.id === depId);
                if (depTask) {
                    visit(depId, depTask);
                }
            }
            
            visited.add(taskId);
            order.push(taskId);
        };

        for (const task of tasks) {
            visit(task.id, task);
        }

        return order;
    }

    private async validatePhase(phase: TaskPhase, taskDefinition: ComplexTaskDefinition): Promise<void> {
        console.log(`[ComplexTaskHandler] Validating phase: ${phase.name}`);

        // Check deliverables
        for (const deliverable of phase.deliverables) {
            // This would implement actual validation logic
            console.log(`Validating deliverable: ${deliverable}`);
        }

        // Check validation criteria
        for (const criteria of phase.validationCriteria) {
            // This would implement actual criteria validation
            console.log(`Checking criteria: ${criteria}`);
        }
    }

    private async calculateQualityMetrics(
        phaseResults: ComplexTaskResult['executionResults']['phaseResults']
    ): Promise<ComplexTaskResult['executionResults']['qualityMetrics']> {
        // Simplified quality calculation
        const successfulPhases = phaseResults.filter(p => p.success).length;
        const totalPhases = phaseResults.length;

        return {
            codeQuality: Math.round((successfulPhases / totalPhases) * 100),
            testCoverage: Math.round((successfulPhases / totalPhases) * 80), // Simplified
            performanceScore: Math.round((successfulPhases / totalPhases) * 90),
            securityScore: Math.round((successfulPhases / totalPhases) * 85)
        };
    }

    private async catalogDeliverables(
        executionResults: ComplexTaskResult['executionResults']
    ): Promise<ComplexTaskResult['deliverables']> {
        // Simplified deliverable cataloging
        return {
            created: [],
            modified: [],
            tested: [],
            documented: []
        };
    }

    private async generateRecommendations(
        taskDefinition: ComplexTaskDefinition,
        executionResults: ComplexTaskResult['executionResults']
    ): Promise<string[]> {
        const recommendations: string[] = [];

        if (!executionResults.overallSuccess) {
            recommendations.push('Review failed phases and implement corrective actions');
        }

        if (executionResults.qualityMetrics.codeQuality < 80) {
            recommendations.push('Consider additional code review and refactoring');
        }

        if (executionResults.qualityMetrics.testCoverage < 70) {
            recommendations.push('Increase test coverage for better reliability');
        }

        if (taskDefinition.riskLevel === 'high' || taskDefinition.riskLevel === 'critical') {
            recommendations.push('Implement additional monitoring and alerting');
        }

        return recommendations;
    }

    private async extractLessonsLearned(
        taskDefinition: ComplexTaskDefinition,
        executionResults: ComplexTaskResult['executionResults']
    ): Promise<string[]> {
        const lessons: string[] = [];

        const failedPhases = executionResults.phaseResults.filter(p => !p.success);
        if (failedPhases.length > 0) {
            lessons.push(`Identified ${failedPhases.length} problematic phases requiring better planning`);
        }

        const avgPhaseDuration = executionResults.totalDuration / executionResults.phaseResults.length;
        const longPhases = executionResults.phaseResults.filter(p => p.duration > avgPhaseDuration * 1.5);
        if (longPhases.length > 0) {
            lessons.push('Some phases took longer than expected - improve time estimation');
        }

        if (executionResults.overallSuccess) {
            lessons.push('Complex task execution successful - methodology works well');
        }

        return lessons;
    }

    private inferDomain(userRequest: string): ComplexTaskDefinition['domain'] {
        const lowerRequest = userRequest.toLowerCase();

        if (lowerRequest.includes('microservice') || lowerRequest.includes('api') || lowerRequest.includes('backend')) {
            return 'microservices';
        } else if (lowerRequest.includes('data') || lowerRequest.includes('pipeline') || lowerRequest.includes('etl')) {
            return 'data-engineering';
        } else if (lowerRequest.includes('mobile') || lowerRequest.includes('app') || lowerRequest.includes('ios') || lowerRequest.includes('android')) {
            return 'mobile';
        } else if (lowerRequest.includes('deploy') || lowerRequest.includes('ci/cd') || lowerRequest.includes('infrastructure')) {
            return 'devops';
        } else if (lowerRequest.includes('ai') || lowerRequest.includes('ml') || lowerRequest.includes('model') || lowerRequest.includes('training')) {
            return 'ai-ml';
        } else if (lowerRequest.includes('blockchain') || lowerRequest.includes('smart contract') || lowerRequest.includes('web3')) {
            return 'blockchain';
        } else if (lowerRequest.includes('enterprise') || lowerRequest.includes('scale') || lowerRequest.includes('organization')) {
            return 'enterprise';
        }

        return 'fullstack';
    }

    private parseTimeToMinutes(timeStr: string): number {
        const match = timeStr.match(/(\d+)\s*(hour|hours|day|days|week|weeks)/);
        if (match) {
            const value = parseInt(match[1]);
            const unit = match[2];
            
            switch (unit) {
                case 'hour':
                case 'hours':
                    return value * 60;
                case 'day':
                case 'days':
                    return value * 8 * 60; // 8-hour workday
                case 'week':
                case 'weeks':
                    return value * 5 * 8 * 60; // 5-day work week
            }
        }
        return 60; // Default 1 hour
    }

    private formatMinutesToDuration(minutes: number): string {
        if (minutes < 60) {
            return `${minutes} minutes`;
        } else if (minutes < 8 * 60) {
            return `${Math.round(minutes / 60)} hours`;
        } else {
            return `${Math.round(minutes / (8 * 60))} days`;
        }
    }

    private initializeTaskTemplates(): void {
        // Initialize predefined task templates
        const fullstackTemplate: ComplexTaskDefinition = {
            id: 'fullstack_app',
            title: 'Full-Stack Web Application',
            description: 'Complete web application with frontend, backend, and database',
            domain: 'fullstack',
            complexity: 'complex',
            estimatedDuration: '2 weeks',
            phases: [
                {
                    id: 'setup',
                    name: 'Project Setup',
                    description: 'Initialize project structure and development environment',
                    objectives: ['Setup project structure', 'Configure development tools', 'Initialize version control'],
                    tasks: ['Create project directory structure', 'Setup package.json and dependencies', 'Configure build tools', 'Setup testing framework'],
                    deliverables: ['Project structure', 'Development environment', 'Build configuration'],
                    validationCriteria: ['Project builds successfully', 'Tests can run', 'Development server starts'],
                    estimatedTime: '1 day',
                    dependencies: [],
                    parallelizable: false
                },
                {
                    id: 'backend',
                    name: 'Backend Development',
                    description: 'Implement server-side logic and APIs',
                    objectives: ['Implement API endpoints', 'Setup database connection', 'Add authentication'],
                    tasks: ['Create API routes', 'Implement business logic', 'Setup database models', 'Add middleware', 'Implement authentication'],
                    deliverables: ['API endpoints', 'Database schema', 'Authentication system'],
                    validationCriteria: ['API endpoints respond correctly', 'Database operations work', 'Authentication functions'],
                    estimatedTime: '5 days',
                    dependencies: ['setup'],
                    parallelizable: true
                },
                {
                    id: 'frontend',
                    name: 'Frontend Development',
                    description: 'Implement user interface and client-side logic',
                    objectives: ['Create UI components', 'Implement client-side routing', 'Connect to backend APIs'],
                    tasks: ['Setup React/Vue components', 'Implement routing', 'Create forms', 'Connect to APIs', 'Add state management'],
                    deliverables: ['UI components', 'Client-side routing', 'API integration'],
                    validationCriteria: ['UI renders correctly', 'Navigation works', 'Data flows properly'],
                    estimatedTime: '5 days',
                    dependencies: ['setup'],
                    parallelizable: true
                },
                {
                    id: 'integration',
                    name: 'Integration and Testing',
                    description: 'Integrate frontend and backend, comprehensive testing',
                    objectives: ['End-to-end testing', 'Performance optimization', 'Security hardening'],
                    tasks: ['Integration testing', 'Performance testing', 'Security audit', 'Bug fixes', 'Documentation'],
                    deliverables: ['Test suite', 'Performance reports', 'Security assessment', 'Documentation'],
                    validationCriteria: ['All tests pass', 'Performance meets requirements', 'Security issues resolved'],
                    estimatedTime: '3 days',
                    dependencies: ['backend', 'frontend'],
                    parallelizable: false
                }
            ],
            dependencies: [],
            riskLevel: 'medium',
            deliverables: ['Complete web application', 'Test suite', 'Documentation'],
            successCriteria: ['Application functions correctly', 'All tests pass', 'Performance requirements met']
        };

        this.taskTemplates.set('fullstack', fullstackTemplate);
    }

    private getTaskTemplate(domain: ComplexTaskDefinition['domain']): ComplexTaskDefinition {
        return this.taskTemplates.get(domain) || this.taskTemplates.get('fullstack')!;
    }
}