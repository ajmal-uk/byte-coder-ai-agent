/**
 * CommandGeneratorAgent - OS-aware command builder for Byte Coder
 * Generates safe, platform-specific system commands
 */

import * as os from 'os';
import { BaseAgent, AgentOutput, CommandSpec } from '../core/AgentTypes';
import { TaskPlannerResult } from './TaskPlannerAgent';

export interface CommandGeneratorInput {
    operation?: 'create_file' | 'create_dir' | 'copy' | 'move' | 'delete' | 'run_script' | 'install_deps' | 'custom';
    taskPlan?: TaskPlannerResult;
    target?: string;
    source?: string;
    content?: string;
    customCommand?: string;
    safe?: boolean;
    context?: string;
    workspaceRoot?: string;
}

export interface CommandGeneratorResult {
    commands: CommandSpec[];
    platform: string;
    requiresConfirmation: boolean;
    warningMessage?: string;
}

export class CommandGeneratorAgent extends BaseAgent<CommandGeneratorInput, CommandGeneratorResult> {
    private platform: 'darwin' | 'linux' | 'windows';

    // Dangerous command patterns that require confirmation
    private readonly DANGEROUS_PATTERNS = [
        /rm\s+-rf/i,
        /del\s+\/s/i,
        /rmdir\s+\/s/i,
        /format\s+/i,
        /dd\s+if=/i,
        />\s*\/dev\//i,
        /chmod\s+777/i,
        /sudo\s+rm/i,
        /drop\s+database/i,
        /truncate\s+table/i
    ];

    // Interactive command patterns (require visible terminal)
    private readonly INTERACTIVE_PATTERNS = [
        /^npm start/i,
        /^npm run dev/i,
        /^npm run serve/i,
        /^node .+\.js$/i, // Simple node scripts might be servers
        /^python .+\.py$/i,
        /^go run/i,
        /^docker run/i,
        /server/i,
        /watch/i,
        /interactive/i,
        /start/i
    ];

    constructor() {
        super({ name: 'CommandGenerator', timeout: 5000 });

        const platform = os.platform();
        if (platform === 'darwin') this.platform = 'darwin';
        else if (platform === 'win32') this.platform = 'windows';
        else this.platform = 'linux';
    }

    async execute(input: CommandGeneratorInput): Promise<AgentOutput<CommandGeneratorResult>> {
        const startTime = Date.now();

        try {
            const commands: CommandSpec[] = [];
            let requiresConfirmation = false;
            let warningMessage: string | undefined;

            // Handle task plan if provided
            if (input.taskPlan) {
                for (const task of input.taskPlan.taskGraph) {
                    if (task.command) {
                    commands.push({
                        command: task.command,
                        args: [],
                        platform: 'all',
                        description: task.description,
                        runInTerminal: this.isInteractive(task.command, task.description)
                    });
                }
                
                // Also add validation command if present (as a subsequent step)
                if (task.validationCommand) {
                    commands.push({
                        command: task.validationCommand,
                        args: [],
                        platform: 'all',
                        description: `Validate: ${task.description}`,
                        runInTerminal: this.isInteractive(task.validationCommand, task.description)
                    });
                }
                }
            }

            switch (input.operation) {
                case 'create_file':
                    commands.push(...this.generateCreateFileCommands(input.target!, input.content));
                    break;
                case 'create_dir':
                    commands.push(this.generateMkdirCommand(input.target!));
                    break;
                case 'copy':
                    commands.push(this.generateCopyCommand(input.source!, input.target!));
                    break;
                case 'move':
                    commands.push(this.generateMoveCommand(input.source!, input.target!));
                    break;
                case 'delete':
                    const deleteResult = this.generateDeleteCommand(input.target!, input.workspaceRoot);
                    commands.push(deleteResult.command);
                    requiresConfirmation = true;
                    warningMessage = deleteResult.warning;
                    break;
                case 'run_script':
                    commands.push(this.generateRunScriptCommand(input.target!));
                    break;
                case 'install_deps':
                    commands.push(this.generateInstallCommand(input.context));
                    break;
                case 'custom':
                    // Prioritize explicit customCommand, but fall back to context inference
                    const cmdToProcess = input.customCommand || input.context;
                    if (cmdToProcess) {
                        const customResult = this.processCustomCommand(cmdToProcess, input.context);
                        commands.push(customResult.command);
                        requiresConfirmation = customResult.dangerous;
                        if (customResult.dangerous) {
                            warningMessage = 'This command may have destructive effects';
                        }
                    }
                    break;
            }

            // Check for dangerous patterns in all commands
            for (const cmd of commands) {
                // Skip check if we already processed this command and decided it's safe (e.g. via operation specific logic)
                // Specifically for delete operations that we generated and deemed safe
                if (cmd.operation === 'delete' && cmd.requiresConfirmation === false) {
                    continue;
                }

                if (this.isDangerousCommand(cmd.command)) {
                    requiresConfirmation = true;
                    warningMessage = 'Command contains potentially destructive operations';
                    cmd.requiresConfirmation = true;
                }
            }

            const result: CommandGeneratorResult = {
                commands,
                platform: this.platform,
                requiresConfirmation,
                warningMessage
            };

            return this.createOutput('success', result, 0.9, startTime, {
                reasoning: `Generated ${commands.length} commands for ${this.platform}`
            });

        } catch (error) {
            return this.handleError(error as Error, startTime);
        }
    }

    /**
     * Generate file creation commands
     */
    private generateCreateFileCommands(filePath: string, content?: string): CommandSpec[] {
        const dir = filePath.split('/').slice(0, -1).join('/');
        let shellCommand = '';
        const escapedPath = this.escapeForShell(filePath);
        const escapedDir = dir ? this.escapeForShell(dir) : '';

        // Construct shell-compatible command for fallback/script generation
        if (this.platform === 'windows') {
            const parts: string[] = [];
            if (dir) parts.push(`if not exist "${escapedDir}" mkdir "${escapedDir}"`);
            
            if (content) {
                if (content.includes('\n')) {
                    parts.push(`echo.>${escapedPath}`);
                    const lines = content.split('\n');
                    // Limit lines for shell command readability/length if too long? 
                    // For now, keep it simple but be aware of command line limits.
                    for (const line of lines) {
                        parts.push(`echo ${this.escapeForShell(line)}>>${escapedPath}`);
                    }
                } else {
                    parts.push(`echo ${this.escapeForShell(content)}>${escapedPath}`);
                }
            } else {
                parts.push(`type nul > ${escapedPath}`);
            }
            shellCommand = parts.join(' && ');
        } else {
            // Unix
            const parts: string[] = [];
            if (dir) parts.push(`mkdir -p "${escapedDir}"`);
            
            if (content) {
                if (content.includes('\n')) {
                    // Use heredoc
                    parts.push(`cat > "${escapedPath}" << 'EOF'\n${content}\nEOF`);
                } else {
                    parts.push(`echo '${this.escapeForShell(content)}' > "${escapedPath}"`);
                }
            } else {
                parts.push(`touch "${escapedPath}"`);
            }
            shellCommand = parts.join(' && ');
        }

        return [{
            command: shellCommand,
            args: [],
            platform: 'all',
            description: `Create file: ${filePath}`,
            operation: 'create_file',
            target: filePath,
            content: content || ''
        }];
    }

    /**
     * Generate mkdir command
     */
    private generateMkdirCommand(dir: string): CommandSpec {
        const escapedDir = this.escapeForShell(dir);
        return {
            command: this.platform === 'windows'
                ? `mkdir "${escapedDir}"`
                : `mkdir -p "${escapedDir}"`,
            args: [],
            platform: this.platform,
            description: `Create directory: ${dir}`
        };
    }

    /**
     * Generate copy command
     */
    private generateCopyCommand(source: string, target: string): CommandSpec {
        const escapedSource = this.escapeForShell(source);
        const escapedTarget = this.escapeForShell(target);
        
        const cmd = this.platform === 'windows'
            ? `copy "${escapedSource}" "${escapedTarget}"`
            : `cp "${escapedSource}" "${escapedTarget}"`;

        return {
            command: cmd,
            args: [],
            platform: this.platform,
            description: `Copy ${source} to ${target}`
        };
    }

    /**
     * Generate move command
     */
    private generateMoveCommand(source: string, target: string): CommandSpec {
        const escapedSource = this.escapeForShell(source);
        const escapedTarget = this.escapeForShell(target);

        const cmd = this.platform === 'windows'
            ? `move "${escapedSource}" "${escapedTarget}"`
            : `mv "${escapedSource}" "${escapedTarget}"`;

        return {
            command: cmd,
            args: [],
            platform: this.platform,
            description: `Move ${source} to ${target}`
        };
    }

    /**
     * Generate delete command with safety warning
     */
    private generateDeleteCommand(target: string, workspaceRoot?: string): { command: CommandSpec; warning: string } {
        // Heuristic: Trailing slash or no extension often implies directory, 
        // but 'rm -rf' on Unix handles both safely.
        // Windows 'rmdir /s /q' handles dirs, 'del' handles files.
        const isDirectory = target.endsWith('/') || target.endsWith('\\') || !target.includes('.');
        const escapedTarget = this.escapeForShell(target);
        let cmd: string;

        if (this.platform === 'windows') {
            // Try to handle both if uncertain? No easy one-liner in cmd without conditional.
            // Stick to heuristic but improve it slightly.
            cmd = isDirectory ? `rmdir /s /q "${escapedTarget}"` : `del "${escapedTarget}"`;
        } else {
            cmd = `rm -rf "${escapedTarget}"`;
        }

        // Determine if confirmation is needed
        // We assume relative paths or paths in typical project directories are safe for the agent to manage
        const isSystemPath = target.startsWith('/') || target.match(/^[a-zA-Z]:\\/);
        
        let isSafeProjectFile = !isSystemPath || target.includes('node_modules') || target.includes('dist') || target.includes('build') || target.includes('tmp');
        
        // If we have workspaceRoot, check if target is inside it
        if (workspaceRoot && target.startsWith(workspaceRoot)) {
            isSafeProjectFile = true;
        }

        return {
            command: {
                command: cmd,
                args: [],
                platform: this.platform,
                requiresConfirmation: !isSafeProjectFile,
                description: `Delete: ${target}`,
                operation: 'delete'
            },
            warning: isSafeProjectFile ? '' : `This will permanently delete ${target}. This action cannot be undone.`
        };
    }

    /**
     * Generate script run command
     */
    private generateRunScriptCommand(script: string): CommandSpec {
        let cmd: string;
        const escapedScript = this.escapeForShell(script);

        if (script.endsWith('.ts')) {
            cmd = `npx ts-node "${escapedScript}"`;
        } else if (script.endsWith('.js')) {
            cmd = `node "${escapedScript}"`;
        } else if (script.endsWith('.py')) {
            // Use 'python' generic command, assume env is set up
            cmd = `python "${escapedScript}"`;
        } else if (script.endsWith('.sh')) {
            cmd = this.platform === 'windows' ? `bash "${escapedScript}"` : `sh "${escapedScript}"`;
        } else {
            cmd = this.platform === 'windows' ? `"${escapedScript}"` : `./"${escapedScript}"`;
        }

        return {
            command: cmd,
            args: [],
            platform: this.platform,
            description: `Run script: ${script}`,
            runInTerminal: this.isInteractive(cmd, script)
        };
    }

    /**
     * Generate package install command
     */
    private generateInstallCommand(context?: string): CommandSpec {
        let cmd = 'npm install';
        
        // Context-aware install command
        if (context) {
            const lowerCtx = context.toLowerCase();
            if (lowerCtx.includes('python') || lowerCtx.includes('pip') || lowerCtx.includes('requirements.txt')) {
                cmd = 'pip install -r requirements.txt';
            } else if (lowerCtx.includes('yarn')) {
                cmd = 'yarn install';
            } else if (lowerCtx.includes('pnpm')) {
                cmd = 'pnpm install';
            }
        }

        return {
            command: cmd,
            args: [],
            platform: 'all',
            description: 'Install dependencies'
        };
    }

    /**
     * Process custom command with safety check
     */
    private processCustomCommand(command: string, context?: string): { command: CommandSpec; dangerous: boolean } {
        const dangerous = this.isDangerousCommand(command);

        return {
            command: {
                command,
                args: [],
                platform: 'all',
                requiresConfirmation: dangerous,
                description: dangerous ? 'Custom command (requires confirmation)' : 'Custom command',
                runInTerminal: this.isInteractive(command, context)
            },
            dangerous
        };
    }

    /**
     * Check if command is dangerous
     */
    private isDangerousCommand(command: string): boolean {
        return this.DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
    }

    /**
     * Check if command requires visible terminal (interactive)
     */
    private isInteractive(command: string, context?: string): boolean {
        const matchesPattern = this.INTERACTIVE_PATTERNS.some(pattern => pattern.test(command));
        if (matchesPattern) return true;

        if (context) {
            const lowerContext = context.toLowerCase();
            if (lowerContext.includes('start server') || 
                lowerContext.includes('run server') || 
                lowerContext.includes('interactive') ||
                lowerContext.includes('watch mode')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Escape string for shell
     */
    private escapeForShell(str: string): string {
        if (this.platform === 'windows') {
            return str.replace(/[&|<>^]/g, '^$&').replace(/"/g, '""');
        } else {
            return str.replace(/'/g, "'\"'\"'");
        }
    }

    /**
     * Format commands as executable script
     */
    formatAsScript(result: CommandGeneratorResult): string {
        const lines: string[] = [];

        if (this.platform === 'windows') {
            lines.push('@echo off');
        } else {
            lines.push('#!/bin/bash');
            lines.push('set -e');
        }
        lines.push('');

        for (const cmd of result.commands) {
            lines.push(`echo "Running: ${cmd.description}"`);
            lines.push(cmd.command);
            lines.push('');
        }

        return lines.join('\n');
    }
}
