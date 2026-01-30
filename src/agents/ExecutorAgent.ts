/**
 * ExecutorAgent - Validation engine for Byte Coder
 * Executes commands and analyzes results for error recovery
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import { BaseAgent, AgentOutput, ExecutionResult, FileLocation, CodeModification } from '../core/AgentTypes';
import { PersonaManager } from '../core/PersonaManager';

import * as fs from 'fs';
import * as path from 'path';

export interface ExecutorInput {
    command?: string;
    commands?: any[]; // Supports strings, CommandSpecs, or operation objects
    cwd?: string;
    timeout?: number;
    expectSuccess?: boolean;
    parseErrors?: boolean;
    runInTerminal?: boolean; // New: run in visible terminal
    persona?: string; // Optional persona context
}

export interface ExecutorOutput extends ExecutionResult {
    duration: number;
    results?: ExecutionResult[]; // For multiple commands
    parsed?: {
        errorType: string;
        errorMessage: string;
        suggestions: string[];
    };
    personaAdvice?: string;
}

export class ExecutorAgent extends BaseAgent<ExecutorInput, ExecutorOutput> {
    // Error pattern matchers
    private readonly ERROR_PATTERNS: { pattern: RegExp; type: string }[] = [
        { pattern: /TypeError: (.+)/i, type: 'TypeError' },
        { pattern: /ReferenceError: (.+)/i, type: 'ReferenceError' },
        { pattern: /SyntaxError: (.+)/i, type: 'SyntaxError' },
        { pattern: /Error: (.+)/i, type: 'Error' },
        { pattern: /Cannot find module '(.+)'/i, type: 'ModuleNotFound' },
        { pattern: /Property '(.+)' does not exist/i, type: 'PropertyError' },
        { pattern: /Type '(.+)' is not assignable/i, type: 'TypeMismatch' },
        { pattern: /Expected (\d+) arguments?, but got (\d+)/i, type: 'ArgumentCount' },
        { pattern: /ENOENT: no such file or directory/i, type: 'FileNotFound' },
        { pattern: /EACCES: permission denied/i, type: 'PermissionDenied' }
    ];

    // File location patterns
    private readonly LOCATION_PATTERNS = [
        /at (.+):(\d+):(\d+)/,  // Standard stack trace
        /(.+\.(?:ts|js|tsx|jsx)):(\d+):(\d+)/,  // TypeScript/JavaScript
        /File "(.+)", line (\d+)/,  // Python
        /(.+\.go):(\d+):/  // Go
    ];

    private personaManager: PersonaManager;

    constructor() {
        super({ name: 'Executor', timeout: 60000 });
        this.personaManager = new PersonaManager();
    }

    async execute(input: ExecutorInput): Promise<AgentOutput<ExecutorOutput>> {
        const startTime = Date.now();

        try {
            let result: ExecutorOutput;

            // Handle multiple commands
            if (input.commands && input.commands.length > 0) {
                const results: ExecutionResult[] = [];
                let overallSuccess = true;
                let combinedStdout = '';
                let combinedStderr = '';

                for (const cmd of input.commands) {
                    if (!cmd) continue;
                    let cmdResult: ExecutorOutput;

                    if (typeof cmd === 'string') {
                        cmdResult = await this.runCommand({ ...input, command: cmd });
                    } else if (cmd.operation === 'create_file') {
                        // Handle file creation directly
                        try {
                             // Ensure directory exists
                             const dir = path.dirname(cmd.target);
                             if (!fs.existsSync(dir)) {
                                 fs.mkdirSync(dir, { recursive: true });
                             }
                             fs.writeFileSync(cmd.target, cmd.content);
                             cmdResult = {
                                 command: `create_file ${cmd.target}`,
                                 exitCode: 0,
                                 stdout: `Created file: ${cmd.target}`,
                                 stderr: '',
                                 success: true,
                                 duration: 0,
                                 recoveryOptions: []
                             };
                        } catch (e) {
                             cmdResult = {
                                 command: `create_file ${cmd.target}`,
                                 exitCode: 1,
                                 stdout: '',
                                 stderr: (e as Error).message,
                                 success: false,
                                 duration: 0,
                                 recoveryOptions: []
                             };
                        }
                    } else if (cmd.command) {
                        // CommandSpec object
                        if (cmd.runInTerminal) {
                            cmdResult = await this.runInTerminal({ ...input, command: cmd.command });
                        } else {
                            cmdResult = await this.runCommand({ ...input, command: cmd.command });
                        }
                    } else {
                        // Unknown format
                        continue;
                    }

                    results.push(cmdResult);
                    combinedStdout += cmdResult.stdout + '\n';
                    combinedStderr += cmdResult.stderr + '\n';
                    if (!cmdResult.success) {
                        overallSuccess = false;
                        // Stop execution of subsequent commands if one fails
                        // This mimics 'set -e' behavior and prevents cascading failures
                        break; 
                    }
                }

                result = {
                    command: 'multiple_commands',
                    exitCode: overallSuccess ? 0 : 1,
                    stdout: combinedStdout,
                    stderr: combinedStderr,
                    success: overallSuccess,
                    duration: Date.now() - startTime,
                    recoveryOptions: [],
                    results
                };

            } else if (input.command) {
                // Single command
                if (input.runInTerminal) {
                    result = await this.runInTerminal(input);
                } else {
                    result = await this.runCommand(input);
                }
            } else {
                throw new Error("No command provided to Executor");
            }

            // Parse errors if requested
            if (input.parseErrors && !result.success) {
                result.parsed = this.parseError(result.stderr || result.stdout);
                result.recoveryOptions = this.generateRecoveryOptions(result);
            }

            const confidence = result.success ? 0.95 : 0.6;

            return this.createOutput(
                result.success ? 'success' : 'partial',
                result,
                confidence,
                startTime,
                {
                    reasoning: result.success
                        ? `Command(s) completed successfully in ${result.duration}ms`
                        : `Command(s) failed with exit code ${result.exitCode}: ${result.parsed?.errorType || 'Unknown error'}`
                }
            );

        } catch (error) {
            return this.handleError(error as Error, startTime);
        }
    }

    /**
     * Run a command in a visible VS Code terminal
     */
    private runInTerminal(input: ExecutorInput): Promise<ExecutorOutput> {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const cwd = input.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            const cmdString = input.command || 'echo "No command provided"';

            // Create or reuse terminal
            let terminal = vscode.window.terminals.find(t => t.name === 'Byte Coder Executor');
            if (!terminal) {
                terminal = vscode.window.createTerminal({
                    name: 'Byte Coder Executor',
                    cwd: cwd
                });
            }

            terminal.show(true); // Show but don't take focus
            terminal.sendText(cmdString);

            // Since we can't easily get exit code from terminal without complex listeners,
            // we assume success for interactive/background tasks or advise user to check.
            // For rigorous verification, standard runCommand is better.
            
            resolve({
                command: cmdString,
                exitCode: 0, // Assumed success for terminal launch
                stdout: `Command sent to terminal: ${cmdString}`,
                stderr: '',
                success: true,
                duration: Date.now() - startTime,
                recoveryOptions: []
            });
        });
    }

    /**
     * Run a command and capture output
     */
    private runCommand(input: ExecutorInput): Promise<ExecutorOutput> {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const cwd = input.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            const timeout = input.timeout || this.timeout;

            // Ensure command is a string
            const cmdString = input.command || 'echo "No command provided"';

            const child = cp.exec(cmdString, {
                cwd,
                timeout,
                maxBuffer: 10 * 1024 * 1024,  // 10MB buffer
                env: { ...process.env, FORCE_COLOR: '0' }  // Disable color codes
            }, (error: any, stdout: string | Buffer, stderr: string | Buffer) => {
                const duration = Date.now() - startTime;
                const exitCode = error ? (error as any).code || 1 : 0;
                const success = input.expectSuccess !== false ? exitCode === 0 : true;

                const stdoutStr = typeof stdout === 'string' ? stdout : stdout.toString();
                const stderrStr = typeof stderr === 'string' ? stderr : stderr.toString();

                // Try to extract error location
                const errorLocation = this.extractErrorLocation(stderrStr || stdoutStr);

                resolve({
                    command: cmdString,
                    exitCode,
                    stdout: stdoutStr.slice(0, 5000),  // Limit output size
                    stderr: stderrStr.slice(0, 5000),
                    success,
                    duration,
                    errorLocation,
                    recoveryOptions: []
                });
            });
        });
    }

    private extractErrorLocation(output: string): FileLocation | undefined {
        for (const pattern of this.LOCATION_PATTERNS) {
            const match = output.match(pattern);
            if (match) {
                return {
                    file: match[1],
                    startLine: parseInt(match[2]),
                    endLine: parseInt(match[2]),
                    confidence: 1.0,
                    reason: 'Stack trace extraction'
                };
            }
        }
        return undefined;
    }

    private parseError(output: string): { errorType: string; errorMessage: string; suggestions: string[] } | undefined {
        for (const { pattern, type } of this.ERROR_PATTERNS) {
            const match = output.match(pattern);
            if (match) {
                return {
                    errorType: type,
                    errorMessage: match[1],
                    suggestions: this.getSuggestionsForError(type, match[1])
                };
            }
        }
        return undefined;
    }

    private getSuggestionsForError(type: string, message: string): string[] {
        // Simple heuristic suggestions
        switch (type) {
            case 'ModuleNotFound':
                return [`Run 'npm install ${message}'`, 'Check import path'];
            case 'TypeError':
                return ['Check variable types', 'Verify object properties'];
            case 'SyntaxError':
                return ['Check for missing brackets or semicolons', 'Verify language syntax'];
            default:
                return ['Check documentation', 'Search for error message'];
        }
    }

    private generateRecoveryOptions(result: ExecutorOutput): any[] {
        const options: any[] = [];
        
        if (!result.parsed) return options;

        const { errorType, errorMessage } = result.parsed;

        // Use Persona to analyze (simulated for now, could use LLM)
        // This adds a layer of role-specific advice
        const personaAdvice = this.analyzeErrorWithPersona(errorType, errorMessage);
        if (personaAdvice) {
            result.personaAdvice = personaAdvice;
        }

        if (errorType === 'ModuleNotFound') {
            // Smart package manager detection
            const pkgMatch = errorMessage.match(/'([^']+)'/);
            const pkg = pkgMatch ? pkgMatch[1] : errorMessage;
            const installCmd = this.detectPackageManager(result.parsed.errorMessage.includes('yarn') ? 'yarn' : 'npm'); // Simple fallback
            
            options.push({
                strategy: 'install_dependency',
                confidence: 0.95,
                command: `${installCmd} ${pkg}`,
                description: `Install missing dependency: ${pkg}`
            });
        }
        else if (errorType === 'FileNotFound') {
            const fileMatch = errorMessage.match(/'([^']+)'/);
            if (fileMatch) {
                options.push({
                    strategy: 'create_file',
                    confidence: 0.85,
                    command: `touch ${fileMatch[1]}`,
                    description: `Create missing file: ${fileMatch[1]}`
                });
            }
        }
        else if (errorType === 'SyntaxError') {
             options.push({
                 strategy: 'fix_syntax',
                 confidence: 0.8,
                 description: 'Request CodeModifier to fix syntax error at identified location'
             });
        }
        else if (errorType === 'TypeError' || errorType === 'ReferenceError') {
             options.push({
                 strategy: 'debug_code',
                 confidence: 0.7,
                 description: 'Request analysis and fix for type/reference error'
             });
        }

        return options;
    }

    private detectPackageManager(preference: string = 'npm'): string {
        // In a real scenario, we would check for lock files in the workspace.
        // Since we don't have easy async access here without breaking the sync flow or adding async,
        // we'll stick to a heuristic or preference.
        // But wait, we can check fs if we have the cwd.
        // However, this method signature doesn't have cwd. 
        // Let's just return a safe default for now or use the preference.
        return preference === 'yarn' ? 'yarn add' : 'npm install';
    }

    private analyzeErrorWithPersona(errorType: string, message: string): string {
        const debuggerPersona = this.personaManager.getPersona('DevOpsEngineer'); // Or Debugger if we had it
        
        if (errorType === 'ModuleNotFound') {
            return `[${debuggerPersona.role}] It seems a dependency is missing. Check your package.json or install it directly.`;
        }
        if (errorType === 'SyntaxError') {
            return `[${debuggerPersona.role}] Syntax error detected. Review the code structure near the error line.`;
        }
        return `[${debuggerPersona.role}] Error detected: ${errorType}. Review the logs for details.`;
    }
}
