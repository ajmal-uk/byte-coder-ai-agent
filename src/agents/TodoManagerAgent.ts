/**
 * TodoManagerAgent - Dynamic Task Supervisor
 * Manages the execution lifecycle, handles errors by modifying the plan,
 * and ensures tasks are completed correctly.
 */

import { BaseAgent, AgentOutput, TaskNode, ExecutionResult } from '../core/AgentTypes';
import { v4 as uuidv4 } from 'uuid';

export interface TodoManagerInput {
    currentPlan: TaskNode[];
    lastTaskResult?: {
        taskId: string;
        success: boolean;
        result?: ExecutionResult;
        error?: string;
    };
    startTime?: number; // When the whole workflow started
    maxDuration?: number; // Max duration in ms for the whole workflow
}

export interface TodoManagerOutput {
    updatedPlan: TaskNode[];
    nextTaskId?: string;
    action: 'continue' | 'retry' | 'stop' | 'completed';
    reasoning: string;
    changes: string[];
}

export class TodoManagerAgent extends BaseAgent<TodoManagerInput, TodoManagerOutput> {
    constructor() {
        super({ name: 'TodoManager', timeout: 5000 });
    }

    private getAlternativeStrategy(originalStrategy: string, attemptCount: number): string | null {
        const strategies: Record<string, string[]> = {
            'missing dependencies': ['Check environment', 'Install via alternative source', 'Debug imports'],
            'syntax error': ['Lint file', 'Rewrite code block', 'Check encoding'],
            'undefined variable': ['Check scope', 'Define variable', 'Debug execution'],
            'type mismatch': ['Cast type', 'Validate input', 'Debug types'],
            'performance issue': ['Optimize code', 'Increase timeout', 'Profile execution'],
            'permission issue': ['Check file permissions', 'Run as different user', 'Change directory'],
            'missing file': ['Verify path', 'Create file', 'List directory']
        };

        const alternatives = strategies[originalStrategy];
        if (!alternatives) return null;

        // attemptCount starts at 1 (original failure). attemptCount 1 = index 0 (first alternative).
        const index = attemptCount - 1;
        return index >= 0 && index < alternatives.length ? alternatives[index] : null;
    }

    async execute(input: TodoManagerInput): Promise<AgentOutput<TodoManagerOutput>> {
        const startTime = Date.now();
        const { currentPlan, lastTaskResult } = input;
        
        // Clone plan to avoid mutation side effects
        let updatedPlan = JSON.parse(JSON.stringify(currentPlan)) as TaskNode[];
        let action: TodoManagerOutput['action'] = 'continue';
        let nextTaskId: string | undefined;
        let reasoning = '';
        const changes: string[] = [];

        // 0. Check Global Timeout
        if (input.startTime && input.maxDuration) {
            const elapsed = Date.now() - input.startTime;
            if (elapsed > input.maxDuration) {
                return this.createOutput('success', {
                    updatedPlan,
                    action: 'stop',
                    reasoning: `Global timeout reached (${elapsed}ms > ${input.maxDuration}ms). Stopping execution.`,
                    changes: []
                }, 1.0, startTime);
            }
        }

        // 1. Handle Last Result
        if (lastTaskResult) {
            const taskIndex = updatedPlan.findIndex(t => t.id === lastTaskResult.taskId);
            if (taskIndex !== -1) {
                const task = updatedPlan[taskIndex];
                
                if (lastTaskResult.success) {
                    task.status = 'completed';
                    (task as any).output = lastTaskResult.result;
                    reasoning = `Task '${task.description}' completed successfully.`;
                    changes.push(`Marked task ${task.id} as completed`);
                } else {
                    task.status = 'failed';
                    reasoning = `Task '${task.description}' failed. `;
                    
                    // Error Recovery Logic
                    if (lastTaskResult.result?.recoveryOptions && lastTaskResult.result.recoveryOptions.length > 0) {
                        const currentRetry = (task as any).retryCount || 0;
                        
                        if (currentRetry >= 3) {
                            reasoning += ` Max retries (3) reached for task ${task.id}. Halting to prevent infinite loop.`;
                            action = 'stop';
                        } else {
                            const bestOption = lastTaskResult.result.recoveryOptions[0];
                            reasoning += `Applying recovery strategy: ${bestOption.strategy}.`;

                            // Create Fix Task
                            const fixDescription = `Fix: ${bestOption.strategy} (for ${task.description})`;
                            const fixTaskId = `fix_${uuidv4().slice(0, 8)}`;
                            const fixTask: TaskNode = {
                                id: fixTaskId,
                                description: fixDescription,
                                status: 'pending',
                                dependencies: task.dependencies,
                                type: 'code',
                                complexity: 'simple',
                                assignedAgent: 'CodeGenerator'
                            };
                            
                            updatedPlan.splice(taskIndex, 0, fixTask);
                            task.status = 'pending';
                            task.dependencies = [fixTaskId];
                            (task as any).retryCount = currentRetry + 1;
                            changes.push(`Added fix task ${fixTaskId}, reset task ${task.id} (retry #${(task as any).retryCount})`);
                            
                            action = 'retry';
                        }
                    } else {
                        // No clear recovery, try intelligent analysis
                        const analyzedStrategy = this.analyzeError(lastTaskResult.error || '');
                        reasoning += ` Analysis suggests: ${analyzedStrategy}.`;
                        
                        // Check for infinite loops: check if we have tried this strategy before
                        const lastTask = updatedPlan[taskIndex - 1]; // Potential previous fix
                        let fixDescription = `Fix ${analyzedStrategy} in ${task.id}`;
                        let loopCount = 1;

                        // Look back to count how many times we've tried to fix this specific issue
                        for (let i = taskIndex - 1; i >= 0; i--) {
                            if (updatedPlan[i].description.includes(`Fix ${analyzedStrategy} in ${task.id}`)) {
                                loopCount++;
                            } else if (updatedPlan[i].description.includes(`Fix failure in ${task.id}`)) {
                                // Also count generic fixes if they failed
                                loopCount++;
                            }
                        }

                        if (lastTask && (lastTask.description.includes(analyzedStrategy) || loopCount > 1)) {
                             // Loop detected! Try alternative strategy
                             const alternative = this.getAlternativeStrategy(analyzedStrategy, loopCount);
                             
                             if (alternative) {
                                 reasoning += ` Loop detected (Attempt ${loopCount}). Switching to alternative strategy: ${alternative}.`;
                                 fixDescription = `Fix ${analyzedStrategy} (Alt: ${alternative}) in ${task.id}`;
                             } else {
                                 reasoning += " Loop detected! No more strategies available. Escalating to manual review.";
                                 action = 'stop';
                                 
                                 return this.createOutput('success', {
                                    updatedPlan,
                                    nextTaskId,
                                    action,
                                    reasoning,
                                    changes
                                }, 1.0, startTime);
                             }
                        }

                        const fixTaskId = `fix_${uuidv4().slice(0, 8)}`;
                        const fixTask: TaskNode = {
                            id: fixTaskId,
                            description: fixDescription,
                            status: 'pending',
                            dependencies: task.dependencies,
                            type: 'code',
                            complexity: 'simple',
                            assignedAgent: 'CodeGenerator'
                        };
                        
                        updatedPlan.splice(taskIndex, 0, fixTask);
                        task.status = 'pending';
                        task.dependencies = [fixTaskId];
                        (task as any).retryCount = ((task as any).retryCount || 0) + 1;
                        changes.push(`Added fix task ${fixTaskId}: ${fixDescription} (retry #${(task as any).retryCount})`);
                        
                        action = 'retry';
                    }
                }
            }
        }

        // 2. Determine Next Task
        // Find the first pending task whose dependencies are all completed
        const pendingTasks = updatedPlan.filter(t => t.status === 'pending');
        
        if (pendingTasks.length === 0) {
            // Check if any failed
            const anyFailed = updatedPlan.some(t => t.status === 'failed');
            if (anyFailed) {
                action = 'stop';
                reasoning += " No more pending tasks, but failures exist.";
            } else {
                action = 'completed';
                reasoning += " All tasks completed successfully.";
            }
        } else {
            // Filter runnable tasks
            const runnableTasks = pendingTasks.filter(task => {
                if (task.dependencies.length === 0) return true;
                return task.dependencies.every(depId => {
                    const depTask = updatedPlan.find(t => t.id === depId);
                    return depTask?.status === 'completed';
                });
            });

            if (runnableTasks.length > 0) {
                nextTaskId = runnableTasks[0].id;
                if (action !== 'retry') action = 'continue';
                reasoning += ` Next task: ${runnableTasks[0].description}`;
            } else {
                // Deadlock check: Pending tasks exist but dependencies not met
                // This shouldn't happen in a valid DAG unless dependencies failed
                action = 'stop';
                reasoning += " Stalled: Pending tasks exist but dependencies are not met (likely upstream failure).";
            }
        }

        return this.createOutput('success', {
            updatedPlan,
            nextTaskId,
            action,
            reasoning,
            changes
        }, 1.0, startTime);
    }

    private analyzeError(error: string): string {
        const lowerError = error.toLowerCase();
        
        if (lowerError.includes('module not found') || lowerError.includes('modulenotfound') || lowerError.includes('import error') || lowerError.includes('importerror')) {
            return 'missing dependencies';
        }
        if (lowerError.includes('syntaxerror') || lowerError.includes('unexpected token')) {
            return 'syntax error';
        }
        if (lowerError.includes('referenceerror') || lowerError.includes('not defined')) {
            return 'undefined variable';
        }
        if (lowerError.includes('typeerror')) {
            return 'type mismatch';
        }
        if (lowerError.includes('timeout')) {
            return 'performance issue';
        }
        if (lowerError.includes('permission denied') || lowerError.includes('eacces')) {
            return 'permission issue';
        }
        if (lowerError.includes('enoent') || lowerError.includes('no such file')) {
            return 'missing file';
        }
        
        return 'general error';
    }
}
