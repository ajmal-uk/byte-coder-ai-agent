/**
 * VersionControllerAgent - Automatic checkpoint system for Byte Coder
 * Creates checkpoints, manages rollbacks, and tracks file changes
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { BaseAgent, AgentOutput, Checkpoint } from '../core/AgentTypes';

import * as crypto from 'crypto';

export interface VersionControllerInput {
    action: 'create_checkpoint' | 'rollback' | 'list_checkpoints' | 'delete_checkpoint' | 'delete_session_checkpoints' | 'get_file_content' | 'get_diff' | 'search_history';
    checkpointId?: string;
    files?: string[];
    description?: string;
    sessionId?: string;
    requestId?: string;
    searchQuery?: string;
}

export interface VersionControllerResult {
    success: boolean;
    checkpoint?: Checkpoint;
    checkpoints?: Checkpoint[];
    restoredFiles?: string[];
    message: string;
    content?: string;
    diff?: string;
}

export class VersionControllerAgent extends BaseAgent<VersionControllerInput, VersionControllerResult> {
    private checkpointDir: string = '';
    private checkpoints: Map<string, Checkpoint> = new Map();
    private fileSnapshots: Map<string, Map<string, string>> = new Map();  // checkpointId -> (filePath -> content)

    constructor(private context?: vscode.ExtensionContext) {
        super({ name: 'VersionController', timeout: 30000 });
        this.initCheckpointDir();
        this.loadAllCheckpoints();
    }

    /**
     * Initialize the checkpoint directory
     */
    private initCheckpointDir(): void {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceRoot) {
            this.checkpointDir = path.join(workspaceRoot, '.bytecoder', 'checkpoints');
            try {
                if (!fs.existsSync(this.checkpointDir)) {
                    fs.mkdirSync(this.checkpointDir, { recursive: true });
                }
            } catch {
                // Unable to create directory, will use in-memory only
            }
        }
    }

    async execute(input: VersionControllerInput): Promise<AgentOutput<VersionControllerResult>> {
        const startTime = Date.now();

        try {
            let result: VersionControllerResult;

            switch (input.action) {
                case 'create_checkpoint':
                    result = await this.createCheckpoint(input.files || [], input.description, input.sessionId, input.requestId);
                    break;
                case 'rollback':
                    result = await this.rollback(input.checkpointId, input.files);
                    break;
                case 'list_checkpoints':
                    result = this.listCheckpoints();
                    break;
                case 'delete_checkpoint':
                    result = this.deleteCheckpoint(input.checkpointId!);
                    break;
                case 'delete_session_checkpoints':
                    result = await this.deleteSessionCheckpoints(input.sessionId!);
                    break;
                case 'get_file_content':
                    result = await this.getFileContent(input.checkpointId!, input.files?.[0]!);
                    break;
                case 'get_diff':
                    result = await this.getDiff(input.checkpointId!, input.files?.[0]);
                    break;
                case 'search_history':
                    result = await this.searchHistory(input.searchQuery!);
                    break;
                default:
                    result = { success: false, message: 'Unknown action' };
            }

            return this.createOutput(
                result.success ? 'success' : 'failed',
                result,
                result.success ? 0.95 : 0.3,
                startTime,
                { reasoning: result.message }
            );

        } catch (error) {
            return this.handleError(error as Error, startTime);
        }
    }

    /**
     * Delete all checkpoints
     */
    async deleteAllCheckpoints(): Promise<VersionControllerResult> {
        try {
            // Clear in-memory maps
            this.checkpoints.clear();
            this.fileSnapshots.clear();

            // Clear disk storage
            if (this.checkpointDir && fs.existsSync(this.checkpointDir)) {
                fs.rmSync(this.checkpointDir, { recursive: true, force: true });
                // Re-create empty directory
                this.initCheckpointDir();
            }

            // Clear extension state
            if (this.context) {
                await this.context.workspaceState.update('byteAI.checkpoints', []);
            }

            return {
                success: true,
                message: 'All checkpoints deleted successfully'
            };
        } catch (error) {
            return {
                success: false,
                message: `Failed to delete checkpoints: ${error}`
            };
        }
    }

    /**
     * Load all checkpoints
     * Uses index.json if available for speed, otherwise falls back to scanning
     */
    private loadAllCheckpoints(): void {
        if (!this.checkpointDir || !fs.existsSync(this.checkpointDir)) return;

        // Try loading from index first
        const indexPath = path.join(this.checkpointDir, 'index.json');
        if (fs.existsSync(indexPath)) {
            try {
                const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
                for (const cp of indexData) {
                    this.checkpoints.set(cp.checkpointId, cp);
                }
                return;
            } catch (e) {
                console.warn('Failed to load checkpoint index, falling back to scan:', e);
            }
        }

        // Fallback: Scan directory
        try {
            const files = fs.readdirSync(this.checkpointDir).filter(f => f.endsWith('.json') && f !== 'index.json');
            const newIndex: Checkpoint[] = [];
            
            for (const file of files) {
                try {
                    const filePath = path.join(this.checkpointDir, file);
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    if (data.checkpoint && data.checkpoint.checkpointId) {
                        this.checkpoints.set(data.checkpoint.checkpointId, data.checkpoint);
                        newIndex.push(data.checkpoint);
                    }
                } catch (e) {
                    console.error(`Failed to load checkpoint ${file}:`, e);
                }
            }
            
            // Rebuild index
            if (newIndex.length > 0) {
                this.saveIndex(newIndex);
            }
        } catch (e) {
            console.error('Failed to read checkpoint directory:', e);
        }
    }

    /**
     * Create a new checkpoint
     */
    private async createCheckpoint(files: string[], description?: string, sessionId?: string, requestId?: string): Promise<VersionControllerResult> {
        if (requestId) {
            const existing = Array.from(this.checkpoints.values()).find(cp => cp.requestId === requestId);
            if (existing) {
                return this.rollback(existing.checkpointId);
            }
        }

        const checkpointId = this.generateCheckpointId();
        const timestamp = new Date();
        const snapshots = new Map<string, string>();

        if (files.length === 0) {
            const openDocs = vscode.workspace.textDocuments.filter(d => !d.isUntitled && !d.uri.scheme.startsWith('git'));
            files = openDocs.map(d => d.uri.fsPath);
        }

        for (const filePath of files) {
            try {
                const uri = vscode.Uri.file(filePath);
                const document = await vscode.workspace.openTextDocument(uri);
                snapshots.set(filePath, document.getText());
            } catch { }
        }

        const checkpoint: Checkpoint = {
            checkpointId,
            timestamp,
            modifiedFiles: Array.from(snapshots.keys()),
            diffHash: this.generateHash(Array.from(snapshots.values()).join('\n')),
            rollbackCommand: `bytecoder rollback ${checkpointId}`,
            description: description || `Checkpoint at ${timestamp.toISOString()}`,
            sessionId,
            requestId
        };

        this.checkpoints.set(checkpointId, checkpoint);
        this.fileSnapshots.set(checkpointId, snapshots);

        await this.persistCheckpoint(checkpointId, checkpoint, snapshots);

        if (this.context) {
            const storedCheckpoints = this.context.workspaceState.get<Checkpoint[]>('byteAI.checkpoints', []);
            storedCheckpoints.push(checkpoint);
            await this.context.workspaceState.update('byteAI.checkpoints', storedCheckpoints.slice(-20));
        }

        return {
            success: true,
            checkpoint,
            message: `Created checkpoint ${checkpointId} with ${snapshots.size} files`
        };
    }

    /**
     * Delete all checkpoints for a specific session
     */
    private async deleteSessionCheckpoints(sessionId: string): Promise<VersionControllerResult> {
        const toDelete = Array.from(this.checkpoints.values())
            .filter(cp => cp.sessionId === sessionId);
            
        let deletedCount = 0;
        for (const cp of toDelete) {
            const res = this.deleteCheckpoint(cp.checkpointId);
            if (res.success) deletedCount++;
        }
        
        return {
            success: true,
            message: `Deleted ${deletedCount} checkpoints for session ${sessionId}`
        };
    }

    /**
     * Resolve a checkpoint ID from keywords or existing IDs
     */
    private resolveCheckpointId(checkpointId?: string): { id?: string; error?: string } {
        const allCheckpoints = Array.from(this.checkpoints.values());
        if (allCheckpoints.length === 0) {
            return { error: 'No checkpoints found' };
        }
        
        // Sort by timestamp descending (newest first)
        allCheckpoints.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        let targetId = checkpointId;

        if (!targetId || targetId === 'latest' || targetId === 'current') {
            return { id: allCheckpoints[0].checkpointId };
        } 
        
        if (targetId === 'previous' || targetId === 'last') {
            if (allCheckpoints.length < 2) {
                 return { error: 'No previous checkpoint available' };
            }
            return { id: allCheckpoints[1].checkpointId };
        } 
        
        if (/^HEAD~(\d+)$/.test(targetId)) {
            const match = targetId.match(/^HEAD~(\d+)$/);
            const offset = parseInt(match![1], 10);
            if (allCheckpoints.length <= offset) {
                return { error: `Cannot go back ${offset} steps (only ${allCheckpoints.length} checkpoints exist)` };
            }
            return { id: allCheckpoints[offset].checkpointId };
        }

        // Check if ID exists
        if (this.checkpoints.has(targetId)) {
            return { id: targetId };
        }

        return { error: `Checkpoint ${targetId} not found` };
    }

    /**
     * Get file content from a checkpoint
     */
    private async getFileContent(checkpointId: string, filePath: string): Promise<VersionControllerResult> {
        const { id: targetId, error } = this.resolveCheckpointId(checkpointId);
        if (error || !targetId) {
            return { success: false, message: error || 'Checkpoint resolution failed' };
        }

        if (!this.fileSnapshots.has(targetId)) {
            await this.loadCheckpoint(targetId);
        }

        const snapshots = this.fileSnapshots.get(targetId);
        if (!snapshots) {
            return { success: false, message: `Checkpoint ${targetId} data not found` };
        }

        const content = snapshots.get(filePath);
        if (content === undefined) {
            return { success: false, message: `File ${filePath} not found in checkpoint ${targetId}` };
        }

        return {
            success: true,
            content,
            message: `Retrieved content for ${filePath} from ${targetId}`
        };
    }

    /**
     * Get diff between current workspace and a checkpoint
     */
    private async getDiff(checkpointId: string, filePath?: string): Promise<VersionControllerResult> {
        const { id: targetId, error } = this.resolveCheckpointId(checkpointId);
        if (error || !targetId) {
            return { success: false, message: error || 'Checkpoint resolution failed' };
        }

        if (!this.fileSnapshots.has(targetId)) {
            await this.loadCheckpoint(targetId);
        }

        const snapshots = this.fileSnapshots.get(targetId);
        if (!snapshots) {
            return { success: false, message: `Checkpoint ${targetId} data not found` };
        }

        let diffOutput = '';
        const filesToDiff = filePath ? [filePath] : Array.from(snapshots.keys());

        for (const file of filesToDiff) {
            const oldContent = snapshots.get(file);
            if (oldContent === undefined) continue;

            try {
                let newContent = '';
                if (fs.existsSync(file)) {
                    newContent = fs.readFileSync(file, 'utf8');
                }

                if (oldContent !== newContent) {
                    diffOutput += `--- ${file} (Checkpoint ${targetId})\n`;
                    diffOutput += `+++ ${file} (Current)\n`;
                    diffOutput += this.generateSimpleDiff(oldContent, newContent) + '\n\n';
                }
            } catch (e) {
                diffOutput += `Error reading current file ${file}: ${e}\n`;
            }
        }

        if (!diffOutput) {
            diffOutput = 'No changes detected.';
        }

        return {
            success: true,
            diff: diffOutput,
            message: `Generated diff for checkpoint ${targetId}`
        };
    }

    private generateSimpleDiff(oldText: string, newText: string): string {
        const oldLines = oldText.split('\n');
        const newLines = newText.split('\n');
        let diff = '';
        
        let i = 0; 
        let j = 0;
        
        while(i < oldLines.length || j < newLines.length) {
            if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
                i++; j++;
            } else {
                if (i < oldLines.length) {
                    diff += `- ${oldLines[i]}\n`;
                    i++;
                }
                if (j < newLines.length) {
                    diff += `+ ${newLines[j]}\n`;
                    j++;
                }
            }
        }
        return diff;
    }

    /**
     * Search history (checkpoints) for a query
     */
    private async searchHistory(query: string): Promise<VersionControllerResult> {
        const lowerQuery = query.toLowerCase();
        const matches: Checkpoint[] = [];
        
        // 1. Search metadata (fast)
        for (const cp of this.checkpoints.values()) {
            if (cp.description.toLowerCase().includes(lowerQuery) || 
                cp.checkpointId.includes(lowerQuery) ||
                (cp.sessionId && cp.sessionId.includes(lowerQuery))) {
                matches.push(cp);
            }
        }

        // 2. Search content (slower, but deeper)
        if (this.checkpointDir && fs.existsSync(this.checkpointDir)) {
             const files = fs.readdirSync(this.checkpointDir).filter(f => f.endsWith('.json') && f !== 'index.json');
             for (const file of files) {
                 try {
                     const filePath = path.join(this.checkpointDir, file);
                     // Just read file - loadCheckpoint handles decompression if needed
                     const fileContent = fs.readFileSync(filePath, 'utf8');
                     const data = JSON.parse(fileContent);
                     
                     let snapshots: Record<string, string> = {};
                     if (data.compressedSnapshots) {
                         const buffer = Buffer.from(data.compressedSnapshots, 'base64');
                         const decompressed = zlib.gunzipSync(buffer).toString('utf8');
                         snapshots = JSON.parse(decompressed);
                     } else if (data.snapshots) {
                         snapshots = data.snapshots;
                     }
                     
                     let contentMatch = false;
                     for (const [fPath, content] of Object.entries(snapshots)) {
                         if ((content as string).toLowerCase().includes(lowerQuery)) {
                             contentMatch = true;
                             break;
                         }
                     }

                     if (contentMatch) {
                         if (!matches.find(m => m.checkpointId === data.checkpoint.checkpointId)) {
                             matches.push(data.checkpoint);
                         }
                     }
                 } catch {}
             }
        }

        return {
            success: true,
            checkpoints: matches,
            message: `Found ${matches.length} checkpoints matching '${query}'`
        };
    }

    /**
     * Rollback to a checkpoint
     * @param checkpointId ID of the checkpoint to rollback to. 
     *                     Supports 'latest', 'previous', or specific UUID.
     *                     If undefined, defaults to 'latest'.
     * @param filesOptional Optional list of files to restore. If empty, restores all files.
     */
    private async rollback(checkpointId?: string, filesOptional?: string[]): Promise<VersionControllerResult> {
        const { id: targetId, error } = this.resolveCheckpointId(checkpointId);
        if (error || !targetId) {
            return { success: false, message: error || 'Checkpoint resolution failed' };
        }

        const snapshots = this.fileSnapshots.get(targetId);

        if (!snapshots) {
            const loaded = await this.loadCheckpoint(targetId);
            if (!loaded) {
                return {
                    success: false,
                    message: `Checkpoint ${targetId} not found`
                };
            }
        }

        const filesMap = this.fileSnapshots.get(targetId)!;
        const restoredFiles: string[] = [];
        
        // Determine which files to restore
        const filesToRestore = filesOptional && filesOptional.length > 0 
            ? filesOptional 
            : Array.from(filesMap.keys());

        for (const filePath of filesToRestore) {
            const content = filesMap.get(filePath);
            if (content === undefined) {
                console.warn(`File ${filePath} not found in checkpoint ${targetId}, skipping.`);
                continue;
            }

            try {
                const uri = vscode.Uri.file(filePath);
                try {
                    const document = await vscode.workspace.openTextDocument(uri);
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(
                        uri,
                        new vscode.Range(
                            new vscode.Position(0, 0),
                            new vscode.Position(document.lineCount, 0)
                        ),
                        content
                    );
                    await vscode.workspace.applyEdit(edit);
                    await document.save();
                    restoredFiles.push(filePath);
                } catch {
                    const dirPath = path.dirname(filePath);
                    if (!fs.existsSync(dirPath)) {
                        fs.mkdirSync(dirPath, { recursive: true });
                    }
                    fs.writeFileSync(filePath, content);
                    restoredFiles.push(filePath);
                }
            } catch (error) {
                console.error(`Failed to restore ${filePath}:`, error);
            }
        }

        return {
            success: restoredFiles.length > 0,
            restoredFiles,
            message: `Restored ${restoredFiles.length} files from checkpoint ${targetId}`
        };
    }

    /**
     * List all checkpoints
     */
    private listCheckpoints(): VersionControllerResult {
        const checkpoints = Array.from(this.checkpoints.values());

        return {
            success: true,
            checkpoints,
            message: `Found ${checkpoints.length} checkpoints`
        };
    }

    /**
     * Delete a checkpoint
     */
    private deleteCheckpoint(checkpointId: string): VersionControllerResult {
        const existed = this.checkpoints.delete(checkpointId);
        this.fileSnapshots.delete(checkpointId);

        if (this.checkpointDir) {
            const checkpointPath = path.join(this.checkpointDir, `${checkpointId}.json`);
            try {
                if (fs.existsSync(checkpointPath)) {
                    fs.unlinkSync(checkpointPath);
                }
            } catch { }
            
            // Update index
            this.saveIndex(Array.from(this.checkpoints.values()));
        }

        return {
            success: existed,
            message: existed ? `Deleted checkpoint ${checkpointId}` : `Checkpoint ${checkpointId} not found`
        };
    }

    private saveIndex(checkpoints: Checkpoint[]): void {
        if (!this.checkpointDir) return;
        try {
            const indexPath = path.join(this.checkpointDir, 'index.json');
            fs.writeFileSync(indexPath, JSON.stringify(checkpoints, null, 2));
        } catch (e) {
            console.error('Failed to save checkpoint index:', e);
        }
    }

    /**
     * Persist checkpoint to disk atomically with compression
     */
    private async persistCheckpoint(
        id: string,
        checkpoint: Checkpoint,
        snapshots: Map<string, string>
    ): Promise<void> {
        if (!this.checkpointDir) return;

        try {
            // Compress snapshots
            const snapshotsObj = Object.fromEntries(snapshots);
            const snapshotsJson = JSON.stringify(snapshotsObj);
            const compressed = zlib.gzipSync(snapshotsJson).toString('base64');

            const data = {
                checkpoint,
                compressedSnapshots: compressed,
                version: 2
            };
            
            const filePath = path.join(this.checkpointDir, `${id}.json`);
            const tempPath = `${filePath}.tmp`;

            // Write to temp file first
            fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
            
            // Rename to final file (atomic operation)
            fs.renameSync(tempPath, filePath);

            // Update index
            const allCheckpoints = Array.from(this.checkpoints.values());
            this.saveIndex(allCheckpoints);

            // Trigger cleanup
            this.enforceRetentionPolicy();

        } catch (error) {
            console.error(`Failed to persist checkpoint ${id}:`, error);
        }
    }

    /**
     * Enforce retention policy:
     * - Keep last 20 checkpoints
     * - Keep checkpoints from last 1 hour
     * - Always keep checkpoints with "important" tag (future proofing)
     */
    private enforceRetentionPolicy(): void {
        const MAX_COUNT = 20;
        const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

        const allCheckpoints = Array.from(this.checkpoints.values())
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        if (allCheckpoints.length <= MAX_COUNT) return;

        const now = Date.now();
        const toDelete: string[] = [];

        // Keep the first MAX_COUNT
        // For the rest, check if they are too old
        for (let i = MAX_COUNT; i < allCheckpoints.length; i++) {
            const cp = allCheckpoints[i];
            const age = now - new Date(cp.timestamp).getTime();
            
            // If it's older than MAX_AGE, delete it
            if (age > MAX_AGE_MS) {
                toDelete.push(cp.checkpointId);
            }
        }

        for (const id of toDelete) {
            this.deleteCheckpoint(id);
        }
    }

    /**
     * Load checkpoint from disk (supports v1 plain and v2 compressed)
     */
    private async loadCheckpoint(id: string): Promise<boolean> {
        if (!this.checkpointDir) return false;

        try {
            const filePath = path.join(this.checkpointDir, `${id}.json`);
            if (!fs.existsSync(filePath)) return false;

            const fileContent = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(fileContent);

            this.checkpoints.set(id, data.checkpoint);

            let snapshotsMap: Map<string, string>;

            if (data.compressedSnapshots) {
                // v2: Decompress
                const buffer = Buffer.from(data.compressedSnapshots, 'base64');
                const decompressed = zlib.gunzipSync(buffer).toString('utf8');
                snapshotsMap = new Map(Object.entries(JSON.parse(decompressed)));
            } else if (data.snapshots) {
                // v1: Plain
                snapshotsMap = new Map(Object.entries(data.snapshots));
            } else {
                return false;
            }

            this.fileSnapshots.set(id, snapshotsMap);
            return true;
        } catch (e) {
            console.error(`Failed to load checkpoint ${id}:`, e);
            return false;
        }
    }


    /**
     * Generate a checkpoint ID
     */
    private generateCheckpointId(): string {
        const now = new Date();
        const dateStr = now.toISOString().replace(/[-:T.]/g, '').slice(0, 17); // Include millis (3 digits)
        return `cp_${dateStr}`;
    }

    /**
     * Generate a robust hash
     */
    private generateHash(input: string): string {
        return crypto.createHash('sha256').update(input).digest('hex');
    }

    /**
     * Get the most recent checkpoint
     */
    getLatestCheckpoint(): Checkpoint | undefined {
        const checkpoints = Array.from(this.checkpoints.values());
        if (checkpoints.length === 0) return undefined;
        return checkpoints.sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )[0];
    }

    async cleanup(keepCount: number = 10): Promise<void> {
        const checkpoints = Array.from(this.checkpoints.entries())
            .sort((a, b) => new Date(b[1].timestamp).getTime() - new Date(a[1].timestamp).getTime());

        for (const [id] of checkpoints.slice(keepCount)) {
            this.deleteCheckpoint(id);
        }
    }
}
