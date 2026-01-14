
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import * as fs from 'fs';
import * as path from 'path';

const exec = util.promisify(cp.exec);

export class VersionManager {
    private _shadowRoot: string | undefined;
    private _workspaceRoot: string | undefined;
    private _isInitialized: boolean = false;

    constructor() {
        this.init();
    }

    private async init() {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) return;

        this._workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        this._shadowRoot = path.join(this._workspaceRoot, '.byteai', 'shadow_vcs');

        // Ensure .byteai folder exists
        const byteAiDir = path.join(this._workspaceRoot, '.byteai');
        if (!fs.existsSync(byteAiDir)) {
            fs.mkdirSync(byteAiDir);
        }

        // Initialize Shadow Repo if not exists
        if (!fs.existsSync(this._shadowRoot)) {
            fs.mkdirSync(this._shadowRoot);
            await this.runGitCommand('init');
            await this.setupIgnore();
        }

        this._isInitialized = true;
    }

    private async setupIgnore() {
        if (!this._workspaceRoot || !this._shadowRoot) return;
        // Verify we aren't tracking massive folders in our shadow VCS
        const excludeFile = path.join(this._shadowRoot, '.git', 'info', 'exclude');

        // Ensure .git/info exists (it should after init)
        const infoDir = path.dirname(excludeFile);
        if (!fs.existsSync(infoDir)) fs.mkdirSync(infoDir, { recursive: true });

        const ignores = [
            'node_modules/',
            '.byteai/',
            'dist/',
            'out/',
            '.vscode-test/'
        ];

        try {
            fs.writeFileSync(excludeFile, ignores.join('\n'));
        } catch (e) {
            console.error("Failed to write shadow VCS ignores:", e);
        }
    }

    private async runGitCommand(command: string): Promise<string> {
        if (!this._workspaceRoot || !this._shadowRoot) throw new Error("VCS not initialized");

        // --git-dir points to our shadow repo, --work-tree points to the user's actual files
        const fullCmd = `git --git-dir="${path.join(this._shadowRoot, '.git')}" --work-tree="${this._workspaceRoot}" ${command}`;
        const { stdout } = await exec(fullCmd, { cwd: this._workspaceRoot });
        return stdout;
    }

    public async createCheckpoint(message: string): Promise<string | null> {
        if (!this._isInitialized) await this.init();
        if (!this._isInitialized) return null;

        try {
            await this.runGitCommand('add -A');
            await this.runGitCommand(`commit -m "Shadow Commit: ${message}" --allow-empty`);
            return await this.getCurrentCommit();
        } catch (e: any) {
            console.error("Shadow VCS Checkpoint failed:", e);
            return null;
        }
    }

    public async getCurrentCommit(): Promise<string | null> {
        if (!this._isInitialized) return null;
        try {
            const output = await this.runGitCommand('rev-parse HEAD');
            return output.trim();
        } catch {
            return null;
        }
    }

    public async checkout(commitHash: string): Promise<boolean> {
        if (!this._isInitialized) return false;
        try {
            // Force reset the WORK TREE to match the shadow commit
            await this.runGitCommand(`reset --hard ${commitHash}`);
            return true;
        } catch (e) {
            console.error("Shadow VCS Checkout failed:", e);
            return false;
        }
    }

    public async undoLastCommit(): Promise<boolean> {
        if (!this._isInitialized) return false;
        try {
            await this.runGitCommand('reset --hard HEAD~1');
            return true;
        } catch (e) {
            console.error("Shadow VCS Undo failed:", e);
            return false;
        }
    }
}
