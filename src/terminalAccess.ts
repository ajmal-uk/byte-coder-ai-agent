import * as vscode from 'vscode';

export class TerminalManager {
    private terminal: vscode.Terminal | undefined;

    constructor() { }

    private getTerminal(): vscode.Terminal {
        if (!this.terminal || this.terminal.exitStatus !== undefined) {
            this.terminal = vscode.window.createTerminal("Byte AI Terminal");
        }
        return this.terminal;
    }

    public async processAndExecute(text: string): Promise<boolean> {
        // Regex to capture multiline commands
        const regex = /\$\$ EXEC: ([\s\S]*?) \$\$/g;
        let match;
        let executed = false;

        while ((match = regex.exec(text)) !== null) {
            const command = match[1].trim();
            if (command) {
                await this.askAndExecute(command);
                executed = true;
            }
        }
        return executed;
    }

    private async askAndExecute(command: string) {
        const selection = await vscode.window.showInformationMessage(
            `Byte AI wants to execute terminal command:`,
            { modal: true, detail: command },
            "Execute",
            "Cancel"
        );

        if (selection === "Execute") {
            const terminal = this.getTerminal();
            terminal.show();
            terminal.sendText(command);
        }
    }
}
